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
  /** tetti dei pool di effetti (oltre si riciclano i più vecchi): 60 fps su telefono */
  maxParticles: 160,
  maxDamageNumbers: 14,
  maxPops: 16,
  /** immagini tenute pronte nel pool condiviso (proiettili, bossoli, fori, fumo...) */
  maxPooledImages: 96,
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

/*
 * Curva delle armi (ribilanciamento post-merge): ogni arma rende ~1,3-1,4x la
 * precedente in danni/min con un giocatore attivo (misurato nel browser):
 * pugno ~2000, shuriken ~2900, coltello ~4000, pistola ~5200, mitra ~6600,
 * granata ~9000, dinamite ~13000 (gli esplosivi tengono
 * meno la combo, quindi fanno più danno per restare convenienti). I prezzi sono in SHOP.prices.
 */
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
    price: 0, // prezzo in SHOP.prices
    damage: 12,
    cooldownMs: 140,
    /** velocità di volo (px/step) */
    speed: 10,
    /** Δv impresso alla parte colpita nella direzione di volo (px/step) */
    impulse: 6,
    /** quanto resta conficcato prima di staccarsi */
    stickMs: 3000,
  },
  coltello: {
    price: 0, // prezzo in SHOP.prices
    damage: 22,
    cooldownMs: 380,
    speed: 8,
    impulse: 8,
    stickMs: 3000,
  },
  // ---- FEATURE B: armi da fuoco ----
  pistola: {
    price: 0, // prezzo in SHOP.prices
    damage: 19,
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
    price: 0, // prezzo in SHOP.prices
    damage: 7.5,
    /** cadenza della raffica: ms tra due colpi mentre il dito è giù */
    cooldownMs: 85,
    impulse: 2.5,
    bodyShare: 0.05,
    hitTolerance: 2,
    /** raggio massimo (px) della dispersione casuale attorno al dito */
    spread: 6,
  },
  // ---- FEATURE C: esplosivi ----
  granata: {
    price: 0, // prezzo in SHOP.prices
    /** danno grezzo per parte al centro dell'esplosione (cala con la distanza) */
    damage: 34,
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
    price: 0, // prezzo in SHOP.prices
    damage: 54,
    cooldownMs: 1400,
    fuseMs: 3000,
    radius: 52,
    pushRadius: 66,
    pushStrength: 18,
    upBoost: 4,
    boomSize: 21,
    shakePx: 4,
  },
} satisfies Record<string, WeaponStats>;

