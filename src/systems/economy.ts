import { ECONOMY, SHOP } from '../config/balance';
import { events } from './events';
import { flushSave, getSave, patchSave } from './save';
import { clampLevel, upgradeCost, weaponPrice } from './upgrades';

/**
 * Economia: converte il danno in monete (1 ogni ECONOMY.damagePerCoin) e
 * gestisce spesa/guadagno. Ascolta 'damage', emette 'coins:changed' e
 * 'damage:total'. Per il negozio: buyWeapon()/upgradeWeapon() (emettono
 * 'weapon:bought' / 'weapon:upgraded'), prezzi in systems/upgrades.ts.
 */
export interface Economy {
  readonly coins: number;
  readonly totalDamage: number;
  canAfford(amount: number): boolean;
  /** Toglie monete se bastano; ritorna true se la spesa è riuscita. */
  spend(amount: number): boolean;
  /** Aggiunge monete (premi, bonus...). */
  add(amount: number): void;
}

let coins = 0;
let totalDamage = 0;
let remainder = 0;
let ready = false;

function emitCoins(delta: number): void {
  patchSave({ coins, totalDamage, coinRemainder: remainder });
  events.emit('coins:changed', { coins, delta });
}

export const economy: Economy = {
  get coins() {
    return coins;
  },
  get totalDamage() {
    return totalDamage;
  },
  canAfford(amount) {
    return coins >= amount;
  },
  spend(amount) {
    if (amount < 0 || coins < amount) return false;
    coins -= amount;
    emitCoins(-amount);
    return true;
  },
  add(amount) {
    if (amount <= 0) return;
    coins += Math.floor(amount);
    emitCoins(Math.floor(amount));
  },
};

// ---- negozio: acquisti e potenziamenti delle armi ----

export type BuyResult = 'ok' | 'owned' | 'poor';
export type UpgradeResult = 'ok' | 'locked' | 'max' | 'poor';

export function isWeaponOwned(id: string): boolean {
  return getSave().ownedWeapons.includes(id);
}

/** Livello di potenziamento salvato (0..SHOP.maxLevel). */
export function weaponLevel(id: string): number {
  return clampLevel(getSave().weaponLevels[id] ?? 0);
}

/** Compra un'arma (se non posseduta e se bastano le monete). Emette 'weapon:bought'. */
export function buyWeapon(id: string): BuyResult {
  if (isWeaponOwned(id)) return 'owned';
  const price = weaponPrice(id);
  if (!economy.spend(price)) return 'poor';
  const s = getSave();
  patchSave({
    ownedWeapons: [...s.ownedWeapons, id],
    weaponLevels: { ...s.weaponLevels, [id]: weaponLevel(id) },
  });
  flushSave();
  events.emit('weapon:bought', { weaponId: id, price });
  return 'ok';
}

/** Potenzia di un livello un'arma posseduta. Emette 'weapon:upgraded'. */
export function upgradeWeapon(id: string): UpgradeResult {
  if (!isWeaponOwned(id)) return 'locked';
  const level = weaponLevel(id);
  if (level >= SHOP.maxLevel) return 'max';
  const cost = upgradeCost(id, level);
  if (!economy.spend(cost)) return 'poor';
  const next = level + 1;
  patchSave({ weaponLevels: { ...getSave().weaponLevels, [id]: next } });
  flushSave();
  events.emit('weapon:upgraded', { weaponId: id, level: next, cost });
  return 'ok';
}

/** Collega l'economia agli eventi. Chiamato una volta da Boot. */
export function initEconomy(): Economy {
  if (ready) return economy;
  ready = true;
  const s = getSave();
  coins = s.coins;
  totalDamage = s.totalDamage;
  remainder = s.coinRemainder;
  events.emit('coins:changed', { coins, delta: 0 });
  events.emit('damage:total', { total: totalDamage });

  events.on('damage', (e) => {
    totalDamage += e.amount;
    remainder += e.amount;
    const earned = Math.floor(remainder / ECONOMY.damagePerCoin);
    remainder -= earned * ECONOMY.damagePerCoin;
    events.emit('damage:total', { total: totalDamage });
    if (earned > 0) {
      coins += earned;
      emitCoins(earned);
    } else {
      patchSave({ totalDamage, coinRemainder: remainder });
    }
  });
  return economy;
}
