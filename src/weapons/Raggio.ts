import Phaser from 'phaser';
import { PHYSICS, SCIFI, WEAPON_STATS } from '../config/balance';
import { C } from '../config/palette';
import { noise, tone } from '../audio/sfx';
import { acquireImage, isFrozen, popFrames, releaseImage, shake, spawnParticles } from '../gfx/effects';
import { makeSprites, type SpriteData } from '../gfx/pixelSprite';
import { PixelGrid, ViewModel, insideRoom } from './scifiView';
import { Weapon, type WeaponPointer } from './Weapon';

type RaggioStats = (typeof WEAPON_STATS)['raggio'];

const ICON_RAGGIO: SpriteData = [
  '....5....',
  '...060...',
  '...0d0...',
  '.00ddd00.',
  '022d5d220',
  '.00ddd00.',
  '...0f0...',
  '...0f0...',
  '...000...',
];

/** Anello di energia (3 frame pulsanti) e piccola esplosione verde (3 frame). */
const RING_A: SpriteData = ['..555..', '.5ccc5.', '5c...c5', '5c...c5', '5c...c5', '.5ccc5.', '..555..'];
const RING_B: SpriteData = ['..666..', '.65556.', '65...56', '65...56', '65...56', '.65556.', '..666..'];
const RING_C: SpriteData = ['.......', '..555..', '.5ccc5.', '.5c.c5.', '.5ccc5.', '..555..', '.......'];
const RING_KEYS = ['fx-ray-ring-a', 'fx-ray-ring-b', 'fx-ray-ring-c'] as const;

function boomFrame(r: number, hollow: number, outer: string, inner: string): SpriteData {
  const g = new PixelGrid(17, 17);
  g.disc(8, 8, r, outer).disc(8, 8, r - 1, inner);
  if (hollow > 0) g.disc(8, 8, hollow, '.');
  return g.rows();
}
const BOOM_KEYS = ['fx-ray-boom-a', 'fx-ray-boom-b', 'fx-ray-boom-c'] as const;

/** Viewmodel: pistola a raggi retrò, corpo tondo con alette rosse e finestra d'energia verde. */
function raggioFrames(): SpriteData[] {
  const glow = [
    ['7', '6', '5'],
    ['6', '5', 'c'],
    ['5', 'c', 'c'],
  ];
  return glow.map(([dim, mid, hot]) => {
    const g = new PixelGrid(27, 26);
    // canna con punta emittente e due bobine d'energia
    g.rect(11, 2, 5, 10, '0').rect(12, 2, 3, 10, 'd').vline(12, 3, 8, 'c').vline(14, 3, 8, 'e');
    g.ball(13, 2, 2, mid).px(13, 2, hot);
    g.hline(9, 5, 9, '0').hline(10, 5, 7, mid).px(11, 5, hot);
    g.hline(9, 8, 9, '0').hline(10, 8, 7, dim).px(11, 8, mid);
    // alette rosse ai lati (triangoli)
    for (let i = 0; i < 6; i++) {
      g.hline(7 - i, 11 + i, i + 2, '0');
      if (i > 0) g.hline(8 - i, 11 + i, i, i < 2 ? '3' : '2');
    }
    g.hline(1, 17, 7, '0').hline(2, 16, 5, '1');
    g.mirrorX();
    // corpo tondo
    g.ball(13, 14, 6, 'd');
    g.disc(11.5, 12.5, 2.5, 'c');
    g.px(17, 16, 'e').px(16, 18, 'e').px(18, 15, 'e').px(17, 17, 'e');
    // finestra d'energia
    g.ball(13, 14, 3, mid).disc(13, 14, 1, hot).px(12, 13, 'c');
    // impugnatura e guanto
    g.box(9, 19, 9, 7, 'f').hline(10, 20, 7, 'e').px(11, 22, '0').px(13, 22, '0').px(15, 22, '0').hline(10, 24, 7, '0');
    return g.rows();
  });
}

interface Shot {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
}

/**
 * Pistola a raggi: ogni tap spara un anello di energia verde veloce verso il
 * dito; all'impatto (Tony o muro) piccola esplosione verde ad area con spinta.
 */
export class Raggio extends Weapon<RaggioStats> {
  readonly id = 'raggio';
  readonly name = 'RAGGI';
  readonly icon = ICON_RAGGIO;
  override readonly allowsGrab = false;

  private view: ViewModel | null = null;
  private shots: Shot[] = [];
  private glowUntil = 0;

  activate(): void {
    super.activate();
    const scene = this.ctx.scene;
    makeSprites(scene, {
      [RING_KEYS[0]]: RING_A,
      [RING_KEYS[1]]: RING_B,
      [RING_KEYS[2]]: RING_C,
      [BOOM_KEYS[0]]: boomFrame(5, 0, '5', 'c'),
      [BOOM_KEYS[1]]: boomFrame(8, 4, '6', '5'),
      [BOOM_KEYS[2]]: boomFrame(8, 6, '7', '6'),
    });
    this.view = new ViewModel(scene, { key: 'vm-raggio', frames: raggioFrames(), muzzleRow: 0, muzzleCol: 13 });
    this.view.show();
  }

