import Phaser from 'phaser';
import { SPRITZ } from '../config/balance';
import { makeSprites, type SpriteData } from './pixelSprite';
import { makeIndexTexture, type IndexImage } from './tunnelSprites';

/**
 * Sprite del minigioco SPRITZ (scenes/Spritz.ts), generati da codice
 * (Sweetie 16, mai l'indice 16 rosa). Chiavi texture con prefisso `sz-`.
 *
 * La vista è dalla cima della talpa verso il fondo della galleria: attorno al
 * punto di fuga (SPRITZ.vpX/vpY) c'è il tratto già rivestito (cerchio di
 * raggio innerR), poi l'anello di roccia nuda da spruzzare (volta e fianchi),
 * in basso il cuneo della carreggiata e il ponte della talpa. La roccia è in
 * coordinate "polari prospettiche": u = angolo, v = depthK / raggio, così
 * rete, centine e chiodi convergono verso il fondo come in una galleria vera.
 *
 * buildWallLayout() calcola la griglia di copertura (celle da SPRITZ.cell px):
 * quali celle sono parete, quanti strati servono (i blocchi sporgenti di più),
 * la zona angolare di ogni cella e un ordine di riempimento a macchie,
 * deterministico, per ricostruire la copertura salvata.
 */

const W = 180;
const H = 320;
/** trasparente negli IndexImage */
const T = 255;

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x: number, y: number) => (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const fract = (v: number) => v - Math.floor(v);
const mod = (a: number, m: number) => ((a % m) + m) % m;

/** Hash intero → 0..1 (stabile, niente Math.random negli sprite). */
export function hash2(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Rumore a valori interpolato (0..1). */
function vnoise(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x: number, y: number, seed = 0): number {
  return (vnoise(x, y, seed) * 0.55 + vnoise(x * 2.1, y * 2.1, seed + 11) * 0.3 + vnoise(x * 4.3, y * 4.3, seed + 23) * 0.15);
}

/** PRNG deterministico (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- geometria della vista

export type ViewKind = 'wall' | 'far' | 'floor' | 'deck';

/** Cosa c'è nel pixel (x, y) della vista. */
export function viewKind(x: number, y: number): ViewKind {
  if (y >= SPRITZ.deckY) return 'deck';
  const dx = x + 0.5 - SPRITZ.vpX;
  const dy = y + 0.5 - SPRITZ.vpY;
  if (dy > 0 && Math.abs(dx) <= dy * SPRITZ.floorSlope) return 'floor';
  if (dx * dx + dy * dy < SPRITZ.innerR * SPRITZ.innerR) return 'far';
  return 'wall';
}

/** semiampiezza (gradi) del cuneo della carreggiata attorno alla verticale in basso */
const FLOOR_HALF_DEG = (Math.atan(SPRITZ.floorSlope) * 180) / Math.PI;

/** zone totali: settori angolari x anelli (alcune possono restare vuote, fuori dallo schermo) */
export const REGION_COUNT = SPRITZ.regionSectors * (SPRITZ.regionRings.length + 1);

/**
 * Zona (0..REGION_COUNT-1) di un punto di parete: settore angolare (dal fianco
 * sinistro, su per la volta, al fianco destro) x anello (dal fondo verso lo schermo).
 */
export function regionOf(x: number, y: number): number {
  const S = SPRITZ.regionSectors;
  const deg = (Math.atan2(y - SPRITZ.vpY, x - SPRITZ.vpX) * 180) / Math.PI; // 0 = destra, 90 = giù
  const t = mod(deg + 90, 360); // 0 = su, in senso orario
  const start = 180 + FLOOR_HALF_DEG; // bordo sinistro del cuneo
  const span = 360 - 2 * FLOOR_HALF_DEG;
  const sector = clamp(Math.floor((mod(t - start, 360) / span) * S), 0, S - 1);
  const r = Math.hypot(x - SPRITZ.vpX, y - SPRITZ.vpY);
  let ring = 0;
  while (ring < SPRITZ.regionRings.length && r >= SPRITZ.regionRings[ring]) ring++;
  return ring * S + sector;
}

// ---------------------------------------------------------------- sfondo: roccia, fondo rivestito, strada, ponte

/** rampa della roccia: dal buio alla luce */
const ROCK_RAMP = [0x0, 0xf, 0xe, 0xd] as const;

/** Pixel di roccia nuda (con rete, centine e chiodi) in coordinate prospettiche. */
function wallPixel(x: number, y: number): number {
  const dx = x + 0.5 - SPRITZ.vpX;
  const dy = y + 0.5 - SPRITZ.vpY;
  const r = Math.hypot(dx, dy);
  const u = Math.atan2(dy, dx) * 40; // 40 unità per radiante
  const v = SPRITZ.depthK / r;
  const dudpx = 40 / r; // unità u per pixel a questo raggio
  const dvdpx = SPRITZ.depthK / (r * r);

  // centine (archi d'acciaio) a profondità fisse
  for (const [v0, wv] of [
    [30, 2.2],
    [52, 1.6],
    [78, 1.2],
  ] as const) {
    const t = (v - v0) / wv;
    if (t >= 0 && t <= 1) {
      if (t < 0.18 || t > 0.85) return 0x0;
      // bulloni sull'anima
      if (t > 0.4 && t < 0.62 && mod(u, 9) < dudpx) return 0xd;
      return t < 0.42 ? 0xe : 0xf;
    }
  }

  // chiodi: piastra quadrata chiara con il dado scuro al centro
  const bu = mod(u + (Math.floor(v / 16) % 2) * 10, 20) - 10;
  const bv = mod(v, 16) - 8;
  const pu = Math.abs(bu) / dudpx;
  const pv = Math.abs(bv) / dvdpx;
  if (pu < 1.6 && pv < 1.6) return pu < 0.5 && pv < 0.5 ? 0x0 : bv < 0 ? 0xc : 0xd;

  // roccia: rumore stirato in prospettiva + strati + fratture
  const n = fbm(u * 0.09, v * 0.18, 3) + 0.12 * Math.sin(v * 0.45 + u * 0.06);
  const crack = Math.abs(fbm(u * 0.05 + 7, v * 0.1 + 2, 5) - 0.5);
  if (crack < 0.011) return 0x0;
  const near = clamp((r - SPRITZ.innerR) / 130, 0, 1); // vicino = più luce
  const lamp = clamp((y - 110) / 140, 0, 1) * 0.18; // luce di lavoro della talpa, dal basso
  const L = clamp(-0.12 + n * 0.62 + near * 0.28 + lamp, 0, 0.999);
  let idx = clamp(Math.floor(L * 3 + bayer(x, y)), 0, 3);
  // infiltrazioni d'acqua: colature blu scuro
  if (idx <= 1 && fbm(u * 0.35, v * 0.035 + 3, 9) > 0.7) idx = -1;

  // rete elettrosaldata a chiazze: fili chiari sulla roccia scura, scuri su quella chiara
  if (fbm(u * 0.03, v * 0.05, 13) > 0.56) {
    const onU = mod(u, 6) < dudpx;
    const onV = dvdpx < 1.2 && mod(v, 4) < dvdpx;
    if (onU || onV) return idx >= 2 ? 0xf : 0xd;
  }
  return idx < 0 ? 0x8 : ROCK_RAMP[idx];
}

/** Fondo già rivestito: anelli di calcestruzzo che si perdono nel buio, lampade sulla volta. */
function farPixel(x: number, y: number): number {
  const dx = x + 0.5 - SPRITZ.vpX;
  const dy = y + 0.5 - SPRITZ.vpY;
  const r = Math.hypot(dx, dy);
  if (r > SPRITZ.innerR - 2) return hash2(x, y, 7) < 0.3 ? 0xc : 0xd; // bordo fresco del rivestimento
  if (r < 5) return 0x0;
  const u = Math.atan2(dy, dx) * 40;
  const v = SPRITZ.depthK / r;
  const dudpx = 40 / r;
  const dvdpx = SPRITZ.depthK / (r * r);
  // lampade su due file in alto
  const lv = mod(v, 40) - 20;
  for (const ua of [-1.15 * 40, -1.99 * 40]) {
    if (dvdpx < 3 && Math.abs(u - ua) < dudpx * 1.3 && Math.abs(lv) < dvdpx * 1.3) return Math.abs(lv) < dvdpx * 0.5 ? 0xc : 0x4;
  }
  const B = Math.pow(clamp(1 - (v - 95) / 260, 0, 1), 1.2);
  let idx = clamp(Math.floor(B * 3 + bayer(x, y) * 0.9), 0, 3);
  if (mod(v, 22) < dvdpx) idx = Math.max(0, idx - 1); // giunti tra gli anelli
  return ROCK_RAMP[idx];
}

/** Carreggiata: asfalto, mezzeria tratteggiata gialla, cordoli. */
function floorPixel(x: number, y: number): number {
  const dx = x + 0.5 - SPRITZ.vpX;
  const dy = y + 0.5 - SPRITZ.vpY;
  const half = dy * SPRITZ.floorSlope;
  if (dy < 14) return bayer(x, y) < dy / 28 ? 0xf : 0x0;
  const z = 1000 / dy; // profondità
  if (Math.abs(dx) > half * 0.88) return Math.abs(dx) > half * 0.96 ? 0x0 : 0xe; // cordolo
  if (Math.abs(dx) < dy * 0.025 + 0.5 && mod(z, 6) < 3) return 0x4;
  const light = clamp((dy - 14) / 90, 0, 1);
  return hash2(x, y, 31) < 0.12 + light * 0.1 ? 0xe : bayer(x, y) < light * 0.5 ? 0xf : 0x0;
}

/** Ponte della talpa: corrimano a strisce gialle/nere, grigliato. */
function deckPixel(x: number, y: number): number {
  const ry = y - SPRITZ.deckY;
  if (ry === 0 || ry === 6) return 0x0;
  if (ry < 6) return ((x + ry) >> 2) & 1 ? 0x4 : 0x0;
  if (ry === 7) return 0x3;
  // grigliato: maglie 4x3, più buio verso il basso
  const gx = x % 4 === 0;
  const gy = ry % 3 === 0;
  const dark = clamp((ry - 8) / 70, 0, 1);
  if (gx || gy) return bayer(x, y) < dark ? 0xf : 0xe;
  return bayer(x, y) < 0.15 * (1 - dark) ? 0xf : 0x0;
}

/** Sfondo intero 180x320 (una volta sola, poi in cache come texture). */
function buildView(): IndexImage {
  const data = new Uint8Array(W * H).fill(T);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = viewKind(x, y);
      data[y * W + x] =
        k === 'wall' ? wallPixel(x, y) : k === 'far' ? farPixel(x, y) : k === 'floor' ? floorPixel(x, y) : deckPixel(x, y);
    }
  }
  return { x: 0, y: 0, w: W, h: H, data };
}

