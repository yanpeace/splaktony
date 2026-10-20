import Phaser from 'phaser';
import { PALETTE_INT } from '../config/palette';

/**
 * Sprite del MONDO 2: l'interno della galleria, generati da codice (Sweetie 16,
 * mai l'indice 16 rosa). Chiavi texture con prefisso `tw-`.
 *
 * Lo sfondo è un "ray-cast" fatto una volta sola: per ogni pixel si lancia un
 * raggio dall'occhio verso il fondo della galleria e si guarda cosa colpisce
 * (volta circolare, pavimento con binari e canaletta, tubo di ventilazione
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

/** Talpa (fresa meccanica) a schermo: centro, raggio dello scudo e della testa, ultima riga visibile. */
export const TBM = {
  cx: 90,
  cy: Math.round(TW.vpY + (TW.f * TW.yc) / TW.tbmZ), // 167
  shieldR: 34,
  cutterR: 23,
  bottom: Math.floor(TW.vpY + (TW.f * TW.yf) / TW.tbmZ), // 190
} as const;

const DUCT = { x: -22, y: -47, r: 9, zEnd: TW.tbmZ - 4 } as const;
/** nastro trasportatore sulla parete destra: piano superiore e fianco verso l'asse */
export const BELT = { x0: 84, x1: 104, y: 50, h: 8 } as const;
/** binari: mezzo scartamento (mondo) */
export const RAIL_X = 30;

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
  Ballast,
  Rail,
  Yellow,
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
  [M.Ballast]: [0, 0, 15, 14, 13],
  [M.Rail]: [15, 14, 13, 12, 12],
  [M.Yellow]: [0, 1, 3, 4, 4],
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
const WARMABLE = new Set<number>([M.Conc, M.Floor, M.Steel, M.Ballast]);
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

/** pozzanghere sul pavimento: centro (X, Z) e semiassi */
const PUDDLES: readonly [number, number, number, number][] = [
  [12, 135, 9, 14],
  [-48, 205, 7, 14],
  [-18, 285, 7, 16],
];

const RING_L = 30; // lunghezza di un anello di conci (mondo)
const SEGMENTS = 7; // conci per anello (sfalsati di mezzo concio tra anelli vicini)
const RIB_L = 9; // passo della spirale del tubo flessibile
const SLAB_L = 45; // giunti della soletta ai lati dei binari
const SLEEPER_L = 20;

// ---------------------------------------------------------------- ray-cast dello sfondo

const enum K {
  None,
  Wall,
  Floor,
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
      if (uy * t > yf) {
        t = yf / uy;
        k = K.Floor;
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
          const ax = Math.abs(X);
          const dzdy = (Z * Z) / (yf * f);
          const px = (0.5 * Z) / f; // mezzo pixel in unità mondo
          m = M.Floor;
          al = 0.8 + 0.15 * hash(Math.floor(X / 3), Math.floor(Z / 3));
          if (ax < 42) {
            m = M.Ballast;
            al = 0.75 + 0.45 * hash(x, y);
            if (ax < 38 && dzdy < 7 && mod(Z, SLEEPER_L) < 7) {
              m = M.Conc;
              al = 0.85;
            }
            if (Math.abs(ax - RAIL_X) < Math.max(1.6, px)) {
              m = M.Rail;
              al = 1;
            }
          } else {
            keyA[i] = Math.floor(Z / SLAB_L);
            if (ax > 64 && ax < 67) m = M.Yellow;
            if (X < -72 && X > -86) {
              // canaletta con grata
              m = Math.abs(X + 72) < Math.max(1.2, px) || Math.abs(X + 86) < Math.max(1.2, px) ? M.Steel : M.Water;
              if (m === M.Water && mod(Z, 8) < Math.max(2.5, px * 2)) m = M.Steel;
              al = m === M.Water ? 0.8 : 0.9;
            }
            if (ax > 93) al *= 0.75; // angolo con la parete
          }
          for (const [px0, pz0, rx, rz] of PUDDLES) {
            if (((X - px0) / rx) ** 2 + ((Z - pz0) / rz) ** 2 < 1) {
              m = M.Water;
              al = 1.1;
            }
          }
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
        lamp[l * N + i] = (LAMP_I * (0.25 + 0.75 * Math.max(0, ndl))) * Math.exp(-((dz / LAMP_KZ) ** 2)) / (1 + dp2 / (LAMP_KP * LAMP_KP));
      }
    }
  }

  // giunti: dove la chiave cambia tra pixel vicini dello stesso tipo, un livello più scuro
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const k = kind[i];
      if (k !== K.Wall && k !== K.Duct && k !== K.Floor) continue;
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

