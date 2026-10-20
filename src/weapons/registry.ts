import { Mitragliatrice } from './Mitragliatrice';
import { Pistola } from './Pistola';
import { Dinamite } from './Dinamite';
import { Granata } from './Granata';
import { Punch } from './Punch';
import { Shuriken } from './Shuriken';
import { Coltello } from './Coltello';
import { Minigun } from './Minigun';
import { Raggio } from './Raggio';
import { Plasma } from './Plasma';
import { Gravita } from './Gravita';
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
  { id: 'shuriken', create: (ctx) => new Shuriken(ctx) },
  { id: 'coltello', create: (ctx) => new Coltello(ctx) },
  { id: 'pistola', create: (ctx) => new Pistola(ctx) },
  { id: 'mitragliatrice', create: (ctx) => new Mitragliatrice(ctx) },
  { id: 'granata', create: (ctx) => new Granata(ctx) },
  { id: 'dinamite', create: (ctx) => new Dinamite(ctx) },
  // ---- ARMI NUOVE: fantascienza ----
  { id: 'minigun', create: (ctx) => new Minigun(ctx) },
  { id: 'raggio', create: (ctx) => new Raggio(ctx) },
  { id: 'plasma', create: (ctx) => new Plasma(ctx) },
  { id: 'gravita', create: (ctx) => new Gravita(ctx) },
];

export function findWeapon(id: string): WeaponEntry | undefined {
  return WEAPON_REGISTRY.find((w) => w.id === id);
}
