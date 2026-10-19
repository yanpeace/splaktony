import { ECONOMY } from '../config/balance';
import { events } from './events';

/**
 * Salvataggio su localStorage con schema versionato.
 *
 * - load(): legge, migra alla versione corrente e ritorna i dati (o i default).
 * - save(data): scrive subito.
 * - getSave()/patchSave(): stato in memoria condiviso; patchSave salva con debounce.
 *
 * Per cambiare lo schema: incrementa SAVE_VERSION, aggiorna SaveData e
 * defaultSave(), e aggiungi una funzione in MIGRATIONS che porta i dati
 * dalla versione N-1 alla N. Non rimuovere mai migrazioni vecchie.
 */

export const SAVE_KEY = 'splaktony.save';
export const SAVE_VERSION = 1;

export interface SaveData {
  version: typeof SAVE_VERSION;
  coins: number;
  totalDamage: number;
  /** danno accumulato non ancora convertito in moneta */
  coinRemainder: number;
  level: number;
  xp: number;
  selectedWeapon: string;
  ownedWeapons: string[];
  /** livello di potenziamento per arma: { punch: 0 } */
  weaponLevels: Record<string, number>;
  settings: { muted: boolean };
}

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    coins: ECONOMY.startingCoins,
    totalDamage: 0,
    coinRemainder: 0,
    level: 1,
    xp: 0,
    selectedWeapon: 'punch',
    ownedWeapons: ['punch'],
    weaponLevels: { punch: 0 },
    settings: { muted: false },
  };
}

type AnySave = { version: number } & Record<string, unknown>;

/** MIGRATIONS[n] trasforma dati di versione n in dati di versione n+1. */
const MIGRATIONS: Record<number, (old: AnySave) => AnySave> = {
  // 1: (d) => ({ ...d, version: 2, nuovoCampo: 0 }),
};

function migrate(raw: AnySave): SaveData {
  let d = raw;
  while (d.version < SAVE_VERSION) {
    const step = MIGRATIONS[d.version];
    if (!step) throw new Error(`save: manca la migrazione dalla v${d.version}`);
    d = step(d);
  }
  // i campi mancanti prendono il default (robusto a salvataggi parziali)
  const def = defaultSave();
  const out = { ...def, ...(d as Partial<SaveData>), settings: { ...def.settings, ...(d.settings as object) } } as SaveData;
  return ensureStarterWeapon(out);
}

/**
 * Il Pugno è gratis e sempre posseduto (anche nei salvataggi vecchi o
 * manomessi); ownedWeapons / weaponLevels sempre ben formati.
 */
function ensureStarterWeapon(s: SaveData): SaveData {
  const owned = Array.isArray(s.ownedWeapons) ? s.ownedWeapons.filter((w) => typeof w === 'string') : [];
  if (!owned.includes('punch')) owned.unshift('punch');
  const levels: Record<string, number> = {};
  const raw = s.weaponLevels && typeof s.weaponLevels === 'object' ? s.weaponLevels : {};
  for (const [id, lv] of Object.entries(raw)) {
    if (typeof lv === 'number' && Number.isFinite(lv)) levels[id] = Math.max(0, Math.floor(lv));
  }
  levels.punch ??= 0;
  const selectedWeapon = owned.includes(s.selectedWeapon) ? s.selectedWeapon : 'punch';
  return { ...s, ownedWeapons: [...new Set(owned)], weaponLevels: levels, selectedWeapon };
}

export function load(): SaveData {
  try {
    const txt = localStorage.getItem(SAVE_KEY);
    if (!txt) return defaultSave();
    const raw = JSON.parse(txt) as AnySave;
    if (typeof raw?.version !== 'number' || raw.version > SAVE_VERSION) return defaultSave();
    return migrate(raw);
  } catch (err) {
    console.warn('save: salvataggio illeggibile, riparto da zero', err);
    return defaultSave();
  }
}

export function save(data: SaveData): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn('save: impossibile scrivere', err);
  }
}

// ---- stato in memoria condiviso + scrittura con debounce ----

let current: SaveData | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 800;

export function getSave(): SaveData {
  if (!current) current = load();
  return current;
}

/** Modifica lo stato e programma un salvataggio. */
export function patchSave(patch: Partial<SaveData>): void {
  current = { ...getSave(), ...patch };
  if (timer) clearTimeout(timer);
  timer = setTimeout(flushSave, DEBOUNCE_MS);
}

export function flushSave(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (current) save(current);
}

export function resetSave(): void {
  current = defaultSave();
  save(current);
}

let bound = false;

/** Collega il salvataggio agli eventi. Chiamato una volta da Boot. */
export function initSave(): SaveData {
  const data = getSave();
  if (bound) return data;
  bound = true;
  events.on('weapon:selected', (e) => patchSave({ selectedWeapon: e.weaponId }));
  events.on('level:up', (e) => patchSave({ level: e.level }));
  events.on('settings:changed', (s) => patchSave({ settings: { ...getSave().settings, ...s } }));
  window.addEventListener('pagehide', flushSave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave();
  });
  return data;
}
