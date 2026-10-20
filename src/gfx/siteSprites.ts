import Phaser from 'phaser';
import { makeSprites, type SpriteData } from './pixelSprite';

/**
 * Sprite del cantiere (sfondo di gioco e menu), sempre come array di stringhe
 * con indici palette Sweetie 16 ('.' = vuoto):
 *   0 black 1 plum 2 red 3 orange 4 yellow 5 lime 6 green 7 teal
 *   8 navy 9 blue a sky b cyan c white d silver e slate f charcoal
 *
 * Gli oggetti piccoli sono disegnati a mano; i tile di terreno, il cielo e le
 * forme più grandi sono generati qui sotto con un piccolo "foglio a quadretti"
 * (Grid) e un generatore pseudo-casuale con seme fisso: il risultato è sempre
 * lo stesso array di stringhe, cambia solo il modo di scriverlo.
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

// ------------------------------------------------------------ cielo

/** Striscia verticale 8x160 ripetuta in orizzontale: blu → azzurro → ciano a retino. */
function sky(): SpriteData {
  const g = new Grid(8, 160);
  const bands: [number, string][] = [
    [0, '9'],
    [48, 'a'],
    [104, 'b'],
  ];
  const ramp = 10; // altezza del retino tra due bande
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

/** Nuvola: unione di cerchi bianchi, pancia ombreggiata in argento. */
function cloud(w: number, h: number, blobs: [number, number, number][]): SpriteData {
  const g = new Grid(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inside = blobs.some(([cx, cy, r]) => (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r);
      if (inside && y < h - 1) g.set(x, y, y >= h - 3 ? 'd' : 'c');
    }
  }
  // fondo piatto
  for (let x = 0; x < w; x++) if (g.get(x, h - 2) !== '.') g.set(x, h - 1, 'd');
  return g.rows();
}

/** Città lontana 64x24 ripetibile: sagome argento con finestrine ciano. */
function skyline(): SpriteData {
  const g = new Grid(64, 24, true);
  const r = rng(7);
  // fila dietro (più alta, argento)
  let x = 0;
  while (x < 64) {
    const w = 6 + Math.floor(r() * 7);
    const h = 9 + Math.floor(r() * 13);
    g.rect(x, 24 - h, w - 1, h, 'd');
    // finestrine
    for (let wy = 24 - h + 2; wy < 22; wy += 3) {
      for (let wx = x + 1; wx < x + w - 2; wx += 2) if (r() < 0.45) g.set(wx, wy, 'b');
    }
    if (r() < 0.35) g.rect(x + Math.floor(w / 2) - 1, 24 - h - 2, 1, 2, 'd'); // antenna
    x += w + (r() < 0.3 ? 2 : 0);
  }
  // fila davanti, bassa, ardesia chiara a retino
  x = 3;
  while (x < 64) {
    const w = 5 + Math.floor(r() * 6);
    const h = 4 + Math.floor(r() * 5);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) g.set(x + i, 24 - h + j, (i + j) % 2 ? 'd' : 'e');
    x += w + 4 + Math.floor(r() * 8);
  }
  return g.rows();
}

// ------------------------------------------------------------ edificio in costruzione

/** Scheletro di un palazzo 58x106: pilastri e solai grigi, impalcatura a sinistra. */
function building(): SpriteData {
  const g = new Grid(58, 106);
  const cols = [9, 25, 41, 54];
  const slabs = [30, 56, 82, 103];
  const tops = [6, 14, 30, 30]; // dove finiscono i pilastri (ultimo piano non finito)

  // controventi a X in due campate
  const brace = (x0: number, y0: number, x1: number, y1: number) => {
    g.line(x0, y0, x1, y1, 'e');
    g.line(x1, y0, x0, y1, 'e');
  };
  brace(28, 59, 41, 82);
  brace(44, 33, 54, 56);

  // tamponamento in mattoni (solo in basso a sinistra, a metà)
  for (let y = 90; y < 103; y++) {
    for (let x = 12; x < 25; x++) {
      const course = Math.floor((y - 90) / 3);
      const row = (y - 90) % 3;
      const joint = (x + (course % 2) * 2) % 5 === 0;
      const top = y === 90 && (x % 4 === 1 || x % 7 === 3); // bordo superiore frastagliato
      if (top) continue;
      g.set(x, y, row === 2 || joint ? '1' : row === 0 ? '3' : '2');
    }
  }

  // pilastri (3 px: luce, corpo, ombra)
  cols.forEach((cx, i) => {
    for (let y = tops[i]; y < 106; y++) {
      g.set(cx, y, 'd');
      g.set(cx + 1, y, 'e');
      g.set(cx + 2, y, 'f');
    }
  });
  // solai
  slabs.forEach((sy) => {
    g.rect(7, sy, 51, 1, 'd');
    g.rect(7, sy + 1, 51, 1, 'e');
    g.rect(7, sy + 2, 51, 1, 'f');
  });
  // impalcatura: due montanti sottili e tavole di legno ai piani
  for (let y = 20; y < 106; y++) {
    g.set(1, y, 'd');
    g.set(5, y, 'd');
  }
  for (let y = 22; y + 24 <= 106; y += 26) g.line(1, y + 24, 5, y + 2, 'e');
  [28, 54, 80].forEach((py) => {
    g.rect(0, py, 8, 1, '4');
    g.rect(0, py + 1, 8, 1, '3');
  });

  g.outline('0');

  // ferri d'armatura sopra i pilastri non finiti (dopo il contorno: 1 px)
  cols.forEach((cx, i) => {
    const t = tops[i];
    if (i === 3) return;
    g.set(cx, t - 2, 'f');
    g.set(cx, t - 3, 'f');
    g.set(cx + 2, t - 2, 'f');
    g.set(cx + 2, t - 4, 'f');
  });
  return g.rows();
}

