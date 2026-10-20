import Phaser from 'phaser';
import { SCREEN } from '../config/balance';
import { makeSprite, makeSprites, spriteSize, type SpriteData } from './pixelSprite';
import { roadAtY, scaleAtY, TUNNEL } from '../entities/siteLayout';

/**
 * Sprite del cantiere della galleria (sfondo di gioco e menu), sempre come
 * array di stringhe con indici palette Sweetie 16 ('.' = vuoto):
 *   0 black 1 plum 2 red 3 orange 4 yellow 5 lime 6 green 7 teal
 *   8 navy 9 blue a sky b cyan c white d silver e slate f charcoal
 *
 * Le forme grandi (montagna, portale, piana con la strada a curve) sono
 * generate qui sotto con un "foglio a quadretti" (Grid) e un generatore
 * pseudo-casuale con seme fisso: il risultato è sempre lo stesso array di
 * stringhe. La piana è calcolata riga per riga dalla geometria condivisa
 * (entities/siteLayout.ts), quindi la strada combacia con auto e polvere.
 *
 * Gli oggetti del cantiere hanno 2-3 taglie (L vicino, M medio, S lontano)
 * da scegliere con scaleAtY(y).
 */

// ------------------------------------------------------------ utility

/** Generatore pseudo-casuale deterministico (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Matrice di Bayer 4x4 (0..15) per i passaggi di colore a retino. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (x: number, y: number) => (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;

class Grid {
  private readonly d: string[][];
  constructor(
    readonly w: number,
    readonly h: number,
    /** se true, x fuori dal bordo rientra dall'altro lato (tile ripetibili) */
    private readonly wrapX = false,
  ) {
    this.d = Array.from({ length: h }, () => Array<string>(w).fill('.'));
  }
  get(x: number, y: number): string {
    if (this.wrapX) x = ((x % this.w) + this.w) % this.w;
    return this.d[y]?.[x] ?? '.';
  }
  set(x: number, y: number, c: string): void {
    x = Math.round(x);
    y = Math.round(y);
    if (this.wrapX) x = ((x % this.w) + this.w) % this.w;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.d[y][x] = c;
  }
  rect(x: number, y: number, w: number, h: number, c: string): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  line(x0: number, y0: number, x1: number, y1: number, c: string): void {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= n; i++) {
      const t = n === 0 ? 0 : i / n;
      this.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, c);
    }
  }
  /** Copia uno sprite (i pixel trasparenti non coprono). */
  blit(rows: SpriteData, ox: number, oy: number): void {
    rows.forEach((r, y) => [...r].forEach((c, x) => c !== '.' && this.set(ox + x, oy + y, c)));
  }
  /** Contorno di colore c attorno ai pixel pieni (4 direzioni). */
  outline(c = '0'): void {
    const add: [number, number][] = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y) !== '.') continue;
        const n = [this.get(x - 1, y), this.get(x + 1, y), this.get(x, y - 1), this.get(x, y + 1)];
        if (n.some((v) => v !== '.' && v !== c)) add.push([x, y]);
      }
    }
    add.forEach(([x, y]) => this.set(x, y, c));
  }
  rows(): SpriteData {
    return this.d.map((r) => r.join(''));
  }
}

// ------------------------------------------------------------ layout dello sfondo (coordinate schermo)

/** Prima riga della texture della montagna (sopra c'è solo cielo). */
export const MOUNTAIN_Y0 = 44;
/** Prima riga della texture della piana (strada + terreno, fino al bordo basso). */
export const PLAIN_Y0 = 146;
/** Portale della galleria: angolo in alto a sinistra della texture. */
export const PORTAL_X0 = TUNNEL.x - 32;
export const PORTAL_Y0 = TUNNEL.y - 46;
/** Lampade gialle ai lati del portale (statiche, 3x3, angolo in alto a sinistra). */
export const TUNNEL_LAMPS: readonly { x: number; y: number }[] = [
  { x: TUNNEL.x - 20, y: TUNNEL.y - 17 },
  { x: TUNNEL.x + 17, y: TUNNEL.y - 17 },
];
/** Riga alta del muro di testa del portale (copertina in cemento). */
const HEAD_TOP = TUNNEL.y - 37;
/**
 * Targa "GALLERIA" sul muro di testa, sopra l'arco: angolo in alto a sinistra
 * della texture 'site-tunnel-sign' (micro-font 3x5, vedi tunnelSign()).
 */
export const TUNNEL_SIGN = { x: TUNNEL.x - 15, y: HEAD_TOP + 3, text: 'GALLERIA' } as const;
/** Bordo superiore del terreno di gioco (linea netta). */
const GROUND_Y = 291;

/** Piede della montagna alla colonna x: sopra c'è la montagna, sotto la piana. */
function mountainFootY(x: number): number {
  if (Math.abs(x - TUNNEL.x) < 40) return TUNNEL.y - 1; // fondo dello scavo, a filo del portale
  return Math.round(149 + 1.5 * Math.sin(x * 0.23) + Math.sin(x * 0.61 + 1));
}

