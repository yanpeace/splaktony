import Phaser from 'phaser';
import { EXPLOSIVES, EXPLOSIVE_ANIM, PHYSICS, ROOM_INNER, WEAPON_STATS, type WeaponStats } from '../config/balance';
import { C, col, type ColorIndex } from '../config/palette';
import { noise, playWhoosh, tone } from '../audio/sfx';
import { acquireImage, isFrozen, releaseImage, spawnParticles } from '../gfx/effects';
import { makeSprites, type SpriteData } from '../gfx/pixelSprite';
import { Weapon, type WeaponContext, type WeaponPointer } from './Weapon';
import { bigExplosion, prepareExplosion, tossPiece } from './explosionFx';

/** Campi comuni alle stats di granata e dinamite (vedi WEAPON_STATS). */
export interface ExplosiveStats extends WeaponStats {
  fuseMs: number;
  radius: number;
  pushRadius: number;
  pushStrength: number;
  upBoost: number;
  boomSize: number;
  shakePx: number;
}

/** Un esplosivo in volo (simulazione cinematica, non è un corpo Matter). */
export interface LiveExplosive {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  /** ms di simulazione dal lancio */
  age: number;
  fuseMs: number;
  sprite: Phaser.GameObjects.Image;
  /** oggetti extra della sottoclasse (es. scintilla della miccia), dal pool */
  extra?: Phaser.GameObjects.Image;
  nextFxAt: number;
  nextTrailAt: number;
  /** fase del lampeggio/sfrigolio (per suonare solo sui fronti) */
  phase: number;
}

/** Esplosivo in mano durante la mira (visto dalle sottoclassi). */
export interface AimView {
  x: number;
  y: number;
  sprite: Phaser.GameObjects.Image;
  /** spoletta tolta / miccia accesa (dal primo trascinamento) */
  armed: boolean;
  armedAt: number;
  /** immagini del pool della sottoclasse (spoletta, fiammifero...): rilasciate dalla base */
  extras: Phaser.GameObjects.Image[];
}

interface Aim extends AimView {
  id: number;
  ax: number;
  ay: number;
  px: number;
  py: number;
  hand: Phaser.GameObjects.Image;
}

interface ThrowHand {
  img: Phaser.GameObjects.Image;
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  t0: number;
}

