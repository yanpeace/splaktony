import Phaser from 'phaser';
import { C, hex, type ColorIndex } from '../config/palette';

/**
 * Bitmap font 5x7 generato da codice, con contorno scuro di 1px sempre attivo.
 * Ogni glifo occupa una cella 7x9 (5x7 + 1px di contorno per lato); in
 * rendering le celle si sovrappongono di 1px, quindi l'avanzamento è 6px.
 *
 * Uso:  pixelText(scene, x, y, 'DANNO 12', C.yellow).setOrigin(0.5)
 * Si crea un font per colore (chiave "pf-<indice>"), generato al primo uso.
 */

const GLYPHS: Record<string, string> = {
  A: '.###. #...# #...# ##### #...# #...# #...#',
  B: '####. #...# #...# ####. #...# #...# ####.',
  C: '.###. #...# #.... #.... #.... #...# .###.',
  D: '####. #...# #...# #...# #...# #...# ####.',
  E: '##### #.... #.... ####. #.... #.... #####',
  F: '##### #.... #.... ####. #.... #.... #....',
  G: '.###. #...# #.... #.### #...# #...# .####',
  H: '#...# #...# #...# ##### #...# #...# #...#',
  I: '.###. ..#.. ..#.. ..#.. ..#.. ..#.. .###.',
  J: '..### ...#. ...#. ...#. ...#. #..#. .##..',
  K: '#...# #..#. #.#.. ##... #.#.. #..#. #...#',
  L: '#.... #.... #.... #.... #.... #.... #####',
  M: '#...# ##.## #.#.# #.#.# #...# #...# #...#',
  N: '#...# #...# ##..# #.#.# #..## #...# #...#',
  O: '.###. #...# #...# #...# #...# #...# .###.',
  P: '####. #...# #...# ####. #.... #.... #....',
  Q: '.###. #...# #...# #...# #.#.# #..#. .##.#',
  R: '####. #...# #...# ####. #.#.. #..#. #...#',
  S: '.#### #.... #.... .###. ....# ....# ####.',
  T: '##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
  U: '#...# #...# #...# #...# #...# #...# .###.',
  V: '#...# #...# #...# #...# #...# .#.#. ..#..',
  W: '#...# #...# #...# #.#.# #.#.# #.#.# .#.#.',
  X: '#...# #...# .#.#. ..#.. .#.#. #...# #...#',
  Y: '#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..',
  Z: '##### ....# ...#. ..#.. .#... #.... #####',
  '0': '.###. #...# #..## #.#.# ##..# #...# .###.',
  '1': '..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.',
  '2': '.###. #...# ....# ...#. ..#.. .#... #####',
  '3': '####. ....# ....# .###. ....# ....# ####.',
  '4': '...#. ..##. .#.#. #..#. ##### ...#. ...#.',
  '5': '##### #.... ####. ....# ....# #...# .###.',
  '6': '.###. #.... #.... ####. #...# #...# .###.',
  '7': '##### ....# ...#. ..#.. .#... .#... .#...',
  '8': '.###. #...# #...# .###. #...# #...# .###.',
  '9': '.###. #...# #...# .#### ....# ....# .###.',
  ' ': '..... ..... ..... ..... ..... ..... .....',
  '.': '..... ..... ..... ..... ..... .##.. .##..',
  ',': '..... ..... ..... ..... .##.. ..#.. .#...',
  '!': '..#.. ..#.. ..#.. ..#.. ..#.. ..... ..#..',
  '?': '.###. #...# ....# ...#. ..#.. ..... ..#..',
  ':': '..... .##.. .##.. ..... .##.. .##.. .....',
  '-': '..... ..... ..... ##### ..... ..... .....',
  '+': '..... ..#.. ..#.. ##### ..#.. ..#.. .....',
  '/': '....# ...#. ...#. ..#.. .#... .#... #....',
  '%': '##..# ##.#. ...#. ..#.. .#... .#.## #..##',
  "'": '..#.. ..#.. .#... ..... ..... ..... .....',
  '(': '...#. ..#.. .#... .#... .#... ..#.. ...#.',
  ')': '.#... ..#.. ...#. ...#. ...#. ..#.. .#...',
  '=': '..... ..... ##### ..... ##### ..... .....',
  '<': '...#. ..#.. .#... #.... .#... ..#.. ...#.',
  '>': '.#... ..#.. ...#. ....# ...#. ..#.. .#...',
  '#': '.#.#. .#.#. ##### .#.#. ##### .#.#. .#.#.',
  $: '..#.. .#### #.#.. .###. ..#.# ####. ..#..',
  /** "x" piccola per i moltiplicatori: scrivi "*" → es. "*2" */
  '*': '..... ..... #...# .#.#. ..#.. .#.#. #...#',
};

