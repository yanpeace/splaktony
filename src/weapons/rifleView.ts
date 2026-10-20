import Phaser from 'phaser';
import { FIREARMS, PHYSICS, RIFLES, ROOM_INNER, type WeaponStats } from '../config/balance';
import { C, col, type ColorIndex } from '../config/palette';
import { acquireImage, isFrozen, popFrames, releaseImage, spawnParticles } from '../gfx/effects';
import { makeSprites, type SpriteData } from '../gfx/pixelSprite';
import type { Part, Ragdoll } from '../entities/Ragdoll';
import { BulletHoles, ensureFirearmSprites, FLASH_FRAMES } from './Pistola';
import { Weapon, type WeaponPointer } from './Weapon';

/*
 * Helper comune dei fucili (doppietta, fucile d'assalto, cecchino, RPG):
 *  - PixelGrid: disegno degli sprite con rettangoli/trapezi + contorno automatico
 *  - RifleView: arma impugnata in basso (viewmodel), 9 pose inclinate verso il dito,
 *    rinculo, frame di ricarica, posizione della volata
 *  - Tracers / Debris / Puffs: traccianti, bossoli e fumo da pool con tetto
 *  - RifleWeapon: base con grilletto tenuto premuto e pulizia su deactivate()
 */

const R = RIFLES;

// ==================================================================== disegno

/** Griglia di pixel (caratteri palette) con primitive semplici. */
export class PixelGrid {
  readonly cells: string[][];

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.cells = Array.from({ length: h }, () => Array<string>(w).fill('.'));
  }

  set(x: number, y: number, c: string): this {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.cells[y][x] = c;
    return this;
  }

  get(x: number, y: number): string {
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.cells[y][x] : '.';
  }

  rect(x: number, y: number, w: number, h: number, c: string): this {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c);
    return this;
  }

  /**
   * Trapezio verticale dalle righe y0..y1 (incluse), centrato in cx, con
   * mezza larghezza da h0 (in alto) a h1 (in basso). Colonne di bordo opzionali.
   */
  trap(y0: number, y1: number, cx: number, h0: number, h1: number, c: string, left?: string, right?: string): this {
    for (let y = y0; y <= y1; y++) {
      const k = y1 === y0 ? 0 : (y - y0) / (y1 - y0);
      const half = h0 + (h1 - h0) * k;
      const xl = Math.round(cx - half);
      const xr = Math.round(cx + half) - 1;
      for (let x = xl; x <= xr; x++) this.set(x, y, c);
      if (left && xr > xl) this.set(xl, y, left);
      if (right && xr > xl) this.set(xr, y, right);
    }
    return this;
  }

  /** Contorno di 1px (4 vicini) attorno a tutto ciò che è disegnato. */
  outline(c = '0'): this {
    const filled = this.cells.map((r) => r.map((ch) => ch !== '.'));
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (filled[y][x]) continue;
        const near =
          (x > 0 && filled[y][x - 1]) ||
          (x < this.w - 1 && filled[y][x + 1]) ||
          (y > 0 && filled[y - 1][x]) ||
          (y < this.h - 1 && filled[y + 1][x]);
        if (near) this.cells[y][x] = c;
      }
    }
    return this;
  }

  sprite(): SpriteData {
    return this.cells.map((r) => r.join(''));
  }
}

/** Guanto (charcoal con nocche chiare), largo w e alto h. */
export function glove(g: PixelGrid, x: number, y: number, w: number, h: number): void {
  g.rect(x, y, w, h, 'f');
  for (let i = 0; i < w; i += 2) g.set(x + i, y, 'e');
  g.set(x, y + h - 1, '0');
}

/**
 * Pose inclinate: ogni riga viene spostata in orizzontale in proporzione
 * all'altezza (la base resta ferma), così la canna "punta" verso il dito.
 */
function shear(base: SpriteData, shift: number, margin: number): SpriteData {
  const h = base.length;
  const pad = '.'.repeat(margin);
  return base.map((row, r) => {
    const s = h > 1 ? Math.round((shift * (h - 1 - r)) / (h - 1)) : 0;
    const line = pad + row + pad;
    if (s === 0) return line;
    return s > 0 ? '.'.repeat(s) + line.slice(0, line.length - s) : line.slice(-s) + '.'.repeat(-s);
  });
}

