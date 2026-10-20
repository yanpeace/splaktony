import Phaser from 'phaser';
import { ELEMENTAL, PHYSICS, WEAPON_STATS } from '../config/balance';
import { C } from '../config/palette';
import { noise, tone } from '../audio/sfx';
import type { Part } from '../entities/Ragdoll';
import { acquireImage, releaseImage, spawnParticles } from '../gfx/effects';
import { makeSprites, type SpriteData } from '../gfx/pixelSprite';
import { FxPool, PartTints, pointerStillDown } from './elementFx';
import { Weapon, type WeaponPointer } from './Weapon';

type FlameStats = (typeof WEAPON_STATS)['lanciafiamme'];

const ICON_FLAME: SpriteData = [
  '.....4...',
  '....434..',
  '...43c4..',
  '..0d4330.',
  '.0de00...',
  '0de0.....',
  '0220.....',
  '0230.....',
  '0000.....',
];

// fiammelle quadrate del getto: gialla (4) → arancione (3) → rossa (2) → fumo
const FL_4: SpriteData = ['4444', '4cc4', '4cc4', '4444'];
const FL_4B: SpriteData = ['4444', '44c4', '4c44', '4433'];
const FL_3: SpriteData = ['334', '343', '333'];
const FL_3S: SpriteData = ['332', '323', '222'];
const FL_2: SpriteData = ['22', '21'];
const SM_F: SpriteData = ['ff', 'fe'];
const SM_E: SpriteData = ['ee', 'ee'];
const SM_1: SpriteData = ['e'];

// fiammella attaccata a una parte che brucia (3 frame)
const BURN_A: SpriteData = ['..4..', '..4..', '.434.', '.4c4.', '34c43', '33433', '.232.'];
const BURN_B: SpriteData = ['.4...', '.44..', '.434.', '34c4.', '3cc43', '34443', '.232.'];
const BURN_C: SpriteData = ['...4.', '..44.', '.434.', '.4c43', '34c43', '33433', '.232.'];

const FLAME_FRAMES = ['fx-fl-4', 'fx-fl-4b', 'fx-fl-4', 'fx-fl-3', 'fx-fl-3', 'fx-fl-3s', 'fx-fl-2', 'fx-sm-f', 'fx-sm-e', 'fx-sm-1'];
const SMOKE_FRAMES = ['fx-sm-f', 'fx-sm-e', 'fx-sm-e', 'fx-sm-1'];
const BURN_FRAMES = ['fx-burn-a', 'fx-burn-b', 'fx-burn-c'];

interface Burn {
  img: Phaser.GameObjects.Image;
  until: number;
  nextTick: number;
  nextSmoke: number;
  started: number;
}

/**
 * Lanciafiamme: tieni premuto. Un getto di fiamme sale dal basso dello schermo
 * verso il dito; le parti nel cono prendono danno continuo e prendono fuoco
 * (fiammelle attaccate, danno nel tempo, annerimento). Non afferra Tony.
 */
export class Lanciafiamme extends Weapon<FlameStats> {
  readonly id = 'lanciafiamme';
  readonly name = 'LANCIAFIAMME';
  readonly icon = ICON_FLAME;
  override readonly allowsGrab = false;

  private flames: FxPool | null = null;
  private tints: PartTints | null = null;
  private burns = new Map<Part, Burn>();
  private triggerId: number | null = null;
  private targetX = 0;
  private targetY = 0;
  private spawnAcc = 0;
  private nextSoundAt = 0;
  private soundCount = 0;

  activate(): void {
    super.activate();
    const scene = this.ctx.scene;
    makeSprites(scene, {
      'fx-fl-4': FL_4,
      'fx-fl-4b': FL_4B,
      'fx-fl-3': FL_3,
      'fx-fl-3s': FL_3S,
      'fx-fl-2': FL_2,
      'fx-sm-f': SM_F,
      'fx-sm-e': SM_E,
      'fx-sm-1': SM_1,
      'fx-burn-a': BURN_A,
      'fx-burn-b': BURN_B,
      'fx-burn-c': BURN_C,
    });
    this.flames = new FxPool(scene, ELEMENTAL.maxFlames);
    this.tints = new PartTints(scene);
  }

