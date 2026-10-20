import Phaser from 'phaser';
import { noise, tone } from '../audio/sfx';
import { CRASH, SCREEN } from '../config/balance';
import { C, col } from '../config/palette';
import { acquireImage, popFrames, releaseImage, shake, spawnParticles } from '../gfx/effects';
import { pixelText, setPixelText } from '../gfx/pixelFont';
import { makeSprite, type SpriteData } from '../gfx/pixelSprite';
import { economy } from '../systems/economy';
import { Subscriptions } from '../systems/events';
import { getCombo, getLevel } from '../systems/progression';

/**
 * Cantiere: l'albero al centro (sempre visibile) e l'incidente.
 *
 * Ogni tanto, dopo una cosa importante (combo x5, colpo da 60+, level up
 * multiplo di 3, a volte combo x3), un'utilitaria blu entra lungo la strada,
 * accelera, sbanda e si schianta contro l'albero: lampo, scossone, vetri,
 * foglie, fumo dal cofano, frecce e clacson incantato; poi lampeggia e
 * sparisce. Dà monete bonus (CRASH in balance.ts).
 *
 * Tutto si muove a scatti di pixel interi, a "frame" da CRASH.frameMs.
 * Il tempo segue scene.time.timeScale (utile per rallentare e debuggare).
 *
 * Uso: bindCarCrash(scene) in Game.create(), dopo buildRoom.
 * Debug da console: window.carCrash.trigger() (o triggerCarCrash(scene)).
 */

// ---------------------------------------------------------------- layout (contratto con lo sfondo)

/** strada di sabbia orizzontale y 168..186, centro corsia ~177 */
const LANE_Y = 177;
/** albero: tronco alla base x≈90, chioma da y≈115, ingombro x 70..110 */
const TREE_CX_WORLD = 90;
const TREE_TOP = 115;
const TREE_W = 45; // 41 px di albero + 2 px per lato per l'oscillazione
const TREE_H = 53; // y 115..167: la base poggia sul bordo della strada (168)
const TREE_CX = 22; // centro del tronco nello sprite

const DEPTH_SKID = 2.4;
const DEPTH_TREE = 2.5;
const DEPTH_LEAVES = 2.7;
const DEPTH_CAR = 3;
const DEPTH_SMOKE = 3.2;
const DEPTH_DEBRIS = 4;
const DEPTH_TEXT = 45;

/** coordinate "locali": l'auto arriva sempre da sinistra, da destra si specchia */
const START_X = -16;
const SKID_X = 47;
/** sbandata: un passo per frame (x, y del centro, inclinazione in gradi) */
const SKID: readonly [number, number, number][] = [
  [51, 176, -8],
  [55, 174, -16],
  [60, 172, -22],
  [64, 170, -14],
  [68, 168, -8],
  [73, 167, -6],
];
/** muso accartocciato contro il tronco */
const IMPACT: readonly [number, number, number] = [78, 166, -6];
/** dopo il rimbalzo */
const REST: readonly [number, number, number][] = [
  [76, 166, -2],
  [76, 166, -4],
];

/** punti dello sprite dell'auto (offset dal centro, auto rivolta a destra) */
const WHEEL_BACK: readonly [number, number] = [-8, 6];
const WHEEL_FRONT: readonly [number, number] = [6, 6];
const HOOD: readonly [number, number] = [8, -3];
const NOSE: readonly [number, number] = [11, 0];

// ---------------------------------------------------------------- sprite: auto

/* Utilitaria anni '90, 26x13, rivolta a destra: coda tronca (hatchback),
   tetto lungo, cofano corto. Carrozzeria 9/a/8, vetri b/a, ruote 0/f/e,
   fanali 4/c, stop 2. Nessun marchio. */
const BODY: readonly string[] = [
  '.....000000000000.........',
  '....09aaaaaaaaaa90........',
  '...09bbbbb0bbbbbb990......',
  '..09bbbbab0bbbbabbb90.....',
  '.09bbbbaab0bbbaabbbb9900..',
  '0999999999999999999aaaa90.',
  '02aaaaaaaaa0aaaaaaaa9999c0',
  '02999999999099999999999940',
  '08999999999099999999999990',
];
/* stessa auto col muso accartocciato e il parabrezza incrinato */
const BODY_CRASHED: readonly string[] = [
  '.....000000000000.........',
  '....09aaaaaaaaaa90........',
  '...09bbbbb0bbbbbc990......',
  '..09bbbbab0bbbcbcbb90.0...',
  '.09bbbbaab0bbcbaabbb9090..',
  '0999999999999999999a8a90..',
  '02aaaaaaaaa0aaaaaaaa98900.',
  '029999999990999999999890..',
  '089999999990999999999880..',
];

