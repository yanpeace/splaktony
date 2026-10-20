import Phaser from 'phaser';
import { RAGDOLL, ROOM_INNER, SCREEN, WEATHER as W } from '../config/balance';
import { C, col } from '../config/palette';
import { spawnParticles } from '../gfx/effects';
import { pixelText, setPixelText } from '../gfx/pixelFont';
import { makeSprite, type SpriteData } from '../gfx/pixelSprite';
import type { Part, Ragdoll } from './Ragdoll';

/**
 * Grafica del meteo (la logica a fasi sta in systems/weather.ts).
 *
 * - precipitazioni: un pool UNICO di immagini (tetto WEATHER.maxPrecip) per
 *   fiocchi, gocce di pioggia e gocce dal soffitto; nessuna creazione/distruzione
 *   dopo il riscaldamento del pool;
 * - fiocchi che toccano Tony si posano sulla parte (offset locale ruotato con
 *   l'angolo del corpo, come gli shuriken) e dopo un po' si sciolgono;
 * - gocce su Tony → schizzi; a terra → schizzi radi e pozzanghere;
 * - terreno (depth 9, sotto Tony): strato di neve per colonna + pozzanghere,
 *   ridisegnati in un solo Graphics solo quando cambiano;
 * - neve sul caschetto (3 livelli), foglie/carta/polvere col vento,
 *   lampo a tutto schermo (depth 45) + saetta sullo sfondo, annuncio pixel.
 *
 * Depth: precipitazioni e detriti 20, fiocchi posati sopra la loro parte,
 * terreno 9, saetta 0.45 (dietro la piana e il cantiere), lampo 45, annuncio 47.
 * Chiavi texture: prefisso `wx-`.
 */

type Img = Phaser.GameObjects.Image;

const DEPTH_PRECIP = 20;
const DEPTH_GROUND = 9;
const DEPTH_BOLT = 0.45;
const DEPTH_FLASH = 45;
const DEPTH_ANNOUNCE = 47;
const GROUND_Y = ROOM_INNER.bottom;

// ---------------------------------------------------------------- sprite

const SPRITES: Record<string, SpriteData> = {
  'wx-flake-1': ['c'],
  'wx-flake-1d': ['d'],
  'wx-flake-2': ['cc', 'cd'],
  'wx-drop-2': ['a', 'b'],
  'wx-drop-3': ['9', 'a', 'b'],
  // inclinate: verso destra (R) e verso sinistra (L), leggere (1) e forti (2)
  'wx-drop-r1': ['9.', 'a.', '.b'],
  'wx-drop-l1': ['.9', '.a', 'b.'],
  'wx-drop-r2': ['9..', '.a.', '..b'],
  'wx-drop-l2': ['..9', '.a.', 'b..'],
  'wx-drip-hang': ['a'],
  'wx-drip': ['a', 'b'],
  // neve sul caschetto (16 px come la testa; la riga bassa copre il bordo del casco)
  'wx-cap-1': ['......cccc......', '....dccccccd....'],
  'wx-cap-2': ['......cc........', '....cccccccc....', '...dccccccccd...'],
  'wx-cap-3': ['.....cc.ccc.....', '....cccccccccc..', '...cccccccccccd.', '..dccccccccccccd'],
  // detriti col vento: 2 frame ciascuno
  'wx-leaf-a': ['.000', '0560', '000.'],
  'wx-leaf-b': ['000.', '0650', '.000'],
  'wx-paper-a': ['0000.', '0ccd0', '0cdd0', '.0000'],
  'wx-paper-b': ['.000.', '0cdc0', '.000.'],
  'wx-dust-a': ['d'],
  'wx-dust-b': ['dd'],
};

const DEBRIS_KINDS = [
  { a: 'wx-leaf-a', b: 'wx-leaf-b', low: false },
  { a: 'wx-leaf-b', b: 'wx-leaf-a', low: false },
  { a: 'wx-paper-a', b: 'wx-paper-b', low: false },
  { a: 'wx-dust-a', b: 'wx-dust-b', low: true },
  { a: 'wx-dust-b', b: 'wx-dust-a', low: true },
] as const;

