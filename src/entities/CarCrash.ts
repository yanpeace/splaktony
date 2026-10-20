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
import { CRASH_LEAVE_Z, roadAt, TREE, TUNNEL, Z_FAR } from './siteLayout';

/**
 * Cantiere della galleria: l'albero (piccolo, lontano, sempre visibile) e l'incidente.
 *
 * Ogni tanto, dopo una cosa importante (combo x5, colpo da 60+, level up
 * multiplo di 3, a volte combo x3), un'utilitaria blu arriva da sotto lo
 * schermo e sale lungo la strada a curve verso la galleria, rimpicciolendo con
 * la distanza (geometria condivisa in siteLayout.ts). A CRASH_LEAVE_Z non
 * sterza più: tira dritto, frena lasciando i segni e si schianta contro
 * l'albero (TREE). Lampo, scossone leggero, vetri, foglie, fumo dal cofano,
 * frecce e clacson incantato; poi lampeggia e sparisce. Dà monete bonus.
 *
 * Pixel art senza scala continua: l'auto ha 5 taglie pre-disegnate (larghezza
 * da dietro 28/20/14/10/7 px), scelte da 1/z; per ogni taglia una vista da
 * dietro e una di 3/4 (verso sinistra; verso destra = specchiata), scelte dalla
 * direzione della strada. Ruote a 2 frame sulle due taglie grandi.
 *
 * Tutto si muove a scatti di pixel interi, a "frame" da CRASH.frameMs.
 * Il tempo segue scene.time.timeScale (utile per rallentare e debuggare).
 *
 * Variante "galleria" (intro del mondo 2): driveIntoTunnel(scene, onInside)
 * fa salire l'auto lungo la strada senza uscire a CRASH_LEAVE_Z: segue
 * roadAt(z) fino a Z_FAR, rimpicciolisce, diventa una sagoma nel buio della
 * bocca e sparisce con un lampo dei fanali; onInside() parte quando entra.
 *
 * Uso: bindCarCrash(scene) in Game.create(), dopo buildRoom
 * (bindCarCrash(scene, { auto: false }) = niente incidenti automatici).
 * Debug da console: window.carCrash.trigger() (o triggerCarCrash(scene)),
 * window.carCrash.tunnel() = auto nella galleria.
 */

// ---------------------------------------------------------------- depth

const DEPTH_SKID = 2.4;
const DEPTH_TREE = 2.5;
const DEPTH_LEAVES = 2.7;
const DEPTH_CAR = 3;
const DEPTH_SMOKE = 3.2;
const DEPTH_DEBRIS = 4;
const DEPTH_TEXT = 45;

// ---------------------------------------------------------------- sprite: auto

/* Utilitaria anni '90 (hatchback), originale, nessun marchio.
   Carrozzeria 9/a/8, vetri b/a, ruote 0/f/e/d, stop 2, targa c (vuota).
   Segnaposto dei 2 frame ruote: W/V (mozzo d/e) e X/Y (battistrada f/e). */

/** riga simmetrica da mezza riga (odd: la colonna centrale è l'ultima della metà) */
function sym(half: readonly string[], odd = false): string[] {
  return half.map((r) => r + [...(odd ? r.slice(0, -1) : r)].reverse().join(''));
}

/** taglie (larghezza della vista da dietro), dalla più grande */
const SIZES = [28, 20, 14, 10, 7] as const;
type Size = (typeof SIZES)[number];
/** taglie con i 2 frame delle ruote */
const WHEEL_SIZES: readonly Size[] = [28, 20];

/** da dietro: sale dritta verso la galleria */
const BACK: Record<Size, SpriteData> = {
  28: sym([
    '.......0000000',
    '......0aaaaaaa',
    '.....099999999',
    '....0900000000',
    '....090bbbbbbb',
    '...0990bbabbbb',
    '...090bbabbbbb',
    '...090babbbbbb',
    '..099000000000',
    '..099999999999',
    '.0222099990000',
    '.022209990cccc',
    '.0999999990000',
    '.0888888888888',
    '.0ffffffffffff',
    '.0000000000000',
    '.0XYX0........',
    '.0YXY0........',
    '..000.........',
  ]),
  20: sym([
    '.....00000',
    '....0aaaaa',
    '...0999999',
    '...0900000',
    '..090bbbbb',
    '..090babbb',
    '..090abbbb',
    '.099000000',
    '.022099000',
    '.022090ccc',
    '.088888000',
    '.0ffffffff',
    '.000000000',
    '.0XY0.....',
    '..00......',
  ]),
  14: sym([
    '...0000',
    '..0aaaa',
    '..09999',
    '.090000',
    '.090bbb',
    '.090abb',
    '0990000',
    '02209cc',
    '0888888',
    '0ffffff',
    '0000000',
    '0f0....',
  ]),
  10: sym(['..000', '.0aaa', '.0bbb', '.0abb', '02999', '08888', '0f000', '.0...']),
  7: sym(['..00', '.0bb', '0999', '0299', '0888', '0f00'], true),
};

