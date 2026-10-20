import Phaser from 'phaser';
import { ANIM_MELEE, PHYSICS, ROOM_INNER, THROWN, WEAPON_STATS, type WeaponStats } from '../config/balance';
import { C, col, type ColorIndex } from '../config/palette';
import { noise, tone } from '../audio/sfx';
import type { Part } from '../entities/Ragdoll';
import { acquireImage, isFrozen, releaseImage, spawnParticles } from '../gfx/effects';
import { makeSprites, type SpriteData } from '../gfx/pixelSprite';
import { Weapon, type WeaponPointer } from './Weapon';

// ============================================================================
// Utility condivise dalle armi da mischia/lancio (Punch, Shuriken, Coltello).
// ============================================================================

/** (u, v) in coordinate locali dello sprite → carattere di palette o null. */
export type ShapeFn = (u: number, v: number) => string | null;

/**
 * Genera uno sprite pixel da forme analitiche: ogni pixel viene riportato nel
 * sistema locale (u lungo `angle`, v perpendicolare, centro del canvas = 0,0).
 * `body` riceve il contorno scuro di 1px, `fx` (scie, anelli) no.
 * Così lo stesso disegno esiste in 8 direzioni senza ruotare texture.
 */
export function rasterSprite(w: number, h: number, angle: number, body: ShapeFn, fx?: ShapeFn): SpriteData {
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const grid: string[][] = [];
  const loc = (x: number, y: number): [number, number] => {
    const px = x + 0.5 - w / 2;
    const py = y + 0.5 - h / 2;
    return [px * ca + py * sa, -px * sa + py * ca];
  };
  for (let y = 0; y < h; y++) {
    const row: string[] = [];
    for (let x = 0; x < w; x++) {
      const [u, v] = loc(x, y);
      row.push(body(u, v) ?? '.');
    }
    grid.push(row);
  }
  const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && grid[y][x] !== '.' && grid[y][x] !== '0';
  const out = grid.map((r) => r.slice());
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (grid[y][x] !== '.') continue;
      if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) out[y][x] = '0';
      else if (fx) {
        const [u, v] = loc(x, y);
        const c = fx(u, v);
        if (c) out[y][x] = c;
      }
    }
  }
  return out.map((r) => r.join(''));
}

/** Indice 0..n-1 della direzione quantizzata (n direzioni sul giro). */
export function dirIndex(angle: number, n: number): number {
  const k = Math.round(angle / ((Math.PI * 2) / n));
  return ((k % n) + n) % n;
}

/** Rotazione quantizzata a 45° (compatibilità con le versioni precedenti). */
export function quantize45(angle: number): { diagonal: boolean; rotation: number } {
  const k = Math.round(angle / (Math.PI / 4));
  const odd = ((k % 2) + 2) % 2 === 1;
  return { diagonal: odd, rotation: ((odd ? k - 1 : k) * Math.PI) / 4 };
}

/** Un frame di un'animazione a scatti: texture, offset dall'ancora, durata. */
export interface FxFrame {
  key: string;
  ms: number;
  x?: number;
  y?: number;
  /** silhouette piena di questo colore (frame d'impatto) */
  fill?: ColorIndex;
  hidden?: boolean;
  /** chiamata quando il frame inizia (anche se saltato per lag) */
  enter?: () => void;
}

interface FxActor {
  img: Phaser.GameObjects.Image;
  frames: readonly FxFrame[];
  i: number;
  t: number;
  anchor: { x: number; y: number };
}

/**
 * Animazioni "usa e getta" a frame, su immagini del pool condiviso.
 * Il tempo arriva da update(dt) già scalato dal chiamante (timeScale) e
 * non avanza durante l'hit-stop.
 */
export class FxActors {
  private list: FxActor[] = [];

  constructor(
    readonly scene: Phaser.Scene,
    private readonly max = 40,
  ) {}

  /** `anchor` può essere modificato dal chiamante (es. segue una parte di Tony). */
  play(
    anchor: { x: number; y: number },
    frames: readonly FxFrame[],
    opts: { depth?: number; flipX?: boolean } = {},
  ): void {
    if (this.list.length >= this.max) this.finish(this.list.shift());
    const img = acquireImage(this.scene, anchor.x, anchor.y, frames[0].key)
      .setDepth(opts.depth ?? 45)
      .setFlipX(!!opts.flipX);
    const a: FxActor = { img, frames, i: 0, t: 0, anchor };
    this.list.push(a);
    frames[0].enter?.();
    this.apply(a);
  }