const BOLT_KEYS = ['wx-bolt-0', 'wx-bolt-1', 'wx-bolt-2'];
const BOLT_W = 25;
const BOLT_H = 92;

/** Saetta a zig-zag (pixel interi): nucleo bianco, bordo ciano, un ramo. */
function boltSprite(): string[] {
  const g = Array.from({ length: BOLT_H }, () => new Array<string>(BOLT_W).fill('.'));
  const set = (x: number, y: number, c: string) => {
    if (x < 0 || y < 0 || x >= BOLT_W || y >= BOLT_H) return;
    if (c === 'b' && g[y][x] === 'c') return;
    g[y][x] = c;
  };
  const walk = (x: number, y0: number, len: number, bias: number) => {
    let dir = Math.random() < 0.5 ? -1 : 1;
    for (let y = y0; y < Math.min(BOLT_H, y0 + len); y++) {
      if (Math.random() < 0.35) dir = Math.random() < 0.5 + bias ? 1 : -1;
      if (Math.random() < 0.6) x = Phaser.Math.Clamp(x + dir, 2, BOLT_W - 3);
      set(x - 1, y, 'b');
      set(x + 1, y, 'b');
      set(x, y, 'c');
    }
    return x;
  };
  const mid = Math.floor(BOLT_W / 2);
  walk(mid, 0, BOLT_H, 0);
  // ramo a metà altezza
  const by = 30 + Math.floor(Math.random() * 25);
  const row = g[by];
  const bx = row.indexOf('c');
  walk(bx, by, 18 + Math.floor(Math.random() * 12), Math.random() < 0.5 ? 0.3 : -0.3);
  return g.map((r) => r.join(''));
}

function ensureSprites(scene: Phaser.Scene): void {
  for (const [k, rows] of Object.entries(SPRITES)) makeSprite(scene, k, rows);
  for (const k of BOLT_KEYS) makeSprite(scene, k, boltSprite());
}

// ---------------------------------------------------------------- tipi

type PrecipKind = 'snow' | 'rain' | 'drip';

interface Precip {
  img: Img;
  kind: PrecipKind;
  state: 'fall' | 'hang' | 'stuck';
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** neve: prossimo scatto laterale / pioggia: chiave corrente / goccia: fine attesa */
  nextAt: number;
  /** posa sul corpo (fiocco posato) */
  part: Part | null;
  lx: number;
  ly: number;
  until: number;
}

interface Debris {
  img: Img;
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: string;
  b: string;
  nextAt: number;
  frame: number;
}

interface Puddle {
  x: number;
  w: number;
  maxW: number;
  nextAt: number;
}

/** Valori pilotati da systems/weather.ts a ogni frame. */
export interface WeatherLevels {
  /** densità neve 0..1 */
  snow: number;
  /** densità pioggia 0..1 */
  rain: number;
  /** tetto della pioggia (temporale = più gocce) */
  rainMax: number;
  /** vento con segno (-1..1): detriti e inclinazione */
  wind: number;
  /** spostamento orizzontale delle precipitazioni (px/step) */
  drift: number;
}

const rand = (r: readonly [number, number] | readonly number[]) => r[0] + Math.random() * (r[1] - r[0]);
const STEP_MS = 1000 / 60;
const ROT_STEP = (Math.PI * 2) / RAGDOLL.rotationSteps;
const snapAngle = (a: number) => Math.round(a / ROT_STEP) * ROT_STEP;

export class WeatherFx {
  private pool: Precip[] = [];
  private free: Precip[] = [];
  private live: Precip[] = [];
  private liveSnow = 0;
  private liveRain = 0;
  private stuck: Precip[] = [];

  private debris: Debris[] = [];
  private freeDebris: Debris[] = [];

  private ground: Phaser.GameObjects.Graphics;
  private groundDirty = false;
  private snowH = new Uint8Array(SCREEN.width);
  private snowHits = new Uint8Array(SCREEN.width);
  private snowTotal = 0;
  private nextMeltAt = 0;
  private puddles: Puddle[] = [];
  private dripPuddles: Puddle[] = [];