/** di 3/4 verso sinistra (muso in alto a sinistra, coda e fianco sinistro verso chi guarda) */
const SIDE: Record<Size, SpriteData> = {
  28: [
    '..........00000000000000........',
    '.........0aaaaaaaaaaaaaa0.......',
    '........0aaaaaaaaaaaaaaaa0......',
    '.......000000000000000000000....',
    '......09bbbb0bbbb909bbbbbbb90...',
    '.....09babbb0babb909bbabbbb90...',
    '....09abbbbb0abbb909babbbbb90...',
    '...000000000000000900000000090..',
    '..0aaaaaaaaaaaaaaa9999999999990.',
    '.099999999999999992299999999220.',
    '.099999909999999992299cccc99220.',
    '.088000088888888889999cccc99990.',
    '.080ffff08880000088888888888880.',
    '.0f0fWVf0ff0fffff0ffffffffffff0.',
    '..00ffff0000fWVWf00000000000000.',
    '....0000...0fffff0........0fe0..',
    '............00000..........00...',
  ],
  20: [
    '.......000000000.......',
    '......0aaaaaaaaa0......',
    '.....000000000000000...',
    '....09bbb0bb909bbbb90..',
    '...09babb0ba909babb90..',
    '..00000000000000000090.',
    '.0aaaaaaaaaaa999999990.',
    '.099999999999299999920.',
    '.08800088888829cccc920.',
    '.080fff080008888888880.',
    '.0f0fWf00fff0ffffffff0.',
    '..00fff00fVf0000000000.',
    '....000.0fff0.....0f0..',
    '.........000......000..',
  ],
  14: [
    '.....000000.....',
    '....0aaaaaa0....',
    '...0bb0b909bbb0.',
    '..0babbb909bab0.',
    '.00000000000000.',
    '0aaaaaaaa2999920',
    '08000800089cc980',
    '0ffefffefffffff0',
    '.00f000f00000f0.',
    '..000.000....00.',
  ],
  10: [
    '....0000....',
    '...0aaaa0...',
    '..0bb0b9bb0.',
    '.0aaaaa29920',
    '.0888888cc80',
    '.0fffffffff0',
    '..0ff0ff0f0.',
    '...00.00.0..',
  ],
  7: ['..000...', '.0bb9b0.', '0aaa2920', '08888c80', '0f0f0f00', '.0.0.0..'],
};

/** sostituisce i segnaposto delle ruote col frame 0 o 1 */
function wheels(rows: SpriteData, frame: 0 | 1): string[] {
  const map: Record<string, string> = frame ? { W: 'e', V: 'd', X: 'e', Y: 'f' } : { W: 'd', V: 'e', X: 'f', Y: 'e' };
  return rows.map((r) => r.replace(/[WVXY]/g, (ch) => map[ch]));
}

/** auto di 3/4 dopo lo schianto: muso accartocciato, parabrezza incrinato; hazard = frecce accese */
function crashedRows(rows: SpriteData, hazard: boolean): string[] {
  const g = wheels(rows, 0).map((r) => [...r]);
  const h = g.length;
  const first = (r: string[]) => r.findIndex((ch) => ch !== '.');
  // il muso (a sinistra) rientra di 1 px nella fascia centrale
  for (let y = Math.round(h * 0.25); y < Math.round(h * 0.65); y++) {
    const i = first(g[y]);
    if (i >= 0 && i + 1 < g[y].length && g[y][i + 1] !== '.') {
      g[y][i] = '.';
      g[y][i + 1] = '0';
    }
  }
  // crepe nei primi vetri
  let cracks = 0;
  for (let y = 0; y < h && cracks < 2; y++) {
    const i = g[y].indexOf('b');
    if (i >= 0) {
      g[y][i] = 'c';
      cracks++;
    }
  }
  // lamiera ammaccata
  const dy = Math.round(h * 0.55);
  const di = first(g[dy]);
  if (di >= 0 && g[dy][di + 1] !== '.') g[dy][di + 1] = 'e';
  if (hazard) {
    for (const r of g) for (let x = 0; x < r.length; x++) if (r[x] === '2') r[x] = '4';
    const fy = Math.round(h * 0.45);
    const fi = first(g[fy]);
    if (fi >= 0 && g[fy][fi + 1] !== '.') g[fy][fi + 1] = '4';
  }
  return g.map((r) => r.join(''));
}

