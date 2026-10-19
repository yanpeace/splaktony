import Phaser from 'phaser';
import { hex } from '../config/palette';

/**
 * Uno sprite è un array di righe; ogni carattere è un indice esadecimale
 * della palette (0-f), '.' o ' ' = trasparente. Tutte le righe devono avere
 * la stessa lunghezza.
 *
 *   const COIN: SpriteData = [
 *     '.0000.',
 *     '044440',
 *     ...
 *   ];
 *
 * Quando arriveranno gli sprite disegnati in Aseprite basterà caricare
 * un'immagine con la stessa chiave texture: il resto del codice non cambia.
 */
export type SpriteData = readonly string[];

/** Indice di palette di un carattere, oppure -1 se trasparente. */
export function paletteIndexOf(ch: string): number {
  if (ch === '.' || ch === ' ') return -1;
  const n = parseInt(ch, 16);
  if (Number.isNaN(n)) throw new Error(`pixelSprite: carattere non valido "${ch}"`);
  return n;
}

function validate(key: string, rows: SpriteData): number {
  if (rows.length === 0) throw new Error(`pixelSprite "${key}": nessuna riga`);
  const w = rows[0].length;
  rows.forEach((r, i) => {
    if (r.length !== w) {
      throw new Error(`pixelSprite "${key}": riga ${i} lunga ${r.length}, attesi ${w}`);
    }
  });
  return w;
}

/** Disegna i pixel di uno sprite su un contesto 2D (usato anche da pixelFont). */
export function paintSprite(
  ctx: CanvasRenderingContext2D,
  rows: SpriteData,
  ox = 0,
  oy = 0,
  scale = 1,
): void {
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const idx = paletteIndexOf(row[x]);
      if (idx < 0) continue;
      ctx.fillStyle = hex(idx);
      ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
    }
  }
}

/**
 * Crea (una sola volta) una texture Phaser a partire da uno sprite.
 * Ritorna la chiave, così si può usare inline: scene.add.image(x, y, makeSprite(...)).
 */
export function makeSprite(scene: Phaser.Scene, key: string, rows: SpriteData, scale = 1): string {
  if (scene.textures.exists(key)) return key;
  const w = validate(key, rows);
  const tex = scene.textures.createCanvas(key, w * scale, rows.length * scale);
  if (!tex) throw new Error(`pixelSprite: impossibile creare "${key}"`);
  paintSprite(tex.getContext(), rows, 0, 0, scale);
  tex.refresh();
  return key;
}

/** Registra un dizionario { chiave: sprite } in un colpo solo. */
export function makeSprites(scene: Phaser.Scene, sprites: Record<string, SpriteData>): void {
  for (const [key, rows] of Object.entries(sprites)) makeSprite(scene, key, rows);
}

/** Dimensioni di uno sprite senza creare la texture. */
export function spriteSize(rows: SpriteData): { w: number; h: number } {
  return { w: rows[0]?.length ?? 0, h: rows.length };
}
