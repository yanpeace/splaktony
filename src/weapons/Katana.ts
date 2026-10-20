import { MELEE2, WEAPON_STATS } from '../config/balance';
import { C } from '../config/palette';
import { noise, tone } from '../audio/sfx';
import type { Part } from '../entities/Ragdoll';
import { spawnParticles } from '../gfx/effects';
import { makeSprites, type SpriteData } from '../gfx/pixelSprite';
import { MeleeAnims, orient8, partsAlongSegment, PixelTrail } from './meleeFx';
import { Weapon, type WeaponPointer } from './Weapon';

type KatanaStats = (typeof WEAPON_STATS)['katana'];

/** icona: katana in diagonale, punta in alto a destra */
const KATANA_ICON: SpriteData = [
  '.......0.',
  '......0c0',
  '.....0cd0',
  '...00cd0.',
  '..04cd0..',
  '..0240...',
  '.0210....',
  '0410.....',
  '.00......',
];

/** a schermo, dritta: punta a destra */
const KATANA_H: SpriteData = [
  '.......0..............',
  '.00000040000000000000.',
  '042c22c4ccccccccccccc0',
  '04121214dddddddddddd0.',
  '.0000004000000000000..',
  '.......0..............',
];

/** a schermo, diagonale: punta in basso a destra */
const KATANA_D: SpriteData = [
  '.00.............',
  '04c0............',
  '.0210...........',
  '..0c10.0........',
  '...02c040.......',
  '....02440.......',
  '....044d0.......',
  '....040cd0......',
  '.....0.0cd0.....',
  '........0cd0....',
  '.........0cd0...',
  '..........0cd0..',
  '...........0c0..',
  '............0c0.',
  '.............0..',
  '................',
];

/** lampo del taglio (2 frame) */
const CUT_A: SpriteData = [
  'c.....c',
  '.c...c.',
  '..cbc..',
  '..bcb..',
  '..cbc..',
  '.c...c.',
  'c.....c',
];
const CUT_B: SpriteData = [
  '.......',
  '.b...b.',
  '..b.b..',
  '...c...',
  '..b.b..',
  '.b...b.',
  '.......',
];

interface Stroke {
  id: number;
  lastX: number;
  lastY: number;
  /** fendente aperto in questo gesto (colpisce ogni parte una volta sola) */
  slashing: boolean;
  swished: boolean;
}

/**
 * Katana: SWIPE veloce = fendente. La scia bianca segue il gesto e ogni parte
 * di Tony attraversata dalla linea viene tagliata (una volta per fendente),
 * con lampo e "SHING". Non afferra Tony.
 */
export class Katana extends Weapon<KatanaStats> {
  readonly id = 'katana';
  readonly name = 'KATANA';
  readonly icon = KATANA_ICON;
  override readonly allowsGrab = false;

  private anims: MeleeAnims | null = null;
  private trail: PixelTrail | null = null;
  private stroke: Stroke | null = null;
  private readonly cut = new Set<Part>();
  private readonly found = new Map<Part, { x: number; y: number }>();

  activate(): void {
    super.activate();
    const scene = this.ctx.scene;
    makeSprites(scene, {
      'fx-katana-h': KATANA_H,
      'fx-katana-d': KATANA_D,
      'fx-cut-a': CUT_A,
      'fx-cut-b': CUT_B,
    });
    this.anims = new MeleeAnims(scene, 10);
    this.trail = new PixelTrail(scene, {
      core: C.white,
      glow: C.cyan,
      tail: C.silver,
      lifeMs: MELEE2.slashTrailMs,
      max: 48,
    });
  }

  deactivate(): void {
    this.anims?.clear();
    this.trail?.destroy();
    this.anims = null;
    this.trail = null;
    this.stroke = null;
    this.cut.clear();
  }

  onPointerDown(p: WeaponPointer): void {
    if (this.stroke) return;
    this.stroke = { id: p.id, lastX: p.x, lastY: p.y, slashing: false, swished: false };
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

  private advance(p: WeaponPointer): void {
    const st = this.stroke;
    if (!st || st.id !== p.id || !this.trail) return;
    const x0 = st.lastX;
    const y0 = st.lastY;
    st.lastX = p.x;
    st.lastY = p.y;
    const s = this.stats;
    const speed = Math.hypot(p.vx, p.vy);
    if (speed < s.minSpeed) {
      // il gesto ha rallentato: il fendente finisce
      st.slashing = false;
      return;
    }
    if (x0 === p.x && y0 === p.y) return;
    this.trail.add(x0, y0, p.x, p.y, 2);
    if (!st.swished) {
      st.swished = true;
      playSwish();
    }

    this.found.clear();
    partsAlongSegment(this.ctx.ragdoll, x0, y0, p.x, p.y, s.hitTolerance, this.found);
    if (this.found.size === 0) return;
    if (!st.slashing) {
      // nuovo fendente: rispetta la cadenza
      if (!this.tryUse(p.time)) return;
      st.slashing = true;
      this.cut.clear();
      playShing();
      this.showBlade(p.x, p.y, p.vx / speed, p.vy / speed);
    }
    const ux = p.vx / speed;
    const uy = p.vy / speed;
    for (const [part, at] of this.found) {
      if (this.cut.has(part) || this.cut.size >= s.maxParts) continue;
      this.cut.add(part);
      this.slice(part, at.x, at.y, ux, uy);
    }
  }

  private slice(part: Part, x: number, y: number, ux: number, uy: number): void {
    const s = this.stats;
    this.ctx.ragdoll.applyImpulse(part, x, y, ux * s.impulse, uy * s.impulse - 0.6);
    this.hit({ part: part.name, x, y, amount: s.damage, weaponId: this.id });
    this.anims?.play(
      [
        { key: 'fx-cut-a', x, y },
        { key: 'fx-cut-b', x, y },
      ],
      MELEE2.slashFrameMs,
      58,
    );
    // scintille bianche perpendicolari al taglio
    spawnParticles(this.ctx.scene, x, y, {
      count: 4,
      colors: [C.white, C.cyan, C.sky],
      speed: 2.6,
      angle: Math.atan2(uy, ux) + (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2),
      spread: 1,
      size: 1,
      lifeMs: 240,
      gravity: 0.05,
    });
  }

  /** La lama compare lungo il gesto per un attimo, avanzando a scatti. */
  private showBlade(x: number, y: number, ux: number, uy: number): void {
    const o = orient8(Math.atan2(uy, ux));
    const key = o.diagonal ? 'fx-katana-d' : 'fx-katana-h';
    const frames = [0, 8, 16].map((d) => ({ key, x: x + ux * (d - 6), y: y + uy * (d - 6), rotation: o.rotation }));
    this.anims?.play(frames, MELEE2.slashFrameMs, 57);
  }
}

function playSwish(): void {
  noise({ dur: 0.1, vol: 0.14, freq: 1200, freqTo: 6000, highpass: true });
}

/** "SHING": attacco metallico brillante che risuona. */
function playShing(): void {
  noise({ dur: 0.05, vol: 0.18, freq: 5000, highpass: true });
  tone({ type: 'square', from: 2300, to: 3300, dur: 0.05, vol: 0.06 });
  tone({ type: 'triangle', from: 3950, to: 3700, dur: 0.32, vol: 0.09, delay: 0.03 });
  tone({ type: 'square', from: 2630, to: 2500, dur: 0.22, vol: 0.035, delay: 0.03 });
}