interface Kinematic {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const E = EXPLOSIVES;
const A = EXPLOSIVE_ANIM;
const STEP = PHYSICS.stepMs;

/**
 * Un passo di simulazione: gravità + rimbalzi con attrito contro muri,
 * soffitto e pavimento (ROOM_INNER). Usata sia dagli esplosivi veri sia
 * dall'anteprima della traiettoria, così i puntini coincidono col volo.
 * Ritorna la velocità dell'urto (0 = nessun urto).
 */
function stepKinematic(b: Kinematic, r: number): number {
  b.vy += E.gravity;
  b.x += b.vx;
  b.y += b.vy;
  let impact = 0;
  if (b.x < ROOM_INNER.left + r) {
    b.x = ROOM_INNER.left + r;
    if (b.vx < 0) {
      impact = Math.max(impact, -b.vx);
      b.vx = -b.vx * E.restitution;
      b.vy *= E.wallFriction;
    }
  } else if (b.x > ROOM_INNER.right - r) {
    b.x = ROOM_INNER.right - r;
    if (b.vx > 0) {
      impact = Math.max(impact, b.vx);
      b.vx = -b.vx * E.restitution;
      b.vy *= E.wallFriction;
    }
  }
  if (b.y < ROOM_INNER.top + r) {
    b.y = ROOM_INNER.top + r;
    if (b.vy < 0) {
      impact = Math.max(impact, -b.vy);
      b.vy = -b.vy * E.restitution;
      b.vx *= E.wallFriction;
    }
  } else if (b.y > ROOM_INNER.bottom - r) {
    b.y = ROOM_INNER.bottom - r;
    if (b.vy > 0) {
      if (b.vy > E.minBounce) impact = Math.max(impact, b.vy);
      b.vy = -b.vy * E.restitution;
      if (b.vy > -E.minBounce) b.vy = 0;
    }
    // appoggiato al pavimento: attrito radente
    b.vx *= E.floorFriction;
    if (Math.abs(b.vx) < 0.05) b.vx = 0;
  }
  return impact;
}

function clampToRoom(x: number, y: number, r: number): { x: number; y: number } {
  return {
    x: Phaser.Math.Clamp(x, ROOM_INNER.left + r, ROOM_INNER.right - r),
    y: Phaser.Math.Clamp(y, ROOM_INNER.top + r, ROOM_INNER.bottom - r),
  };
}

/** Guanto del giocatore che stringe l'esplosivo (dietro allo sprite). */
const GLOVE_GRIP: SpriteData = [
  '.00.....00.',
  '0cc0...0cc0',
  '0cd0...0cd0',
  '0cc00000cd0',
  '0cccccccdd0',
  '.0ccccccd0.',
  '..0000000..',
  '..0eeeee0..',
  '..0eddde0..',
  '..0000000..',
];
/** ...e che si apre al lancio. */
const GLOVE_OPEN: SpriteData = [
  '00.......00',
  '0c0.....0d0',
  '.0c0...0d0.',
  '.0cc000cd0.',
  '.0cccccdd0.',
  '..0ccccd0..',
  '..0000000..',
  '..0eeeee0..',
  '..0eddde0..',
  '..0000000..',
];

/**
 * Base comune degli esplosivi lanciati a fionda.
 *
 * Mira "tira indietro" (fionda): al pointerdown l'esplosivo compare sotto il
 * dito, stretto da un guanto; trascinando si tende l'elastico, i puntini
 * scorrono lungo la parabola nella direzione OPPOSTA al trascinamento e un
 * cerchio tratteggiato mostra il raggio del danno dove esploderà davvero
 * (la simulazione è deterministica). Al primo trascinamento la sottoclasse
 * "arma" l'esplosivo (armAim: spoletta tolta / miccia accesa). Al rilascio
 * parte con velocità proporzionale alla tensione (EXPLOSIVES.launchScale, max
 * maxPull px) e il guanto si apre. Un trascinamento più corto di minPull
 * annulla il lancio.
 *
 * L'esplosivo è cinematico (non è un corpo Matter): non urta Tony e non fa
 * danno d'impatto, rimbalza solo sulla stanza. Il danno arriva solo
 * dall'esplosione (this.hit per ogni parte entro stats.radius); la grafica
 * dell'esplosione è bigExplosion() di explosionFx.ts.
 *
 * Cambio arma (deactivate): la mira in corso viene annullata, ma gli
 * esplosivi già lanciati continuano a volare ed esplodono comunque
 * (la simulazione gira su un listener UPDATE proprio, staccato quando
 * l'arma non è attiva e non resta nulla in volo). Allo shutdown della scena
 * tutto viene rilasciato senza esplodere.
 */
export abstract class ThrownExplosive<S extends ExplosiveStats> extends Weapon<S> {
  override readonly allowsGrab: boolean = false;

  private live: LiveExplosive[] = [];
  private aim: Aim | null = null;
  private hands: ThrowHand[] = [];
  private gfx: Phaser.GameObjects.Graphics | null = null;
  private ticking = false;
  private active = false;
  private acc = 0;
  private lastTinkAt = 0;
  /** ms di gioco dell'arma: fermo nell'hit-stop, segue time.timeScale */
  protected clock = 0;

  constructor(ctx: WeaponContext) {
    super(ctx);
    ctx.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroyAll());
  }