/** Hash deterministico 0..1 di una coppia di interi (dettagli fissi senza rumore). */
function hash2(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Fronte di scavo attorno al portale: un taglio a cupola nel versante, con
 * bordo alto irregolare. CUT_TOP = cresta al centro, CUT_HW = mezza larghezza
 * alla base (dove il taglio si raccorda con il piede della montagna).
 */
const CUT_TOP = 99;
const CUT_HW = 50;
const CUT_JAG = (() => {
  const r = rng(113);
  const out: number[] = [];
  let w = 0;
  for (let x = 0; x < 180; x++) {
    w = Math.max(-2.5, Math.min(2.5, w + (r() - 0.5) * 1.3));
    out.push(w);
  }
  return out;
})();
/** Riga della cresta del taglio alla colonna x (Infinity = fuori dal taglio). */
function cutEdgeY(x: number): number {
  const dx = Math.abs(x + 0.5 - TUNNEL.x);
  if (dx > CUT_HW) return Infinity;
  return Math.round(CUT_TOP + 52 * (dx / CUT_HW) ** 2.6 + (x - TUNNEL.x) * 0.06 + 1.5 * Math.sin(x * 0.29) + CUT_JAG[x]);
}

// ------------------------------------------------------------ cielo

/** Striscia verticale 8x160 ripetuta in orizzontale: blu → azzurro → ciano a retino. */
function sky(): SpriteData {
  const g = new Grid(8, 160);
  const bands: [number, string][] = [
    [0, '9'],
    [52, 'a'],
    [100, 'b'],
  ];
  const ramp = 12; // altezza del retino tra due bande
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      let c = bands[0][1];
      for (let i = 1; i < bands.length; i++) {
        const [start, next] = bands[i];
        if (y >= start) c = next;
        else if (y >= start - ramp) {
          const t = (y - (start - ramp)) / ramp;
          c = t > bayer(x, y) ? next : bands[i - 1][1];
          break;
        }
      }
      g.set(x, y, c);
    }
  }
  return g.rows();
}

/**
 * Cielo sopra lo 0 (solo schermi lunghi, h = SCREEN.extra righe): blu come
 * la prima banda di sky(), in alto sfuma a retino nel blu notte sotto l'HUD.
 */
function skyTop(h: number): SpriteData {
  const g = new Grid(8, Math.max(1, h));
  const edge = Math.round(g.h * 0.45); // fine del blu notte
  const ramp = 12;
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const t = (y - (edge - ramp / 2)) / ramp;
      g.set(x, y, t >= 1 ? '9' : t > bayer(x, y) ? '9' : '8');
    }
  }
  return g.rows();
}

/** Nuvola: unione di cerchi bianchi, pancia ombreggiata in argento. */
function cloud(w: number, h: number, blobs: [number, number, number][]): SpriteData {
  const g = new Grid(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inside = blobs.some(([cx, cy, r]) => (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r);
      if (inside && y < h - 1) g.set(x, y, y >= h - 3 ? 'd' : 'c');
    }
  }
  for (let x = 0; x < w; x++) if (g.get(x, h - 2) !== '.') g.set(x, h - 1, 'd');
  return g.rows();
}

// ------------------------------------------------------------ montagna

/**
 * Montagna 180 x (156 - MOUNTAIN_Y0): cresta lontana argento, massiccio di
 * roccia ardesia con il fianco sinistro illuminato, prati e abeti sulle
 * pendici basse e, al centro, il fronte di scavo attorno al portale (cutFace).
 */
function mountain(): SpriteData {
  const W = 180;
  const H = 156 - MOUNTAIN_Y0;
  const g = new Grid(W, H);
  const r = rng(71);
  const Y = (y: number) => y - MOUNTAIN_Y0; // da coordinate schermo a griglia

  // profili (coordinate schermo)
  const farTop = (x: number) => 78 + 9 * Math.sin(x * 0.04 + 0.6) + 3 * Math.sin(x * 0.13 + 2);
  let walk = 0;
  const jag: number[] = [];
  for (let x = 0; x < W; x++) {
    walk = Math.max(-2, Math.min(2, walk + (r() - 0.5) * 1.6));
    jag.push(walk);
  }
  const mainTop = (x: number) =>
    61 + 0.0042 * (x - 92) ** 2 + 3 * Math.sin(x * 0.19) + 1.5 * Math.sin(x * 0.47 + 2) + jag[x];
  const grassTop = (x: number) => 104 + 6 * Math.sin(x * 0.08 + 1.3) + 3 * Math.sin(x * 0.27);

  for (let x = 0; x < W; x++) {
    const ft = Math.round(farTop(x));
    const mt = Math.round(mainTop(x));
    const slope = mainTop(Math.min(W - 1, x + 2)) - mainTop(Math.max(0, x - 2)); // < 0: sale verso destra → lit
    const gt = grassTop(x);
    const foot = mountainFootY(x);
    for (let sy = Math.min(ft, mt); sy <= 155; sy++) {
      let c: string;
      if (sy < mt) {
        // cresta lontana: argento, foschia ardesia solo verso il piede
        c = sy === ft ? 'c' : bayer(x, sy) < (sy - ft - 6) / 24 ? 'e' : 'd';
        if (hash2(x >> 2, sy >> 1, 5) < 0.06 && sy > ft + 2) c = 'e'; // vene di roccia
      } else {
        const depth = sy - mt;
        if (depth === 0) c = slope < 0 ? 'd' : 'e';
        else if (slope < -0.6 && depth < 4) c = depth < 2 || bayer(x, sy) < 0.35 ? 'd' : 'e';
        else if (slope > 0.6 && depth < 6) c = depth < 3 || bayer(x, sy) < 0.3 ? 'f' : 'e';
        else c = 'e';
        // strati inclinati della roccia, interrotti a tratti
        const sv = sy + x * 0.18 + 2 * Math.sin(x * 0.05);
        const layer = Math.floor(sv / 7);
        if (Math.floor(sv) % 7 === 0 && hash2(x >> 3, layer, 1) > 0.35 && depth > 2) c = 'f';
        else if (Math.floor(sv) % 7 === 1 && hash2(x >> 3, layer, 1) > 0.82 && depth > 2) c = 'd';
        // fratture diagonali (rare)
        if ((x * 2 + sy * 3 + Math.floor(jag[x] * 3)) % 37 === 0 && depth > 3) c = 'f';
        // prato sulle pendici basse (bordo frastagliato a retino)
        const gd = sy - gt;
        if (gd > 0 || (gd > -3 && bayer(x, sy) < (gd + 3) / 3)) {
          c = gd < 2 ? '6' : bayer(x, sy) < 0.25 ? '6' : '7';
          if (sy > 140) c = bayer(x, sy) < 0.5 ? '7' : 'f';
        }
      }
      if (sy >= foot + 1) c = 'f'; // sotto il piede: coperto dalla piana
      g.set(x, Y(sy), c);
    }
  }

  // abeti sulle pendici erbose (piccoli: sono lontani)
  for (let i = 0; i < 26; i++) {
    const x = Math.floor(r() * W);
    if (Math.abs(x - TUNNEL.x) < 46) continue;
    const base = Math.round(grassTop(x)) + 4 + Math.floor(r() * 30);
    if (base > mountainFootY(x) - 2) continue;
    const h = 3 + Math.floor(r() * 3);
    for (let j = 0; j < h; j++) {
      const half = Math.floor((j * 2) / h + 0.3);
      for (let k = -half; k <= half; k++) g.set(x + k, Y(base - h + j), k < 0 ? '6' : '7');
    }
    g.set(x, Y(base), '0');
  }

  cutFace(g, Y);
  return g.rows();
}