// ---------------------------------------------------------------- copertura del cemento

export type CoatState = 0 | 1 | 2;

/**
 * Colore (indice palette, -1 = trasparente) del cemento nel pixel (x, y):
 * 1 = strato sottile a spruzzi (si vede la roccia), 2 = coperto, grigio
 * calcestruzzo con granuli; verso il fondo più scuro (prospettiva).
 */
export function coatColor(x: number, y: number, state: CoatState): number {
  if (state === 0) return -1;
  const h = hash2(x, y, 101);
  if (state === 1) return h < 0.1 ? 0xe : h < 0.5 ? 0xd : -1;
  const far = Math.hypot(x + 0.5 - SPRITZ.vpX, y + 0.5 - SPRITZ.vpY) < 68;
  if (far) return h < 0.18 ? 0xd : h < 0.24 ? 0xf : 0xe;
  return h < 0.1 ? 0xe : h > 0.94 ? 0xc : 0xd;
}

// ---------------------------------------------------------------- sprite piccoli

/** Lancia dello spritz (verticale, la base in basso): ugello, fascia arancio, tubo, valvola rossa, impugnatura. */
const LANCE: SpriteData = (() => {
  const rows = ['..000..', '.0eee0.', '.0fff0.', '0ffeff0', '0fffff0', '.00000.', '.03330.', '.03330.', '.00000.'];
  while (rows.length < 33) rows.push(rows.length % 9 === 0 ? '.0dde0.' : '.0cde0.');
  rows.push('0000000', '0222220', '0244220', '0222220', '0000000');
  while (rows.length < SPRITZ.lanceLen) rows.push(rows.length % 2 ? '.0fff0.' : '.0f0f0.');
  return rows;
})();

