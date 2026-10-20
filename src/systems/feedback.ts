import Phaser from 'phaser';
import { FX } from '../config/balance';
import { C } from '../config/palette';
import { playCoin, playHit, playSqueak, playWhoosh } from '../audio/sfx';
import { damageColor, damageNumber, hitStop, shake, spawnParticles } from '../gfx/effects';
import { Subscriptions } from './events';

/** colori dei pezzetti che volano via: pettorina gialla, jeans, maglietta, pelle, bande riflettenti */
const FABRIC = [C.yellow, C.yellow, C.blue, C.blue, C.black, C.charcoal, C.pink, C.silver] as const;

/**
 * Feedback dei colpi: ascolta gli eventi e chiama effects/sfx.
 * (Il flash bianco sulla parte colpita lo fa il Ragdoll stesso.)
 * Ritorna le iscrizioni: chiudile allo shutdown della scena.
 */
export function bindHitFeedback(scene: Phaser.Scene): Subscriptions {
  const subs = new Subscriptions();

  subs.on('damage', (e) => {
    const intensity = Phaser.Math.Clamp(e.amount / (FX.strongHitDamage * 2), 0.1, 1);
    damageNumber(scene, e.x, e.y - 4, String(e.amount), damageColor(e.amount));
    spawnParticles(scene, e.x, e.y, {
      count: Phaser.Math.Clamp(Math.round(e.amount * FX.particlesPerDamage), FX.particlesMin, FX.particlesMax),
      colors: FABRIC,
      speed: 1.5 + intensity * 3,
    });
    playHit(intensity);
    if (e.part === 'head') playSqueak();
    if (e.strong) {
      const big = e.amount >= FX.numberHuge;
      shake(scene, big ? FX.shakeBigPx : FX.shakePx, FX.shakeMs);
      hitStop(scene, Phaser.Math.Linear(FX.hitStopMinMs, FX.hitStopMaxMs, intensity));
    }
  });

  subs.on('ragdoll:release', (e) => {
    if (Math.hypot(e.vx, e.vy) > 6) playWhoosh();
  });

  subs.on('coins:changed', (e) => {
    if (e.delta > 0) playCoin();
  });

  return subs;
}
