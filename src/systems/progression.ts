import { COMBO, DAILY, ECONOMY, PROGRESSION } from '../config/balance';
import { economy } from './economy';
import { events, type DamageEvent } from './events';
import { getSave, patchSave } from './save';

/**
 * Progressione (feature E): esperienza/livelli, combo di monete e obiettivi
 * giornalieri. Ascolta SOLO 'damage', emette 'level:up' e dà i premi con
 * economy.add(). La HUD (scenes/ProgressHUD.ts) legge lo stato da qui.
 *
 * - XP e livello stanno nel save condiviso (campi `xp`, `level`).
 * - Gli obiettivi giornalieri stanno in una chiave propria: DAILY_KEY.
 */

// ---------------------------------------------------------------- livelli

let level = 1;
let xp = 0;
let ready = false;

/** XP necessaria per passare dal livello `lv` al successivo. */
export function xpForLevel(lv: number): number {
  return Math.max(1, Math.round(PROGRESSION.xpBase * Math.pow(Math.max(1, lv), PROGRESSION.xpExponent)));
}

export function getLevel(): number {
  return level;
}

/** XP accumulata nel livello corrente (0 .. xpForLevel(level)). */
export function getXp(): number {
  return xp;
}

function addXp(amount: number): void {
  xp += amount;
  let leveled = false;
  while (xp >= xpForLevel(level)) {
    xp -= xpForLevel(level);
    level++;
    leveled = true;
    events.emit('level:up', { level });
  }
  patchSave(leveled ? { xp, level } : { xp });
}

// ---------------------------------------------------------------- combo

let comboHits = 0;
let lastHitAt = -Infinity;
let bonusRemainder = 0;

export interface ComboState {
  hits: number;
  /** moltiplicatore monete attuale (1 = nessuna combo) */
  mult: number;
  /** ms che restano prima dell'azzeramento */
  remainingMs: number;
}

function multFor(hits: number): number {
  let m = 1;
  for (const t of COMBO.tiers) if (hits >= t.hits) m = t.mult;
  return m;
}

export function getCombo(now = performance.now()): ComboState {
  const remainingMs = COMBO.resetMs - (now - lastHitAt);
  if (remainingMs <= 0) return { hits: 0, mult: 1, remainingMs: 0 };
  return { hits: comboHits, mult: multFor(comboHits), remainingMs };
}

/** Registra un colpo nella combo e paga le monete bonus. Ritorna il moltiplicatore. */
function comboHit(amount: number): number {
  const now = performance.now();
  if (now - lastHitAt > COMBO.resetMs) {
    comboHits = 0;
    bonusRemainder = 0;
  }
  comboHits++;
  lastHitAt = now;
  const mult = multFor(comboHits);
  if (mult > 1) {
    // l'economia paga già 1 moneta ogni damagePerCoin: qui solo l'extra (mult - 1)
    bonusRemainder += (amount / ECONOMY.damagePerCoin) * (mult - 1);
    const n = Math.floor(bonusRemainder);
    if (n > 0) {
      bonusRemainder -= n;
      economy.add(n);
    }
  }
  return mult;
}

// ---------------------------------------------------------------- obiettivi giornalieri

export const DAILY_KEY = 'splaktony.daily';
const DAILY_VERSION = 1;

export type GoalKind = keyof typeof DAILY.kinds;

export interface DailyGoal {
  kind: GoalKind;
  target: number;
  reward: number;
  progress: number;
  claimed: boolean;
}

interface DailyData {
  version: number;
  date: string;
  goals: DailyGoal[];
}

let daily: DailyData = { version: DAILY_VERSION, date: '', goals: [] };
let dailyTimer: ReturnType<typeof setTimeout> | null = null;