/** Righe di un'arma dritta: la volata è in alto. */
export interface ViewSpec {
  /** prefisso delle texture */
  key: string;
  base: SpriteData;
  /** volata nella base (colonna, riga) */
  muzzle: { x: number; y: number };
  /** finestra di espulsione nella base */
  eject: { x: number; y: number };
  /** frame dritti extra (ricarica...), stessa dimensione della base */
  frames?: Record<string, SpriteData>;
}

// ==================================================================== viewmodel

/**
 * Arma impugnata disegnata in basso a destra, sopra la fascia HUD.
 * Si orienta verso la mira (9 pose), rincula e può mostrare un frame fisso.
 */
export class RifleView {
  readonly img: Phaser.GameObjects.Image;
  private readonly w: number;
  private readonly h: number;
  private readonly margin = R.viewMaxShear;
  private readonly shifts: number[] = [];
  private shift = 0;
  private baseX: number = R.viewHomeX;
  private aimX: number = R.viewHomeX;
  private aimY = 160;
  private targetX: number = R.viewHomeX;
  private targetY = 160;
  private kick = 0;
  /** +1 = arma a destra del bersaglio, -1 = a sinistra */
  private side = 1;
  private frame: string | null = null;
  private frameDx = 0;
  private frameDy = 0;
  private x = 0;
  private y = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly spec: ViewSpec,
  ) {
    this.w = spec.base[0].length;
    this.h = spec.base.length;
    const sprites: Record<string, SpriteData> = {};
    for (let s = -R.viewMaxShear; s <= R.viewMaxShear; s += R.viewShearStep) {
      this.shifts.push(s);
      sprites[this.poseKey(s)] = shear(spec.base, s, this.margin);
    }
    for (const [k, rows] of Object.entries(spec.frames ?? {})) sprites[`${spec.key}-${k}`] = shear(rows, 0, this.margin);
    makeSprites(scene, sprites);
    this.img = acquireImage(scene, 0, 0, this.poseKey(0)).setOrigin(0, 1).setDepth(R.viewDepth);
    this.update(0);
  }

  private poseKey(s: number): string {
    return `${this.spec.key}-p${s}`;
  }

  /** Punto verso cui l'arma si orienta (coordinate mondo). */
  setAim(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
  }

  /** Rinculo: l'arma scende di px e torna su da sola. */
  kickBack(px: number): void {
    this.kick = Math.max(this.kick, px);
  }

  /** Frame fisso (ricarica, otturatore...) con spostamento; null = pose normali. */
  setFrame(name: string | null, dx = 0, dy = 0): void {
    this.frame = name ? `${this.spec.key}-${name}` : null;
    this.frameDx = dx;
    this.frameDy = dy;
  }

  setVisible(v: boolean): void {
    this.img.setVisible(v);
  }

  update(dtMs: number): void {
    const steps = dtMs / PHYSICS.stepMs;
    const k = 1 - Math.pow(1 - R.viewAimLerp, steps);
    this.aimX += (this.targetX - this.aimX) * k;
    this.aimY += (this.targetY - this.aimY) * k;
    this.kick = Math.max(0, this.kick - R.viewRecoverPx * steps);

    // l'arma sta di lato rispetto al bersaglio (non copre Tony), con isteresi sul lato
    const mid = (R.viewMinX + R.viewMaxX) / 2;
    if (this.aimX < mid - R.viewSideHysteresis) this.side = 1;
    else if (this.aimX > mid + R.viewSideHysteresis) this.side = -1;
    const wantX = Phaser.Math.Clamp(this.aimX + this.side * R.viewSideOffset, R.viewMinX, R.viewMaxX);
    this.baseX += (wantX - this.baseX) * (1 - Math.pow(1 - R.viewSlideLerp, steps));
    // inclinazione: pendenza dalla base verso la mira, a scatti di viewShearStep
    const dy = Math.max(8, R.viewBaseY - this.aimY);
    const slope = (this.aimX - this.baseX) / dy;
    const raw = Phaser.Math.Clamp(slope * (this.h - 1), -R.viewMaxShear, R.viewMaxShear);
    this.shift = this.frame ? 0 : Math.round(raw / R.viewShearStep) * R.viewShearStep;

    const bob = Math.round(Math.sin((this.scene.time.now / R.viewBobMs) * Math.PI * 2) * R.viewBobPx * 0.5 + 0.5);
    this.x = Math.round(this.baseX) - this.margin - Math.floor(this.w / 2) + (this.frame ? this.frameDx : 0);
    this.y = R.viewBaseY + Math.round(this.kick) + bob + (this.frame ? this.frameDy : 0);
    this.img.setTexture(this.frame ?? this.poseKey(this.shift));
    this.img.setPosition(this.x, this.y);
  }

  private rowShift(r: number): number {
    return this.h > 1 ? Math.round((this.shift * (this.h - 1 - r)) / (this.h - 1)) : 0;
  }

  /** Punto della base (colonna, riga) in coordinate mondo, con l'inclinazione attuale. */
  point(px: number, py: number): { x: number; y: number } {
    return { x: this.x + this.margin + px + this.rowShift(py), y: this.y - this.h + py };
  }

  muzzle(): { x: number; y: number } {
    return this.point(this.spec.muzzle.x, this.spec.muzzle.y);
  }

  ejectPort(): { x: number; y: number } {
    return this.point(this.spec.eject.x, this.spec.eject.y);
  }

  destroy(): void {
    releaseImage(this.img);
  }
}