  update(dt: number): void {
    if (this.list.length === 0 || isFrozen(this.scene)) return;
    let w = 0;
    for (let k = 0; k < this.list.length; k++) {
      const a = this.list[k];
      a.t += dt;
      let alive = true;
      while (a.t >= a.frames[a.i].ms) {
        a.t -= a.frames[a.i].ms;
        a.i++;
        if (a.i >= a.frames.length) {
          alive = false;
          break;
        }
        a.frames[a.i].enter?.();
      }
      if (!alive) {
        releaseImage(a.img);
        continue;
      }
      this.apply(a);
      this.list[w++] = a;
    }
    this.list.length = w;
  }

  clear(): void {
    for (const a of this.list) releaseImage(a.img);
    this.list.length = 0;
  }

  get size(): number {
    return this.list.length;
  }

  /** riciclo forzato: esegue comunque gli enter rimasti (es. il danno del pugno) */
  private finish(a: FxActor | undefined): void {
    if (!a) return;
    for (let i = a.i + 1; i < a.frames.length; i++) a.frames[i].enter?.();
    releaseImage(a.img);
  }

  private apply(a: FxActor): void {
    const f = a.frames[a.i];
    if (a.img.texture.key !== f.key) a.img.setTexture(f.key);
    if (f.fill !== undefined) a.img.setTintFill(col(f.fill));
    else if (a.img.isTinted) a.img.clearTint();
    a.img.setVisible(!f.hidden);
    a.img.setPosition(Math.round(a.anchor.x + (f.x ?? 0)), Math.round(a.anchor.y + (f.y ?? 0)));
  }
}

// ---------------------------------------------------------------- sprite comuni

const SPARK_SIZE = 11;
const GLINT_SIZE = 7;

/** scintilla metallica (2 frame), luccichio (2 frame) */
function makeCommonTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists('fx-spark-0')) return;
  const ray = (len: number, diag: number): ShapeFn => (u, v) => {
    const au = Math.abs(u);
    const av = Math.abs(v);
    if (au < 1 && av < 1) return 'c';
    if ((av < 0.6 && au < len) || (au < 0.6 && av < len)) return au + av < len * 0.55 ? 'c' : '4';
    if (Math.abs(au - av) < 0.6 && au < diag) return '4';
    return null;
  };
  const glint = (len: number): ShapeFn => (u, v) => {
    const au = Math.abs(u);
    const av = Math.abs(v);
    if ((av < 0.6 && au < len) || (au < 0.6 && av < len)) return 'c';
    return null;
  };
  const none: ShapeFn = () => null;
  makeSprites(scene, {
    'fx-spark-0': rasterSprite(SPARK_SIZE, SPARK_SIZE, 0, ray(5, 3.2)),
    'fx-spark-1': rasterSprite(SPARK_SIZE, SPARK_SIZE, Math.PI / 4, ray(3, 0)),
    'fx-glint-0': rasterSprite(GLINT_SIZE, GLINT_SIZE, 0, none, glint(3.4)),
    'fx-glint-1': rasterSprite(GLINT_SIZE, GLINT_SIZE, 0, none, glint(1.6)),
  });
}

// ============================================================================
// Base comune delle armi da lancio (usata anche da Coltello.ts).
// Proiettile cinematico: niente corpo Matter, movimento calcolato a mano.
// ============================================================================

/** Stats minime di un'arma da lancio (vedi WEAPON_STATS in balance.ts). */
export interface ThrownStats extends WeaponStats {
  speed: number;
  impulse: number;
  stickMs: number;
}

type ProjState = 'fly' | 'stuck' | 'wall' | 'fall' | 'blink';

interface TrailSample {
  x: number;
  y: number;
  key: string;
}

interface Projectile {
  img: Phaser.GameObjects.Image;
  state: ProjState;
  x: number;
  y: number;
  /** direzione di volo (normalizzata) */
  dx: number;
  dy: number;
  vx: number;
  vy: number;
  /** angolo "vero" (rad); lo sprite lo mostra quantizzato */
  angle: number;
  /** ms passati nello stato corrente */
  t: number;
  /** tempo totale (per l'animazione a scatti) */
  age: number;
  part: Part | null;
  /** offset e angolo relativi al corpo della parte (sistema locale) */
  lx: number;
  ly: number;
  la: number;
  /** frazione del danno (stelle laterali del ventaglio) */
  dmgScale: number;
  /** copie sbiadite della scia (solo in volo) */
  trail: Phaser.GameObjects.Image[];
  hist: TrailSample[];
  histT: number;
  /** prossimo luccichio (ms nello stato) */
  glintAt: number;
  bounced: boolean;
  onFloor: boolean;
  /** px percorsi in volo (la scia non va oltre il punto di lancio) */
  flown: number;
}