  /** Texture dell'esplosivo da mostrare in mira/in volo. */
  protected abstract get idleTexture(): string;
  /** Registra le texture proprie (sprite in volo, scintille...). */
  protected abstract makeOwnSprites(): void;
  /** Aggiorna lo sprite in volo (lampeggio spoletta, miccia...). now = this.clock */
  protected abstract renderFuse(e: LiveExplosive, now: number): void;
  /** Primo trascinamento della mira: spoletta via / fiammifero. */
  protected abstract armAim(a: AimView, now: number): void;
  /** Ogni frame della mira (fiammifero, scintilla...). */
  protected renderAim(_a: AimView, _now: number): void {}
  /** Appena creato lo sprite in mano (es. spoletta attaccata). */
  protected beginAim(_a: AimView): void {}
  /** Ritocchi allo sprite appena creato (es. origine). */
  protected prepareSprite(_img: Phaser.GameObjects.Image): void {}
  /** Il guanto sta sotto lo sprite: px di spostamento verticale. */
  protected get handDy(): number {
    return 0;
  }
  /** Colori della scia in volo. */
  protected get trailColors(): readonly ColorIndex[] {
    return [C.silver, C.slate];
  }
  /** Schegge proprie dell'esplosione (chiavi texture). */
  protected get shrapnelKeys(): readonly string[] {
    return [];
  }

  activate(): void {
    super.activate();
    const scene = this.ctx.scene;
    makeSprites(scene, { 'fx-glove-grip': GLOVE_GRIP, 'fx-glove-open': GLOVE_OPEN });
    prepareExplosion(scene, this.stats.boomSize);
    this.makeOwnSprites();
    this.active = true;
    this.startTicking();
  }

  deactivate(): void {
    this.active = false;
    this.cancelAim();
    this.releaseHands();
    this.gfx?.destroy();
    this.gfx = null;
    if (this.live.length === 0) this.stopTicking();
  }

  // ---------------------------------------------------------------- input

  onPointerDown(p: WeaponPointer): void {
    if (this.aim || !this.active) return;
    const now = this.ctx.scene.time.now;
    if (now - this.lastUseAt < this.stats.cooldownMs) return;
    if (this.live.length >= E.maxLive) return;
    const scene = this.ctx.scene;
    const a = clampToRoom(p.downX, p.downY, E.bodyRadius);
    const x = Math.round(a.x);
    const y = Math.round(a.y);
    const sprite = acquireImage(scene, x, y, this.idleTexture).setDepth(20);
    this.prepareSprite(sprite);
    const hand = acquireImage(scene, x, y + this.handDy, 'fx-glove-grip').setOrigin(0.5, 0).setDepth(19);
    this.aim = { id: p.id, ax: a.x, ay: a.y, px: p.x, py: p.y, x, y, sprite, hand, armed: false, armedAt: 0, extras: [] };
    this.beginAim(this.aim);
  }

  onPointerMove(p: WeaponPointer): void {
    const a = this.aim;
    if (!a || a.id !== p.id) return;
    a.px = p.x;
    a.py = p.y;
    if (!a.armed && Math.hypot(a.px - a.ax, a.py - a.ay) >= E.minPull) {
      a.armed = true;
      a.armedAt = this.clock;
      this.armAim(a, this.clock);
    }
  }

  onPointerUp(p: WeaponPointer): void {
    const aim = this.aim;
    if (!aim || aim.id !== p.id) return;
    aim.px = p.x;
    aim.py = p.y;
    const v = this.launchVelocity();
    this.aim = null;
    this.gfx?.clear();
    if (!v || !this.tryUse(p.time)) {
      this.releaseAim(aim, true);
      return;
    }
    if (!aim.armed) {
      // lancio "di scatto" senza trascinamento visto: arma al volo
      aim.armed = true;
      aim.armedAt = this.clock;
      this.armAim(aim, this.clock);
    }
    // il guanto si apre e accompagna il tiro
    const len = Math.hypot(v.x, v.y) || 1;
    aim.hand.setTexture('fx-glove-open');
    this.hands.push({ img: aim.hand, x0: aim.hand.x, y0: aim.hand.y, dx: v.x / len, dy: v.y / len, t0: this.clock });
    this.releaseAim(aim, false);
    aim.sprite.setPosition(Math.round(aim.ax), Math.round(aim.ay));
    this.live.push({
      x: aim.ax,
      y: aim.ay,
      vx: v.x,
      vy: v.y,
      angle: 0,
      age: 0,
      fuseMs: this.stats.fuseMs,
      sprite: aim.sprite,
      nextFxAt: 0,
      nextTrailAt: 0,
      phase: 0,
    });
    playWhoosh();
    this.startTicking();
  }

