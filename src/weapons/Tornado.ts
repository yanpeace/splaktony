import Phaser from 'phaser';
import { ELEMENTAL, ROOM_INNER, WEAPON_STATS } from '../config/balance';
import { C } from '../config/palette';
import { noise, tone } from '../audio/sfx';
import { acquireImage, releaseImage, shake, spawnParticles } from '../gfx/effects';
import { makeSprites, type SpriteData } from '../gfx/pixelSprite';
import { events, type PartName } from '../systems/events';
import { Weapon, type WeaponPointer } from './Weapon';

type TornadoStats = (typeof WEAPON_STATS)['tornado'];

const ICON_TORNADO: SpriteData = [
  '000000000',
  '0ccddcce0',
  '.0dccdd0.',
  '.0eddcc0.',
  '..0cdd0..',
  '..0dce0..',
  '...0dc0..',
  '....0c0..',
  '.....0...',
];

const FUNNEL_W = 28;
const FUNNEL_H = 44;
const FUNNEL_FRAMES = ['fx-tornado-0', 'fx-tornado-1', 'fx-tornado-2', 'fx-tornado-3'];

/**
 * Imbuto del tornado (22x34): largo in alto, stretto e ondeggiante in basso,
 * bande diagonali bianche che scorrono a ogni frame (= rotazione a scatti),
 * lato destro in ombra, polvere alla base.
 */
function funnelFrame(phase: number): SpriteData {
  const rows: string[] = [];
  const mid = FUNNEL_W / 2;
  for (let y = 0; y < FUNNEL_H; y++) {
    const k = y / (FUNNEL_H - 1);
    const row = new Array<string>(FUNNEL_W).fill('.');
    if (y < FUNNEL_H - 4) {
      const hw = mid - 0.5 - (mid - 2) * Math.pow(k, 0.8);
      const off = Math.sin(k * 4.5 + phase * 1.57) * 2.4 * k;
      const left = Math.max(0, Math.round(mid - hw + off));
      const right = Math.min(FUNNEL_W - 1, Math.round(mid + hw + off) - 1);
      for (let x = left; x <= right; x++) {
        const band = (x - left + Math.floor(y / 2) + phase * 2) % 5;
        let ch = band < 2 ? 'c' : 'd';
        if (x >= right - 1) ch = 'e';
        if (x === left) ch = 'c';
        row[x] = ch;
      }
      // sbuffi sui bordi
      if ((y + phase) % 3 === 0 && left > 1) row[left - 2] = 'd';
      if ((y + phase + 1) % 4 === 0 && right < FUNNEL_W - 2) row[right + 2] = 'e';
    } else {
      // polvere alla base
      const r = 4 + (y - (FUNNEL_H - 4)) * 2;
      for (let x = Math.round(mid - r); x < Math.round(mid + r); x++) {
        if (x < 0 || x >= FUNNEL_W) continue;
        const n = (x * 7 + y * 13 + phase * 5) % 4;
        row[x] = n === 0 ? '.' : n === 1 ? 'f' : 'e';
      }
    }
    rows.push(row.join(''));
  }
  return rows;
}

const DEBRIS_A: SpriteData = ['33', '23'];
const DEBRIS_B: SpriteData = ['66', '5.'];
const DEBRIS_C: SpriteData = ['e', 'f'];
const DEBRIS_D: SpriteData = ['dc'];
const DEBRIS_KEYS = ['fx-deb-a', 'fx-deb-b', 'fx-deb-c', 'fx-deb-d'];

interface Debris {
  img: Phaser.GameObjects.Image;
  a: number;
  /** altezza relativa al centro del vortice (px) */
  hy: number;
  speed: number;
}

interface Twister {
  x0: number;
  y0: number;
  cx: number;
  cy: number;
  born: number;
  img: Phaser.GameObjects.Image;
  debris: Debris[];
  nextContact: number;
  nextSound: number;
  spin: 1 | -1;
}

/**
 * Tornado: tap. Nasce un piccolo tornado nel punto che per 3 s aspira Tony e
 * lo fa girare in aria (spinte tangenziali e verso l'alto a ogni step di
 * fisica), poi lo scaglia contro il muro più lontano. Danno: piccolo a
 * contatto + urti, con un bonus sul primo urto dopo la scagliata.
 */
export class Tornado extends Weapon<TornadoStats> {
  readonly id = 'tornado';
  readonly name = 'TORNADO';
  readonly icon = ICON_TORNADO;
  override readonly allowsGrab = false;

  private tw: Twister | null = null;
  private slamUntil = 0;
  private slamFrom = 0;
  private offDamage: (() => void) | null = null;