/** colori delle copie della scia, dalla più vicina alla più lontana */
const TRAIL_FILL: readonly ColorIndex[] = [C.silver, C.slate, C.slate];

/** frame di vibrazione quando si conficca: spostamento perpendicolare e "piega" del manico */
export interface VibFrame {
  perp: number;
  wobble: -1 | 0 | 1;
}

const HAND_SIZE = 23;

export abstract class ThrownWeapon<S extends ThrownStats> extends Weapon<S> {
  private projectiles: Projectile[] = [];
  private shutdownHooked = false;
  private fxActors: FxActors | null = null;

  /** texture per un proiettile all'angolo dato (spinning = in rotazione) */
  protected abstract frameFor(
    angle: number,
    age: number,
    spinning: boolean,
    wobble: -1 | 0 | 1,
  ): { key: string; rotation: number };
  /** registra le texture dei proiettili */
  protected abstract makeTextures(): void;
  protected abstract playSwish(): void;
  /** true = in volo ruota su se stesso, false = punta nella direzione di volo */
  protected abstract readonly spinsInFlight: boolean;
  /** vibrazione quando si conficca */
  protected abstract readonly vibFrames: readonly VibFrame[];
  /** distanza (px) della punta davanti al centro: lì si controlla il contatto */
  protected tipReach(): number {
    return 0;
  }
  /** rotazione in volo (rad/step) per chi non usa i frame a tempo */
  protected flightSpin(): number {
    return 0;
  }
  /** dove compare il luccichio rispetto al centro, con l'angolo attuale */
  protected glintOffset(_angle: number): { x: number; y: number } {
    return { x: -2, y: -2 };
  }
  /** effetti propri quando si conficca in Tony (es. imbottitura) */
  protected onStick(_x: number, _y: number, _dx: number, _dy: number): void {}
  /** angolo mostrato da fermo, appena conficcato (default: direzione di volo) */
  protected stuckAngle(_age: number, dx: number, dy: number): number {
    return Math.atan2(dy, dx);
  }
  /** angoli (offset in rad) e frazioni di danno dei proiettili di un tap */
  protected volley(_p: WeaponPointer): readonly { off: number; dmg: number }[] {
    return SINGLE;
  }

  protected get fx(): FxActors {
    if (!this.fxActors || this.fxActors.scene !== this.ctx.scene) {
      this.fxActors = new FxActors(this.ctx.scene);
    }
    return this.fxActors;
  }