  deactivate(): void {
    this.triggerId = null;
    this.flames?.clear();
    this.flames = null;
    for (const b of this.burns.values()) releaseImage(b.img);
    this.burns.clear();
    this.tints?.destroy();
    this.tints = null;
  }

  onPointerDown(p: WeaponPointer): void {
    if (this.triggerId !== null) return;
    this.triggerId = p.id;
    this.targetX = p.x;
    this.targetY = p.y;
    this.nextSoundAt = 0;
    tone({ type: 'sawtooth', from: 90, to: 160, dur: 0.12, vol: 0.06 });
  }

  onPointerMove(p: WeaponPointer): void {
    if (p.id !== this.triggerId) return;
    this.targetX = p.x;
    this.targetY = p.y;
  }

  onPointerUp(p: WeaponPointer): void {
    if (p.id === this.triggerId) this.triggerId = null;
  }

  update(dtMs: number): void {
    const scene = this.ctx.scene;
    if (this.triggerId !== null && !pointerStillDown(scene, this.triggerId)) this.triggerId = null;
    if (this.triggerId !== null) this.fire(dtMs);
    else this.spawnAcc = 0;
    this.updateBurns();
    this.flames?.update(dtMs);
  }

  /** Punto di partenza del getto: sotto lo schermo, segue un po' il dito in x. */
  private origin(): { x: number; y: number } {
    return { x: Math.round(90 + (this.targetX - 90) * ELEMENTAL.flameOriginFollow), y: ELEMENTAL.flameOriginY };
  }

  private fire(dtMs: number): void {
    const now = this.ctx.scene.time.now;
    const s = this.stats;
    const o = this.origin();
    let dx = this.targetX - o.x;
    let dy = this.targetY - o.y;
    const dist = Math.min(Math.hypot(dx, dy), s.range);
    const len = Math.max(1, Math.hypot(dx, dy));
    dx /= len;
    dy /= len;

    // getto di fiammelle
    this.spawnAcc += dtMs;
    const base = Math.atan2(dy, dx);
    while (this.spawnAcc >= ELEMENTAL.flameSpawnMs) {
      this.spawnAcc -= ELEMENTAL.flameSpawnMs;
      const a = base + (Math.random() - 0.5) * 2 * ELEMENTAL.flameJitter;
      const v = ELEMENTAL.flameSpeed * (0.85 + Math.random() * 0.3);
      const start = Math.random() * 6;
      const reachMs = (dist / v) * PHYSICS.stepMs;
      this.flames?.spawn(FLAME_FRAMES, o.x + dx * start, o.y + dy * start, {
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        gravity: ELEMENTAL.flameBuoyancy,
        drag: ELEMENTAL.flameDrag,
        lifeMs: reachMs + ELEMENTAL.flameOvershootMs * (0.6 + Math.random() * 0.8) + ELEMENTAL.smokeMs,
        depth: 52,
      });
    }

    // fruscio/rombo
    if (now >= this.nextSoundAt) {
      this.nextSoundAt = now + ELEMENTAL.flameSoundMs;
      noise({ dur: 0.14, vol: 0.07, freq: 700 + Math.random() * 400, freqTo: 260 });
      if (this.soundCount++ % 3 === 0) tone({ type: 'triangle', from: 72, to: 55, dur: 0.16, vol: 0.06 });
    }

    // danno alle parti nel cono
    if (!this.tryUse(now)) return;
    const tan = Math.tan(s.coneHalf);
    const hits: { part: Part; d: number }[] = [];
    for (const part of this.ctx.ragdoll.parts.values()) {
      const px = part.body.position.x - o.x;
      const py = part.body.position.y - o.y;
      const t = px * dx + py * dy;
      if (t < 0 || t > dist + 6) continue;
      const perp = Math.abs(px * dy - py * dx);
      if (perp > t * tan + s.coneMargin) continue;
      hits.push({ part, d: Math.hypot(part.body.position.x - this.targetX, part.body.position.y - this.targetY) });
    }
    hits.sort((a, b) => a.d - b.d);
    const n = Math.min(hits.length, s.maxParts);
    for (let i = 0; i < n; i++) {
      const part = hits[i].part;
      const { x, y } = part.body.position;
      this.ctx.ragdoll.applyImpulse(part, x, y, dx * s.push, dy * s.push - s.push * 0.5);
      this.hit({ part: part.name, x, y, amount: s.damage, weaponId: this.id });
      this.ignite(part, now);
    }
  }