// ------------------------------------------------------------ recinzione e cartello

/** Rete da cantiere arancione 16x18 con paletto ogni 16 px (ripetibile). */
function fence(): SpriteData {
  const g = new Grid(16, 18);
  for (let y = 0; y < 18; y++) {
    for (let x = 0; x < 16; x++) {
      if (x <= 2) {
        // paletto metallico
        g.set(x, y, x === 0 || x === 2 ? '0' : y === 0 ? 'd' : 'e');
        continue;
      }
      if (y === 1 || y === 15) g.set(x, y, '3'); // corde di tensione
      else if (y > 1 && y < 15 && ((x + y) % 4 === 0 || (x - y + 64) % 4 === 0)) g.set(x, y, y > 10 ? '2' : '3');
    }
  }
  return g.rows();
}

/** Pannello "LAVORI IN CORSO" 56x46: tabella bianca bordata di rosso su due pali. */
function sign(): SpriteData {
  const g = new Grid(56, 46);
  // pali
  for (const px of [11, 42]) {
    g.rect(px, 22, 1, 24, 'e');
    g.rect(px + 1, 22, 1, 24, 'f');
  }
  g.rect(1, 1, 54, 22, '2');
  g.rect(2, 2, 52, 20, 'c');
  g.rect(2, 21, 52, 1, 'd'); // ombra interna in basso
  g.outline('0');
  return g.rows();
}

// ------------------------------------------------------------ oggetti del cantiere

const CONE: SpriteData = [
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

const SANDBAG: SpriteData = [
  '.000000.',
  '0dcddcd0',
  '0ddddde0',
  '0eddeee0',
  '.000000.',
];

function sandbags(): SpriteData {
  const g = new Grid(24, 10);
  [0, 8, 16].forEach((x) => g.blit(SANDBAG, x, 5));
  [4, 12].forEach((x) => g.blit(SANDBAG, x, 1));
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
  g.rect(0, 9, 16, 1, '3'); // bancale
  g.rect(1, 10, 2, 1, '1');
  g.rect(7, 10, 2, 1, '1');
  g.rect(13, 10, 2, 1, '1');
  g.outline('0');
  return g.rows();
}

/** Betoniera 28x24: tamburo arancio inclinato, telaio grigio, due ruote. */
function mixer(): SpriteData {
  const g = new Grid(28, 24);
  const cx = 13;
  const cy = 9;
  const rx = 10;
  const ry = 7.5;
  // telaio e motore (dietro al tamburo)
  g.line(7, 14, 4, 21, 'e');
  g.line(19, 14, 22, 21, 'e');
  g.rect(18, 12, 7, 6, 'f');
  g.rect(18, 12, 7, 1, 'e');
  g.rect(24, 15, 3, 1, 'e'); // manico
  // tamburo
  for (let y = 0; y < 24; y++) {
    for (let x = 0; x < 28; x++) {
      const u = (x + 0.5 - cx) / rx;
      const v = (y + 0.5 - cy) / ry;
      if (u * u + v * v > 1) continue;
      const lit = u + v;
      let c = lit > 0.7 ? '2' : lit < -0.9 ? '4' : '3';
      // due fasce diagonali
      const k = x - cx - (y - cy) * 0.6;
      if (Math.abs(k + 4) < 0.8 || Math.abs(k - 4) < 0.8) c = lit > 0.7 ? '1' : '2';
      g.set(x, y, c);
    }
  }
  // bocca del tamburo in alto a sinistra
  for (let y = 0; y < 6; y++) {
    for (let x = 1; x < 10; x++) {
      const u = (x + 0.5 - 5.5) / 3.6;
      const v = (y + 0.5 - 3) / 2.2;
      const d = u * u + v * v;
      if (d <= 0.45) g.set(x, y, 'f');
      else if (d <= 1) g.set(x, y, 'e');
    }
  }
  g.outline('0');
  // ruote (sopra il contorno, con il proprio bordo)
  for (const wx of [6, 20]) {
    for (let y = 18; y < 24; y++) {
      for (let x = wx - 3; x <= wx + 3; x++) {
        const d = (x - wx) ** 2 + (y - 20.5) ** 2;
        if (d <= 3.2) g.set(x, y, d < 1 ? 'd' : 'f');
        else if (d <= 8.5) g.set(x, y, '0');
      }
    }
  }
  return g.rows();
}

/** Transenna bassa 26x13 a strisce bianche e rosse su due cavalletti. */
function barrier(): SpriteData {
  const g = new Grid(26, 13);
  for (const lx of [3, 21]) {
    g.line(lx, 5, lx - 2, 12, 'e');
    g.line(lx + 1, 5, lx + 3, 12, 'f');
  }
  for (let y = 1; y < 6; y++) {
    for (let x = 1; x < 25; x++) g.set(x, y, Math.floor((x + y) / 4) % 2 ? '2' : 'c');
  }
  g.rect(1, 5, 24, 1, '1');
  g.outline('0');
  return g.rows();
}

// ------------------------------------------------------------ terreni

/** Sterrato stretto tra l'orizzonte e la strada, 32x8 ripetibile. */
function backDirt(): SpriteData {
  const g = new Grid(32, 8);
  const r = rng(11);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 32; x++) {
      let c = y === 0 ? 'e' : (y + x) % 2 && y < 3 ? 'e' : 'f';
      if (r() < 0.1) c = '1';
      g.set(x, y, c);
    }
  }
  return g.rows();
}

