import { ANIM_MELEE, WEAPON_STATS } from '../config/balance';
import { C } from '../config/palette';
import { noise, tone } from '../audio/sfx';
import { spawnParticles } from '../gfx/effects';
import { makeSprites, type SpriteData } from '../gfx/pixelSprite';
import { dirIndex, rasterSprite, ThrownWeapon, type ShapeFn, type VibFrame } from './Shuriken';

type ColtelloStats = (typeof WEAPON_STATS)['coltello'];

/** coltello a 45°, punta in basso a destra: icona */
const KNIFE_ICON: SpriteData = [
  '.0......',
  '020.0...',
  '.010e0..',
  '..0e00..',
  '.0e0cd0.',
  '..0.0cd0',
  '.....0c0',
  '......0.',
];

const KNIFE_SIZE = 17;
/** punta della lama (u) e perno della vibrazione (dove entra nella stoffa) */
const TIP_U = 6.5;
const PIVOT_U = 3;
/** piega del manico nei frame di vibrazione (rad) */
const WOBBLE = 0.2;

/** coltello lungo +u: lama bianco/argento con dorso dritto, guardia, manico rosso */
function knifeShape(wobble: number): ShapeFn {
  const c = Math.cos(-wobble);
  const s = Math.sin(-wobble);
  return (u0, v0) => {
    // la vibrazione ruota tutto attorno al punto in cui la lama entra
    const du = u0 - PIVOT_U;
    const u = PIVOT_U + du * c - v0 * s;
    const v = du * s + v0 * c;
    if (u > -0.6 && u < TIP_U) {
      const top = -1.3 + Math.max(0, u - 4) * 0.55;
      const bot = 1.3 - Math.max(0, u - 1) * 0.42;
      if (v >= top && v <= bot) return v < -0.2 ? 'c' : 'd';
      return null;
    }
    if (u >= -2 && u <= -0.6 && Math.abs(v) <= 2.1) return 'f'; // guardia
    if (u >= -6.6 && u < -2 && Math.abs(v) <= 1.15) {
      if (u < -5.6) return 'f'; // pomolo
      if (Math.abs(u + 4.2) < 0.5) return '4'; // rivetto
      return v > 0.2 ? '1' : '2';
    }
    return null;
  };
}

/** imbottitura che schizza fuori (Tony è di pezza) */
const STUFFING = [C.white, C.white, C.silver] as const;

/**
 * Coltello: più lento dello shuriken ma fa più danno. In volo ruota a scatti
 * (8 direzioni) con la scia; si pianta di punta con un "thunk" e vibra.
 */
export class Coltello extends ThrownWeapon<ColtelloStats> {
  readonly id = 'coltello';
  readonly name = 'COLTELLO';
  readonly icon = KNIFE_ICON;
  protected readonly spinsInFlight = false;
  /** vibrazione dell'impugnatura: 3 frame */
  protected readonly vibFrames: readonly VibFrame[] = [
    { perp: 0, wobble: 1 },
    { perp: 0, wobble: -1 },
    { perp: 0, wobble: 1 },
  ];

  protected makeTextures(): void {
    if (this.ctx.scene.textures.exists('fx-knife-0')) return;
    const sprites: Record<string, SpriteData> = {};
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      sprites[`fx-knife-${k}`] = rasterSprite(KNIFE_SIZE, KNIFE_SIZE, a, knifeShape(0));
      sprites[`fx-knife-${k}-p`] = rasterSprite(KNIFE_SIZE, KNIFE_SIZE, a, knifeShape(WOBBLE));
      sprites[`fx-knife-${k}-m`] = rasterSprite(KNIFE_SIZE, KNIFE_SIZE, a, knifeShape(-WOBBLE));
    }
    makeSprites(this.ctx.scene, sprites);
  }

  protected frameFor(angle: number, _age: number, _spinning: boolean, wobble: -1 | 0 | 1): { key: string; rotation: number } {
    const k = dirIndex(angle, 8);
    return { key: wobble === 0 ? `fx-knife-${k}` : `fx-knife-${k}-${wobble > 0 ? 'p' : 'm'}`, rotation: 0 };
  }

  protected tipReach(): number {
    return ANIM_MELEE.knifeTipReach;
  }

  protected flightSpin(): number {
    return ANIM_MELEE.knifeSpinPerStep;
  }

  /** luccichio sulla parte di lama ancora fuori */
  protected glintOffset(angle: number): { x: number; y: number } {
    const a = dirIndex(angle, 8) * (Math.PI / 4);
    return { x: Math.cos(a) * 1 - 1, y: Math.sin(a) * 1 - 1 };
  }

  protected onStick(x: number, y: number, dx: number, dy: number): void {
    spawnParticles(this.ctx.scene, x, y, {
      count: 7,
      colors: STUFFING,
      speed: 2.2,
      angle: Math.atan2(-dy, -dx),
      spread: 1.9,
      lifeMs: 420,
      gravity: 0.12,
    });
  }

  protected playSwish(): void {
    noise({ dur: 0.12, vol: 0.16, freq: 500, freqTo: 3200, highpass: true });
    tone({ type: 'triangle', from: 300, to: 520, dur: 0.08, vol: 0.06 });
  }

  /** "thunk" sordo + vibrazione della lama (tre colpetti calanti) */
  protected playThunk(): void {
    tone({ type: 'triangle', from: 260, to: 70, dur: 0.09, vol: 0.32 });
    noise({ dur: 0.05, vol: 0.18, freq: 1400, freqTo: 250 });
    for (let i = 0; i < 3; i++) {
      tone({ type: 'square', from: 190 - i * 12, to: 170 - i * 12, dur: 0.028, vol: 0.05 - i * 0.012, delay: 0.05 + i * 0.038 });
    }
  }
}