const RETICLE_A: SpriteData = ['..ccc..', '.c...c.', 'c.....c', 'c..c..c', 'c.....c', '.c...c.', '..ccc..'];
const RETICLE_B: SpriteData = RETICLE_A.map((r) => r.replace(/c/g, '4'));

const SPLAT: SpriteData[] = [
  ['.......', '...c...', '..cdc..', '.cdddc.', '..cdc..', '...c...', '.......'],
  ['.c...c.', '..d.d..', 'c.ddd.c', '.ddedd.', 'c.ddd.c', '..d.d..', '.c...c.'],
  ['d.....d', '.......', '..e.e..', '...e...', '..e.e..', '.......', 'd.....d'],
];

/** Blocchi di roccia sporgente (più cemento per coprirli). */
const CHUNK_S: SpriteData = [
  '...00000...',
  '..0eeedd0..',
  '.0eddddde0.',
  '0edddcddde0',
  '0eddddddee0',
  '0eeddddeef0',
  '.0feeeeff0.',
  '..0fffff0..',
  '...00000...',
];
const CHUNK_L: SpriteData = [
  '....000000...',
  '..00eeeddd00.',
  '.0eeddddcdde0',
  '0eddddddddde0',
  '0edcddddddee0',
  '0eddddddeeef0',
  '0eeddddeeeff0',
  '.0feeeeefff0.',
  '..00ffffff0..',
  '....000000...',
];

