/**
 * TUTTI i numeri di gameplay e di "feel" stanno qui.
 * Unità: pixel logici (layout di base 180x320, vedi SCREEN), millisecondi,
 * velocità in px/step (la fisica avanza a step fissi di 1/60 s).
 */
import { computeScreen } from './screen';

/**
 * Risoluzione logica: larghezza 180, altezza dal rapporto dello schermo
 * (320 su 9:16 e finestre più larghe, fino a maxHeight sui telefoni lunghi).
 * Le righe in più stanno SOPRA il layout di base: vedi config/screen.ts.
 */
export const SCREEN_FIT = {
  width: 180,
  baseHeight: 320,
  maxHeight: 420,
  /** margine sicuro massimo (notch / indicatore home), px logici */
  maxSafe: 16,
} as const;

/** { width, height, baseHeight, extra, top, safeTop, safeBottom }, calcolato una volta all'avvio. */
export const SCREEN = computeScreen(SCREEN_FIT);

/**
 * Di quanto sale il bordo alto della stanza (soffitto, tubo sotto l'HUD)
 * rispetto al layout di base: <= 0. Le righe in più diventano stanza, meno
 * il margine del notch che spinge giù l'HUD.
 */
export const TOP_SHIFT = SCREEN.top + SCREEN.safeTop;

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
  top: ROOM.ceiling + TOP_SHIFT,
  bottom: SCREEN.baseHeight - ROOM.floor,
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
  /**
   * Limiti morbidi dell'angolo di ogni parte rispetto alla parte a cui è
   * attaccata (gradi, ±). Senza limiti la testa si girava a 180° sul busto.
   */
  jointLimitDeg: {
    head: 45,
    armUpperL: 170,
    armUpperR: 170,
    armLowerL: 150,
    armLowerR: 150,
    legUpperL: 110,
    legUpperR: 110,
    legLowerL: 130,
    legLowerR: 130,
  },
  /** quanta parte dello sforamento si corregge per step (0..1) */
  jointLimitStiffness: 0.25,
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
    /** colpi nel caricatore, poi ricarica automatica (breve) */
    magSize: 8,
    reloadMs: 480,
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
    /** dispersione extra per colpo della raffica (px) e suo massimo */
    spreadGrowth: 0.35,
    spreadMax: 7,
    /** rinculo: la mira sale di climbPerShot px a colpo, fino a climbMax */
    climbPerShot: 0.9,
    climbMax: 14,
    /** caricatore e ricarica automatica */
    magSize: 30,
    reloadMs: 650,
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
    /** raggio della palla di fuoco (px, vedi weapons/explosionFx.ts) */
    boomSize: 20,
    shakePx: 4,
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
    boomSize: 28,
    shakePx: 6,
  },
  // ---- ARMI NUOVE: mischia iconica ----
  piedediporco: {
    price: 0, // prezzo in SHOP.prices
    /** danno di un colpo (tap); il colpo doppio ne fa due */
    damage: 7,
    cooldownMs: 250,
    /** probabilità che il colpo sia doppio (andata + ritorno) */
    doubleChance: 0.2,
    /** Δv alla parte colpita e quota data al resto del corpo */
    impulse: 8,
    bodyShare: 0.3,
    upwardBias: 0.3,
  },
  mazza: {
    price: 0, // prezzo in SHOP.prices
    /** danno a velocità del gesto = refSpeed (scala con la velocità) */
    damage: 13,
    /** pausa minima tra due swing */
    cooldownMs: 330,
    /** velocità minima del gesto (px/step) perché parta lo swing */
    minSpeed: 2.5,
    refSpeed: 8,
    /** il moltiplicatore di velocità resta in [minMult, maxMult] */
    minMult: 0.6,
    maxMult: 1.6,
    /** Δv alla parte colpita + spinta laterale a tutto Tony (px/step, a refSpeed) */
    impulse: 7,
    bodyPush: 3.5,
    upwardBias: 0.35,
    /** gesto più veloce di così = fuoricampo: Tony vola */
    homeRunSpeed: 11,
    homeRunPush: 8,
    hitTolerance: 4,
  },
  katana: {
    price: 0, // prezzo in SHOP.prices
    /** danno per OGNI parte attraversata dal fendente */
    damage: 16,
    /** pausa minima tra due fendenti */
    cooldownMs: 280,
    /** velocità minima del gesto (px/step) per tagliare */
    minSpeed: 3.5,
    hitTolerance: 3,
    /** parti colpite al massimo da un fendente */
    maxParts: 6,
    /** Δv a ogni parte tagliata, lungo il gesto */
    impulse: 4,
  },
  motosega: {
    price: 0, // prezzo in SHOP.prices
    /** danno per "morso" della catena */
    damage: 12.5,
    /** ms tra due morsi mentre la lama tocca Tony */
    cooldownMs: 50,
    hitTolerance: 4,
    /** tremolio impresso alla parte tagliata (px/step) */
    jitter: 1.6,
    /** attrazione della parte verso la lama (px/step per morso) */
    pull: 0.5,
  },
  // ---- ARMI NUOVE: elementali ----
  lanciafiamme: {
    price: 0, // prezzo in SHOP.prices
    /** danno a ogni tick del getto, per ogni parte nel cono */
    damage: 3.5,
    /** ms tra due tick di danno del getto mentre il dito è giù */
    cooldownMs: 120,
    /** parti colpite al massimo per tick (le più vicine al dito) */
    maxParts: 3,
    /** semi-ampiezza del cono (rad) e margine laterale (px) */
    coneHalf: 0.26,
    coneMargin: 4,
    /** gittata massima del getto (px) */
    range: 260,
    /** spinta del getto sulla parte colpita (px/step) */
    push: 0.45,
    /** durata del fuoco su una parte, tick del danno nel tempo, quota del danno per tick */
    burnMs: 2600,
    burnTickMs: 300,
    burnShare: 0.6,
  },
  fulmine: {
    price: 0, // prezzo in SHOP.prices
    /** danno della saetta sulla prima parte */
    damage: 36,
    cooldownMs: 480,
    /** raggio (px) entro cui la saetta trova la parte più vicina al dito */
    strikeRadius: 30,
    /** salti della catena, raggio di ogni salto (px), quota di danno a ogni salto */
    chainCount: 3,
    chainRange: 26,
    chainMult: 0.6,
    /** spinta verso il basso della saetta (px/step) e tremolio delle parti folgorate */
    impulse: 4,
    shiver: 1.2,
  },
  ghiaccio: {
    price: 0, // prezzo in SHOP.prices
    damage: 15,
    cooldownMs: 300,
    impulse: 3,
    /** colpi ravvicinati per congelare, finestra (ms) tra un colpo e l'altro */
    hitsToFreeze: 3,
    comboWindowMs: 1300,
    /** durata massima del blocco di ghiaccio; prima di minFreezeMs un colpo non lo rompe */
    freezeMs: 2000,
    minFreezeMs: 250,
    /** frantumazione: danno sulla parte colpita = damage * shatterMult, altre parti damage * splashMult */
    shatterMult: 6,
    splashMult: 1.5,
    splashParts: 4,
    /** spinta radiale della frantumazione (raggio px, forza px/step) */
    shatterRadius: 50,
    shatterPush: 9,
  },
  tornado: {
    price: 0, // prezzo in SHOP.prices
    /** piccolo danno a contatto a ogni tick (parti dentro il vortice) */
    damage: 8,
    /** pausa tra due tornado (dalla nascita) */
    cooldownMs: 3800,
    lifeMs: 3000,
    contactTickMs: 250,
    contactParts: 3,
    contactRadius: 20,
    /** orbita di Tony attorno al centro: raggio (px), velocità tangente, risucchio, aderenza */
    orbitR: 10,
    spinSpeed: 2.5,
    suckSpeed: 6,
    pull: 0.2,
    grip: 0.25,
    /** rotazione di Tony su se stesso (rad/step) */
    tumble: 0.14,
    /** oscillazione orizzontale del vortice (px, rad/s) e salita (px) */
    driftAmp: 14,
    driftFreq: 1.7,
    rise: 30,
    /** scagliata finale contro il muro (px/step) */
    throwSpeed: 17,
    throwUp: 3,
    /** danno bonus del primo urto dopo la scagliata = damage * slamMult */
    slamMult: 75,
    slamWindowMs: 900,
  },
  // ---- ARMI NUOVE: fantascienza ----
  minigun: {
    price: 0, // prezzo in SHOP.prices
    /** danno per proiettile (testa x2 = 13: sotto FX.strongHitDamage, niente hit-stop a raffica) */
    damage: 6.6,
    /** ms tra due colpi a canne lanciate */
    cooldownMs: 34,
    /** proiettili per colpo (le canne sparano a coppie) */
    pellets: 2,
    /** tempo per portare le canne a regime e per fermarle */
    spinUpMs: 600,
    spinDownMs: 900,
    /** Δv nella direzione dello sparo (px/step) e scossa laterale alternata che fa "ballare" Tony */
    impulse: 1.1,
    dance: 1.4,
    /** Δv verso l'alto a ogni colpo a segno: Tony saltella sotto la raffica */
    lift: 1.5,
    bodyShare: 0.02,
    hitTolerance: 2,
    /** raggio (px) della dispersione attorno al dito */
    spread: 7,
  },
  raggio: {
    price: 0, // prezzo in SHOP.prices
    /** danno per parte al centro della piccola esplosione verde (cala col raggio) */
    damage: 15,
    cooldownMs: 200,
    /** velocità dell'anello (px/step) */
    speed: 7,
    /** raggio del danno e della spinta (px), forza della spinta al centro (px/step) */
    radius: 17,
    pushRadius: 26,
    pushStrength: 6,
  },
  plasma: {
    price: 0, // prezzo in SHOP.prices
    /** danno per parte al centro dell'esplosione a carica piena */
    damage: 127,
    /** pausa minima tra un rilascio e l'inizio della carica successiva */
    cooldownMs: 250,
    /** tempo di carica piena; sotto minCharge il colpo si spegne */
    chargeMs: 1200,
    minCharge: 0.35,
    /** velocità della sfera (px/step): lenta */
    speed: 2.2,
    radius: 48,
    pushRadius: 80,
    pushStrength: 19,
    /** saette in volo: danno = damage * boltShare, ogni boltEveryMs, fino a boltCount parti entro boltRange px */
    boltShare: 0.3,
    boltEveryMs: 110,
    boltCount: 2,
    boltRange: 46,
  },
  gravita: {
    price: 0, // prezzo in SHOP.prices
    /** piccolo danno allo sparo (il grosso arriva dagli urti) */
    damage: 14,
    cooldownMs: 120,
    /** velocità di lancio (px/step, limitata da GRAB.maxThrowSpeed) + spinta extra a tutto il corpo */
    throwSpeed: 18,
    extraSpeed: 8,
    /** presa tenuta almeno fullMs = sparo a piena potenza (prima: da minPower) */
    fullMs: 350,
    minPower: 0.45,
    /** quota della distanza dito→arma di cui la parte viene tirata verso l'arma */
    pull: 0.3,
    /** la parte presa resta almeno lift px sopra il pavimento (Tony sollevato) */
    lift: 36,
    /** tolleranza (px) per agganciare una parte col raggio */
    pickTolerance: 12,
    /** tap senza presa su Tony: spintone */
    puntImpulse: 8,
    /** dopo lo sparo, per slamMs: ogni parte che sbatte contro la stanza perdendo più di
     *  slamMinDv px/step fa danno extra = (Δv - slamMinDv) * slamScale (oltre all'urto normale) */
    slamMs: 1000,
    slamMinDv: 6,
    slamScale: 4.4,
  },
  // ---- ARMI NUOVE: fucili iconici ----
  doppietta: {
    price: 0, // prezzo in SHOP.prices
    /** danno grezzo di OGNI pallino */
    damage: 4,
    /** pausa minima tra le due canne */
    cooldownMs: 240,
    /** pallini per colpo e semi-apertura del cono (radianti) */
    pellets: 9,
    coneRad: 0.16,
    /** Δv di ogni pallino sulla parte colpita (px/step) + quota a tutto Tony */
    impulse: 2.4,
    bodyShare: 0.06,
    hitTolerance: 1,
    /** colpi prima della ricarica e durata della ricarica a libro */
    shots: 2,
    reloadMs: 700,
  },
  fucile: {
    price: 0, // prezzo in SHOP.prices
    damage: 9.7,
    /** cadenza della raffica (tieni premuto) */
    cooldownMs: 90,
    impulse: 2.6,
    bodyShare: 0.05,
    hitTolerance: 2,
    /** dispersione casuale (px) attorno al punto mirato */
    spread: 3,
    /** caricatore e ricarica rapida */
    magSize: 30,
    reloadMs: 600,
    /** rinculo: px di salita della mira a ogni colpo, massimo, recupero (px/step) */
    recoilPerShot: 0.6,
    recoilMax: 7,
    recoilRecover: 0.5,
  },
  cecchino: {
    price: 0, // prezzo in SHOP.prices
    damage: 210,
    /** otturatore: pausa tra due colpi */
    cooldownMs: 950,
    /** moltiplicatore del danno grezzo alla testa (oltre al x2 di parte) */
    headMult: 3,
    impulse: 11,
    bodyShare: 0.3,
    hitTolerance: 2,
    /** ondeggiamento del mirino: px all'apertura e a regime */
    swayStartPx: 5,
    swayPx: 1.5,
    /** ms per passare dall'ondeggiamento iniziale a quello a regime */
    steadyMs: 450,
  },
  rpg: {
    price: 0, // prezzo in SHOP.prices
    /** danno grezzo per parte al centro dell'esplosione (cala con la distanza) */
    damage: 34,
    /** ricarica: nuovo razzo nel tubo */
    cooldownMs: 1100,
    radius: 42,
    pushRadius: 58,
    pushStrength: 19,
    upBoost: 4,
    /** volo del razzo: velocità iniziale, accelerazione, massima (px/step) */
    speed: 3.5,
    accel: 0.35,
    maxSpeed: 9,
    boomSize: 20,
    shakePx: 5,
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
  /** con l'arma in mano (gunView) i bossoli cadono sul pavimento in primo piano */
  shellFloorY: 297,
  shellViewVx: 1.6,
  /** shake a ogni colpo (px interi, ms) */
  shotShakePx: 1,
  shotShakeMs: 60,
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
  hitStopMs: 50,
  shakeMs: 460,
  /** granata: lampeggio della spoletta (ms per fase, dall'inizio alla fine) */
  blinkSlowMs: 260,
  blinkFastMs: 45,
  /** dinamite: lunghezza massima della miccia (px) e ogni quanto scintilla */
  fuseLength: 4,
  sparkEveryMs: 40,
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
    // ---- ARMI NUOVE: mischia iconica ----
    piedediporco: 1400,
    mazza: 2400,
    katana: 8000,
    motosega: 21000,
    // ---- ARMI NUOVE: elementali ----
    lanciafiamme: 7000,
    fulmine: 11000,
    ghiaccio: 13000,
    tornado: 26000,
    // ---- ARMI NUOVE: fantascienza ----
    minigun: 40000,
    raggio: 50000,
    plasma: 65000,
    gravita: 80000,
    // ---- ARMI NUOVE: fucili iconici ----
    doppietta: 3300,
    fucile: 5200,
    cecchino: 16000,
    rpg: 32000,
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
  swingStepDeg: 2,
  /** posizioni per lato (±swingSteps * swingStepDeg) */
  swingSteps: 2,
  /** frame per un'oscillazione completa */
  swingPeriodFrames: 12,
  /** lunghezza delle corde dell'altalena (px): partono da sopra lo schermo */
  swingRope: 214,
  /** perno dell'altalena: fuori dallo schermo, sopra il titolo (le corde "spariscono" in alto) */
  swingPivotY: -44,
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
  /** lampeggianti: rosso della gru, coni a bordo strada (alternati) */
  beaconMs: 600,
  lampMs: 380,
  /** luci ai lati del portale della galleria (alternate) */
  tunnelLampMs: 450,
  /** lucine dentro la bocca della galleria: una alla volta, dalla bocca verso il fondo */
  tunnelSeqMs: 200,
  /** coni con lampeggiante a bordo strada: [profondità z, lato (-1 sinistra, 1 destra)] */
  cones: [
    [1.6, 1],
    [2.6, -1],
    [3.6, 1],
    [6, -1],
  ] as readonly (readonly [number, number])[],
  /** bandierina a terra a lato della strada: profondità z, lato */
  flagZ: 3,
  flagSide: 1,
  flagMs: 280,
  /** polvere dai bordi della strada: sbuffi in pool, uno ogni dustMinMs..dustMaxMs, a z dustZMin..dustZMax */
  dustPool: 4,
  dustMinMs: 1400,
  dustMaxMs: 3800,
  dustZMin: 1.3,
  dustZMax: 5,
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
  /**
   * entrata in prospettiva lungo la strada (vedi entities/siteLayout.ts):
   * l'auto parte a profondità enterZ (appena sotto il bordo basso) e avanza in z
   * a velocità costante nel mondo (zSpeed, z/s); da zAccelFrom accelera di
   * zAccel z/s² fino a zSpeedMax. A CRASH_LEAVE_Z smette di sterzare e tira
   * dritto verso l'albero, frenando (velocità x skidSpeedMult). ~2,8 s in tutto.
   */
  enterZ: 0.95,
  zSpeed: 1.2,
  zAccelFrom: 3.1,
  zAccel: 1.6,
  zSpeedMax: 1.9,
  skidSpeedMult: 0.8,
  /** spostamento dal centro strada, in frazioni della larghezza (+ = a destra) */
  lane: 0.15,
  /**
   * larghezza a schermo desiderata dell'auto = carWidthK / z (sceglie la taglia
   * pre-disegnata): con 45 l'auto è larga 10 px nel tratto dritto e contro
   * l'albero (z 3,75..5,3), 28/20/14 lungo le curve, 7 vicino alla galleria
   */
  carWidthK: 45,
  /** entro ±backViewDeg dalla verticale l'auto si vede da dietro, oltre di 3/4 */
  backViewDeg: 14,
  /** scossone all'impatto (leggero: l'incidente è lontano) */
  shakePx: 2,
  shakeMs: 350,
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
  /**
   * driveIntoTunnel (intro del mondo 2): l'auto non esce di strada, segue la
   * strada fino a Z_FAR con velocità massima tunnelSpeedMax (z/s), poi entra
   * nella bocca: tunnelFadeFrames frame di sagoma nel buio, poi il lampo dei
   * fanali per tunnelFlashFrames frame
   */
  tunnelSpeedMax: 2.6,
  tunnelFadeFrames: 3,
  tunnelFlashFrames: 4,
} as const;