function carRows(wheel: 0 | 1, crashed: boolean, hazard: boolean): SpriteData {
  const w10 = wheel ? 'fefef' : 'ffeff';
  const w11 = wheel ? 'ffeff' : 'fefef';
  const rows = [
    ...(crashed ? BODY_CRASHED : BODY),
    '088' + '0fff0' + '888888888' + '0fff0' + (crashed ? '080.' : '8880'),
    '.00' + w10 + '000000000' + w10 + (crashed ? '00..' : '000.'),
    '...' + w11 + '.........' + w11 + '....',
    '...' + '.000.' + '.........' + '.000.' + '....',
  ];
  if (hazard) {
    // frecce lampeggianti: dietro (al posto dello stop) e sul muso
    rows[6] = '04' + rows[6].slice(2);
    rows[6] = rows[6].slice(0, 21) + '4' + rows[6].slice(22);
  }
  return rows;
}

// ---------------------------------------------------------------- sprite: albero

/** ciuffi della chioma (cx, cy, raggio), dal più lontano al più vicino */
const BLOBS: readonly [number, number, number][] = [
  [22, 14, 13],
  [16, 8, 7],
  [29, 9, 7],
  [12, 20, 9],
  [32, 20, 9],
  [22, 25, 8],
];
const CANOPY_BOTTOM = 34;
const TRUNK_TOP = 26;

function inBlob(b: readonly [number, number, number], x: number, y: number): boolean {
  const dx = x - b[0];
  const dy = y - b[1];
  return dx * dx + dy * dy <= b[2] * b[2] + b[2];
}

function inCanopy(x: number, y: number): boolean {
  return BLOBS.some((b) => inBlob(b, x, y));
}

function hash(x: number, y: number): number {
  let h = Math.imul(x + 101, 73856093) ^ Math.imul(y + 37, 19349663);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** colore di una foglia: luce in alto a sinistra (5), ombra in basso a destra (7) */
function leafColor(x: number, y: number): string {
  if (!inCanopy(x + 2, y + 2) || !inCanopy(x + 1, y + 3)) return '7';
  if (!inCanopy(x - 2, y - 2) || !inCanopy(x - 1, y - 3)) return '5';
  let top = BLOBS[0];
  for (const b of BLOBS) if (inBlob(b, x, y)) top = b;
  // bordo inferiore di un ciuffo davanti a un altro
  if (!inBlob(top, x + 1, y + 1)) return '7';
  const hx = x - (top[0] - top[2] * 0.35);
  const hy = y - (top[1] - top[2] * 0.35);
  if (hx * hx + hy * hy < (top[2] * 0.45) ** 2 && (x + y) % 2 === 0) return '5';
  const n = hash(x, y) % 13;
  return n === 0 ? '7' : n === 1 ? '5' : '6';
}

/** albero con la chioma inclinata di `shear` px in cima (-2..2), tronco fermo */
function treeRows(shear: number): SpriteData {
  const g: string[][] = Array.from({ length: TREE_H }, () => Array<string>(TREE_W).fill('.'));
  // tronco 1/2/0, con le radici che si allargano alla base
  for (let y = TRUNK_TOP; y < TREE_H; y++) {
    const flare = Math.max(0, y - (TREE_H - 3));
    const l = TREE_CX - 3 - flare;
    const r = TREE_CX + 3 + flare;
    for (let x = l; x <= r; x++) {
      let ch = '1';
      if (x === l || x === r) ch = '0';
      else if (x === TREE_CX - 1 || (x === TREE_CX - 2 && y % 3 === 0)) ch = '2';
      g[y][x] = ch;
    }
  }
  g[41][TREE_CX + 1] = '0'; // nodo
  g[42][TREE_CX + 1] = '0';
  g[46][TREE_CX - 1] = '1';

  const shift = (y: number) => (y >= CANOPY_BOTTOM ? 0 : Math.round((shear * (CANOPY_BOTTOM - y)) / CANOPY_BOTTOM));
  const canopy = (x: number, y: number) => y >= 0 && y < TREE_H && inCanopy(x - shift(y), y);
  for (let y = 0; y < TREE_H; y++) {
    for (let x = 0; x < TREE_W; x++) {
      if (canopy(x, y)) {
        g[y][x] = leafColor(x - shift(y), y);
        continue;
      }
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) {
        for (let dx = -1; dx <= 1 && !near; dx++) if (canopy(x + dx, y + dy)) near = true;
      }
      if (near) g[y][x] = '0';
    }
  }
  return g.map((r) => r.join(''));
}