  activate(): void {
    super.activate();
    makeCommonTextures(this.ctx.scene);
    makeHandTextures(this.ctx.scene);
    this.makeTextures();
    if (!this.shutdownHooked) {
      this.shutdownHooked = true;
      this.ctx.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        this.clearAll();
        this.fxActors = null;
        this.shutdownHooked = false;
      });
    }
  }

  deactivate(): void {
    this.clearAll();
    super.deactivate();
  }

  onPointerUp(p: WeaponPointer): void {
    if (p.wasGrab) return;
    if (!this.tryUse(p.time)) return;
    const shots = this.volley(p);
    for (let i = 0; i < shots.length; i++) this.launch(p.x, p.y, shots[i].off, shots[i].dmg, i === 0);
    this.playSwish();
  }

  update(dtMs: number): void {
    const scene = this.ctx.scene;
    const scaled = dtMs * scene.time.timeScale;
    this.fxActors?.update(scaled);
    if (this.projectiles.length === 0) return;
    if (isFrozen(scene)) return;
    const dt = Math.min(scaled, PHYSICS.stepMs * PHYSICS.maxStepsPerFrame);
    const steps = dt / PHYSICS.stepMs;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.t += dt;
      pr.age += dt;
      const alive = this.step(pr, steps);
      if (!alive) {
        this.releaseProjectile(pr);
        this.projectiles.splice(i, 1);
      } else {
        this.draw(pr, dt);
      }
    }
  }

  // ---------------------------------------------------------------- lancio

  private launch(tx: number, ty: number, angOff: number, dmgScale: number, withHand: boolean): void {
    const scene = this.ctx.scene;
    // lancio dall'angolo in basso opposto al punto toccato: la traiettoria
    // diagonale evita di trapassare le gambe di Tony quando si mira alla testa
    const midX = (ROOM_INNER.left + ROOM_INNER.right) / 2;
    const fromRight = tx < midX || (tx === midX && Math.random() < 0.5);
    const ox = fromRight ? ROOM_INNER.right - THROWN.originInset : ROOM_INNER.left + THROWN.originInset;
    // bersaglio basso (Tony sdraiato a terra): il lancio parte più in alto e
    // scende verso di lui, altrimenti la traiettoria gli passerebbe sopra
    const oy = Math.min(ROOM_INNER.bottom - THROWN.originAboveFloor, ty - THROWN.lowTargetLift);

    let dx = tx - ox;
    let dy = ty - oy;
    let len = Math.hypot(dx, dy);
    if (len < 1) {
      dx = 0;
      dy = -1;
      len = 1;
    }
    let angle = Math.atan2(dy, dx) + angOff;
    dx = Math.cos(angle);
    dy = Math.sin(angle);

    while (this.projectiles.length >= THROWN.maxProjectiles) {
      const old = this.projectiles.shift();
      if (old) this.releaseProjectile(old);
    }

    if (withHand) this.playHand(ox, oy, Math.atan2(dy, dx));
    // lo shuriken parte con una fase casuale, il coltello di punta
    if (this.spinsInFlight) angle = 0;

    const img = acquireImage(scene, ox, oy, this.frameFor(angle, 0, this.spinsInFlight, 0).key).setDepth(17);
    const trail: Phaser.GameObjects.Image[] = [];
    for (let i = 0; i < ANIM_MELEE.trailCopies; i++) {
      trail.push(
        acquireImage(scene, ox, oy, img.texture.key)
          .setDepth(16.9 - i * 0.01)
          .setTintFill(col(TRAIL_FILL[Math.min(i, TRAIL_FILL.length - 1)]))
          .setVisible(false),
      );
    }
    const pr: Projectile = {
      img,
      state: 'fly',
      x: ox,
      y: oy,
      dx,
      dy,
      vx: 0,
      vy: 0,
      angle,
      t: 0,
      age: Math.random() * 200,
      part: null,
      lx: 0,
      ly: 0,
      la: 0,
      dmgScale,
      trail,
      hist: [],
      histT: 0,
      glintAt: 0,
      bounced: false,
      onFloor: false,
      flown: 0,
    };
    this.projectiles.push(pr);
    this.draw(pr, 0);
  }

  /** mano/polso che scocca dal punto di lancio: rilascio + accompagnamento */
  private playHand(ox: number, oy: number, angle: number): void {
    const k = dirIndex(angle, 8);
    const a = (k * Math.PI) / 4;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    // la mano sta dietro al punto di lancio, poi segue il lancio di 3px
    this.fx.play(
      { x: ox, y: oy },
      [
        { key: `fx-hand-${k}-0`, ms: ANIM_MELEE.handReleaseMs, x: -ux * 4, y: -uy * 4 },
        { key: `fx-hand-${k}-1`, ms: ANIM_MELEE.handFollowMs, x: -ux * 1, y: -uy * 1 },
      ],
      { depth: 18 },
    );
  }

  // ---------------------------------------------------------------- simulazione

  /** Avanza un proiettile; false = da rimuovere. */
  private step(pr: Projectile, steps: number): boolean {
    switch (pr.state) {
      case 'fly':
        return this.stepFly(pr, steps);
      case 'stuck':
        return this.stepStuck(pr);
      case 'wall':
        this.maybeGlint(pr);
        if (pr.t >= THROWN.wallStickMs) {
          if (pr.onFloor) this.setState(pr, 'blink');
          else this.startFall(pr, 0, 0);
        }
        return true;
      case 'fall':
        return this.stepFall(pr, steps);
      case 'blink':
        pr.img.setVisible(Math.floor(pr.t / THROWN.blinkFlashMs) % 2 === 0);
        return pr.t < THROWN.blinkMs;
    }
  }

  private stepFly(pr: Projectile, steps: number): boolean {
    const s = this.stats;
    const dist = s.speed * steps;
    const n = Math.max(1, Math.ceil(dist / THROWN.subStepPx));
    const d = dist / n;
    const reach = this.tipReach();
    const { ragdoll } = this.ctx;
    pr.angle += this.flightSpin() * steps * (pr.dx < 0 ? -1 : 1);
    pr.flown += dist;
    for (let i = 0; i < n; i++) {
      pr.x += pr.dx * d;
      pr.y += pr.dy * d;

      const hit = ragdoll.partAt(pr.x + pr.dx * reach, pr.y + pr.dy * reach, THROWN.hitTolerance);
      if (hit) {
        this.stickInto(pr, hit.part);
        return true;
      }

      if (pr.x <= ROOM_INNER.left || pr.x >= ROOM_INNER.right || pr.y <= ROOM_INNER.top) {
        pr.x = Phaser.Math.Clamp(pr.x, ROOM_INNER.left + 1, ROOM_INNER.right - 1);
        pr.y = Math.max(pr.y, ROOM_INNER.top + 1);
        this.stickWall(pr, false);
        return true;
      }
      if (pr.y >= ROOM_INNER.bottom) {
        pr.y = ROOM_INNER.bottom - 2;
        this.stickWall(pr, true);
        return true;
      }
    }
    if (pr.age >= THROWN.maxFlightMs) this.startFall(pr, pr.dx, pr.dy);
    return true;
  }

  private stickWall(pr: Projectile, floor: boolean): void {
    pr.angle = this.stuckAngle(pr.age, pr.dx, pr.dy);
    pr.onFloor = floor;
    this.setState(pr, 'wall');
    this.playTink();
    this.spark(pr.x + pr.dx * this.tipReach(), pr.y + pr.dy * this.tipReach(), pr.dx, pr.dy);
  }

  private spark(x: number, y: number, dx: number, dy: number): void {
    const ms = ANIM_MELEE.sparkFrameMs;
    this.fx.play({ x, y }, [
      { key: 'fx-spark-0', ms, fill: C.white },
      { key: 'fx-spark-0', ms },
      { key: 'fx-spark-1', ms },
    ]);
    spawnParticles(this.ctx.scene, x, y, {
      count: 4,
      colors: [C.white, C.yellow, C.yellow],
      speed: 2.6,
      angle: Math.atan2(-dy, -dx),
      spread: 1.8,
      size: 1,
      lifeMs: 220,
      gravity: 0.15,
    });
  }

  private stickInto(pr: Projectile, part: Part): void {
    const s = this.stats;
    const { ragdoll } = this.ctx;
    const reach = this.tipReach();
    const hx = pr.x + pr.dx * reach;
    const hy = pr.y + pr.dy * reach;

    const imp = s.impulse * (0.6 + 0.4 * pr.dmgScale);
    ragdoll.applyImpulse(part, hx, hy, pr.dx * imp, pr.dy * imp);
    this.hit({ part: part.name, x: hx, y: hy, amount: s.damage * pr.dmgScale, weaponId: this.id });
    this.playThunk();
    this.spark(hx, hy, pr.dx, pr.dy);
    this.onStick(hx, hy, pr.dx, pr.dy);

    // entra un poco nella parte, poi memorizza la posa nel sistema locale del corpo
    pr.x += pr.dx * THROWN.embedPx;
    pr.y += pr.dy * THROWN.embedPx;
    pr.angle = this.stuckAngle(pr.age, pr.dx, pr.dy);
    const b = part.body;
    const ox = pr.x - b.position.x;
    const oy = pr.y - b.position.y;
    const c = Math.cos(-b.angle);
    const sn = Math.sin(-b.angle);
    pr.lx = ox * c - oy * sn;
    pr.ly = ox * sn + oy * c;
    pr.la = pr.angle - b.angle;
    pr.part = part;
    this.setState(pr, 'stuck');
  }

  private stepStuck(pr: Projectile): boolean {
    const part = pr.part;
    if (!part || !part.body) {
      this.startFall(pr, 0, 0);
      return true;
    }
    const b = part.body;
    const c = Math.cos(b.angle);
    const sn = Math.sin(b.angle);
    pr.x = b.position.x + pr.lx * c - pr.ly * sn;
    pr.y = b.position.y + pr.lx * sn + pr.ly * c;
    pr.angle = b.angle + pr.la;
    this.maybeGlint(pr);
    if (pr.t >= this.stats.stickMs) {
      this.startFall(pr, b.velocity.x, b.velocity.y);
    }
    return true;
  }

  private maybeGlint(pr: Projectile): void {
    if (pr.t < pr.glintAt) return;
    pr.glintAt = pr.t + Phaser.Math.Between(ANIM_MELEE.glintMinMs, ANIM_MELEE.glintMaxMs);
    const o = this.glintOffset(pr.angle);
    const ms = ANIM_MELEE.glintFrameMs;
    this.fx.play(
      { x: Math.round(pr.x + o.x), y: Math.round(pr.y + o.y) },
      [
        { key: 'fx-glint-1', ms },
        { key: 'fx-glint-0', ms },
        { key: 'fx-glint-1', ms },
      ],
      { depth: 18 },
    );
  }

  private startFall(pr: Projectile, vx: number, vy: number): void {
    const sp = Math.hypot(vx, vy);
    const k = sp > THROWN.fallMaxSpeed ? THROWN.fallMaxSpeed / sp : 1;
    pr.vx = vx * k;
    pr.vy = vy * k;
    pr.part = null;
    this.hideTrail(pr);
    this.setState(pr, 'fall');
  }

  private stepFall(pr: Projectile, steps: number): boolean {
    pr.vy += THROWN.fallGravity * steps;
    pr.x += pr.vx * steps;
    pr.y += pr.vy * steps;
    pr.angle += THROWN.fallSpin * steps * (pr.vx < 0 ? -1 : 1);
    if (pr.x < ROOM_INNER.left + 2 || pr.x > ROOM_INNER.right - 2) {
      pr.x = Phaser.Math.Clamp(pr.x, ROOM_INNER.left + 2, ROOM_INNER.right - 2);
      pr.vx = -pr.vx * THROWN.fallWallBounce;
    }
    if (pr.y >= ROOM_INNER.bottom - 2) {
      pr.y = ROOM_INNER.bottom - 2;
      if (!pr.bounced && pr.vy > 0.8) {
        // un rimbalzo con "clink", poi a terra
        pr.bounced = true;
        pr.vy = -Math.max(ANIM_MELEE.floorBounceMinVy, pr.vy * ANIM_MELEE.floorBounce);
        pr.vx = pr.vx * 0.6 + (pr.vx === 0 ? (Math.random() < 0.5 ? -0.6 : 0.6) : 0);
        this.playClink();
        spawnParticles(this.ctx.scene, pr.x, pr.y + 1, {
          count: 3,
          colors: [C.white, C.yellow],
          speed: 1.6,
          angle: -Math.PI / 2,
          spread: 2.2,
          size: 1,
          lifeMs: 180,
          gravity: 0.15,
        });
        return true;
      }
      // a terra: appoggiato (sprite dritto) e poi lampeggia
      pr.angle = Math.round(pr.angle / Math.PI) * Math.PI;
      this.playClink(0.5);
      this.setState(pr, 'blink');
    }
    return true;
  }

  private setState(pr: Projectile, state: ProjState): void {
    pr.state = state;
    pr.t = 0;
    pr.glintAt = Phaser.Math.Between(ANIM_MELEE.glintMinMs / 2, ANIM_MELEE.glintMaxMs / 2);
    if (state !== 'fly') this.hideTrail(pr);
  }

  private draw(pr: Projectile, dt: number): void {
    const spinning = (pr.state === 'fly' && this.spinsInFlight) || pr.state === 'fall';
    let ox = 0;
    let oy = 0;
    let wobble: -1 | 0 | 1 = 0;
    if (pr.state === 'stuck' || pr.state === 'wall') {
      const vf = this.vibFrames[Math.floor(pr.t / ANIM_MELEE.vibFrameMs)];
      if (vf) {
        // perpendicolare alla direzione d'arrivo, a pixel interi
        ox = Math.round(-pr.dy * vf.perp);
        oy = Math.round(pr.dx * vf.perp);
        wobble = vf.wobble;
      }
    }
    const f = this.frameFor(pr.angle, pr.age, spinning, wobble);
    if (pr.img.texture.key !== f.key) pr.img.setTexture(f.key);
    pr.img.setRotation(f.rotation);
    const rx = Math.round(pr.x) + ox;
    const ry = Math.round(pr.y) + oy;
    pr.img.setPosition(rx, ry);

    if (pr.state !== 'fly') return;
    // scia: campioni a intervalli fissi di tempo di gioco
    pr.histT += dt;
    if (pr.hist.length === 0 || pr.histT >= ANIM_MELEE.trailEveryMs) {
      pr.histT = pr.hist.length === 0 ? 0 : pr.histT % ANIM_MELEE.trailEveryMs;
      const sample = pr.hist.length >= pr.trail.length + 1 ? (pr.hist.pop() as TrailSample) : { x: 0, y: 0, key: '' };
      sample.x = rx;
      sample.y = ry;
      sample.key = f.key;
      pr.hist.unshift(sample);
    }
    // copie a distanza fissa dietro al proiettile, con i frame di rotazione passati
    const gap = ANIM_MELEE.trailGapPx;
    for (let i = 0; i < pr.trail.length; i++) {
      const t = pr.trail[i];
      const back = gap * (i + 1);
      if (pr.flown < back) {
        t.setVisible(false);
        continue;
      }
      const key = (pr.hist[i + 1] ?? pr.hist[pr.hist.length - 1]).key;
      if (t.texture.key !== key) t.setTexture(key);
      t.setRotation(f.rotation)
        .setPosition(Math.round(pr.x - pr.dx * back), Math.round(pr.y - pr.dy * back))
        .setVisible(true);
    }
  }

  private hideTrail(pr: Projectile): void {
    for (const t of pr.trail) releaseImage(t);
    pr.trail.length = 0;
    pr.hist.length = 0;
  }

  private releaseProjectile(pr: Projectile): void {
    this.hideTrail(pr);
    releaseImage(pr.img);
  }

  private clearAll(): void {
    for (const pr of this.projectiles) this.releaseProjectile(pr);
    this.projectiles.length = 0;
    this.fxActors?.clear();
  }

  // ---------------------------------------------------------------- suoni comuni

  /** "tunk" sordo quando si conficca nella stoffa */
  protected playThunk(): void {
    tone({ type: 'square', from: 320, to: 110, dur: 0.05, vol: 0.12 });
  }

  /** "tink" metallico contro muro/soffitto */
  protected playTink(): void {
    tone({ type: 'square', from: 1800, to: 1500, dur: 0.05, vol: 0.08 });
    noise({ dur: 0.03, vol: 0.1, freq: 3000, highpass: true });
  }

  /** "clink" sul pavimento */
  protected playClink(vol = 1): void {
    tone({ type: 'square', from: 2600, to: 2300, dur: 0.035, vol: 0.06 * vol });
    tone({ type: 'triangle', from: 1900, to: 1700, dur: 0.06, vol: 0.07 * vol, delay: 0.035 });
  }
}