/**
 * Fronte di scavo della galleria (sopra la montagna, sotto il portale):
 * cresta con canaletta di guardia, un filo di terra vegetale, parete di
 * roccia grigia a strati e fratture, spritz-beton con rete e chiodi attorno
 * al muro di testa, terra smossa, massi e detriti alla base.
 */
function cutFace(g: Grid, Y: (sy: number) => number): void {
  const cx = TUNNEL.x;
  const foot = TUNNEL.y - 1;
  // distanza (in px, 8 direzioni) dalla sagoma del portale, per lo spritz-beton
  const SHOT = 5;
  const pr = portal();
  const dist = new Map<number, number>();
  const key = (x: number, y: number) => y * 256 + x;
  let front: [number, number][] = [];
  pr.forEach((row, j) =>
    [...row].forEach((ch, i) => {
      if (ch === '.') return;
      dist.set(key(PORTAL_X0 + i, PORTAL_Y0 + j), 0);
      front.push([PORTAL_X0 + i, PORTAL_Y0 + j]);
    }),
  );
  for (let d = 1; d <= SHOT + 1; d++) {
    const next: [number, number][] = [];
    for (const [x, y] of front) {
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const k = key(x + ox, y + oy);
          if (dist.has(k)) continue;
          dist.set(k, d);
          next.push([x + ox, y + oy]);
        }
      }
    }
    front = next;
  }

  // strati della roccia: limiti a distanza variabile (3..7 px)
  const sr = rng(37);
  const STRATA: number[] = [];
  for (let y = CUT_TOP - 12; y < foot + 12; y += 3 + Math.floor(sr() * 5)) STRATA.push(y);
  const rock: [number, number][] = [];

  for (let x = cx - CUT_HW - 1; x <= cx + CUT_HW + 1; x++) {
    const edge = cutEdgeY(x);
    if (!Number.isFinite(edge)) continue;
    const dx = x + 0.5 - cx;
    const flat = Math.abs(cutEdgeY(x + 2) - cutEdgeY(x - 2)) <= 2; // cresta quasi orizzontale: berma con canaletta
    // il fianco del taglio guarda verso il centro: a sinistra in ombra, a destra in luce
    const sideL = cutEdgeY(x - 2) > edge + 1 || !Number.isFinite(cutEdgeY(x - 2));
    const sideR = cutEdgeY(x + 2) > edge + 1 || !Number.isFinite(cutEdgeY(x + 2));
    for (let sy = edge; sy <= foot; sy++) {
      const wasSoft = '67'.includes(g.get(x, Y(sy)));
      const k = sy - edge;
      let c: string;
      if (k === 0) c = flat ? 'd' : wasSoft ? '1' : 'f'; // bordo in cemento della canaletta / ciglio
      else if (k === 1) c = flat ? 'f' : wasSoft ? (hash2(x, sy, 3) < 0.25 ? '2' : '1') : 'e';
      else {
        // parete di roccia: strati di spessore variabile, leggermente inclinati
        const sv = sy - dx * 0.1 + 1.2 * Math.sin(x * 0.17);
        let layer = 0;
        while (layer < STRATA.length - 1 && STRATA[layer + 1] <= sv) layer++;
        const inLayer = Math.floor(sv - STRATA[layer]);
        c = 'e';
        if (inLayer === 0 && hash2(x >> 2, layer, 7) > 0.3) c = 'f'; // giunto di strato
        else if (inLayer === 1 && dx > 0 && hash2(x >> 2, layer, 8) > 0.6) c = 'd'; // spigolo in luce
        if (dx < 0 && sideL && k < 4) c = 'f'; // fianco sinistro in ombra
        if (dx > 0 && sideR && k < 3 && c === 'e') c = 'd';
        if (k === 2 && flat) c = 'f'; // ombra sotto la berma
        if (c === 'e') rock.push([x, sy]);
      }
      // spritz-beton attorno al muro di testa, con bordo irregolare
      const d = dist.get(key(x, sy)) ?? 99;
      const lim = SHOT - (hash2(x >> 1, sy >> 1, 4) < 0.4 ? 1 : 0);
      if (k > 1 && d <= lim) {
        c = d === lim ? 'e' : 'd';
        if (c === 'd' && (x + sy) % 2 === 0 && (x % 3 === 0 || sy % 3 === 0) && d > 1) c = hash2(x, sy, 6) < 0.5 ? 'e' : 'd'; // rete
        const row = Math.floor((sy - 1) / 5);
        if (sy % 5 === 1 && (x + (row & 1) * 3) % 6 === 0 && d >= 2 && d < lim) c = '0'; // chiodi
      }
      g.set(x, Y(sy), c);
    }
  }

  // fratture: brevi tratti obliqui sulla roccia nuda (non sullo spritz-beton)
  const rockSet = new Set(rock.map(([x, y]) => key(x, y)));
  const fr = rng(91);
  for (let i = 0; i < 22; i++) {
    let [x, y] = rock[Math.floor(fr() * rock.length)];
    const dir = fr() < 0.5 ? -1 : 1;
    const len = 3 + Math.floor(fr() * 4);
    for (let j = 0; j < len; j++) {
      if (!rockSet.has(key(x, y))) break;
      g.set(x, Y(y), 'f');
      if (j === 0 && rockSet.has(key(x - dir, y))) g.set(x - dir, Y(y), 'd');
      y++;
      if (fr() < 0.6) x += dir;
    }
  }

  // terra smossa alla base (si raccorda con lo sterrato della piana)
  for (let x = cx - 44; x <= cx + 44; x++) {
    const top = foot - 3 - Math.round(1.5 + 1.5 * Math.sin(x * 0.37) + CUT_JAG[x]);
    for (let sy = top; sy <= foot; sy++) {
      let c = sy === top ? 'f' : hash2(x, sy, 10) < 0.18 ? '2' : '1';
      if (sy > top && hash2(x, sy, 11) < 0.12) c = 'e'; // sassi
      if (sy === foot && hash2(x, sy, 12) < 0.5) c = 'f';
      g.set(x, Y(sy), c);
    }
  }
  // massi ai piedi della parete (quelli dietro il portale restano coperti)
  const rocks: [number, number, number][] = [
    [54, foot - 1, 2.6],
    [59, foot, 1.6],
    [50, foot, 1.3],
    [124, foot - 1, 2.4],
    [128, foot, 1.5],
    [121, foot, 1.2],
  ];
  for (const [rx, ry, rr] of rocks) {
    for (let y = Math.floor(ry - rr * 1.6); y <= ry; y++) {
      for (let x = Math.floor(rx - rr - 1); x <= rx + rr + 1; x++) {
        const u = (x + 0.5 - rx) / (rr + 0.5);
        const v = (y + 0.5 - (ry + 0.5)) / (rr * 1.5);
        if (u * u + v * v > 1) continue;
        let c = u + v < -0.7 ? 'd' : u + v > 0.3 ? 'f' : 'e';
        if (y === ry) c = '0';
        g.set(x, Y(y), c);
      }
    }
  }
  // detriti minuti
  const r = rng(57);
  for (let i = 0; i < 26; i++) {
    const x = cx - 42 + Math.floor(r() * 84);
    const y = foot - Math.floor(r() * 4);
    g.set(x, Y(y), r() < 0.5 ? 'd' : 'e');
    if (r() < 0.4) g.set(x + 1, Y(y), 'f');
  }
}

