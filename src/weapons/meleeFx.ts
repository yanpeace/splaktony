import Phaser from 'phaser';
import { col, type ColorIndex } from '../config/palette';
import type { Part, Ragdoll } from '../entities/Ragdoll';
import { acquireImage, releaseImage } from '../gfx/effects';

/**
 * Aiuti comuni delle armi da mischia "iconiche" (piede di porco, mazza,
 * katana, motosega): orientamento a 45° degli sprite, animazioni a scatti
 * dell'arma da un pool di immagini, scie pixel disegnate su una Graphics,
 * test "quali parti di Tony attraversa questo segmento".
 *
 * Convenzione degli sprite delle armi: ogni arma ha uno sprite DRITTO con la
 * punta a destra (angolo 0) e uno DIAGONALE con la punta in basso a destra
 * (angolo +45°, y verso il basso); le altre 6 direzioni si ottengono ruotando
 * di multipli di 90° (nessuna rotazione arbitraria: pixel puliti).
 */

export const STEP45 = Math.PI / 4;

export interface Orient {
  diagonal: boolean;
  rotation: number;
}

/** Angolo → sprite dritto/diagonale + rotazione multipla di 90°. */
export function orient8(angle: number): Orient {
  const k = Math.round(angle / STEP45);
  const odd = ((k % 2) + 2) % 2 === 1;
  return { diagonal: odd, rotation: (odd ? k - 1 : k) * STEP45 };
}

/** Arrotonda un angolo al multiplo di 45° più vicino. */
export function snap45(angle: number): number {
  return Math.round(angle / STEP45) * STEP45;
}

export interface AnimFrame {
  key: string;
  x: number;
  y: number;
  rotation?: number;
  flipX?: boolean;
  flipY?: boolean;
}

interface Anim {
  img: Phaser.GameObjects.Image;
  frames: AnimFrame[];
  frameMs: number;
  start: number;
  shown: number;
}

function applyFrame(img: Phaser.GameObjects.Image, f: AnimFrame): void {
  if (img.texture.key !== f.key) img.setTexture(f.key);
  img
    .setPosition(Math.round(f.x), Math.round(f.y))
    .setRotation(f.rotation ?? 0)
    .setFlip(!!f.flipX, !!f.flipY);
}

/**
 * Animazioni a pochi frame dell'arma (immagini del pool condiviso di effects).
 * Le avanza update() dell'arma; clear() le restituisce tutte al pool.
 */
export class MeleeAnims {
  private list: Anim[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly max = 6,
  ) {}

  play(frames: AnimFrame[], frameMs: number, depth = 56): void {
    if (frames.length === 0) return;
    if (this.list.length >= this.max) releaseImage(this.list.shift()?.img);
    const img = acquireImage(this.scene, frames[0].x, frames[0].y, frames[0].key).setDepth(depth);
    applyFrame(img, frames[0]);
    this.list.push({ img, frames, frameMs, start: this.scene.time.now, shown: 0 });
  }

  update(): void {
    const now = this.scene.time.now;
    let w = 0;
    for (let i = 0; i < this.list.length; i++) {
      const a = this.list[i];
      const f = Math.floor((now - a.start) / a.frameMs);
      if (f >= a.frames.length) {
        releaseImage(a.img);
        continue;
      }
      if (f !== a.shown) {
        a.shown = f;
        applyFrame(a.img, a.frames[f]);
      }
      this.list[w++] = a;
    }
    this.list.length = w;
  }

  clear(): void {
    this.list.forEach((a) => releaseImage(a.img));
    this.list = [];
  }
}

/**
 * Frame di uno swing: l'arma ruota attorno alla "mano" (pivot) a scatti di
 * 45°, da `fromAngle` per `steps` frame nel verso `sense` (+1 = orario).
 * `len` = distanza mano → punta: la punta passa da pivot + len·dir(angolo).
 */
export function swingFrames(
  keys: { straight: string; diagonal: string },
  pivotX: number,
  pivotY: number,
  len: number,
  fromAngle: number,
  steps: number,
  sense: 1 | -1,
): AnimFrame[] {
  const frames: AnimFrame[] = [];
  for (let i = 0; i < steps; i++) {
    const a = fromAngle + i * STEP45 * sense;
    const o = orient8(a);
    // il centro dello sprite sta a metà tra mano e punta
    frames.push({
      key: o.diagonal ? keys.diagonal : keys.straight,
      x: pivotX + Math.cos(a) * len * 0.5,
      y: pivotY + Math.sin(a) * len * 0.5,
      rotation: o.rotation,
    });
  }
  return frames;
}

