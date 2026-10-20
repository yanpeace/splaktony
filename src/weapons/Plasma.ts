import Phaser from 'phaser';
import { PHYSICS, SCIFI, SCREEN, WEAPON_STATS } from '../config/balance';
import { C, col } from '../config/palette';
import { noise, playExplosion, tone } from '../audio/sfx';
import { acquireImage, hitStop, isFrozen, popFrames, releaseImage, shake, spawnParticles } from '../gfx/effects';
import { makeSprites, type SpriteData } from '../gfx/pixelSprite';
import type { Part } from '../entities/Ragdoll';
import { DotLayer, PixelGrid, ViewModel, energyBall, insideRoom, pointerStillDown } from './scifiView';
import { Weapon, type WeaponPointer } from './Weapon';

type PlasmaStats = (typeof WEAPON_STATS)['plasma'];

const ICON_PLASMA: SpriteData = [
  '.0000000.',
  '0f05550f0',
  '0f05c50f0',
  '0eeeeeee0',
  '06eeeee60',
  '05efffe50',
  '0eef0fee0',
  '.00f0f00.',
  '...000...',
];

/** Sfere di carica (raggio 1..6) e sfera in volo (raggio 7, 2 frame). */
const CHARGE_RADII = [1, 2, 3, 4, 5, 6] as const;
const chargeKey = (i: number, alt: number) => `fx-pl-ch${i}${alt ? 'b' : 'a'}`;
const BALL_KEYS = ['fx-pl-ball-a', 'fx-pl-ball-b'] as const;
const FIZZLE_KEYS = ['fx-pl-fz-a', 'fx-pl-fz-b'] as const;

/** Viewmodel: grosso cannone a energia, bocca larga, celle verdi ai lati, due guanti. */
function plasmaFrames(): SpriteData[] {
  const glow = [
    ['7', '6'],
    ['6', '5'],
    ['5', 'c'],
  ];
  return glow.map(([cell, hot]) => {
    const g = new PixelGrid(36, 26);
    // bocca larga con griglia interna
    g.box(8, 0, 20, 10, 'f').rect(11, 2, 14, 6, '0');
    g.hline(12, 3, 12, '7').hline(12, 6, 12, '7').hline(13, 4, 10, cell).hline(13, 5, 10, cell);
    g.px(9, 1, 'e').px(26, 1, 'e').hline(10, 1, 16, 'e');
    // corpo massiccio con pannelli
    g.box(1, 8, 34, 14, 'e');
    g.hline(2, 9, 32, 'd').px(3, 10, 'c').px(4, 10, 'c');
    g.hline(2, 20, 32, 'f').vline(33, 9, 12, 'f');
    g.rect(12, 11, 12, 7, 'f').rect(13, 12, 10, 5, '8').hline(14, 13, 8, '9').px(17, 15, hot).px(18, 15, hot);
    g.px(8, 12, '0').px(8, 15, '0').px(27, 12, '0').px(27, 15, '0');
    // celle d'energia verdi (si accendono in carica)
    for (const x of [4, 29]) {
      g.box(x, 10, 4, 10, cell);
      g.vline(x + 1, 11, 8, hot);
    }
    // guanti ai lati e impugnatura
    g.box(0, 17, 7, 9, 'f').hline(1, 18, 5, 'e').px(2, 20, '0').px(4, 20, '0').px(2, 22, '0').px(4, 22, '0');
    g.box(29, 17, 7, 9, 'f').hline(30, 18, 5, 'e').px(31, 20, '0').px(33, 20, '0').px(31, 22, '0').px(33, 22, '0');
    g.box(13, 21, 10, 5, 'f').hline(14, 22, 8, 'e');
    return g.rows();
  });
}

interface Ball {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  power: number;
  nextBoltAt: number;
}

interface Bolt {
  /** punti della saetta (spezzata) */
  pts: number[];
  bornAt: number;
}