type View = 'b' | 's';
const carKey = (size: Size, view: View, wheel: 0 | 1) => `cc-car-${size}-${view}${wheel}`;
const crashedKey = (size: Size, hazard: boolean) => `cc-car-${size}-x${hazard ? 'h' : ''}`;

// ---------------------------------------------------------------- sprite: albero

/* Albero piccolo (12x16, lontano): chioma 5/6/7, tronco 1/2, contorno 0.
   La chioma è senza contorno: lo aggiunge treeRows() dopo l'oscillazione. */
const TREE_FILL: readonly string[] = [
  '....5566....',
  '...555666...',
  '..55566666..',
  '..55666566..',
  '.5566666667.',
  '.5666566667.',
  '.5666666677.',
  '.6666766777.',
  '..66667777..',
  '..77777777..',
  '....7777....',
  '.....21.....',
  '.....21.....',
  '.....11.....',
  '.....21.....',
  '....0210....',
];
/** righe della chioma (si inclinano); sotto, il tronco resta fermo */
const CANOPY_ROWS = 11;
/** margine laterale della texture, per l'oscillazione */
const TREE_PAD = 2;
/** colonna (nella texture) del primo pixel interno del tronco: sta su TREE.x */
const TREE_TRUNK_COL = 5 + TREE_PAD;
const TREE_SHEARS = [-2, -1, 0, 1, 2] as const;
const treeKey = (s: number) => `cc-tree-${s + 2}`;

/** albero con la chioma inclinata di `shear` px in cima, contorno ricalcolato */
function treeRows(shear: number): string[] {
  const W = TREE_FILL[0].length + TREE_PAD * 2;
  const H = TREE_FILL.length;
  const g: string[][] = Array.from({ length: H }, () => Array<string>(W).fill('.'));
  for (let y = 0; y < H; y++) {
    const s = y < CANOPY_ROWS ? Math.round((shear * (CANOPY_ROWS - y)) / CANOPY_ROWS) : 0;
    for (let x = 0; x < TREE_FILL[y].length; x++) {
      const ch = TREE_FILL[y][x];
      if (ch !== '.') g[y][x + TREE_PAD + s] = ch;
    }
  }
  // contorno a 4 vicini attorno a tutto ciò che non è già contorno
  const filled = (x: number, y: number) => y >= 0 && y < H && x >= 0 && x < W && g[y][x] !== '.' && g[y][x] !== '0';
  const out = g.map((r) => [...r]);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (g[y][x] !== '.') continue;
      if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) out[y][x] = '0';
    }
  }
  return out.map((r) => r.join(''));
}

// ---------------------------------------------------------------- sprite: effetti

/** sbuffi di fumo: grandi (auto vicina) e piccoli, in scala con l'auto lontana */
const SMOKE: Record<string, SpriteData> = {
  'cc-smoke-a': ['.e.', 'ede', '.e.'],
  'cc-smoke-b': ['.eee.', 'eddde', 'eddde', 'edde.', '.ee..'],
  'cc-smoke-c': ['.f.f.', 'f.e.f', '.e.e.', 'f.f..', '.....'],
  'cc-smoke-sa': ['e'],
  'cc-smoke-sb': ['dd', 'de'],
  'cc-smoke-sc': ['d.', '.e'],
};
const SMOKE_BIG = ['cc-smoke-a', 'cc-smoke-b', 'cc-smoke-c'] as const;
const SMOKE_SMALL = ['cc-smoke-sa', 'cc-smoke-sb', 'cc-smoke-sc'] as const;

/** lampo d'urto piccolo (5x5) */
const BURST: Record<string, SpriteData> = {
  'cc-burst-a': ['..c..', '.ccc.', 'ccccc', '.ccc.', '..c..'],
  'cc-burst-b': ['c...c', '..4..', '.4c4.', '..4..', 'c...c'],
  'cc-burst-c': ['.....', '..4..', '.4.4.', '..4..', '.....'],
};
const BURST_KEYS = ['cc-burst-a', 'cc-burst-b', 'cc-burst-c'] as const;

/** dimensioni delle texture dell'auto (servono per posizionarla a pixel interi) */
const carDims = new Map<string, { w: number; h: number }>();

function makeCar(scene: Phaser.Scene, key: string, rows: SpriteData): void {
  makeSprite(scene, key, rows);
  carDims.set(key, { w: rows[0].length, h: rows.length });
}