// ------------------------------------------------------------ portale della galleria

/** Dentro un arco a ferro di cavallo (superellisse) di base (cx, by), mezza larghezza rx, altezza ry. */
function inArch(x: number, y: number, cx: number, by: number, rx: number, ry: number): boolean {
  if (y > by) return false;
  const u = Math.abs(x + 0.5 - cx) / rx;
  const v = Math.abs(by + 0.5 - y) / ry;
  return u ** 2.6 + v ** 2.6 <= 1;
}

/**
 * Portale 64x47 (angolo in PORTAL_X0, PORTAL_Y0): muro di testa in cemento,
 * anello ad arco, bocca nera con centine, muri d'ala, impalcatura a destra,
 * ombra della targa sopra l'arco e due lampade gialle ai lati.
 */
function portal(): SpriteData {
  const W = 64;
  const H = 47;
  const g = new Grid(W, H);
  const ox = PORTAL_X0;
  const oy = PORTAL_Y0;
  const set = (x: number, y: number, c: string) => g.set(x - ox, y - oy, c);
  const rect = (x: number, y: number, w: number, h: number, c: string) => g.rect(x - ox, y - oy, w, h, c);
  const cx = TUNNEL.x;
  const by = TUNNEL.y;
  const rx = TUNNEL.w / 2;
  const ry = TUNNEL.h;

  // muri d'ala (triangoli inclinati verso il basso, ai lati del muro di testa)
  for (let y = by - 20; y <= by; y++) {
    const t = (y - (by - 20)) / 20;
    const reach = Math.round(8 * t);
    for (let k = 1; k <= reach; k++) {
      set(cx - 21 - k, y, k === reach ? 'd' : 'e');
      set(cx + 20 + k, y, k === reach ? 'e' : 'f');
    }
  }
  // muro di testa
  const topY = HEAD_TOP;
  for (let y = topY; y <= by; y++) {
    for (let x = cx - 21; x <= cx + 20; x++) {
      let c = (x + y * 3) % 11 === 0 ? 'f' : 'e';
      if (y === topY) c = 'c';
      else if (y === topY + 1) c = 'd';
      else if (y === topY + 2) c = 'f';
      if (x === cx - 21) c = 'd';
      if (x === cx + 20) c = 'f';
      set(x, y, c);
    }
  }
  // giunti dei getti (casseri) orizzontali
  for (const jy of [topY + 15, topY + 26]) {
    for (let x = cx - 20; x <= cx + 19; x++) if (x % 3 !== 0) set(x, jy, 'f');
  }
  // anello ad arco (3 px), conci chiari
  for (let y = by - ry - 4; y <= by; y++) {
    for (let x = cx - rx - 4; x <= cx + rx + 4; x++) {
      if (!inArch(x, y, cx, by, rx + 3, ry + 3) || inArch(x, y, cx, by, rx, ry)) continue;
      const left = x < cx;
      let c = left ? 'c' : 'd';
      if (inArch(x, y, cx, by, rx + 1, ry + 1)) c = left ? 'd' : 'e'; // spigolo interno
      if ((Math.round(Math.atan2(by - y, x + 0.5 - cx) * 7) & 1) === 0 && !inArch(x, y, cx, by, rx + 2, ry + 2))
        c = left ? 'd' : 'e';
      set(x, y, c);
    }
  }
  // bocca: nero in fondo, centine d'acciaio visibili vicino all'ingresso
  for (let y = by - ry; y <= by; y++) {
    for (let x = cx - rx; x <= cx + rx; x++) {
      if (!inArch(x, y, cx, by, rx, ry)) continue;
      let c = '0';
      if (!inArch(x, y, cx, by, rx - 1, ry - 1)) c = 'f';
      else if (inArch(x, y, cx, by, rx - 3, ry - 3) && !inArch(x, y, cx, by, rx - 4, ry - 4)) c = 'e';
      else if (inArch(x, y, cx, by, rx - 6, ry - 6) && !inArch(x, y, cx, by, rx - 7, ry - 7)) c = 'f';
      set(x, y, c);
    }
  }
  // fondo stradale che entra nella galleria, in ombra, e luci di lavoro in fondo
  for (let x = cx - 5; x <= cx + 5; x++) {
    set(x, by, x % 2 ? '1' : '3');
    if (Math.abs(x - cx) < 4) set(x, by - 1, '1');
  }
  set(cx - 3, by - 9, '4');
  set(cx + 2, by - 9, '3');

  // impalcatura sul fianco destro: montanti, traversi e tavole
  for (const px of [cx + 22, cx + 28]) {
    for (let y = by - 26; y <= by; y++) set(px, y, 'd');
  }
  for (const py of [by - 24, by - 14, by - 4]) {
    rect(cx + 20, py, 11, 1, '4');
    rect(cx + 20, py + 1, 11, 1, '3');
  }
  for (let i = 0; i < 2; i++) {
    const y0 = by - 22 + i * 10;
    for (let k = 0; k <= 8; k++) set(cx + 22 + Math.round(k * 0.75), y0 + k, 'e');
  }

  // ombra della targa sul muro di testa (la targa è la texture 'site-tunnel-sign')
  const sw = spriteSize(TUNNEL_SIGN_ROWS).w;
  const sh = TUNNEL_SIGN_ROWS.length;
  rect(TUNNEL_SIGN.x + 1, TUNNEL_SIGN.y + sh, sw, 1, 'f');
  rect(TUNNEL_SIGN.x + sw, TUNNEL_SIGN.y + 1, 1, sh, 'f');

  // lampade gialle ai lati della bocca (statiche) su una staffa
  for (const l of TUNNEL_LAMPS) {
    rect(l.x, l.y, 3, 1, '0');
    set(l.x + 1, l.y + 1, '4');
    set(l.x, l.y + 1, '3');
    set(l.x + 2, l.y + 1, '3');
    set(l.x + 1, l.y + 2, 'c');
    rect(l.x, l.y + 3, 3, 1, '0');
  }
  return g.rows();
}