interface Wave {
  x: number;
  y: number;
  bornAt: number;
}

/**
 * Cannone al plasma: tieni premuto per caricare (sfera verde che cresce sulla
 * bocca), rilascia per sparare un'enorme sfera lenta che lancia saette alle
 * parti di Tony vicine ed esplode con lampo verde, onda d'urto e spinta enorme.
 */
export class Plasma extends Weapon<PlasmaStats> {
  readonly id = 'plasma';
  readonly name = 'PLASMA';
  readonly icon = ICON_PLASMA;
  override readonly allowsGrab = false;

  private view: ViewModel | null = null;
  private dots: DotLayer | null = null;
  private flash: Phaser.GameObjects.Rectangle | null = null;
  private flashLeft = 0;
  private chargeImg: Phaser.GameObjects.Image | null = null;
  private triggerId: number | null = null;
  private chargeStart = 0;
  private charge = 0;
  private aimX = 90;
  private aimY = 150;
  private nextHumAt = 0;
  private balls: Ball[] = [];
  private bolts: Bolt[] = [];
  private waves: Wave[] = [];

  activate(): void {
    super.activate();
    const scene = this.ctx.scene;
    const sprites: Record<string, SpriteData> = {
      [BALL_KEYS[0]]: energyBall(7, '6', '5', 'c'),
      [BALL_KEYS[1]]: energyBall(7, '5', 'c', 'c'),
      [FIZZLE_KEYS[0]]: energyBall(3, '7', '6', '5'),
      [FIZZLE_KEYS[1]]: energyBall(2, 'f', '7', '7'),
    };
    CHARGE_RADII.forEach((r, i) => {
      sprites[chargeKey(i, 0)] = energyBall(r, '6', '5', 'c');
      sprites[chargeKey(i, 1)] = energyBall(r, '5', 'c', 'c');
    });
    makeSprites(scene, sprites);
    this.view = new ViewModel(scene, { key: 'vm-plasma', frames: plasmaFrames(), muzzleRow: 4 });
    this.view.show();
    this.dots = new DotLayer(scene, SCIFI.viewDepth + 2);
    this.flash = scene.add
      .rectangle(0, 0, SCREEN.width, SCREEN.height, col(C.lime))
      .setOrigin(0)
      .setDepth(70)
      .setVisible(false);
    this.triggerId = null;
    this.charge = 0;
  }

  deactivate(): void {
    this.triggerId = null;
    this.charge = 0;
    this.view?.hide();
    this.view = null;
    this.dots?.destroy();
    this.dots = null;
    this.flash?.destroy();
    this.flash = null;
    releaseImage(this.chargeImg);
    this.chargeImg = null;
    this.balls.forEach((b) => releaseImage(b.img));
    this.balls = [];
    this.bolts = [];
    this.waves = [];
  }

  onPointerDown(p: WeaponPointer): void {
    this.view?.aim(p.x, p.y);
    this.aimX = p.x;
    this.aimY = p.y;
    if (this.triggerId !== null || !this.view) return;
    if (this.ctx.scene.time.now - this.lastUseAt < this.stats.cooldownMs) return;
    this.triggerId = p.id;
    this.chargeStart = this.ctx.scene.time.now;
    this.charge = 0;
  }

  onPointerMove(p: WeaponPointer): void {
    if (p.id !== this.triggerId) return;
    this.aimX = p.x;
    this.aimY = p.y;
    this.view?.aim(p.x, p.y);
  }

  onPointerUp(p: WeaponPointer): void {
    if (p.id !== this.triggerId) return;
    this.aimX = p.x;
    this.aimY = p.y;
    this.release();
  }

