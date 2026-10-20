import { Mitragliatrice } from './Mitragliatrice';
import { Pistola } from './Pistola';
import { Dinamite } from './Dinamite';
import { Granata } from './Granata';
import { Punch } from './Punch';
import { Shuriken } from './Shuriken';
import { Coltello } from './Coltello';
import { Lanciafiamme } from './Lanciafiamme';
import { Fulmine } from './Fulmine';
import { Ghiaccio } from './Ghiaccio';
import { Tornado } from './Tornado';
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
  { id: 'lanciafiamme', create: (ctx) => new Lanciafiamme(ctx) },
  { id: 'fulmine', create: (ctx) => new Fulmine(ctx) },
  { id: 'ghiaccio', create: (ctx) => new Ghiaccio(ctx) },
  { id: 'tornado', create: (ctx) => new Tornado(ctx) },
];

export function findWeapon(id: string): WeaponEntry | undefined {
  return WEAPON_REGISTRY.find((w) => w.id === id);
}