/** Strada di sabbia 32x18: solchi delle ruote, granelli, bordi irregolari. */
function road(): SpriteData {
  const g = new Grid(32, 18);
  const r = rng(23);
  const ruts = [4, 5, 12, 13];
  for (let y = 0; y < 18; y++) {
    for (let x = 0; x < 32; x++) {
      let c = '4';
      if (y === 0) c = r() < 0.7 ? '3' : '.';
      else if (y === 1) c = r() < 0.3 ? '3' : '4';
      else if (y === 16) c = r() < 0.35 ? '3' : '4';
      else if (y === 17) c = r() < 0.55 ? '3' : r() < 0.5 ? '2' : '.';
      else if (ruts.includes(y)) {
        // solchi: riga alta più scura, riga bassa illuminata a tratti
        const lower = y === 5 || y === 13;
        c = lower ? (r() < 0.6 ? '3' : '4') : r() < 0.85 ? '3' : '2';
        if (!lower && r() < 0.08) c = '2';
      } else if (r() < 0.09) c = '3';
      else if (r() < 0.03) c = 'c';
      g.set(x, y, c);
    }
  }
  return g.rows();
}

/** Terra sotto la strada 32x106: argilla scura che sfuma in carbone, sassolini. */
function dirt(): SpriteData {
  const H = 106;
  const g = new Grid(32, H);
  const r = rng(41);
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1);
    for (let x = 0; x < 32; x++) {
      // 1 (prugna) in alto → f (carbone) in basso, a retino
      let c = Math.min(1, t * 1.35) > bayer(x, y) ? 'f' : '1';
      if (y < 3) c = (x + y) % 3 === 0 ? '2' : '1'; // terra smossa al bordo strada
      if (r() < 0.025 * (1 - t)) c = '2';
      if (r() < 0.04 * t) c = '0';
      g.set(x, y, c);
    }
  }
  // sassolini: luce in alto, ombra sotto
  for (let i = 0; i < 14; i++) {
    const x = Math.floor(r() * 32);
    const y = 4 + Math.floor(r() * (H - 10));
    const w = r() < 0.5 ? 2 : 1;
    g.rect(x, y, w, 1, 'e');
    g.set(x, y - 1, 'd');
    g.rect(x, y + 1, w, 1, '0');
  }
  g.rect(0, H - 1, 32, 1, '0'); // linea netta sopra il terreno di gioco
  return g.rows();
}

/** Ghiaia compatta del terreno di gioco 32x28: bordo chiaro netto, più scura in basso. */
function ground(): SpriteData {
  const g = new Grid(32, 28);
  const r = rng(53);
  for (let y = 0; y < 28; y++) {
    const t = y / 27;
    for (let x = 0; x < 32; x++) {
      let c: string;
      if (y === 0) c = 'd';
      else if (y === 1) c = r() < 0.3 ? 'd' : 'e';
      else c = t * 0.9 > bayer(x, y) ? 'f' : 'e';
      if (y > 1 && r() < 0.015) c = '4'; // granelli di sabbia
      g.set(x, y, c);
    }
  }
  for (let i = 0; i < 12; i++) {
    const x = Math.floor(r() * 32);
    const y = 3 + Math.floor(r() * 23);
    g.rect(x, y, 2, 1, 'd');
    g.rect(x, y + 1, 2, 1, '0');
  }
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
  // giunto
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
  'site-skyline': skyline(),
  'site-building': building(),
  'site-fence': fence(),
  'site-sign': sign(),
  'site-cone': CONE,
  'site-sandbags': sandbags(),
  'site-bricks': bricks(),
  'site-mixer': mixer(),
  'site-barrier': barrier(),
  'site-backdirt': backDirt(),
  'site-road': road(),
  'site-dirt': dirt(),
  'site-ground': ground(),
  'site-pole': pole(),
  'site-pipe': pipe(),
};

/** Crea le texture del cantiere (idempotente: le chiavi esistenti vengono saltate). */
export function registerSiteSprites(scene: Phaser.Scene): void {
  makeSprites(scene, SITE_SPRITES);
}
