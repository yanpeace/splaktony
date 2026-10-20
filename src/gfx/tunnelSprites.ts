import Phaser from 'phaser';
import { PALETTE_INT } from '../config/palette';

/**
 * Sprite del MONDO 2: l'interno della galleria, generati da codice (Sweetie 16,
 * mai l'indice 16 rosa). Chiavi texture con prefisso `tw-`.
 *
 * Lo sfondo è un "ray-cast" fatto una volta sola: per ogni pixel si lancia un
 * raggio dall'occhio verso il fondo della galleria e si guarda cosa colpisce
 * (volta circolare, carreggiata in asfalto con la segnaletica, cordoli e
 * marciapiedi di servizio rialzati, canaletta con griglia, tubo di ventilazione
 * appeso alla volta, nastro trasportatore sulla parete destra). Le coordinate
 * "mondo" sono in px a profondità z = 1 (Z = 100): a schermo
 *   x = 90 + 100 * X / Z,   y = 150 + 100 * Y / Z
 * quindi il punto di fuga è (90, 150). La luce viene dalle barre a neon
 * (segmenti lungo l'asse) e, calda, dalle lampade di lavoro della talpa; la
 * luminosità è quantizzata sulle rampe della palette con un retino di Bayer.
 *
 * Per ogni neon c'è anche una "maschera d'ombra": i soli pixel che cambiano
 * quando quel neon è spento (sfondo ricalcolato senza il suo contributo), così
 * il neon che si spegne cambia davvero la luce sotto di lui.
 */

/** trasparente negli IndexImage */
const T = 255;

/** Geometria della galleria (coordinate mondo, vedi sopra). */
export const TW = {
  vpX: 90,
  vpY: 150,
  f: 100,
  /** raggio della volta e quota del suo centro (Y cresce verso il basso, occhio a Y = 0) */
  r: 120,
  yc: 60,
  /** quota del pavimento */
  yf: 142,
  /** profondità della talpa: oltre c'è solo la macchina */
  tbmZ: 350,
  /** bordo superiore del terreno di gioco */
  groundY: 292,
  width: 180,
  height: 320,
} as const;

/** Proiezione mondo → schermo (non arrotondata). */
export function proj(X: number, Y: number, Z: number): { x: number; y: number } {
  return { x: TW.vpX + (TW.f * X) / Z, y: TW.vpY + (TW.f * Y) / Z };
}

/**
 * Talpa (fresa meccanica) a schermo: centro, raggio dello scudo e della testa, ultima riga visibile.
 * Lo scudo coincide con la sezione della volta (r 120 a Z 350 = 34 px); la testa fresante la
 * riempie quasi tutta (28 px = ~98 unità, ~4.9 m di raggio), resta solo l'anello dello scudo.
 */
export const TBM = {
  cx: 90,
  cy: Math.round(TW.vpY + (TW.f * TW.yc) / TW.tbmZ), // 167
  shieldR: 34,
  cutterR: 28,
  bottom: Math.floor(TW.vpY + (TW.f * TW.yf) / TW.tbmZ), // 190
} as const;

const DUCT = { x: -22, y: -47, r: 9, zEnd: TW.tbmZ - 4 } as const;
/** nastro trasportatore sulla parete destra: piano superiore e fianco verso l'asse */
export const BELT = { x0: 84, x1: 104, y: 50, h: 8 } as const;
/**
 * Strada (mondo): carreggiata a due corsie per |X| < side, cordolo alto curbH
 * e marciapiede di servizio fino alla volta; linee di margine a |X| = edge,
 * mezzeria tratteggiata a X = 0 (trattini di dashL/2 ogni dashL), centro delle
 * corsie a ±lane; canaletta con griglia a sinistra contro il cordolo; oltre
 * workZ (verso la talpa) le corsie sono provvisorie e la segnaletica è gialla.
 */
export const ROAD = {
  side: 62,
  curbH: 5,
  edge: 51,
  lane: 25,
  dashL: 16,
  gutter0: -61,
  gutter1: -54,
  workZ: 225,
} as const;

// ---------------------------------------------------------------- neon

export interface Lamp {
  /** posizione dell'asse della barra (mondo) */
  X: number;
  Y: number;
  z0: number;
  z1: number;
}
const LAMP_LEN = 30;
const LAMP_A = 0.52; // ~30° dalla chiave della volta
const LAMP_RR = TW.r - 5;
export const LAMPS: readonly Lamp[] = (
  [
    [-1, 70],
    [1, 110],
    [-1, 150],
    [1, 190],
    [-1, 230],
    [1, 270],
    [-1, 310],
  ] as const
).map(([side, z]) => ({
  X: side * LAMP_RR * Math.sin(LAMP_A),
  Y: TW.yc - LAMP_RR * Math.cos(LAMP_A),
  z0: z,
  z1: z + LAMP_LEN,
}));

const LAMP_I = 1.15;
/** attenuazione lungo l asse (bande nette) e in sezione */
const LAMP_KZ = 26;
const LAMP_KP = 190;
const AMBIENT = 0.035;
/** luce calda delle lampade di lavoro della talpa */
const WARM = { X: 0, Y: -4, Z: TW.tbmZ - 14, i: 1.7, k: 60 } as const;

// ---------------------------------------------------------------- utility