// ------------------------------------------------------------ targa della galleria (micro-font 3x5)

/**
 * Micro-font 3x5 (alcune lettere strette a 2 o 1 px) fatto a mano, solo per
 * le lettere della targa: '1' = pixel acceso.
 */
const MICRO_FONT: Record<string, readonly string[]> = {
  G: ['011', '100', '101', '101', '011'],
  A: ['010', '101', '111', '101', '101'],
  L: ['10', '10', '10', '10', '11'],
  E: ['11', '10', '11', '10', '11'],
  R: ['110', '101', '110', '101', '101'],
  I: ['1', '1', '1', '1', '1'],
};

/**
 * Targa stradale della galleria: scritta bianca su fondo blu, bordo nero,
 * 1 px di margine attorno al testo (larga quanto l'anello dell'arco).
 */
function tunnelSign(text: string): SpriteData {
  const glyphs = [...text].map((ch) => MICRO_FONT[ch]);
  const tw = glyphs.reduce((s, gl) => s + gl[0].length, 0) + glyphs.length - 1;
  const g = new Grid(tw + 4, 9);
  g.rect(0, 0, tw + 4, 9, '0');
  g.rect(1, 1, tw + 2, 7, '9');
  g.rect(1, 1, tw + 2, 1, 'a'); // filo di luce in alto
  let x = 2;
  for (const gl of glyphs) {
    gl.forEach((row, j) => [...row].forEach((b, i) => b === '1' && g.set(x + i, 2 + j, 'c')));
    x += gl[0].length + 1;
  }
  return g.rows();
}
const TUNNEL_SIGN_ROWS = tunnelSign(TUNNEL_SIGN.text);