interface Seg {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  born: number;
  width: number;
}

export interface TrailStyle {
  /** colori: nucleo appena nato, bordo/alone, coda che sta per sparire */
  core: ColorIndex;
  glow: ColorIndex;
  tail: ColorIndex;
  lifeMs: number;
  /** segmenti al massimo (ring: oltre si scartano i più vecchi) */
  max?: number;
  depth?: number;
}

/**
 * Scia pixel (linee di Bresenham a pixel interi) su UNA Graphics creata una
 * volta sola; ogni frame si ridisegna solo se ci sono segmenti vivi.
 * Nucleo spesso che si assottiglia, alone colorato, coda che lampeggia.
 */
export class PixelTrail {
  private g: Phaser.GameObjects.Graphics;
  private segs: Seg[] = [];
  private dirty = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly style: TrailStyle,
  ) {
    this.g = scene.add.graphics().setDepth(style.depth ?? 57);
  }

  add(x0: number, y0: number, x1: number, y1: number, width = 2): void {
    const max = this.style.max ?? 40;
    if (this.segs.length >= max) this.segs.shift();
    this.segs.push({
      x0: Math.round(x0),
      y0: Math.round(y0),
      x1: Math.round(x1),
      y1: Math.round(y1),
      born: this.scene.time.now,
      width,
    });
    this.dirty = true;
  }

  /** Arco di cerchio come segmenti (smear di uno swing). */
  addArc(cx: number, cy: number, r: number, a0: number, a1: number, width = 2, pieces = 6): void {
    let px = cx + Math.cos(a0) * r;
    let py = cy + Math.sin(a0) * r;
    for (let i = 1; i <= pieces; i++) {
      const a = a0 + ((a1 - a0) * i) / pieces;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      this.add(px, py, x, y, width);
      px = x;
      py = y;
    }
  }

  update(): void {
    if (!this.dirty) return;
    const now = this.scene.time.now;
    const life = this.style.lifeMs;
    const g = this.g;
    g.clear();
    let w = 0;
    for (let i = 0; i < this.segs.length; i++) {
      const s = this.segs[i];
      const k = (now - s.born) / life;
      if (k >= 1) continue;
      this.segs[w++] = s;
      // ultimi istanti: lampeggio (più retro di una dissolvenza)
      if (k > 0.75 && Math.floor(now / 40) % 2 === 0) continue;
      if (k < 0.5) {
        const glowW = s.width + 2;
        line(g, s, glowW, col(this.style.glow));
        line(g, s, k < 0.25 ? s.width : Math.max(1, s.width - 1), col(this.style.core));
      } else {
        line(g, s, 1, col(this.style.tail));
      }
    }
    this.segs.length = w;
    if (w === 0) this.dirty = false;
  }

  clear(): void {
    this.segs = [];
    this.g.clear();
    this.dirty = false;
  }

  destroy(): void {
    this.segs = [];
    this.g.destroy();
  }
}

/** Linea pixel (Bresenham) di quadrati `size`x`size`. */
function line(g: Phaser.GameObjects.Graphics, s: Seg, size: number, color: number): void {
  g.fillStyle(color, 1);
  const off = Math.floor(size / 2);
  let x = s.x0;
  let y = s.y0;
  const dx = Math.abs(s.x1 - x);
  const dy = -Math.abs(s.y1 - y);
  const sx = x < s.x1 ? 1 : -1;
  const sy = y < s.y1 ? 1 : -1;
  let err = dx + dy;
  for (let guard = 0; guard < 400; guard++) {
    g.fillRect(x - off, y - off, size, size);
    if (x === s.x1 && y === s.y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/**
 * Parti di Tony attraversate dal segmento (x0,y0)→(x1,y1): campiona ogni
 * ~2 px e per ogni parte tiene il PRIMO punto di contatto. Riempie `out`.
 */
export function partsAlongSegment(
  ragdoll: Ragdoll,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  tolerance: number,
  out: Map<Part, { x: number; y: number }>,
): Map<Part, { x: number; y: number }> {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(1, Math.ceil(len / 2));
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const y = y0 + ((y1 - y0) * i) / n;
    const hit = ragdoll.partAt(x, y, tolerance);
    if (hit && !out.has(hit.part)) out.set(hit.part, { x: Math.round(x), y: Math.round(y) });
  }
  return out;
}