  activate(): void {
    super.activate();
    const scene = this.ctx.scene;
    const sprites: Record<string, SpriteData> = {
      'fx-deb-a': DEBRIS_A,
      'fx-deb-b': DEBRIS_B,
      'fx-deb-c': DEBRIS_C,
      'fx-deb-d': DEBRIS_D,
    };
    FUNNEL_FRAMES.forEach((k, i) => (sprites[k] = funnelFrame(i)));
    makeSprites(scene, sprites);
    scene.matter.world.on('beforeupdate', this.applyWind, this);
    this.offDamage = events.on('damage', (e) => {
      const now = this.ctx.scene.time.now;
      if (e.weaponId !== 'impact' || now > this.slamUntil || now < this.slamFrom) return;
      this.slamUntil = 0;
      this.slam(e.part, e.x, e.y);
    });
  }

  deactivate(): void {
    this.ctx.scene.matter?.world?.off('beforeupdate', this.applyWind, this);
    this.offDamage?.();
    this.offDamage = null;
    this.endTwister();
    this.slamUntil = 0;
  }

  onPointerDown(p: WeaponPointer): void {
    if (this.tw || !this.tryUse(p.time)) return;
    const scene = this.ctx.scene;
    const x0 = Phaser.Math.Clamp(p.x, ROOM_INNER.left + ELEMENTAL.tornadoWallMargin, ROOM_INNER.right - ELEMENTAL.tornadoWallMargin);
    const y0 = Phaser.Math.Clamp(p.y, ROOM_INNER.top + ELEMENTAL.tornadoTopMargin, ROOM_INNER.bottom - ELEMENTAL.tornadoBottomMargin);
    const img = acquireImage(scene, x0, y0, FUNNEL_FRAMES[0]).setDepth(18);
    const debris: Debris[] = [];
    for (let i = 0; i < ELEMENTAL.debrisCount; i++) {
      debris.push({
        img: acquireImage(scene, x0, y0, DEBRIS_KEYS[i % DEBRIS_KEYS.length]),
        a: (i / ELEMENTAL.debrisCount) * Math.PI * 2,
        hy: -18 + Math.random() * 36,
        speed: 0.35 + Math.random() * 0.25,
      });
    }
    const com = this.ctx.ragdoll.centerOfMass();
    this.tw = {
      x0,
      y0,
      cx: x0,
      cy: y0,
      born: p.time,
      img,
      debris,
      nextContact: p.time + this.stats.contactTickMs,
      nextSound: p.time,
      spin: com.x < x0 ? 1 : -1,
    };
    tone({ type: 'sawtooth', from: 110, to: 420, dur: 0.3, vol: 0.06 });
    noise({ dur: 0.35, vol: 0.12, freq: 300, freqTo: 1400 });
    spawnParticles(scene, x0, y0 + FUNNEL_H / 2 - 2, {
      count: 10,
      colors: [C.silver, C.slate, C.white],
      speed: 2,
      angle: -Math.PI / 2,
      spread: 2.6,
      gravity: 0.05,
      lifeMs: 450,
      size: 1,
    });
  }

  update(_dtMs: number): void {
    const tw = this.tw;
    if (!tw) return;
    const scene = this.ctx.scene;
    const now = scene.time.now;
    const s = this.stats;
    const age = now - tw.born;
    if (age >= s.lifeMs) {
      this.fling(now);
      return;
    }

    // il vortice ondeggia a destra/sinistra e sale un po'
    tw.cx = Phaser.Math.Clamp(
      tw.x0 + Math.sin((age / 1000) * s.driftFreq) * s.driftAmp * tw.spin,
      ROOM_INNER.left + ELEMENTAL.tornadoWallMargin,
      ROOM_INNER.right - ELEMENTAL.tornadoWallMargin,
    );
    tw.cy = Math.max(ROOM_INNER.top + ELEMENTAL.tornadoTopMargin, tw.y0 - s.rise * Math.min(1, age / 800));

    const f = Math.floor(age / ELEMENTAL.tornadoFrameMs);
    const keyIdx = tw.spin > 0 ? f % FUNNEL_FRAMES.length : FUNNEL_FRAMES.length - 1 - (f % FUNNEL_FRAMES.length);
    tw.img.setTexture(FUNNEL_FRAMES[keyIdx]).setPosition(Math.round(tw.cx), Math.round(tw.cy));
    tw.img.setVisible(s.lifeMs - age > 240 || Math.floor(age / 60) % 2 === 0);

    // detriti che girano attorno all'imbuto (a scatti), davanti o dietro
    for (const d of tw.debris) {
      const a = d.a + f * d.speed * tw.spin;
      const widen = 1 - (d.hy + 18) / 48;
      const x = tw.cx + Math.cos(a) * ELEMENTAL.debrisRx * (0.5 + widen);
      const y = tw.cy + d.hy + Math.sin(a) * ELEMENTAL.debrisRy;
      d.img.setPosition(Math.round(x), Math.round(y)).setDepth(Math.sin(a) > 0 ? 19 : 9);
    }

    if (now >= tw.nextSound) {
      tw.nextSound = now + ELEMENTAL.tornadoSoundMs;
      noise({ dur: 0.3, vol: 0.06, freq: 500 + 300 * Math.sin(age / 180), freqTo: 350 });
    }

    // piccolo danno a contatto
    if (now >= tw.nextContact) {
      tw.nextContact = now + s.contactTickMs;
      const near: { name: PartName; x: number; y: number; d: number }[] = [];
      for (const part of this.ctx.ragdoll.parts.values()) {
        const { x, y } = part.body.position;
        const d = Math.hypot(x - tw.cx, y - tw.cy);
        if (d <= s.contactRadius) near.push({ name: part.name, x, y, d });
      }
      near.sort((a, b) => a.d - b.d);
      for (let i = 0; i < Math.min(near.length, s.contactParts); i++) {
        const h = near[i];
        this.hit({ part: h.name, x: h.x, y: h.y, amount: s.damage, weaponId: this.id });
      }
    }
  }

