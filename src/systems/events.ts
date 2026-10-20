/**
 * Event bus tipizzato: è l'UNICO canale di comunicazione tra i sistemi
 * (economia, salvataggio, HUD, feedback, armi, negozio, livelli...).
 *
 *   const off = events.on('damage', (e) => { ... });
 *   events.emit('damage', { amount: 5, part: 'head', x, y, weaponId: 'punch' });
 *   off(); // disiscrizione (fallo SEMPRE quando una scena si chiude)
 *
 * Per aggiungere un evento: aggiungi una voce a GameEvents qui sotto e
 * documentala in ARCHITECTURE.md.
 */

/** Nomi delle parti del pupazzo Tony. */
export type PartName =
  | 'head'
  | 'torso'
  | 'armUpperL'
  | 'armLowerL'
  | 'armUpperR'
  | 'armLowerR'
  | 'legUpperL'
  | 'legLowerL'
  | 'legUpperR'
  | 'legLowerR';

export type Mood = 'normal' | 'hurt' | 'dizzy';

export interface DamageEvent {
  /** danno finale, già moltiplicato (testa x2) e arrotondato, sempre >= 1 */
  amount: number;
  part: PartName;
  /** punto del colpo in coordinate mondo */
  x: number;
  y: number;
  /** id dell'arma ('punch', ...) oppure 'impact' per urti contro la stanza */
  weaponId: string;
  /** true se è un colpo "forte" (sopra FX.strongHitDamage) */
  strong: boolean;
}

export interface GameEvents {
  /** Tony ha subito danno. Emesso SOLO da systems/damage.ts → dealDamage(). */
  damage: DamageEvent;
  /** monete cambiate (guadagno o spesa). Emesso da systems/economy.ts */
  'coins:changed': { coins: number; delta: number };
  /** danno totale cumulativo cambiato. Emesso da systems/economy.ts */
  'damage:total': { total: number };
  /** arma attiva cambiata. Emesso da scenes/Game.ts */
  'weapon:selected': { weaponId: string; name: string; iconKey: string };
  /** richiesta di cambiare arma (da negozio/barra armi) → Game la seleziona */
  'weapon:request': { weaponId: string };
  /** arma comprata nel negozio. Emesso da systems/economy.ts */
  'weapon:bought': { weaponId: string; price: number };
  /** arma potenziata (level 1..SHOP.maxLevel). Emesso da systems/economy.ts → Game aggiorna weapon.level */
  'weapon:upgraded': { weaponId: string; level: number; cost: number };
  /** livello salito (sistema livelli: da implementare) */
  'level:up': { level: number };
  /** espressione di Tony cambiata. Emesso da entities/Ragdoll.ts */
  'mood:changed': { mood: Mood };
  /** il giocatore ha preso / lasciato Tony */
  'ragdoll:grab': { part: PartName };
  'ragdoll:release': { part: PartName; vx: number; vy: number };
  /** mondo scelto nel Menu (1 = cantiere, 2 = dentro la galleria). Emesso da scenes/Menu.ts → il save lo memorizza */
  'world:changed': { world: 1 | 2 };
  /** impostazioni cambiate (UI → sfx, save) */
  'settings:changed': { muted: boolean };
}

export type EventName = keyof GameEvents;
type Handler<K extends EventName> = (payload: GameEvents[K]) => void;

export class EventBus<E extends object> {
  private handlers = new Map<keyof E, Set<(p: never) => void>>();
  private last = new Map<keyof E, unknown>();

  /**
   * Iscrizione. Con replay=true il handler riceve subito l'ultimo valore
   * emesso (utile per HUD che nascono dopo lo stato, es. 'coins:changed').
   * Ritorna la funzione di disiscrizione.
   */
  on<K extends keyof E>(event: K, fn: (payload: E[K]) => void, replay = false): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(fn as (p: never) => void);
    if (replay && this.last.has(event)) fn(this.last.get(event) as E[K]);
    return () => this.off(event, fn);
  }

  once<K extends keyof E>(event: K, fn: (payload: E[K]) => void): () => void {
    const off = this.on(event, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  off<K extends keyof E>(event: K, fn: (payload: E[K]) => void): void {
    this.handlers.get(event)?.delete(fn as (p: never) => void);
  }

  emit<K extends keyof E>(event: K, payload: E[K]): void {
    this.last.set(event, payload);
    const set = this.handlers.get(event);
    if (!set) return;
    for (const fn of [...set]) (fn as (p: E[K]) => void)(payload);
  }

  /** Ultimo payload emesso per un evento (o undefined). */
  peek<K extends keyof E>(event: K): E[K] | undefined {
    return this.last.get(event) as E[K] | undefined;
  }
}

/** Bus globale del gioco. */
export const events = new EventBus<GameEvents>();

/** Raccoglie più disiscrizioni per chiuderle insieme (es. allo shutdown di una scena). */
export class Subscriptions {
  private offs: Array<() => void> = [];
  on<K extends EventName>(event: K, fn: Handler<K>, replay = false): this {
    this.offs.push(events.on(event, fn, replay));
    return this;
  }
  add(off: () => void): this {
    this.offs.push(off);
    return this;
  }
  clear(): void {
    this.offs.forEach((off) => off());
    this.offs = [];
  }
}