const SINGLE: readonly { off: number; dmg: number }[] = [{ off: 0, dmg: 1 }];

// ---------------------------------------------------------------- mano del lancio

/** mano da ninja (fasciatura chiara, polsino rosso, manica scura) che punta lungo +u */
function handShape(open: boolean): ShapeFn {
  return (u, v) => {
    if (open) {
      // dita aperte in avanti dopo il rilascio: tre strisce separate
      if (u > 1.8 && u < 7.2) {
        for (const [fv, len] of [[-2.2, 6.4], [-0.2, 7.2], [1.8, 5.6]] as const) {
          if (Math.abs(v - fv) < 0.75 && u < len) return fv < -1 ? 'c' : 'd';
        }
      }
    } else if (u > 1.5 && u < 4.6 && v > -2.9 && v < 2.6) {
      // pugno chiuso che scocca: nocche
      return v < -1.6 ? 'c' : Math.round(v) === 0 && u > 3.6 ? 'e' : 'd';
    }
    if ((u / 3.1) ** 2 + (v / 3.2) ** 2 <= 1) return v < -1.4 ? 'c' : v > 1.6 ? 'e' : 'd';
    if (u > -12 && u <= -1.8 && Math.abs(v) <= 1.9) {
      if (u > -3.6) return '2'; // polsino
      return v < -0.8 ? 'e' : 'f'; // manica
    }
    return null;
  };
}

function makeHandTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists('fx-hand-0-0')) return;
  const sprites: Record<string, SpriteData> = {};
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    sprites[`fx-hand-${k}-0`] = rasterSprite(HAND_SIZE, HAND_SIZE, a, handShape(false));
    sprites[`fx-hand-${k}-1`] = rasterSprite(HAND_SIZE, HAND_SIZE, a, handShape(true));
  }
  makeSprites(scene, sprites);
}

// ============================================================================
// Shuriken: veloce, danno basso, cooldown breve. Ruota a scatti in volo.
// ============================================================================

type ShurikenStats = (typeof WEAPON_STATS)['shuriken'];

/** stella a 4 punte dritta (+): icona */
const SHURIKEN_ICON: SpriteData = [
  '...00...',
  '..0cd0..',
  '.00cd00.',
  '0cc00dd0',
  '0dd00ee0',
  '.00de00.',
  '..0de0..',
  '...00...',
];

const STAR_SIZE = 11;
/** frame di rotazione su 90° (simmetria a 4 punte): 22,5° a frame */
const STAR_FRAMES = 4;

/** stella a 4 lame "a girandola": filo chiaro davanti, dorso scuro dietro */
const starShape: ShapeFn = (u, v) => {
  const r = Math.hypot(u, v);
  if (r < 0.75) return null; // foro centrale (diventa contorno scuro)
  if (r < 2) return 'e';
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2;
    const s = u * Math.cos(a) + v * Math.sin(a);
    const t = -u * Math.sin(a) + v * Math.cos(a);
    if (s < 0 || s > 4.6) continue;
    const wf = 1.9 * (1 - s / 4.6);
    if (t >= -wf * 0.55 && t <= wf + 0.35) return t > wf * 0.35 ? 'c' : t < -0.1 ? 'e' : 'd';
  }
  return null;
};