// ---- MONDI ----

/**
 * Mondi (scenes/Menu.ts, scenes/Game.ts): 1 = cantiere fuori dalla galleria,
 * 2 = dentro la galleria (250 M), 3 = più in fondo (500 M). Scegliendo il
 * mondo 2 o 3 si parte nel mondo 1 con l'intro: dopo introDelayMs l'utilitaria
 * entra nella galleria, la camera zooma dentro la bocca, dissolvenza al nero e
 * restart di Game nel mondo scelto, che parte zoomato e fa zoom-out fino a 1.
 */
export const WORLDS = {
  /** livello giocatore che sblocca il mondo 2 */
  unlockLevel: 5,
  /** livello giocatore che sblocca il mondo 3 (500 M) */
  unlockLevel3: 10,
  /** metri di galleria scavati mostrati sul cartello per mondo (indice = mondo - 1); i mondi successivi seguiranno 1000, 2000, 4000 → boss finale */
  meters: [0, 250, 500, 1000, 2000, 4000] as readonly number[],
  /** attesa (ms di gioco) prima che l'auto dell'intro parta dal basso */
  introDelayMs: 5000,
  /** zoom a scatti dentro la bocca della galleria (un livello ogni zoomStepMs) */
  zoomIn: [1.5, 2, 3, 4, 5, 6, 7],
  /** zoom-out all'arrivo nel mondo 2 (dal primo valore fino a 1) */
  zoomOut: [7, 5, 4, 3, 2, 1.5, 1],
  zoomStepMs: 110,
  /** dissolvenza al nero prima del restart e schiarita all'arrivo */
  fadeOutMs: 220,
  fadeInMs: 260,
  /** cartello "250 M" / "500 M" a schermo all'arrivo in galleria: attesa dopo lo zoom-out, durata, lampeggi d'entrata */
  titleDelayMs: 150,
  titleMs: 1800,
  titleBlinks: 3,
  titleBlinkMs: 70,
} as const;