  // ---------------------------------------------------------------- simulazione

  private startTicking(): void {
    if (this.ticking) return;
    this.ticking = true;
    this.acc = 0;
    this.ctx.scene.events.on(Phaser.Scenes.Events.UPDATE, this.tick, this);
  }

  private stopTicking(): void {
    if (!this.ticking) return;
    this.ticking = false;
    this.ctx.scene.events.off(Phaser.Scenes.Events.UPDATE, this.tick, this);
  }

  private tick(_time: number, dtRaw: number): void {
    const scene = this.ctx.scene;
    const now = scene.time.now;
    // durante l'hit-stop anche esplosivi e micce restano fermi
    if (!isFrozen(scene)) {
      const dt = dtRaw * scene.time.timeScale;
      this.clock += dt;
      this.acc = Math.min(this.acc + dt, STEP * PHYSICS.maxStepsPerFrame);
      while (this.acc >= STEP) {
        this.acc -= STEP;
        for (let i = this.live.length - 1; i >= 0; i--) {
          const e = this.live[i];
          const impact = stepKinematic(e, E.bodyRadius);
          if (impact > 1.2) this.tink(now, impact);
          const grounded = e.y >= ROOM_INNER.bottom - E.bodyRadius - 0.01 && e.vy === 0;
          // in volo gira col moto orizzontale, a terra "rotola"
          e.angle += grounded ? e.vx / E.bodyRadius : e.vx * E.spinPerSpeed + Math.sign(e.vx) * 0.02;
          e.age += STEP;
          if (e.age >= e.fuseMs) {
            this.live.splice(i, 1);
            this.explode(e);
          }
        }
      }
    }

    const clock = this.clock;
    for (const e of this.live) {
      e.sprite.setPosition(Math.round(e.x), Math.round(e.y));
      e.sprite.setRotation(this.snappedAngle(e));
      // scia: un puntino che resta indietro e lampeggia
      if (clock >= e.nextTrailAt && Math.hypot(e.vx, e.vy) > 0.6) {
        e.nextTrailAt = clock + A.trailEveryMs;
        spawnParticles(scene, e.x, e.y, {
          count: 1,
          colors: this.trailColors,
          speed: 0.15,
          gravity: -0.01,
          lifeMs: A.trailLifeMs,
          size: 1,
          depth: 19,
        });
      }
      this.renderFuse(e, clock);
    }
    this.tickHands(clock);

    if (this.active) this.drawAim(clock);
    else if (this.live.length === 0 && this.hands.length === 0) this.stopTicking();
  }

  private tickHands(clock: number): void {
    let w = 0;
    for (const h of this.hands) {
      const f = Math.floor((clock - h.t0) / A.throwFrameMs);
      if (f >= A.throwFrames || !h.img.active) {
        releaseImage(h.img);
        continue;
      }
      const d = (f + 1) * 2;
      h.img.setPosition(Math.round(h.x0 + h.dx * d), Math.round(h.y0 + h.dy * d));
      this.hands[w++] = h;
    }
    this.hands.length = w;
  }

  private releaseHands(): void {
    for (const h of this.hands) releaseImage(h.img);
    this.hands = [];
  }

  private tink(now: number, impact: number): void {
    if (now - this.lastTinkAt < 70) return;
    this.lastTinkAt = now;
    const k = Math.min(1, impact / 8);
    tone({ type: 'square', from: 1300 + k * 400, to: 700, dur: 0.035, vol: 0.05 + k * 0.07 });
  }

  /** Angolo visivo corrente (a scatti) di un esplosivo. */
  protected snappedAngle(e: LiveExplosive): number {
    const rotStep = (Math.PI * 2) / E.rotationSteps;
    return Math.round(e.angle / rotStep) * rotStep;
  }

