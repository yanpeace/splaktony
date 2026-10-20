import Phaser from 'phaser';
import { ROOM_INNER, SCIFI } from '../config/balance';
import { col } from '../config/palette';
import { acquireImage, releaseImage } from '../gfx/effects';
import { makeSprite, type SpriteData } from '../gfx/pixelSprite';

/**
 * Helper delle armi di fantascienza:
 *  - PixelGrid: piccolo "pennello" per disegnare sprite pixel art da codice
 *    (rettangoli, dischi, linee) e ottenere SpriteData;
 *  - ViewModel: l'arma impugnata disegnata in basso a destra, sopra l'HUD,
 *    che si inclina a scatti verso il dito (shear a pixel interi), rincula e
 *    cambia frame (canne che girano, bagliori);
 *  - DotLayer: un solo Graphics riusato per disegnare pixel effimeri
 *    (traccianti, saette, raggi) senza creare oggetti a ogni colpo.
 */

// ---------------------------------------------------------------- PixelGrid

export class PixelGrid {
  private cells: string[][];

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.cells = Array.from({ length: h }, () => Array.from({ length: w }, () => '.'));
  }

  px(x: number, y: number, c: string): this {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi >= 0 && yi >= 0 && xi < this.w && yi < this.h) this.cells[yi][xi] = c;
    return this;
  }

  rect(x: number, y: number, w: number, h: number, c: string): this {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, c);
    return this;
  }

  hline(x: number, y: number, len: number, c: string): this {
    return this.rect(x, y, len, 1, c);
  }

  vline(x: number, y: number, len: number, c: string): this {
    return this.rect(x, y, 1, len, c);
  }

  /** Rettangolo pieno con bordo di 1px e angoli smussati. */
  box(x: number, y: number, w: number, h: number, fill: string, outline = '0'): this {
    this.rect(x + 1, y, w - 2, h, outline).rect(x, y + 1, w, h - 2, outline);
    this.rect(x + 1, y + 1, w - 2, h - 2, fill);
    return this;
  }

  /** Disco pieno (centro anche a mezzo pixel, es. 12.5). */
  disc(cx: number, cy: number, r: number, c: string): this {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r + r * 0.6) this.px(x, y, c);
      }
    }
    return this;
  }

  /** Disco con bordo. */
  ball(cx: number, cy: number, r: number, fill: string, outline = '0'): this {
    return this.disc(cx, cy, r, outline).disc(cx, cy, r - 1, fill);
  }

  /** Linea (Bresenham) spessa `t` px. */
  line(x0: number, y0: number, x1: number, y1: number, c: string, t = 1): this {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / n);
      const y = Math.round(y0 + ((y1 - y0) * i) / n);
      this.rect(x, y, t, t, c);
    }
    return this;
  }

  /** Copia speculare della metà sinistra sulla destra (per sagome simmetriche). */
  mirrorX(): this {
    for (const row of this.cells) {
      for (let x = 0; x < Math.floor(this.w / 2); x++) row[this.w - 1 - x] = row[x];
    }
    return this;
  }

  /** Sostituisce un colore con un altro (varianti di bagliore). */
  swap(from: string, to: string): this {
    for (const row of this.cells) for (let x = 0; x < row.length; x++) if (row[x] === from) row[x] = to;
    return this;
  }

  clone(): PixelGrid {
    const g = new PixelGrid(this.w, this.h);
    g.cells = this.cells.map((r) => [...r]);
    return g;
  }

  rows(): SpriteData {
    return this.cells.map((r) => r.join(''));
  }
}

/** Disco di energia (bordo, interno, nucleo): usato da raggi e plasma. */
export function energyBall(r: number, outer: string, inner: string, core: string): SpriteData {
  const d = r * 2 + 1;
  const g = new PixelGrid(d, d);
  g.disc(r, r, r, outer);
  if (r >= 2) g.disc(r, r, r - 1, inner);
  if (r >= 3) g.disc(r - 0.5, r - 0.5, Math.max(1, r - 3), core);
  else g.px(r, r, core);
  return g.rows();
}

/**
 * Inclina uno sprite a pixel interi: la riga in basso resta ferma, quella in
 * alto si sposta di `top` px (negativo = a sinistra). `pad` = margine per lato.
 */
export function shearSprite(rows: SpriteData, top: number, pad: number): string[] {
  const h = rows.length;
  return rows.map((r, i) => {
    const s = h > 1 ? Math.round((top * (h - 1 - i)) / (h - 1)) : 0;
    const left = pad + s;
    return '.'.repeat(left) + r + '.'.repeat(2 * pad - left);
  });
}

// ---------------------------------------------------------------- ViewModel

export interface ViewModelOpts {
  /** prefisso delle texture */
  key: string;
  /** frame di animazione (stesse dimensioni), disegnati "dritti" con la bocca in alto */
  frames: readonly SpriteData[];
  /** riga e colonna della bocca nello sprite dritto */
  muzzleRow: number;
  muzzleCol?: number;
}

/**
 * Arma a schermo: un'immagine dal pool condiviso, ancorata in basso
 * (SCIFI.viewBaseY), che segue un po' il dito in orizzontale e si inclina a
 * scatti verso di lui. Le texture inclinate sono generate una volta sola.
 */
