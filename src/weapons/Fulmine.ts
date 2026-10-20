import Phaser from 'phaser';
import { ELEMENTAL, ROOM_INNER, WEAPON_STATS } from '../config/balance';
import { C, col } from '../config/palette';
import { noise, tone } from '../audio/sfx';
import type { Part } from '../entities/Ragdoll';
import { acquireImage, releaseImage, shake, spawnParticles } from '../gfx/effects';
import { makeSprite, makeSprites, type SpriteData } from '../gfx/pixelSprite';
import { FxPool, gridToSprite, nearestPart, pixelPolyline, textureMask, zigzag } from './elementFx';
import { Weapon, type WeaponPointer } from './Weapon';

type BoltStats = (typeof WEAPON_STATS)['fulmine'];

const ICON_BOLT: SpriteData = [
  '..0000...',
  '.0dccd0..',
  '0dcccdd0.',
  '.0eeeee0.',
  '...0c0...',
  '..0cb0...',
  '.0cccb0..',
  '...0cb0..',
  '....00...',
];

const CLOUD: SpriteData = [
  '....0000.......',
  '..00dddd00000..',
  '.0ddcccddddde0.',
  '0dcccccdddddde0',
  '0dddddddddeeee0',
  '.0eeeeeeeeeee0.',
  '..00000000000..',
];
const CLOUD_S: SpriteData = [
  '...............',
  '...............',
  '.....000.......',
  '....0ddd000....',
  '...0dddddde0...',
  '....0eeeee0....',
  '.....00000.....',
];
/** nuvola illuminata dalla saetta */
const CLOUD_LIT: SpriteData = CLOUD.map((r) => r.replace(/d/g, 'c').replace(/e/g, 'b'));
const CLOUD_FRAMES = ['fx-cloud-s', 'fx-cloud', 'fx-cloud-lit', 'fx-cloud', 'fx-cloud', 'fx-cloud-s'];

type PartKind = 'head' | 'torso' | 'limb';

/**
 * Scheletro "ai raggi X" di una parte: silhouette nera presa dalla texture
 * vera della parte, ossa bianche (c) con ombra (d).
 */
function skeletonSprite(mask: { w: number; h: number; on: boolean[][] }, kind: PartKind): SpriteData {
  const { w, h, on } = mask;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && on[y][x];
  const inner = (x: number, y: number) =>
    inside(x, y) && inside(x - 1, y) && inside(x + 1, y) && inside(x, y - 1) && inside(x, y + 1);
  const g: string[][] = [];
  for (let y = 0; y < h; y++) g.push(on[y].map((v) => (v ? '0' : '.')));
  const put = (x: number, y: number, ch: string) => {
    if (inner(x, y)) g[y][x] = ch;
  };
  const cx = Math.floor(w / 2);

  if (kind === 'head') {
    const faceTop = Math.round((h * 6) / 17);
    for (let y = 1; y < faceTop; y++) for (let x = 0; x < w; x++) put(x, y, 'f');
    for (let y = faceTop - 2; y < h - 1; y++) {
      for (let x = 0; x < w; x++) {
        if (!inner(x, y)) continue;
        const top = y < faceTop;
        if (top && (x < 3 || x > w - 4)) continue;
        put(x, y, x >= w - 3 ? 'd' : 'c');
      }
    }
    // orbite, naso, denti
    const ey = faceTop + 1;
    for (const ex of [cx - 4, cx - 3, cx + 2, cx + 3]) {
      put(ex, ey, '0');
      put(ex, ey + 1, '0');
    }
    put(cx - 1, ey + 3, '0');
    put(cx, ey + 3, '0');
    const ty = h - 4;
    for (let x = cx - 4; x <= cx + 3; x++) put(x, ty, x % 2 === 0 ? '0' : 'c');
  } else if (kind === 'torso') {
    for (let y = 1; y < h - 1; y++) {
      put(cx - 1, y, 'd');
      put(cx, y, 'd');
    }
    for (let x = 2; x < w - 2; x++) put(x, 2, 'c');
    const ribEnd = Math.round(h * 0.62);
    for (let y = 4; y <= ribEnd; y += 2) {
      for (let x = 2; x < w - 2; x++) if (x !== cx - 1 && x !== cx) put(x, y, 'c');
    }
    for (let y = h - 5; y <= h - 3; y++) {
      for (let x = 2; x < w - 2; x++) {
        const hole = y === h - 4 && x >= cx - 2 && x <= cx + 1;
        put(x, y, hole ? '0' : y === h - 3 ? 'd' : 'c');
      }
    }
  } else {
    const c0 = Math.floor((w - 1) / 2);
    const c1 = w >= 6 ? c0 + 1 : c0;
    for (let y = 1; y < h - 1; y++) {
      put(c0, y, 'c');
      if (c1 !== c0) put(c1, y, 'd');
    }
    for (const y of [1, h - 2]) {
      put(c0 - 1, y, 'c');
      put(c1 + 1, y, 'd');
    }
  }
  return gridToSprite(g);
}

