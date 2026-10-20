import Phaser from 'phaser';
import { ELEMENTAL, ROOM_INNER, WEAPON_STATS } from '../config/balance';
import { C, col } from '../config/palette';
import { noise, tone } from '../audio/sfx';
import type { Part } from '../entities/Ragdoll';
import { popFrames, shake, spawnParticles } from '../gfx/effects';
import { makeSprites, type SpriteData } from '../gfx/pixelSprite';
import { FxPool, PartTints, nearestPart, pixelLine, zigzag } from './elementFx';
import { Weapon, type WeaponPointer } from './Weapon';

type IceStats = (typeof WEAPON_STATS)['ghiaccio'];

const ICON_ICE: SpriteData = [
  '....0....',
  '...0c0...',
  '..0cba0..',
  '..0cba0..',
  '.0cbba90.',
  '.0cba990.',
  '..0ba90..',
  '...0a0...',
  '....0....',
];

// impatto del cristallo: cresce, esplode in punte, si sbriciola
const HIT_A: SpriteData = ['.....', '..c..', '.cbc.', '..c..', '.....'];
const HIT_B: SpriteData = ['...c...', '.b.c.b.', '..bcb..', 'cccbccc', '..bcb..', '.b.c.b.', '...c...'];
const HIT_C: SpriteData = ['b..a..b', '.......', '..a.a..', 'a..c..a', '..a.a..', '.......', 'b..a..b'];
const HIT_FRAMES = ['fx-icehit-a', 'fx-icehit-b', 'fx-icehit-c'];

const SHARD_A: SpriteData = ['.c.', 'cba', '.a.'];
const SHARD_B: SpriteData = ['c..', '.b.', '..a'];
const SHARD_C: SpriteData = ['..c', '.b.', 'a..'];
const SHARD_D: SpriteData = ['cb', 'ba'];
const SHARD_FRAMES_1 = ['fx-shard-a', 'fx-shard-b', 'fx-shard-a', 'fx-shard-c'];
const SHARD_FRAMES_2 = ['fx-shard-d', 'fx-shard-b', 'fx-shard-d', 'fx-shard-c'];

interface Beam {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t0: number;
}

interface Frozen {
  since: number;
  pose: Map<Part, { x: number; y: number; angle: number }>;
  /** blocco di ghiaccio (coordinate mondo, intere) */
  bx: number;
  by: number;
  bw: number;
  bh: number;
  drop: number;
  vy: number;
  maxDrop: number;
  cracked: boolean;
  nextSparkle: number;
}

/**
 * Ghiaccio: tap. Un raggio di ghiaccio colpisce la parte toccata; dopo 3 colpi
 * ravvicinati Tony resta chiuso in un blocco di ghiaccio, fermo (velocità
 * azzerate a ogni step). Il colpo successivo, o la fine del tempo, frantuma
 * il blocco in schegge con un grosso danno bonus.
 */
export class Ghiaccio extends Weapon<IceStats> {
  readonly id = 'ghiaccio';
  readonly name = 'GHIACCIO';
  readonly icon = ICON_ICE;

  private beamGfx: Phaser.GameObjects.Graphics | null = null;
  private blockGfx: Phaser.GameObjects.Graphics | null = null;
  private shards: FxPool | null = null;
  private tints: PartTints | null = null;
  private beams: Beam[] = [];
  private hits = 0;
  private lastHitAt = -1e9;
  private frozen: Frozen | null = null;

  activate(): void {
    super.activate();
    const scene = this.ctx.scene;
    makeSprites(scene, {
      'fx-icehit-a': HIT_A,
      'fx-icehit-b': HIT_B,
      'fx-icehit-c': HIT_C,
      'fx-shard-a': SHARD_A,
      'fx-shard-b': SHARD_B,
      'fx-shard-c': SHARD_C,
      'fx-shard-d': SHARD_D,
    });
    this.beamGfx = scene.add.graphics().setDepth(54);
    this.blockGfx = scene.add.graphics().setDepth(20);
    this.shards = new FxPool(scene, ELEMENTAL.maxShards);
    this.tints = new PartTints(scene);
    scene.matter.world.on('afterupdate', this.holdPose, this);
    this.hits = 0;
  }

  deactivate(): void {
    const scene = this.ctx.scene;
    scene.matter?.world?.off('afterupdate', this.holdPose, this);
    this.frozen = null;
    this.beamGfx?.destroy();
    this.blockGfx?.destroy();
    this.beamGfx = null;
    this.blockGfx = null;
    this.shards?.clear();
    this.shards = null;
    this.tints?.destroy();
    this.tints = null;
    this.beams = [];
  }