// ==================================================================== traccianti

interface Tracer {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  born: number;
  core: ColorIndex;
}

/** Traccianti: segmenti pixel (Bresenham) che durano pochi frame. */
export class Tracers {
  private list: Tracer[] = [];
  private gfx: Phaser.GameObjects.Graphics;

  constructor(private readonly scene: Phaser.Scene) {
    this.gfx = scene.add.graphics().setDepth(R.tracerDepth);
  }

  add(x0: number, y0: number, x1: number, y1: number, core: ColorIndex = C.yellow): void {
    if (this.list.length >= R.maxTracers) this.list.shift();
    this.list.push({ x0: Math.round(x0), y0: Math.round(y0), x1: Math.round(x1), y1: Math.round(y1), born: this.scene.time.now, core });
  }

  update(): void {
    const g = this.gfx;
    g.clear();
    if (this.list.length === 0) return;
    const now = this.scene.time.now;
    let w = 0;
    for (const t of this.list) {
      const k = (now - t.born) / R.tracerMs;
      if (k >= 1) continue;
      this.list[w++] = t;
      // prima metà: linea piena col nucleo bianco verso la fine; poi solo la coda arancio tratteggiata
      if (k < 0.5) {
        line(g, t, 0, 1, 1, col(t.core));
        line(g, t, 0.6, 1, 1, col(C.white));
      } else {
        line(g, t, 0.5, 1, 2, col(C.orange));
      }
    }
    this.list.length = w;
  }

  clear(): void {
    this.list = [];
    this.gfx.clear();
  }

  destroy(): void {
    this.gfx.destroy();
  }
}

/** Disegna il tratto [a, b] (0..1) del segmento, un pixel ogni `every`. */
function line(g: Phaser.GameObjects.Graphics, t: Tracer, a: number, b: number, every: number, color: number): void {
  g.fillStyle(color);
  const dx = t.x1 - t.x0;
  const dy = t.y1 - t.y0;
  const n = Math.max(Math.abs(dx), Math.abs(dy));
  if (n === 0) return;
  const i0 = Math.floor(n * a);
  const i1 = Math.floor(n * b);
  for (let i = i0; i <= i1; i += every) {
    g.fillRect(Math.round(t.x0 + (dx * i) / n), Math.round(t.y0 + (dy * i) / n), 1, 1);
  }
}

// ==================================================================== detriti

interface Bit {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
  keys: readonly string[];
  frame: number;
  spinAt: number;
  restAt: number;
}