  private ignite(part: Part, now: number): void {
    const s = this.stats;
    let b = this.burns.get(part);
    if (!b) {
      if (this.burns.size >= ELEMENTAL.maxBurning) {
        // troppe parti in fiamme: si spegne quella accesa da più tempo
        let oldest: Part | null = null;
        let t = Infinity;
        for (const [p, ob] of this.burns) {
          if (ob.started < t) {
            t = ob.started;
            oldest = p;
          }
        }
        if (oldest) this.extinguish(oldest);
      }
      const img = acquireImage(this.ctx.scene, part.sprite.x, part.sprite.y, BURN_FRAMES[0]);
      b = { img, until: 0, nextTick: now + s.burnTickMs, nextSmoke: now, started: now };
      this.burns.set(part, b);
      noise({ dur: 0.08, vol: 0.05, freq: 2500, highpass: true });
      spawnParticles(this.ctx.scene, part.sprite.x, part.sprite.y, {
        count: 3,
        colors: [C.yellow, C.orange],
        speed: 1.2,
        angle: -Math.PI / 2,
        spread: 1.4,
        gravity: -0.03,
        lifeMs: 300,
        size: 1,
      });
    }
    b.until = now + s.burnMs;
    this.tints?.set(part, C.silver, b.until + ELEMENTAL.charExtraMs);
  }

  private extinguish(part: Part): void {
    const b = this.burns.get(part);
    if (!b) return;
    releaseImage(b.img);
    this.burns.delete(part);
  }

  /** Fiammelle che seguono le parti, danno nel tempo e fumo. */
  private updateBurns(): void {
    if (this.burns.size === 0) return;
    const now = this.ctx.scene.time.now;
    const s = this.stats;
    for (const [part, b] of this.burns) {
      if (now >= b.until || !part.sprite.active) {
        this.extinguish(part);
        if (part.sprite.active) {
          this.flames?.spawn(SMOKE_FRAMES, part.sprite.x, part.sprite.y - 3, {
            vy: -0.5,
            gravity: -0.01,
            lifeMs: ELEMENTAL.smokeMs * 1.5,
            depth: 51,
          });
        }
        continue;
      }
      const f = Math.floor((now - b.started) / ELEMENTAL.burnFrameMs);
      const key = BURN_FRAMES[f % BURN_FRAMES.length];
      if (b.img.texture.key !== key) b.img.setTexture(key);
      const jx = f % 4 === 1 ? 1 : f % 4 === 3 ? -1 : 0;
      b.img.setPosition(part.sprite.x + jx, part.sprite.y - 3).setDepth(part.sprite.depth + 0.5);

      if (now >= b.nextSmoke) {
        b.nextSmoke = now + ELEMENTAL.burnSmokeEveryMs * (0.7 + Math.random() * 0.6);
        this.flames?.spawn(SMOKE_FRAMES, part.sprite.x + (Math.random() - 0.5) * 4, part.sprite.y - 7, {
          vx: (Math.random() - 0.5) * 0.4,
          vy: -0.6,
          gravity: -0.01,
          lifeMs: ELEMENTAL.smokeMs * 1.4,
          depth: 51,
        });
      }
      if (now >= b.nextTick) {
        b.nextTick += s.burnTickMs;
        const { x, y } = part.body.position;
        this.hit({ part: part.name, x, y, amount: s.damage * s.burnShare, weaponId: this.id });
      }
    }
  }

  /** Per il debug da console. */
  get debugCounts(): { flames: number; burning: number } {
    return { flames: this.flames?.count ?? 0, burning: this.burns.size };
  }
}