// ---- GALLERIA PROFONDA (MONDO 3) ----

/**
 * Extra del mondo 3 (entities/TunnelDeep.ts), sopra la galleria del mondo 2:
 * luce più calda e scura, gocce dalla volta con cerchi nelle pozzanghere,
 * ventilatore, lampada appesa che dondola ai colpi forti, mini escavatore,
 * radio con le note, topo sul marciapiede, polvere di roccia, cartello
 * PERICOLO con le lucine. Profondità in coordinate mondo della galleria
 * (vedi gfx/tunnelSprites.ts), tempi in ms, velocità in unità mondo al secondo.
 */
export const TUNNEL_DEEP = {
  /** velo sopra lo sfondo (sotto Tony): scuro + rosso caldo, più fitto in alto */
  moodDarkAlpha: 0.22,
  moodWarmAlpha: 0.16,
  moodTopAlpha: 0.22,
  moodTopH: 110,
  /** gocce: una ogni dripMinMs..dripMaxMs da un punto a caso, caduta con gravità (mondo/s²) */
  dripPool: 6,
  dripMinMs: 350,
  dripMaxMs: 1100,
  dripGravity: 420,
  /** cerchi nell'acqua: raggio massimo (mondo), passi e durata di un passo */
  rippleR: 9,
  rippleSteps: 5,
  rippleStepMs: 90,
  ripplePool: 5,
  /** "plic" delle gocce: probabilità per goccia e pausa minima tra due */
  plinkChance: 0.35,
  plinkMinGapMs: 500,
  /** ventilatore: un frame delle pale ogni fanFrameMs, ogni tanto rallenta */
  fanFrameMs: 55,
  fanSlowMs: 140,
  fanSlowMinMs: 6000,
  fanSlowMaxMs: 14000,
  fanSlowLenMs: 2500,
  /** lampada appesa: pendolo (lunghezza a schermo), smorzamento, spinta per colpo forte, passo di quantizzazione */
  lampLen: 26,
  lampGravity: 0.00002,
  lampDamping: 0.9985,
  lampKick: 0.0009,
  lampKickPerDamage: 0.000004,
  lampMaxSpeed: 0.0024,
  lampStep: 0.07,
  /** sfarfallio della lampada: ogni flickerMinMs..flickerMaxMs qualche scatto spento */
  lampFlickerMinMs: 4000,
  lampFlickerMaxMs: 10000,
  lampFlickerSteps: 5,
  lampFlickerStepMs: 60,
  /** mini escavatore: un frame del braccio ogni digFrameMs, pausa tra due cicli, lampeggiante */
  digFrameMs: 260,
  digPauseMinMs: 900,
  digPauseMaxMs: 2600,
  beaconMs: 180,
  /** radio: battito dell'altoparlante e una nota ogni noteMinMs..noteMaxMs che sale per noteSteps passi */
  radioBeatMs: 300,
  noteMinMs: 500,
  noteMaxMs: 1100,
  noteStepMs: 120,
  noteSteps: 9,
  notePool: 4,
  /** topo: corre lungo il cordolo verso chi guarda, poi sparisce; velocità e pause */
  ratSpeed: 70,
  ratFleeMult: 2.4,
  ratFrameMs: 70,
  ratStepMs: 33,
  ratWaitMinMs: 5000,
  ratWaitMaxMs: 12000,
  /** il topo si ferma ad annusare con questa probabilità per corsa */
  ratSniffChance: 0.6,
  ratSniffMs: 900,
  /** polvere di roccia sospesa: granelli in pool, passo di deriva */
  motePool: 14,
  moteStepMs: 120,
  /** colpo forte: sassolini che cadono dalla volta (spawnParticles) */
  pebbleCount: 5,
  /** cartello PERICOLO: lucine rosse alternate e dondolio dopo un colpo forte */
  dangerBlinkMs: 420,
  dangerSwingMs: 120,
  dangerSwingSteps: 6,
} as const;

// ---- METEO ----

/**
 * Agenti atmosferici (systems/weather.ts + entities/WeatherFx.ts):
 * sereno → evento (neve / pioggia / vento / temporale) → sereno.
 * Velocità in px/step, accelerazioni in px/step per step, tempi in ms.
 */
