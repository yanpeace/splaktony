import { SHOP, WEAPON_STATS, type WeaponStats } from '../config/balance';
import { Weapon } from '../weapons/Weapon';

/**
 * Potenziamenti e prezzi del negozio: funzioni pure (niente stato, niente
 * eventi). I numeri stanno in balance.ts, sezione SHOP.
 */

/** Livello valido 0..SHOP.maxLevel (intero). */
export function clampLevel(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.max(0, Math.min(SHOP.maxLevel, Math.floor(level)));
}

/** Stats potenziate: danno * moltiplicatore, cooldown / moltiplicatore cadenza. */
export function scaleStats<S extends WeaponStats>(base: S, level: number): S {
  const l = clampLevel(level);
  if (l === 0) return base;
  return {
    ...base,
    damage: base.damage * SHOP.damageMult[l],
    cooldownMs: Math.round(base.cooldownMs / SHOP.rateMult[l]),
  };
}

function roundPrice(n: number): number {
  return Math.max(SHOP.priceStep, Math.round(n / SHOP.priceStep) * SHOP.priceStep);
}

/** Prezzo d'acquisto: WEAPON_STATS[id].price se > 0, altrimenti SHOP.prices[id]. 0 = gratis (Pugno). */
export function weaponPrice(id: string): number {
  const stats = (WEAPON_STATS as Record<string, WeaponStats | undefined>)[id];
  if (stats && stats.price > 0) return stats.price;
  if (id === 'punch') return 0;
  return SHOP.prices[id] ?? SHOP.defaultPrice;
}

/** Costo per passare dal livello `level` al successivo (Infinity se già al massimo). */
export function upgradeCost(id: string, level: number): number {
  const l = clampLevel(level);
  if (l >= SHOP.maxLevel) return Infinity;
  const base = Math.max(SHOP.upgradeMinBase, weaponPrice(id) * SHOP.upgradeShare);
  return roundPrice(base * Math.pow(SHOP.upgradeGrowth, l));
}

type LevelHook = { statsForLevel: (base: WeaponStats, level: number) => WeaponStats };

/**
 * Collega i potenziamenti a un'arma: imposta il livello e, se la classe non
 * ha un suo override di statsForLevel(), usa scaleStats(). Idempotente.
 */
export function installUpgrades(weapon: Weapon, level: number): void {
  weapon.level = clampLevel(level);
  const w = weapon as unknown as LevelHook;
  const proto = Weapon.prototype as unknown as LevelHook;
  if (w.statsForLevel === proto.statsForLevel) w.statsForLevel = scaleStats;
}