  update(dtMs: number): void {
    const view = this.view;
    if (!view) return;
    const scene = this.ctx.scene;
    const now = scene.time.now;
    if (this.triggerId !== null && !pointerStillDown(scene, this.triggerId)) this.release();

    // ---- carica
    if (this.triggerId !== null) {
      this.charge = Math.min(1, (now - this.chargeStart) / this.stats.chargeMs);
      view.setFrame(this.charge >= 1 ? 1 + (Math.floor(now / 90) % 2) : this.charge > 0.5 ? 1 : 0);
      if (now >= this.nextHumAt) {
        this.nextHumAt = now + (this.charge >= 1 ? 140 : 70);
        const f = this.charge >= 1 ? 1300 : 180 + this.charge * 1000;
        tone({ type: 'square', from: f, to: f * 1.15, dur: 0.07, vol: 0.05 + this.charge * 0.04 });
        if (this.charge >= 1) tone({ type: 'triangle', from: 90, to: 110, dur: 0.12, vol: 0.12 });
      }
    } else {
      view.setFrame(0);
    }
    view.update(dtMs);
    this.updateChargeOrb(now);

    // ---- sfere in volo, saette, onde, lampo
    this.updateBalls(dtMs, now);
    this.draw(now);
    if (this.flash && this.flash.visible) {
      if (this.flashLeft-- <= 0) this.flash.setVisible(false);
      else this.flash.setFillStyle(col(C.lime), this.flashLeft >= SCIFI.plasmaFlashFrames - 1 ? 0.6 : 0.3);
    }
  }

  /** Sfera di carica sulla bocca + particelle risucchiate. */
  private updateChargeOrb(now: number): void {
    const view = this.view;
    if (!view) return;
    if (this.triggerId === null || this.charge <= 0) {
      releaseImage(this.chargeImg);
      this.chargeImg = null;
      return;
    }
    const m = view.muzzle();
    const i = Math.min(CHARGE_RADII.length - 1, Math.floor(this.charge * CHARGE_RADII.length));
    const r = CHARGE_RADII[i];
    const key = chargeKey(i, Math.floor(now / SCIFI.plasmaFrameMs) % 2);
    const cy = m.y - r;
    if (!this.chargeImg) this.chargeImg = acquireImage(this.ctx.scene, m.x, cy, key).setDepth(SCIFI.viewDepth + 1);
    if (this.chargeImg.texture.key !== key) this.chargeImg.setTexture(key);
    this.chargeImg.setPosition(m.x, cy);
    if (Math.random() < 0.6) {
      const a = Math.random() * Math.PI * 2;
      const d = 10 + Math.random() * 6;
      spawnParticles(this.ctx.scene, m.x + Math.cos(a) * d, cy + Math.sin(a) * d, {
        count: 1,
        colors: [C.lime, C.green, C.white],
        speed: 1.4,
        angle: a + Math.PI,
        spread: 0.3,
        gravity: 0,
        lifeMs: 150,
        size: 1,
        depth: SCIFI.viewDepth + 1,
      });
    }
  }

  /** Rilascio: spara la sfera (se carica abbastanza) o si spegne con uno sfrigolio. */
  private release(): void {
    const view = this.view;
    this.triggerId = null;
    const charge = this.charge;
    this.charge = 0;
    releaseImage(this.chargeImg);
    this.chargeImg = null;
    if (!view) return;
    const scene = this.ctx.scene;
    const s = this.stats;
    this.lastUseAt = scene.time.now;
    const m = view.muzzle();
    if (charge < s.minCharge) {
      popFrames(scene, m.x, m.y - 2, FIZZLE_KEYS, 60, { depth: SCIFI.viewDepth + 1 });
      noise({ dur: 0.12, vol: 0.08, freq: 1500, freqTo: 200 });
      return;
    }
    let dx = this.aimX - m.x;
    let dy = this.aimY - m.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    if (this.balls.length >= SCIFI.plasmaMaxLive) {
      const old = this.balls.shift();
      if (old) {
        this.explode(old);
        releaseImage(old.img);
      }
    }
    const img = acquireImage(scene, m.x, m.y - 7, BALL_KEYS[0]).setDepth(SCIFI.viewDepth - 1);
    this.balls.push({
      img,
      x: m.x,
      y: m.y - 7,
      vx: dx * s.speed,
      vy: dy * s.speed,
      age: 0,
      power: charge,
      nextBoltAt: scene.time.now + 60,
    });
    view.recoil(2);
    shake(scene, 2, 160);
    noise({ dur: 0.35, vol: 0.25, freq: 900, freqTo: 120 });
    tone({ type: 'square', from: 140, to: 50, dur: 0.3, vol: 0.18 });
    tone({ type: 'triangle', from: 600, to: 200, dur: 0.25, vol: 0.1 });
  }