/** Matrice di Bayer 4x4 per il retino. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x: number, y: number) => (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
/** rumore deterministico 0..1 per pixel/coordinata */
function hash(a: number, b: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const mod = (a: number, m: number) => ((a % m) + m) % m;

/** Immagine a indici di palette (255 = trasparente) con l'angolo in alto a sinistra in (x, y). */
export interface IndexImage {
  x: number;
  y: number;
  w: number;
  h: number;
  data: Uint8Array;
}

function image(x: number, y: number, w: number, h: number): IndexImage {
  return { x, y, w, h, data: new Uint8Array(w * h).fill(T) };
}

/** Da righe di caratteri (0-f, '.') a IndexImage. */
function fromRows(rows: readonly string[], x = 0, y = 0): IndexImage {
  const img = image(x, y, rows[0].length, rows.length);
  rows.forEach((r, j) => {
    for (let i = 0; i < r.length; i++) if (r[i] !== '.') img.data[j * img.w + i] = parseInt(r[i], 16);
  });
  return img;
}

/** Crea (una volta) una texture da un IndexImage, scrivendo direttamente i pixel. */
export function makeIndexTexture(scene: Phaser.Scene, key: string, img: IndexImage): string {
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, img.w, img.h);
  if (!tex) throw new Error(`tunnelSprites: impossibile creare "${key}"`);
  const ctx = tex.getContext();
  const id = ctx.createImageData(img.w, img.h);
  for (let i = 0; i < img.data.length; i++) {
    const c = img.data[i];
    if (c === T) continue;
    const rgb = PALETTE_INT[c];
    id.data[i * 4] = (rgb >> 16) & 255;
    id.data[i * 4 + 1] = (rgb >> 8) & 255;
    id.data[i * 4 + 2] = rgb & 255;
    id.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  tex.refresh();
  return key;
}

/** Copia uno sprite a righe dentro un IndexImage (coordinate dell'immagine). */
function blitRows(dst: IndexImage, rows: readonly string[], ox: number, oy: number): void {
  rows.forEach((r, j) => {
    for (let i = 0; i < r.length; i++) {
      if (r[i] === '.') continue;
      const x = ox + i;
      const y = oy + j;
      if (x < 0 || y < 0 || x >= dst.w || y >= dst.h) continue;
      dst.data[y * dst.w + x] = parseInt(r[i], 16);
    }
  });
}

// ---------------------------------------------------------------- font 3x5 per cartelli e numeri

const MINI: Record<string, readonly string[]> = {
  '0': ['111', '1.1', '1.1', '1.1', '111'],
  '1': ['.1.', '11.', '.1.', '.1.', '111'],
  '2': ['111', '..1', '111', '1..', '111'],
  '3': ['111', '..1', '.11', '..1', '111'],
  '4': ['1.1', '1.1', '111', '..1', '..1'],
  '5': ['111', '1..', '111', '..1', '111'],
  '6': ['111', '1..', '111', '1.1', '111'],
  '7': ['111', '..1', '.1.', '.1.', '.1.'],
  '8': ['111', '1.1', '111', '1.1', '111'],
  '9': ['111', '1.1', '111', '..1', '111'],
  M: ['1...1', '11.11', '1.1.1', '1...1', '1...1'],
  ' ': ['.', '.', '.', '.', '.'],
};

/** Testo in font 3x5 come righe con il carattere `c`. */
function miniText(text: string, c: string): string[] {
  const rows = ['', '', '', '', ''];
  [...text].forEach((ch, k) => {
    const g = MINI[ch] ?? MINI[' '];
    for (let j = 0; j < 5; j++) rows[j] += (k > 0 ? '.' : '') + g[j].replace(/1/g, c);
  });
  return rows;
}

// ---------------------------------------------------------------- cartelli appesi (rivolti verso chi guarda)

/** Cartello verde di uscita di emergenza: freccia + omino che corre. */
const EXIT_SIGN: readonly string[] = [
  '0000000000000000000',
  '0555555555555555550',
  '0666666666666cc6660',
  '06c6666666cccc66660',
  '0c6666666c6cc6c6660',
  '0ccccc666666cc66660',
  '0c66666666666c6c660',
  '06c66666666c6666c60',
  '0666666666c666666c0',
  '0666666666666666660',
  '0000000000000000000',
];

function distanceSign(): string[] {
  const txt = miniText('250 M', 'c');
  const w = txt[0].length + 4;
  const rows: string[] = ['0'.repeat(w), '0' + 'a'.repeat(w - 2) + '0'];
  for (const r of txt) rows.push('09' + r.replace(/\./g, '9') + '90');
  rows.push('0' + '9'.repeat(w - 2) + '0', '0'.repeat(w));
  return rows;
}

/** Cartelli appesi alla volta: centro in mondo, sprite già in scala (piatti verso chi guarda). */
export const SIGNS = {
  exit: { X: -62, Y: -12, Z: 125, rows: EXIT_SIGN },
  dist: { X: 60, Y: -13, Z: 150, rows: distanceSign() },
} as const;

/** angolo in alto a sinistra a schermo di un cartello appeso */
export function signTopLeft(s: { X: number; Y: number; Z: number; rows: readonly string[] }): { x: number; y: number } {
  const p = proj(s.X, s.Y, s.Z);
  return { x: Math.round(p.x - s.rows[0].length / 2), y: Math.round(p.y - s.rows.length / 2) };
}

// ---------------------------------------------------------------- decorazioni dipinte/appese sulle pareti

interface WallDecal {
  side: -1 | 1;
  z0: number;
  z1: number;
  y0: number;
  y1: number;
  /** colore (rampa di luce) per u, v in 0..1; -1 = niente */
  mat: (u: number, v: number) => number;
}

const ringNumber = (n: number) => miniText(String(n), '1');
function decalFromRows(rows: readonly string[], m: number) {
  return (u: number, v: number) => {
    const i = Math.min(rows[0].length - 1, Math.floor(u * rows[0].length));
    const j = Math.min(rows.length - 1, Math.floor(v * rows.length));
    return rows[j][i] === '.' ? -1 : m;
  };
}

// ---------------------------------------------------------------- materiali e rampe di luce

const enum M {
  Far,
  Conc,
  Floor,
  Asphalt,
  YPaint,
  Reflector,
  Water,
  Duct,
  Belt,
  Steel,
  Red,
  Cable,
  CableRed,
  Locker,
  Paint,
  Rock,
}

/** livello di luce 0..4 → indice di palette, per materiale */
const RAMP: Record<number, readonly number[]> = {
  [M.Far]: [0, 0, 0, 0, 0],
  [M.Conc]: [0, 15, 14, 13, 12],
  [M.Floor]: [0, 15, 14, 13, 12],
  [M.Asphalt]: [0, 15, 15, 15, 14],
  [M.YPaint]: [1, 3, 4, 4, 4],
  [M.Reflector]: [2, 3, 4, 4, 4],
  [M.Water]: [0, 0, 8, 7, 11],
  [M.Duct]: [2, 3, 3, 4, 4],
  [M.Belt]: [0, 0, 15, 15, 14],
  [M.Steel]: [0, 15, 14, 13, 12],
  [M.Red]: [0, 1, 2, 2, 3],
  [M.Cable]: [0, 0, 0, 15, 14],
  [M.CableRed]: [0, 1, 1, 2, 3],
  [M.Locker]: [0, 15, 14, 13, 13],
  [M.Paint]: [15, 14, 13, 12, 12],
  [M.Rock]: [0, 1, 15, 14, 13],
};
/** materiali che con la luce calda dominante virano all'arancio/giallo nei livelli alti */
const WARMABLE = new Set<number>([M.Conc, M.Floor, M.Steel]);
const WARM_RAMP = [0, 15, 14, 3, 4];

const WALL_DECALS: readonly WallDecal[] = [
  // armadio rosso con estintore, parete sinistra in basso
  {
    side: -1,
    z0: 138,
    z1: 152,
    y0: 92,
    y1: 124,
    mat: (u, v) => (v < 0.12 ? M.Paint : u < 0.08 || u > 0.92 || v > 0.94 ? M.Cable : u > 0.3 && u < 0.7 && v > 0.3 && v < 0.85 ? M.Steel : M.Red),
  },
  // armadietti grigi, parete destra in basso
  {
    side: 1,
    z0: 236,
    z1: 292,
    y0: 88,
    y1: 132,
    mat: (u, v) => (v > 0.95 || mod(u * 5, 1) < 0.12 ? M.Cable : v > 0.4 && v < 0.48 && mod(u * 5, 1) > 0.75 ? M.Paint : M.Locker),
  },
  // numeri degli anelli, parete sinistra
  { side: -1, z0: 154, z1: 176, y0: -3, y1: 9, mat: decalFromRows(ringNumber(46), M.Paint) },
  { side: -1, z0: 214, z1: 236, y0: -3, y1: 9, mat: decalFromRows(ringNumber(48), M.Paint) },
  { side: 1, z0: 176, z1: 158, y0: 10, y1: 22, mat: decalFromRows(ringNumber(47), M.Paint) },
];

/** pozzanghere sull'asfalto: centro (X, Z) e semiassi */
const PUDDLES: readonly [number, number, number, number][] = [
  [14, 132, 8, 12],
  [-40, 205, 6, 13],
  [-20, 290, 6, 15],
];

const RING_L = 30; // lunghezza di un anello di conci (mondo)
const SEGMENTS = 7; // conci per anello (sfalsati di mezzo concio tra anelli vicini)
const RIB_L = 9; // passo della spirale del tubo flessibile
const SLAB_L = 45; // giunti delle lastre del marciapiede
const CURB_L = 15; // blocchi del cordolo
/** riflesso lucido dei neon sull'asfalto: banda sotto la lampada, spostata verso chi guarda */
const SHEEN = { i: 1.0, w: 26, kz: 16, near: 16, far: 4 } as const;

// ---------------------------------------------------------------- ray-cast dello sfondo

const enum K {
  None,
  Wall,
  Floor,
  Curb,
  Walk,
  Duct,
  BeltTop,
  BeltFront,
  Far,
}

export interface TunnelBackdrop {
  /** sfondo completo 180x320 */
  bg: IndexImage;
  /** per ogni neon: i pixel dello sfondo come sono con quel neon spento */
  shades: IndexImage[];
  /** per ogni neon: barra accesa, attenuata, spenta (stesso riquadro) */
  bars: { on: IndexImage; dim: IndexImage; off: IndexImage }[];
}

export function buildBackdrop(): TunnelBackdrop {
  const W: number = TW.width;
  const H: number = TW.groundY; // righe 0..291 calcolate col ray-cast; il terreno è disegnato a parte
  const N = W * H;
  const nL = LAMPS.length;
  const kind = new Uint8Array(N);
  const mat = new Uint8Array(N);
  const alb = new Float32Array(N);
  const off = new Int8Array(N);
  const emis = new Uint8Array(N).fill(T);
  const base = new Float32Array(N);
  const warm = new Float32Array(N);
  const lamp = new Float32Array(N * nL);
  const keyA = new Int32Array(N).fill(-99999); // anello / costola / lastra
  const keyB = new Int32Array(N).fill(-99999); // concio

  const { f, r, yc, yf, tbmZ } = TW;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const ux = (x + 0.5 - TW.vpX) / f;
      const uy = (y + 0.5 - TW.vpY) / f;
      const a = ux * ux + uy * uy;
      // volta
      const b = -2 * uy * yc;
      const c = yc * yc - r * r;
      let t = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
      let k: K = K.Wall;
      // carreggiata (Y = yf), cordolo e marciapiede rialzato (Y = yf - curbH)
      if (uy > 0) {
        let tg = yf / uy;
        let kg: K = K.Floor;
        if (Math.abs(ux * tg) >= ROAD.side) {
          const tc = ROAD.side / Math.abs(ux);
          if (uy * tc >= yf - ROAD.curbH) {
            tg = tc;
            kg = K.Curb;
          } else {
            tg = (yf - ROAD.curbH) / uy;
            kg = K.Walk;
          }
        }
        if (tg < t) {
          t = tg;
          k = kg;
        }
      }
      // tubo di ventilazione
      const bd = -2 * (ux * DUCT.x + uy * DUCT.y);
      const cd = DUCT.x * DUCT.x + DUCT.y * DUCT.y - DUCT.r * DUCT.r;
      const dd = bd * bd - 4 * a * cd;
      if (dd >= 0) {
        const t1 = (-bd - Math.sqrt(dd)) / (2 * a);
        if (t1 > 0 && t1 < t && t1 < DUCT.zEnd) {
          t = t1;
          k = K.Duct;
        }
      }
      // nastro: piano superiore e fianco
      if (uy > 0) {
        const tb = BELT.y / uy;
        const bx = ux * tb;
        if (tb < t && bx >= BELT.x0 && bx <= BELT.x1) {
          t = tb;
          k = K.BeltTop;
        }
      }
      if (ux > 0) {
        const tf = BELT.x0 / ux;
        const by = uy * tf;
        if (tf < t && by >= BELT.y && by <= BELT.y + BELT.h) {
          t = tf;
          k = K.BeltFront;
        }
      }
      if (t > tbmZ) k = K.Far;

      const X = ux * t;
      const Y = uy * t;
      const Z = t;
      kind[i] = k;
      let nx = 0;
      let ny = -1;
      let m: number = M.Far;
      let al = 1;
      switch (k) {
        case K.Wall: {
          nx = -X / r;
          ny = (yc - Y) / r;
          m = M.Conc;
          const ring = Math.floor(Z / RING_L);
          keyA[i] = ring;
          const alpha = Math.atan2(X, yc - Y); // 0 in chiave, ± verso i lati
          keyB[i] = Math.floor((alpha / (Math.PI * 2)) * SEGMENTS + (ring & 1) * 0.5 + 100);
          al = 0.95 + 0.1 * hash(Math.floor(Z / 6), Math.floor(alpha * 40));
          if (Y > 118) al *= 0.82; // sporco in basso
          if (Y > 128) al *= 0.72; // zoccolo scuro sopra il marciapiede
          // cavi sulla parete sinistra, appesi tra le staffe
          if (X < 0) {
            const u = mod(Z, 40) / 40;
            const sag = (24 * u * (1 - u)) / r;
            const hw = Math.max(1, (0.5 * Z) / f) / r;
            const cables: [number, number][] = [
              [-1.2, M.Cable],
              [-1.235, M.CableRed],
              [-1.27, M.Cable],
            ];
            for (const [a0, cm] of cables) if (Math.abs(alpha - (a0 - sag)) < hw) m = cm;
            if (mod(Z, 40) < Math.max(2, (0.7 * Z) / f) && alpha < -1.17 && alpha > -1.33) m = M.Steel;
          }
          // staffe del nastro sulla parete destra
          if (X > 0 && Y > 46 && Y < BELT.y + BELT.h && mod(Z, 40) < Math.max(2.5, (0.7 * Z) / f)) m = M.Steel;
          for (const d of WALL_DECALS) {
            if (Math.sign(X) !== d.side) continue;
            const zl = Math.min(d.z0, d.z1);
            const zh = Math.max(d.z0, d.z1);
            if (Z < zl || Z > zh || Y < d.y0 || Y > d.y1) continue;
            const dm = d.mat((Z - d.z0) / (d.z1 - d.z0), (Y - d.y0) / (d.y1 - d.y0));
            if (dm >= 0) m = dm;
          }
          break;
        }
        case K.Floor: {
          // asfalto: grana leggera a chiazze di 2 unità, niente rumore per pixel
          const ax = Math.abs(X);
          const dzdy = (Z * Z) / (yf * f);
          const px = (0.5 * Z) / f; // mezzo pixel in unità mondo
          m = M.Asphalt;
          const hg = hash(Math.floor(X / 2), Math.floor(Z / 2));
          al = hg > 0.95 ? 1.15 : hg < 0.05 ? 0.7 : 0.9;
          const paint = Z > ROAD.workZ ? M.YPaint : M.Paint;
          // linee di margine continue
          if (Math.abs(ax - ROAD.edge) < Math.max(1, px)) {
            m = paint;
            al = 1;
          }
          // mezzeria tratteggiata (i trattini si accorciano da soli in prospettiva)
          if (ax < Math.max(1, px) && mod(Z, ROAD.dashL) < ROAD.dashL / 2) {
            m = paint;
            al = 1;
          }
          // catarifrangenti lungo i margini, verso l'interno delle corsie
          if (Z < 300 && Math.abs(ax - (ROAD.edge - 4)) < Math.max(0.9, px) && mod(Z + 6, 24) < Math.max(1.4, dzdy * 0.9)) {
            m = M.Reflector;
            al = 1;
          }
          // canaletta con griglia contro il cordolo sinistro
          if (X < ROAD.gutter1 && X > ROAD.gutter0) {
            m = Math.abs(X - ROAD.gutter1) < Math.max(1.2, px) || Math.abs(X - ROAD.gutter0) < Math.max(1.2, px) ? M.Steel : M.Water;
            if (m === M.Water && mod(Z, 8) < Math.max(2.5, px * 2)) m = M.Steel;
            al = m === M.Water ? 0.8 : 0.9;
          }
          for (const [px0, pz0, rx, rz] of PUDDLES) {
            if (((X - px0) / rx) ** 2 + ((Z - pz0) / rz) ** 2 < 1) {
              m = M.Water;
              al = 0.85;
            }
          }
          break;
        }
        case K.Curb: {
          // faccia verticale del cordolo, rivolta verso l'asse
          nx = -Math.sign(X);
          ny = 0;
          m = M.Conc;
          al = 0.9;
          keyA[i] = Math.floor(Z / CURB_L);
          break;
        }
        case K.Walk: {
          // marciapiede di servizio in cemento a lastre, spigolo del cordolo più chiaro
          const ax = Math.abs(X);
          const px = (0.5 * Z) / f;
          m = M.Floor;
          al = 1.05 + 0.12 * hash(Math.floor(X / 3), Math.floor(Z / 3));
          keyA[i] = Math.floor(Z / SLAB_L);
          if (ax < ROAD.side + Math.max(1.5, px)) {
            m = M.Paint;
            al = 1.3;
          }
          if (ax > 86) al *= 0.75; // angolo con la parete
          break;
        }
        case K.Duct: {
          nx = (X - DUCT.x) / DUCT.r;
          ny = (Y - DUCT.y) / DUCT.r;
          m = M.Duct;
          al = 2.4;
          keyA[i] = Math.floor(Z / RIB_L);
          // fascia di giunzione ogni 60
          if (mod(Z, 60) < Math.max(2, (0.8 * Z) / f)) m = M.Steel;
          if (m === M.Steel) al = 1;
          break;
        }
        case K.BeltTop: {
          m = M.Belt;
          const h = hash(Math.floor(X / 2.5), Math.floor(Z / 3));
          if (h > 0.83) m = M.Rock;
          al = 1;
          break;
        }
        case K.BeltFront: {
          nx = -1;
          ny = 0;
          m = M.Steel;
          if (Y > BELT.y + 2 && mod(Z, 12) < Math.max(2, (0.6 * Z) / f)) m = M.Cable; // rulli
          al = 0.8;
          break;
        }
        default:
          m = M.Far;
      }
      mat[i] = m;
      alb[i] = al;
      if (k === K.Far) continue;

      // luce: ambiente + talpa (calda) + neon
      const amb = AMBIENT * (1 + 0.6 * (1 - Z / tbmZ));
      let wdx = WARM.X - X;
      let wdy = WARM.Y - Y;
      const wdz = WARM.Z - Z;
      const wd = Math.hypot(wdx, wdy, wdz) + 0.001;
      wdx /= wd;
      wdy /= wd;
      const wl = 0.3 + 0.7 * Math.max(0, nx * wdx + ny * wdy + 0);
      const wv = (WARM.i * wl) / (1 + (wd / WARM.k) ** 2);
      base[i] = amb + wv;
      warm[i] = wv;
      for (let l = 0; l < nL; l++) {
        const L = LAMPS[l];
        const qz = Z < L.z0 ? L.z0 : Z > L.z1 ? L.z1 : Z;
        const dx = L.X - X;
        const dy = L.Y - Y;
        const dz = qz - Z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.001;
        const ndl = (nx * dx + ny * dy) / d;
        const dp2 = dx * dx + dy * dy;
        let li = (LAMP_I * (0.25 + 0.75 * Math.max(0, ndl))) * Math.exp(-((dz / LAMP_KZ) ** 2)) / (1 + dp2 / (LAMP_KP * LAMP_KP));
        if (k === K.Floor) {
          // asfalto un po' lucido: banda chiara sotto la lampada, allungata verso chi guarda
          const zs = Z < L.z0 - SHEEN.near ? L.z0 - SHEEN.near : Z > L.z1 - SHEEN.far ? L.z1 - SHEEN.far : Z;
          const sh = SHEEN.i * Math.exp(-(((X - L.X * 0.8) / SHEEN.w) ** 2)) * Math.exp(-(((zs - Z) / SHEEN.kz) ** 2));
          li += m === M.Asphalt || m === M.Water ? sh : 0;
        }
        lamp[l * N + i] = li;
      }
    }
  }

  // giunti: dove la chiave cambia tra pixel vicini dello stesso tipo, un livello più scuro
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const k = kind[i];
      if (k !== K.Wall && k !== K.Duct && k !== K.Walk && k !== K.Curb) continue;
      if (keyA[i] === -99999) continue;
      let joint = false;
      const nb = [x + 1 < W ? i + 1 : -1, y + 1 < H ? i + W : -1];
      for (const j of nb) {
        if (j < 0 || kind[j] !== k || keyA[j] === -99999) continue;
        const da = Math.abs(keyA[j] - keyA[i]);
        if (da === 1) joint = true;
        if (k === K.Wall && da === 0 && Math.abs(keyB[j] - keyB[i]) === 1) joint = true;
      }
      if (joint) off[i] = k === K.Duct ? -1 : -1;
    }
  }

  // cartelli appesi alla volta (emissivi) con i ganci
  const plot = (x: number, y: number, c: number) => {
    if (x >= 0 && y >= 0 && x < W && y < H) emis[y * W + x] = c;
  };
  for (const s of [SIGNS.exit, SIGNS.dist]) {
    const p = signTopLeft(s);
    s.rows.forEach((row, j) => {
      for (let q = 0; q < row.length; q++) if (row[q] !== '.') plot(p.x + q, p.y + j, parseInt(row[q], 16));
    });
    const wl = s.rows[0].length;
    for (let j = 1; j <= 7; j++) {
      plot(p.x + 2, p.y - j, 14);
      plot(p.x + wl - 3, p.y - j, 14);
    }
  }

  // quantizzazione (anche senza un neon, per le maschere d'ombra)
  const color = (i: number, x: number, y: number, skip: number): number => {
    if (emis[i] !== T) return emis[i];
    const m = mat[i];
    if (m === M.Far) return 0;
    let e = base[i] + (m === M.Duct ? 0.3 : 0);
    for (let l = 0; l < nL; l++) if (l !== skip) e += lamp[l * N + i];
    const v = 1 - Math.exp(-1.2 * e * alb[i]);
    const q = v * 5.4 - 0.9 + off[i];
    const fl = Math.floor(q);
    const lvl = clamp(fl + (q - fl > bayer(x, y) ? 1 : 0), 0, 4);
    if (WARMABLE.has(m) && warm[i] > 0.55 * e && lvl >= 3) return WARM_RAMP[lvl];
    return RAMP[m][lvl];
  };

  const bg = image(0, 0, W, TW.height);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) bg.data[y * W + x] = color(y * W + x, x, y, -1);
  drawGround(bg);

  const shades: IndexImage[] = [];
  for (let l = 0; l < nL; l++) {
    const tmp = new Uint8Array(N).fill(T);
    let x0 = W;
    let y0 = H;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (lamp[l * N + i] < 0.01) continue;
        const c = color(i, x, y, l);
        if (c === bg.data[i]) continue;
        tmp[i] = c;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) {
      shades.push(image(0, 0, 1, 1));
      continue;
    }
    const s = image(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) s.data[(y - y0) * s.w + (x - x0)] = tmp[y * W + x];
    shades.push(s);
  }

  return { bg, shades, bars: LAMPS.map(neonBar) };
}

