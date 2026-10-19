/**
 * TUTTI i numeri di gameplay e di "feel" stanno qui.
 * Unità: pixel logici (schermo 180x320), millisecondi, velocità in px/step
 * (la fisica avanza a step fissi di 1/60 s).
 */

export const SCREEN = {
  width: 180,
  height: 320,
} as const;

/** Stanza chiusa: spessori visibili di muri, soffitto e pavimento. */
export const ROOM = {
  wall: 8,
  ceiling: 24,
  floor: 28,
  /** spessore invisibile extra dei corpi statici (anti-tunneling) */
  solidThickness: 200,
  friction: 0.6,
  restitution: 0.25,
} as const;

/** Rettangolo interno giocabile, derivato da ROOM. */
export const ROOM_INNER = {
  left: ROOM.wall,
  right: SCREEN.width - ROOM.wall,
  top: ROOM.ceiling,
  bottom: SCREEN.height - ROOM.floor,
} as const;

export const PHYSICS = {
  gravityY: 1,
  stepMs: 1000 / 60,
  /** massimo numero di step per frame (evita la "spirale della morte") */
  maxStepsPerFrame: 4,
  positionIterations: 10,
  velocityIterations: 8,
  constraintIterations: 4,
} as const;

export const RAGDOLL = {
  spawnX: 90,
  spawnY: 262,
  frictionAir: 0.015,
  friction: 0.5,
  restitution: 0.3,
  /** rigidità dei giunti: bassa = più molle e buffo */
  jointStiffness: 0.55,
  jointDamping: 0.08,
  densityTorso: 0.0022,
  densityHead: 0.0016,
  densityLimb: 0.0012,
  /** limite di velocità lineare (px/step) e angolare (rad/step) */
  maxSpeed: 20,
  maxAngularSpeed: 0.6,
  /** un giunto allungato oltre questo per troppo tempo → reset del pupazzo */
  maxJointStretch: 14,
  stretchResetMs: 600,
  /** passi di rotazione visiva (rotazione "a scatti" pixel-art) */
  rotationSteps: 24,
} as const;

export const GRAB = {
  /** px di tolleranza attorno a una parte per prenderla col dito */
  pickTolerance: 8,
  /** movimento (px) oltre il quale un tocco diventa trascinamento */
  dragStartDistance: 5,
  /** tempo (ms) di pressione oltre il quale un tocco diventa presa */
  holdStartMs: 180,
  stiffness: 0.25,
  damping: 0.05,
  /** finestra (ms) usata per stimare la velocità del lancio */
  throwSampleMs: 80,
  throwScale: 1.1,
  /** quota di velocità del gesto trasmessa alle parti non afferrate */
  throwBodyShare: 0.6,
  maxThrowSpeed: 18,
} as const;

export const DAMAGE = {
  /** velocità relativa d'impatto (px/step) sotto la quale il danno è 0 */
  impactThreshold: 3.5,
  /** danno per ogni px/step oltre la soglia */
  impactScale: 2.2,
  /** urti che farebbero meno di così contano 0 (evita lo spam di "1") */
  minImpactDamage: 2,
  /** pausa minima tra due danni d'impatto sulla stessa parte */
  partCooldownMs: 90,
  partMultiplier: {
    head: 2,
    torso: 1,
    armUpperL: 1,
    armLowerL: 1,
    armUpperR: 1,
    armLowerR: 1,
    legUpperL: 1,
    legLowerL: 1,
    legUpperR: 1,
    legLowerR: 1,
  },
} as const;

export const ECONOMY = {
  /** 1 moneta ogni N danni */
  damagePerCoin: 10,
  startingCoins: 0,
} as const;

/** Espressioni della faccia in base allo "stress" (danno recente). */
export const MOOD = {
  /** stress perso al secondo */
  decayPerSec: 25,
  hurtAt: 12,
  dizzyAt: 70,
  /** durata minima delle espressioni */
  hurtHoldMs: 450,
  dizzyHoldMs: 1600,
  blinkEveryMs: 2600,
  blinkMs: 110,
} as const;

