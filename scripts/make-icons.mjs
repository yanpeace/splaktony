// Genera le icone PWA pixel (192 e 512 PNG) da uno sprite in palette Sweetie 16.
// Solo moduli built-in: zlib per la compressione PNG.
//   node scripts/make-icons.mjs   → public/icons/icon-192.png, icon-512.png
//
// Disegno: faccia di Tony (stesso sprite di src/gfx/sprites.ts, 'tony-head')
// al centro di una griglia 32x32 su fondo #1a1c2c, scalata nearest-neighbor
// (x6 = 192, x16 = 512). La faccia occupa il centro (~55%): sicura anche come
// icona "maskable" (zona sicura = cerchio dell'80%).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const PALETTE = [
  '#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#257179',
  '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86', '#333c57',
];

// Tony: testa 16x17 (ciuffo + faccia sorridente), come in src/gfx/sprites.ts
const TONY_HEAD = [
  '.....1..1..1....',
  '......1.1.1.....',
  '....00000000....',
  '..003333333300..',
  '.03333333333330.',
  '.033e3e3e3e3330.',
  '0333333333333330',
  '0330003333000330',
  '0330c033330c0330',
  '0330003333000330',
  '0322333333332230',
  '0333303333033330',
  '0333330000333330',
  '0333333333333330',
  '.03333333333330.',
  '..003333333300..',
  '....00000000....',
];

const GRID = 32;

/** griglia GRID x GRID di indici palette (-1 = fondo) */
function buildGrid() {
  const g = Array.from({ length: GRID }, () => new Array(GRID).fill(-1));
  // alone a "pow" dietro la testa: rombo navy/plum a gradini
  const c = GRID / 2;
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const d = Math.abs(x + 0.5 - c) + Math.abs(y + 0.5 - c);
      if (d < 12) g[y][x] = 8; // navy
      else if (d < 14) g[y][x] = 15; // charcoal
    }
  }
  // stelline gialle
  for (const [x, y] of [[6, 9], [25, 8], [24, 24], [7, 23]]) {
    g[y][x] = 4;
    g[y - 1][x] = 4;
    g[y + 1][x] = 4;
    g[y][x - 1] = 4;
    g[y][x + 1] = 4;
    g[y][x] = 12;
  }
  const ox = (GRID - 16) / 2;
  const oy = Math.floor((GRID - TONY_HEAD.length) / 2);
  TONY_HEAD.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch !== '.') g[oy + y][ox + x] = parseInt(ch, 16);
    });
  });
  return g;
}

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---- encoder PNG minimale (RGBA 8 bit, filtro 0) ----

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y);
      raw[p++] = r;
      raw[p++] = g;
      raw[p++] = b;
      raw[p++] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const grid = buildGrid();
const bg = rgb(PALETTE[0]);
const colors = PALETTE.map(rgb);

for (const size of [192, 512]) {
  const scale = size / GRID;
  if (!Number.isInteger(scale)) throw new Error(`dimensione ${size} non multipla di ${GRID}`);
  const png = encodePng(size, (x, y) => {
    const i = grid[Math.floor(y / scale)][Math.floor(x / scale)];
    return i < 0 ? bg : colors[i];
  });
  const file = join(outDir, `icon-${size}.png`);
  writeFileSync(file, png);
  console.log(`scritto ${file} (${png.length} byte)`);
}