// ---- FEATURE A: armi da lancio ----
/** Costanti comuni dei proiettili lanciati (shuriken, coltello). */
export const THROWN = {
  /** distanza dal muro del punto di lancio (angolo in basso) */
  originInset: 6,
  /** altezza del punto di lancio sopra il pavimento */
  originAboveFloor: 4,
  /** il punto di lancio sta almeno così sopra il bersaglio (colpisce Tony a terra) */
  lowTargetLift: 28,
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

// ---- FEATURE D: negozio ----

/**
 * Negozio e potenziamenti (vedi systems/upgrades.ts e scenes/Shop.ts).
 *
 * Curva dei primi 15 minuti (simulata con i danni/min misurati nel browser,
 * giocatore umano = 60% di un giocatore sempre attivo, combo media x2,5):
 *   1:40 shuriken · 2:40 potenziamento · 5:30 coltello · 6:50 potenziamento ·
 *   10:25 pistola · 11:50 potenziamento · ~15:00 mitragliatrice · livello ~12.
 * Un acquisto ogni ~2 minuti; granata e dinamite sono obiettivi di lungo periodo.
 */
export const SHOP = {
  /**
   * Prezzo per id, usato se WEAPON_STATS[id].price non è > 0.
   * L'ordine è quello di "potenza" attesa delle armi.
   */
  prices: {
    shuriken: 800,
    coltello: 1800,
    pistola: 2900,
    mitragliatrice: 3700,
    granata: 9000,
    dinamite: 18000,
  } as Record<string, number>,
  /** prezzo per un'arma senza price e non presente in `prices` */
  defaultPrice: 1500,
  /** livelli di potenziamento per arma (0 = base) */
  maxLevel: 5,
  /** moltiplicatore del danno per livello 0..maxLevel */
  damageMult: [1, 1.1, 1.2, 1.3, 1.4, 1.5],
  /** moltiplicatore della cadenza per livello: cooldownMs / valore */
  rateMult: [1, 1.04, 1.08, 1.12, 1.16, 1.2],
  // danno x cadenza al L5 = 1,8x: ogni livello ~+12%, mai più del salto alla
  // prossima arma (~1,35x), così comprare armi nuove conviene sempre
  /** costo del primo potenziamento = prezzo arma * upgradeShare ... */
  upgradeShare: 0.45,
  /** ... ma mai meno di così (il Pugno costa 0): Pugno 500/800/1280/2050/3280 */
  upgradeMinBase: 500,
  /** ogni livello costa upgradeGrowth volte il precedente */
  upgradeGrowth: 1.6,
  /** i costi si arrotondano a multipli di questo */
  priceStep: 10,
  /** durata del messaggio "monete insufficienti" (ms) */
  toastMs: 1300,
} as const;

// ---- FEATURE E: progressione ----

/** Esperienza e livelli (systems/progression.ts). */
export const PROGRESSION = {
  /** XP guadagnata per ogni punto di danno */
  xpPerDamage: 1,
  /** XP per passare dal livello L al L+1 = round(xpBase * L ^ xpExponent) */
  // livello 2 dopo ~10 s, livello 5 dopo ~2', livello ~12 dopo 15' di gioco attivo
  xpBase: 220,
  xpExponent: 1.5,
  /** monete premio a ogni level up: levelRewardBase + levelRewardPerLevel * nuovo livello */
  levelRewardBase: 40,
  levelRewardPerLevel: 20,
  /** durata della scritta "LEVEL UP!" */
  levelUpShowMs: 1500,
} as const;

/** Combo: colpi ravvicinati moltiplicano le monete. */
export const COMBO = {
  /** senza colpi per questo tempo la combo si azzera */
  resetMs: 1500,
  /** colpi più ravvicinati di così (raffiche, esplosioni, urti multipli) contano una volta
   *  sola: nessuna arma fa salire la combo più in fretta di un dito che tappa */
  minHitGapMs: 300,
  /** soglie (colpi consecutivi → moltiplicatore monete), in ordine crescente:
   *  tappando a ~3/s: x2 dopo ~4 s, x3 dopo ~12 s, x5 dopo ~27 s senza pause */
  tiers: [
    { hits: 12, mult: 2 },
    { hits: 35, mult: 3 },
    { hits: 80, mult: 5 },
  ],
} as const;

/** Obiettivi giornalieri: per ogni tipo, target possibili e premio (stesso indice). */
export const DAILY = {
  count: 3,
  /** durata del toast "OBIETTIVO!" */
  toastMs: 1600,
  // premi ~ 20-60 s di reddito: utili per arrivare prima alla prossima arma
  kinds: {
    damage: { targets: [3000, 6000, 12000], rewards: [150, 300, 600] },
    head: { targets: [30, 60, 120], rewards: [120, 240, 450] },
    combo: { targets: [3, 5], rewards: [150, 300] },
    bigHit: { targets: [30, 45, 70], rewards: [120, 250, 450] },
    impact: { targets: [1500, 3000, 6000], rewards: [150, 300, 550] },
    hits: { targets: [150, 300, 600], rewards: [100, 220, 400] },
    strong: { targets: [20, 50, 100], rewards: [120, 250, 450] },
  },
} as const;

// ---- FEATURE F: menu e PWA ----

/** Menu iniziale e impostazioni (animazioni a scatti, vibrazione). */
export const MENU = {
  /** durata di un frame dell'animazione del titolo */
  titleFrameMs: 110,
  /** ogni quanti frame del titolo cambia la combinazione di colori */
  titleColorEvery: 6,
  /** pixel di salto della lettera attiva (le vicine saltano di 1) */
  titleJumpPx: 2,
  /** scala dei glifi del titolo (font 5x7 ingrandito, contorno sempre 1px) */
  titleScale: 3,
  /** altalena di Tony: durata di un frame e passo della rotazione */
  swingFrameMs: 130,
  swingStepDeg: 4,
  /** posizioni per lato (±swingSteps * swingStepDeg) */
  swingSteps: 2,
  /** frame per un'oscillazione completa */
  swingPeriodFrames: 12,
  /** lunghezza delle corde dell'altalena (px) */
  swingRope: 96,
  /** vibrazione sui colpi forti (ms) */
  vibrateMs: 30,
} as const;

// ---- CANTIERE: sfondo ----

/**
 * Sfondo del cantiere della galleria (entities/Room.ts). La geometria
 * (strada, galleria, albero) sta in entities/siteLayout.ts: qui solo i
 * margini della zona da tenere libera attorno all'albero dell'incidente.
 */
export const SITE = {
  /** zona libera da oggetti attorno alla base dell'albero (px da TREE.x / TREE.y) */
  treeClear: { side: 12, above: 23, below: 5 },
  /** distanza minima degli oggetti dal bordo della strada (px a schermo) */
  roadClear: 3,
} as const;

// ---- CANTIERE: animazioni ----

/**
 * Animazioni ambientali del cantiere (entities/SiteAmbient.ts): tutte a
 * scatti, solo grafica dietro Tony. Coordinate in pixel logici, tempi in ms.
 */
export const SITE_AMBIENT = {
  /** carrello della gru: tratto percorso lungo il braccio (x del centro) */
  trolleyMinX: 40,
  trolleyMaxX: 156,
  /** il carrello avanza di 1px ogni trolleyStepMs, poi sosta */
  trolleyStepMs: 140,
  trolleyPauseMinMs: 2000,
  trolleyPauseMaxMs: 5000,
  /** dondolo del carico: gradi per scatto, scatti massimi, periodo */
  swingStepDeg: 5,
  swingMaxSteps: 3,
  swingPeriodMs: 2600,
  /** ampiezza (in scatti) a riposo, dopo una frenata e dopo un colpo forte */
  swingAmpRest: 1,
  swingAmpStop: 1.8,
  swingAmpStrong: 3,
  /** tempo per tornare all'ampiezza a riposo */
  swingDecayMs: 1800,
  /** lampeggianti: rosso della gru e coppia arancio/gialla su transenna e cono */
  beaconMs: 600,
  lampMs: 380,
  /** bandierina */
  flagMs: 280,
  /** polvere dalla strada: sbuffi in pool, uno ogni dustMinMs..dustMaxMs */
  dustPool: 4,
  dustMinMs: 1400,
  dustMaxMs: 3800,
  dustStepMs: 120,
  dustSteps: 9,
} as const;

// ---- CANTIERE: incidente ----

/**
 * Incidente (entities/CarCrash.ts): ogni tanto un'utilitaria blu entra lungo
 * la strada e si schianta contro l'albero al centro. Parte SOLO su eventi
 * "importanti", con un cooldown e mai due insieme. Tempi in ms di gioco.
 */
export const CRASH = {
  /** pausa minima tra l'inizio di due incidenti (45 s: raro, resta una sorpresa) */
  cooldownMs: 45000,
  /** colpo singolo da almeno questi danni (evento 'damage') */
  bigHitDamage: 60,
  /** 'level:up' sui livelli multipli di questo numero */
  levelEvery: 3,
  /** la combo arriva a questo moltiplicatore (prima volta nella catena) → sempre */
  comboMult: 5,
  /** combo più bassa (prima volta nella catena) → solo con questa probabilità */
  smallComboMult: 3,
  smallComboChance: 0.25,
  /** ritardo dopo un level up: "LEVEL UP!" e "SBAM!" non si sovrappongono */
  levelUpDelayMs: 1500,
  /** monete bonus = bonusBase + bonusPerLevel * livello (liv. 1 = 110, liv. 9 = 190) */
  bonusBase: 100,
  bonusPerLevel: 10,
  /** durata di un "frame" dell'animazione: tutto si muove a scatti di pixel interi */
  frameMs: 60,
  /** entrata: velocità iniziale, accelerazione per frame e massima (px/frame) */
  enterSpeed: 1,
  enterAccel: 0.4,
  enterMaxSpeed: 5,
  /** scossone all'impatto */
  shakePx: 4,
  shakeMs: 450,
  /** dopo l'impatto: fumo dal cofano, frecce e clacson incantato */
  smokeMs: 2600,
  smokeEveryMs: 180,
  /** vita di uno sbuffo di fumo */
  puffMs: 900,
  hazardMs: 240,
  hornEveryMs: 330,
  hornCount: 6,
  /** uscita: l'auto lampeggia e sparisce */
  leaveMs: 900,
  /** scritta "SBAM!" + monete */
  textMs: 1700,
} as const;