function ensureTextures(scene: Phaser.Scene): void {
  for (const size of SIZES) {
    for (const wheel of [0, 1] as const) {
      makeCar(scene, carKey(size, 'b', wheel), wheels(BACK[size], wheel));
      makeCar(scene, carKey(size, 's', wheel), wheels(SIDE[size], wheel));
    }
    makeCar(scene, crashedKey(size, false), crashedRows(SIDE[size], false));
    makeCar(scene, crashedKey(size, true), crashedRows(SIDE[size], true));
  }
  for (const s of TREE_SHEARS) makeSprite(scene, treeKey(s), treeRows(s));
  for (const [k, rows] of Object.entries(SMOKE)) makeSprite(scene, k, rows);
  for (const [k, rows] of Object.entries(BURST)) makeSprite(scene, k, rows);
}

/** taglia pre-disegnata più vicina alla larghezza desiderata a profondità z */
function sizeAt(z: number): Size {
  const want = CRASH.carWidthK / Math.max(0.1, z);
  let best: Size = SIZES[0];
  for (const s of SIZES) if (Math.abs(s - want) < Math.abs(best - want)) best = s;
  return best;
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

/** l'auto entra nella galleria: rombo che rimbomba */
function sndTunnel(): void {
  tone({ type: 'triangle', from: 110, to: 45, dur: 0.6, vol: 0.3 });
  tone({ type: 'square', from: 70, to: 40, dur: 0.5, vol: 0.08, delay: 0.12 });
  noise({ dur: 0.5, vol: 0.12, freq: 800, freqTo: 200, delay: 0.05 });
}

function sndVanish(): void {
  tone({ type: 'square', from: 600, to: 200, dur: 0.1, vol: 0.06 });
}

// ---------------------------------------------------------------- incidente

type Phase = 'idle' | 'wait' | 'enter' | 'skid' | 'smoke' | 'leave' | 'tunnel' | 'tunnelIn';

interface Puff {
  img: Phaser.GameObjects.Image;
  age: number;
  x: number;
  y: number;
  seed: number;
}

interface Pt {
  x: number;
  y: number;
}

const instances = new Map<Phaser.Scene, CarCrash>();

export class CarCrash {
  private readonly tree: Phaser.GameObjects.Image;
  private readonly car: Phaser.GameObjects.Image;
  private readonly skidGfx: Phaser.GameObjects.Graphics;
  /** lampo dei fanali dentro la bocca della galleria */
  private readonly flashGfx: Phaser.GameObjects.Graphics;
  /** callback di driveIntoTunnel: l'auto è entrata nella galleria */
  private onInside: (() => void) | null = null;
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
  private lastStart = -Infinity;

  /** profondità e velocità in z (z/s) dell'auto */
  private z = 0;
  private zSpeed = 0;
  /** corsia: frazione della larghezza della strada dal centro */
  private lane = 0;
  private wheel: 0 | 1 = 0;
  /** tratto dritto finale: da leaveP (a CRASH_LEAVE_Z) a hitP (contro il tronco) */
  private leaveP: Pt = { x: 0, y: 0 };
  private hitP: Pt = { x: 0, y: 0 };
  /** ultimo punto a terra dei segni di frenata */
  private skidLast: Pt | null = null;
  /** l'auto guarda a destra (vista di 3/4 specchiata) */
  private flip = false;
  /** taglia dell'auto ferma contro l'albero */
  private crashSize: Size = 10;

  private puffs: Puff[] = [];
  private treeSeq: number[] = [];
  private textMs = -1;
  private horns = 0;

  // catena di combo corrente
  private comboHits = 0;
  private comboSmall = false;
  private comboBig = false;

  /**
   * auto = false: gli eventi (combo, colpi forti, level up) non fanno partire
   * l'incidente (intro del mondo 2); trigger di debug e driveIntoTunnel sì.
   */
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly auto = true,
  ) {
    ensureTextures(scene);
    const treeH = TREE_FILL.length;
    this.tree = scene.add
      .image(TREE.x - TREE_TRUNK_COL, TREE.y - treeH + 1, treeKey(0))
      .setOrigin(0)
      .setDepth(DEPTH_TREE);
    this.car = scene.add.image(0, 0, carKey(28, 'b', 0)).setOrigin(0).setDepth(DEPTH_CAR).setVisible(false);
    this.skidGfx = scene.add.graphics().setDepth(DEPTH_SKID);
    this.flashGfx = scene.add.graphics().setDepth(DEPTH_CAR);
    // "SBAM!" sopra l'albero, dentro lo schermo
    const tw = 34; // mezza larghezza di "SBAM!" a scala 2 (circa)
    const tx = Phaser.Math.Clamp(TREE.x, tw, SCREEN.width - tw);
    const ty = Math.max(12, TREE.y - 40);
    this.sbam = pixelText(scene, tx, ty, 'SBAM!', C.orange).setOrigin(0.5).setScale(2).setDepth(DEPTH_TEXT);
    this.sbamAlt = pixelText(scene, tx, ty, 'SBAM!', C.yellow).setOrigin(0.5).setScale(2).setDepth(DEPTH_TEXT);
    this.coinsText = pixelText(scene, tx, ty + 12, '+0', C.yellow).setOrigin(0.5, 0).setDepth(DEPTH_TEXT);
    this.hideTexts();

    this.subs.on('damage', (e) => {
      if (!this.auto) return;
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
      if (!this.auto) return;
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

  /**
   * Avvia l'incidente se libero e fuori cooldown (force: ignora il cooldown).
   * fromRight: corsia (true / non indicato = corsia di destra, false = sinistra).
   */
  tryTrigger(delayMs = 0, force = false, fromRight?: boolean): boolean {
    if (this.phase !== 'idle') return false;
    const now = this.scene.time.now;
    if (!force && now - this.lastStart < CRASH.cooldownMs) return false;
    this.lastStart = now;
    this.lane = fromRight === false ? -CRASH.lane : CRASH.lane;
    if (delayMs > 0) {
      this.phase = 'wait';
      this.waitMs = delayMs;
    } else {
      this.begin();
    }
    return true;
  }

  /**
   * L'auto sale lungo tutta la strada ed entra nella galleria (niente
   * incidente). onInside() viene chiamata quando sparisce nella bocca.
   * Ritorna false se un incidente è già in corso.
   */
  driveIntoTunnel(onInside?: () => void): boolean {
    if (this.phase !== 'idle' && this.phase !== 'wait') return false;
    this.lane = CRASH.lane;
    this.begin();
    this.setPhase('tunnel');
    this.onInside = onInside ?? null;
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
    this.z = CRASH.enterZ;
    this.zSpeed = CRASH.zSpeed;
    this.horns = 0;
    this.skidLast = null;
    this.skidGfx.clear().setVisible(true);
    // tratto dritto: dal punto in cui l'auto smette di sterzare al tronco
    this.leaveP = this.laneAt(CRASH_LEAVE_Z);
    this.crashSize = sizeAt(TREE.z);
    const goingLeft = TREE.x < this.leaveP.x;
    const w = carDims.get(crashedKey(this.crashSize, false))?.w ?? 8;
    // il muso tocca il tronco (1 px dentro), le ruote appena davanti alla base
    this.hitP = {
      x: goingLeft ? TREE.x + 1 + Math.floor(w / 2) : TREE.x + 1 - Math.ceil(w / 2),
      y: TREE.y + 1,
    };
    this.car.clearTint().setVisible(true);
    this.showCar(this.laneAt(this.z), this.heading(), this.z);
  }

  /** punto a terra della corsia a profondità z */
  private laneAt(z: number): Pt {
    const p = roadAt(z);
    return { x: p.x + p.w * this.lane, y: p.y };
  }

  /** direzione a schermo della corsia alla profondità corrente (radianti) */
  private heading(): number {
    const a = this.laneAt(this.z);
    const b = this.laneAt(this.z + 0.05);
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  /** sceglie taglia, vista e frame ruote e mette l'auto coi piedi (ruote) su p */
  private showCar(p: Pt, heading: number, z: number): void {
    const size = sizeAt(z);
    const offVertical = Math.abs(Phaser.Math.RadToDeg(Phaser.Math.Angle.Wrap(heading + Math.PI / 2)));
    const view: View = offVertical < CRASH.backViewDeg ? 'b' : 's';
    this.flip = view === 's' && Math.cos(heading) > 0;
    const wheel = WHEEL_SIZES.includes(size) ? this.wheel : 0;
    this.placeCar(carKey(size, view, wheel), p);
  }

  /** posiziona la texture `key` a pixel interi: centro in basso su p */
  private placeCar(key: string, p: Pt): void {
    const d = carDims.get(key) ?? { w: 1, h: 1 };
    this.car
      .setTexture(key)
      .setFlipX(this.flip)
      .setPosition(Math.round(p.x - d.w / 2), Math.round(p.y) - d.h + 1);
  }

  /** un "frame" a scatti dell'animazione */
  private frame(): void {
    this.phaseMs += CRASH.frameMs;
    this.step++;
    this.tickTree();
    this.tickPuffs();
    this.tickTexts();
    const dtS = CRASH.frameMs / 1000;

    switch (this.phase) {
      case 'enter': {
        // velocità costante nel mondo, poi accelera un po' prima dell'uscita di strada
        if (this.z >= CRASH.zAccelFrom) this.zSpeed = Math.min(CRASH.zSpeedMax, this.zSpeed + CRASH.zAccel * dtS);
        this.z = Math.min(CRASH_LEAVE_Z, this.z + this.zSpeed * dtS);
        this.wheel = this.wheel ? 0 : 1;
        this.showCar(this.laneAt(this.z), this.heading(), this.z);
        if (this.step % 2 === 1) {
          const k = (this.zSpeed - CRASH.zSpeed) / Math.max(0.01, CRASH.zSpeedMax - CRASH.zSpeed);
          sndEngine(2 + 3 * k);
        }
        if (this.z >= CRASH_LEAVE_Z) {
          this.setPhase('skid');
          sndSkid();
        }
        break;
      }
      case 'skid': {
        // niente più sterzo: dritta verso il tronco, ruote bloccate, segni e polvere
        this.z = Math.min(TREE.z, this.z + this.zSpeed * CRASH.skidSpeedMult * dtS);
        const u = (this.z - CRASH_LEAVE_Z) / Math.max(0.01, TREE.z - CRASH_LEAVE_Z);
        const p = {
          x: this.leaveP.x + (this.hitP.x - this.leaveP.x) * u,
          y: this.leaveP.y + (this.hitP.y - this.leaveP.y) * u,
        };
        const heading = Math.atan2(this.hitP.y - this.leaveP.y, this.hitP.x - this.leaveP.x);
        this.showCar(p, heading, this.z);
        this.skidMarks(p, heading);
        spawnParticles(this.scene, p.x, p.y, {
          count: 2,
          colors: [C.silver, C.yellow, C.white],
          speed: 0.5,
          angle: -Math.PI / 2,
          spread: 2.2,
          gravity: -0.004,
          lifeMs: 450,
          size: 1,
          depth: DEPTH_SMOKE,
        });
        if (u >= 1) this.impact();
        break;
      }
      case 'tunnel': {
        // come 'enter', ma senza uscire di strada: fino alla bocca (Z_FAR)
        if (this.z >= CRASH.zAccelFrom) this.zSpeed = Math.min(CRASH.tunnelSpeedMax, this.zSpeed + CRASH.zAccel * dtS);
        this.z = Math.min(Z_FAR, this.z + this.zSpeed * dtS);
        this.wheel = this.wheel ? 0 : 1;
        this.showCar(this.laneAt(this.z), this.heading(), this.z);
        if (this.step % 2 === 1) sndEngine(2 + 3 * Math.min(1, (this.zSpeed - CRASH.zSpeed) / (CRASH.tunnelSpeedMax - CRASH.zSpeed)));
        if (this.z >= Z_FAR) {
          this.setPhase('tunnelIn');
          sndTunnel();
          const cb = this.onInside;
          this.onInside = null;
          cb?.();
        }
        break;
      }
      case 'tunnelIn': {
        // sagoma sempre più scura nella bocca, poi il lampo dei fanali
        const fade = CRASH.tunnelFadeFrames;
        if (this.step <= fade) {
          this.showCar(this.laneAt(Z_FAR), -Math.PI / 2, Z_FAR);
          this.car.setTintFill(col(this.step < fade ? C.charcoal : C.black));
        } else {
          this.car.setVisible(false).clearTint();
          this.drawHeadlightFlash(this.step - fade);
        }
        if (this.step > fade + CRASH.tunnelFlashFrames) {
          this.flashGfx.clear();
          this.finish(false);
        }
        break;
      }
      case 'smoke': {
        if (this.step === 1) {
          this.car.clearTint();
          this.tree.clearTint();
        }
        // frecce
        const hz = Math.floor(this.phaseMs / CRASH.hazardMs) % 2 === 0;
        this.placeCar(crashedKey(this.crashSize, hz), this.hitP);
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
        this.placeCar(crashedKey(this.crashSize, false), this.hitP);
        this.car.setVisible(on);
        this.skidGfx.setVisible(on);
        if (this.phaseMs >= CRASH.leaveMs) this.finish();
        break;
      }
      default:
        break;
    }
  }

  /** due tracce scure 1 px (le ruote posteriori) dall'ultimo punto a p */
  private skidMarks(p: Pt, heading: number): void {
    const from = this.skidLast ?? p;
    this.skidLast = { x: p.x, y: p.y };
    const half = Math.max(1, Math.round(carDims.get(crashedKey(this.crashSize, false))!.w * 0.25));
    // normale alla direzione: le due ruote stanno ai lati
    const nx = -Math.sin(heading);
    const ny = Math.cos(heading);
    this.skidGfx.fillStyle(col(C.charcoal));
    for (const side of [-1, 1]) {
      const ox = nx * half * side;
      const oy = ny * half * side * 0.5; // in prospettiva la carreggiata è schiacciata
      const ax = from.x + ox;
      const ay = from.y + oy;
      const bx = p.x + ox;
      const by = p.y + oy;
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay))));
      for (let i = 0; i <= n; i++) {
        this.skidGfx.fillRect(Math.round(ax + ((bx - ax) * i) / n), Math.round(ay + ((by - ay) * i) / n), 1, 1);
      }
    }
  }

  /** rettangolo a schermo dell'auto (con la vista attuale) */
  private carBox(): { x: number; y: number; w: number; h: number } {
    const d = carDims.get(this.car.texture.key) ?? { w: 1, h: 1 };
    return { x: this.car.x, y: this.car.y, w: d.w, h: d.h };
  }

  /** muso dell'auto ferma (lato verso l'albero) */
  private nose(): Pt {
    const b = this.carBox();
    return { x: this.flip ? b.x + b.w - 1 : b.x, y: b.y + Math.round(b.h * 0.5) };
  }

  private impact(): void {
    const scene = this.scene;
    this.setPhase('smoke');
    this.placeCar(crashedKey(this.crashSize, false), this.hitP);
    // lampo bianco: auto e albero pieni di bianco per un frame + stellina d'urto
    this.car.setTintFill(col(C.white));
    this.tree.setTintFill(col(C.white));
    const nose = this.nose();
    popFrames(scene, nose.x, nose.y, BURST_KEYS, CRASH.frameMs, { depth: DEPTH_DEBRIS + 1 });
    shake(scene, CRASH.shakePx, CRASH.shakeMs);

    // vetri, pezzi di carrozzeria, fumo: piccoli, in scala con la distanza
    const back = this.flip ? Math.PI : 0; // i pezzi rimbalzano indietro
    spawnParticles(scene, nose.x, nose.y - 2, {
      count: 8,
      colors: [C.cyan, C.white],
      speed: 1.2,
      angle: -Math.PI / 2 + (this.flip ? -0.5 : 0.5),
      spread: 2.4,
      gravity: 0.08,
      lifeMs: 650,
      size: 1,
      depth: DEPTH_DEBRIS,
    });
    spawnParticles(scene, nose.x, nose.y, {
      count: 5,
      colors: [C.blue, C.blue, C.navy],
      speed: 1,
      angle: back + (this.flip ? 0.5 : -0.5),
      spread: 1.6,
      gravity: 0.1,
      lifeMs: 700,
      size: 1,
      depth: DEPTH_DEBRIS,
    });
    spawnParticles(scene, nose.x, nose.y - 1, {
      count: 6,
      colors: [C.silver, C.slate, C.charcoal],
      speed: 0.45,
      angle: -Math.PI / 2,
      spread: 1.8,
      gravity: -0.01,
      lifeMs: 800,
      size: 1,
      depth: DEPTH_SMOKE,
    });

    // l'albero oscilla (spinto nel verso dell'auto) e perde foglie
    const d = this.flip ? 1 : -1;
    this.treeSeq = [2, 2, -1, -1, 1, 0].map((s) => s * d);
    this.dropLeaves(9);

    // bonus
    const coins = CRASH.bonusBase + CRASH.bonusPerLevel * getLevel();
    economy.add(coins);
    setPixelText(this.coinsText, `+${coins}`);
    this.textMs = 0;
    spawnParticles(scene, this.coinsText.x, this.coinsText.y + 4, {
      count: 10,
      colors: [C.yellow, C.orange],
      speed: 2.2,
      gravity: 0.1,
      lifeMs: 600,
      depth: DEPTH_TEXT + 1,
    });
    sndCrash();
  }

  /** lampo dei fanali sul fondo della galleria (frame 1..CRASH.tunnelFlashFrames) */
  private drawHeadlightFlash(f: number): void {
    const g = this.flashGfx.clear();
    const cx = TUNNEL.x;
    const cy = TUNNEL.y - Math.round(TUNNEL.h * 0.3);
    const px = (x: number, y: number, w: number, h: number, c: number) => {
      g.fillStyle(col(c));
      g.fillRect(cx + x, cy + y, w, h);
    };
    if (f === 1) {
      // i due fanali che illuminano la parete
      px(-3, 0, 2, 1, C.yellow);
      px(1, 0, 2, 1, C.yellow);
    } else if (f === 2) {
      px(-5, -1, 10, 3, C.yellow);
      px(-3, -2, 6, 5, C.yellow);
      px(-2, -1, 4, 3, C.white);
    } else if (f === 3) {
      px(-3, -1, 6, 3, C.orange);
      px(-1, 0, 2, 1, C.yellow);
    } else {
      px(-1, 0, 2, 1, C.orange);
    }
  }

  private finish(sound = true): void {
    this.car.setVisible(false).clearTint();
    this.releaseAll();
    this.skidGfx.clear();
    this.hideTexts();
    this.treeSeq = [];
    this.tree.setTexture(treeKey(0)).clearTint();
    this.setPhase('idle');
    if (sound) sndVanish();
  }

  // ---------------------------------------------------------------- dettagli

  private dropLeaves(count: number): void {
    const per = Math.max(1, Math.round(count / 3));
    const top = TREE.y - TREE_FILL.length + 1;
    for (const [dx, dy] of [
      [-3, 5],
      [1, 2],
      [4, 6],
    ]) {
      spawnParticles(this.scene, TREE.x + dx, top + dy, {
        count: per,
        colors: [C.green, C.lime, C.teal],
        speed: 0.6,
        angle: Math.PI / 2,
        spread: Math.PI * 1.4,
        gravity: 0.012,
        lifeMs: 1100,
        size: 1,
        depth: DEPTH_LEAVES,
      });
    }
  }

  private tickTree(): void {
    if (this.treeSeq.length === 0) return;
    const s = this.treeSeq.shift() ?? 0;
    this.tree.setTexture(treeKey(s));
    if (this.treeSeq.length === 3) this.dropLeaves(4);
  }

  private puff(): void {
    // cofano: la parte anteriore alta dell'auto ferma
    const b = this.carBox();
    const fx = Math.round(b.w * 0.3);
    const x0 = this.flip ? b.x + b.w - 1 - fx : b.x + fx;
    const y = b.y + Math.round(b.h * 0.3);
    const seed = (this.step * 7 + this.puffs.length) % 5;
    const x = x0 + (seed % 3) - 1;
    const img = acquireImage(this.scene, x, y, this.smokeKeys()[0]).setDepth(DEPTH_SMOKE);
    this.puffs.push({ img, age: 0, x, y, seed });
  }

  private smokeKeys(): readonly string[] {
    return this.crashSize >= 14 ? SMOKE_BIG : SMOKE_SMALL;
  }

  private tickPuffs(): void {
    const keys = this.smokeKeys();
    const big = keys === SMOKE_BIG;
    let w = 0;
    for (const p of this.puffs) {
      p.age += CRASH.frameMs;
      if (p.age >= CRASH.puffMs) {
        releaseImage(p.img);
        continue;
      }
      const k = p.age / CRASH.puffMs;
      const frames = Math.round(p.age / CRASH.frameMs);
      // sale (veloce all'inizio, poi piano), deriva a scatti
      if (big) p.y -= k < 0.3 ? 2 : 1;
      else if (k < 0.25 || frames % 2 === 0) p.y -= 1;
      if (frames % (big ? 4 : 5) === 0) p.x += p.seed % 2 === 0 ? 1 : -1;
      p.img.setPosition(Math.round(p.x), Math.round(p.y)).setTexture(keys[k < 0.25 ? 0 : k < 0.65 ? 1 : 2]);
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
export function bindCarCrash(scene: Phaser.Scene, opts: { auto?: boolean } = {}): CarCrash {
  instances.get(scene)?.destroy();
  const c = new CarCrash(scene, opts.auto ?? true);
  instances.set(scene, c);
  // debug da console: carCrash.trigger(), carCrash.trigger(false) = corsia di sinistra
  (window as unknown as { carCrash: unknown }).carCrash = {
    owner: c,
    trigger: (fromRight?: boolean) => c.tryTrigger(0, true, fromRight),
    phase: () => c.currentPhase,
    tunnel: () => c.driveIntoTunnel(),
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

/**
 * Intro del mondo 2: l'utilitaria sale lungo la strada ed entra nella galleria
 * invece di schiantarsi. onInside() quando sparisce nella bocca (lì parte lo
 * zoom). Senza CarCrash nella scena ne collega uno senza incidenti automatici.
 */
export function driveIntoTunnel(scene: Phaser.Scene, onInside?: () => void): boolean {
  const c = instances.get(scene) ?? bindCarCrash(scene, { auto: false });
  return c.driveIntoTunnel(onInside);
}