export const WEATHER = {
  /** pausa di sereno tra due eventi [min, max]; la prima è più corta */
  clearMs: [40000, 120000],
  firstClearMs: [20000, 45000],
  /** durata di un evento [min, max] (rampe comprese) */
  eventMs: [25000, 60000],
  /** probabilità relative degli eventi */
  weights: { snow: 1, rain: 1.2, wind: 1, storm: 0.8 },
  /** intensità per evento [min, max] (il temporale è sempre al massimo) */
  strength: [0.65, 1],
  /** rampa di entrata/uscita: la densità sale/scende a scatti in rampSteps gradini */
  rampMs: 3500,
  rampSteps: 5,

  // ---- precipitazioni (pool unico di immagini, tetto fisso)
  maxPrecip: 120,
  /** nuovi fiocchi/gocce al massimo per frame */
  spawnPerFrame: 3,
  /** y di partenza (sotto il tubo dell'HUD) */
  spawnY: 20,
  snowMax: 70,
  snowSpeed: [0.35, 0.7],
  /** ogni quanto un fiocco fa uno scatto laterale di 1px */
  snowSwayMs: [180, 420],
  /** quota del vento che inclina la neve */
  snowDriftMult: 0.6,
  /** fiocco posato su Tony: quanto resta [min, max] e ultimi ms in cui si scioglie */
  stickMs: [2500, 5000],
  meltMs: 700,
  meltBlinkMs: 90,
  maxStuck: 28,
  /** strato di neve a terra (y = ROOM_INNER.bottom): fiocchi per alzare 1px, altezza max */
  groundHitsPerPx: 1,
  groundMaxPx: 3,
  /** a fine neve: ogni quanto lo strato perde 1px (a caso per colonna) */
  groundMeltStepMs: 1400,
  groundMeltChance: 0.3,
  /** neve sul caschetto: fiocchi in testa per livello, livelli, scioglimento */
  capHitsPerLevel: 3,
  capMaxLevel: 3,
  capMeltStepMs: 2200,
  /** neve forte (intensità >= shiverAt): Tony trema con piccoli impulsi */
  shiverAt: 0.8,
  shiverEveryMs: 140,
  shiverDv: 0.18,

  rainMax: 100,
  stormRainMax: 120,
  rainSpeed: [4, 5.5],
  /** brezza della pioggia/neve senza vento (solo grafica, px/step) */
  breeze: 0.35,
  /** inclinazione: px/step orizzontali delle gocce a vento 1 */
  precipDriftPerWind: 2.6,
  /** schizzi sopra le parti di Tony colpite (tetto per frame) */
  splashParticles: 2,
  maxSplashesPerFrame: 4,
  /** probabilità che una goccia a terra faccia uno schizzo */
  groundSplashChance: 0.2,
  /** pozzanghere: quante, larghezza massima, scatti di crescita e asciugatura */
  puddles: [4, 6],
  puddleMaxW: [10, 26],
  puddleGrowMs: [600, 1500],
  puddleDryMs: [500, 1100],

  // ---- vento: accelerazione orizzontale sulle parti di Tony a ogni step
  windAccel: 0.1,
  /** le parti leggere (testa, braccia, gambe) prendono più vento del busto */
  lightPartMult: 1.5,
  /** spinta verso l'alto delle parti leggere a raffica piena */
  windLift: 0.03,
  /** oltre questa velocità nella direzione del vento non spinge più: niente urti forti */
  windMaxVx: 3,
  /** raffiche: valore minimo/massimo, durata di ogni raffica, gradino di variazione */
  gustLow: 0.3,
  gustMs: [1200, 3200],
  gustStepMs: 140,
  gustStep: 0.15,
  stormWindMult: 0.8,
  /** foglie/carta/polvere che volano */
  debrisMax: 14,
  /** probabilità per frame a vento 1 */
  debrisRate: 0.35,
  debrisSpeed: [2.2, 4],

  // ---- temporale
  lightningEveryMs: [3500, 9000],
  /** frame di lampo bianco (due lampi ravvicinati) e della saetta */
  flashFrames: 2,
  secondFlashFrames: 1,
  secondFlashDelayFrames: 4,
  boltFrames: 7,
  thunderDelayMs: [250, 900],
  thunderShakePx: 2,
  thunderShakeMs: 320,

  // ---- annuncio sotto l'HUD
  announceY: 44,
  announceMs: 2400,
  announceBlinkMs: 150,

  // ---- audio (chunk di rumore filtrato ripetuti: fruscio "a scatti" chiptune)
  rainChunkMs: 120,
  rainVol: 0.05,
  windChunkMs: 230,
  windVol: 0.07,

  // ---- al chiuso (mondo 2): gocce dal soffitto e correnti d'aria
  dripEveryMs: [900, 2600],
  /** tempo in cui la goccia si forma attaccata al soffitto */
  dripHangMs: 500,
  dripGravity: 0.18,
  dripMaxSpeed: 6,
  dripPuddleMaxW: 6,
  draftEveryMs: [9000, 22000],
  draftMs: [2500, 5000],
  /** forza della corrente in unità di vento (0..1) */
  draftStrength: 0.3,
  /** forzato da debug: gocciolio intenso per quanto, e a che ritmo */
  dripBurstMs: 20000,
  dripBurstEveryMs: [150, 450],
} as const;

// ---- MONDO 2: galleria ----

/**
 * Interno della galleria (entities/TunnelWorld.ts): solo grafica e suoni
 * ambientali dietro Tony, tutto a scatti. Tempi in ms, velocità in unità
 * "mondo" della prospettiva (1 = 1 px a profondità z = 1) al secondo.
 */
export const TUNNEL_WORLD = {
  /** talpa: un frame della testa fresante ogni cutterFrameMs mentre scava */
  cutterFrameMs: 110,
  /** scavo continuo per runMinMs..runMaxMs, poi sosta pauseMinMs..pauseMaxMs */
  runMinMs: 9000,
  runMaxMs: 15000,
  pauseMinMs: 1800,
  pauseMaxMs: 3200,
  /** vibrazione: ogni vibrateMs la macchina si sposta di ±1px con probabilità vibrateChance */
  vibrateMs: 70,
  vibrateChance: 0.35,
  /** spinta: la macchina avanza di 1px per thrustMs, poi torna indietro (ciclo 2*thrustMs) */
  thrustMs: 1300,
  /** lampeggianti arancio sulla talpa (alternati) */
  beaconMs: 340,
  /** fumi: pool di sbuffi, uno ogni smokeMinMs..smokeMaxMs mentre scava (x3 in sosta) */
  smokePool: 24,
  smokeMinMs: 80,
  smokeMaxMs: 200,
  smokeStepMs: 110,
  smokeSteps: 18,
  /** scintille sul bordo della testa (spawnParticles) */
  sparkMinMs: 250,
  sparkMaxMs: 900,
  /** nastro trasportatore: detriti in pool che scorrono verso chi guarda */
  debrisPool: 10,
  debrisSpeed: 70,
  debrisStepMs: 50,
  /** neon: ogni tanto uno sfarfalla (flickerMs, scatti flickerStepMinMs..Max) e, con offChance, resta spento */
  neonEventMinMs: 3500,
  neonEventMaxMs: 8000,
  neonFlickerMs: 800,
  neonFlickerStepMinMs: 40,
  neonFlickerStepMaxMs: 110,
  neonOffChance: 0.65,
  neonOffMinMs: 1800,
  neonOffMaxMs: 4500,
  /** micro-lampeggio di un neon a caso (frame attenuato) */
  neonBlinkMinMs: 900,
  neonBlinkMaxMs: 2600,
  neonBlinkMs: 60,
  /** luce di emergenza vicino all'uscita: raffiche di emergencyBlinks lampi ogni emergencyMinMs..Max */
  emergencyMinMs: 5000,
  emergencyMaxMs: 11000,
  emergencyBlinks: 6,
  emergencyMs: 220,
  /** navetta da cantiere: fermate (profondità mondo) percorse in ciclo, sosta stopMinMs..stopMaxMs */
  vehicleStops: [240, 140, 240, 322] as readonly number[],
  vehicleSpeed: 55,
  vehicleStepMs: 50,
  vehicleStopMinMs: 4000,
  vehicleStopMaxMs: 9000,
  vehicleBeaconMs: 260,
  /** cambio di corsia (mondo/s): verso chi guarda va a sinistra, quando si allontana a destra */
  vehicleLaneSpeed: 22,
  /** ruote: un frame del battistrada ogni wheelMs mentre si muove (solo taglie grandi) */
  vehicleWheelMs: 90,
  /** polvere dietro le ruote: pool e uno sbuffo ogni dustMinMs..dustMaxMs in marcia */
  vehicleDustPool: 8,
  vehicleDustMinMs: 120,
  vehicleDustMaxMs: 260,
  /** detriti: lato del sasso in unità mondo (1 ≈ 5 cm), a schermo 1..debrisMaxPx px */
  debrisMinSize: 2.5,
  debrisMaxSize: 4.5,
  debrisMaxPx: 4,
  /** operai lontani: cambio di posa mentre lavorano */
  workerMinMs: 500,
  workerMaxMs: 1400,
  /** pausa sigaretta: ogni breakMinMs..breakMaxMs di lavoro; con breakTogetherChance anche l'altro si ferma */
  breakMinMs: 9000,
  breakMaxMs: 20000,
  breakTogetherChance: 0.5,
  /** tira fuori il pacchetto (pocketMs), sigaretta in bocca (placeMs), accendino a lampi di flashMs per lightMs */
  cigPocketMs: 600,
  cigPlaceMs: 400,
  cigLightMs: 720,
  cigFlashMs: 90,
  /** durata della pausa; tirate di dragMs ogni dragGapMinMs..Max (mano giù tra una e l'altra) */
  cigSmokeMinMs: 7000,
  cigSmokeMaxMs: 12000,
  cigDragMs: 700,
  cigDragGapMinMs: 1100,
  cigDragGapMaxMs: 2300,
  /** fumo: dopo ogni tirata exhalePuffs sbuffi ogni exhaleGapMs; dalla brace a riposo uno ogni idleSmokeMs */
  cigExhalePuffs: 3,
  cigExhaleGapMs: 170,
  cigIdleSmokeMs: 650,
  /** brace di 1 px: lampeggio a riposo (arancio/rosso) e durante la tirata (giallo/bianco) */
  cigEmberMs: 280,
  cigDragEmberMs: 100,
  /** lancio del mozzicone: posa throwMs, volo a passi di buttStepMs, resta a terra buttMs */
  cigThrowMs: 450,
  cigButtStepMs: 60,
  cigButtMs: 1400,
  /** pool del fumo di sigaretta (sbuffi da 1-2 px), passo e durata in passi */
  cigSmokePool: 10,
  cigSmokeStepMs: 130,
  cigSmokeSteps: 14,
  /** mondo 3: tra una tirata e l'altra, con beerChance un sorso (su upMs, a garganella tiltMs) */
  beerChance: 0.45,
  beerUpMs: 260,
  beerTiltMs: 800,
  /** goccia di schiuma che cola dalla mano con probabilità foamChance, 1 px ogni dropStepMs */
  beerFoamChance: 0.45,
  beerDropStepMs: 70,
  /** ronzio della talpa ogni humMinMs..humMaxMs; bzz del neon al massimo ogni bzzMinGapMs */
  humMinMs: 6000,
  humMaxMs: 10000,
  bzzMinGapMs: 120,
} as const;