/** Bossoli, cartucce e caricatori: gravità, rimbalzo sul pavimento, sosta, lampeggio. */
export class Debris {
  private list: Bit[] = [];
  private lastTinkAt = -1e9;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly tink: (speed: number) => void,
  ) {}

  /** keys = frame della rotazione a scatti (il primo è quello "a terra"). */
  spawn(x: number, y: number, vx: number, vy: number, keys: readonly string[]): void {
    if (this.list.length >= R.maxDebris) releaseImage(this.list.shift()?.img);
    const img = acquireImage(this.scene, x, y, keys[0]).setDepth(R.debrisDepth);
    this.list.push({ img, x, y, vx, vy, keys, frame: 0, spinAt: this.scene.time.now, restAt: -1 });
  }

  update(dtMs: number): void {
    const now = this.scene.time.now;
    const frozen = isFrozen(this.scene);
    const steps = dtMs / PHYSICS.stepMs;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      if (b.restAt < 0) {
        if (!frozen) this.fly(b, steps, now);
      } else {
        const age = now - b.restAt;
        if (age >= R.debrisRestMs + R.debrisBlinkMs) {
          releaseImage(b.img);
          this.list.splice(i, 1);
          continue;
        }
        if (age > R.debrisRestMs) b.img.setVisible(Math.floor((age - R.debrisRestMs) / R.debrisBlinkStepMs) % 2 === 1);
      }
      b.img.setPosition(Math.round(b.x), Math.round(b.y));
    }
  }

  private fly(b: Bit, steps: number, now: number): void {
    b.vy += R.debrisGravity * steps;
    b.x += b.vx * steps;
    b.y += b.vy * steps;
    if (b.keys.length > 1 && now - b.spinAt >= R.debrisSpinMs) {
      b.spinAt = now;
      b.frame = (b.frame + 1) % b.keys.length;
      b.img.setTexture(b.keys[b.frame]);
    }
    const half = Math.ceil(b.img.width / 2);
    if (b.x < ROOM_INNER.left + half) {
      b.x = ROOM_INNER.left + half;
      b.vx = Math.abs(b.vx) * R.debrisBounce;
    } else if (b.x > ROOM_INNER.right - half) {
      b.x = ROOM_INNER.right - half;
      b.vx = -Math.abs(b.vx) * R.debrisBounce;
    }
    const floorY = ROOM_INNER.bottom - Math.ceil(b.img.height / 2);
    if (b.y >= floorY && b.vy > 0) {
      b.y = floorY;
      b.vx *= R.debrisFriction;
      if (b.vy < R.debrisStopSpeed) {
        b.frame = 0;
        b.img.setTexture(b.keys[0]);
        b.y = ROOM_INNER.bottom - Math.ceil(b.img.height / 2);
        b.vx = 0;
        b.vy = 0;
        b.restAt = now;
      } else {
        if (now - this.lastTinkAt > 60) {
          this.lastTinkAt = now;
          this.tink(b.vy);
        }
        b.vy = -b.vy * R.debrisBounce;
      }
    }
  }

  clear(): void {
    this.list.forEach((b) => releaseImage(b.img));
    this.list = [];
  }

  get count(): number {
    return this.list.length;
  }
}

// ==================================================================== fumo

const PUFF_A: SpriteData = ['.dd.', 'dddd', 'ddde', '.ee.'];
const PUFF_B: SpriteData = ['.e.', 'eee', '.f.'];
const PUFF_C: SpriteData = ['f.', '.f'];
const PUFF_BIG: SpriteData = ['..dd..', '.dddd.', 'ddddde', 'dddeee', '.deee.', '..ee..'];
export const PUFF_KEYS = ['fx-rpuff-big', 'fx-rpuff-a', 'fx-rpuff-b', 'fx-rpuff-c'] as const;

interface Puff {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  /** primo frame usato (0 = grande, 1 = medio) */
  first: number;
}

/** Sbuffi di fumo grigio che salgono, rimpiccioliscono e lampeggiano. */
export class Puffs {
  private list: Puff[] = [];

  constructor(private readonly scene: Phaser.Scene) {
    makeSprites(scene, {
      'fx-rpuff-big': PUFF_BIG,
      'fx-rpuff-a': PUFF_A,
      'fx-rpuff-b': PUFF_B,
      'fx-rpuff-c': PUFF_C,
    });
  }

  spawn(x: number, y: number, vx = 0, vy = 0, life: number = R.puffMs, big = false): void {
    if (this.list.length >= R.maxPuffs) releaseImage(this.list.shift()?.img);
    const first = big ? 0 : 1;
    const img = acquireImage(this.scene, x, y, PUFF_KEYS[first]).setDepth(R.puffDepth);
    this.list.push({ img, x, y, vx, vy, age: 0, life, first });
  }