  onPointerUp(p: WeaponPointer): void {
    if (p.wasGrab || !this.tints) return;
    if (!this.tryUse(p.time)) return;
    const s = this.stats;
    const now = p.time;
    const x = p.downX;
    const y = p.downY;

    if (this.frozen) {
      if (now - this.frozen.since < s.minFreezeMs) return;
      this.fireBeam(x, y, now);
      this.shatter(x, y, p.downHit?.part ?? null);
      return;
    }

    const part = p.downHit?.part ?? nearestPart(this.ctx.ragdoll, x, y, 10);
    const tx = part ? part.body.position.x : x;
    const ty = part ? part.body.position.y : y;
    const { dx, dy } = this.fireBeam(tx, ty, now);

    tone({ type: 'triangle', from: 1700, to: 2600, dur: 0.07, vol: 0.08 });
    if (!part) {
      popFrames(this.ctx.scene, x, y, HIT_FRAMES, ELEMENTAL.beamFrameMs + 10);
      tone({ type: 'sine', from: 3000, to: 2800, dur: 0.05, vol: 0.04, delay: 0.04 });
      return;
    }

    this.ctx.ragdoll.applyImpulse(part, tx, ty, dx * s.impulse, dy * s.impulse);
    this.hit({ part: part.name, x: tx, y: ty, amount: s.damage, weaponId: this.id });
    popFrames(this.ctx.scene, tx, ty, HIT_FRAMES, ELEMENTAL.beamFrameMs + 10);
    tone({ type: 'sine', from: 3200, to: 3000, dur: 0.06, vol: 0.06, delay: 0.03 });

    this.hits = now - this.lastHitAt <= s.comboWindowMs ? this.hits + 1 : 1;
    this.lastHitAt = now;
    this.tints.set(part, C.cyan, now + s.comboWindowMs);
    if (this.hits >= s.hitsToFreeze) {
      this.hits = 0;
      this.freeze(now);
    }
  }

  update(dtMs: number): void {
    if (!this.beamGfx) return;
    const now = this.ctx.scene.time.now;
    const fr = this.frozen;
    if (fr) {
      const s = this.stats;
      const com = this.ctx.ragdoll.centerOfMass();
      if (this.ctx.ragdoll.isGrabbed()) {
        // afferrarlo rompe il ghiaccio
        this.shatter(com.x, com.y, null);
      } else if (now - fr.since >= s.freezeMs) {
        this.shatter(com.x, com.y, null);
      } else {
        if (!fr.cracked && now - fr.since >= s.freezeMs * ELEMENTAL.iceCrackAt) {
          fr.cracked = true;
          this.drawBlock(fr);
          noise({ dur: 0.05, vol: 0.06, freq: 5000, highpass: true });
          tone({ type: 'square', from: 2600, to: 2000, dur: 0.03, vol: 0.03 });
        }
        this.blockGfx?.setPosition(fr.bx, fr.by + Math.round(fr.drop));
        if (now >= fr.nextSparkle) {
          fr.nextSparkle = now + 220;
          spawnParticles(this.ctx.scene, fr.bx + 2 + Math.random() * (fr.bw - 4), fr.by + fr.drop + 2 + Math.random() * (fr.bh - 4), {
            count: 1,
            colors: [C.white],
            speed: 0.01,
            gravity: 0,
            lifeMs: 200,
            size: 1,
          });
        }
      }
    }
    this.drawBeams(now);
    this.shards?.update(dtMs);
  }

  // ---------------------------------------------------------------- raggio

  private fireBeam(tx: number, ty: number, now: number): { dx: number; dy: number } {
    const x0 = Math.round(90 + (tx - 90) * 0.35);
    const y0 = ELEMENTAL.beamOriginY;
    if (this.beams.length >= 4) this.beams.shift();
    this.beams.push({ x0, y0, x1: tx, y1: ty, t0: now });
    const len = Math.max(1, Math.hypot(tx - x0, ty - y0));
    return { dx: (tx - x0) / len, dy: (ty - y0) / len };
  }

