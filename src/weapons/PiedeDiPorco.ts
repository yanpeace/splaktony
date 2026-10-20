import { MELEE2, WEAPON_STATS } from '../config/balance';
import { C } from '../config/palette';
import { noise, playWhiff, tone } from '../audio/sfx';
import type { Part } from '../entities/Ragdoll';
import { spawnParticles } from '../gfx/effects';
import { makeSprites, type SpriteData } from '../gfx/pixelSprite';
import { MeleeAnims, PixelTrail, snap45, STEP45, swingFrames } from './meleeFx';
import { Weapon, type WeaponPointer } from './Weapon';

type CrowStats = (typeof WEAPON_STATS)['piedediporco'];

/** icona: piede di porco rosso/arancio in diagonale, uncino in alto a destra */
const CROW_ICON: SpriteData = [
  '.....00..',
  '....0330.',
  '...020030',
  '....00320',
  '....0320.',
  '...0320..',
  '.00320...',
  '0d320....',
  '.000.....',
];

/** a schermo, dritto: uncino (punta) a destra */
const CROW_H: SpriteData = [
  '............00..',
  '...........0330.',
  '..........030030',
  '..........020020',
  '..00000000000020',
  '.0d3333333333320',
  '0d2222222222220.',
  '.0000000000000..',
];

/** a schermo, diagonale: uncino in basso a destra */
const CROW_D: SpriteData = [
  '.000..........',
  '0d320.........',
  '.00320........',
  '...0320.......',
  '....0320......',
  '.....0320.....',
  '......0320....',
  '.......0320...',
  '........0320..',
  '........00320.',
  '.......0200320',
  '.......030030.',
  '........0330..',
  '.........00...',
];

/** scintilla dell'impatto metallico (2 frame) */
const CLANG_A: SpriteData = [
  '...c...',
  '.c.4.c.',
  '..444..',
  'c44c44c',
  '..444..',
  '.c.4.c.',
  '...c...',
];
const CLANG_B: SpriteData = [
  '.......',
  '...4...',
  '..4.4..',
  '.4...4.',
  '..4.4..',
  '...4...',
  '.......',
];

const KEYS = { straight: 'fx-crow-h', diagonal: 'fx-crow-d' } as const;

interface PendingHit {
  at: number;
  part: Part;
  sense: 1 | -1;
}

/**
 * Piede di porco: tap su Tony = colpo rotante (l'attrezzo gira a scatti di
 * 45° attorno al punto) con "clang" metallico. Il 20% dei colpi è doppio:
 * dopo un attimo torna indietro e colpisce di nuovo. Tenere premuto afferra
 * Tony come col pugno.
 */
export class PiedeDiPorco extends Weapon<CrowStats> {
  readonly id = 'piedediporco';
  readonly name = 'PIEDIPORCO';
  readonly icon = CROW_ICON;

  private anims: MeleeAnims | null = null;
  private trail: PixelTrail | null = null;
  private pending: PendingHit | null = null;
  private sense: 1 | -1 = 1;

  activate(): void {
    super.activate();
    const scene = this.ctx.scene;
    makeSprites(scene, {
      [KEYS.straight]: CROW_H,
      [KEYS.diagonal]: CROW_D,
      'fx-clang-a': CLANG_A,
      'fx-clang-b': CLANG_B,
    });
    this.anims = new MeleeAnims(scene);
    this.trail = new PixelTrail(scene, { core: C.white, glow: C.orange, tail: C.silver, lifeMs: 170, max: 24 });
  }

  deactivate(): void {
    this.anims?.clear();
    this.trail?.destroy();
    this.anims = null;
    this.trail = null;
    this.pending = null;
  }

  onPointerUp(p: WeaponPointer): void {
    if (p.wasGrab || !this.anims) return;
    if (!this.tryUse(p.time)) return;
    const hit = p.downHit;
    // un colpo va e uno torna: il verso dello swing si alterna
    this.sense = this.sense === 1 ? -1 : 1;
    if (!hit) {
      this.swingFx(p.downX, p.downY, this.sense === 1 ? 0 : Math.PI, this.sense);
      playWhiff();
      return;
    }
    this.strike(hit.part, p.downX, p.downY, this.sense, false);
    if (Math.random() < this.stats.doubleChance) {
      this.pending = { at: p.time + MELEE2.crowDoubleDelayMs, part: hit.part, sense: this.sense === 1 ? -1 : 1 };
    }
  }