/** Terreno di gioco: asfalto compatto con bordo netto (y 292..319), la segnaletica prosegue verso chi guarda. */
function drawGround(bg: IndexImage): void {
  const W = bg.w;
  const g0 = TW.groundY;
  for (let y = g0; y < TW.height; y++) {
    const Z = (TW.yf * TW.f) / (y + 0.5 - TW.vpY);
    for (let x = 0; x < W; x++) {
      const dy = y - g0;
      let c: number;
      if (dy === 0) c = 13;
      else if (dy === 1) c = 14;
      else if (dy <= 3) c = (Math.floor((x + dy) / 4) & 1) === 0 ? 4 : 0; // fascia di sicurezza gialla/nera
      else if (dy === 4) c = 0;
      else {
        const X = ((x + 0.5 - TW.vpX) * Z) / TW.f;
        const ax = Math.abs(X);
        const h = hash(x, y);
        if (ax >= ROAD.side + 1.2) {
          // marciapiede
          c = h > 0.85 ? 13 : h < 0.08 ? 15 : 14;
          if (mod(Z, SLAB_L) < 0.6) c = 15;
        } else if (ax >= ROAD.side - 0.6) c = 13; // spigolo del cordolo
        else {
          c = h > 0.92 ? 14 : h < 0.05 ? 0 : 15;
          if (Math.abs(ax - ROAD.edge) < 0.9) c = 12;
          if (ax < 0.95 && mod(Z, ROAD.dashL) < ROAD.dashL / 2) c = 12;
          if (X < ROAD.gutter1 && X > ROAD.gutter0) c = Math.abs(X - ROAD.gutter1) < 1 || Math.abs(X - ROAD.gutter0) < 1 || mod(Z, 8) < 2.5 ? 14 : 0;
        }
        if (y >= TW.height - 2) c = 0;
      }
      bg.data[y * W + x] = c;
    }
  }
}