// ---------------------------------------------------------------- sprite: effetti

const SMOKE: Record<string, SpriteData> = {
  'cc-smoke-a': ['.e.', 'ede', '.e.'],
  'cc-smoke-b': ['.eee.', 'eddde', 'eddde', 'edde.', '.ee..'],
  'cc-smoke-c': ['.f.f.', 'f.e.f', '.e.e.', 'f.f..', '.....'],
};
const SMOKE_KEYS = ['cc-smoke-a', 'cc-smoke-b', 'cc-smoke-c'] as const;

const BURST: Record<string, SpriteData> = {
  'cc-burst-a': [
    '....c....',
    '.c..c..c.',
    '..c.c.c..',
    '...ccc...',
    'ccccccccc',
    '...ccc...',
    '..c.c.c..',
    '.c..c..c.',
    '....c....',
  ],
  'cc-burst-b': [
    '.........',
    '....4....',
    '..4.c.4..',
    '...ccc...',
    '.4ccccc4.',
    '...ccc...',
    '..4.c.4..',
    '....4....',
    '.........',
  ],
  'cc-burst-c': [
    '.........',
    '.........',
    '....4....',
    '...4.4...',
    '..4...4..',
    '...4.4...',
    '....4....',
    '.........',
    '.........',
  ],
};
const BURST_KEYS = ['cc-burst-a', 'cc-burst-b', 'cc-burst-c'] as const;

const TREE_SHEARS = [-2, -1, 0, 1, 2] as const;
const treeKey = (s: number) => `cc-tree-${s + 2}`;
const CAR_KEYS = {
  a: 'cc-car-a',
  b: 'cc-car-b',
  crashed: 'cc-car-crashed',
  hazard: 'cc-car-hazard',
} as const;

function ensureTextures(scene: Phaser.Scene): void {
  makeSprite(scene, CAR_KEYS.a, carRows(0, false, false));
  makeSprite(scene, CAR_KEYS.b, carRows(1, false, false));
  makeSprite(scene, CAR_KEYS.crashed, carRows(0, true, false));
  makeSprite(scene, CAR_KEYS.hazard, carRows(0, true, true));
  for (const s of TREE_SHEARS) makeSprite(scene, treeKey(s), treeRows(s));
  for (const [k, rows] of Object.entries(SMOKE)) makeSprite(scene, k, rows);
  for (const [k, rows] of Object.entries(BURST)) makeSprite(scene, k, rows);
  makeSprite(scene, 'cc-skid', ['ff']);
}

// ---------------------------------------------------------------- suoni (chiptune)

function sndEngine(speed: number): void {
  const f = 55 + speed * 24;
  tone({ type: 'square', from: f, to: f * 1.35, dur: 0.06, vol: 0.06 });
}

function sndSkid(): void {
  noise({ dur: 0.42, vol: 0.18, freq: 3500, freqTo: 6000, highpass: true });
  tone({ type: 'square', from: 1250, to: 1020, dur: 0.38, vol: 0.035 });
}

function sndCrash(): void {
  noise({ dur: 0.55, vol: 0.55, freq: 2500, freqTo: 90 });
  tone({ type: 'triangle', from: 120, to: 35, dur: 0.4, vol: 0.45 });
  tone({ type: 'square', from: 70, to: 30, dur: 0.3, vol: 0.2 });
  // vetri
  noise({ dur: 0.3, vol: 0.2, freq: 5000, freqTo: 8000, highpass: true, delay: 0.04 });
  [2637, 3136, 2349, 2794].forEach((f, i) => tone({ type: 'square', from: f, dur: 0.04, vol: 0.05, delay: 0.08 + i * 0.06 }));
  // fruscio di foglie
  noise({ dur: 0.35, vol: 0.07, freq: 1500, freqTo: 4000, highpass: true, delay: 0.12 });
  // monete
  tone({ type: 'square', from: 988, dur: 0.06, vol: 0.1, delay: 0.35 });
  tone({ type: 'square', from: 1319, dur: 0.14, vol: 0.1, delay: 0.41 });
}