  private launchVelocity(): { x: number; y: number } | null {
    const a = this.aim;
    if (!a) return null;
    let dx = a.ax - a.px;
    let dy = a.ay - a.py;
    const len = Math.hypot(dx, dy);
    if (len < E.minPull) return null;
    if (len > E.maxPull) {
      dx = (dx / len) * E.maxPull;
      dy = (dy / len) * E.maxPull;
    }
    return { x: dx * E.launchScale, y: dy * E.launchScale };
  }

  /** Mira: guanto teso, elastico, puntini che scorrono, cerchio del raggio dove esploderà. */
  private drawAim(now: number): void {
    const a = this.aim;
    if (!a) {
      this.gfx?.clear();
      return;
    }
    if (!this.gfx) this.gfx = this.ctx.scene.add.graphics().setDepth(40);
    const g = this.gfx;
    g.clear();

    // fionda tesa al massimo: esplosivo e guanto tremano di 1px
    const pull = Math.hypot(a.px - a.ax, a.py - a.ay);
    const tense = pull >= E.maxPull * A.tenseShare;
    const jx = tense ? (Math.floor(now / A.tenseJitterMs) % 2 === 0 ? 1 : -1) : 0;
    a.x = Math.round(a.ax) + jx;
    a.y = Math.round(a.ay);
    a.sprite.setPosition(a.x, a.y);
    a.hand.setPosition(a.x, a.y + this.handDy);
    this.renderAim(a, now);

    // elastico: due file di puntini dal guanto al dito
    const shown = Math.min(pull, E.maxPull);
    if (pull > 0.5) {
      const ux = (a.px - a.ax) / pull;
      const uy = (a.py - a.ay) / pull;
      g.fillStyle(col(tense ? C.red : C.slate));
      for (let d = 3; d < shown; d += 2) {
        g.fillRect(Math.round(a.ax + ux * d - uy * 2), Math.round(a.ay + uy * d + ux * 2), 1, 1);
        g.fillRect(Math.round(a.ax + ux * d + uy * 2), Math.round(a.ay + uy * d - ux * 2), 1, 1);
      }
    }

    const v = this.launchVelocity();
    if (!v) return;
    const b: Kinematic = { x: a.ax, y: a.ay, vx: v.x, vy: v.y };
    const phase = Math.floor(now / E.trajAnimMs);
    const every = E.trajDotEvery;
    const fuseSteps = Math.ceil(this.stats.fuseMs / STEP);
    const bigUntil = E.trajSteps * A.trajBigShare;
    let bounces = 0;
    let dots = true;
    let n = 0;
    for (let i = 1; i <= fuseSteps; i++) {
      if (stepKinematic(b, E.bodyRadius) > 0 && ++bounces > E.trajMaxBounces) dots = false;
      if (!dots || i > E.trajSteps) continue;
      // puntini che "scorrono" in avanti lungo la parabola
      if ((((i - phase) % every) + every) % every !== 0) continue;
      const x = Math.round(b.x);
      const y = Math.round(b.y);
      const big = i < bigUntil;
      const sz = 2;
      const c = n % 4 === (phase >> 2) % 4 ? C.white : big ? C.yellow : C.orange;
      // ombra scura 1px: leggibile anche sullo sfondo del cantiere
      g.fillStyle(col(C.black));
      g.fillRect(x + 1, y + 1, sz, sz);
      g.fillStyle(col(c));
      g.fillRect(x, y, sz, sz);
      n++;
    }
    this.drawBlastRing(g, b.x, b.y, now);
  }