  update(dtMs: number): void {
    if (isFrozen(this.scene)) return;
    const steps = dtMs / PHYSICS.stepMs;
    const drag = Math.pow(0.94, steps);
    let w = 0;
    for (const p of this.list) {
      p.age += dtMs;
      if (p.age >= p.life) {
        releaseImage(p.img);
        continue;
      }
      p.vx *= drag;
      p.vy = p.vy * drag - R.puffRise * 0.1 * steps;
      p.x += p.vx * steps;
      p.y += p.vy * steps;
      const k = p.age / p.life;
      const n = PUFF_KEYS.length - p.first;
      p.img.setTexture(PUFF_KEYS[p.first + Math.min(n - 1, Math.floor(k * n))]);
      p.img.setPosition(Math.round(p.x), Math.round(Math.max(ROOM_INNER.top + 2, p.y)));
      p.img.setVisible(k < 0.75 || Math.floor(p.age / 60) % 2 === 0);
      this.list[w++] = p;
    }
    this.list.length = w;
  }

  clear(): void {
    this.list.forEach((p) => releaseImage(p.img));
    this.list = [];
  }

  get count(): number {
    return this.list.length;
  }
}

// ==================================================================== colpi

export interface RifleShot {
  damage: number;
  impulse: number;
  bodyShare: number;
  hitTolerance: number;
}

/** Prima parte di Tony lungo il segmento, col punto d'ingresso (o null). */
export function traceRay(
  ragdoll: Ragdoll,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  tol: number,
): { part: Part; x: number; y: number } | null {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.ceil(len / R.rayStepPx));
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    const x = x0 + (x1 - x0) * k;
    const y = y0 + (y1 - y0) * k;
    const hit = ragdoll.partAt(x, y, tol);
    if (hit) return { part: hit.part, x, y };
  }
  return null;
}

/**
 * Colpo in (x,y) sparato da (fx,fy): spinta nella direzione del colpo e danno
 * sulla parte, scintille; se manca Tony, foro nel muro. `part` forza la parte
 * (già trovata lungo il raggio). `rawMult` moltiplica il danno grezzo.
 */
export function impactAt(
  w: { ragdoll: Ragdoll; holes: BulletHoles; hit: (part: Part, x: number, y: number, amount: number) => void },
  s: RifleShot,
  x: number,
  y: number,
  fx: number,
  fy: number,
  scene: Phaser.Scene,
  part: Part | null = null,
  rawMult = 1,
): Part | null {
  const px = Math.round(x);
  const py = Math.round(y);
  const target = part ?? w.ragdoll.partAt(px, py, s.hitTolerance)?.part ?? null;
  if (!target) {
    if (BulletHoles.inRoom(px, py)) {
      w.holes.add(px, py);
      spawnParticles(scene, px, py, { count: 2, colors: [C.yellow, C.white, C.silver], speed: 1.6, size: 1, lifeMs: 200, gravity: 0.12 });
    }
    return null;
  }
  // spinta come le altre armi da fuoco: dal "giocatore" fuori schermo in basso,
  // allineato con la volata (Tony vola su e di lato invece di schiacciarsi a terra)
  let dx = px - fx;
  let dy = py - Math.max(fy, FIREARMS.originY);
  let len = Math.hypot(dx, dy) || 1;
  dx = dx / len + (Math.random() - 0.5) * 2 * FIREARMS.impulseJitter;
  dy = dy / len;
  len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  w.ragdoll.applyImpulse(target, px, py, dx * s.impulse, dy * s.impulse);
  if (s.bodyShare > 0) w.ragdoll.addVelocity(dx * s.impulse * s.bodyShare, dy * s.impulse * s.bodyShare, target);
  w.hit(target, px, py, s.damage * rawMult);
  spawnParticles(scene, px, py, {
    count: 3,
    colors: [C.yellow, C.white],
    speed: 2,
    angle: Math.atan2(-dy, -dx),
    spread: 1.4,
    size: 1,
    lifeMs: 180,
    gravity: 0,
  });
  return target;
}

// ==================================================================== base

/**
 * Base dei fucili: viewmodel, pool (traccianti, detriti, fumo, fori) e
 * grilletto (un dito alla volta). Niente presa di Tony.
 */
export abstract class RifleWeapon<S extends WeaponStats> extends Weapon<S> {
  override readonly allowsGrab: boolean = false;

  protected view: RifleView | null = null;
  protected tracers: Tracers | null = null;
  protected debris: Debris | null = null;
  protected puffs: Puffs | null = null;
  protected holes: BulletHoles | null = null;
  /** dito che tiene il grilletto (null = nessuno) */
  protected triggerId: number | null = null;
  protected aimX: number = R.viewHomeX;
  protected aimY = 160;