  private cap: Img;
  private capLevel = 0;
  private capHits = 0;
  private nextCapMeltAt = 0;

  private flash: Phaser.GameObjects.Rectangle;
  private bolt: Img;
  private flashFrames = 0;
  private secondFlashIn = -1;
  private boltFrames = 0;

  private announceA: Phaser.GameObjects.BitmapText;
  private announceB: Phaser.GameObjects.BitmapText;
  private announceAt = -1e9;

  private splashesThisFrame = 0;
  /** chiamata quando una goccia dal soffitto tocca terra o Tony (per il "plic") */
  onDripLand: (() => void) | null = null;

  constructor(
    private scene: Phaser.Scene,
    private ragdoll: Ragdoll,
  ) {
    ensureSprites(scene);
    this.ground = scene.add.graphics().setDepth(DEPTH_GROUND);
    this.cap = scene.add.image(0, 0, 'wx-cap-1').setOrigin(0.5, 1).setDepth(15.5).setVisible(false);
    this.flash = scene.add
      .rectangle(-8, -8, SCREEN.width + 16, SCREEN.height + 16, col(C.white))
      .setOrigin(0)
      .setDepth(DEPTH_FLASH)
      .setVisible(false);
    this.bolt = scene.add.image(0, 0, BOLT_KEYS[0]).setOrigin(0.5, 0).setDepth(DEPTH_BOLT).setVisible(false);
    this.announceA = pixelText(scene, SCREEN.width / 2, W.announceY, '', C.white)
      .setOrigin(0.5, 0)
      .setScale(2)
      .setDepth(DEPTH_ANNOUNCE)
      .setVisible(false);
    this.announceB = pixelText(scene, SCREEN.width / 2, W.announceY, '', C.cyan)
      .setOrigin(0.5, 0)
      .setScale(2)
      .setDepth(DEPTH_ANNOUNCE)
      .setVisible(false);
  }

  // ---------------------------------------------------------------- API per weather.ts

  /** Scritta lampeggiante sotto l'HUD ("NEVE!", "VENTO!"...). */
  announce(text: string): void {
    setPixelText(this.announceA, text);
    setPixelText(this.announceB, text);
    this.announceAt = this.scene.time.now;
  }

  /** Fulmine: lampo bianco 1-2 frame, saetta su un punto dello sfondo. */
  lightning(): void {
    this.flashFrames = W.flashFrames;
    this.secondFlashIn = W.secondFlashDelayFrames;
    this.boltFrames = W.boltFrames;
    const x = Math.round(20 + Math.random() * (SCREEN.width - 40));
    this.bolt
      .setTexture(BOLT_KEYS[Math.floor(Math.random() * BOLT_KEYS.length)])
      .setPosition(x, W.spawnY + 2)
      .setFlipX(Math.random() < 0.5)
      .setVisible(true);
    spawnParticles(this.scene, x, W.spawnY + 2 + BOLT_H - 2, {
      count: 5,
      colors: [C.white, C.yellow, C.cyan],
      speed: 1.4,
      angle: -Math.PI / 2,
      spread: 2.4,
      gravity: 0.1,
      lifeMs: 300,
      size: 1,
      depth: DEPTH_BOLT + 0.01,
    });
  }

  /** Goccia che si forma al soffitto e cade (al chiuso). */
  drip(): void {
    const d = this.acquire('drip');
    if (!d) return;
    d.state = 'hang';
    d.x = Math.round(ROOM_INNER.left + 4 + Math.random() * (ROOM_INNER.right - ROOM_INNER.left - 8));
    d.y = ROOM_INNER.top;
    d.vx = 0;
    d.vy = 0;
    d.nextAt = this.scene.time.now + W.dripHangMs;
    d.img.setTexture('wx-drip-hang');
  }

  stats(): { live: number; pool: number; stuck: number; debris: number; snowPx: number; puddles: number; cap: number } {
    return {
      live: this.live.length,
      pool: this.pool.length,
      stuck: this.stuck.length,
      debris: this.debris.length,
      snowPx: this.snowTotal,
      puddles: this.puddles.length + this.dripPuddles.length,
      cap: this.capLevel,
    };
  }