/** Barra a neon lungo l'asse (cilindro sottile) nei 3 stati. */
function neonBar(L: Lamp): { on: IndexImage; dim: IndexImage; off: IndexImage } {
  const zm = (L.z0 + L.z1) / 2;
  const rb = Math.max(2, (0.6 * zm) / TW.f);
  const p0 = proj(L.X, L.Y, L.z0);
  const p1 = proj(L.X, L.Y, L.z1);
  const pad = Math.ceil((rb * TW.f) / L.z0) + 1;
  const x0 = Math.max(0, Math.floor(Math.min(p0.x, p1.x)) - pad);
  const x1 = Math.min(TW.width - 1, Math.ceil(Math.max(p0.x, p1.x)) + pad);
  const y0 = Math.max(0, Math.floor(Math.min(p0.y, p1.y)) - pad);
  const y1 = Math.min(TW.groundY - 1, Math.ceil(Math.max(p0.y, p1.y)) + pad);
  const mk = () => image(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  const on = mk();
  const dim = mk();
  const offI = mk();
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const ux = (x + 0.5 - TW.vpX) / TW.f;
      const uy = (y + 0.5 - TW.vpY) / TW.f;
      const a = ux * ux + uy * uy;
      const b = -2 * (ux * L.X + uy * L.Y);
      const c = L.X * L.X + L.Y * L.Y - rb * rb;
      const d = b * b - 4 * a * c;
      if (d < 0) continue;
      const t = (-b - Math.sqrt(d)) / (2 * a);
      if (t < L.z0 || t > L.z1) continue;
      const s = Math.abs(ux * L.Y - uy * L.X) / Math.sqrt(a) / rb; // 0 al centro, 1 sul bordo
      const cap = t < L.z0 + 2.5 || t > L.z1 - 2.5;
      const j = (y - y0) * on.w + (x - x0);
      if (cap) {
        on.data[j] = 14;
        dim.data[j] = 15;
        offI.data[j] = 15;
      } else if (s < 0.5) {
        on.data[j] = 12;
        dim.data[j] = 13;
        offI.data[j] = 14;
      } else {
        on.data[j] = 11;
        dim.data[j] = 14;
        offI.data[j] = 15;
      }
    }
  }
  return { on, dim, off: offI };
}