/** Feedback visivo/sonoro dei colpi. */
export const FX = {
  /** da qui in su il colpo è "forte": hit-stop + shake */
  strongHitDamage: 18,
  hitStopMinMs: 30,
  hitStopMaxMs: 60,
  shakePx: 2,
  shakeBigPx: 3,
  shakeMs: 140,
  flashFrames: 2,
  particlesPerDamage: 0.4,
  particlesMin: 3,
  particlesMax: 18,
  maxParticles: 220,
  /** soglie colore del numero di danno */
  numberMid: 10,
  numberBig: 25,
  numberHuge: 50,
} as const;

/**
 * Stats delle armi, indicizzate per id. Ogni arma legge le sue da qui
 * (vedi weapons/Weapon.ts). Campi comuni obbligatori: price, damage, cooldownMs.
 */
export interface WeaponStats {
  /** prezzo in monete (0 = arma iniziale) */
  price: number;
  /** danno diretto base del colpo */
  damage: number;
  /** pausa minima tra due colpi */
  cooldownMs: number;
  [extra: string]: number;
}

export const WEAPON_STATS = {
  punch: {
    price: 0,
    damage: 4,
    cooldownMs: 80,
    /** variazione di velocità impressa alla parte colpita (px/step) */
    impulse: 9,
    /** spinta extra verso l'alto per far "saltare" il pupazzo */
    upwardBias: 0.35,
    /** quota d'impulso data alle altre parti */
    bodyShare: 0.35,
  },
} satisfies Record<string, WeaponStats>;

export type WeaponId = keyof typeof WEAPON_STATS;

// ---- FEATURE D: negozio ----

/**
 * Negozio e potenziamenti (vedi systems/upgrades.ts e scenes/Shop.ts).
 *
 * Obiettivo: un acquisto (arma o potenziamento) ogni 2-3 minuti di gioco.
 * Reddito misurato col solo Pugno (simulazione nel browser): 4 tap/s su
 * Tony ≈ 2800 danni/min (55% pugno, 45% urti) ≈ 280 monete/min; un lancio
 * ogni 2,5 s ≈ 170 danni a lancio ≈ 400 monete/min. Un giocatore vero, con
 * pause e tocchi a vuoto, fa circa 200 monete/min. Ogni arma nuova dovrebbe
 * aumentare il reddito di ~1,7 volte, quindi i prezzi crescono di ~2 volte
 * per gradino; i potenziamenti riempiono i buchi tra un'arma e l'altra.
 * Simulazione "compra la cosa più economica": acquisto medio ogni ~2 min.
 */
export const SHOP = {
  /**
   * Prezzo per id, usato se WEAPON_STATS[id].price non è > 0.
   * L'ordine è quello di "potenza" attesa delle armi.
   */
  prices: {
    shuriken: 500,
    coltello: 1100,
    pistola: 2200,
    mitragliatrice: 4500,
    granata: 9000,
    dinamite: 18000,
  } as Record<string, number>,
  /** prezzo per un'arma senza price e non presente in `prices` */
  defaultPrice: 1500,
  /** livelli di potenziamento per arma (0 = base) */
  maxLevel: 5,
  /** moltiplicatore del danno per livello 0..maxLevel */
  damageMult: [1, 1.25, 1.5, 1.8, 2.15, 2.6],
  /** moltiplicatore della cadenza per livello: cooldownMs / valore */
  rateMult: [1, 1.1, 1.2, 1.3, 1.45, 1.6],
  /** costo del primo potenziamento = prezzo arma * upgradeShare ... */
  upgradeShare: 0.35,
  /** ... ma mai meno di così (il Pugno costa 0): Pugno 300/480/770/1230/1970 */
  upgradeMinBase: 300,
  /** ogni livello costa upgradeGrowth volte il precedente */
  upgradeGrowth: 1.6,
  /** i costi si arrotondano a multipli di questo */
  priceStep: 10,
  /** durata del messaggio "monete insufficienti" (ms) */
  toastMs: 1300,
} as const;