  /** Cerchio tratteggiato (che gira) del raggio del danno + mirino al centro. */
  private drawBlastRing(g: Phaser.GameObjects.Graphics, x: number, y: number, now: number): void {
    const r = this.stats.radius;
    const cx = Math.round(x);
    const cy = Math.round(y);
    const { left, right, top, bottom } = ROOM_INNER;
    const pts = Math.max(24, Math.round(Math.PI * 2 * r));
    const march = Math.floor(now / A.ringMarchMs);
    const dash = A.ringDash;
    for (let j = 0; j < pts; j++) {
      const seg = Math.floor((j + march) / dash);
      if (seg % 2 === 1) continue;
      // un trattino su 6 bianco: gira più visibilmente
      const on = seg % 12 === 0;
      const t = (j / pts) * Math.PI * 2;
      const px = Math.round(cx + Math.cos(t) * r);
      const py = Math.round(cy + Math.sin(t) * r);
      if (px < left || px >= right || py < top || py > bottom) continue;
      g.fillStyle(col(C.black));
      g.fillRect(px + 1, py + 1, 1, 1);
      g.fillStyle(col(on ? C.white : C.orange));
      g.fillRect(px, py, 1, 1);
    }
    // mirino a croce che pulsa
    const k = Math.floor(now / 160) % 2 === 0 ? 2 : 3;
    g.fillStyle(col(C.black));
    g.fillRect(cx - k - 1, cy - 1, k * 2 + 3, 3);
    g.fillRect(cx - 1, cy - k - 1, 3, k * 2 + 3);
    g.fillStyle(col(C.yellow));
    g.fillRect(cx - k, cy, k * 2 + 1, 1);
    g.fillRect(cx, cy - k, 1, k * 2 + 1);
  }

  /** Rilascia guanto (se drop) ed extra della mira; lo sprite solo se annullata. */
  private releaseAim(a: Aim, drop: boolean): void {
    for (const img of a.extras) releaseImage(img);
    a.extras.length = 0;
    if (drop) {
      releaseImage(a.hand);
      releaseImage(a.sprite);
    }
  }

  private cancelAim(): void {
    if (!this.aim) return;
    this.releaseAim(this.aim, true);
    this.aim = null;
    this.gfx?.clear();
  }

  // ---------------------------------------------------------------- esplosione

  private explode(e: LiveExplosive): void {
    const ragdoll = this.ctx.ragdoll;
    const s = this.stats;
    const x = Math.round(e.x);
    const y = Math.round(e.y);
    releaseImage(e.sprite);
    releaseImage(e.extra);

    // danno ad area: decresce linearmente con la distanza dal centro
    for (const p of ragdoll.parts.values()) {
      const pos = p.body.position;
      const d = Math.hypot(pos.x - x, pos.y - y);
      if (d > s.radius) continue;
      const k = 1 - d / s.radius;
      const amount = s.damage * (E.minDamageShare + (1 - E.minDamageShare) * k);
      this.hit({ part: p.name, x: Math.round(pos.x), y: Math.round(pos.y), amount, weaponId: this.id });
    }

    // spinta radiale + un po' di "salto" verso l'alto
    const pushed = ragdoll.applyRadialImpulse(x, y, s.pushRadius, s.pushStrength);
    if (pushed.length > 0) {
      const com = ragdoll.centerOfMass();
      const near = Math.max(0, 1 - Math.hypot(com.x - x, com.y - y) / s.pushRadius);
      ragdoll.addVelocity(0, -s.upBoost * near);
    }

    bigExplosion(this.ctx.scene, x, y, s.boomSize, {
      shakePx: s.shakePx,
      shakeMs: E.shakeMs,
      hitStopMs: E.hitStopMs,
      pieces: this.shrapnelKeys,
    });
  }

  private destroyAll(): void {
    this.stopTicking();
    this.cancelAim();
    this.releaseHands();
    this.gfx?.destroy();
    this.gfx = null;
    for (const e of this.live) {
      releaseImage(e.sprite);
      releaseImage(e.extra);
    }
    this.live = [];
    this.active = false;
  }
}

// ==================================================================== GRANATA

type GranataStats = (typeof WEAPON_STATS)['granata'];

const GRANATA_ICON: SpriteData = [
  '...000...',
  '..0dd00..',
  '.0000000.',
  '.0655660.',
  '065666660',
  '066666660',
  '066666760',
  '.0667760.',
  '..00000..',
];