function partKind(part: Part): PartKind {
  return part.name === 'head' ? 'head' : part.name === 'torso' ? 'torso' : 'limb';
}

interface Bolt {
  /** estremi */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t0: number;
  frame: number;
  pts: number[];
  /** diramazioni (solo saetta principale) */
  forks: number[][];
  seg: number;
  amp: number;
}

interface PendingHit {
  at: number;
  part: Part;
  from: Part | null;
  amount: number;
}

interface PendingStrike {
  at: number;
  x: number;
  y: number;
  cloudY: number;
}

/**
 * Fulmine: tap. Appare una nuvoletta sopra il punto e una saetta a zig-zag
 * colpisce la parte più vicina, poi salta a catena su 2-3 altre parti.
 * Le parti folgorate mostrano lo scheletro e tremano; lampo leggero a schermo.
 */
export class Fulmine extends Weapon<BoltStats> {
  readonly id = 'fulmine';
  readonly name = 'FULMINE';
  readonly icon = ICON_BOLT;

  private gfx: Phaser.GameObjects.Graphics | null = null;
  private flash: Phaser.GameObjects.Rectangle | null = null;
  private flashFrames = 0;
  private clouds: FxPool | null = null;
  private bolts: Bolt[] = [];
  private strikes: PendingStrike[] = [];
  private pending: PendingHit[] = [];
  private skeletons = new Map<Part, { img: Phaser.GameObjects.Image; until: number }>();

  activate(): void {
    super.activate();
    const scene = this.ctx.scene;
    makeSprites(scene, { 'fx-cloud': CLOUD, 'fx-cloud-s': CLOUD_S, 'fx-cloud-lit': CLOUD_LIT });
    for (const part of this.ctx.ragdoll.parts.values()) {
      const key = `fx-skel-${part.def.texture}`;
      if (!scene.textures.exists(key)) makeSprite(scene, key, skeletonSprite(textureMask(scene, part.def.texture), partKind(part)));
    }
    this.gfx = scene.add.graphics().setDepth(54);
    this.flash = scene.add
      .rectangle(0, 0, scene.scale.gameSize.width, scene.scale.gameSize.height, col(C.white))
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(80)
      .setVisible(false);
    this.clouds = new FxPool(scene, 4);
  }

  deactivate(): void {
    this.gfx?.destroy();
    this.gfx = null;
    this.flash?.destroy();
    this.flash = null;
    this.clouds?.clear();
    this.clouds = null;
    this.bolts = [];
    this.strikes = [];
    this.pending = [];
    for (const s of this.skeletons.values()) releaseImage(s.img);
    this.skeletons.clear();
  }

