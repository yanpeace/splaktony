import Phaser from 'phaser';
import { EXPLOSIVES, PHYSICS, ROOM_INNER, WEAPON_STATS, type WeaponStats } from '../config/balance';
import { C, col } from '../config/palette';
import { playExplosion, playWhoosh, tone } from '../audio/sfx';
import { acquireImage, hitStop, isFrozen, popFrames, releaseImage, shake, spawnParticles } from '../gfx/effects';
import { makeSprites, type SpriteData } from '../gfx/pixelSprite';
import { Weapon, type WeaponContext, type WeaponPointer } from './Weapon';

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
  /** oggetti extra della sottoclasse (es. scintilla della miccia) */
  extra?: Phaser.GameObjects.Image;
  nextFxAt: number;
}

interface Kinematic {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

const E = EXPLOSIVES;
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

/** hash deterministico 0..1 (sprite generati sempre uguali) */
function hash(a: number, b: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Genera i 4 frame dell'esplosione (nuvola bianco/giallo/arancio/rosso,
 * poi anello che si dissolve in fumo) come SpriteData di lato 2R+1.
 */
export function boomFrames(R: number): SpriteData[] {
  const size = R * 2 + 1;
  const lobes = 10;
  const frames: SpriteData[] = [];
  const scales = [0.55, 0.85, 1, 1];
  for (let f = 0; f < 4; f++) {
    const grid: string[][] = [];
    for (let y = 0; y < size; y++) {
      const row: string[] = [];
      for (let x = 0; x < size; x++) {
        const dx = x - R;
        const dy = y - R;
        const d = Math.hypot(dx, dy);
        // bordo "a nuvola": raggio che oscilla tra lobi interpolati
        const t = ((Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2)) * lobes;
        const i0 = Math.floor(t) % lobes;
        const i1 = (i0 + 1) % lobes;
        const k = t - Math.floor(t);
        const n = hash(i0, f) * (1 - k) + hash(i1, f) * k;
        const edge = (R - 1) * scales[f] * (0.78 + 0.22 * n);
        const u = d / edge;
        const grain = hash(x * 3 + f, y * 7);
        let ch = '.';
        if (u <= 1) {
          if (f === 0) ch = u < 0.55 ? 'c' : '4';
          else if (f === 1) ch = u < 0.3 ? 'c' : u < 0.55 ? '4' : u < 0.8 ? '3' : '2';
          else if (f === 2) {
            ch = u < 0.2 ? 'c' : u < 0.45 ? '4' : u < 0.72 ? '3' : u < 0.9 ? '2' : '1';
            if (u > 0.5 && grain > 0.88) ch = 'f';
          } else {
            // anello che si apre, con fumo a scacchiera al centro
            if (u < 0.45) ch = grain > 0.55 ? '.' : (x + y) % 2 === 0 ? 'e' : '.';
            else if (u < 0.75) ch = grain > 0.5 ? '.' : grain > 0.25 ? '2' : '1';
            else ch = grain > 0.45 ? '.' : grain > 0.2 ? 'f' : '1';
          }
        }
        row.push(ch);
      }
      grid.push(row);
    }
    // contorno scuro 1px sui frame pieni
    if (f < 3) {
      const filled = grid.map((r) => r.map((c) => c !== '.'));
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (filled[y][x]) continue;
          const near =
            (x > 0 && filled[y][x - 1]) ||
            (x < size - 1 && filled[y][x + 1]) ||
            (y > 0 && filled[y - 1][x]) ||
            (y < size - 1 && filled[y + 1][x]);
          if (near) grid[y][x] = '0';
        }
      }
    }
    frames.push(grid.map((r) => r.join('')));
  }
  return frames;
}

const SMOKE_A: SpriteData = ['.ddd.', 'ddddd', 'dddde', 'ddeee', '.eee.'];
const SMOKE_B: SpriteData = ['.ee.', 'eeef', 'eeff', '.ff.'];
const SMOKE_C: SpriteData = ['.f.', 'fff', '.f.'];
const SMOKE_KEYS = ['fx-smoke-a', 'fx-smoke-b', 'fx-smoke-c'];

/**
 * Base comune degli esplosivi lanciati a fionda.
 *
 * Mira "tira indietro" (fionda): al pointerdown l'esplosivo compare sotto il
 * dito, trascinando si tende l'elastico e i puntini mostrano la parabola
 * nella direzione OPPOSTA al trascinamento; al rilascio parte con velocità
 * proporzionale alla tensione (EXPLOSIVES.launchScale, max maxPull px).
 * Un trascinamento più corto di minPull annulla il lancio.
 *
 * L'esplosivo è cinematico (non è un corpo Matter): non urta Tony e non fa
 * danno d'impatto, rimbalza solo sulla stanza. Il danno arriva solo
 * dall'esplosione (this.hit per ogni parte entro stats.radius).
 *
 * Cambio arma (deactivate): la mira in corso viene annullata, ma gli
 * esplosivi già lanciati continuano a volare ed esplodono comunque
 * (la simulazione gira su un listener UPDATE proprio, staccato quando
 * l'arma non è attiva e non resta nulla in volo). Allo shutdown della scena
 * tutto viene distrutto senza esplodere.
 */