// ---------------------------------------------------------------- talpa

/** Scudo della talpa: anello giallo con strisce di pericolo e fari; dentro, il bordo scuro attorno alla testa. */
export function tbmShield(): IndexImage {
  const R = TBM.shieldR;
  const x0 = TBM.cx - R;
  const y0 = TBM.cy - R;
  const img = image(x0, y0, R * 2 + 1, TBM.bottom - y0 + 1);
  for (let j = 0; j < img.h; j++) {
    for (let i = 0; i < img.w; i++) {
      const dx = x0 + i - TBM.cx;
      const dy = y0 + j - TBM.cy;
      const rr = Math.hypot(dx, dy);
      let c = T;
      if (rr > R + 0.4) c = T;
      else if (rr > R - 0.6) c = 0;
      else if (rr > 30) {
        c = dy < 4 ? 4 : 3;
        if (dx > 20 && dy > -10) c = 3;
        if (dy > 18) c = 2;
        if (dy < -25 && mod(dx - dy, 6) < 3) c = 0; // strisce di pericolo in alto
        if (rr > R - 1.6 && dy < -8 && dx < 0) c = 12; // riflesso
      } else c = 0; // fessura tra scudo e testa (la testa copre il resto)
      img.data[j * img.w + i] = c;
    }
  }
  // fari di lavoro ai lati (bianchi, fissi)
  const lamps = [
    [-31, 4],
    [31, 4],
  ];
  for (const [lx, ly] of lamps) {
    blitRows(img, ['0000', '0cb0', '0bb0', '0000'], TBM.cx + lx - 1 - x0, TBM.cy + ly - 1 - y0);
  }
  return img;
}

/** posizione (angolo in alto a sinistra) dello scudo e della testa */
export const TBM_SHIELD_XY = { x: TBM.cx - TBM.shieldR, y: TBM.cy - TBM.shieldR } as const;
export const TBM_CUTTER_XY = { x: TBM.cx - TBM.cutterR, y: TBM.cy - TBM.cutterR } as const;
export const CUTTER_FRAMES = 4;
const SPOKES = 6;

/** Testa fresante, frame k di CUTTER_FRAMES (rotazione di 1/SPOKES di giro in tutto il ciclo). */
export function tbmCutter(frame: number): IndexImage {
  const R = TBM.cutterR;
  const n = R * 2 + 1;
  const img = image(0, 0, n, n);
  const rot = (frame * (Math.PI * 2)) / SPOKES / CUTTER_FRAMES;
  const step = (Math.PI * 2) / SPOKES;
  const k = R / 23; // i dettagli erano disegnati per un raggio di 23 px
  const rows = TBM.bottom - (TBM.cy - R) + 1; // sotto il pavimento non si vede
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < n; i++) {
      const dx = i - R;
      const dy = j - R;
      const rr = Math.hypot(dx, dy);
      if (rr > R + 0.3) continue;
      const phi = Math.atan2(dy, dx) - rot;
      // angolo relativo al raggio più vicino (-step/2..step/2)
      const rel = mod(phi + step / 2, step) - step / 2;
      const perp = rr * Math.sin(rel);
      const along = rr * Math.cos(rel);
      // denti sul bordo: 18 denti che girano con la testa
      const tooth = mod((phi / (Math.PI * 2)) * 18, 1);
      let c: number;
      if (rr > R - 1.4) c = tooth < 0.5 ? 13 : 0;
      else if (rr > R - 2.6) c = tooth < 0.5 ? 14 : 15;
      else if (rr > R - 3.4) c = 0;
      else {
        // faccia in acciaio, ombreggiata in basso a destra (luce fissa)
        c = dx * 0.4 + dy > 9 ? 15 : 14;
        // aperture per lo smarino tra un raggio e l'altro
        const relMid = mod(phi, step) - step / 2;
        if (rr > 8 * k && rr < R - 5 && Math.abs(rr * Math.sin(relMid)) < 1.4) c = 0;
        // raggi gialli con il lato in ombra
        if (Math.abs(perp) < 2 && along > 4) c = perp > 0.6 ? 3 : 4;
        // dischi taglienti sui raggi
        for (const rd of [8 * k, 13 * k, 18 * k]) {
          if (Math.abs(along - rd) < 1.1 && Math.abs(perp) < 1.1) c = 12;
        }
        // dischi tra i raggi (sfalsati)
        if (Math.abs(rr - 15.5 * k) < 1 && Math.abs(rr * Math.sin(relMid)) > 3 && Math.abs(rr * Math.sin(relMid)) < 4.6) c = 13;
      }
      if (rr < 7) c = 0;
      if (rr < 6) c = dx + dy < -1 ? 4 : 3; // mozzo
      if (rr < 1.6) c = 12;
      img.data[j * n + i] = c;
    }
  }
  return img;
}

/** Lampeggianti arancio sullo scudo: frame 0 sinistro acceso, 1 destro acceso. */
export const TBM_BEACONS_XY = { x: TBM.cx - 22, y: TBM.cy - 30 } as const;
export function tbmBeacons(frame: 0 | 1): IndexImage {
  const on = ['.0.0.', '03430', '34c43', '03430'];
  const offR = ['.0.0.', '01110', '11211', '01110'];
  const img = image(TBM_BEACONS_XY.x, TBM_BEACONS_XY.y, 45, 4);
  blitRows(img, frame === 0 ? on : offR, 0, 0);
  blitRows(img, frame === 1 ? on : offR, 40, 0);
  return img;
}