  onPointerUp(p: WeaponPointer): void {
    if (p.wasGrab || !this.clouds) return;
    if (!this.tryUse(p.time)) return;
    const x = Phaser.Math.Clamp(Math.round(p.downX), ROOM_INNER.left + 8, ROOM_INNER.right - 8);
    const y = p.downY;
    const cloudY = Math.max(ROOM_INNER.top + 4, Math.round(y - ELEMENTAL.cloudLift));
    this.clouds.spawn(CLOUD_FRAMES, x, cloudY, { lifeMs: ELEMENTAL.cloudMs, depth: 56 });
    this.strikes.push({ at: p.time + ELEMENTAL.boltDelayMs, x, y, cloudY });
    tone({ type: 'square', from: 220, to: 330, dur: 0.05, vol: 0.04 });
  }

  update(dtMs: number): void {
    if (!this.gfx) return;
    const now = this.ctx.scene.time.now;

    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const st = this.strikes[i];
      if (now < st.at) continue;
      this.strikes.splice(i, 1);
      this.strike(st, now);
    }
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const h = this.pending[i];
      if (now < h.at) continue;
      this.pending.splice(i, 1);
      this.applyHit(h, now);
    }

    this.updateSkeletons(now);
    this.drawBolts(now);
    this.clouds?.update(dtMs);

    if (this.flash) {
      if (this.flashFrames > 0) {
        this.flash.setVisible(true).setAlpha(this.flashFrames >= 2 ? ELEMENTAL.flashAlpha : ELEMENTAL.flashAlpha2);
        this.flashFrames--;
      } else if (this.flash.visible) {
        this.flash.setVisible(false);
      }
    }
  }

  private strike(st: PendingStrike, now: number): void {
    const s = this.stats;
    const ragdoll = this.ctx.ragdoll;
    const target = nearestPart(ragdoll, st.x, st.y, s.strikeRadius);
    const x0 = st.x;
    const y0 = st.cloudY + 4;

    noise({ dur: 0.06, vol: 0.12, freq: 4000, highpass: true });
    for (const d of [0.03, 0.07, 0.12]) noise({ dur: 0.03, vol: 0.07, freq: 3000, highpass: true, delay: d });
    tone({ type: 'square', from: 1500, to: 260, dur: 0.09, vol: 0.06 });
    noise({ dur: 0.45, vol: 0.22, freq: 520, freqTo: 60, delay: 0.06 });
    this.flashFrames = 2;
    shake(this.ctx.scene, ELEMENTAL.shakePx, ELEMENTAL.shakeMs);

    if (!target) {
      // a vuoto: la saetta scende fino al pavimento
      const fy = ROOM_INNER.bottom - 1;
      this.addBolt(x0, y0, st.x, fy, now, true);
      spawnParticles(this.ctx.scene, st.x, fy, {
        count: 8,
        colors: [C.white, C.cyan, C.sky],
        speed: 2.5,
        angle: -Math.PI / 2,
        spread: 2.2,
        lifeMs: 320,
        size: 1,
      });
      return;
    }

    const tp = target.body.position;
    this.addBolt(x0, y0, tp.x, tp.y, now, true);
    this.applyHit({ at: now, part: target, from: null, amount: s.damage }, now);

    // catena: salta sulle parti più vicine non ancora colpite
    const done = new Set<Part>([target]);
    let last = target;
    for (let k = 1; k <= s.chainCount; k++) {
      const next = nearestPart(ragdoll, last.body.position.x, last.body.position.y, s.chainRange, done);
      if (!next) break;
      done.add(next);
      this.pending.push({ at: now + k * ELEMENTAL.chainDelayMs, part: next, from: last, amount: s.damage * Math.pow(s.chainMult, k) });
      last = next;
    }
  }

  private applyHit(h: PendingHit, now: number): void {
    const s = this.stats;
    const part = h.part;
    if (!part.sprite.active) return;
    const { x, y } = part.body.position;
    if (h.from) {
      const f = h.from.body.position;
      this.addBolt(f.x, f.y, x, y, now, false);
      noise({ dur: 0.04, vol: 0.06, freq: 3500, highpass: true });
    }
    const push = h.from ? s.impulse * 0.5 : s.impulse;
    this.ctx.ragdoll.applyImpulse(part, x, y, (Math.random() - 0.5) * push, push);
    this.hit({ part: part.name, x, y, amount: h.amount, weaponId: this.id });
    spawnParticles(this.ctx.scene, x, y, {
      count: 4,
      colors: [C.white, C.cyan],
      speed: 2,
      lifeMs: 220,
      gravity: 0,
      size: 1,
    });
    this.electrocute(part, now);
  }

  /** Scheletro visibile a scatti sulla parte + tremolio. */
  private electrocute(part: Part, now: number): void {
    const until = now + ELEMENTAL.skeletonMs;
    const cur = this.skeletons.get(part);
    if (cur) {
      cur.until = until;
      return;
    }
    const img = acquireImage(this.ctx.scene, part.sprite.x, part.sprite.y, `fx-skel-${part.def.texture}`);
    this.skeletons.set(part, { img, until });
  }

  private updateSkeletons(now: number): void {
    const s = this.stats;
    for (const [part, sk] of this.skeletons) {
      if (now >= sk.until || !part.sprite.active) {
        releaseImage(sk.img);
        this.skeletons.delete(part);
        continue;
      }
      const sp = part.sprite;
      const blink = Math.floor((sk.until - now) / ELEMENTAL.skeletonBlinkMs) % 2 === 0;
      const jx = Math.random() < 0.5 ? -1 : 1;
      sk.img
        .setOrigin(sp.originX, sp.originY)
        .setPosition(sp.x + jx, sp.y)
        .setRotation(sp.rotation)
        .setDepth(sp.depth + 0.4)
        .setVisible(blink);
      const b = part.body.position;
      this.ctx.ragdoll.applyImpulse(part, b.x, b.y, (Math.random() - 0.5) * 2 * s.shiver, (Math.random() - 0.5) * 2 * s.shiver);
    }
  }

  private addBolt(x0: number, y0: number, x1: number, y1: number, now: number, main: boolean): void {
    if (this.bolts.length >= 12) this.bolts.shift();
    this.bolts.push({
      x0,
      y0,
      x1,
      y1,
      t0: now,
      frame: -1,
      pts: [],
      forks: main ? [[], []] : [],
      seg: main ? ELEMENTAL.boltSegment : 4,
      amp: main ? ELEMENTAL.boltAmp : 3,
    });
  }

  private drawBolts(now: number): void {
    const g = this.gfx;
    if (!g) return;
    g.clear();
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      const f = Math.floor((now - b.t0) / ELEMENTAL.boltFrameMs);
      if (f >= ELEMENTAL.boltFrames) {
        this.bolts.splice(i, 1);
        continue;
      }
      if (f !== b.frame) {
        // a ogni frame la saetta cambia forma (a scatti)
        b.frame = f;
        zigzag(b.pts, b.x0, b.y0, b.x1, b.y1, b.seg, b.amp);
        for (const fork of b.forks) {
          const n = b.pts.length / 2;
          const k = 1 + Math.floor(Math.random() * Math.max(1, n - 2));
          const fx = b.pts[k * 2];
          const fy = b.pts[k * 2 + 1];
          const side = Math.random() < 0.5 ? -1 : 1;
          zigzag(fork, fx, fy, fx + side * (6 + Math.random() * 6), fy + 6 + Math.random() * 6, 4, 2);
        }
      }
      if (f === 0) {
        g.fillStyle(col(C.cyan));
        pixelPolyline(g, b.pts, 3);
        for (const fork of b.forks) pixelPolyline(g, fork, 2);
        g.fillStyle(col(C.white));
        pixelPolyline(g, b.pts, 1);
        for (const fork of b.forks) pixelPolyline(g, fork, 1);
      } else if (f === 1) {
        g.fillStyle(col(C.sky));
        pixelPolyline(g, b.pts, 2);
        g.fillStyle(col(C.white));
        pixelPolyline(g, b.pts, 1);
        g.fillStyle(col(C.cyan));
        for (const fork of b.forks) pixelPolyline(g, fork, 1);
      } else {
        g.fillStyle(col(C.sky));
        pixelPolyline(g, b.pts, 1, 2);
      }
    }
  }
}