export abstract class ThrownExplosive<S extends ExplosiveStats> extends Weapon<S> {
  override readonly allowsGrab: boolean = false;

  private live: LiveExplosive[] = [];
  private aim: { id: number; ax: number; ay: number; px: number; py: number; sprite: Phaser.GameObjects.Image } | null =
    null;
  private gfx: Phaser.GameObjects.Graphics | null = null;
  private puffs = new Set<Phaser.GameObjects.Image>();
  private ticking = false;
  private active = false;
  private acc = 0;
  private lastTinkAt = 0;

  constructor(ctx: WeaponContext) {
    super(ctx);
    ctx.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroyAll());
  }

  /** Texture dell'esplosivo da mostrare in mira/in volo. */
  protected abstract get idleTexture(): string;
  /** Registra le texture proprie (sprite in volo, scintille...). */
  protected abstract makeOwnSprites(): void;
  /** Aggiorna lo sprite in volo (lampeggio spoletta, miccia...). */
  protected abstract renderFuse(e: LiveExplosive, now: number): void;
  /** Ritocchi allo sprite appena creato (es. origine). */
  protected prepareSprite(_img: Phaser.GameObjects.Image): void {}

  protected get boomKeys(): string[] {
    return [0, 1, 2, 3].map((i) => `fx-boom-${this.id}-${i}`);
  }

  activate(): void {
    super.activate();
    const scene = this.ctx.scene;
    const frames = boomFrames(this.stats.boomSize);
    const sprites: Record<string, SpriteData> = {
      'fx-smoke-a': SMOKE_A,
      'fx-smoke-b': SMOKE_B,
      'fx-smoke-c': SMOKE_C,
    };
    this.boomKeys.forEach((k, i) => (sprites[k] = frames[i]));
    makeSprites(scene, sprites);
    this.makeOwnSprites();
    this.active = true;
    this.startTicking();
  }

  deactivate(): void {
    this.active = false;
    this.cancelAim();
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
    const a = clampToRoom(p.downX, p.downY, E.bodyRadius);
    const sprite = this.ctx.scene.add
      .image(Math.round(a.x), Math.round(a.y), this.idleTexture)
      .setDepth(20);
    this.prepareSprite(sprite);
    this.aim = { id: p.id, ax: a.x, ay: a.y, px: p.x, py: p.y, sprite };
  }

  onPointerMove(p: WeaponPointer): void {
    if (!this.aim || this.aim.id !== p.id) return;
    this.aim.px = p.x;
    this.aim.py = p.y;
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
      aim.sprite.destroy();
      return;
    }
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

  private tick(_time: number, dt: number): void {
    const scene = this.ctx.scene;
    const now = scene.time.now;
    // durante l'hit-stop anche esplosivi e micce restano fermi
    if (!isFrozen(scene)) {
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

    const rotStep = (Math.PI * 2) / E.rotationSteps;
    for (const e of this.live) {
      e.sprite.setPosition(Math.round(e.x), Math.round(e.y));
      e.sprite.setRotation(Math.round(e.angle / rotStep) * rotStep);
      this.renderFuse(e, now);
    }

    if (this.active) this.drawAim(now);
    else if (this.live.length === 0) this.stopTicking();
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

  /** Puntini della traiettoria (parabola simulata con rimbalzi) + elastico. */
  private drawAim(now: number): void {
    const a = this.aim;
    if (!a) {
      this.gfx?.clear();
      return;
    }
    if (!this.gfx) this.gfx = this.ctx.scene.add.graphics().setDepth(40);
    const g = this.gfx;
    g.clear();

    // elastico: puntini radi dal punto di lancio al dito
    const pull = Math.hypot(a.px - a.ax, a.py - a.ay);
    const shown = Math.min(pull, E.maxPull);
    if (pull > 0.5) {
      g.fillStyle(col(C.slate));
      for (let d = 3; d < shown; d += 3) {
        g.fillRect(Math.round(a.ax + ((a.px - a.ax) / pull) * d), Math.round(a.ay + ((a.py - a.ay) / pull) * d), 1, 1);
      }
    }

    const v = this.launchVelocity();
    if (!v) return;
    const b: Kinematic = { x: a.ax, y: a.ay, vx: v.x, vy: v.y };
    const phase = Math.floor(now / E.trajAnimMs);
    const total = Math.floor(E.trajSteps / E.trajDotEvery);
    let bounces = 0;
    let dot = 0;
    for (let i = 1; i <= E.trajSteps; i++) {
      if (stepKinematic(b, E.bodyRadius) > 0 && ++bounces > E.trajMaxBounces) break;
      if (i % E.trajDotEvery !== 0) continue;
      // un puntino bianco "corre" lungo la traiettoria; quelli lontani sono arancio
      const c = (dot - phase) % 4 === 0 ? C.white : dot < total * 0.5 ? C.yellow : C.orange;
      g.fillStyle(col(c));
      g.fillRect(Math.round(b.x), Math.round(b.y), 1, 1);
      dot++;
      if (b.vx === 0 && b.vy === 0) break;
    }
  }

  private cancelAim(): void {
    if (!this.aim) return;
    this.aim.sprite.destroy();
    this.aim = null;
    this.gfx?.clear();
  }

  // ---------------------------------------------------------------- esplosione

  private explode(e: LiveExplosive): void {
    const scene = this.ctx.scene;
    const ragdoll = this.ctx.ragdoll;
    const s = this.stats;
    const x = Math.round(e.x);
    const y = Math.round(e.y);
    e.sprite.destroy();
    e.extra?.destroy();

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

    // la nuvola si appoggia a pavimento/muri invece di sbordarci dentro
    const m = Math.round(s.boomSize * 0.5);
    const bx = Phaser.Math.Clamp(x, ROOM_INNER.left + m, ROOM_INNER.right - m);
    const by = Math.min(y, ROOM_INNER.bottom - m);
    popFrames(scene, bx, by, this.boomKeys, E.explosionFrameMs, { depth: 55 });
    spawnParticles(scene, x, y, {
      count: E.debrisCount,
      colors: [C.yellow, C.orange, C.red, C.white],
      speed: 3.5,
      gravity: 0.12,
      lifeMs: 500,
    });
    this.spawnSmoke(x, y, s.boomSize);
    shake(scene, s.shakePx, E.shakeMs);
    hitStop(scene, E.hitStopMs);
    playExplosion();
  }

  /** Sbuffi grigi che salgono lentamente, si rimpiccioliscono e lampeggiano. */
  private spawnSmoke(x: number, y: number, size: number): void {
    const scene = this.ctx.scene;
    for (let i = 0; i < E.smokePuffs; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * size * 0.6;
      const sx = x + Math.cos(a) * r;
      const sy = Phaser.Math.Clamp(y + Math.sin(a) * r * 0.6, ROOM_INNER.top + 3, ROOM_INNER.bottom - 3);
      const drift = (Math.random() - 0.5) * 8;
      const rise = E.smokeRise * (0.6 + Math.random() * 0.6);
      const life = E.smokeMs * (0.7 + Math.random() * 0.5);
      const img = acquireImage(scene, sx, sy, SMOKE_KEYS[0]).setDepth(54);
      this.puffs.add(img);
      scene.tweens.addCounter({
        from: 0,
        to: 1,
        duration: life,
        delay: E.explosionFrameMs * (1 + Math.random() * 2),
        onUpdate: (tw) => {
          if (!img.active) return;
          const k = tw.getValue() ?? 0;
          img.setPosition(
            Math.round(sx + drift * k),
            Math.round(Math.max(ROOM_INNER.top + 2, sy - rise * k)),
          );
          img.setTexture(SMOKE_KEYS[Math.min(2, Math.floor(k * 3))]);
          if (k > 0.7) img.setVisible(Math.floor(k * 30) % 2 === 0);
        },
        onComplete: () => {
          this.puffs.delete(img);
          releaseImage(img);
        },
      });
    }
  }

  private destroyAll(): void {
    this.stopTicking();
    this.cancelAim();
    this.gfx?.destroy();
    this.gfx = null;
    for (const e of this.live) {
      e.sprite.destroy();
      e.extra?.destroy();
    }
    this.live = [];
    this.puffs.forEach((p) => releaseImage(p));
    this.puffs.clear();
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

/**
 * Granata: si lancia a fionda, rimbalza, la spoletta lampeggia sempre più
 * veloce e dopo ~2s esplode con raggio medio.
 */
export class Granata extends ThrownExplosive<GranataStats> {
  readonly id = 'granata';
  readonly name = 'GRANATA';
  readonly icon = GRANATA_ICON;

  protected get idleTexture(): string {
    return 'granata-a';
  }

  protected makeOwnSprites(): void {
    makeSprites(this.ctx.scene, { 'granata-a': GRANATA_A, 'granata-b': GRANATA_B });
  }

  protected renderFuse(e: LiveExplosive): void {
    const k = Math.min(1, e.age / e.fuseMs);
    const period = Phaser.Math.Linear(E.blinkSlowMs, E.blinkFastMs, k * k);
    const on = Math.floor(e.age / period) % 2 === 1;
    const key = on ? 'granata-b' : 'granata-a';
    if (e.sprite.texture.key !== key) e.sprite.setTexture(key);
  }
}
