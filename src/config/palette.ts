/**
 * Palette UNICA del gioco: "Sweetie 16 + 1 rosa pelle".
 * Vietato usare colori fuori da questa lista (testo, UI, particelle, sprite).
 * L'indice 16 (g, rosa) è un'eccezione approvata: SOLO per la pelle di Tony.
 *
 * Negli sprite (vedi gfx/pixelSprite.ts) ogni pixel è un carattere esadecimale
 * 0-f (oppure g = 16, rosa pelle) che indica l'indice in questa palette;
 * '.' = trasparente.
 */
export const PALETTE_HEX = [
  '#1a1c2c', // 0 black
  '#5d275d', // 1 plum
  '#b13e53', // 2 red
  '#ef7d57', // 3 orange
  '#ffcd75', // 4 yellow
  '#a7f070', // 5 lime
  '#38b764', // 6 green
  '#257179', // 7 teal
  '#29366f', // 8 navy
  '#3b5dc9', // 9 blue
  '#41a6f6', // a sky
  '#73eff7', // b cyan
  '#f4f4f4', // c white
  '#94b0c2', // d silver
  '#566c86', // e slate
  '#333c57', // f charcoal
  '#f2a7a0', // g pink (pelle, solo per la pelle di Tony)
] as const;

/** Indici con nome, da usare nel codice al posto dei numeri magici. */
export const C = {
  black: 0,
  plum: 1,
  red: 2,
  orange: 3,
  yellow: 4,
  lime: 5,
  green: 6,
  teal: 7,
  navy: 8,
  blue: 9,
  sky: 10,
  cyan: 11,
  white: 12,
  silver: 13,
  slate: 14,
  charcoal: 15,
  pink: 16,
} as const;

export type ColorIndex = (typeof C)[keyof typeof C];

/** Colori come interi 0xRRGGBB (per Graphics, Rectangle, tint...). */
export const PALETTE_INT: readonly number[] = PALETTE_HEX.map((h) => parseInt(h.slice(1), 16));

/** Indice valido 0..16 (intero, limitato agli estremi della palette). */
function clampIndex(index: number): number {
  const i = Math.trunc(index);
  return i < 0 ? 0 : i >= PALETTE_HEX.length ? PALETTE_HEX.length - 1 : i;
}

/** Colore intero dall'indice di palette. */
export function col(index: ColorIndex | number): number {
  return PALETTE_INT[clampIndex(index)];
}

/** Colore CSS (#rrggbb) dall'indice di palette. */
export function hex(index: ColorIndex | number): string {
  return PALETTE_HEX[clampIndex(index)];
}