/** in volo: spoletta spenta (a) / accesa (b) */
const GRANATA_A: SpriteData = [
  '..000..',
  '.0dd00.',
  '0000000',
  '0655660',
  '0656660',
  '0666670',
  '0667770',
  '.00000.',
];
const GRANATA_B: SpriteData = [
  '..000..',
  '.0cc20.',
  '0000000',
  '0655660',
  '0656660',
  '0666670',
  '0667770',
  '.00000.',
];
/** anello della spoletta: attaccato in mira, poi vola via */
const GRANATA_PIN: SpriteData = ['.00.', '0dc0', '0e.0', '.00.'];
/** schegge di lamiera verde */
const GRANATA_SHARD_A: SpriteData = ['56', '70'];
const GRANATA_SHARD_B: SpriteData = ['.6.', '667', '.70'];

/**
 * Granata: si lancia a fionda (la spoletta vola via al primo trascinamento),
 * rimbalza, la spoletta lampeggia sempre più veloce con un beep che accelera
 * e dopo ~2s esplode con raggio medio.
 */
export class Granata extends ThrownExplosive<GranataStats> {
  readonly id = 'granata';
  readonly name = 'GRANATA';
  readonly icon = GRANATA_ICON;

  protected get idleTexture(): string {
    return 'granata-a';
  }

  protected get trailColors(): readonly ColorIndex[] {
    return [C.silver, C.slate, C.green];
  }

  protected get shrapnelKeys(): readonly string[] {
    return ['granata-shard-a', 'granata-shard-b'];
  }

  protected makeOwnSprites(): void {
    makeSprites(this.ctx.scene, {
      'granata-a': GRANATA_A,
      'granata-b': GRANATA_B,
      'granata-pin': GRANATA_PIN,
      'granata-shard-a': GRANATA_SHARD_A,
      'granata-shard-b': GRANATA_SHARD_B,
    });
  }

  protected beginAim(a: AimView): void {
    a.extras.push(acquireImage(this.ctx.scene, a.x + 4, a.y - 4, 'granata-pin').setDepth(21));
  }

  protected renderAim(a: AimView): void {
    if (!a.armed) a.extras[0]?.setPosition(a.x + 4, a.y - 4);
  }

  /** Spoletta tolta: l'anello vola via con un "ting". */
  protected armAim(a: AimView): void {
    const pin = a.extras.shift();
    releaseImage(pin);
    const dir = Math.random() < 0.5 ? -1 : 1;
    tossPiece(this.ctx.scene, a.x + 4, a.y - 4, 'granata-pin', A.pinVx * dir, A.pinVy, {
      lifeMs: 1500,
      onFirstBounce: () => tone({ type: 'square', from: 3100, to: 2900, dur: 0.03, vol: 0.04 }),
    });
    tone({ type: 'square', from: 2350, to: 2250, dur: 0.05, vol: 0.08 });
    tone({ type: 'triangle', from: 3500, to: 3400, dur: 0.16, vol: 0.06, delay: 0.015 });
    noise({ dur: 0.025, vol: 0.08, freq: 5000, highpass: true });
    spawnParticles(this.ctx.scene, a.x + 3, a.y - 4, {
      count: 3,
      colors: [C.white, C.yellow],
      speed: 1.2,
      angle: -Math.PI / 2,
      spread: 1.6,
      gravity: 0.05,
      lifeMs: 180,
      size: 1,
      depth: 22,
    });
  }

  protected renderFuse(e: LiveExplosive): void {
    const k = Math.min(1, e.age / e.fuseMs);
    const period = Phaser.Math.Linear(E.blinkSlowMs, E.blinkFastMs, k * k);
    const phase = Math.floor(e.age / period);
    const on = phase % 2 === 1;
    const key = on ? 'granata-b' : 'granata-a';
    if (e.sprite.texture.key !== key) e.sprite.setTexture(key);
    // ultimi istanti: tutta la granata lampeggia di bianco
    if (on && k >= A.blinkWhiteShare) e.sprite.setTintFill(col(C.white));
    else if (e.sprite.isTinted) e.sprite.clearTint();
    // beep chiptune su ogni accensione, sempre più acuto
    if (phase !== e.phase) {
      e.phase = phase;
      if (on) tone({ type: 'square', from: Phaser.Math.Linear(A.beepFrom, A.beepTo, k), dur: 0.03, vol: 0.04 + k * 0.04 });
    }
  }
}
