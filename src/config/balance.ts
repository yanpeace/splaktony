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
  // ---- FEATURE A: armi da lancio ----
  shuriken: {
    price: 60,
    damage: 3,
    cooldownMs: 140,
    /** velocità di volo (px/step) */
    speed: 9,
    /** Δv impresso alla parte colpita nella direzione di volo (px/step) */
    impulse: 4,
    /** quanto resta conficcato prima di staccarsi */
    stickMs: 3000,
  },
  coltello: {
    price: 150,
    damage: 9,
    cooldownMs: 420,
    speed: 6,
    impulse: 6.5,
    stickMs: 3000,
  },
  // ---- FEATURE B: armi da fuoco ----
  pistola: {
    price: 150,
    damage: 12,
    /** pausa minima tra due colpi (un colpo per tap) */
    cooldownMs: 220,
    /** Δv impresso alla parte colpita (px/step), dal basso verso il punto */
    impulse: 6,
    /** quota d'impulso data alle altre parti */
    bodyShare: 0.15,
    /** tolleranza (px) del colpo attorno alle parti di Tony */
    hitTolerance: 3,
  },
  mitragliatrice: {
    price: 600,
    damage: 3,
    /** cadenza della raffica: ms tra due colpi mentre il dito è giù */
    cooldownMs: 85,
    impulse: 2.5,
    bodyShare: 0.05,
    hitTolerance: 2,
    /** raggio massimo (px) della dispersione casuale attorno al dito */
    spread: 6,
  },
} satisfies Record<string, WeaponStats>;

// ---- FEATURE A: armi da lancio ----
/** Costanti comuni dei proiettili lanciati (shuriken, coltello). */
export const THROWN = {
  /** distanza dal muro del punto di lancio (angolo in basso) */
  originInset: 6,
  /** altezza del punto di lancio sopra il pavimento */
  originAboveFloor: 4,
  /** componente minima verso l'alto della direzione di lancio (0..1) */
  minUpward: 0.15,
  /** passo massimo (px) del controllo collisioni lungo il tragitto */
  subStepPx: 2,
  /** tolleranza (px) di partAt per il proiettile */
  hitTolerance: 1,
  /** di quanto (px) il proiettile entra nella parte colpita */
  embedPx: 2,
  /** quanto resta piantato nel muro/soffitto prima di cadere */
  wallStickMs: 700,
  /** gravità della caduta dopo il distacco (px/step²) */
  fallGravity: 0.25,
  /** velocità massima ereditata dalla parte al distacco (px/step) */
  fallMaxSpeed: 4,
  /** rotazione durante la caduta (rad/step) */
  fallSpin: 0.18,
  /** rimbalzo sui muri durante la caduta */
  fallWallBounce: 0.3,
  /** lampeggio a terra prima di sparire */
  blinkMs: 700,
  blinkFlashMs: 70,
  /** cambio frame della rotazione a scatti dello shuriken in volo */
  spinFrameMs: 45,
  /** proiettili presenti al massimo (i più vecchi spariscono) */
  maxProjectiles: 16,
  /** sicurezza: volo massimo prima di cadere comunque */
  maxFlightMs: 2500,
} as const;

export type WeaponId = keyof typeof WEAPON_STATS;

// ---- FEATURE B: armi da fuoco ----
/** Costanti condivise da pistola e mitragliatrice (fori, bossoli, lampo). */
export const FIREARMS = {
  /** punto (fuori schermo, in basso) da cui "spara" il giocatore: dà la direzione dell'impulso */
  originX: 90,
  originY: 380,
  /** componente casuale della direzione dell'impulso (0 = dritto) */
  impulseJitter: 0.25,
  /** durata dei frame del lampo di sparo */
  flashFrameMs: 35,
  /** fori di proiettile sul muro */
  maxHoles: 30,
  holeLifeMs: 4000,
  holeBlinkMs: 900,
  holeBlinkStepMs: 90,
  holeDepth: 1.5,
  /** bossoli espulsi dalla mitragliatrice */
  maxShells: 24,
  shellEjectX: 166,
  shellEjectY: 262,
  shellVx: -1.7,
  shellVxJitter: 0.9,
  shellVy: -3.4,
  shellVyJitter: 1,
  shellGravity: 0.22,
  /** frazione di velocità verticale conservata a ogni rimbalzo */
  shellBounce: 0.45,
  /** attrito orizzontale a ogni contatto col pavimento */
  shellFriction: 0.6,
  /** sotto questa velocità verticale (px/step) il bossolo si ferma */
  shellStopSpeed: 0.8,
  shellSpinMs: 60,
  shellRestMs: 2500,
  shellBlinkMs: 700,
  shellBlinkStepMs: 90,
  shellDepth: 17,
} as const;