// ---- JUICE ----
/** "Dopamina" sui colpi (gfx/juice.ts, systems/feedback.ts, systems/damage.ts). I tetti dei pool stanno in FX. */
export const JUICE = {
  // ---- critici (applicati in systems/damage.dealDamage)
  /** probabilità che un colpo sia CRITICO */
  critChance: 0.08,
  critMultiplier: 2,

  // ---- scritte fumetto (SMACK! POW! ...) sui colpi forti / critici
  wordMinGapMs: 250,
  maxWords: 3,
  wordMs: 640,
  /** durata dei frame del pop (scala 3 → 2) */
  wordPopFrameMs: 45,
  /** frazione della vita da cui trema di 1px, e da cui lampeggia */
  wordShakeFrom: 0.2,
  wordBlinkFrom: 0.72,
  /** rotazione massima del pop, quantizzata in passi da wordRotStep (rad) */
  wordRotMax: 0.24,
  wordRotStep: 0.08,
  /** frame della "esplosione" dietro la scritta */
  wordBurstFrameMs: 70,

  // ---- colpi "molto forti": impact frame + punch-zoom
  veryStrongDamage: 40,
  /** frame (≤ 2) in cui Tony è una sagoma bianca su sfondo scuro; al massimo uno ogni impactCooldownMs */
  impactFrames: 2,
  impactCooldownMs: 1000,
  impactOverlayAlpha: [0.9, 0.75],
  zoomSteps: [1.04, 1.02, 1],
  zoomStepMs: 40,

  // ---- linee d'impatto radiali (colpi forti)
  speedLineCount: 12,
  speedLineInner: 8,
  speedLineLen: [5, 11],
  speedLineFrameMs: 40,
  maxSpeedLines: 3,

  // ---- cornice colorata sui critici (2px, a scatti)
  borderPx: 2,
  borderFrameMs: 45,
  borderFrames: 4,

  // ---- squash & stretch della parte colpita (solo grafica, la fisica non cambia)
  squash: [
    [1.2, 0.8],
    [1.1, 0.9],
  ],
  squashFrameMs: 34,

  // ---- numeri di danno
  /** da qui il numero è a scala 2 */
  numberScale2At: 30,
  /** colpi sulla stessa parte entro questo tempo si sommano in un unico numero */
  numberMergeMs: 320,
  /** frame del "rimbalzo" (scala +1 al primo frame) */
  numberPopMs: 50,

  // ---- monete che volano verso l'HUD
  maxCoinsPerGain: 5,
  maxFlyingCoins: 24,
  coinFlyMs: 520,
  coinStaggerMs: 45,
  /** le monete si muovono a scatti di questo passo */
  coinStepMs: 33,
  /** ultimo colpo più vecchio di così: le monete partono dal centro dello schermo */
  coinOriginMaxAgeMs: 250,
  coinBumpMs: 60,

  // ---- audio
  dingVol: 0.12,
  swooshVol: 0.09,
} as const;

// ---- ARMI NUOVE: mischia iconica ----
/** Costanti di animazione/feel di piede di porco, mazza, katana e motosega. */
export const MELEE2 = {
  /** piede di porco: distanza mano → punta (px) e durata di un frame dello swing */
  crowLen: 14,
  crowFrameMs: 40,
  /** ritardo del secondo colpo del colpo doppio */
  crowDoubleDelayMs: 130,
  /** mazza */
  batLen: 18,
  batFrameMs: 40,
  /** stella del fuoricampo: durata e frame */
  starMs: 700,
  starFrameMs: 70,
  /** katana: durata della scia e dello sprite della lama */
  slashTrailMs: 280,
  slashFrameMs: 45,
  /** motosega: tremolio dello sprite (px), cadenza dei suoni del motore */
  sawShakePx: 1,
  sawEngineMs: 55,
  /** tempo per arrivare al massimo dei giri (ms) */
  sawSpinUpMs: 700,
  sawIdleHz: 55,
  sawMaxHz: 150,
  /** distanza dal dito della punta della lama (px) */
  sawOffset: 9,
} as const;

// ---- ANIMAZIONI: armi da fuoco ----

/**
 * Arma in mano a schermo (weapons/gunView.ts, stile FPS rétro): pistola e
 * mitragliatrice disegnate in basso, sopra Tony e sotto l'HUD. Tempi in ms,
 * distanze in px logici, velocità in px/step.
 */
export const GUN_VIEW = {
  /** riga più bassa dello sprite: sopra la fascia HUD (y 300..315) */
  baseY: 299,
  /** a riposo l'arma sta a destra (mano destra), così non copre Tony al centro */
  centerX: 128,
  /** l'arma segue il bersaglio in orizzontale (frazione) entro [minX, maxX] */
  follow: 0.35,
  minX: 66,
  maxX: 146,
  /** px al frame massimi dello spostamento orizzontale (a scatti) */
  followStepPx: 3,
  /** senza tocchi per tanto, torna al centro */
  idleReturnMs: 1400,
  /** oscillazione a riposo: 1px, 2 frame */
  bobMs: 420,
  /** pose: inclinazione (shear) e soglie dell'angolo di mira (rad, 0 = dritto in su) */
  poseSlopes: [-0.34, -0.17, 0, 0.17, 0.34],
  poseAngles: [-0.5, -0.17, 0.17, 0.5],
  /** rinculo: offset y per frame (px, negativo = su) */
  kickFrames: [-3, -2, -1],
  kickFrameMs: 30,
  /** frame con carrello/otturatore indietro dopo lo sparo */
  slideFrames: 2,
  /** vampata alla volata e alone attorno alla canna */
  flashFrameMs: 32,
  haloMs: 34,
  /** tracciante: quanto resta visibile (>= 1 frame) */
  tracerMs: 34,
  /** frazione del tracciante (dalla bocca) disegnata in bianco (poi bianco/giallo) */
  tracerWhite: 0.4,
  /** fumo dalla canna */
  maxSmoke: 18,
  smokeLifeMs: 900,
  smokeRise: 0.32,
  smokeDrift: 0.12,
  /** pausa dopo l'ultimo colpo prima che esca il fumo */
  smokeDelayMs: 160,
  smokeEveryMs: 110,
  /** puff dopo un colpo singolo / dopo una raffica (in più se la canna è calda) */
  smokePuffsSingle: 3,
  smokePuffsBurst: 5,
  smokePuffsHot: 4,
  /** caricatore che cade durante la ricarica */
  magGravity: 0.25,
  magDropVx: -0.7,
  /** abbassamento dell'arma nei 4 frame di ricarica */
  reloadDip: [2, 5, 3, 1],
  /** canna che si scalda (mitra): calore per colpo, raffreddamento al secondo, soglie */
  heatPerShot: 0.07,
  coolPerSec: 0.32,
  heatWarm: 0.45,
  heatHot: 0.8,
  /** mitra: offset x casuale del rinculo (px) e ondeggio del recoil pattern */
  mitraKickJitterX: 1,
  mitraWander: 2.5,
  /** la raffica si "azzera" dopo tanto senza sparare */
  burstResetMs: 260,
  /** profondità: sopra Tony (10..16), sotto particelle (50) e HUD (scena UI) */
  depth: 30,
  haloDepth: 29,
  tracerDepth: 29.5,
  magDepth: 30.5,
  shellDepth: 31,
  flashDepth: 32,
  smokeDepth: 33,
} as const;