const CHARS = Object.keys(GLYPHS).join('');
const GW = 5;
const GH = 7;
const CELL_W = GW + 2;
const CELL_H = GH + 2;
const PER_ROW = 16;

export const FONT_LINE_HEIGHT = CELL_H;
/** avanzamento orizzontale per carattere (cella - 1px di sovrapposizione) */
export const FONT_ADVANCE = CELL_W - 1;

function glyphMask(ch: string): boolean[][] {
  return GLYPHS[ch].split(' ').map((r) => [...r].map((c) => c === '#'));
}

export function fontKey(color: ColorIndex | number, outline: ColorIndex | number = C.black): string {
  return `pf-${color}-${outline}`;
}

/** Genera (una sola volta) il font del colore indicato. */
export function ensurePixelFont(
  scene: Phaser.Scene,
  color: ColorIndex | number = C.white,
  outline: ColorIndex | number = C.black,
): string {
  const key = fontKey(color, outline);
  if (scene.cache.bitmapFont.exists(key)) return key;

  const rows = Math.ceil(CHARS.length / PER_ROW);
  const tex = scene.textures.createCanvas(key, PER_ROW * CELL_W, rows * CELL_H);
  if (!tex) throw new Error(`pixelFont: impossibile creare ${key}`);
  const ctx = tex.getContext();

  [...CHARS].forEach((ch, i) => {
    const ox = (i % PER_ROW) * CELL_W;
    const oy = Math.floor(i / PER_ROW) * CELL_H;
    const mask = glyphMask(ch);
    // contorno: ogni pixel vuoto adiacente (8 direzioni) a un pixel pieno
    ctx.fillStyle = hex(outline);
    for (let y = -1; y <= GH; y++) {
      for (let x = -1; x <= GW; x++) {
        if (mask[y]?.[x]) continue;
        let near = false;
        for (let dy = -1; dy <= 1 && !near; dy++) {
          for (let dx = -1; dx <= 1 && !near; dx++) {
            if (mask[y + dy]?.[x + dx]) near = true;
          }
        }
        if (near) ctx.fillRect(ox + x + 1, oy + y + 1, 1, 1);
      }
    }
    ctx.fillStyle = hex(color);
    for (let y = 0; y < GH; y++) {
      for (let x = 0; x < GW; x++) {
        if (mask[y][x]) ctx.fillRect(ox + x + 1, oy + y + 1, 1, 1);
      }
    }
  });
  tex.refresh();

  const entry = Phaser.GameObjects.RetroFont.Parse(scene, {
    image: key,
    width: CELL_W,
    height: CELL_H,
    chars: CHARS,
    charsPerRow: PER_ROW,
    'spacing.x': 0,
    'spacing.y': 0,
    'offset.x': 0,
    'offset.y': 0,
    lineSpacing: 0,
  });
  // a runtime Parse ritorna già { data, texture, frame } (i tipi .d.ts dicono il contrario)
  scene.cache.bitmapFont.add(key, entry as unknown as { data: unknown; texture: string; frame: null });
  return key;
}

/** Normalizza il testo per il font: maiuscole, niente accenti, caratteri ignoti → spazio. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/./g, (ch) => (ch === '\n' || ch in GLYPHS ? ch : ' '));
}

/** Crea un testo pixel con contorno. Per cambiare testo usa setPixelText(). */
export function pixelText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  color: ColorIndex | number = C.white,
  outline: ColorIndex | number = C.black,
): Phaser.GameObjects.BitmapText {
  const key = ensurePixelFont(scene, color, outline);
  const t = scene.add.bitmapText(Math.round(x), Math.round(y), key, normalizeText(text));
  t.setLetterSpacing(-1);
  return t;
}

export function setPixelText(t: Phaser.GameObjects.BitmapText, text: string): void {
  t.setText(normalizeText(text));
}

/** Larghezza in pixel di una stringa (una riga). */
export function measureText(text: string): number {
  const n = normalizeText(text).length;
  return n === 0 ? 0 : n * FONT_ADVANCE + 1;
}

/** 1234 → "1234", 12345 → "12.3K", 1234567 → "1.23M" */
export function formatCompact(n: number): string {
  const v = Math.floor(n);
  if (v < 10000) return String(v);
  const units = ['K', 'M', 'B', 'T'];
  let x = v;
  let u = -1;
  while (x >= 1000 && u < units.length - 1) {
    x /= 1000;
    u++;
  }
  const digits = x >= 100 ? 0 : x >= 10 ? 1 : 2;
  return x.toFixed(digits).replace(/\.?0+$/, '') + units[u];
}