// ------------------------------------------------------------ piana: terreno + strada a curve

/**
 * Piana 180 x (320 - PLAIN_Y0), disegnata riga per riga: sterrato del cantiere
 * (prugna in lontananza → carbone davanti) con sassi che crescono con la
 * vicinanza, strada di sabbia larga roadAtY(y).w con bordi scuri, solchi delle
 * ruote a ±w/4 e granelli; da GROUND_Y in giù la ghiaia compatta del terreno
 * di gioco con la strada battuta che arriva al bordo basso.
 */
function plain(): SpriteData {
  const W = 180;
  const H = 320 - PLAIN_Y0;
  const g = new Grid(W, H);
  const r = rng(29);
  for (let y = PLAIN_Y0; y < 320; y++) {
    const gy = y - PLAIN_Y0;
    const s = scaleAtY(Math.max(TUNNEL.y, y));
    const t = (y - PLAIN_Y0) / (GROUND_Y - PLAIN_Y0);
    const hasRoad = y >= TUNNEL.y;
    const p = roadAtY(y);
    const L = Math.round(p.x - p.w / 2);
    const R = Math.round(p.x + p.w / 2);
    const edge = Math.max(1, Math.round(3 * s));
    const shoulder = Math.max(1, Math.round(4 * s));
    const rutW = Math.max(1, Math.round(4 * s));
    const ruts = p.w > 15 ? [p.x - p.w * 0.25, p.x + p.w * 0.25] : [];
    const ground = y >= GROUND_Y;
    for (let x = 0; x < W; x++) {
      if (y < mountainFootY(x)) continue;
      let c: string;
      const onRoad = hasRoad && x >= L && x <= R;
      if (ground) {
        // terreno di gioco: bordo netto, ghiaia compatta più scura in basso
        const k = (y - GROUND_Y) / (319 - GROUND_Y);
        if (y === GROUND_Y) c = onRoad ? '2' : '0';
        else if (y === GROUND_Y + 1) c = onRoad ? '4' : 'd';
        else if (onRoad) {
          c = x - L < edge || R - x < edge ? '3' : k * 0.8 > bayer(x, y) ? '3' : '4';
          if (r() < 0.04) c = '2';
        } else {
          c = k * 0.9 > bayer(x, y) ? 'f' : 'e';
          if (y > GROUND_Y + 1 && r() < 0.015) c = '4';
        }
        g.set(x, gy, c);
        continue;
      }
      if (onRoad) {
        const dl = x - L;
        const dr = R - x;
        c = '4';
        if (Math.min(dl, dr) === 0) c = '2';
        else if (Math.min(dl, dr) < edge) c = '3';
        else if (ruts.some((rx) => Math.abs(x + 0.5 - rx) <= rutW / 2)) c = r() < 0.85 ? '3' : '2';
        else if (r() < 0.07) c = '3';
        else if (r() < 0.012 + 0.02 * s) c = 'c';
        if (y < TUNNEL.y + 3) c = c === '4' ? '3' : '1'; // ombra della galleria
      } else {
        // sterrato: prugna lontano, carbone vicino, a retino
        c = Math.min(1, t * 1.15) > bayer(x, y) ? 'f' : '1';
        if (r() < 0.03 * (1 - t)) c = '2';
        // sabbia schizzata fuori dalla strada (spalla)
        if (hasRoad && ((x < L && L - x <= shoulder) || (x > R && x - R <= shoulder))) {
          c = r() < 0.55 ? '3' : '2';
          if (Math.abs(x - (x < L ? L : R)) === shoulder) c = r() < 0.5 ? '2' : c;
        }
      }
      g.set(x, gy, c);
    }
  }
  // sassi sullo sterrato: più grandi e più radi davanti, minuscoli in fondo
  for (let i = 0; i < 90; i++) {
    const y = PLAIN_Y0 + 8 + Math.floor(r() * (GROUND_Y - PLAIN_Y0 - 12));
    const x = Math.floor(r() * W);
    const p = roadAtY(y);
    const s = scaleAtY(y);
    const size = s > 0.6 ? 3 : s > 0.32 ? 2 : 1;
    if (Math.abs(x - p.x) < p.w / 2 + size + 3) continue;
    const gy = y - PLAIN_Y0;
    if (g.get(x, gy) === '.') continue;
    if (size === 1) {
      g.set(x, gy, 'e');
      continue;
    }
    g.rect(x, gy - size + 1, size, size - 1, 'e');
    g.rect(x, gy - size + 1, size - 1, 1, 'd');
    g.rect(x, gy, size, 1, '0');
  }
  return g.rows();
}

// ------------------------------------------------------------ oggetti del cantiere (in 2-3 taglie)

