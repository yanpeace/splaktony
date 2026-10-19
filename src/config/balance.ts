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
  // ---- FEATURE C: esplosivi ----
  granata: {
    price: 150,
    /** danno grezzo per parte al centro dell'esplosione (cala con la distanza) */
    damage: 10,
    cooldownMs: 900,
    /** tempo dal lancio all'esplosione */
    fuseMs: 2000,
    /** raggio del danno (px) */
    radius: 34,
    /** raggio e forza (px/step al centro) della spinta radiale */
    pushRadius: 44,
    pushStrength: 13,
    /** spinta extra verso l'alto a tutto Tony (px/step, scalata dalla vicinanza) */
    upBoost: 3,
    /** raggio dello sprite dell'esplosione (px) */
    boomSize: 14,
    shakePx: 3,
  },
  dinamite: {
    price: 400,
    damage: 18,
    cooldownMs: 1800,
    fuseMs: 3000,
    radius: 52,
    pushRadius: 66,
    pushStrength: 18,
    upBoost: 4,
    boomSize: 21,
    shakePx: 4,
  },
} satisfies Record<string, WeaponStats>;

export type WeaponId = keyof typeof WEAPON_STATS;

// ---- FEATURE C: esplosivi ----
/** Costanti comuni di granata e dinamite (lancio a fionda, rimbalzi, esplosione). */
export const EXPLOSIVES = {
  /** gravità dell'esplosivo in volo (px/step²), simile a quella di Matter */
  gravity: 0.25,
  /** raggio di collisione con la stanza (px) */
  bodyRadius: 4,
  /** fionda: trascinamento minimo per lanciare, massimo considerato (px) */
  minPull: 6,
  maxPull: 48,
  /** velocità di lancio per ogni px di trascinamento (px/step per px) */
  launchScale: 0.19,
  /** rimbalzi: quota di velocità conservata sull'asse dell'urto */
  restitution: 0.45,
  /** attrito: quota di velocità tangente conservata a ogni urto/contatto */
  wallFriction: 0.8,
  floorFriction: 0.86,
  /** sotto questa velocità verticale (px/step) l'esplosivo smette di rimbalzare */
  minBounce: 0.7,
  /** velocità di rotazione in volo per px/step orizzontale (rad/step) */
  spinPerSpeed: 0.08,
  /** passi di rotazione visiva (rotazione a scatti) */
  rotationSteps: 8,
  /** traiettoria: step simulati, un puntino ogni N step, rimbalzi mostrati */
  trajSteps: 120,
  trajDotEvery: 3,
  trajMaxBounces: 2,
  /** ms per "passo" dell'animazione dei puntini */
  trajAnimMs: 90,
  /** esplosivi in volo contemporaneamente */
  maxLive: 3,
  /** quota minima di danno al bordo del raggio (0..1) */
  minDamageShare: 0.25,
  explosionFrameMs: 70,
  hitStopMs: 45,
  shakeMs: 320,
  /** sbuffi di fumo per esplosione e loro durata */
  smokePuffs: 7,
  smokeMs: 1300,
  smokeRise: 18,
  debrisCount: 16,
  /** granata: lampeggio della spoletta (ms per fase, dall'inizio alla fine) */
  blinkSlowMs: 260,
  blinkFastMs: 50,
  /** dinamite: lunghezza massima della miccia (px) e ogni quanto scintilla */
  fuseLength: 4,
  sparkEveryMs: 45,
} as const;