/** clacson incantato: "bip" a due toni, l'ultimo lungo */
function sndHorn(long: boolean): void {
  const dur = long ? 0.45 : 0.12;
  tone({ type: 'square', from: 392, dur, vol: 0.06 });
  tone({ type: 'square', from: 494, dur, vol: 0.05 });
}

function sndVanish(): void {
  tone({ type: 'square', from: 600, to: 200, dur: 0.1, vol: 0.06 });
}

// ---------------------------------------------------------------- incidente

type Phase = 'idle' | 'wait' | 'enter' | 'skid' | 'smoke' | 'leave';

interface Puff {
  img: Phaser.GameObjects.Image;
  age: number;
  x: number;
  y: number;
  seed: number;
}

const instances = new Map<Phaser.Scene, CarCrash>();

export class CarCrash {
  private readonly tree: Phaser.GameObjects.Image;
  private readonly car: Phaser.GameObjects.Image;
  private readonly sbam: Phaser.GameObjects.BitmapText;
  private readonly sbamAlt: Phaser.GameObjects.BitmapText;
  private readonly coinsText: Phaser.GameObjects.BitmapText;
  private readonly subs = new Subscriptions();

  private phase: Phase = 'idle';
  private acc = 0;
  /** ms dall'inizio della fase (in multipli di frameMs) */
  private phaseMs = 0;
  private step = 0;
  private waitMs = 0;
  private dir: 1 | -1 = 1;
  private fx = 0;
  private speed = 0;
  private wheel: 0 | 1 = 0;
  private lastStart = -Infinity;

  private skids: Phaser.GameObjects.Image[] = [];
  private puffs: Puff[] = [];
  private treeSeq: number[] = [];
  private textMs = -1;
  private horns = 0;

  // catena di combo corrente
  private comboHits = 0;
  private comboSmall = false;
  private comboBig = false;

