import { ECONOMY } from '../config/balance';
import { events } from './events';
import { getSave, patchSave } from './save';

/**
 * Economia: converte il danno in monete (1 ogni ECONOMY.damagePerCoin) e
 * gestisce spesa/guadagno. Ascolta 'damage', emette 'coins:changed' e
 * 'damage:total'. Il negozio (da fare) userà canAfford()/spend().
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
