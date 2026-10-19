import { Dinamite } from './Dinamite';
import { Granata } from './Granata';
import { Punch } from './Punch';
import type { Weapon, WeaponContext } from './Weapon';

/**
 * Registro delle armi. Per aggiungerne una:
 *  1. aggiungi le sue stats in WEAPON_STATS (config/balance.ts) con lo stesso id
 *  2. crea src/weapons/<Nome>.ts che estende Weapon
 *  3. aggiungi qui una voce { id, create }
 * L'ordine dell'array è l'ordine di visualizzazione (negozio / barra armi).
 */
export interface WeaponEntry {
  id: string;
  create: (ctx: WeaponContext) => Weapon;
}

export const WEAPON_REGISTRY: WeaponEntry[] = [
  { id: 'punch', create: (ctx) => new Punch(ctx) },
  { id: 'granata', create: (ctx) => new Granata(ctx) },
  { id: 'dinamite', create: (ctx) => new Dinamite(ctx) },
];

export function findWeapon(id: string): WeaponEntry | undefined {
  return WEAPON_REGISTRY.find((w) => w.id === id);
}