  constructor(private readonly scene: Phaser.Scene) {
    ensureTextures(scene);
    this.tree = scene.add
      .image(TREE_CX_WORLD - TREE_CX, TREE_TOP, treeKey(0))
      .setOrigin(0)
      .setDepth(DEPTH_TREE);
    this.car = scene.add.image(0, 0, CAR_KEYS.a).setDepth(DEPTH_CAR).setVisible(false);
    const cx = Math.round(SCREEN.width / 2);
    this.sbam = pixelText(scene, cx, 88, 'SBAM!', C.orange).setOrigin(0.5).setScale(2).setDepth(DEPTH_TEXT);
    this.sbamAlt = pixelText(scene, cx, 88, 'SBAM!', C.yellow).setOrigin(0.5).setScale(2).setDepth(DEPTH_TEXT);
    this.coinsText = pixelText(scene, cx, 100, '+0', C.yellow).setOrigin(0.5, 0).setDepth(DEPTH_TEXT);
    this.hideTexts();

    this.subs.on('damage', (e) => {
      // progression ascolta 'damage' da Boot, quindi la combo è già aggiornata
      const c = getCombo();
      if (c.hits <= 1 || c.hits < this.comboHits) {
        this.comboSmall = false;
        this.comboBig = false;
      }
      this.comboHits = c.hits;
      if (e.amount >= CRASH.bigHitDamage) this.tryTrigger();
      if (c.mult >= CRASH.comboMult && !this.comboBig) {
        this.comboBig = true;
        this.comboSmall = true;
        this.tryTrigger();
      } else if (c.mult >= CRASH.smallComboMult && !this.comboSmall) {
        this.comboSmall = true;
        if (Math.random() < CRASH.smallComboChance) this.tryTrigger();
      }
    });
    this.subs.on('level:up', (e) => {
      if (e.level % CRASH.levelEvery === 0) this.tryTrigger(CRASH.levelUpDelayMs);
    });

    scene.events.on(Phaser.Scenes.Events.UPDATE, this.update, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
  }

  get busy(): boolean {
    return this.phase !== 'idle';
  }

  get currentPhase(): Phase {
    return this.phase;
  }

  /** Avvia l'incidente se libero e fuori cooldown (force: ignora il cooldown). */
  tryTrigger(delayMs = 0, force = false, fromRight?: boolean): boolean {
    if (this.phase !== 'idle') return false;
    const now = this.scene.time.now;
    if (!force && now - this.lastStart < CRASH.cooldownMs) return false;
    this.lastStart = now;
    this.dir = fromRight === undefined ? (Math.random() < 0.5 ? 1 : -1) : fromRight ? -1 : 1;
    if (delayMs > 0) {
      this.phase = 'wait';
      this.waitMs = delayMs;
    } else {
      this.begin();
    }
    return true;
  }

  // ---------------------------------------------------------------- ciclo

  private update(_t: number, delta: number): void {
    if (this.phase === 'idle') return;
    const dt = delta * this.scene.time.timeScale;
    if (this.phase === 'wait') {
      this.waitMs -= dt;
      if (this.waitMs <= 0) this.begin();
      return;
    }
    this.acc = Math.min(this.acc + dt, CRASH.frameMs * 4);
    while (this.acc >= CRASH.frameMs && this.busy) {
      this.acc -= CRASH.frameMs;
      this.frame();
    }
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    this.phaseMs = 0;
    this.step = 0;
  }

  private begin(): void {
    this.setPhase('enter');
    this.acc = 0;
    this.fx = START_X;
    this.speed = CRASH.enterSpeed;
    this.horns = 0;
    this.car.setTexture(CAR_KEYS.a).clearTint().setVisible(true);
    this.place(this.fx, LANE_Y, 0);
  }

  /** un "frame" a scatti dell'animazione */
  private frame(): void {
    this.phaseMs += CRASH.frameMs;
    this.step++;
    this.tickTree();
    this.tickPuffs();
    this.tickTexts();

    switch (this.phase) {
      case 'enter': {
        this.speed = Math.min(CRASH.enterMaxSpeed, this.speed + CRASH.enterAccel);
        this.fx = Math.min(SKID_X, this.fx + this.speed);
        this.wheel = this.wheel ? 0 : 1;
        this.car.setTexture(this.wheel ? CAR_KEYS.b : CAR_KEYS.a);
        this.place(this.fx, LANE_Y, 0);
        if (this.step % 2 === 1) sndEngine(this.speed);
        if (this.fx >= SKID_X) this.setPhase('skid');
        break;
      }
      case 'skid': {
        const i = this.step - 1;
        if (i === 0) sndSkid();
        if (i >= SKID.length) {
          this.impact();
          break;
        }
        // ruote bloccate: niente rotazione, segni di frenata sulla strada
        const [x, y, r] = SKID[i];
        this.place(x, y, r);
        for (const w of [WHEEL_BACK, WHEEL_FRONT]) {
          const p = this.carPoint(w[0], w[1]);
          this.skids.push(acquireImage(this.scene, p.x, p.y, 'cc-skid').setDepth(DEPTH_SKID));
        }
        break;
      }
      case 'smoke': {
        if (this.step === 1) {
          this.car.clearTint();
          this.tree.clearTint();
        }
        const rest = REST[Math.min(this.step - 1, REST.length - 1)];
        this.place(rest[0], rest[1], rest[2]);
        // frecce
        const hz = Math.floor(this.phaseMs / CRASH.hazardMs) % 2 === 0;
        this.car.setTexture(hz ? CAR_KEYS.hazard : CAR_KEYS.crashed);
        // fumo dal cofano
        if (this.phaseMs % CRASH.smokeEveryMs < CRASH.frameMs) this.puff();
        // clacson incantato
        if (this.phaseMs >= 300 && this.horns < CRASH.hornCount && (this.phaseMs - 300) % CRASH.hornEveryMs < CRASH.frameMs) {
          this.horns++;
          sndHorn(this.horns === CRASH.hornCount);
        }
        if (this.phaseMs >= CRASH.smokeMs) this.setPhase('leave');
        break;
      }
      case 'leave': {
        // lampeggia a scatti, sempre più veloce, poi sparisce
        const fast = this.phaseMs > CRASH.leaveMs / 2;
        const on = fast ? this.step % 2 === 0 : Math.floor(this.step / 2) % 2 === 0;
        this.car.setVisible(on).setTexture(CAR_KEYS.crashed);
        for (const s of this.skids) s.setVisible(on);
        if (this.phaseMs >= CRASH.leaveMs) this.finish();
        break;
      }
      default:
        break;
    }
  }

  private impact(): void {
    const scene = this.scene;
    this.setPhase('smoke');
    const [x, y, r] = IMPACT;
    this.car.setTexture(CAR_KEYS.crashed);
    this.place(x, y, r);
    // lampo bianco: auto e albero pieni di bianco per un frame + stella d'urto
    this.car.setTintFill(col(C.white));
    this.tree.setTintFill(col(C.white));
    const nose = this.carPoint(NOSE[0], NOSE[1]);
    popFrames(scene, nose.x, nose.y, BURST_KEYS, CRASH.frameMs, { depth: DEPTH_DEBRIS + 1 });
    shake(scene, CRASH.shakePx, CRASH.shakeMs);

    // vetri, pezzi di carrozzeria, fumo
    const back = this.dir === 1 ? Math.PI : 0;
    spawnParticles(scene, nose.x, nose.y - 3, {
      count: 14,
      colors: [C.cyan, C.white],
      speed: 2.6,
      angle: -Math.PI / 2 + (back === Math.PI ? -0.5 : 0.5),
      spread: 2.4,
      gravity: 0.16,
      lifeMs: 750,
      size: 1,
      depth: DEPTH_DEBRIS,
    });
    spawnParticles(scene, nose.x, nose.y, {
      count: 8,
      colors: [C.blue, C.blue, C.navy],
      speed: 2.2,
      angle: back - this.dir * 0.6,
      spread: 1.6,
      gravity: 0.2,
      lifeMs: 800,
      depth: DEPTH_DEBRIS,
    });
    spawnParticles(scene, nose.x, nose.y - 2, {
      count: 10,
      colors: [C.silver, C.slate, C.charcoal],
      speed: 0.9,
      angle: -Math.PI / 2,
      spread: 1.8,
      gravity: -0.02,
      lifeMs: 900,
      depth: DEPTH_SMOKE,
    });

    // l'albero oscilla (spinto dalla parte opposta all'auto) e perde foglie
    const d = this.dir;
    this.treeSeq = [2, 2, -1, -1, 1, 1, 0].map((s) => s * d);
    this.dropLeaves(16);

    // bonus
    const coins = CRASH.bonusBase + CRASH.bonusPerLevel * getLevel();
    economy.add(coins);
    setPixelText(this.coinsText, `+${coins}`);
    this.textMs = 0;
    spawnParticles(scene, Math.round(SCREEN.width / 2), 104, {
      count: 10,
      colors: [C.yellow, C.orange],
      speed: 2.2,
      gravity: 0.1,
      lifeMs: 600,
      depth: DEPTH_TEXT + 1,
    });
    sndCrash();
  }

  private finish(): void {
    this.car.setVisible(false).clearTint();
    this.releaseAll();
    this.hideTexts();
    this.treeSeq = [];
    this.tree.setTexture(treeKey(0)).clearTint();
    this.setPhase('idle');
    sndVanish();
  }

  // ---------------------------------------------------------------- dettagli

  /** posiziona l'auto da coordinate locali (arrivo da sinistra), specchiando se arriva da destra */
  private place(lx: number, ly: number, rotDeg: number): void {
    const x = this.dir === 1 ? lx : SCREEN.width - lx;
    this.car
      .setPosition(Math.round(x), Math.round(ly))
      .setRotation(Phaser.Math.DegToRad(rotDeg * this.dir))
      .setFlipX(this.dir === -1);
  }

  /** punto dell'auto (offset dal centro, auto rivolta a destra) in coordinate mondo */
  private carPoint(ox: number, oy: number): { x: number; y: number } {
    const r = this.car.rotation;
    const dx = ox * this.dir;
    return {
      x: Math.round(this.car.x + dx * Math.cos(r) - oy * Math.sin(r)),
      y: Math.round(this.car.y + dx * Math.sin(r) + oy * Math.cos(r)),
    };
  }

  private dropLeaves(count: number): void {
    const per = Math.max(1, Math.round(count / 3));
    for (const [x, y] of [
      [TREE_CX_WORLD - 12, 132],
      [TREE_CX_WORLD, 122],
      [TREE_CX_WORLD + 12, 132],
    ]) {
      spawnParticles(this.scene, x, y, {
        count: per,
        colors: [C.green, C.lime, C.teal],
        speed: 1.3,
        angle: Math.PI / 2,
        spread: Math.PI * 1.4,
        gravity: 0.025,
        lifeMs: 1200,
        depth: DEPTH_LEAVES,
      });
    }
  }

  private tickTree(): void {
    if (this.treeSeq.length === 0) return;
    const s = this.treeSeq.shift() ?? 0;
    this.tree.setTexture(treeKey(s));
    if (this.treeSeq.length === 3) this.dropLeaves(6);
  }

  private puff(): void {
    const p = this.carPoint(HOOD[0], HOOD[1]);
    const seed = (this.step * 7 + this.puffs.length) % 5;
    const x = p.x + (seed % 3) - 1;
    const img = acquireImage(this.scene, x, p.y, SMOKE_KEYS[0]).setDepth(DEPTH_SMOKE);
    this.puffs.push({ img, age: 0, x, y: p.y, seed });
  }

  private tickPuffs(): void {
    let w = 0;
    for (const p of this.puffs) {
      p.age += CRASH.frameMs;
      if (p.age >= CRASH.puffMs) {
        releaseImage(p.img);
        continue;
      }
      const k = p.age / CRASH.puffMs;
      // sale di 2 px a frame, poi di 1; deriva a scatti
      const frames = Math.round(p.age / CRASH.frameMs);
      p.y -= k < 0.3 ? 2 : 1;
      if (frames % 4 === 0) p.x += p.seed % 2 === 0 ? 1 : -1;
      p.img.setPosition(Math.round(p.x), Math.round(p.y)).setTexture(SMOKE_KEYS[k < 0.25 ? 0 : k < 0.65 ? 1 : 2]);
      this.puffs[w++] = p;
    }
    this.puffs.length = w;
  }

  private tickTexts(): void {
    if (this.textMs < 0) return;
    this.textMs += CRASH.frameMs;
    if (this.textMs >= CRASH.textMs) {
      this.hideTexts();
      return;
    }
    const f = Math.floor(this.textMs / CRASH.frameMs);
    const ending = this.textMs > CRASH.textMs - 400;
    const show = !ending || f % 2 === 0;
    const alt = Math.floor(f / 2) % 2 === 0;
    this.sbam.setVisible(show && !alt);
    this.sbamAlt.setVisible(show && alt);
    this.coinsText.setVisible(show && this.textMs > 120);
  }

  private hideTexts(): void {
    this.textMs = -1;
    this.sbam.setVisible(false);
    this.sbamAlt.setVisible(false);
    this.coinsText.setVisible(false);
  }

  private releaseAll(): void {
    for (const s of this.skids) releaseImage(s);
    this.skids.length = 0;
    for (const p of this.puffs) releaseImage(p.img);
    this.puffs.length = 0;
  }

  destroy(): void {
    this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.update, this);
    this.subs.clear();
    this.releaseAll();
    if (instances.get(this.scene) === this) instances.delete(this.scene);
    const w = window as unknown as { carCrash?: unknown };
    if (w.carCrash && (w.carCrash as { owner?: unknown }).owner === this) delete w.carCrash;
  }
}

// ---------------------------------------------------------------- API

/** Disegna l'albero e attiva gli incidenti nella scena (una riga in Game.create, dopo buildRoom). */
export function bindCarCrash(scene: Phaser.Scene): CarCrash {
  instances.get(scene)?.destroy();
  const c = new CarCrash(scene);
  instances.set(scene, c);
  // debug da console: carCrash.trigger(), carCrash.trigger(true) = da destra
  (window as unknown as { carCrash: unknown }).carCrash = {
    owner: c,
    trigger: (fromRight?: boolean) => c.tryTrigger(0, true, fromRight),
    phase: () => c.currentPhase,
  };
  return c;
}

/**
 * Forza un incidente (debug): ignora il cooldown ma non parte se ce n'è già
 * uno in corso. Senza scena usa l'ultima collegata. Ritorna true se è partito.
 */
export function triggerCarCrash(scene?: Phaser.Scene, fromRight?: boolean): boolean {
  const c = scene ? instances.get(scene) : [...instances.values()].pop();
  return c ? c.tryTrigger(0, true, fromRight) : false;
}
