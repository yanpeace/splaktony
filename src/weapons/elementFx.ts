import Phaser from 'phaser';
import { PHYSICS, ROOM_INNER } from '../config/balance';
import { col } from '../config/palette';
import type { Part, Ragdoll } from '../entities/Ragdoll';
import { acquireImage, isFrozen, releaseImage } from '../gfx/effects';
import type { SpriteData } from '../gfx/pixelSprite';

/**
 * Utility condivise dalle armi elementali (lanciafiamme, fulmine, ghiaccio,
 * tornado): pool di sprite-particella, tinte persistenti sulle parti di Tony,
 * linee a pixel interi, zig-zag delle saette e silhouette delle parti.
 */

// ---------------------------------------------------------------- pool di sprite

export interface FxSpawn {
  vx?: number;
  vy?: number;
  /** px/step² (negativa = sale) */
  gravity?: number;
  /** moltiplicatore della velocità a ogni step */
  drag?: number;
  lifeMs: number;
  /** 'age' = i frame scorrono lungo la vita; 'loop' = ciclo ogni frameMs */
  mode?: 'age' | 'loop';
  frameMs?: number;
  /** rimbalza sul pavimento e sui muri */
  collide?: boolean;
  bounce?: number;
  /** lampeggia negli ultimi ms */
  blinkMs?: number;
  depth?: number;
  flipX?: boolean;
}

interface FxSprite {
  img: Phaser.GameObjects.Image;
  frames: readonly string[];
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  drag: number;
  born: number;
  life: number;
  mode: 'age' | 'loop';
  frameMs: number;
  collide: boolean;
  bounce: number;
  blinkMs: number;
}

/**
 * Sprite-particella a pochi frame con un tetto: oltre `max` si ricicla il più
 * vecchio. Le immagini vengono dal pool condiviso di effects (acquireImage).
 */
export class FxPool {
  private list: FxSprite[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly max: number,
  ) {}

  spawn(frames: readonly string[], x: number, y: number, o: FxSpawn): void {
    if (this.list.length >= this.max) {
      const old = this.list.shift();
      releaseImage(old?.img);
    }
    const img = acquireImage(this.scene, x, y, frames[0]).setDepth(o.depth ?? 52).setFlipX(!!o.flipX);
    this.list.push({
      img,
      frames,
      x,
      y,
      vx: o.vx ?? 0,
      vy: o.vy ?? 0,
      gravity: o.gravity ?? 0,
      drag: o.drag ?? 1,
      born: this.scene.time.now,
      life: o.lifeMs,
      mode: o.mode ?? 'age',
      frameMs: o.frameMs ?? 60,
      collide: !!o.collide,
      bounce: o.bounce ?? 0.4,
      blinkMs: o.blinkMs ?? 0,
    });
  }

  update(dtMs: number): void {
    const now = this.scene.time.now;
    const frozen = isFrozen(this.scene);
    const steps = dtMs / PHYSICS.stepMs;
    const list = this.list;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const age = now - p.born;
      if (age >= p.life) {
        releaseImage(p.img);
        continue;
      }
      if (!frozen) {
        p.vy += p.gravity * steps;
        const d = Math.pow(p.drag, steps);
        p.vx *= d;
        p.vy *= d;
        p.x += p.vx * steps;
        p.y += p.vy * steps;
        if (p.collide) this.collide(p);
      }
      const n = p.frames.length;
      const f = p.mode === 'loop' ? Math.floor(age / p.frameMs) % n : Math.min(n - 1, Math.floor((age / p.life) * n));
      const key = p.frames[f];
      if (p.img.texture.key !== key) p.img.setTexture(key);
      p.img.setPosition(Math.round(p.x), Math.round(p.y));
      if (p.blinkMs > 0 && p.life - age < p.blinkMs) p.img.setVisible(Math.floor((p.life - age) / 60) % 2 === 0);
      list[w++] = p;
    }
    list.length = w;
  }

  private collide(p: FxSprite): void {
    const floor = ROOM_INNER.bottom - 1;
    if (p.y > floor && p.vy > 0) {
      p.y = floor;
      p.vy = -p.vy * p.bounce;
      p.vx *= 0.7;
      if (Math.abs(p.vy) < 0.6) p.vy = 0;
    }
    if (p.x < ROOM_INNER.left + 1) {
      p.x = ROOM_INNER.left + 1;
      p.vx = Math.abs(p.vx) * p.bounce;
    } else if (p.x > ROOM_INNER.right - 1) {
      p.x = ROOM_INNER.right - 1;
      p.vx = -Math.abs(p.vx) * p.bounce;
    }
  }

  clear(): void {
    for (const p of this.list) releaseImage(p.img);
    this.list = [];
  }

  get count(): number {
    return this.list.length;
  }
}

// ---------------------------------------------------------------- tinte sulle parti

/**
 * Tinta persistente sulle parti di Tony (annerito, congelato...). Il Ragdoll
 * fa un flash bianco a ogni colpo e poi chiama clearTint(): per questo la
 * tinta viene riapplicata a ogni PRE_RENDER (senza toccare il flash in corso).
 */
