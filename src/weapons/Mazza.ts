import Phaser from 'phaser';
import { MELEE2, ROOM_INNER, WEAPON_STATS } from '../config/balance';
import { C } from '../config/palette';
import { noise, tone } from '../audio/sfx';
import type { Part } from '../entities/Ragdoll';
import { shake, spawnParticles } from '../gfx/effects';
import { makeSprites, type SpriteData } from '../gfx/pixelSprite';
import { MeleeAnims, partsAlongSegment, PixelTrail, snap45, STEP45, swingFrames, type AnimFrame } from './meleeFx';
import { Weapon, type WeaponPointer } from './Weapon';

type BatStats = (typeof WEAPON_STATS)['mazza'];

/** icona: mazza di legno con chiodi, impugnatura col nastro */
const BAT_ICON: SpriteData = [
  '......00.',
  '....00430',
  '...0d4320',
  '...0432d0',
  '...03200.',
  '..0fe0...',
  '.0fe0....',
  '0fe0.....',
  '.00......',
];

/** a schermo, dritta: testa (coi chiodi) a destra */
const BAT_H: SpriteData = [
  '............0..0....',
  '.0........00d00d000.',
  '0e000000004444444440',
  '0efefe4444333c333330',
  '0efefe33333333333330',
  '0e000000002222222220',
  '.0........000d00d00.',
  '.............0..0...',
];

/** a schermo, diagonale: testa in basso a destra */
const BAT_D: SpriteData = [
  '..0.............',
  '.0e0............',
  '0eef0...........',
  '.00ef0..........',
  '...0ef0.........',
  '....0e30........',
  '.....0320.......',
  '.....043200.....',
  '......0432d0....',
  '......0d43200...',
  '.......00432d0..',
  '........0d4320..',
  '.........004320.',
  '..........0d40..',
  '...........00...',
  '................',
];

/** stellina del fuoricampo (2 frame che si alternano) */
const STAR_A: SpriteData = [
  '...4...',
  '...4...',
  '.44c44.',
  '4cccc44',
  '.4ccc4.',
  '.4c.c4.',
  '4.....4',
];
const STAR_B: SpriteData = [
  '.......',
  '...4...',
  '..4c4..',
  '.4ccc4.',
  '..4c4..',
  '...4...',
  '.......',
];

const KEYS = { straight: 'fx-bat-h', diagonal: 'fx-bat-d' } as const;

interface Stroke {
  id: number;
  lastX: number;
  lastY: number;
}

/**
 * Mazza chiodata: si usa con uno SWIPE. Trascinando il dito sopra Tony parte
 * uno swing nella direzione del gesto; più è veloce, più forte è il colpo.
 * Un gesto molto veloce è un fuoricampo: Tony vola e compare la stellina.
 * Non afferra Tony (il trascinamento è il gesto dello swing).
 */
export class Mazza extends Weapon<BatStats> {
  readonly id = 'mazza';
  readonly name = 'MAZZA';
  readonly icon = BAT_ICON;
  override readonly allowsGrab = false;

  private anims: MeleeAnims | null = null;
  private trail: PixelTrail | null = null;
  private stroke: Stroke | null = null;
  private readonly found = new Map<Part, { x: number; y: number }>();

  activate(): void {
    super.activate();
    const scene = this.ctx.scene;
    makeSprites(scene, {
      [KEYS.straight]: BAT_H,
      [KEYS.diagonal]: BAT_D,
      'fx-hr-star-a': STAR_A,
      'fx-hr-star-b': STAR_B,
    });
    this.anims = new MeleeAnims(scene);
    this.trail = new PixelTrail(scene, { core: C.white, glow: C.yellow, tail: C.silver, lifeMs: 200, max: 30 });
  }

  deactivate(): void {
    this.anims?.clear();
    this.trail?.destroy();
    this.anims = null;
    this.trail = null;
    this.stroke = null;
  }

  onPointerDown(p: WeaponPointer): void {
    if (this.stroke) return;
    this.stroke = { id: p.id, lastX: p.x, lastY: p.y };
  }

  onPointerMove(p: WeaponPointer): void {
    this.advance(p);
  }

  onPointerUp(p: WeaponPointer): void {
    this.advance(p);
    if (this.stroke?.id === p.id) this.stroke = null;
  }

  update(): void {
    this.anims?.update();
    this.trail?.update();
  }