const CONE_L: SpriteData = [
  '....0....',
  '...030...',
  '...030...',
  '..0ccd0..',
  '..03320..',
  '..03320..',
  '.0cccdd0.',
  '.0333220.',
  '000000000',
  '0ffffffe0',
  '000000000',
];
const CONE_M: SpriteData = [
  '...0...',
  '..030..',
  '..0c0..',
  '.03320.',
  '.0ccd0.',
  '.03320.',
  '0000000',
  '0ffffe0',
  '0000000',
];
const CONE_S: SpriteData = ['..0..', '.030.', '.0c0.', '03320', '00000'];

/** Transenna w x h a strisce bianche e rosse su due cavalletti. */
function barrier(w: number, h: number): SpriteData {
  const g = new Grid(w, h);
  const ph = Math.max(2, Math.round(h * 0.4)); // altezza della tavola
  const stripe = Math.max(2, Math.round(w / 7));
  for (const lx of [Math.round(w * 0.14), w - 1 - Math.round(w * 0.18)]) {
    g.line(lx, ph, lx - Math.max(1, Math.round(h * 0.15)), h - 1, 'e');
    g.line(lx + 1, ph, lx + 1 + Math.max(1, Math.round(h * 0.2)), h - 1, 'f');
  }
  for (let y = 1; y <= ph; y++) {
    for (let x = 1; x < w - 1; x++) g.set(x, y, Math.floor((x + y) / stripe) % 2 ? '2' : 'c');
  }
  if (ph > 2) g.rect(1, ph, w - 2, 1, '1');
  g.outline('0');
  return g.rows();
}

/** Cumulo di terra w x h: prugna, lato sinistro rosso illuminato, sassi. */
function mound(w: number, h: number, seed: number): SpriteData {
  const g = new Grid(w, h);
  const r = rng(seed);
  const cx = w / 2;
  const rx = w / 2 - 1;
  const ry = h - 1.5;
  for (let y = 0; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const u = (x + 0.5 - cx) / rx;
      const v = (h - 1 - (y + 0.5)) / ry;
      if (u * u + v * v > 1 + (r() - 0.5) * 0.15) continue;
      const lit = -u * 0.8 + v * 0.6;
      let c = lit > 0.45 ? '2' : lit < -0.35 ? 'f' : '1';
      if (r() < 0.06) c = 'e';
      g.set(x, y, c);
    }
  }
  g.outline('0');
  return g.rows();
}

/** Tubi di cemento impilati visti di testa (3 sotto, 2 sopra), raggio rr. */
function pipes(rr: number): SpriteData {
  const d = Math.round(rr * 2);
  const w = d * 3 + 2;
  const h = Math.round(d * 1.85) + 2;
  const g = new Grid(w, h);
  const centers: [number, number][] = [
    [1 + rr, h - 1 - rr],
    [1 + rr + d, h - 1 - rr],
    [1 + rr + d * 2, h - 1 - rr],
    [1 + rr + d / 2, h - 1 - rr - d * 0.85],
    [1 + rr + d * 1.5, h - 1 - rr - d * 0.85],
  ];
  for (const [cx, cy] of centers) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const dist = Math.hypot(dx, dy);
        if (dist > rr - 0.1) continue;
        let c: string;
        if (dist < rr * 0.5) c = dist < rr * 0.5 - 1 ? '0' : 'f';
        else c = dx + dy < -rr * 0.5 ? 'c' : dx + dy > rr * 0.6 ? 'e' : 'd';
        g.set(x, y, c);
      }
    }
  }
  g.outline('0');
  return g.rows();
}

/** Baracca di cantiere w x h: pareti bianche, fascia blu, finestra, porta, tetto scuro. */
function cabin(w: number, h: number): SpriteData {
  const g = new Grid(w, h);
  const roof = Math.max(1, Math.round(h * 0.12));
  const feet = Math.max(1, Math.round(h * 0.1));
  const wallB = h - 1 - feet - 1;
  g.rect(1, 1, w - 2, roof, 'e');
  g.rect(1, 1 + roof, w - 2, wallB - roof, 'c');
  g.rect(w - 2 - Math.max(1, Math.round(w * 0.08)), 1 + roof, Math.max(1, Math.round(w * 0.08)), wallB - roof, 'd');
  const band = Math.max(1, Math.round(h * 0.1));
  g.rect(1, wallB - band, w - 2, band, '9');
  // finestra
  const ww = Math.max(2, Math.round(w * 0.3));
  const wh = Math.max(1, Math.round(h * 0.28));
  const wx = Math.round(w * 0.14);
  const wy = 1 + roof + Math.max(1, Math.round(h * 0.12));
  g.rect(wx, wy, ww, wh, 'a');
  if (ww > 3 && wh > 2) {
    g.set(wx, wy, 'b');
    g.rect(wx + Math.floor(ww / 2), wy, 1, wh, 'f');
  }
  // porta
  const dw = Math.max(2, Math.round(w * 0.16));
  const dx = Math.round(w * 0.62);
  g.rect(dx, wy - 1, dw, wallB - wy + 1, 'e');
  if (h > 12) g.set(dx + dw - 2, Math.round((wy + wallB) / 2), '4');
  // piedini
  for (const fx of [2, w - 4]) g.rect(fx, wallB, 2, feet, 'f');
  g.outline('0');
  return g.rows();
}