// ---------------------------------------------------------------- piccoli sprite

/** Sbuffo tondo di raggio r: chiaro in alto a sinistra, scuro in basso a destra; `holes` = quota di buchi (si dirada). */
function smokeBlob(r: number, holes: number, seed: number): string[] {
  const n = Math.ceil(r * 2) + 1;
  const c = n / 2;
  const rows: string[] = [];
  for (let y = 0; y < n; y++) {
    let row = '';
    for (let x = 0; x < n; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      // bordo bitorzoluto
      const rr = r * (0.85 + 0.15 * Math.sin(Math.atan2(dy, dx) * 5 + seed));
      if (dx * dx + dy * dy > rr * rr || hash(x + seed * 31, y) < holes) {
        row += '.';
        continue;
      }
      const s = dx + dy;
      row += s < -r * 0.5 ? 'c' : s > r * 0.6 ? 'e' : 'd';
    }
    rows.push(row);
  }
  // contorno scuro (si legge sia sul calcestruzzo sia sulla talpa)
  const g = rows.map((r0) => r0.split(''));
  const at = (x: number, y: number) => g[y]?.[x] ?? '.';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (at(x, y) === '.' || at(x, y) === 'f') continue;
      if ([at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)].includes('.')) g[y][x] = holes > 0.3 ? 'e' : 'f';
    }
  }
  return g.map((r0) => r0.join(''));
}

export const SMOKE: readonly (readonly string[])[][] = [
  // vicino alla testa: sbuffi grandi che si allargano e si diradano
  [smokeBlob(2.5, 0, 1), smokeBlob(4, 0, 2), smokeBlob(5.5, 0.12, 3), smokeBlob(7, 0.5, 4)],
  // polvere bassa: piccoli
  [['dd'], ['.d', 'de'], ['d.e', '.e.'], ['e..', '..e']],
  // fumo di sigaretta lontano (Z ~300): un pixel che sale, si allarga e svanisce
  [['c'], ['d'], ['dd'], ['e']],
];

/** Luce di emergenza vicino all'uscita (3x3). */
export const EMERGENCY_ON = ['.3.', '3c3', '.3.'];
export const EMERGENCY_OFF = ['.1.', '1f1', '.1.'];

/**
 * Scala: la galleria ha ~12 m di diametro (raggio 120), quindi 1 unità mondo ≈ 5 cm.
 * Una persona è alta 1.8 m = PERSON_H unità: a schermo PERSON_H * f / Z px
 * (12 px a Z 300, 11 px a Z 318).
 */
export const PERSON_H = 36;
/** larghezza degli sprite degli operai: corpo di 3 px (~50 cm a Z 300) + braccia + attrezzi ai lati */
export const WORKER_W = 7;
/** righe libere sopra il caschetto (braccio alzato, bottiglia rovesciata) */
export const WORKER_TOP = 2;

/** braccio destro (quello della sigaretta / dell'attrezzo) */
export type WorkerArmR = 'down' | 'pocket' | 'mouth' | 'throw' | 'tool0' | 'tool1';
/** braccio sinistro (quello della birra nel mondo 3) */
export type WorkerArmL = 'down' | 'bottle' | 'drink' | 'tilt';
const WORKER_ARMS_R: readonly WorkerArmR[] = ['down', 'pocket', 'mouth', 'throw', 'tool0', 'tool1'];
const WORKER_ARMS_L: readonly WorkerArmL[] = ['down', 'bottle', 'drink', 'tilt'];

/**
 * Punti notevoli dello sprite (coordinate non specchiate, riga 0 = prima riga libera):
 * brace con la mano giù / alla bocca, mozzicone che parte nel lancio, bocca da cui
 * esce il fumo, goccia di schiuma che cola dalla mano con la bottiglia.
 */
export const WORKER_PTS = {
  emberDown: [6, WORKER_TOP + 5],
  emberMouth: [6, WORKER_TOP + 1],
  butt: [6, WORKER_TOP],
  exhale: [5, WORKER_TOP],
  drip: [0, WORKER_TOP + 2],
} as const;

/**
 * Operaio lontano alto h px (+ WORKER_TOP righe libere), visto di fronte:
 * caschetto giallo, faccia, gilet lime con banda riflettente, pantaloni blu,
 * scarponi. kind 0 lavora con la torcia, 1 con la pala (in pausa la pala resta
 * piantata accanto). Le braccia si compongono: destro r, sinistro l.
 * mirror = specchiato (il secondo operaio fuma con la mano verso l'asse).
 */
export function workerRows(h: number, kind: 0 | 1, r: WorkerArmR, l: WorkerArmL, mirror: boolean): string[] {
  const L = h - 7; // anca + gambe
  const H = h + WORKER_TOP;
  const t = WORKER_TOP;
  const g: string[][] = Array.from({ length: H }, () => Array<string>(WORKER_W).fill('.'));
  const put = (x: number, y: number, c: string) => {
    if (x >= 0 && y >= 0 && x < WORKER_W && y < H) g[y][x] = c;
  };
  const vline = (x: number, y0: number, y1: number, c: string) => {
    for (let y = y0; y <= y1; y++) put(x, y, c);
  };
  // ---- corpo
  for (let x = 2; x <= 4; x++) {
    put(x, t, '4'); // caschetto
    put(x, t + 1, '3'); // faccia
    vline(x, t + 2, t + 5, '5'); // gilet
    put(x, t + 3, 'c'); // banda riflettente
    put(x, t + 6, '9'); // anca
  }
  vline(2, t + 7, t + 5 + L, '9');
  vline(4, t + 7, t + 5 + L, '9');
  put(2, H - 1, '0');
  put(4, H - 1, '0');

  // ---- braccio destro
  switch (r) {
    case 'down':
      vline(5, t + 2, t + 4, '5');
      put(5, t + 5, '3');
      break;
    case 'pocket': // mano al taschino: tira fuori il pacchetto / l'accendino
      vline(5, t + 2, t + 4, '5');
      put(4, t + 5, '3');
      break;
    case 'mouth': // gomito in fuori, mano alla bocca
      put(5, t + 2, '5');
      put(6, t + 2, '5');
      put(5, t + 1, '3');
      break;
    case 'throw': // colpetto in fuori: il mozzicone vola via
      put(5, t + 2, '5');
      put(6, t + 1, '5');
      put(6, t, '3');
      break;
    case 'tool0':
    case 'tool1': {
      const up = r === 'tool1';
      if (kind === 0) {
        // torcia: davanti al petto (0) o alzata (1)
        put(5, t + 2, '5');
        if (up) {
          put(6, t + 1, '5');
          put(6, t, '3');
          put(6, t - 1, 'c');
        } else {
          put(5, t + 3, '5');
          put(6, t + 3, '3');
          put(6, t + 2, 'c');
        }
      } else {
        // pala: lama a terra (0) o sollevata di 2 righe (1)
        const lift = up ? 2 : 0;
        const hy = up ? t + 3 : t + 4;
        vline(5, t + 2, hy - 1, '5');
        put(5, hy, '3');
        vline(6, hy - 1, H - 3 - lift, 'e');
        vline(6, H - 2 - lift, H - 1 - lift, 'd');
      }
      break;
    }
  }
  // ---- braccio sinistro
  switch (l) {
    case 'down':
    case 'bottle':
      vline(1, t + 2, t + 4, '5');
      put(1, t + 5, '3');
      if (l === 'bottle') {
        // bottiglia verde tenuta per il collo
        put(1, t + 6, '6');
        put(1, t + 7, '7');
      }
      break;
    case 'drink': // alla bocca, bottiglia inclinata
      put(1, t + 2, '5');
      put(0, t + 2, '5');
      put(1, t + 1, '3');
      put(1, t, '6');
      put(0, t - 1, '7');
      break;
    case 'tilt': // a garganella: bottiglia dritta in su
      put(1, t + 2, '5');
      put(0, t + 2, '5');
      put(1, t + 1, '3');
      put(1, t, '6');
      put(1, t - 1, '7');
      break;
  }
  // in pausa la pala resta piantata accanto (dal lato della birra)
  if (kind === 1 && r !== 'tool0' && r !== 'tool1') {
    vline(0, t + 4, H - 3, 'e');
    vline(0, H - 2, H - 1, 'd');
  }
  const rows = g.map((row) => row.join(''));
  return mirror ? rows.map((row) => [...row].reverse().join('')) : rows;
}