export class Shuriken extends ThrownWeapon<ShurikenStats> {
  readonly id = 'shuriken';
  readonly name = 'SHURIKEN';
  readonly icon = SHURIKEN_ICON;
  protected readonly spinsInFlight = true;
  /** conficcato: 2 frame di vibrazione laterale */
  protected readonly vibFrames: readonly VibFrame[] = [
    { perp: 1, wobble: 0 },
    { perp: -1, wobble: 0 },
  ];
  private lastTapAt = -1e9;
  private lastTapX = 0;
  private lastTapY = 0;
  private fanStreak = 0;

  protected makeTextures(): void {
    if (this.ctx.scene.textures.exists('fx-shuri-0')) return;
    const sprites: Record<string, SpriteData> = {};
    for (let k = 0; k < STAR_FRAMES; k++) {
      sprites[`fx-shuri-${k}`] = rasterSprite(STAR_SIZE, STAR_SIZE, (k * Math.PI) / 8, starShape);
    }
    makeSprites(this.ctx.scene, sprites);
  }

  protected frameFor(angle: number, age: number, spinning: boolean): { key: string; rotation: number } {
    if (spinning) {
      // rotazione a scatti: 22,5° a frame
      const f = Math.floor(age / ANIM_MELEE.shurikenSpinMs) % STAR_FRAMES;
      return { key: `fx-shuri-${f}`, rotation: 0 };
    }
    return { key: `fx-shuri-${dirIndex(angle, 16) % STAR_FRAMES}`, rotation: 0 };
  }