// ---- ARMI NUOVE: elementali ----
/** Costanti di effetti e fisica di lanciafiamme, fulmine, ghiaccio e tornado. */
export const ELEMENTAL = {
  /** gravità di Matter in px/step² (gravityY 1 * scala 0.001 * step²) */
  gravityPerStep: 0.278,
  // ---- lanciafiamme
  /** punto di partenza del getto (sotto lo schermo); x segue un po' il dito */
  flameOriginY: 300,
  flameOriginFollow: 0.35,
  /** una fiammella ogni N ms mentre si spara, velocità (px/step) e dispersione (rad) */
  flameSpawnMs: 7,
  flameSpeed: 6.5,
  flameJitter: 0.2,
  /** fiammelle + fumo vivi al massimo (sotto FX.maxPooledImages: il pool le ricicla tutte) */
  maxFlames: 88,
  /** spinta verso l'alto delle fiamme (px/step², negativa = salgono) e attrito */
  flameBuoyancy: -0.05,
  flameDrag: 0.97,
  /** vita extra oltre il dito e vita del fumo (ms) */
  flameOvershootMs: 160,
  smokeMs: 420,
  /** fiammelle attaccate alle parti che bruciano */
  burnFrameMs: 70,
  burnSmokeEveryMs: 160,
  maxBurning: 6,
  /** annerimento: dura burnMs + charExtraMs */
  charExtraMs: 1200,
  /** fruscio del getto: un pezzo di rumore ogni N ms */
  flameSoundMs: 90,
  // ---- fulmine
  /** ritardo nuvola → saetta, durata della nuvola */
  boltDelayMs: 70,
  cloudMs: 460,
  /** la nuvola sta così sopra il punto (px) */
  cloudLift: 46,
  /** durata di un frame della saetta e frame totali */
  boltFrameMs: 45,
  boltFrames: 3,
  /** zig-zag: lunghezza dei segmenti e scarto laterale massimo (px) */
  boltSegment: 7,
  boltAmp: 4,
  /** ritardo tra un salto della catena e il successivo */
  chainDelayMs: 40,
  /** scheletro visibile e tremolio (ms) */
  skeletonMs: 170,
  skeletonBlinkMs: 45,
  /** lampo a schermo (alpha del primo e del secondo frame) */
  flashAlpha: 0.22,
  flashAlpha2: 0.1,
  shakePx: 2,
  shakeMs: 160,
  // ---- ghiaccio
  /** punto da cui parte il raggio di ghiaccio */
  beamOriginX: 90,
  beamOriginY: 300,
  beamFrameMs: 40,
  beamFrames: 3,
  /** caduta lenta del blocco se è in aria (px/step², velocità massima) */
  iceGravity: 0.06,
  iceMaxFall: 2.5,
  /** margine del blocco attorno a Tony (px), crepe dopo questa quota della durata */
  iceMargin: 2,
  iceCrackAt: 0.6,
  /** alpha del riempimento del blocco */
  iceAlpha: 0.38,
  maxShards: 18,
  shardCount: 14,
  shardMs: 1100,
  shardGravity: 0.22,
  shardBounce: 0.4,
  shakeBigPx: 3,
  // ---- tornado
  tornadoFrameMs: 70,
  debrisCount: 6,
  /** raggio orizzontale/verticale dell'orbita dei detriti (px) */
  debrisRx: 13,
  debrisRy: 4,
  /** margini del centro del vortice da muri, soffitto e pavimento (px) */
  tornadoWallMargin: 26,
  tornadoTopMargin: 40,
  tornadoBottomMargin: 34,
  tornadoSoundMs: 220,
} as const;

// ---- ANIMAZIONI: mischia ----
/**
 * Animazioni di pugno, shuriken e coltello (durate dei frame in ms di gioco:
 * seguono scene.time.timeScale e si fermano durante l'hit-stop).
 */
export const ANIM_MELEE = {
  // ---- pugno (guantone)
  /** frame di carica (piccolo, al bordo dello schermo) */
  punchChargeMs: 26,
  /** frame allungato con le scie */
  punchSmearMs: 22,
  /** primo frame d'impatto (silhouette bianca) */
  punchFlashMs: 24,
  /** impatto schiacciato contro il punto */
  punchImpactMs: 60,
  punchRecoilMs: 40,
  /** uscita: due frame veloci verso il bordo */
  punchExitMs: 24,
  /** tap entro questo tempo dal precedente continuano la combo sinistro/destro */
  comboWindowMs: 520,
  /** ogni N colpi della combo arriva il montante */
  uppercutEvery: 4,
  uppercutDamageMult: 1.5,
  uppercutImpulseMult: 1.45,
  /** quota d'impulso a tutto il corpo nel montante (lancia Tony in alto) */
  uppercutBodyShare: 0.75,
  /** sotto questa distanza (px) dal lato di provenienza il guanto arriva in diagonale dal basso */
  punchSideRoomPx: 38,
  /** bersaglio più in alto di così (y): guanto in diagonale dal basso */
  punchHighY: 175,
  /** stelline che schizzano all'impatto (normale / montante) */
  punchStars: 4,
  uppercutStars: 6,
  /** passo (px per frame) delle stelline */
  starStepPx: 4,
  starFrameMs: 40,
  ringFrameMs: 34,

  // ---- lanci (shuriken + coltello)
  /** mano che scocca: frame di rilascio e di accompagnamento */
  handReleaseMs: 40,
  handFollowMs: 60,
  /** copie sbiadite della scia e ogni quanto si campiona la posizione */
  trailCopies: 3,
  trailEveryMs: 16,
  /** distanza (px) tra una copia della scia e l'altra */
  trailGapPx: 4,
  /** rotazione a scatti dello shuriken: ms per frame (22,5° a frame) */
  shurikenSpinMs: 28,
  /** rotazione del coltello in volo (rad/step, mostrata a 8 direzioni) */
  knifeSpinPerStep: 0.42,
  /** di quanto la punta del coltello sta davanti al centro (px) per il contatto */
  knifeTipReach: 4,
  /** frame della vibrazione quando si conficca */
  vibFrameMs: 38,
  /** luccichio mentre è conficcato: intervallo casuale [min, max] */
  glintMinMs: 700,
  glintMaxMs: 1600,
  glintFrameMs: 50,
  sparkFrameMs: 35,
  /** rimbalzo sul pavimento dopo il distacco */
  floorBounce: 0.45,
  floorBounceMinVy: 2.2,
  /** ventaglio di shuriken: tap entro questo tempo e distanza dal precedente */
  fanWindowMs: 330,
  fanRadiusPx: 22,
  /** stelle al massimo in un ventaglio e apertura (rad) tra una e l'altra */
  fanMax: 3,
  fanSpread: 0.16,
  /** danno delle stelle laterali del ventaglio (frazione) */
  fanSideDamage: 0.5,
} as const;

// ---- ANIMAZIONI: esplosivi ----
/**
 * Esplosione riusabile (weapons/explosionFx.ts: bigExplosion). Durate in ms
 * del clock dell'effetto (si ferma durante l'hit-stop, segue time.timeScale).
 */