export const workerKey = (h: number, kind: 0 | 1, mirror: boolean, r: WorkerArmR, l: WorkerArmL) =>
  `tw-wk${h}${kind}${mirror ? 'm' : ''}-${r}-${l}`;

/** Crea (una volta) tutte le pose di un operaio alto h px. */
export function registerWorkerSprites(scene: Phaser.Scene, h: number, kind: 0 | 1, mirror: boolean): void {
  for (const r of WORKER_ARMS_R) {
    for (const l of WORKER_ARMS_L) {
      const key = workerKey(h, kind, mirror, r, l);
      if (!scene.textures.exists(key)) makeIndexTexture(scene, key, fromRows(workerRows(h, kind, r, l, mirror)));
    }
  }
}

/** Fiammella dell'accendino (3x3, ~45 cm di bagliore a Z 300). */
export const LIGHTER_FLASH = ['.4.', '4c4', '.4.'];
/** Cassa di birra (mondo 3): colli delle bottiglie verdi sopra la cassa rossa, ~40x30 cm a Z 300. */
export const BEER_CRATE = ['6.6', '222', '212'];

/**
 * Navetta da cantiere per gallerie (trasporto del personale) larga w px:
 * telaio basso giallo/arancio su 4 ruote scolpite, cabina di guida bassa e,
 * sopra, il cassone passeggeri rialzato con la fila di finestrelle; striscia
 * catarifrangente, scaletta, specchio. front = vista davanti (fari bianchi,
 * parabrezza), altrimenti da dietro (luci rosse, porta, zebratura).
 * frame 0/1 = battistrada delle ruote spostato di una riga (ruote che girano).
 */
export function vehicleRows(w: number, front: boolean, frame: 0 | 1): string[] {
  const h = Math.max(11, Math.round(w * VEHICLE_H_RATIO));
  const g: string[][] = Array.from({ length: h }, () => Array<string>(w).fill('.'));
  const put = (i: number, j: number, c: string) => {
    if (j >= 0 && j < h && i >= 0 && i < w) g[j][i] = c;
  };
  const rect = (x: number, y: number, rw: number, rh: number, c: string) => {
    for (let j = y; j < y + rh; j++) for (let i = x; i < x + rw; i++) put(i, j, c);
  };
  const big = w >= 18;
  const roofH = Math.max(2, Math.round(h * 0.08));
  const boxBot = Math.round(h * 0.47); // fondo del cassone passeggeri
  const chTop = Math.round(h * 0.62); // telaio
  const chBot = h - Math.max(2, Math.round(h * 0.1));
  const wheelW = Math.max(3, Math.round(w * 0.24));
  const wheelH = Math.max(3, Math.round(h * 0.25));
  const sh = Math.max(1, Math.round(w * 0.08)); // lato in ombra (luce dall'alto a sinistra)

  // ---- cassone passeggeri rialzato
  rect(1, 0, w - 2, 1, '0');
  rect(1, 1, w - 2, roofH - 1, 'd'); // tetto visto un po' dall'alto, illuminato dai neon
  rect(0, roofH, w, boxBot - roofH, front ? '4' : '3');
  rect(w - sh, roofH, sh, boxBot - roofH, front ? '3' : '2');
  // fila di finestrelle con i montanti scuri
  const wy0 = roofH + 1;
  const wh = Math.max(1, boxBot - roofH - 3);
  const n = clamp(Math.round((w - 2) / 5), 2, 6);
  for (let k = 0; k < n; k++) {
    const xs = 1 + Math.round((k * (w - 1)) / n);
    const xe = 1 + Math.round(((k + 1) * (w - 1)) / n) - 1; // montante
    for (let i = xs; i < xe; i++) {
      for (let j = 0; j < wh; j++) put(i, wy0 + j, j === 0 ? 'b' : j === wh - 1 && wh >= 3 ? '9' : 'a');
    }
    if (xe <= w - 2) rect(xe, wy0, 1, wh, 'f');
    if (k % 2 === 0 && xe - xs >= 2) put(xs, wy0, 'c');
  }
  // striscia catarifrangente bianca/rossa sotto i vetri
  for (let i = 1; i < w - 1; i++) put(i, boxBot - 1, ((big ? i >> 1 : i) & 1) === 0 ? 'c' : '2');

  const ci = Math.max(2, Math.round(w * 0.16));
  if (front) {
    // ---- cabina di guida bassa con parabrezza diviso
    rect(ci, boxBot, w - 2 * ci, chTop - boxBot, '4');
    rect(w - ci - sh, boxBot, sh, chTop - boxBot, '3');
    const gh = Math.max(1, Math.round((chTop - boxBot) * 0.6));
    rect(ci + 1, boxBot, w - 2 * ci - 2, gh, 'a');
    rect(ci + 1, boxBot, w - 2 * ci - 2, 1, 'b');
    if (w - 2 * ci - 2 >= 4) rect(Math.floor(w / 2), boxBot, 1, gh, 'f');
    put(ci + 1, boxBot, 'c');
    // specchio retrovisore a sinistra
    if (big) {
      rect(1, boxBot, ci - 1, 1, 'f');
      rect(1, boxBot + 1, 1, 2, 'e');
    }
    // scaletta sul lato destro
    if (big) {
      for (let j = boxBot; j < chTop; j++) {
        put(w - ci, j, 'e');
        if (ci >= 4) put(w - 2, j, 'e');
        if ((j - boxBot) % 2 === 1) for (let i = w - ci; i <= w - 2; i++) put(i, j, 'd');
      }
    }
  } else {
    // ---- parete posteriore con la porta e la scaletta in mezzo
    rect(1, boxBot, w - 2, chTop - boxBot, '3');
    rect(w - 1 - sh, boxBot, sh, chTop - boxBot, '2');
    const dw = Math.max(2, Math.round(w * 0.28));
    const dx = Math.round((w - dw) / 2);
    rect(dx, roofH, dw, chTop - roofH, 'f');
    rect(dx + 1, wy0, dw - 2, wh, 'a');
    if (dw >= 4) rect(dx + 1, wy0, dw - 2, 1, 'b');
    if (dw >= 3) rect(dx + 1, boxBot, dw - 2, chTop - boxBot, '3');
    put(dx + dw - 2, boxBot + 1, '4'); // maniglia
  }

  // ---- telaio basso
  rect(0, chTop, w, chBot - chTop, '3');
  rect(0, chTop, w, 1, '4');
  rect(0, chBot - 1, w, 1, '2');
  const fs = Math.max(1, Math.round(w * 0.12));
  const fy = chTop + 1;
  const fh = Math.max(1, Math.min(fs, h - wheelH - fy));
  if (front) {
    // fari bianchi e griglia
    rect(1, fy, fs, fh, 'c');
    rect(w - 1 - fs, fy, fs, fh, 'c');
    if (fs >= 2) {
      put(fs, fy + fh - 1, 'b');
      put(w - 2, fy + fh - 1, 'b');
    }
    for (let j = fy; j < fy + fh; j++) for (let i = fs + 3; i < w - fs - 3; i++) put(i, j, (j - fy) % 2 === 0 ? 'f' : '0');
  } else {
    // luci rosse e zebratura catarifrangente rossa/bianca
    rect(1, fy, fs, fh, '2');
    rect(w - 1 - fs, fy, fs, fh, '2');
    if (fs >= 2) {
      put(1, fy, 'c');
      put(w - 1 - fs, fy, 'c');
    }
    for (let j = fy; j < chBot - 1; j++) for (let i = wheelW; i < w - wheelW; i++) put(i, j, mod(i + j, 4) < 2 ? 'c' : '2');
    // scaletta sotto la porta
    if (big) {
      const lx = Math.round(w / 2) - 2;
      for (let j = chTop; j < h - 1; j++) {
        put(lx, j, 'e');
        put(lx + 3, j, 'e');
        if ((j - chTop) % 2 === 1) for (let i = lx + 1; i < lx + 3; i++) put(i, j, 'd');
      }
    }
  }
  // zebratura gialla/nera sul paraurti (vista davanti)
  if (front && big) for (let i = wheelW; i < w - wheelW; i++) put(i, chBot - 1, mod(i, 4) < 2 ? '4' : '0');
  // fondo scuro tra le ruote
  rect(wheelW, chBot, w - 2 * wheelW, 1, '0');

  // ---- ruote grandi scolpite (battistrada a spina che scorre di una riga per frame)
  for (const x0 of [0, w - wheelW]) {
    for (let j = 0; j < wheelH; j++) {
      for (let i = 0; i < wheelW; i++) {
        const corner = wheelW >= 4 && (i === 0 || i === wheelW - 1) && (j === 0 || j === wheelH - 1);
        if (corner) {
          if (j === 0) continue; // spigolo in alto: si vede il telaio
          put(x0 + i, h - wheelH + j, '.');
          continue;
        }
        let c: string;
        if (i === 0 || i === wheelW - 1 || j === wheelH - 1) c = '0';
        else {
          const v = mod(j + frame + Math.floor(Math.abs(2 * i - (wheelW - 1)) / 2), 2);
          c = v === 0 ? (i < wheelW / 2 ? 'e' : 'f') : '0';
        }
        put(x0 + i, h - wheelH + j, c);
      }
    }
  }

  // contorno scuro sui lati della carrozzeria
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (!'432'.includes(g[j][i])) continue;
      const nb = [g[j][i - 1], g[j][i + 1], g[j - 1]?.[i], g[j + 1]?.[i]];
      if (i === 0 || i === w - 1 || nb.includes('.')) g[j][i] = '0';
    }
  }
  return g.map((r) => r.join(''));
}

