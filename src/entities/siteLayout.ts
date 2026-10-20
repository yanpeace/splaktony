/**
 * Geometria condivisa del cantiere della galleria (nessuna dipendenza da Phaser).
 * La usano lo sfondo (Room.ts), l'incidente (CarCrash.ts) e le animazioni
 * (SiteAmbient.ts): così strada, auto, albero e polvere combaciano sempre.
 *
 * La scena è in prospettiva: in fondo, al centro, l'imbocco della galleria;
 * da lì una strada di sabbia scende a curve verso chi guarda e esce dal bordo
 * basso dello schermo. La profondità z va da Z_NEAR (davanti, bordo basso) a
 * Z_FAR (imbocco della galleria): a distanza z tutto è scalato di 1/z.
 *
 *   s(z) = 1 / z                      scala a schermo
 *   y(z) = HORIZON_Y + (NEAR_Y - HORIZON_Y) * s(z)
 *   x(z) = CENTER_X + LATERAL * wiggle(z) * s(z)
 *   w(z) = ROAD_WIDTH * s(z)          larghezza della strada
 */

/** linea dell'orizzonte (punto di fuga); la montagna sta sopra, la piana sotto */
export const HORIZON_Y = 128;
/** dove arriverebbe la strada a z = 1 (sotto il bordo basso: y 320) */
export const NEAR_Y = 330;
export const CENTER_X = 90;
/** larghezza della strada a z = 1 (px) */
export const ROAD_WIDTH = 92;
/** ampiezza delle curve (unità mondo, moltiplicata per la scala) */
export const LATERAL = 48;
/** profondità del bordo basso dello schermo e dell'imbocco della galleria */
export const Z_NEAR = 1;
export const Z_FAR = 8;
/** numero di semi-curve tra il bordo basso e la galleria */
export const BENDS = 3;

export interface RoadPoint {
  z: number;
  /** centro della strada (px) */
  x: number;
  y: number;
  /** larghezza della strada (px) */
  w: number;
  /** scala a schermo 1/z (1 davanti, ~0.12 alla galleria) */
  s: number;
  /** direzione a schermo verso la galleria (radianti, 0 = destra, -π/2 = su) */
  heading: number;
}

/** Spostamento laterale della curva (unità mondo, -1..1): 0 al bordo basso e alla galleria. */
export function wiggle(z: number): number {
  return Math.sin((BENDS * Math.PI * (z - Z_NEAR)) / (Z_FAR - Z_NEAR));
}

function project(z: number): { x: number; y: number; s: number } {
  const s = 1 / z;
  return {
    x: CENTER_X + LATERAL * wiggle(z) * s,
    y: HORIZON_Y + (NEAR_Y - HORIZON_Y) * s,
    s,
  };
}

/** Punto della strada alla profondità z (Z_NEAR..Z_FAR, valori fuori sono estrapolati). */
export function roadAt(z: number): RoadPoint {
  const p = project(z);
  const q = project(z + 0.05);
  return { z, x: p.x, y: p.y, w: ROAD_WIDTH * p.s, s: p.s, heading: Math.atan2(q.y - p.y, q.x - p.x) };
}

/** Profondità corrispondente a una riga di schermo y (sotto l'orizzonte). */
export function zAtY(y: number): number {
  return (NEAR_Y - HORIZON_Y) / Math.max(0.001, y - HORIZON_Y);
}

/** Punto della strada che passa per la riga y (per disegnarla riga per riga). */
export function roadAtY(y: number): RoadPoint {
  return roadAt(zAtY(y));
}

/** Scala di un oggetto appoggiato a terra alla riga y (1 = davanti). */
export function scaleAtY(y: number): number {
  return 1 / zAtY(y);
}

/** Imbocco della galleria: base al centro (x, y) dove la strada entra, a z = Z_FAR. */
export const TUNNEL = (() => {
  const p = roadAt(Z_FAR);
  // la bocca è un po' più larga della strada; arco alto quanto ~0,8 della larghezza
  const w = Math.round(p.w + 14);
  return { x: Math.round(p.x), y: Math.round(p.y), w, h: Math.round(w * 0.8), z: Z_FAR };
})();

/**
 * Albero contro cui si schianta l'auto: piccolo, all'esterno del vertice della
 * seconda curva (dove un'auto che non sterza va dritta).
 * (x, y) = base del tronco; h = altezza consigliata in px (già in scala).
 */
export const TREE = (() => {
  // vertice della 2ª semi-curva: wiggle = ±1
  const z = Z_NEAR + ((Z_FAR - Z_NEAR) * 1.5) / BENDS;
  const p = roadAt(z);
  const side = Math.sign(wiggle(z)) || 1;
  const x = Math.round(p.x + side * (p.w / 2 + 5));
  return { x, y: Math.round(p.y), z, side, h: Math.max(10, Math.round(70 * p.s)) };
})();

/** Profondità alla quale l'auto smette di sterzare e tira dritto verso l'albero. */
export const CRASH_LEAVE_Z = TREE.z - 0.5;