export const EXPLOSION_FX = {
  /** durata di ciascun frame della palla di fuoco (bianco→giallo→arancio→rosso→fumo) */
  fireballFrameMs: [45, 55, 65, 75, 95, 120],
  /** raggio relativo di ogni frame rispetto a size */
  fireballScale: [0.7, 0.95, 1.05, 1.1, 1.12, 1.18],
  /** salita della palla di fuoco a ogni frame (px per 10 px di size) */
  fireballRise: [0, 0, 1, 2, 3.5, 5.5],
  /** onda d'urto: raggio relativo e durata dei 4 frame dell'anello */
  ringScale: [0.95, 1.55, 2.15, 2.7],
  ringFrameMs: [40, 45, 55, 70],
  /** flash bianco a tutto schermo (1 frame) e tint arancio dello sfondo (frame) */
  flashAlpha: 0.75,
  tintAlpha: 0.32,
  tintFrames: 2,
  /** schegge che rimbalzano (per size 10) e tetto globale */
  debrisPer10: 5,
  maxDebris: 48,
  debrisSpeed: 4.2,
  debrisGravity: 0.2,
  debrisBounce: 0.45,
  debrisLifeMs: [1400, 2600],
  /** dopo quanto un pezzo incandescente diventa scuro */
  debrisCoolMs: 380,
  /** ms per scatto di 90 gradi a velocità 1 px/step */
  debrisSpinMs: 160,
  /** scintille veloci (particelle 1x1/2x2) per size 10 */
  sparksPer10: 9,
  sparkSpeed: 5,
  /** colonna di fumo: sbuffi per size 10, tetto, emissione, durata, salita */
  smokePer10: 7,
  maxSmoke: 48,
  smokeSpawnMs: 520,
  smokeLifeMs: [1700, 2800],
  smokeRiseSpeed: 0.7,
  smokeSpread: 0.3,
  /** segno di bruciatura: se l'esplosione è entro size*k dal pavimento */
  scorchNearFloor: 1.1,
  scorchMs: 4200,
  maxScorch: 4,
  /** terra che schizza dal pavimento (particelle per size 10) */
  dirtPer10: 7,
  /** spinta agli effetti leggeri già a terra (schegge, fumo) entro size*k */
  jiggleRange: 4,
  jiggleKick: 2.6,
} as const;

/** Mira e volo di granata/dinamite (mano, spoletta, fiammifero, scia, beep). */
export const EXPLOSIVE_ANIM = {
  /** guanto: tremolio a fionda tesa (oltre questa quota di maxPull) */
  tenseShare: 0.85,
  tenseJitterMs: 50,
  /** lancio: frame della mano che si apre e accompagna il tiro */
  throwFrameMs: 45,
  throwFrames: 3,
  /** spoletta che vola via */
  pinVx: 1.4,
  pinVy: -3.2,
  /** fiammifero: sfregamento → fiamma → miccia accesa (ms) */
  matchStrikeMs: 90,
  matchFlameMs: 170,
  /** traiettoria: puntini gialli per la prima quota (poi arancio), cerchio tratteggiato */
  trajBigShare: 0.4,
  ringDash: 3,
  ringMarchMs: 80,
  /** scia in volo (un puntino ogni N ms) */
  trailEveryMs: 34,
  trailLifeMs: 200,
  /** granata: ultimi istanti con flash bianco pieno a ogni lampeggio */
  blinkWhiteShare: 0.8,
  beepFrom: 1300,
  beepTo: 2600,
  /** dinamite: sfrigolio della miccia */
  sizzleEveryMs: 85,
} as const;

// ---- ARMI NUOVE: fantascienza ----

/**
 * Costanti comuni delle armi di fantascienza (minigun, pistola a raggi,
 * cannone al plasma, pistola gravità): viewmodel a schermo, pool, effetti.
 */
export const SCIFI = {
  /** viewmodel: base (y del fondo, sopra la fascia HUD), rinculo massimo, depth */
  viewBaseY: 296,
  viewKickMaxPx: 2,
  /** ms per recuperare 1px di rinculo */
  viewKickRecoverMs: 40,
  viewDepth: 30,
  /** x della base a riposo (arma a destra, non copre Tony al centro), quanto segue il dito, limiti */
  viewX: 128,
  viewFollow: 0.3,
  viewMinX: 104,
  viewMaxX: 154,
  /** inclinazione a scatti verso il dito: livelli per lato, gradi per livello, px in cima per livello */
  viewLeans: 3,
  viewLeanStepDeg: 14,
  viewLeanPx: 2,
  /** punto mirato a riposo */
  idleAimX: 70,
  idleAimY: 170,

  // minigun
  minigunBarrelMinMs: 120,
  minigunBarrelMaxMs: 22,
  minigunWhirMs: 55,
  maxTracers: 16,
  tracerMs: 70,
  tracerLen: 14,
  maxShells: 36,
  shellEvery: 2,
  shellGravity: 0.25,
  shellBounce: 0.4,
  shellRestMs: 900,
  shellBlinkMs: 400,
  shellDepth: 31,
  shellFloorDepth: 17,

  // pistola a raggi
  rayMaxLive: 6,
  rayFrameMs: 50,
  rayHitTolerance: 2,
  rayMaxFlightMs: 1500,
  rayGlowMs: 120,

  // plasma
  plasmaMaxLive: 2,
  plasmaFrameMs: 60,
  maxBolts: 8,
  boltMs: 90,
  plasmaFlashFrames: 2,
  plasmaWaveMs: 320,
  plasmaWaveRadius: 64,
  plasmaHitStopMs: 60,
  plasmaShakePx: 5,
  plasmaShakeMs: 420,
  plasmaMaxFlightMs: 4000,

  // pistola gravità
  gravGrabId: 9000,
  gravPullRampMs: 300,
  gravOrbiters: 8,
  gravOrbitRadius: 9,
  gravHumMs: 90,
  /** sopra questa velocità del dito (px/step) lo sparo segue il gesto invece della mira */
  gravFlickSpeed: 4,
  /** distanza dalla parete entro cui una frenata brusca conta come schianto; pausa per parte */
  gravSlamWallPx: 12,
  gravSlamCooldownMs: 150,
} as const;

// ---- ARMI NUOVE: fucili iconici ----
/**
 * Costanti comuni di doppietta, fucile d'assalto, cecchino e RPG
 * (viewmodel in basso, traccianti, bossoli, fumo, mirino, razzo).
 */
export const RIFLES = {
  // --- viewmodel: arma impugnata disegnata in basso (stile FPS rétro)
  /** x della base dell'arma a riposo; la base si mette di lato al bersaglio */
  viewHomeX: 120,
  /** distanza in x tra bersaglio e base dell'arma, isteresi del cambio lato, inseguimento */
  viewSideOffset: 34,
  viewSideHysteresis: 22,
  viewSlideLerp: 0.12,
  viewMinX: 26,
  viewMaxX: 154,
  /** y della base (sopra la fascia HUD) e profondità */
  viewBaseY: 298,
  viewDepth: 30,
  /** inclinazione massima (px in cima) e passo tra due pose: 9 pose */
  viewMaxShear: 8,
  viewShearStep: 2,
  /** inseguimento della mira (quota per step) */
  viewAimLerp: 0.35,
  /** recupero del rinculo (px/step) */
  viewRecoverPx: 0.7,
  /** respiro a riposo: ampiezza (px) e periodo (ms) */
  viewBobPx: 1,
  viewBobMs: 1100,
  // --- traccianti
  tracerMs: 70,
  maxTracers: 24,
  tracerDepth: 29,
  // --- detriti: bossoli, cartucce, caricatori
  maxDebris: 20,
  debrisGravity: 0.24,
  debrisBounce: 0.4,
  debrisFriction: 0.6,
  debrisStopSpeed: 0.8,
  debrisSpinMs: 55,
  debrisRestMs: 1800,
  debrisBlinkMs: 600,
  debrisBlinkStepMs: 90,
  debrisDepth: 29,
  // --- fumo (canna, scia del razzo, esplosione)
  maxPuffs: 64,
  puffMs: 650,
  puffRise: 0.22,
  puffDepth: 28,
  /** passo del controllo lungo il raggio dei pallini (px) */
  rayStepPx: 2,
  // --- cecchino
  scopeRadius: 46,
  scopeDepth: 45,
  /** velocità dell'ondeggiamento (rad/ms) sui due assi */
  swayFreqX: 0.0023,
  swayFreqY: 0.0037,
  skullMs: 750,
  skullRise: 22,
  maxSkulls: 4,
  // --- razzo dell'RPG
  rocketWobblePx: 1.2,
  rocketWobbleMs: 110,
  /** leggero arco: gravità del razzo (px/step²) */
  rocketGravity: 0.03,
  rocketHitTolerance: 2,
  rocketMaxFlightMs: 1600,
  /** uno sbuffo di scia ogni N step di volo */
  rocketTrailEvery: 1,
  maxRockets: 3,
  rocketDepth: 32,
  rocketMinDamageShare: 0.25,
  rocketHitStopMs: 50,
  rocketShakeMs: 380,
} as const;

