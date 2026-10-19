import { WEAPON_STATS } from '../config/balance';
import { noise, tone } from '../audio/sfx';
import { makeSprites, type SpriteData } from '../gfx/pixelSprite';
import { quantize45, ThrownWeapon } from './Shuriken';

type ColtelloStats = (typeof WEAPON_STATS)['coltello'];

/** coltello orizzontale, punta a destra (manico rosso/prugna, lama bianco/argento) */
const KNIFE_H: SpriteData = [
  '........',
  '........',
  '0000000.',
  '022eccc0',
  '011edd0.',
  '000000..',
  '........',
  '........',
];

/** coltello a 45°, punta in basso a destra (= KNIFE_H ruotato di +45°) */
const KNIFE_D: SpriteData = [
  '.0......',
  '020.0...',
  '.010e0..',
  '..0e00..',
  '.0e0cd0.',
  '..0.0cd0',
  '.....0c0',
  '......0.',
];

/**
 * Coltello: più lento dello shuriken ma fa più danno. In volo punta sempre
 * nella direzione di lancio (rotazione quantizzata a 45°).
 */
export class Coltello extends ThrownWeapon<ColtelloStats> {
  readonly id = 'coltello';
  readonly name = 'COLTELLO';
  readonly icon = KNIFE_D;
  protected readonly spinsInFlight = false;

  protected makeTextures(): void {
    makeSprites(this.ctx.scene, { 'fx-knife-h': KNIFE_H, 'fx-knife-d': KNIFE_D });
  }

  protected frameFor(angle: number): { key: string; rotation: number } {
    const q = quantize45(angle);
    return { key: q.diagonal ? 'fx-knife-d' : 'fx-knife-h', rotation: q.rotation };
  }

  protected playSwish(): void {
    noise({ dur: 0.12, vol: 0.16, freq: 500, freqTo: 3200, highpass: true });
    tone({ type: 'triangle', from: 300, to: 520, dur: 0.08, vol: 0.06 });
  }
}