  update(): void {
    if (this.pending && this.ctx.scene.time.now >= this.pending.at) {
      const { part, sense } = this.pending;
      this.pending = null;
      // il secondo colpo prende la parte dove si trova adesso
      this.strike(part, part.body.position.x, part.body.position.y, sense, true);
    }
    this.anims?.update();
    this.trail?.update();
  }

  private strike(part: Part, x: number, y: number, sense: 1 | -1, second: boolean): void {
    const { ragdoll } = this.ctx;
    const s = this.stats;
    const com = ragdoll.centerOfMass();
    let dx = part.body.position.x - x + (com.x - x) * 0.5;
    let dy = part.body.position.y - y + (com.y - y) * 0.5;
    let len = Math.hypot(dx, dy);
    if (len < 0.5) {
      dx = sense;
      dy = 0;
      len = 1;
    }
    dx /= len;
    dy = dy / len - s.upwardBias;
    const n = Math.hypot(dx, dy);
    dx /= n;
    dy /= n;

    ragdoll.applyImpulse(part, x, y, dx * s.impulse, dy * s.impulse);
    ragdoll.addVelocity(dx * s.impulse * s.bodyShare, dy * s.impulse * s.bodyShare, part);
    this.hit({ part: part.name, x, y, amount: s.damage, weaponId: this.id });

    this.swingFx(x, y, Math.atan2(dy, dx), sense);
    this.anims?.play(
      [
        { key: 'fx-clang-a', x, y },
        { key: 'fx-clang-b', x, y },
      ],
      45,
      58,
    );
    spawnParticles(this.ctx.scene, x, y, {
      count: 5,
      colors: [C.yellow, C.white, C.orange],
      speed: 3,
      angle: Math.atan2(-dy, -dx),
      spread: 1.8,
      size: 1,
      lifeMs: 260,
      gravity: 0.12,
    });
    playClang(second ? 1.12 : 1);
  }

  /**
   * Swing visivo: la punta passa dal punto (x,y) muovendosi nella direzione
   * `push`; l'attrezzo ruota attorno alla mano a scatti di 45°.
   */
  private swingFx(x: number, y: number, push: number, sense: 1 | -1): void {
    if (!this.anims || !this.trail) return;
    const L = MELEE2.crowLen;
    const phi = snap45(push);
    // all'impatto l'attrezzo è perpendicolare alla spinta
    const theta = phi - sense * (Math.PI / 2);
    const px = x - Math.cos(theta) * L;
    const py = y - Math.sin(theta) * L;
    const frames = swingFrames(KEYS, px, py, L, theta - sense * STEP45, 4, sense);
    if (sense < 0) frames.forEach((f) => (f.flipY = true));
    this.anims.play(frames, MELEE2.crowFrameMs);
    this.trail.addArc(px, py, L, theta - sense * STEP45 * 1.5, theta + sense * STEP45 * 1.5, 2, 6);
  }
}

/** "Clang": due quadre acute non armoniche + rumore secco + botta sorda. */
function playClang(pitch: number): void {
  const j = 1 + (Math.random() - 0.5) * 0.06;
  const f = 1750 * pitch * j;
  tone({ type: 'square', from: f, to: f * 0.92, dur: 0.14, vol: 0.09 });
  tone({ type: 'square', from: f * 1.47, to: f * 1.38, dur: 0.2, vol: 0.06 });
  tone({ type: 'triangle', from: f * 2.3, to: f * 2.2, dur: 0.26, vol: 0.05 });
  noise({ dur: 0.04, vol: 0.2, freq: 3500, highpass: true });
  tone({ type: 'triangle', from: 260, to: 90, dur: 0.07, vol: 0.22 });
}