export class PartTints {
  private map = new Map<Part, { color: number; until: number }>();

  constructor(private readonly scene: Phaser.Scene) {
    scene.events.on(Phaser.Scenes.Events.PRE_RENDER, this.apply, this);
  }

  set(part: Part, colorIndex: number, until: number): void {
    const cur = this.map.get(part);
    const color = col(colorIndex);
    if (cur && cur.color === color) cur.until = Math.max(cur.until, until);
    else this.map.set(part, { color, until });
  }

  remove(part: Part): void {
    if (!this.map.delete(part)) return;
    if (part.sprite.active && !part.sprite.tintFill) part.sprite.clearTint();
  }

  has(part: Part): boolean {
    return this.map.has(part);
  }

  private apply(): void {
    const now = this.scene.time.now;
    for (const [part, t] of this.map) {
      const s = part.sprite;
      if (!s.active) {
        this.map.delete(part);
        continue;
      }
      if (now >= t.until) {
        this.remove(part);
        continue;
      }
      // flash bianco in corso (tintFill): non toccarlo, la tinta torna al frame dopo
      if (!s.tintFill && s.tintTopLeft !== t.color) s.setTint(t.color);
    }
  }

  clear(): void {
    for (const part of [...this.map.keys()]) this.remove(part);
  }

  destroy(): void {
    this.clear();
    this.scene.events.off(Phaser.Scenes.Events.PRE_RENDER, this.apply, this);
  }
}

// ---------------------------------------------------------------- disegno a pixel

/** Linea a pixel interi (Bresenham) su un Graphics; `size` = lato del "pennello". */
export function pixelLine(
  g: Phaser.GameObjects.Graphics,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  size = 1,
  dotted = 0,
): void {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  const off = Math.floor(size / 2);
  let err = dx + dy;
  let i = 0;
  for (;;) {
    if (!dotted || i % dotted === 0) g.fillRect(x0 - off, y0 - off, size, size);
    i++;
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

/** Disegna una polilinea [x0,y0,x1,y1,...] con pixelLine. */
export function pixelPolyline(g: Phaser.GameObjects.Graphics, pts: readonly number[], size = 1, dotted = 0): void {
  for (let i = 0; i + 3 < pts.length; i += 2) pixelLine(g, pts[i], pts[i + 1], pts[i + 2], pts[i + 3], size, dotted);
}

/**
 * Punti di uno zig-zag da (x0,y0) a (x1,y1): segmenti di `seg` px con scarto
 * laterale casuale fino a `amp` px (estremi fissi). Scrive in `out` (riusato).
 */
export function zigzag(out: number[], x0: number, y0: number, x1: number, y1: number, seg: number, amp: number): number[] {
  out.length = 0;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const n = Math.max(2, Math.round(len / seg));
  const nx = len > 0 ? -dy / len : 0;
  const ny = len > 0 ? dx / len : 0;
  let side = Math.random() < 0.5 ? -1 : 1;
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const o = i === 0 || i === n ? 0 : side * (1 + Math.random() * (amp - 1));
    side = -side;
    out.push(Math.round(x0 + dx * k + nx * o), Math.round(y0 + dy * k + ny * o));
  }
  return out;
}

// ---------------------------------------------------------------- silhouette delle parti

/**
 * Maschera dei pixel pieni di una texture (true = pixel visibile), letta dalla
 * texture stessa: segue gli sprite di Tony anche se cambiano dimensione.
 */
export function textureMask(scene: Phaser.Scene, key: string): { w: number; h: number; on: boolean[][] } {
  const frame = scene.textures.getFrame(key);
  const w = frame.width;
  const h = frame.height;
  const on: boolean[][] = [];
  for (let y = 0; y < h; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < w; x++) {
      const c = scene.textures.getPixel(x, y, key);
      row.push(!!c && c.alpha > 0);
    }
    on.push(row);
  }
  return { w, h, on };
}

/** Converte una griglia di caratteri in SpriteData. */
export function gridToSprite(grid: string[][]): SpriteData {
  return grid.map((r) => r.join(''));
}

/** Parte più vicina a (x,y) entro `maxDist`, escluse quelle in `skip`. */
export function nearestPart(ragdoll: Ragdoll, x: number, y: number, maxDist: number, skip?: ReadonlySet<Part>): Part | null {
  let best: Part | null = null;
  let bestD = maxDist;
  for (const p of ragdoll.parts.values()) {
    if (skip?.has(p)) continue;
    const d = Math.hypot(p.body.position.x - x, p.body.position.y - y);
    if (d <= bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** true se il puntatore `id` è ancora premuto (sicurezza per le armi "tieni premuto"). */
export function pointerStillDown(scene: Phaser.Scene, id: number): boolean {
  const ptr = scene.input.manager.pointers.find((q) => q.id === id);
  return !!ptr && ptr.isDown;
}