/** Terreno di gioco: soletta compatta con bordo netto (y 292..319). */
function drawGround(bg: IndexImage): void {
  const W = bg.w;
  const g0 = TW.groundY;
  for (let y = g0; y < TW.height; y++) {
    for (let x = 0; x < W; x++) {
      const dy = y - g0;
      let c: number;
      if (dy === 0) c = 13;
      else if (dy === 1) c = 14;
      else if (dy <= 3) c = (Math.floor((x + dy) / 4) & 1) === 0 ? 4 : 0; // fascia di sicurezza gialla/nera
      else if (dy === 4) c = 0;
      else {
        c = 15;
        const h = hash(x, y);
        if (h > 0.86) c = 14;
        else if (h < 0.05) c = 0;
        if (dy === 5 && h > 0.4) c = 14;
        // giunti delle lastre e binari incassati che proseguono verso chi guarda
        if (mod(x + Math.floor(dy / 9) * 18, 36) === 0) c = 0;
        const Z = (TW.yf * TW.f) / (y + 0.5 - TW.vpY);
        for (const s of [-1, 1]) {
          const rx = Math.round(TW.vpX + (TW.f * s * RAIL_X) / Z);
          if (x === rx) c = 13;
          if (x === rx + s) c = 0;
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

/** Scudo della talpa: anello giallo con strisce di pericolo, piastra arancio con bulloni, fari. */
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
      } else if (rr > 29) c = 0;
      else if (rr > 24.3) {
        c = dy > 10 ? 2 : 3;
        if (dy < -12 && dx < 4) c = 4;
        const ang = Math.atan2(dy, dx);
        const sector = mod(ang / (Math.PI / 6), 1);
        if (Math.abs(rr - 26.8) < 0.8 && (sector < 0.12 || sector > 0.88)) c = 0; // bulloni
      } else c = 0;
      img.data[j * img.w + i] = c;
    }
  }
  // fari di lavoro ai lati (bianchi, fissi)
  const lamps = [
    [-27, 4],
    [26, 4],
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
  for (let j = 0; j < n; j++) {
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
        if (rr > 8 && rr < R - 5 && Math.abs(rr * Math.sin(relMid)) < 1.4) c = 0;
        // raggi gialli con il lato in ombra
        if (Math.abs(perp) < 2 && along > 4) c = perp > 0.6 ? 3 : 4;
        // dischi taglienti sui raggi
        for (const rd of [8, 13, 18]) {
          if (Math.abs(along - rd) < 1.1 && Math.abs(perp) < 1.1) c = 12;
        }
        // dischi tra i raggi (sfalsati)
        if (Math.abs(rr - 15.5) < 1 && Math.abs(rr * Math.sin(relMid)) > 3 && Math.abs(rr * Math.sin(relMid)) < 4.6) c = 13;
      }
      if (rr < 6) c = 0;
      if (rr < 5) c = dx + dy < -1 ? 4 : 3; // mozzo
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
];

/** Luce di emergenza vicino all'uscita (3x3). */
export const EMERGENCY_ON = ['.3.', '3c3', '.3.'];
export const EMERGENCY_OFF = ['.1.', '1f1', '.1.'];

/** Operaio lontano stilizzato (7x17), 2 pose. kind 0 con torcia, 1 con pala. */
export function workerRows(kind: 0 | 1, frame: 0 | 1): string[] {
  const body = [
    '..444..',
    '.44444.',
    '..333..',
    '..333..',
    '.55555.',
    '5555555',
    '5cc5cc5',
    '5555555',
    '3555553',
    '.55555.',
    '.99999.',
    '.99.99.',
    '.99.99.',
    '.99.99.',
    '.99.99.',
    '.99.99.',
    '.00.00.',
  ];
  const g = body.map((r) => r.split(''));
  if (kind === 0) {
    // braccio destro alzato con la torcia (frame 1 più alto)
    if (frame === 0) {
      g[5][6] = '5';
      g[4][6] = 'c';
    } else {
      g[4][6] = '5';
      g[3][6] = 'c';
      g[8][6] = '.';
    }
  } else {
    // pala: manico in diagonale, lama a terra (frame 0) o sollevata (frame 1)
    const shaft = frame === 0 ? [[8, 0], [10, 0], [12, 0], [14, 0]] : [[7, 0], [9, 0], [11, 0], [12, 0]];
    for (const [yy] of shaft) g[yy][0] = 'e';
    if (frame === 0) {
      g[15][0] = 'd';
      g[16][0] = 'd';
    } else {
      g[13][0] = 'd';
      g[14][0] = 'd';
    }
  }
  return g.map((r) => r.join(''));
}

/** Vagonetto visto davanti (front = locomotore con fari) o da dietro, larghezza w px. */
export function wagonRows(w: number, front: boolean): string[] {
  const h = Math.max(8, Math.round(w * 0.62));
  const g: string[][] = Array.from({ length: h }, () => Array<string>(w).fill('.'));
  const rect = (x: number, y: number, rw: number, rh: number, c: string) => {
    for (let j = y; j < y + rh; j++) for (let i = x; i < x + rw; i++) if (j >= 0 && j < h && i >= 0 && i < w) g[j][i] = c;
  };
  const wheelH = Math.max(2, Math.round(h * 0.16));
  const wheelW = Math.max(2, Math.round(w * 0.16));
  const chassisH = Math.max(1, Math.round(h * 0.1));
  const bodyTop = Math.max(2, Math.round(h * 0.18));
  const bodyBot = h - wheelH - chassisH;
  // ruote sulle rotaie
  const wl = Math.round(w * 0.06);
  rect(wl, h - wheelH, wheelW, wheelH, '0');
  rect(w - wl - wheelW, h - wheelH, wheelW, wheelH, '0');
  // telaio
  rect(0, bodyBot, w, chassisH, 'f');
  // cassa
  rect(0, bodyTop, w, bodyBot - bodyTop, front ? '4' : 'e');
  rect(w - Math.max(1, Math.round(w * 0.12)), bodyTop, Math.max(1, Math.round(w * 0.12)), bodyBot - bodyTop, front ? '3' : 'f');
  // tetto / carico
  if (front) {
    rect(Math.round(w * 0.12), 0, w - Math.round(w * 0.24), bodyTop, '3');
    // parabrezza
    const ww = Math.round(w * 0.56);
    const wh = Math.max(2, Math.round((bodyBot - bodyTop) * 0.4));
    rect(Math.round((w - ww) / 2), bodyTop + 1, ww, wh, 'a');
    rect(Math.round((w - ww) / 2), bodyTop + 1, Math.max(1, Math.round(ww * 0.25)), 1, 'b');
    // fari
    const fy = bodyBot - Math.max(2, Math.round(h * 0.14));
    const fs = Math.max(1, Math.round(w * 0.1));
    rect(Math.round(w * 0.1), fy, fs, Math.max(1, fs - 1), 'c');
    rect(w - Math.round(w * 0.1) - fs, fy, fs, Math.max(1, fs - 1), 'c');
  } else {
    // cassone pieno di detriti
    for (let i = 0; i < w; i++) {
      const top = bodyTop - 1 - Math.round(Math.sin((i / w) * Math.PI) * (bodyTop - 1));
      for (let j = Math.max(0, top); j < bodyTop; j++) g[j][i] = (i * 7 + j * 3) % 5 === 0 ? 'd' : (i + j) % 3 === 0 ? '1' : 'e';
    }
    // nervature e luci rosse
    for (let i = Math.round(w / 4); i < w; i += Math.max(3, Math.round(w / 4))) rect(i, bodyTop, 1, bodyBot - bodyTop, 'f');
    const fy = bodyBot - Math.max(2, Math.round(h * 0.14));
    const fs = Math.max(1, Math.round(w * 0.08));
    rect(1, fy, fs, Math.max(1, fs), '2');
    rect(w - 1 - fs, fy, fs, Math.max(1, fs), '2');
  }
  // contorno
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (g[j][i] !== '.' && g[j][i] !== '0') {
        if (i === 0 || i === w - 1 || j === 0 || g[j - 1]?.[i] === '.') {
          if (i === 0 || i === w - 1 || j === 0) g[j][i] = '0';
        }
      }
    }
  }
  return g.map((r) => r.join(''));
}

