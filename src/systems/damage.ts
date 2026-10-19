import { DAMAGE, FX } from '../config/balance';
import { events, type PartName } from './events';

/**
 * Punto unico in cui nasce il danno. Armi e fisica chiamano dealDamage();
 * qui si applicano i moltiplicatori (testa x2) e si emette l'evento 'damage'.
 * Nessun altro deve emettere 'damage' direttamente.
 */

export interface HitInput {
  part: PartName;
  x: number;
  y: number;
  /** danno grezzo, prima dei moltiplicatori di parte */
  amount: number;
  weaponId: string;
}

/** Danno da urto in base alla velocità relativa (px/step); 0 sotto soglia. */
export function impactDamage(relativeSpeed: number): number {
  const dmg = (relativeSpeed - DAMAGE.impactThreshold) * DAMAGE.impactScale;
  return dmg >= DAMAGE.minImpactDamage ? dmg : 0;
}

/** Applica moltiplicatori, arrotonda ed emette 'damage'. Ritorna il danno finale (0 = niente). */
export function dealDamage(hit: HitInput): number {
  if (!(hit.amount > 0)) return 0;
  const amount = Math.max(1, Math.round(hit.amount * DAMAGE.partMultiplier[hit.part]));
  events.emit('damage', {
    amount,
    part: hit.part,
    x: hit.x,
    y: hit.y,
    weaponId: hit.weaponId,
    strong: amount >= FX.strongHitDamage,
  });
  return amount;
}