/** Escavatore lontano 26x16: giallo, braccio alzato, cingoli scuri. */
function excavator(): SpriteData {
  const g = new Grid(26, 16);
  // cingoli
  g.rect(8, 12, 16, 3, 'f');
  for (let x = 10; x < 23; x += 3) g.set(x, 13, 'e');
  // corpo e cabina
  g.rect(9, 8, 15, 4, '4');
  g.rect(9, 11, 15, 1, '3');
  g.rect(17, 3, 6, 5, '4');
  g.rect(18, 4, 4, 3, 'a');
  g.set(18, 4, 'b');
  g.rect(22, 3, 1, 9, '3');
  // braccio: dal corpo in alto a sinistra, avambraccio giù, benna
  g.line(11, 8, 6, 1, '4');
  g.line(12, 8, 7, 1, '3');
  g.line(6, 1, 2, 8, '4');
  g.line(7, 2, 3, 9, '3');
  g.rect(1, 9, 3, 3, 'f');
  g.set(0, 11, 'e');
  g.outline('0');
  return g.rows();
}

/** Mattoni impilati su un bancale di legno, 16x12. */
function bricks(): SpriteData {
  const g = new Grid(16, 12);
  for (let y = 1; y < 9; y++) {
    for (let x = 1; x < 15; x++) {
      const course = Math.floor((y - 1) / 3);
      const row = (y - 1) % 3;
      const joint = (x + (course % 2) * 2) % 5 === 0;
      if (y < 4 && x > 10) continue; // pila a gradino
      g.set(x, y, row === 2 || joint ? '1' : row === 0 ? '3' : '2');
    }
  }
  g.rect(0, 9, 16, 1, '3');
  g.rect(1, 10, 2, 1, '1');
  g.rect(7, 10, 2, 1, '1');
  g.rect(13, 10, 2, 1, '1');
  g.outline('0');
  return g.rows();
}

/** Pannello "LAVORI IN CORSO" 56x40: tabella bianca bordata di rosso su due pali. */
function sign(): SpriteData {
  const g = new Grid(56, 40);
  for (const px of [11, 42]) {
    g.rect(px, 22, 1, 18, 'e');
    g.rect(px + 1, 22, 1, 18, 'f');
  }
  g.rect(1, 1, 54, 22, '2');
  g.rect(2, 2, 52, 20, 'c');
  g.rect(2, 21, 52, 1, 'd');
  g.outline('0');
  return g.rows();
}

// ------------------------------------------------------------ bordi: tubi d'impalcatura

/** Tubo verticale 8x32 con un giunto: bordo laterale della zona di gioco. */
function pole(): SpriteData {
  const g = new Grid(8, 32);
  for (let y = 0; y < 32; y++) {
    g.set(1, y, '0');
    g.set(2, y, 'd');
    g.set(3, y, 'e');
    g.set(4, y, 'e');
    g.set(5, y, 'f');
    g.set(6, y, '0');
  }
  g.rect(0, 12, 8, 1, '0');
  g.rect(0, 16, 8, 1, '0');
  g.rect(0, 13, 1, 3, '0');
  g.rect(7, 13, 1, 3, '0');
  g.rect(1, 13, 6, 1, 'd');
  g.rect(1, 14, 6, 2, 'f');
  g.set(3, 14, 'e');
  return g.rows();
}

/** Tubo orizzontale 32x4 sotto l'HUD, con un giunto ogni 32 px. */
function pipe(): SpriteData {
  const g = new Grid(32, 4);
  for (let x = 0; x < 32; x++) {
    g.set(x, 0, '0');
    g.set(x, 1, 'd');
    g.set(x, 2, 'e');
    g.set(x, 3, '0');
  }
  g.rect(14, 1, 3, 2, 'f');
  return g.rows();
}

// ------------------------------------------------------------ registrazione

export const SITE_SPRITES: Record<string, SpriteData> = {
  'site-sky': sky(),
  'site-cloud-a': cloud(26, 10, [
    [7, 6, 4.5],
    [14, 4.5, 5],
    [20, 6.5, 4],
  ]),
  'site-cloud-b': cloud(16, 7, [
    [5, 4.5, 3.5],
    [10, 3.5, 4],
  ]),
  'site-mountain': mountain(),
  'site-portal': portal(),
  'site-tunnel-sign': TUNNEL_SIGN_ROWS,
  'site-plain': plain(),
  'site-cone-l': CONE_L,
  'site-cone-m': CONE_M,
  'site-cone-s': CONE_S,
  'site-barrier-l': barrier(26, 13),
  'site-barrier-m': barrier(16, 8),
  'site-barrier-s': barrier(10, 5),
  'site-mound-l': mound(36, 13, 3),
  'site-mound-m': mound(24, 9, 5),
  'site-mound-s': mound(14, 5, 9),
  'site-pipes-l': pipes(4.5),
  'site-pipes-m': pipes(3),
  'site-cabin-m': cabin(34, 20),
  'site-cabin-s': cabin(18, 10),
  'site-excavator': excavator(),
  'site-bricks': bricks(),
  'site-sign': sign(),
  'site-pole': pole(),
  'site-pipe': pipe(),
};

/** Crea le texture del cantiere (idempotente: le chiavi esistenti vengono saltate). */
export function registerSiteSprites(scene: Phaser.Scene): void {
  makeSprites(scene, SITE_SPRITES);
}

/**
 * Texture del cielo sopra lo 0 per l'altezza attuale (SCREEN.extra righe):
 * una chiave per altezza, così dopo un cambio di schermo si crea quella nuova.
 */
export function siteSkyTopKey(scene: Phaser.Scene): string {
  return makeSprite(scene, `site-sky-top-${SCREEN.extra}`, skyTop(SCREEN.extra));
}