/** Larghezza (mondo) del vagonetto: sta sulle rotaie (2 * RAIL_X) con un po' di sbalzo. */
export const WAGON_W = 66;

// ---------------------------------------------------------------- registrazione

let cached: TunnelBackdrop | null = null;

/** Sfondo calcolato una volta sola per tutta la partita (le texture restano nel TextureManager). */
export function tunnelBackdrop(): TunnelBackdrop {
  cached ??= buildBackdrop();
  return cached;
}

export const WAGON_SIZES: readonly number[] = Array.from({ length: 16 }, (_, k) => 16 + k * 2);

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
  for (const k of [0, 1] as const) for (const fr of [0, 1] as const) makeIndexTexture(scene, `tw-worker${k}-${fr}`, fromRows(workerRows(k, fr)));
  for (const w of WAGON_SIZES) {
    if (!scene.textures.exists(`tw-wagon-f${w}`)) makeIndexTexture(scene, `tw-wagon-f${w}`, fromRows(wagonRows(w, true)));
    if (!scene.textures.exists(`tw-wagon-b${w}`)) makeIndexTexture(scene, `tw-wagon-b${w}`, fromRows(wagonRows(w, false)));
  }
  makeIndexTexture(scene, 'tw-wbeacon-on', fromRows(['.4.', '4c4']));
  makeIndexTexture(scene, 'tw-wbeacon-off', fromRows(['.1.', '131']));
  return bd;
}