  update(dtMs: number, lv: WeatherLevels, frozen: boolean): void {
    const now = this.scene.time.now;
    const steps = frozen ? 0 : Math.min(4, dtMs / STEP_MS);
    this.splashesThisFrame = 0;

    this.spawn(lv, now);
    this.updatePrecip(steps, now, lv);
    this.updateStuck(now);
    this.updateCap(now, lv);
    this.updateGround(now, lv);
    this.updateDebris(steps, now, lv);
    this.updateFlash();
    this.updateAnnounce(now);
    if (this.groundDirty) this.drawGround();
  }

  destroy(): void {
    // allo shutdown Phaser distrugge già gli oggetti di scena; se il meteo viene
    // riagganciato alla stessa scena (bindWeather di nuovo) li togliamo noi
    const objs: Phaser.GameObjects.GameObject[] = [
      ...this.pool.map((d) => d.img),
      ...this.debris.map((d) => d.img),
      ...this.freeDebris.map((d) => d.img),
      this.ground,
      this.cap,
      this.flash,
      this.bolt,
      this.announceA,
      this.announceB,
    ];
    for (const o of objs) if (o.scene) o.destroy();
    this.pool = [];
    this.free = [];
    this.live = [];
    this.stuck = [];
    this.debris = [];
    this.freeDebris = [];
    this.onDripLand = null;
  }

  // ---------------------------------------------------------------- pool precipitazioni

  private acquire(kind: PrecipKind): Precip | null {
    let d = this.free.pop();
    if (!d) {
      if (this.pool.length >= W.maxPrecip) return null;
      d = {
        img: this.scene.add.image(0, 0, 'wx-flake-1').setDepth(DEPTH_PRECIP),
        kind,
        state: 'fall',
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        nextAt: 0,
        part: null,
        lx: 0,
        ly: 0,
        until: 0,
      };
      this.pool.push(d);
    }
    d.kind = kind;
    d.state = 'fall';
    d.part = null;
    d.img.setDepth(DEPTH_PRECIP).setVisible(true).setActive(true);
    this.live.push(d);
    if (kind === 'snow') this.liveSnow++;
    else if (kind === 'rain') this.liveRain++;
    return d;
  }

  /** Rimette nel pool (la rimozione da `live`/`stuck` la fa chi itera). */
  private recycle(d: Precip): void {
    // i fiocchi posati non contano più tra quelli che cadono (vedi stick)
    if (d.kind === 'snow' && d.state !== 'stuck') this.liveSnow--;
    else if (d.kind === 'rain') this.liveRain--;
    d.part = null;
    d.img.setVisible(false).setActive(false);
    this.free.push(d);
  }

  private spawn(lv: WeatherLevels, now: number): void {
    const snowTarget = Math.round(W.snowMax * lv.snow);
    const rainTarget = Math.round(lv.rainMax * lv.rain);
    let budget: number = W.spawnPerFrame;
    const top = W.spawnY;
    while (budget > 0 && this.liveSnow < snowTarget) {
      const d = this.acquire('snow');
      if (!d) break;
      budget--;
      d.x = ROOM_INNER.left + Math.random() * (ROOM_INNER.right - ROOM_INNER.left);
      d.y = top;
      d.vy = rand(W.snowSpeed);
      d.vx = 0;
      d.nextAt = now + rand(W.snowSwayMs);
      const r = Math.random();
      d.img.setTexture(r < 0.55 ? 'wx-flake-2' : r < 0.7 ? 'wx-flake-1d' : 'wx-flake-1');
    }
    budget = W.spawnPerFrame; // la pioggia ha un budget suo
    while (budget > 0 && this.liveRain < rainTarget) {
      const d = this.acquire('rain');
      if (!d) break;
      budget--;
      d.x = ROOM_INNER.left + Math.random() * (ROOM_INNER.right - ROOM_INNER.left);
      d.y = top + Math.random() * 8;
      d.vy = rand(W.rainSpeed);
      d.vx = 0;
      d.nextAt = 0;
      d.lx = Math.random() < 0.5 ? 2 : 3; // lunghezza della goccia dritta
      d.img.setTexture(this.dropKey(d, 0));
    }
  }

