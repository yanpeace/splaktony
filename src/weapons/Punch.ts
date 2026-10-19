import { WEAPON_STATS } from '../config/balance';
import { C } from '../config/palette';
import { playPunch, playWhiff } from '../audio/sfx';
import { popFrames, spawnParticles } from '../gfx/effects';
import { makeSprites, type SpriteData } from '../gfx/pixelSprite';
import { Weapon, type WeaponPointer } from './Weapon';

type PunchStats = (typeof WEAPON_STATS)['punch'];

const GLOVE: SpriteData = [
  '..00000..',
  '.0233220.',
  '023322220',
  '022222220',
  '022222220',
  '022222220',
  '.0222220.',
  '..0ccc0..',
  '..00000..',
];

const POW: SpriteData = [
  '.....4.....',
  '..4..4..4..',
  '...4.4.4...',
  '....444....',
  '4444ccc4444',
  '....444....',
  '...4.4.4...',
  '..4..4..4..',
  '.....4.....',
];

const POW_SMALL: SpriteData = [
  '...........',
  '...........',
  '....4.4....',
  '.....4.....',
  '...4.c.4...',
  '.....4.....',
  '....4.4....',
  '...........',
  '...........',
];

const FRAMES = ['fx-glove', 'fx-pow', 'fx-pow-small'];

/**
 * Pugno: un tap su Tony (tocco breve, senza trascinare) dà un impulso forte
 * nel punto toccato + danno diretto. Un tap a vuoto fa solo "whoosh".
 */
export class Punch extends Weapon<PunchStats> {
  readonly id = 'punch';
  readonly name = 'PUGNO';
  readonly icon = GLOVE;

  activate(): void {
    super.activate();
    makeSprites(this.ctx.scene, { 'fx-glove': GLOVE, 'fx-pow': POW, 'fx-pow-small': POW_SMALL });
  }

  onPointerUp(p: WeaponPointer): void {
    if (p.wasGrab) return;
    if (!this.tryUse(p.time)) return;

    const { scene, ragdoll } = this.ctx;
    const hit = p.downHit;
    const x = p.downX;
    const y = p.downY;

    if (!hit) {
      playWhiff();
      popFrames(scene, x, y, ['fx-glove', 'fx-pow-small'], 45);
      return;
    }

    const s = this.stats;
    const part = hit.part;
    const com = ragdoll.centerOfMass();
    // direzione: dal punto toccato verso il centro della parte/corpo, con spinta in su
    let dx = part.body.position.x - x + (com.x - x) * 0.5;
    let dy = part.body.position.y - y + (com.y - y) * 0.5;
    let len = Math.hypot(dx, dy);
    if (len < 0.5) {
      dx = Math.random() < 0.5 ? -1 : 1;
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

    playPunch();
    popFrames(scene, x, y, FRAMES, 40, { flipX: dx < 0 });
    spawnParticles(scene, x, y, {
      count: 4,
      colors: [C.yellow, C.white],
      speed: 2.5,
      angle: Math.atan2(-dy, -dx),
      spread: 1.6,
      size: 1,
      lifeMs: 250,
      gravity: 0,
    });
  }
}