export const SPRITZ_SPRITES = {
  'sz-lance': LANCE,
  'sz-reticle-a': RETICLE_A,
  'sz-reticle-b': RETICLE_B,
  'sz-drop': ['dc', 'ed'],
  'sz-drop-s': ['d'],
  'sz-drip': ['d', 'd', 'e'],
  'sz-splat-0': SPLAT[0],
  'sz-splat-1': SPLAT[1],
  'sz-splat-2': SPLAT[2],
  'sz-chunk-s': CHUNK_S,
  'sz-chunk-l': CHUNK_L,
} satisfies Record<string, SpriteData>;

export const SPLAT_FRAMES = ['sz-splat-0', 'sz-splat-1', 'sz-splat-2'] as const;

/** Crea (una volta) tutte le texture del minigioco; lo sfondo costa ~20 ms solo la prima volta. */
export function registerSpritzSprites(scene: Phaser.Scene): void {
  makeSprites(scene, SPRITZ_SPRITES);
  if (!scene.textures.exists('sz-view')) makeIndexTexture(scene, 'sz-view', buildView());
}

// ---------------------------------------------------------------- griglia di copertura

export interface SpritzChunk {
  /** centro a schermo */
  x: number;
  y: number;
  key: 'sz-chunk-s' | 'sz-chunk-l';
}

export interface WallLayout {
  cols: number;
  rows: number;
  /** strati per coprire la cella (0 = non è parete) */
  need: Uint8Array;
  /** zona della cella (-1 = non è parete) */
  region: Int8Array;
  /** celle di parete per zona */
  regionCells: number[][];
  /** celle di parete nell'ordine in cui si riempiono quando si riprende da un avanzamento salvato */
  order: number[];
  /** celle di parete totali */
  total: number;
  chunks: SpritzChunk[];
}

/**
 * Griglia di copertura per una parete. `seed` (volte completato + mondo)
 * sposta i blocchi sporgenti e le macchie di ripresa: ogni parete nuova è
 * un po' diversa, ma la stessa parete si ricostruisce sempre uguale.
 */
export function buildWallLayout(seed: number): WallLayout {
  const cs = SPRITZ.cell;
  const cols = Math.ceil(W / cs);
  const rows = Math.ceil(H / cs);
  const need = new Uint8Array(cols * rows);
  const region = new Int8Array(cols * rows).fill(-1);
  const regionCells: number[][] = Array.from({ length: REGION_COUNT }, () => []);
  const rnd = rng(seed * 7919 + 17);

  // blocchi sporgenti: posizioni casuali (seed) sulla parete, lontani dal fondo e tra loro
  const chunks: SpritzChunk[] = [];
  for (let tries = 0; tries < 400 && chunks.length < SPRITZ.chunks; tries++) {
    const x = Math.round(10 + rnd() * (W - 20));
    const y = Math.round(SPRITZ.wallTop + 8 + rnd() * (SPRITZ.deckY - SPRITZ.wallTop - 20));
    const r = Math.hypot(x - SPRITZ.vpX, y - SPRITZ.vpY);
    if (r < SPRITZ.chunkMinR || viewKind(x, y) !== 'wall' || viewKind(x, y + 6) !== 'wall') continue;
    if (chunks.some((c) => Math.hypot(c.x - x, c.y - y) < SPRITZ.chunkGap)) continue;
    chunks.push({ x, y, key: r > 110 ? 'sz-chunk-l' : 'sz-chunk-s' });
  }

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const px = cx * cs + cs / 2;
      const py = cy * cs + cs / 2;
      if (cy * cs < SPRITZ.wallTop || py >= SPRITZ.deckY) continue;
      if (viewKind(Math.floor(px), Math.floor(py)) !== 'wall') continue;
      const i = cy * cols + cx;
      const onChunk = chunks.some((c) => {
        const hw = c.key === 'sz-chunk-l' ? 6 : 5;
        const hh = c.key === 'sz-chunk-l' ? 5 : 4;
        return ((px - c.x) / hw) ** 2 + ((py - c.y) / hh) ** 2 <= 1;
      });
      need[i] = onChunk ? SPRITZ.chunkLayers : SPRITZ.layersToCover;
      const reg = regionOf(px, py);
      region[i] = reg;
      regionCells[reg].push(i);
    }
  }

  // ordine di ripresa: rumore a bassa frequenza → la copertura salvata torna a macchie, non a coriandoli
  const score = new Map<number, number>();
  const off = rnd() * 100;
  for (const cells of regionCells) {
    for (const i of cells) {
      const cx = i % cols;
      const cy = Math.floor(i / cols);
      score.set(i, fbm(cx * 0.16 + off, cy * 0.16, 41) + fract(hash2(cx, cy, seed) * 7) * 0.12);
    }
  }
  const order = [...score.keys()].sort((a, b) => (score.get(a) ?? 0) - (score.get(b) ?? 0));

  return { cols, rows, need, region, regionCells, order, total: order.length, chunks };
}