  protected abstract viewSpec(): ViewSpec;
  /** sprite propri (bossoli, razzo...) */
  protected makeOwnSprites(): void {}
  protected onTriggerDown(_p: WeaponPointer): void {}
  protected onTriggerUp(_p: WeaponPointer): void {}
  /** ogni frame, dopo il grilletto e prima dei pool */
  protected tick(_dtMs: number): void {}
  /** pulizia propria della sottoclasse */
  protected cleanup(): void {}

  activate(): void {
    super.activate();
    const scene = this.ctx.scene;
    ensureFirearmSprites(scene);
    this.makeOwnSprites();
    this.holes = new BulletHoles(scene);
    this.tracers = new Tracers(scene);
    this.debris = new Debris(scene, (v) => this.tinkSound(v));
    this.puffs = new Puffs(scene);
    this.view = new RifleView(scene, this.viewSpec());
  }

  deactivate(): void {
    this.triggerId = null;
    this.cleanup();
    this.view?.destroy();
    this.tracers?.destroy();
    this.debris?.clear();
    this.puffs?.clear();
    this.holes?.clear();
    this.view = null;
    this.tracers = null;
    this.debris = null;
    this.puffs = null;
    this.holes = null;
  }

  onPointerDown(p: WeaponPointer): void {
    if (!this.view || this.triggerId !== null) return;
    this.triggerId = p.id;
    this.aimX = p.x;
    this.aimY = p.y;
    this.view.setAim(p.x, p.y);
    this.onTriggerDown(p);
  }

  onPointerMove(p: WeaponPointer): void {
    if (p.id !== this.triggerId) return;
    this.aimX = p.x;
    this.aimY = p.y;
    this.view?.setAim(p.x, p.y);
  }

  onPointerUp(p: WeaponPointer): void {
    if (p.id !== this.triggerId) return;
    this.aimX = p.x;
    this.aimY = p.y;
    this.triggerId = null;
    this.onTriggerUp(p);
  }

  /** true se il dito del grilletto è ancora giù (se è stato perso, rilascia). */
  protected get triggerHeld(): boolean {
    if (this.triggerId === null) return false;
    const id = this.triggerId;
    const ptr = this.ctx.scene.input.manager.pointers.find((q) => q.id === id);
    if (ptr && ptr.isDown) return true;
    this.triggerId = null;
    return false;
  }

  update(dtMs: number): void {
    if (!this.view) return;
    this.tick(dtMs);
    this.view.update(dtMs);
    this.tracers?.update();
    this.debris?.update(dtMs);
    this.puffs?.update(dtMs);
    this.holes?.update();
  }

  /** Vampata e fumo alla volata. */
  protected muzzleFlash(smoke = 2): { x: number; y: number } {
    const m = this.view?.muzzle() ?? { x: this.aimX, y: this.aimY };
    popFrames(this.ctx.scene, m.x, m.y - 2, FLASH_FRAMES, FIREARMS.flashFrameMs, { depth: R.viewDepth + 1 });
    for (let i = 0; i < smoke; i++) this.puffs?.spawn(m.x, m.y - 3, (Math.random() - 0.5) * 0.6, -0.4 - Math.random() * 0.4);
    return m;
  }

  /** Danno attribuito a quest'arma. */
  protected hitPart(part: Part, x: number, y: number, amount: number): void {
    this.hit({ part: part.name, x, y, amount, weaponId: this.id });
  }

  protected get shotCtx(): { ragdoll: Ragdoll; holes: BulletHoles; hit: (part: Part, x: number, y: number, amount: number) => void } | null {
    if (!this.holes) return null;
    return { ragdoll: this.ctx.ragdoll, holes: this.holes, hit: (part, x, y, a) => this.hitPart(part, x, y, a) };
  }

  /** "tin" di un bossolo che rimbalza. */
  protected tinkSound(_speed: number): void {}

  /** Per il debug da console: oggetti vivi nei pool. */
  get debugCounts(): Record<string, number> {
    return {
      holes: this.holes?.count ?? 0,
      debris: this.debris?.count ?? 0,
      puffs: this.puffs?.count ?? 0,
    };
  }
}