/**
 * Minigioco SPRITZ (mondi 2 e 3): in cima alla talpa si spruzza calcestruzzo
 * sulla parete di roccia della galleria. Coordinate a schermo (180x320).
 */
export const SPRITZ = {
  // --- parete: griglia di copertura e geometria della vista
  /** lato di una cella della griglia di copertura (px) */
  cell: 4,
  /** prima riga di parete spruzzabile (sopra c'è la barra in alto) */
  wallTop: 26,
  /** inizio del ponte della talpa (sotto non si spruzza) */
  deckY: 242,
  /** punto di fuga della galleria */
  vpX: 90,
  vpY: 150,
  /** raggio del tratto già rivestito in fondo (non spruzzabile) */
  innerR: 42,
  /** carreggiata: cuneo dal punto di fuga, mezza larghezza = (y - vpY) * floorSlope */
  floorSlope: 0.913,
  /** profondità a schermo: v = depthK / raggio (roccia, centine e rete in prospettiva) */
  depthK: 4000,
  /** zone che si completano con il "pop": settori angolari x anelli (raggi di separazione dal punto
   *  di fuga). 8 x 3 = 24 caselle, 22 piene (33..137 celle): un "pop" ogni pochi secondi */
  regionSectors: 8,
  regionRings: [72, 100] as readonly number[],
  /** una zona coperta a questa frazione si completa da sola (niente caccia all'ultimo pixel) */
  regionAutoFill: 0.85,
  /** blocchi di roccia sporgente che vogliono più cemento */
  chunks: 6,
  /** distanza minima dal punto di fuga e tra due blocchi (px) */
  chunkMinR: 70,
  chunkGap: 26,
  // --- strati di cemento per cella
  /** cemento per coprire una cella normale / una cella di un blocco sporgente */
  layersToCover: 2,
  chunkLayers: 4,
  /** da qui in su la cella mostra lo strato sottile */
  thinAt: 0.6,
  /** cemento aggiunto da una goccia al centro e al bordo della macchia */
  dropPaintCenter: 0.75,
  dropPaintEdge: 0.35,
  /** raggio della macchia di una goccia (px): splatRadius + random(0..splatRadiusVar) */
  splatRadius: 5,
  splatRadiusVar: 3,
  // --- lancia e getto
  /** il bersaglio sta sopra il dito, così il getto si vede */
  aimOffsetY: -28,
  /** inseguimento della lancia verso il bersaglio (frazione per frame a 60 fps) */
  aimFollow: 0.35,
  /** lunghezza dello sprite della lancia (righe), scala (è vicina all'occhio) e base (sotto lo schermo, segue il bersaglio di baseFollow) */
  lanceLen: 46,
  lanceScale: 2,
  lanceBaseY: 340,
  baseFollow: 0.35,
  /** gocce al secondo e velocità di volo (px/ms) */
  dropsPerSec: 50,
  dropSpeed: 0.34,
  /** dispersione del getto attorno al bersaglio (px) e arco del volo (frazione della distanza) */
  dropJitter: 7,
  dropArc: 0.08,
  maxDrops: 64,
  /** una macchia "splat" animata ogni N gocce, polvere ogni M */
  splatEvery: 3,
  dustEvery: 7,
  splatFrameMs: 45,
  // --- colature
  dripChance: 0.06,
  maxDrips: 16,
  /** la colatura scende di 1px ogni dripStepMs per dripMinPx..dripMaxPx, poi resta dripHoldMs */
  dripStepMs: 90,
  dripMinPx: 4,
  dripMaxPx: 11,
  dripHoldMs: 700,
  // --- pressione della pompa
  /** consumo e ricarica al secondo (1 = serbatoio pieno): ~17 s di getto continuo, piena in ~1 s */
  pressureDrainPerSec: 0.06,
  pressureRechargePerSec: 1.1,
  /** la ricarica parte dopo questo tempo dal rilascio */
  rechargeDelayMs: 150,
  /** a secco: si riparte quando la pressione torna qui (~0.5 s) */
  lockoutResume: 0.5,
  /** sotto questa pressione il getto "tossisce" (gocce saltate) */
  sputterBelow: 0.1,
  // --- suoni
  hissEveryMs: 110,
  // --- salvataggio dell'avanzamento
  /** 'spritz:progress' al massimo ogni saveEveryMs (e sempre all'uscita) */
  saveEveryMs: 3000,
  // --- premio al 100%
  /** monete = (rewardBase + rewardPerCompleted * min(completati, rewardMaxCompleted)) * worldRewardMult[mondo - 1] */
  rewardBase: 600,
  rewardPerCompleted: 250,
  rewardMaxCompleted: 12,
  worldRewardMult: [1, 1, 1.5] as readonly number[],
  /** XP premio = questa frazione dell'XP che serve per il livello corrente (solo se il premio è > 0) */
  xpLevelFraction: 0.5,
  /** bonus tempo: monete per ogni secondo rimasto sul timer al 100% */
  timeBonusPerSec: 4,
  // --- timer
  /** tempo per finire la parete e prendere il premio (ogni ingresso riparte da qui) */
  timerMs: 120000,
  /** ultimi secondi: timer rosso che pulsa e ticchetta */
  timerWarnMs: 15000,
  /** ultimissimi secondi: tic più acuto e doppio */
  timerPanicMs: 5000,
  /** scritta "TEMPO SCADUTO!" a schermo */
  timeoutBannerMs: 2200,
  // --- transizioni e festa
  /** tendine nere a scatti (ingresso e uscita) */
  wipeSteps: 5,
  wipeStepMs: 40,
  /** "salita" sulla talpa: zoom a scatti verso 1, un livello ogni climbStepMs */
  climbZoom: [1.6, 1.4, 1.25, 1.12, 1] as readonly number[],
  climbStepMs: 75,
  /** festa al 100%: ritorno automatico dopo celebrateMs (un tocco la salta dopo celebrateMinMs) */
  celebrateMs: 4200,
  celebrateMinMs: 1200,
  celebrateCoins: 26,
  coinFlyMs: 520,
  coinStepMs: 40,
  coinStaggerMs: 45,
  /** scritta fumetto quando una zona si completa */
  regionPopMs: 750,
  // --- juice: zone, combo, traguardi
  /** parole a caso sulle zone completate (con combo alte si pesca dalle ultime) */
  regionWords: ['OK!', 'BENE!', 'GRANDE!', 'SUPER!', 'WOW!', 'PERFETTO!', 'MITICO!', 'SPLAK!'] as readonly string[],
  /** zone completate entro comboWindowMs l'una dall'altra fanno COMBO */
  comboWindowMs: 3500,
  /** tetto della combo per suoni/effetti (il numero mostrato continua a salire) */
  comboMax: 8,
  /** accordo della zona: nota base (Hz) che sale di comboSemitones semitoni per ogni gradino di combo */
  chimeBaseHz: 523,
  comboSemitones: 2,
  /** monetine che volano dalla zona al riquadro premio (+ una ogni 2 di combo) */
  regionCoins: 3,
  /** particelle del "pop" della zona: base + perCombo per gradino */
  regionParticles: 10,
  regionParticlesPerCombo: 3,
  /** scritte volanti (parole, "+1%"): pool fisso */
  maxFloatTexts: 12,
  /** "+1%" vicino al getto a ogni punto percentuale */
  pctFloatMs: 650,
  /** striscione dei traguardi ogni milestoneStep % (50 e 90 speciali) */
  milestoneStep: 10,
  milestoneMs: 1300,
  /** barra e percentuale che si illuminano quando crescono */
  barGlowMs: 260,
  /** macchie di cemento: scala 2 con questa probabilità (getto più "grasso") */
  splatBigChance: 0.3,
  // --- festa finale
  /** fuochi d'artificio di cemento e coriandoli: uno ogni fireworkEveryMs, per fireworks volte */
  fireworks: 12,
  fireworkEveryMs: 170,
} as const;