  /** Goccia dritta (1x2 / 1x3) o inclinata secondo il vento. */
  private dropKey(d: Precip, drift: number): string {
    const k = drift / d.vy;
    if (Math.abs(k) < 0.15) return d.lx === 2 ? 'wx-drop-2' : 'wx-drop-3';
    const side = k > 0 ? 'r' : 'l';
    return Math.abs(k) < 0.55 ? `wx-drop-${side}1` : `wx-drop-${side}2`;
  }

  private updatePrecip(steps: number, now: number, lv: WeatherLevels): void {
    // riquadro di Tony: test punto-vs-parte solo dentro questo (economico)
    let bx0 = Infinity;
    let by0 = Infinity;
    let bx1 = -Infinity;
    let by1 = -Infinity;
    for (const p of this.ragdoll.parts.values()) {
      const { x, y } = p.body.position;
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (y < by0) by0 = y;
      if (y > by1) by1 = y;
    }
    bx0 -= 9;
    by0 -= 9;
    bx1 += 9;
    by1 += 9;

    const left = ROOM_INNER.left;
    const width = ROOM_INNER.right - ROOM_INNER.left;
    const list = this.live;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      let keep = true;

      if (d.kind === 'snow') {
        if (now >= d.nextAt) {
          d.x += Math.random() < 0.5 ? -1 : 1; // ondeggia a scatti di 1px
          d.nextAt = now + rand(W.snowSwayMs);
        }
        d.x += lv.drift * W.snowDriftMult * steps;
        d.y += d.vy * steps;
      } else if (d.kind === 'rain') {
        d.x += lv.drift * steps;
        d.y += d.vy * steps;
        const key = this.dropKey(d, lv.drift);
        if (d.img.texture.key !== key) d.img.setTexture(key);
      } else {
        // goccia dal soffitto: si forma, poi cade con gravità
        if (d.state === 'hang') {
          if (now >= d.nextAt) {
            d.state = 'fall';
            d.img.setTexture('wx-drip');
          }
        } else {
          d.vy = Math.min(W.dripMaxSpeed, d.vy + W.dripGravity * steps);
          d.y += d.vy * steps;
        }
      }
      // pioggia/neve escono da un lato e rientrano dall'altro (copertura uniforme col vento)
      if (d.x < left) d.x += width;
      else if (d.x >= left + width) d.x -= width;

      if (d.state === 'fall' && d.x >= bx0 && d.x <= bx1 && d.y >= by0 && d.y <= by1) {
        const hit = this.ragdoll.partAt(d.x, d.y, 0);
        if (hit) {
          if (d.kind === 'snow') {
            this.stick(d, hit.part);
            continue;
          }
          this.splash(d.x, d.y - 1, hit.part.def.depth + 1);
          if (d.kind === 'drip') this.onDripLand?.();
          keep = false;
        }
      }

      if (keep && d.state === 'fall') {
        const gy = GROUND_Y - (d.kind === 'snow' ? this.snowH[Math.floor(d.x)] : 0);
        if (d.y >= gy) {
          if (d.kind === 'snow') {
            // un fiocco si spande su 3 colonne: lo strato cresce in fretta e uniforme
            const cx = Math.floor(d.x);
            for (let c = cx - 1; c <= cx + 1; c++) this.addSnow(c);
          }
          else if (d.kind === 'rain') {
            if (Math.random() < W.groundSplashChance) this.splash(d.x, GROUND_Y - 1, DEPTH_PRECIP);
          } else {
            this.splash(d.x, GROUND_Y - 1, DEPTH_PRECIP);
            this.dripPuddle(Math.round(d.x), now);
            this.onDripLand?.();
          }
          keep = false;
        }
      }

      if (!keep) {
        this.recycle(d);
        continue;
      }
      d.img.setPosition(Math.round(d.x), Math.round(d.y));
      list[w++] = d;
    }
    list.length = w;
  }

  private splash(x: number, y: number, depth: number): void {
    if (this.splashesThisFrame >= W.maxSplashesPerFrame) return;
    this.splashesThisFrame++;
    spawnParticles(this.scene, x, y, {
      count: W.splashParticles,
      colors: [C.sky, C.cyan, C.white],
      speed: 1.3,
      angle: -Math.PI / 2,
      spread: 2.4,
      gravity: 0.16,
      lifeMs: 240,
      size: 1,
      depth,
    });
  }

  // ---------------------------------------------------------------- fiocchi posati su Tony

  private stick(d: Precip, part: Part): void {
    const b = part.body;
    const a = snapAngle(b.angle);
    const dx = d.x - b.position.x;
    const dy = d.y - b.position.y;
    const c = Math.cos(-a);
    const s = Math.sin(-a);
    d.lx = dx * c - dy * s;
    d.ly = dx * s + dy * c;
    d.part = part;
    d.state = 'stuck';
    this.liveSnow--; // lascia il posto a un nuovo fiocco che cade
    d.until = this.scene.time.now + rand(W.stickMs);
    d.img.setDepth(part.def.depth + 0.5);
    if (d.img.texture.key === 'wx-flake-1d') d.img.setTexture('wx-flake-1');
    this.stuck.push(d);
    if (this.stuck.length > W.maxStuck) {
      const old = this.stuck.shift();
      if (old) this.unstick(old);
    }
    if (part.name === 'head' && this.capLevel < W.capMaxLevel && ++this.capHits >= W.capHitsPerLevel) {
      this.capHits = 0;
      this.capLevel++;
      this.cap.setTexture(`wx-cap-${this.capLevel}`);
    }
  }

  /** Toglie un fiocco posato (non è più in `live`: ci resta solo finché cade). */
  private unstick(d: Precip): void {
    this.recycle(d);
  }

  private updateStuck(now: number): void {
    const list = this.stuck;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      const part = d.part;
      if (!part || now >= d.until || !this.ragdoll.parts.has(part.name)) {
        this.unstick(d);
        continue;
      }
      const b = part.body;
      const a = snapAngle(b.angle);
      const c = Math.cos(a);
      const s = Math.sin(a);
      d.img.setPosition(Math.round(b.position.x + d.lx * c - d.ly * s), Math.round(b.position.y + d.lx * s + d.ly * c));
      const left = d.until - now;
      if (left < W.meltMs) {
        // si scioglie: diventa un puntino grigio che lampeggia
        if (d.img.texture.key !== 'wx-flake-1d') d.img.setTexture('wx-flake-1d');
        d.img.setVisible(Math.floor(left / W.meltBlinkMs) % 2 === 0);
      }
      list[w++] = d;
    }
    list.length = w;
  }

  private updateCap(now: number, lv: WeatherLevels): void {
    const head = this.ragdoll.parts.get('head');
    if (!head || this.capLevel <= 0) {
      this.cap.setVisible(false);
      return;
    }
    if (lv.snow <= 0) {
      if (this.nextCapMeltAt === 0) this.nextCapMeltAt = now + W.capMeltStepMs;
      else if (now >= this.nextCapMeltAt) {
        this.capLevel--;
        this.nextCapMeltAt = now + W.capMeltStepMs;
        if (this.capLevel > 0) this.cap.setTexture(`wx-cap-${this.capLevel}`);
      }
    } else {
      this.nextCapMeltAt = 0;
    }
    if (this.capLevel <= 0) {
      this.cap.setVisible(false);
      return;
    }
    const b = head.body;
    const a = snapAngle(b.angle);
    // bordo basso del cappello sulla riga alta del casco (-9 dal centro della testa)
    const ox = 0;
    const oy = -8;
    this.cap
      .setVisible(true)
      .setRotation(a)
      .setPosition(
        Math.round(b.position.x + ox * Math.cos(a) - oy * Math.sin(a)),
        Math.round(b.position.y + ox * Math.sin(a) + oy * Math.cos(a)),
      );
  }

  // ---------------------------------------------------------------- terreno: neve e pozzanghere

  private addSnow(x: number): void {
    if (x < ROOM_INNER.left || x >= ROOM_INNER.right) return;
    if (++this.snowHits[x] < W.groundHitsPerPx) return;
    this.snowHits[x] = 0;
    const h = this.snowH[x];
    if (h >= W.groundMaxPx) {
      // colonna piena: la neve scivola sulla vicina più bassa
      const n = x > ROOM_INNER.left && this.snowH[x - 1] < this.snowH[x + 1] ? x - 1 : x + 1;
      if (n < ROOM_INNER.right && this.snowH[n] < W.groundMaxPx) this.setSnow(n, this.snowH[n] + 1);
      return;
    }
    this.setSnow(x, h + 1);
    // strato morbido: niente gradini più alti di 1px
    for (const n of [x - 1, x + 1]) {
      if (n >= ROOM_INNER.left && n < ROOM_INNER.right && this.snowH[n] < h) this.setSnow(n, h);
    }
  }

  private setSnow(x: number, h: number): void {
    this.snowTotal += h - this.snowH[x];
    this.snowH[x] = h;
    this.groundDirty = true;
  }

  private updateGround(now: number, lv: WeatherLevels): void {
    // neve: a fine evento si scioglie a scatti, colonne a caso
    if (lv.snow <= 0 && this.snowTotal > 0 && now >= this.nextMeltAt) {
      this.nextMeltAt = now + W.groundMeltStepMs;
      for (let x = ROOM_INNER.left; x < ROOM_INNER.right; x++) {
        if (this.snowH[x] > 0 && Math.random() < W.groundMeltChance) this.setSnow(x, this.snowH[x] - 1);
      }
    }

    // pozzanghere della pioggia: si allargano a scatti, poi si asciugano
    if (lv.rain > 0) {
      if (this.puddles.length === 0) {
        const n = Math.round(rand(W.puddles));
        const span = ROOM_INNER.right - ROOM_INNER.left - 24;
        for (let i = 0; i < n; i++) {
          this.puddles.push({
            x: Math.round(ROOM_INNER.left + 12 + ((i + 0.2 + Math.random() * 0.6) / n) * span),
            w: 0,
            maxW: Math.round(rand(W.puddleMaxW)),
            nextAt: now + rand(W.puddleGrowMs),
          });
        }
      }
      for (const p of this.puddles) {
        if (now < p.nextAt) continue;
        p.nextAt = now + rand(W.puddleGrowMs);
        const cap = Math.max(2, Math.round(p.maxW * lv.rain));
        if (p.w < cap) {
          p.w = Math.min(cap, p.w + 2);
          this.groundDirty = true;
        }
      }
    } else {
      this.dry(this.puddles, now);
    }
    this.dry(this.dripPuddles, now);
  }

  private dry(list: Puddle[], now: number): void {
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (now >= p.nextAt) {
        p.nextAt = now + rand(W.puddleDryMs) * 2;
        p.w -= 2;
        this.groundDirty = true;
      }
      if (p.w > 0) list[w++] = p;
    }
    list.length = w;
  }

  private dripPuddle(x: number, now: number): void {
    const near = this.dripPuddles.find((p) => Math.abs(p.x - x) <= 3);
    if (near) {
      if (near.w < W.dripPuddleMaxW) near.w += 2;
      near.nextAt = now + rand(W.puddleDryMs) * 4;
    } else if (this.dripPuddles.length < 8) {
      this.dripPuddles.push({ x, w: 2, maxW: W.dripPuddleMaxW, nextAt: now + rand(W.puddleDryMs) * 4 });
    }
    this.groundDirty = true;
  }

  private drawGround(): void {
    this.groundDirty = false;
    const g = this.ground;
    g.clear();
    // pozzanghere: ellisse piatta di 2 righe sulla superficie del terreno
    for (const p of [...this.puddles, ...this.dripPuddles]) {
      if (p.w <= 0) continue;
      const x0 = Math.round(p.x - p.w / 2);
      g.fillStyle(col(C.blue));
      g.fillRect(x0, GROUND_Y, p.w, 1);
      if (p.w > 2) g.fillRect(x0 + 1, GROUND_Y + 1, p.w - 2, 1);
      g.fillStyle(col(C.sky));
      g.fillRect(x0 + 1, GROUND_Y, Math.min(2, p.w - 1), 1);
    }
    // neve: per colonna, a strisce della stessa altezza
    let x: number = ROOM_INNER.left;
    while (x < ROOM_INNER.right) {
      const h = this.snowH[x];
      let e = x + 1;
      while (e < ROOM_INNER.right && this.snowH[e] === h) e++;
      if (h > 0) {
        g.fillStyle(col(C.white));
        g.fillRect(x, GROUND_Y - h, e - x, h);
        g.fillStyle(col(C.silver));
        g.fillRect(x, GROUND_Y, e - x, 1);
      }
      x = e;
    }
  }

  // ---------------------------------------------------------------- detriti col vento

  private updateDebris(steps: number, now: number, lv: WeatherLevels): void {
    const wind = lv.wind;
    const aw = Math.abs(wind);
    if (aw > 0.05 && this.debris.length < W.debrisMax && Math.random() < W.debrisRate * aw * Math.min(1, steps)) {
      const kind = DEBRIS_KINDS[Math.floor(Math.random() * DEBRIS_KINDS.length)];
      let d = this.freeDebris.pop();
      if (!d) {
        d = { img: this.scene.add.image(0, 0, kind.a).setDepth(DEPTH_PRECIP), x: 0, y: 0, vx: 0, vy: 0, a: '', b: '', nextAt: 0, frame: 0 };
      }
      d.a = kind.a;
      d.b = kind.b;
      d.x = wind > 0 ? -3 : SCREEN.width + 3;
      d.y = kind.low ? GROUND_Y - 1 - Math.random() * 14 : 40 + Math.random() * (GROUND_Y - 50);
      d.vx = Math.sign(wind) * rand(W.debrisSpeed) * (0.5 + aw * 0.5);
      d.vy = 0;
      d.nextAt = now;
      d.frame = 0;
      d.img.setTexture(kind.a).setVisible(true).setActive(true);
      this.debris.push(d);
    }
    const list = this.debris;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      if (now >= d.nextAt) {
        // svolazzo a scatti: cambia frame e direzione verticale
        d.nextAt = now + 90 + Math.random() * 140;
        d.frame ^= 1;
        d.img.setTexture(d.frame ? d.b : d.a);
        d.vy = (Math.random() - 0.5) * 1.4;
      }
      // il vento che cala rallenta i detriti (ma non li ferma)
      const k = 0.35 + 0.65 * Math.min(1, aw * 1.5);
      d.x += d.vx * k * steps;
      d.y = Math.min(GROUND_Y - 1, Math.max(28, d.y + d.vy * steps));
      if (d.x < -6 || d.x > SCREEN.width + 6) {
        d.img.setVisible(false).setActive(false);
        this.freeDebris.push(d);
        continue;
      }
      d.img.setPosition(Math.round(d.x), Math.round(d.y));
      list[w++] = d;
    }
    list.length = w;
  }

  // ---------------------------------------------------------------- lampo e annuncio

  private updateFlash(): void {
    let on = false;
    if (this.flashFrames > 0) {
      this.flashFrames--;
      on = true;
    } else if (this.secondFlashIn > 0) {
      if (--this.secondFlashIn === 0) this.flashFrames = W.secondFlashFrames;
    }
    this.flash.setVisible(on);
    if (this.boltFrames > 0) {
      this.boltFrames--;
      // la saetta sfarfalla mentre il lampo è spento
      this.bolt.setVisible(this.boltFrames > 0 && (this.boltFrames % 3 !== 1));
    }
  }

  private updateAnnounce(now: number): void {
    const t = now - this.announceAt;
    if (t > W.announceMs) {
      if (this.announceA.visible || this.announceB.visible) {
        this.announceA.setVisible(false);
        this.announceB.setVisible(false);
      }
      return;
    }
    const f = Math.floor(t / W.announceBlinkMs);
    // alterna bianco/ciano, poi negli ultimi istanti lampeggia e sparisce
    const fading = t > W.announceMs * 0.75;
    this.announceA.setVisible(f % 2 === 0);
    this.announceB.setVisible(!fading && f % 2 === 1);
  }
}