  /** Ogni step di fisica: Tony viene risucchiato e fatto girare attorno al centro. */
  private applyWind(): void {
    const tw = this.tw;
    if (!tw) return;
    const s = this.stats;
    const ragdoll = this.ctx.ragdoll;
    if (ragdoll.isGrabbed()) return;
    const g = ELEMENTAL.gravityPerStep;
    // il baricentro gira attorno al centro del vortice...
    const com = ragdoll.centerOfMass();
    const rx = com.x - tw.cx;
    const ry = com.y - tw.cy;
    const d = Math.max(0.5, Math.hypot(rx, ry));
    const ux = rx / d;
    const uy = ry / d;
    const tx = -uy * tw.spin;
    const ty = ux * tw.spin;
    let vx: number;
    let vy: number;
    if (d > s.orbitR + 25) {
      // lontano: risucchio verso il vortice
      vx = -ux * s.suckSpeed + tx * s.spinSpeed * 0.3;
      vy = -uy * s.suckSpeed + ty * s.spinSpeed * 0.3;
    } else {
      const inward = (d - s.orbitR) * s.pull;
      vx = tx * s.spinSpeed - ux * inward;
      vy = ty * s.spinSpeed - uy * inward;
    }
    // ...e Tony ruota su se stesso (la forma del corpo resta riconoscibile)
    const w = s.tumble * tw.spin;
    for (const part of ragdoll.parts.values()) {
      const b = part.body;
      const px = b.position.x - com.x;
      const py = b.position.y - com.y;
      const dvx = (vx - w * py - b.velocity.x) * s.grip;
      const dvy = (vy + w * px - b.velocity.y) * s.grip - g;
      ragdoll.applyImpulse(part, b.position.x, b.position.y, dvx, dvy);
    }
  }

  /** Fine del tornado: Tony viene scagliato contro il muro più lontano. */
  private fling(now: number): void {
    const tw = this.tw;
    if (!tw) return;
    const s = this.stats;
    const ragdoll = this.ctx.ragdoll;
    const com = ragdoll.centerOfMass();
    const dir = com.x < (ROOM_INNER.left + ROOM_INNER.right) / 2 ? 1 : -1;
    if (!ragdoll.isGrabbed()) {
      for (const part of ragdoll.parts.values()) {
        const b = part.body;
        ragdoll.applyImpulse(part, b.position.x, b.position.y, dir * s.throwSpeed - b.velocity.x, -s.throwUp - b.velocity.y);
      }
      this.slamFrom = now + 30;
      this.slamUntil = now + s.slamWindowMs;
    }
    spawnParticles(this.ctx.scene, tw.cx, tw.cy, {
      count: 14,
      colors: [C.silver, C.slate, C.white],
      speed: 3,
      gravity: 0.08,
      lifeMs: 500,
      size: 1,
    });
    noise({ dur: 0.28, vol: 0.16, freq: 1600, freqTo: 200 });
    tone({ type: 'sawtooth', from: 420, to: 90, dur: 0.25, vol: 0.06 });
    this.endTwister();
  }

  /** Primo urto dopo la scagliata: bonus di danno, polvere e tonfo. */
  private slam(part: PartName, x: number, y: number): void {
    const s = this.stats;
    this.hit({ part, x, y, amount: s.damage * s.slamMult, weaponId: this.id });
    shake(this.ctx.scene, 3, 260);
    spawnParticles(this.ctx.scene, x, y, {
      count: 12,
      colors: [C.silver, C.slate, C.charcoal],
      speed: 2.5,
      gravity: 0.1,
      lifeMs: 500,
    });
    noise({ dur: 0.22, vol: 0.25, freq: 320, freqTo: 60 });
    tone({ type: 'square', from: 140, to: 50, dur: 0.12, vol: 0.08 });
  }

  private endTwister(): void {
    const tw = this.tw;
    if (!tw) return;
    releaseImage(tw.img);
    for (const d of tw.debris) releaseImage(d.img);
    this.tw = null;
  }
}