  deactivate(): void {
    this.view?.hide();
    this.view = null;
    this.shots.forEach((s) => releaseImage(s.img));
    this.shots = [];
  }

  onPointerDown(p: WeaponPointer): void {
    const view = this.view;
    if (!view) return;
    view.aim(p.x, p.y);
    view.update(0);
    if (!this.tryUse(p.time)) return;
    const s = this.stats;
    const m = view.muzzle();
    let dx = p.x - m.x;
    let dy = p.y - m.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    if (this.shots.length >= SCIFI.rayMaxLive) releaseImage(this.shots.shift()?.img);
    const img = acquireImage(this.ctx.scene, m.x, m.y, RING_KEYS[0]).setDepth(SCIFI.viewDepth - 1);
    this.shots.push({ img, x: m.x, y: m.y, vx: dx * s.speed, vy: dy * s.speed, age: 0 });
    view.recoil(2);
    this.glowUntil = this.ctx.scene.time.now + SCIFI.rayGlowMs;
    spawnParticles(this.ctx.scene, m.x, m.y, { count: 4, colors: [C.lime, C.white], speed: 1.5, gravity: 0, lifeMs: 180, size: 1, depth: SCIFI.viewDepth + 1 });
    // "piu-piuuu"
    tone({ type: 'square', from: 1600, to: 700, dur: 0.06, vol: 0.1 });
    tone({ type: 'square', from: 1900, to: 380, dur: 0.17, vol: 0.09, delay: 0.06 });
    tone({ type: 'triangle', from: 950, to: 260, dur: 0.2, vol: 0.12, delay: 0.06 });
  }

  onPointerMove(p: WeaponPointer): void {
    this.view?.aim(p.x, p.y);
  }

  update(dtMs: number): void {
    const view = this.view;
    if (!view) return;
    const now = this.ctx.scene.time.now;
    view.setFrame(now < this.glowUntil ? 2 : Math.floor(now / 220) % 2);
    view.update(dtMs);
    this.updateShots(dtMs, now);
  }

  private updateShots(dtMs: number, now: number): void {
    const frozen = isFrozen(this.ctx.scene);
    const steps = frozen ? 0 : dtMs / PHYSICS.stepMs;
    const ragdoll = this.ctx.ragdoll;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const sh = this.shots[i];
      sh.age += frozen ? 0 : dtMs;
      // avanza a piccoli passi per non attraversare le parti sottili
      const dist = Math.hypot(sh.vx, sh.vy) * steps;
      const n = Math.max(1, Math.ceil(dist / 2));
      let boom = false;
      for (let k = 0; k < n && steps > 0; k++) {
        sh.x += (sh.vx * steps) / n;
        sh.y += (sh.vy * steps) / n;
        if (ragdoll.partAt(sh.x, sh.y, SCIFI.rayHitTolerance) || !insideRoom(sh.x, sh.y, 1)) {
          boom = true;
          break;
        }
      }
      if (boom || sh.age > SCIFI.rayMaxFlightMs) {
        this.explode(Phaser.Math.Clamp(sh.x, 9, 171), Phaser.Math.Clamp(sh.y, 25, 291));
        releaseImage(sh.img);
        this.shots.splice(i, 1);
        continue;
      }
      const f = Math.floor(now / SCIFI.rayFrameMs) % 3;
      if (sh.img.texture.key !== RING_KEYS[f]) sh.img.setTexture(RING_KEYS[f]);
      sh.img.setPosition(Math.round(sh.x), Math.round(sh.y));
    }
  }

  private explode(x: number, y: number): void {
    const { scene, ragdoll } = this.ctx;
    const s = this.stats;
    const rx = Math.round(x);
    const ry = Math.round(y);
    popFrames(scene, rx, ry, BOOM_KEYS, 55);
    spawnParticles(scene, rx, ry, { count: 10, colors: [C.lime, C.green, C.white], speed: 2.6, gravity: 0.05, lifeMs: 320 });
    for (const p of ragdoll.parts.values()) {
      const pos = p.body.position;
      const d = Math.hypot(pos.x - x, pos.y - y);
      if (d > s.radius) continue;
      const k = 1 - d / s.radius;
      this.hit({ part: p.name, x: Math.round(pos.x), y: Math.round(pos.y), amount: s.damage * (0.35 + 0.65 * k), weaponId: this.id });
    }
    ragdoll.applyRadialImpulse(x, y, s.pushRadius, s.pushStrength);
    shake(scene, 2, 120);
    noise({ dur: 0.16, vol: 0.2, freq: 2400, freqTo: 300 });
    tone({ type: 'square', from: 520, to: 120, dur: 0.14, vol: 0.1 });
  }

  /** Per il debug da console. */
  get debugCounts(): { shots: number } {
    return { shots: this.shots.length };
  }
}