  /** Nuovo tratto del gesto: se è veloce e attraversa Tony parte lo swing. */
  private advance(p: WeaponPointer): void {
    const st = this.stroke;
    if (!st || st.id !== p.id) return;
    const x0 = st.lastX;
    const y0 = st.lastY;
    st.lastX = p.x;
    st.lastY = p.y;
    const s = this.stats;
    const speed = Math.hypot(p.vx, p.vy);
    if (speed < s.minSpeed) return;
    if (p.time - this.lastUseAt < s.cooldownMs) return;
    this.found.clear();
    partsAlongSegment(this.ctx.ragdoll, x0, y0, p.x, p.y, s.hitTolerance, this.found);
    if (this.found.size === 0) return;
    // la prima parte toccata lungo il gesto
    const [part, at] = this.found.entries().next().value as [Part, { x: number; y: number }];
    this.lastUseAt = p.time;
    this.swing(part, at.x, at.y, p.vx / speed, p.vy / speed, speed);
  }

  private swing(part: Part, x: number, y: number, ux: number, uy: number, speed: number): void {
    const { ragdoll, scene } = this.ctx;
    const s = this.stats;
    const mult = Phaser.Math.Clamp(speed / s.refSpeed, s.minMult, s.maxMult);
    const homeRun = speed >= s.homeRunSpeed;

    // spinta laterale fortissima nella direzione del gesto, un po' verso l'alto
    let dx = ux;
    let dy = uy - s.upwardBias;
    const n = Math.hypot(dx, dy);
    dx /= n;
    dy /= n;
    const push = homeRun ? s.homeRunPush : s.bodyPush * mult;
    ragdoll.applyImpulse(part, x, y, dx * s.impulse * mult, dy * s.impulse * mult);
    ragdoll.addVelocity(dx * push, dy * push, part);
    this.hit({ part: part.name, x, y, amount: s.damage * mult * (homeRun ? 1.15 : 1), weaponId: this.id });

    // animazione: la mazza gira attorno alla mano e la testa passa dal punto
    const phi = snap45(Math.atan2(uy, ux));
    // verso dello swing scelto perché la mazza arrivi "dall'alto"
    const sense: 1 | -1 = Math.sin(phi - Math.PI / 2) <= 0 ? 1 : -1;
    const theta = phi - sense * (Math.PI / 2);
    const L = MELEE2.batLen;
    const px = x - Math.cos(theta) * L;
    const py = y - Math.sin(theta) * L;
    const frames = swingFrames(KEYS, px, py, L, theta - sense * STEP45 * 2, 5, sense);
    if (sense < 0) frames.forEach((f) => (f.flipY = true));
    this.anims?.play(frames, MELEE2.batFrameMs);
    this.trail?.addArc(px, py, L, theta - sense * STEP45 * 2, theta + sense * STEP45 * 2, homeRun ? 3 : 2, 8);

    spawnParticles(scene, x, y, {
      count: homeRun ? 10 : 6,
      colors: [C.yellow, C.orange, C.white],
      speed: 2 + mult * 1.5,
      angle: Math.atan2(dy, dx),
      spread: 1.4,
      lifeMs: 320,
    });
    playBatHit(mult);
    if (homeRun) this.homeRun(x, y, dx, dy);
  }

  /** Fuoricampo: "ding!" e una stellina che vola via nella direzione del colpo. */
  private homeRun(x: number, y: number, dx: number, dy: number): void {
    const frames: AnimFrame[] = [];
    const n = Math.round(MELEE2.starMs / MELEE2.starFrameMs);
    let sx = x;
    let sy = y;
    const vy = Math.min(dy, -0.5);
    const l = Math.hypot(dx, vy);
    for (let i = 0; i < n; i++) {
      sx = Phaser.Math.Clamp(sx + (dx / l) * 7, ROOM_INNER.left + 4, ROOM_INNER.right - 4);
      sy = Phaser.Math.Clamp(sy + (vy / l) * 7, ROOM_INNER.top + 4, ROOM_INNER.bottom - 4);
      frames.push({ key: i % 2 === 0 ? 'fx-hr-star-a' : 'fx-hr-star-b', x: sx, y: sy });
    }
    this.anims?.play(frames, MELEE2.starFrameMs, 59);
    shake(this.ctx.scene, 3, 160);
    tone({ type: 'square', from: 1568, dur: 0.08, vol: 0.1, delay: 0.05 });
    tone({ type: 'square', from: 2093, dur: 0.22, vol: 0.1, delay: 0.13 });
  }
}

/** Botta di legno: "tock" vuoto e sordo, più grave e lungo se il colpo è forte. */
function playBatHit(mult: number): void {
  const k = Math.min(1, mult / 1.6);
  tone({ type: 'square', from: 520 - k * 120, to: 180, dur: 0.06, vol: 0.16 });
  tone({ type: 'triangle', from: 170, to: 50, dur: 0.12 + k * 0.08, vol: 0.4 });
  noise({ dur: 0.08, vol: 0.3, freq: 2400, freqTo: 300 });
  noise({ dur: 0.1, vol: 0.12, freq: 500, freqTo: 2600, highpass: true });
}