  private drawBeams(now: number): void {
    const g = this.beamGfx;
    if (!g) return;
    g.clear();
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      const f = Math.floor((now - b.t0) / ELEMENTAL.beamFrameMs);
      if (f >= ELEMENTAL.beamFrames) {
        this.beams.splice(i, 1);
        continue;
      }
      if (f === 0) {
        g.fillStyle(col(C.sky));
        pixelLine(g, b.x0, b.y0, b.x1, b.y1, 3);
        g.fillStyle(col(C.white));
        pixelLine(g, b.x0, b.y0, b.x1, b.y1, 1);
      } else if (f === 1) {
        g.fillStyle(col(C.cyan));
        pixelLine(g, b.x0, b.y0, b.x1, b.y1, 2);
        g.fillStyle(col(C.white));
        pixelLine(g, b.x0, b.y0, b.x1, b.y1, 1, 3);
      } else {
        g.fillStyle(col(C.sky));
        pixelLine(g, b.x0, b.y0, b.x1, b.y1, 1, 2);
      }
    }
  }

  // ---------------------------------------------------------------- blocco

  private freeze(now: number): void {
    const ragdoll = this.ctx.ragdoll;
    const pose = new Map<Part, { x: number; y: number; angle: number }>();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let lowest = -Infinity;
    for (const part of ragdoll.parts.values()) {
      const b = part.body;
      pose.set(part, { x: b.position.x, y: b.position.y, angle: b.angle });
      const r = part.sprite.getBounds();
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.right);
      maxY = Math.max(maxY, r.bottom);
      lowest = Math.max(lowest, b.bounds.max.y);
      this.tints?.set(part, C.cyan, Infinity);
    }
    const m = ELEMENTAL.iceMargin;
    const bx = Math.max(ROOM_INNER.left, Math.floor(minX) - m);
    const by = Math.max(ROOM_INNER.top, Math.floor(minY) - m);
    const fr: Frozen = {
      since: now,
      pose,
      bx,
      by,
      bw: Math.min(ROOM_INNER.right, Math.ceil(maxX) + m) - bx,
      bh: Math.min(ROOM_INNER.bottom, Math.ceil(maxY) + m) - by,
      drop: 0,
      vy: 0,
      maxDrop: Math.max(0, ROOM_INNER.bottom - lowest - 0.5),
      cracked: false,
      nextSparkle: now,
    };
    this.frozen = fr;
    this.drawBlock(fr);
    this.blockGfx?.setPosition(fr.bx, fr.by).setVisible(true);

    tone({ type: 'triangle', from: 2400, to: 500, dur: 0.28, vol: 0.1 });
    noise({ dur: 0.22, vol: 0.08, freq: 4000, highpass: true });
    tone({ type: 'sine', from: 3600, to: 3400, dur: 0.12, vol: 0.05, delay: 0.2 });
    spawnParticles(this.ctx.scene, fr.bx + fr.bw / 2, fr.by + fr.bh / 2, {
      count: 12,
      colors: [C.white, C.cyan, C.sky],
      speed: 2,
      lifeMs: 400,
      gravity: 0.05,
      size: 1,
    });
  }

  /** Ogni step di fisica: Tony resta nella posa del congelamento (cade piano se è in aria). */
  private holdPose(): void {
    const fr = this.frozen;
    if (!fr) return;
    fr.vy = Math.min(fr.vy + ELEMENTAL.iceGravity, ELEMENTAL.iceMaxFall);
    fr.drop = Math.min(fr.drop + fr.vy, fr.maxDrop);
    const mb = this.ctx.scene.matter.body;
    for (const [part, p] of fr.pose) {
      const b = part.body;
      mb.setPosition(b, { x: p.x, y: p.y + fr.drop }, false);
      mb.setAngle(b, p.angle, false);
      mb.setVelocity(b, { x: 0, y: 0 });
      mb.setAngularVelocity(b, 0);
    }
  }

  private drawBlock(fr: Frozen): void {
    const g = this.blockGfx;
    if (!g) return;
    const w = fr.bw;
    const h = fr.bh;
    g.clear();
    g.fillStyle(col(C.cyan), ELEMENTAL.iceAlpha).fillRect(0, 0, w, h);
    // bordo, luce in alto a sinistra, ombra in basso a destra
    g.fillStyle(col(C.cyan), 0.95);
    g.fillRect(0, 0, w, 1).fillRect(0, h - 1, w, 1).fillRect(0, 0, 1, h).fillRect(w - 1, 0, 1, h);
    g.fillStyle(col(C.white), 0.9);
    g.fillRect(1, 1, Math.round(w * 0.6), 1).fillRect(1, 1, 1, Math.round(h * 0.5));
    g.fillStyle(col(C.sky), 0.8);
    g.fillRect(2, h - 2, w - 3, 1).fillRect(w - 2, 2, 1, h - 3);
    // riflessi diagonali
    g.fillStyle(col(C.white), 0.85);
    pixelLine(g, Math.round(w * 0.22), Math.round(h * 0.2), Math.round(w * 0.22) + 3, Math.round(h * 0.2) + 3);
    pixelLine(g, Math.round(w * 0.3), Math.round(h * 0.2), Math.round(w * 0.3) + 1, Math.round(h * 0.2) + 1);
    pixelLine(g, Math.round(w * 0.68), Math.round(h * 0.62), Math.round(w * 0.68) + 4, Math.round(h * 0.62) + 4);
    if (fr.cracked) {
      g.fillStyle(col(C.white), 1);
      const pts: number[] = [];
      const cx = Math.round(w * (0.35 + Math.random() * 0.3));
      zigzag(pts, cx, 0, cx + (Math.random() < 0.5 ? -5 : 5), Math.round(h * 0.55), 4, 2);
      for (let i = 0; i + 3 < pts.length; i += 2) pixelLine(g, pts[i], pts[i + 1], pts[i + 2], pts[i + 3]);
      const mx = pts[4] ?? cx;
      const my = pts[5] ?? 4;
      zigzag(pts, mx, my, mx + 7, my + 6, 3, 2);
      for (let i = 0; i + 3 < pts.length; i += 2) pixelLine(g, pts[i], pts[i + 1], pts[i + 2], pts[i + 3]);
    }
  }

  // ---------------------------------------------------------------- frantumazione

  private shatter(x: number, y: number, tapped: Part | null): void {
    const fr = this.frozen;
    if (!fr) return;
    this.frozen = null;
    this.blockGfx?.clear();
    this.tints?.clear();
    const s = this.stats;
    const ragdoll = this.ctx.ragdoll;
    const scene = this.ctx.scene;

    const main = tapped ?? nearestPart(ragdoll, x, y, 1e6);
    if (main) {
      const hit = new Set<Part>([main]);
      const mp = main.body.position;
      this.hit({ part: main.name, x: mp.x, y: mp.y, amount: s.damage * s.shatterMult, weaponId: this.id });
      for (let i = 0; i < s.splashParts; i++) {
        const p = nearestPart(ragdoll, mp.x, mp.y, 1e6, hit);
        if (!p) break;
        hit.add(p);
        this.hit({ part: p.name, x: p.body.position.x, y: p.body.position.y, amount: s.damage * s.splashMult, weaponId: this.id });
      }
    }
    ragdoll.applyRadialImpulse(x, y, s.shatterRadius, s.shatterPush);
    ragdoll.addVelocity(0, -2);

    // schegge
    const cx = fr.bx + fr.bw / 2;
    const cy = fr.by + fr.drop + fr.bh / 2;
    for (let i = 0; i < ELEMENTAL.shardCount; i++) {
      const sx = fr.bx + Math.random() * fr.bw;
      const sy = fr.by + fr.drop + Math.random() * fr.bh;
      this.shards?.spawn(i % 2 ? SHARD_FRAMES_1 : SHARD_FRAMES_2, sx, sy, {
        vx: (sx - cx) * 0.12 + (Math.random() - 0.5) * 2.5,
        vy: -2 - Math.random() * 3 + (sy - cy) * 0.05,
        gravity: ELEMENTAL.shardGravity,
        lifeMs: ELEMENTAL.shardMs * (0.7 + Math.random() * 0.6),
        mode: 'loop',
        frameMs: 60 + Math.floor(Math.random() * 40),
        collide: true,
        bounce: ELEMENTAL.shardBounce,
        blinkMs: 300,
        depth: 53,
      });
    }
    spawnParticles(scene, cx, cy, { count: 16, colors: [C.white, C.cyan, C.sky], speed: 3.5, lifeMs: 450, size: 1 });
    popFrames(scene, x, y, HIT_FRAMES, 60);
    shake(scene, ELEMENTAL.shakeBigPx, 300);

    // vetro che va in pezzi
    noise({ dur: 0.3, vol: 0.2, freq: 6000, freqTo: 2500, highpass: true });
    noise({ dur: 0.18, vol: 0.12, freq: 800, freqTo: 150 });
    [2500, 3100, 3700, 2900].forEach((f, i) => tone({ type: 'square', from: f, to: f * 0.9, dur: 0.05, vol: 0.04, delay: 0.03 + i * 0.045 }));
  }

  /** Per il debug da console. */
  get debugState(): { hits: number; frozen: boolean; shards: number } {
    return { hits: this.hits, frozen: !!this.frozen, shards: this.shards?.count ?? 0 };
  }
}
