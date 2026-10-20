import { Mitragliatrice } from './Mitragliatrice';
import { Pistola } from './Pistola';
import { Dinamite } from './Dinamite';
import { Granata } from './Granata';
import { Punch } from './Punch';
import { Shuriken } from './Shuriken';
import { Coltello } from './Coltello';
import { PiedeDiPorco } from './PiedeDiPorco';
import { Mazza } from './Mazza';
import { Katana } from './Katana';
import { Motosega } from './Motosega';
import { Lanciafiamme } from './Lanciafiamme';
import { Fulmine } from './Fulmine';
import { Ghiaccio } from './Ghiaccio';
import { Tornado } from './Tornado';
import { Minigun } from './Minigun';
import { Raggio } from './Raggio';
import { Plasma } from './Plasma';
import { Gravita } from './Gravita';
import { Doppietta } from './Doppietta';
import { Fucile } from './Fucile';
import { Cecchino } from './Cecchino';
import { Rpg } from './Rpg';
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
  // in ordine di prezzo: è l'ordine del negozio
  { id: 'punch', create: (ctx) => new Punch(ctx) },
  { id: 'shuriken', create: (ctx) => new Shuriken(ctx) },
  { id: 'piedediporco', create: (ctx) => new PiedeDiPorco(ctx) },
  { id: 'coltello', create: (ctx) => new Coltello(ctx) },
  { id: 'mazza', create: (ctx) => new Mazza(ctx) },
  { id: 'pistola', create: (ctx) => new Pistola(ctx) },
  { id: 'doppietta', create: (ctx) => new Doppietta(ctx) },
  { id: 'mitragliatrice', create: (ctx) => new Mitragliatrice(ctx) },
  { id: 'fucile', create: (ctx) => new Fucile(ctx) },
  { id: 'lanciafiamme', create: (ctx) => new Lanciafiamme(ctx) },
  { id: 'katana', create: (ctx) => new Katana(ctx) },
  { id: 'granata', create: (ctx) => new Granata(ctx) },
  { id: 'fulmine', create: (ctx) => new Fulmine(ctx) },
  { id: 'ghiaccio', create: (ctx) => new Ghiaccio(ctx) },
  { id: 'cecchino', create: (ctx) => new Cecchino(ctx) },
  { id: 'dinamite', create: (ctx) => new Dinamite(ctx) },
  { id: 'motosega', create: (ctx) => new Motosega(ctx) },
  { id: 'tornado', create: (ctx) => new Tornado(ctx) },
  { id: 'rpg', create: (ctx) => new Rpg(ctx) },
  { id: 'minigun', create: (ctx) => new Minigun(ctx) },
  { id: 'raggio', create: (ctx) => new Raggio(ctx) },
  { id: 'plasma', create: (ctx) => new Plasma(ctx) },
  { id: 'gravita', create: (ctx) => new Gravita(ctx) },
];

export function findWeapon(id: string): WeaponEntry | undefined {
  return WEAPON_REGISTRY.find((w) => w.id === id);
}