  protected stuckAngle(age: number): number {
    // resta sul frame di rotazione in cui si è conficcato
    return ((Math.floor(age / ANIM_MELEE.shurikenSpinMs) % STAR_FRAMES) * Math.PI) / 8;
  }

  protected glintOffset(): { x: number; y: number } {
    return Math.random() < 0.5 ? { x: -3, y: -2 } : { x: 2, y: -3 };
  }

  protected onStick(x: number, y: number, dx: number, dy: number): void {
    // due fiocchi d'imbottitura (Tony è di pezza)
    spawnParticles(this.ctx.scene, x, y, {
      count: 2,
      colors: [C.white],
      speed: 1.4,
      angle: Math.atan2(-dy, -dx),
      spread: 1.6,
      size: 1,
      lifeMs: 300,
      gravity: 0.08,
    });
  }

  /** tap rapidi e vicini al precedente: ventaglio di 2-3 stelle */
  protected volley(p: WeaponPointer): readonly { off: number; dmg: number }[] {
    const A = ANIM_MELEE;
    const near = p.time - this.lastTapAt <= A.fanWindowMs && Math.hypot(p.x - this.lastTapX, p.y - this.lastTapY) <= A.fanRadiusPx;
    this.fanStreak = near ? this.fanStreak + 1 : 0;
    this.lastTapAt = p.time;
    this.lastTapX = p.x;
    this.lastTapY = p.y;
    const n = Math.min(A.fanMax, 1 + this.fanStreak);
    if (n <= 1) return FAN[0];
    return FAN[n - 1] ?? FAN[FAN.length - 1];
  }

  protected playSwish(): void {
    noise({ dur: 0.07, vol: 0.14, freq: 1500, freqTo: 6000, highpass: true });
    tone({ type: 'square', from: 1600, to: 2400, dur: 0.035, vol: 0.04 });
  }

  protected playThunk(): void {
    tone({ type: 'square', from: 360, to: 120, dur: 0.05, vol: 0.12 });
    tone({ type: 'square', from: 2200, to: 1900, dur: 0.03, vol: 0.05 });
  }
}

const S = ANIM_MELEE.fanSpread;
const D = ANIM_MELEE.fanSideDamage;
const FAN: readonly (readonly { off: number; dmg: number }[])[] = [
  [{ off: 0, dmg: 1 }],
  [
    { off: -S / 2, dmg: 1 },
    { off: S / 2, dmg: D },
  ],
  [
    { off: 0, dmg: 1 },
    { off: -S, dmg: D },
    { off: S, dmg: D },
  ],
];