/** Data locale YYYY-MM-DD. */
export function localDateKey(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** PRNG deterministico (mulberry32) da un seed testuale. */
function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateGoals(date: string): DailyGoal[] {
  const rnd = seededRandom(`splaktony-${date}`);
  const kinds = Object.keys(DAILY.kinds) as GoalKind[];
  const goals: DailyGoal[] = [];
  while (goals.length < DAILY.count && kinds.length > 0) {
    const kind = kinds.splice(Math.floor(rnd() * kinds.length), 1)[0];
    const def = DAILY.kinds[kind];
    const i = Math.floor(rnd() * def.targets.length);
    goals.push({ kind, target: def.targets[i], reward: def.rewards[i], progress: 0, claimed: false });
  }
  return goals;
}

function loadDaily(): DailyData | null {
  try {
    const txt = localStorage.getItem(DAILY_KEY);
    if (!txt) return null;
    const d = JSON.parse(txt) as DailyData;
    if (d?.version !== DAILY_VERSION || typeof d.date !== 'string' || !Array.isArray(d.goals)) return null;
    if (!d.goals.every((g) => g && g.kind in DAILY.kinds)) return null;
    return d;
  } catch {
    return null;
  }
}

function flushDaily(): void {
  if (dailyTimer) clearTimeout(dailyTimer);
  dailyTimer = null;
  try {
    localStorage.setItem(DAILY_KEY, JSON.stringify(daily));
  } catch (err) {
    console.warn('progression: impossibile salvare gli obiettivi', err);
  }
}

function scheduleDailySave(): void {
  if (dailyTimer) clearTimeout(dailyTimer);
  dailyTimer = setTimeout(flushDaily, 600);
}

/** Rigenera gli obiettivi se è cambiato il giorno. Ritorna true se li ha rigenerati. */
function ensureToday(): boolean {
  const today = localDateKey();
  if (daily.date === today) return false;
  const stored = loadDaily();
  daily =
    stored && stored.date === today
      ? stored
      : { version: DAILY_VERSION, date: today, goals: generateGoals(today) };
  flushDaily();
  return true;
}

export function getDailyGoals(): readonly DailyGoal[] {
  if (ensureToday()) notify({ type: 'daily' });
  return daily.goals;
}

/** Testo dell'obiettivo (font pixel: `*` = x piccola). */
export function goalLabel(g: DailyGoal): string {
  switch (g.kind) {
    case 'damage':
      return `FAI ${g.target} DANNI`;
    case 'head':
      return `${g.target} COLPI IN TESTA`;
    case 'combo':
      return `FAI COMBO *${g.target}`;
    case 'bigHit':
      return `COLPO DA ${g.target}+`;
    case 'impact':
      return `${g.target} DANNI DA URTO`;
    case 'hits':
      return `FAI ${g.target} COLPI`;
    case 'strong':
      return `${g.target} COLPI FORTI`;
  }
}

export function goalProgressText(g: DailyGoal): string {
  const p = Math.min(g.progress, g.target);
  return g.kind === 'combo' ? `*${Math.max(1, p)}/*${g.target}` : `${p}/${g.target}`;
}

function goalValue(kind: GoalKind, e: DamageEvent, mult: number, current: number): number {
  switch (kind) {
    case 'damage':
      return current + e.amount;
    case 'head':
      return current + (e.part === 'head' ? 1 : 0);
    case 'combo':
      return Math.max(current, mult);
    case 'bigHit':
      return Math.max(current, e.amount);
    case 'impact':
      return current + (e.weaponId === 'impact' ? e.amount : 0);
    case 'hits':
      return current + 1;
    case 'strong':
      return current + (e.strong ? 1 : 0);
  }
}

function updateGoals(e: DamageEvent, mult: number): void {
  if (ensureToday()) notify({ type: 'daily' });
  let changed = false;
  for (const g of daily.goals) {
    if (g.claimed) continue;
    const v = goalValue(g.kind, e, mult, g.progress);
    if (v === g.progress) continue;
    g.progress = v;
    changed = true;
    if (g.progress >= g.target) {
      g.claimed = true;
      economy.add(g.reward);
      notify({ type: 'goal', goal: g });
    }
  }
  if (changed) scheduleDailySave();
}

// ---------------------------------------------------------------- notifiche per la HUD

/** Notifiche interne alla feature (solo per ProgressHUD): non passano dall'event bus. */
export type ProgressNotice = { type: 'goal'; goal: DailyGoal } | { type: 'daily' };
const listeners = new Set<(n: ProgressNotice) => void>();

export function onProgress(fn: (n: ProgressNotice) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(n: ProgressNotice): void {
  for (const fn of [...listeners]) fn(n);
}

// ---------------------------------------------------------------- init

/** Ripristina livello/XP dal save e si iscrive a 'damage'. Chiamato una volta da Boot. */
export function initProgression(): void {
  if (ready) return;
  ready = true;
  const s = getSave();
  level = Math.max(1, Math.floor(s.level) || 1);
  xp = Math.max(0, Number(s.xp) || 0);
  // curva cambiata dopo un aggiornamento: normalizza in silenzio
  while (xp >= xpForLevel(level)) {
    xp -= xpForLevel(level);
    level++;
  }
  if (level !== s.level || xp !== s.xp) patchSave({ level, xp });
  ensureToday();

  events.on('damage', (e) => {
    addXp(e.amount * PROGRESSION.xpPerDamage);
    const mult = comboHit(e.amount);
    updateGoals(e, mult);
  });
  window.addEventListener('pagehide', flushDaily);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushDaily();
  });
}