export class ViewModel {
  private img: Phaser.GameObjects.Image | null = null;
  private keys: string[][] = [];
  private readonly w: number;
  private readonly h: number;
  private readonly pad: number;
  private frame = 0;
  private lean = 0;
  private left = 0;
  private kick = 0;
  private kickAcc = 0;
  private aimX: number = SCIFI.idleAimX;
  private aimY: number = SCIFI.idleAimY;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly opts: ViewModelOpts,
  ) {
    this.w = opts.frames[0][0].length;
    this.h = opts.frames[0].length;
    this.pad = SCIFI.viewLeans * SCIFI.viewLeanPx;
  }

  private ensureTextures(): void {
    if (this.keys.length) return;
    const L = SCIFI.viewLeans;
    this.keys = this.opts.frames.map((rows, f) => {
      const list: string[] = [];
      for (let l = -L; l <= L; l++) {
        list.push(makeSprite(this.scene, `${this.opts.key}-${f}-${l + L}`, shearSprite(rows, l * SCIFI.viewLeanPx, this.pad)));
      }
      return list;
    });
  }

  show(): void {
    this.ensureTextures();
    if (this.img) return;
    this.img = acquireImage(this.scene, 0, 0, this.keys[0][SCIFI.viewLeans]).setOrigin(0, 1).setDepth(SCIFI.viewDepth);
    this.kick = 0;
    this.update(0);
  }

  hide(): void {
    releaseImage(this.img);
    this.img = null;
  }

  aim(x: number, y: number): void {
    this.aimX = x;
    this.aimY = y;
  }

  setFrame(f: number): void {
    this.frame = Phaser.Math.Clamp(Math.floor(f), 0, this.keys.length ? this.keys.length - 1 : this.opts.frames.length - 1);
  }

  /** Rinculo: l'arma scende di `px` pixel e risale a scatti. */
  recoil(px = 1): void {
    this.kick = Math.min(SCIFI.viewKickMaxPx, Math.max(this.kick, px));
    this.kickAcc = 0;
  }

  update(dtMs: number): void {
    if (!this.img) return;
    if (this.kick > 0) {
      this.kickAcc += dtMs;
      while (this.kickAcc >= SCIFI.viewKickRecoverMs && this.kick > 0) {
        this.kickAcc -= SCIFI.viewKickRecoverMs;
        this.kick--;
      }
    }
    const px = Math.round(
      Phaser.Math.Clamp(SCIFI.viewX + (this.aimX - 90) * SCIFI.viewFollow, SCIFI.viewMinX, SCIFI.viewMaxX),
    );
    // angolo dal centro dell'arma verso il dito, rispetto alla verticale
    const cy = SCIFI.viewBaseY - this.h / 2;
    const a = Math.atan2(this.aimX - px, Math.max(4, cy - this.aimY));
    const step = Phaser.Math.DegToRad(SCIFI.viewLeanStepDeg);
    this.lean = Phaser.Math.Clamp(Math.round(a / step), -SCIFI.viewLeans, SCIFI.viewLeans);
    this.left = px - this.pad - Math.floor(this.w / 2);
    const key = this.keys[this.frame][this.lean + SCIFI.viewLeans];
    if (this.img.texture.key !== key) this.img.setTexture(key);
    this.img.setPosition(this.left, SCIFI.viewBaseY + this.kick);
  }

  /** Bocca dell'arma in coordinate mondo (dopo inclinazione e rinculo). */
  muzzle(): { x: number; y: number } {
    const row = this.opts.muzzleRow;
    const colm = this.opts.muzzleCol ?? Math.floor(this.w / 2);
    const s = Math.round((this.lean * SCIFI.viewLeanPx * (this.h - 1 - row)) / (this.h - 1));
    return { x: this.left + this.pad + s + colm, y: SCIFI.viewBaseY + this.kick - this.h + row };
  }

  get visible(): boolean {
    return !!this.img;
  }
}

// ---------------------------------------------------------------- DotLayer

/**
 * Un Graphics riusato per pixel effimeri: ogni frame si svuota e si ridisegna
 * (traccianti, saette, raggio). Un solo oggetto per arma, creato all'activate.
 */
export class DotLayer {
  private g: Phaser.GameObjects.Graphics | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly depth: number,
  ) {}

  begin(): Phaser.GameObjects.Graphics {
    if (!this.g) this.g = this.scene.add.graphics().setDepth(this.depth);
    this.g.clear();
    return this.g;
  }

  /** Pixel 1x1 (o size x size) a coordinate intere, dentro lo schermo. */
  dot(x: number, y: number, color: number, size = 1): void {
    this.g?.fillStyle(col(color)).fillRect(Math.round(x), Math.round(y), size, size);
  }

  /** Linea di pixel da (x0,y0) a (x1,y1), un pixel ogni `gap` (1 = continua). */
  line(x0: number, y0: number, x1: number, y1: number, color: number, gap = 1): void {
    const g = this.g;
    if (!g) return;
    g.fillStyle(col(color));
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i += gap) {
      g.fillRect(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), 1, 1);
    }
  }

  destroy(): void {
    this.g?.destroy();
    this.g = null;
  }
}

// ---------------------------------------------------------------- utilità

/** true se il punto è dentro la stanza (con margine). */
export function insideRoom(x: number, y: number, m = 0): boolean {
  return x >= ROOM_INNER.left + m && x <= ROOM_INNER.right - m && y >= ROOM_INNER.top + m && y <= ROOM_INNER.bottom - m;
}

/** Puntatore ancora premuto? (sicurezza: dito perso fuori dal canvas). */
export function pointerStillDown(scene: Phaser.Scene, id: number): boolean {
  const ptr = scene.input.manager.pointers.find((q) => q.id === id);
  return !!ptr && ptr.isDown;
}