  private updateBalls(dtMs: number, now: number): void {
    const frozen = isFrozen(this.ctx.scene);
    const steps = frozen ? 0 : dtMs / PHYSICS.stepMs;
    const ragdoll = this.ctx.ragdoll;
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i];
      if (!frozen) b.age += dtMs;
      b.x += b.vx * steps;
      b.y += b.vy * steps;
      const touch = ragdoll.partAt(b.x, b.y, 4);
      if (touch || !insideRoom(b.x, b.y, 6) || b.age > SCIFI.plasmaMaxFlightMs) {
        b.x = Phaser.Math.Clamp(b.x, 14, 166);
        b.y = Phaser.Math.Clamp(b.y, 30, 286);
        this.explode(b);
        releaseImage(b.img);
        this.balls.splice(i, 1);
        continue;
      }
      if (now >= b.nextBoltAt && !frozen) {
        b.nextBoltAt = now + this.stats.boltEveryMs;
        this.zap(b, now);
      }
      const key = BALL_KEYS[Math.floor(now / SCIFI.plasmaFrameMs) % 2];
      if (b.img.texture.key !== key) b.img.setTexture(key);
      b.img.setPosition(Math.round(b.x), Math.round(b.y));
      if (Math.random() < 0.5) {
        spawnParticles(this.ctx.scene, b.x, b.y, { count: 1, colors: [C.lime, C.green], speed: 0.8, gravity: 0, lifeMs: 260, size: 1 });
      }
    }
  }

  /** Saette verso le parti più vicine: danno a ogni saetta. */
  private zap(b: Ball, now: number): void {
    const s = this.stats;
    const near: { p: Part; d: number }[] = [];
    for (const p of this.ctx.ragdoll.parts.values()) {
      const d = Math.hypot(p.body.position.x - b.x, p.body.position.y - b.y);
      if (d <= s.boltRange) near.push({ p, d });
    }
    if (!near.length) {
      // scarica a vuoto verso un punto a caso, solo grafica
      const a = Math.random() * Math.PI * 2;
      this.addBolt(b.x, b.y, b.x + Math.cos(a) * 16, b.y + Math.sin(a) * 16, now);
      return;
    }
    near.sort((u, v) => u.d - v.d);
    for (let k = 0; k < Math.min(s.boltCount, near.length); k++) {
      const p = near[k].p;
      const px = Math.round(p.body.position.x);
      const py = Math.round(p.body.position.y);
      this.addBolt(b.x, b.y, px, py, now);
      this.hit({ part: p.name, x: px, y: py, amount: s.damage * s.boltShare * b.power, weaponId: this.id });
      const d = near[k].d || 1;
      this.ctx.ragdoll.applyImpulse(p, px, py, ((px - b.x) / d) * 1.5, ((py - b.y) / d) * 1.5 - 0.5);
    }
    noise({ dur: 0.05, vol: 0.12, freq: 6000, freqTo: 1500, highpass: true });
    tone({ type: 'square', from: 2200 + Math.random() * 800, to: 900, dur: 0.04, vol: 0.05 });
  }

  private addBolt(x0: number, y0: number, x1: number, y1: number, now: number): void {
    if (this.bolts.length >= SCIFI.maxBolts) this.bolts.shift();
    // spezzata con 4-6 segmenti e deviazioni casuali perpendicolari
    const pts: number[] = [x0, y0];
    const n = 4 + Math.floor(Math.random() * 3);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const off = (Math.random() - 0.5) * Math.min(10, len * 0.35);
      pts.push(x0 + dx * t + (-dy / len) * off, y0 + dy * t + (dx / len) * off);
    }
    pts.push(x1, y1);
    this.bolts.push({ pts, bornAt: now });
  }

  private explode(b: Ball): void {
    const { scene, ragdoll } = this.ctx;
    const s = this.stats;
    const x = Math.round(b.x);
    const y = Math.round(b.y);
    for (const p of ragdoll.parts.values()) {
      const pos = p.body.position;
      const d = Math.hypot(pos.x - x, pos.y - y);
      if (d > s.radius) continue;
      const k = 1 - d / s.radius;
      this.hit({ part: p.name, x: Math.round(pos.x), y: Math.round(pos.y), amount: s.damage * b.power * (0.4 + 0.6 * k), weaponId: this.id });
    }
    const pushed = ragdoll.applyRadialImpulse(x, y, s.pushRadius, s.pushStrength * b.power);
    if (pushed.length) ragdoll.addVelocity(0, -3 * b.power);
    // lampo a tutto schermo, onda d'urto, schegge di energia
    if (this.flash) {
      this.flash.setFillStyle(col(C.lime), 0.55).setVisible(true);
      this.flashLeft = SCIFI.plasmaFlashFrames;
    }
    this.waves.push({ x, y, bornAt: scene.time.now });
    if (this.waves.length > 3) this.waves.shift();
    popFrames(scene, x, y, [BALL_KEYS[1], BALL_KEYS[0], FIZZLE_KEYS[0], FIZZLE_KEYS[1]], 50);
    spawnParticles(scene, x, y, { count: 24, colors: [C.lime, C.green, C.white, C.teal], speed: 4.5, gravity: 0.06, lifeMs: 520 });
    shake(scene, SCIFI.plasmaShakePx, SCIFI.plasmaShakeMs);
    hitStop(scene, SCIFI.plasmaHitStopMs);
    playExplosion();
    tone({ type: 'square', from: 900, to: 60, dur: 0.4, vol: 0.14 });
    noise({ dur: 0.5, vol: 0.2, freq: 8000, freqTo: 600, highpass: true });
  }

  /** Saette e onde d'urto: pixel su un solo Graphics, ridisegnato ogni frame. */
  private draw(now: number): void {
    const dots = this.dots;
    if (!dots) return;
    dots.begin();
    let w = 0;
    for (const bolt of this.bolts) {
      if (now - bolt.bornAt >= SCIFI.boltMs) continue;
      this.bolts[w++] = bolt;
      const p = bolt.pts;
      for (let i = 0; i + 3 < p.length; i += 2) {
        dots.line(p[i], p[i + 1], p[i + 2], p[i + 3], i % 4 === 0 ? C.white : C.lime);
      }
    }
    this.bolts.length = w;

    w = 0;
    for (const wave of this.waves) {
      const k = (now - wave.bornAt) / SCIFI.plasmaWaveMs;
      if (k >= 1) continue;
      this.waves[w++] = wave;
      const r = Math.round(4 + k * SCIFI.plasmaWaveRadius);
      const n = Math.max(12, Math.round(r * 1.6));
      const c = k < 0.4 ? C.white : k < 0.75 ? C.lime : C.green;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        dots.dot(wave.x + Math.cos(a) * r, wave.y + Math.sin(a) * r, c, k < 0.5 ? 2 : 1);
      }
    }
    this.waves.length = w;
  }

  /** Per il debug da console. */
  get debugCounts(): { balls: number; bolts: number; waves: number; charge: number } {
    return { balls: this.balls.length, bolts: this.bolts.length, waves: this.waves.length, charge: this.charge };
  }
}