/** Alone dei fari sull'asfalto davanti alla navetta (retino chiaro che si dirada), largo w + 2 * round(w * 0.15). */
export function vehicleGlowRows(w: number): string[] {
  const m = Math.round(w * 0.15);
  const gw = w + 2 * m;
  const gh = Math.max(2, Math.round(w * 0.3));
  const fs = Math.max(1, Math.round(w * 0.12));
  const rows: string[] = [];
  for (let j = 0; j < gh; j++) {
    let row = '';
    const t = (j + 0.5) / gh;
    const hw = w / 2 + m * t;
    for (let i = 0; i < gw; i++) {
      const dx = Math.abs(i + 0.5 - gw / 2);
      const beam = dx > w / 2 - fs - 2 - m * t; // più fitto davanti ai fari
      const on = dx < hw && (i + j) % 2 === 0 && hash(i * 7 + w, j) > t * (beam ? 0.6 : 1.05) - 0.1;
      row += on ? (beam && t < 0.5 ? 'd' : 'e') : '.';
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Larghezza (mondo) della navetta: 46 = 2.3 m, sta dentro una corsia (tra mezzeria e margine,
 * 51 unità); alta VEHICLE_H_RATIO volte la larghezza (53 = 2.65 m, ~1.5 volte una persona).
 */
export const VEHICLE_W = 46;
export const VEHICLE_H_RATIO = 1.15;
/** sotto questa taglia il lampeggiante sul tetto è di 1 px (vero: ~20 cm) */
export const VEHICLE_BEACON_BIG = 22;
/** dalla taglia VEHICLE_SPIN_MIN in su le ruote girano a 2 frame */
export const VEHICLE_SPIN_MIN = 18;
export const vehicleKey = (w: number, front: boolean, frame: 0 | 1) => `tw-veh-${front ? 'f' : 'b'}${w}-${frame}`;

// ---------------------------------------------------------------- registrazione

let cached: TunnelBackdrop | null = null;

/** Sfondo calcolato una volta sola per tutta la partita (le texture restano nel TextureManager). */
export function tunnelBackdrop(): TunnelBackdrop {
  cached ??= buildBackdrop();
  return cached;
}

/** taglie pre-disegnate della navetta (larghezza a schermo): da 12 (oltre Z 350) a 34 (Z 135) */
export const VEHICLE_SIZES: readonly number[] = Array.from({ length: 12 }, (_, k) => 12 + k * 2);

export function registerTunnelSprites(scene: Phaser.Scene): TunnelBackdrop {
  const bd = tunnelBackdrop();
  makeIndexTexture(scene, 'tw-bg', bd.bg);
  bd.shades.forEach((s, i) => makeIndexTexture(scene, `tw-shade${i}`, s));
  bd.bars.forEach((b, i) => {
    makeIndexTexture(scene, `tw-neon${i}-on`, b.on);
    makeIndexTexture(scene, `tw-neon${i}-dim`, b.dim);
    makeIndexTexture(scene, `tw-neon${i}-off`, b.off);
  });
  if (!scene.textures.exists('tw-tbm-shield')) makeIndexTexture(scene, 'tw-tbm-shield', tbmShield());
  for (let k = 0; k < CUTTER_FRAMES; k++) if (!scene.textures.exists(`tw-cutter${k}`)) makeIndexTexture(scene, `tw-cutter${k}`, tbmCutter(k));
  if (!scene.textures.exists('tw-beacons0')) makeIndexTexture(scene, 'tw-beacons0', tbmBeacons(0));
  if (!scene.textures.exists('tw-beacons1')) makeIndexTexture(scene, 'tw-beacons1', tbmBeacons(1));
  SMOKE.forEach((set, s) => set.forEach((rows, p) => makeIndexTexture(scene, `tw-smoke${s}-${p}`, fromRows(rows))));
  makeIndexTexture(scene, 'tw-emer-on', fromRows(EMERGENCY_ON));
  makeIndexTexture(scene, 'tw-emer-off', fromRows(EMERGENCY_OFF));
  makeIndexTexture(scene, 'tw-wflash', fromRows(LIGHTER_FLASH));
  makeIndexTexture(scene, 'tw-crate', fromRows(BEER_CRATE));
  for (const w of VEHICLE_SIZES) {
    for (const front of [true, false]) {
      for (const fr of w >= VEHICLE_SPIN_MIN ? ([0, 1] as const) : ([0] as const)) {
        const key = vehicleKey(w, front, fr);
        if (!scene.textures.exists(key)) makeIndexTexture(scene, key, fromRows(vehicleRows(w, front, fr)));
      }
    }
    if (!scene.textures.exists(`tw-vglow${w}`)) makeIndexTexture(scene, `tw-vglow${w}`, fromRows(vehicleGlowRows(w)));
  }
  makeIndexTexture(scene, 'tw-vbeacon-on', fromRows(['.3.', '343']));
  makeIndexTexture(scene, 'tw-vbeacon-off', fromRows(['.1.', '121']));
  makeIndexTexture(scene, 'tw-vbeacon-s-on', fromRows(['4']));
  makeIndexTexture(scene, 'tw-vbeacon-s-off', fromRows(['1']));
  return bd;
}
