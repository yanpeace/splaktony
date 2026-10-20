/**
 * Esplosione "grossa" riusabile da qualunque arma (granata, dinamite, RPG,
 * cannone al plasma...). Solo grafica e suono: il DANNO e la spinta a Tony
 * restano all'arma (this.hit(...) + ragdoll.applyRadialImpulse).
 *
 * API
 * ---
 *   prepareExplosion(scene, size)
 *       Genera in anticipo le texture per quella size (chiamala in activate()
 *       dell'arma: niente lavoro di canvas al primo boom). Idempotente.
 *
 *   bigExplosion(scene, x, y, size, opts?)
 *       size = raggio della palla di fuoco in px (≈ 12 piccola, 18 granata,
 *       27 dinamite, 34 enorme). Sequenza, a scatti e a pixel interi:
 *         1 frame di flash bianco a tutto schermo + tint arancio dello sfondo
 *         palla di fuoco a 6 frame (bianco → giallo → arancio → rosso → fumo)
 *         onda d'urto: anello di 1px che si espande in 4 frame
 *         schegge 2x2/3x3 che ruotano a scatti di 90°, rimbalzano e si raffreddano
 *         scintille, colonna di fumo che sale e si allarga (pool)
 *         vicino al pavimento: terra che schizza + segno di bruciatura che svanisce
 *         shake forte con decadimento; schegge/fumo già a terra sobbalzano
 *         boom a strati (explosionSound)
 *       opts (tutti facoltativi):
 *         shakePx / shakeMs   default size/4.5 px, EXPLOSIVES.shakeMs
 *         hitStopMs           default 0 (l'arma decide)
 *         depth               depth della palla di fuoco (default 55)
 *         flash / tint        default true
 *         sound               false = muto, numero 0..1 = potenza (default da size)
 *         debris / sparks / smoke / dirt   numero di pezzi (default da size)
 *         pieces              chiavi texture extra per le schegge (es. lamiera verde)
 *         scorch              default true (solo se vicino al pavimento)
 *         clamp               default true: la nuvola si appoggia a muri/pavimento
 *
 *   tossPiece(scene, x, y, key, vx, vy, opts?)
 *       Un pezzo che vola, ruota a scatti, rimbalza nella stanza e sparisce
 *       lampeggiando (spolette, fiammiferi, bossoli...). opts: { lifeMs, spin,
 *       depth, onFirstBounce }.
 *
 *   explosionSound(power 0..1)
 *       Solo il suono: playExplosion() + rombo basso + tono che scende + crepitio.
 *
 * Tutto vive in pool per scena (FX.maxPooledImages via acquireImage, più i
 * tetti EXPLOSION_FX.max*): oltre il tetto si ricicla il più vecchio. Allo
 * shutdown della scena lo stato viene dimenticato (Phaser distrugge gli oggetti).
 * Il clock interno si ferma durante l'hit-stop e segue scene.time.timeScale.
 */
import Phaser from 'phaser';
import { EXPLOSION_FX, EXPLOSIVES, ROOM_INNER, SCREEN } from '../config/balance';
import { C, col } from '../config/palette';
import { noise, playExplosion, tone } from '../audio/sfx';
import { acquireImage, hitStop, isFrozen, releaseImage, shake, spawnParticles } from '../gfx/effects';
import { makeSprites, type SpriteData } from '../gfx/pixelSprite';

const X = EXPLOSION_FX;
const STEP = 1000 / 60;

export interface BigExplosionOpts {
  shakePx?: number;
  shakeMs?: number;
  hitStopMs?: number;
  depth?: number;
  flash?: boolean;
  tint?: boolean;
  sound?: boolean | number;
  debris?: number;
  sparks?: number;
  smoke?: number;
  dirt?: number;
  pieces?: readonly string[];
  scorch?: boolean;
  clamp?: boolean;
}

export interface TossOpts {
  lifeMs?: number;
  /** moltiplicatore della velocità di rotazione (0 = non ruota) */
  spin?: number;
  depth?: number;
  onFirstBounce?: () => void;
}

// ==================================================================== texture

/** hash deterministico 0..1 (sprite generati sempre uguali) */
function hash(a: number, b: number): number {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

type Grid = string[][];

function emptyGrid(size: number): Grid {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => '.'));
}

function outline(grid: Grid, ch = '0'): void {
  const h = grid.length;
  const w = grid[0].length;
  const filled = grid.map((r) => r.map((c) => c !== '.'));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (filled[y][x]) continue;
      if (
        (x > 0 && filled[y][x - 1]) ||
        (x < w - 1 && filled[y][x + 1]) ||
        (y > 0 && filled[y - 1][x]) ||
        (y < h - 1 && filled[y + 1][x])
      ) {
        grid[y][x] = ch;
      }
    }
  }
}

/**
 * 6 frame della palla di fuoco di raggio R: flash bianco pieno, nucleo
 * bianco/giallo, arancio, rosso con buchi, rosso scuro che si sfalda, fumo.
 */
export function fireballFrames(R: number): SpriteData[] {
  const maxS = Math.max(...X.fireballScale);
  const H = Math.ceil(R * maxS) + 2;
  const size = H * 2 + 1;
  const lobes = 9;
  const frames: SpriteData[] = [];
  for (let f = 0; f < 6; f++) {
    const grid = emptyGrid(size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - H;
        const dy = y - H;
        const d = Math.hypot(dx, dy);
        // bordo "a nuvola": raggio che oscilla tra lobi interpolati
        const t = ((Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2)) * lobes;
        const i0 = Math.floor(t) % lobes;
        const i1 = (i0 + 1) % lobes;
        const k = t - Math.floor(t);
        const n = hash(i0, f + 3) * (1 - k) + hash(i1, f + 3) * k;
        const lumpy = f === 0 ? 0.08 : 0.24;
        const edge = R * X.fireballScale[f] * (1 - lumpy + lumpy * n);
        const u = d / edge;
        if (u > 1) continue;
        const grain = hash(x * 3 + f * 17, y * 7 + f);
        // luce dall'alto: la parte bassa della nuvola è più scura
        const v = u + (dy / Math.max(1, edge)) * 0.18;
        let ch = '.';
        switch (f) {
          case 0:
            ch = u < 0.82 ? 'c' : '4';
            break;
          case 1:
            ch = v < 0.5 ? 'c' : v < 0.8 ? '4' : '3';
            break;
          case 2:
            ch = v < 0.25 ? 'c' : v < 0.52 ? '4' : v < 0.8 ? '3' : '2';
            break;
          case 3:
            ch = v < 0.18 ? '4' : v < 0.45 ? '3' : v < 0.78 ? '2' : '1';
            if (u > 0.45 && grain > 0.86) ch = 'f';
            break;
          case 4:
            // si sfalda: rosso scuro e fumo con buchi
            if (grain > 0.8) ch = '.';
            else ch = v < 0.25 ? '3' : v < 0.55 ? '2' : v < 0.8 ? '1' : 'f';
            if (u > 0.6 && grain > 0.55) ch = (x + y) % 2 === 0 ? 'f' : '.';
            break;
          default:
            // solo fumo a scacchiera, sempre più rado verso il bordo
            if (grain < 0.25 + u * 0.45) ch = '.';
            else ch = v < 0.35 ? 'd' : v < 0.7 ? 'e' : 'f';
            if ((x + y) % 2 === 1 && u > 0.5) ch = '.';
        }
        grid[y][x] = ch;
      }
    }
    if (f <= 3) outline(grid, f === 0 ? '4' : '0');
    frames.push(grid.map((r) => r.join('')));
  }
  return frames;
}

/** 4 frame dell'onda d'urto: anello di 1px che si allarga e si rompe. */
function ringFrames(R: number): SpriteData[] {
  const rMax = Math.ceil(R * Math.max(...X.ringScale)) + 1;
  const size = rMax * 2 + 1;
  const colors = ['c', '4', '3', 'd'];
  return X.ringScale.map((s, f) => {
    const r = R * s;
    const grid = emptyGrid(size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d = Math.hypot(x - rMax, y - rMax);
        if (Math.abs(d - r) > 0.55) continue;
        // gli ultimi frame si spezzano a tratti
        const a = Math.atan2(y - rMax, x - rMax);
        const seg = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 24);
        if (f >= 2 && hash(seg, f) < (f === 2 ? 0.2 : 0.5)) continue;
        grid[y][x] = colors[f];
      }
    }
    return grid.map((row) => row.join(''));
  });
}

function puffFrame(r: number, dark: number): SpriteData {
  const size = r * 2 + 1;
  const grid = emptyGrid(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - r;
      const dy = y - r;
      const d = Math.hypot(dx, dy);
      if (d > r + 0.3) continue;
      const shade = (dx + dy) / (r * 2) + dark;
      let ch = shade < 0.05 ? 'd' : shade < 0.5 ? 'e' : 'f';
      // bordo a scacchiera: si "sfilaccia"
      if (d > r - 1 && (x + y) % 2 === 0) ch = '.';
      grid[y][x] = ch;
    }
  }
  return grid.map((row) => row.join(''));
}

function scorchFrame(R: number): SpriteData {
  const w = R * 2 + 1;
  const rows: string[] = [];
  for (let y = 0; y < 4; y++) {
    let row = '';
    for (let x = 0; x < w; x++) {
      const u = Math.abs(x - R) / R; // 0 al centro, 1 ai lati
      const lim = [0.55, 0.85, 1, 0.7][y];
      if (u > lim) {
        row += '.';
        continue;
      }
      const g = hash(x, y + 40);
      const edge = u > lim - 0.2;
      if (edge) row += g > 0.5 ? 'f' : '.';
      else row += y === 0 ? (g > 0.4 ? 'f' : '.') : g > 0.25 ? '0' : 'f';
    }
    rows.push(row);
  }
  return rows;
}

/** Pezzi generici: incandescenti (h*) che si raffreddano nei corrispondenti scuri (c*). */
const PIECES: Record<string, SpriteData> = {
  'fx-xd-h0': ['34', '23'],
  'fx-xd-h1': ['.4.', '432', '.2.'],
  'fx-xd-h2': ['43.', '332', '.21'],
  'fx-xd-c0': ['ef', 'f0'],
  'fx-xd-c1': ['.e.', 'ef0', '.0.'],
  'fx-xd-c2': ['de.', 'ef0', '.f0'],
  'fx-xd-r0': ['ef', 'ff'],
  'fx-xd-r1': ['fe.', 'eff', '.f0'],
};
const HOT = ['fx-xd-h0', 'fx-xd-h1', 'fx-xd-h2'];
const COLD = ['fx-xd-c0', 'fx-xd-c1', 'fx-xd-c2'];
const ROCK = ['fx-xd-r0', 'fx-xd-r1'];
const PUFF_KEYS = ['fx-xs-0', 'fx-xs-1', 'fx-xs-2', 'fx-xs-3', 'fx-xs-4', 'fx-xs-5'];

function fireKeys(R: number): string[] {
  return [0, 1, 2, 3, 4, 5].map((i) => `fx-xf-${R}-${i}`);
}
function ringKeys(R: number): string[] {
  return [0, 1, 2, 3].map((i) => `fx-xr-${R}-${i}`);
}
function scorchKey(R: number): string {
  return `fx-xb-${R}`;
}

/** Genera (una volta) le texture dell'esplosione di quella size. */
export function prepareExplosion(scene: Phaser.Scene, size: number): void {
  const R = Math.max(4, Math.round(size));
  if (!scene.textures.exists('fx-xs-5')) {
    makeSprites(scene, {
      ...PIECES,
      'fx-xs-0': puffFrame(2, 0),
      'fx-xs-1': puffFrame(3, 0.05),
      'fx-xs-2': puffFrame(4, 0.15),
      'fx-xs-3': puffFrame(5, 0.25),
      'fx-xs-4': puffFrame(6, 0.35),
      'fx-xs-5': puffFrame(7, 0.5),
    });
  }
  const fk = fireKeys(R);
  if (!scene.textures.exists(fk[5])) {
    const sprites: Record<string, SpriteData> = {};
    fireballFrames(R).forEach((d, i) => (sprites[fk[i]] = d));
    ringFrames(R).forEach((d, i) => (sprites[ringKeys(R)[i]] = d));
    sprites[scorchKey(R)] = scorchFrame(R);
    makeSprites(scene, sprites);
  }
}

// ==================================================================== stato per scena

interface Anim {
  img: Phaser.GameObjects.Image;
  keys: readonly string[];
  ms: readonly number[];
  t0: number;
  /** salita per frame (px) */
  rise?: readonly number[];
  y0: number;
}

interface Piece {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  q: number;
  spinAcc: number;
  spin: number;
  born: number;
  life: number;
  cool?: string;
  coolAt: number;
  bounced: boolean;
  onFirstBounce?: () => void;
}

interface Puff {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  delay: number;
  life: number;
}

interface Scorch {
  img: Phaser.GameObjects.Image;
  born: number;
}

interface XState {
  t: number;
  anims: Anim[];
  pieces: Piece[];
  puffs: Puff[];
  scorches: Scorch[];
  flash: Phaser.GameObjects.Rectangle | null;
  tint: Phaser.GameObjects.Rectangle | null;
  flashPending: boolean;
  flashShown: boolean;
  tintLeft: number;
}

const states = new WeakMap<Phaser.Scene, XState>();

function state(scene: Phaser.Scene): XState {
  let s = states.get(scene);
  if (s) return s;
  const st: XState = {
    t: 0,
    anims: [],
    pieces: [],
    puffs: [],
    scorches: [],
    flash: null,
    tint: null,
    flashPending: false,
    flashShown: false,
    tintLeft: 0,
  };
  states.set(scene, st);
  const onUpdate = (_t: number, dt: number) => tick(scene, st, dt);
  const onPost = () => postUpdate(st);
  scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
  scene.events.on(Phaser.Scenes.Events.POST_UPDATE, onPost);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
    scene.events.off(Phaser.Scenes.Events.POST_UPDATE, onPost);
    states.delete(scene);
  });
  return st;
}

function overlay(scene: Phaser.Scene, color: number, depth: number): Phaser.GameObjects.Rectangle {
  // un po' più grande dello schermo: copre anche durante lo shake
  return scene.add
    .rectangle(-8, -8, SCREEN.width + 16, SCREEN.height + 16, color)
    .setOrigin(0)
    .setScrollFactor(0)
    .setDepth(depth)
    .setVisible(false);
}

/** flash e tint contano frame disegnati, non ms: esattamente 1 frame di bianco. */
function postUpdate(s: XState): void {
  if (s.flash) {
    if (s.flashPending) {
      s.flashPending = false;
      s.flashShown = true;
      s.flash.setVisible(true);
    } else if (s.flashShown) {
      s.flashShown = false;
      s.flash.setVisible(false);
    }
  }
  if (s.tint) {
    if (s.tintLeft > 0) {
      s.tint.setVisible(true);
      s.tintLeft--;
    } else if (s.tint.visible) s.tint.setVisible(false);
  }
}

function tick(scene: Phaser.Scene, s: XState, dtRaw: number): void {
  if (isFrozen(scene)) return;
  const dt = dtRaw * scene.time.timeScale;
  s.t += dt;
  const now = s.t;
  const steps = dt / STEP;
  tickAnims(s, now);
  tickPieces(s, now, steps, dt);
  tickPuffs(s, now, steps);
  tickScorches(s, now);
}

function tickAnims(s: XState, now: number): void {
  let w = 0;
  for (const a of s.anims) {
    let t = now - a.t0;
    let f = 0;
    while (f < a.ms.length && t >= a.ms[f]) t -= a.ms[f++];
    if (f >= a.keys.length) {
      releaseImage(a.img);
      continue;
    }
    if (a.img.texture.key !== a.keys[f]) a.img.setTexture(a.keys[f]);
    if (a.rise) a.img.y = Math.round(a.y0 - a.rise[f]);
    s.anims[w++] = a;
  }
  s.anims.length = w;
}

function tickPieces(s: XState, now: number, steps: number, dt: number): void {
  const { left, right, top, bottom } = ROOM_INNER;
  let w = 0;
  for (const p of s.pieces) {
    const age = now - p.born;
    if (age >= p.life || !p.img.active) {
      releaseImage(p.img);
      continue;
    }
    p.vy += X.debrisGravity * steps;
    p.x += p.vx * steps;
    p.y += p.vy * steps;
    const floor = bottom - p.r;
    let bounced = false;
    if (p.y > floor) {
      p.y = floor;
      if (p.vy > 0) {
        bounced = p.vy > 0.8;
        p.vy = -p.vy * X.debrisBounce;
        if (p.vy > -0.6) p.vy = 0;
      }
      p.vx *= Math.pow(0.82, steps);
      if (Math.abs(p.vx) < 0.05) p.vx = 0;
    } else if (p.y < top + p.r) {
      p.y = top + p.r;
      p.vy = Math.abs(p.vy) * X.debrisBounce;
    }
    if (p.x < left + p.r) {
      p.x = left + p.r;
      p.vx = Math.abs(p.vx) * X.debrisBounce;
      bounced = true;
    } else if (p.x > right - p.r) {
      p.x = right - p.r;
      p.vx = -Math.abs(p.vx) * X.debrisBounce;
      bounced = true;
    }
    if (bounced && !p.bounced) {
      p.bounced = true;
      p.onFirstBounce?.();
    }
    // rotazione a scatti di 90 gradi, più rapida se va veloce
    const speed = Math.hypot(p.vx, p.vy);
    if (p.spin > 0 && speed > 0.2) {
      p.spinAcc += dt * speed * p.spin;
      while (p.spinAcc >= X.debrisSpinMs) {
        p.spinAcc -= X.debrisSpinMs;
        p.q = (p.q + (p.vx >= 0 ? 1 : 3)) % 4;
      }
    }
    if (p.cool && age >= p.coolAt) {
      p.img.setTexture(p.cool);
      p.cool = undefined;
    }
    p.img.setPosition(Math.round(p.x), Math.round(p.y)).setRotation((p.q * Math.PI) / 2);
    const left2 = p.life - age;
    p.img.setVisible(left2 > 400 || Math.floor(left2 / 70) % 2 === 0);
    s.pieces[w++] = p;
  }
  s.pieces.length = w;
}

function tickPuffs(s: XState, now: number, steps: number): void {
  const { left, right, top } = ROOM_INNER;
  let w = 0;
  for (const p of s.puffs) {
    const age = now - p.born - p.delay;
    if (age >= p.life || !p.img.active) {
      releaseImage(p.img);
      continue;
    }
    if (age < 0) {
      s.puffs[w++] = p;
      continue;
    }
    const k = age / p.life;
    p.img.setVisible(k < 0.75 || Math.floor(age / 80) % 2 === 0);
    // sale rallentando, si allarga, sotto al soffitto si schiaccia ai lati
    p.vy *= Math.pow(0.985, steps);
    p.vx *= Math.pow(0.98, steps);
    p.x += p.vx * steps;
    p.y += p.vy * steps;
    if (p.y < top + 4) {
      p.y = top + 4;
      p.vx += Math.sign(p.vx || 1) * 0.02 * steps;
    }
    p.x = Phaser.Math.Clamp(p.x, left + 2, right - 2);
    const f = Math.min(PUFF_KEYS.length - 1, Math.floor(k * PUFF_KEYS.length * 1.15));
    if (p.img.texture.key !== PUFF_KEYS[f]) p.img.setTexture(PUFF_KEYS[f]);
    p.img.setPosition(Math.round(p.x), Math.round(p.y));
    s.puffs[w++] = p;
  }
  s.puffs.length = w;
}

function tickScorches(s: XState, now: number): void {
  let w = 0;
  for (const sc of s.scorches) {
    const k = (now - sc.born) / X.scorchMs;
    if (k >= 1 || !sc.img.active) {
      releaseImage(sc.img);
      continue;
    }
    // svanisce a gradini, poi lampeggia
    const a = k < 0.55 ? 1 : k < 0.75 ? 0.66 : 0.4;
    sc.img.setAlpha(a);
    sc.img.setVisible(k < 0.9 || Math.floor(k * 60) % 2 === 0);
    s.scorches[w++] = sc;
  }
  s.scorches.length = w;
}

// ==================================================================== API

function addPiece(
  s: XState,
  scene: Phaser.Scene,
  x: number,
  y: number,
  key: string,
  vx: number,
  vy: number,
  life: number,
  depth: number,
  spin = 1,
  cool?: string,
): Piece {
  if (s.pieces.length >= X.maxDebris) {
    const old = s.pieces.shift();
    if (old) releaseImage(old.img);
  }
  const img = acquireImage(scene, x, y, key).setDepth(depth);
  const frame = scene.textures.getFrame(key);
  const r = frame ? Math.ceil(Math.max(frame.width, frame.height) / 2) : 1;
  const p: Piece = {
    img,
    x,
    y,
    vx,
    vy,
    r,
    q: Math.floor(Math.random() * 4),
    spinAcc: 0,
    spin,
    born: s.t,
    life,
    cool,
    coolAt: X.debrisCoolMs * (0.7 + Math.random() * 0.6),
    bounced: false,
  };
  s.pieces.push(p);
  return p;
}

/** Pezzo che vola, ruota a scatti, rimbalza nella stanza e sparisce lampeggiando. */
export function tossPiece(
  scene: Phaser.Scene,
  x: number,
  y: number,
  key: string,
  vx: number,
  vy: number,
  opts: TossOpts = {},
): void {
  const s = state(scene);
  const p = addPiece(s, scene, x, y, key, vx, vy, opts.lifeMs ?? 1800, opts.depth ?? 22, opts.spin ?? 1);
  p.onFirstBounce = opts.onFirstBounce;
}

let lastBoomAt = -1e9;

/** Boom a strati: playExplosion + rombo basso + tono che scende + crepitio. */
export function explosionSound(power = 0.6): void {
  const now = performance.now();
  if (now - lastBoomAt < 60) return;
  lastBoomAt = now;
  const k = Phaser.Math.Clamp(power, 0, 1);
  playExplosion();
  noise({ dur: 0.8 + k * 0.6, vol: 0.4 + k * 0.25, freq: 420, freqTo: 35 });
  tone({ type: 'sine', from: 150 - k * 40, to: 24, dur: 0.7 + k * 0.4, vol: 0.45 + k * 0.15 });
  tone({ type: 'square', from: 70, to: 22, dur: 0.35 + k * 0.25, vol: 0.12, delay: 0.02 });
  // crepitio: schiocchi corti e acuti sparsi dopo il botto
  const crackles = 4 + Math.round(k * 5);
  for (let i = 0; i < crackles; i++) {
    noise({
      dur: 0.015 + Math.random() * 0.03,
      vol: 0.08 + Math.random() * 0.1,
      freq: 2500 + Math.random() * 3000,
      highpass: true,
      delay: 0.08 + Math.random() * (0.5 + k * 0.4),
    });
  }
}

/** Esplosione grossa (vedi la documentazione in testa al file). */
export function bigExplosion(scene: Phaser.Scene, x: number, y: number, size: number, opts: BigExplosionOpts = {}): void {
  const R = Math.max(4, Math.round(size));
  prepareExplosion(scene, R);
  const s = state(scene);
  const per10 = R / 10;
  const depth = opts.depth ?? 55;
  const { left, right, bottom } = ROOM_INNER;
  x = Math.round(x);
  y = Math.round(y);

  // la nuvola si appoggia a pavimento/muri invece di sbordarci dentro
  let bx = x;
  let by = y;
  if (opts.clamp !== false) {
    const m = Math.round(R * 0.5);
    bx = Phaser.Math.Clamp(x, left + m, right - m);
    by = Math.min(y, bottom - m);
  }
  const nearFloor = y >= bottom - R * X.scorchNearFloor;

  // ---- flash bianco (1 frame) + tint arancio dello sfondo
  if (opts.flash !== false) {
    if (!s.flash) s.flash = overlay(scene, col(C.white), 57);
    s.flash.setAlpha(X.flashAlpha);
    s.flashPending = true;
  }
  if (opts.tint !== false) {
    if (!s.tint) s.tint = overlay(scene, col(C.orange), 8);
    s.tint.setAlpha(X.tintAlpha);
    s.tintLeft = X.tintFrames + 1;
  }

  // ---- gli effetti leggeri già in giro sobbalzano
  const range = R * X.jiggleRange;
  for (const p of s.pieces) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d > range) continue;
    const k = 1 - d / range;
    p.vy -= X.jiggleKick * k * (0.7 + Math.random() * 0.6);
    p.vx += Math.sign(p.x - x || 1) * X.jiggleKick * 0.5 * k;
  }
  for (const p of s.puffs) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d > range || d < 0.01) continue;
    const k = 1 - d / range;
    p.vx += ((p.x - x) / d) * 1.2 * k;
    p.vy += ((p.y - y) / d) * 0.8 * k;
  }

  // ---- palla di fuoco a 6 frame (sale un po' negli ultimi)
  const fire = acquireImage(scene, bx, by, fireKeys(R)[0]).setDepth(depth);
  s.anims.push({
    img: fire,
    keys: fireKeys(R),
    ms: X.fireballFrameMs,
    t0: s.t,
    rise: X.fireballRise.map((r) => Math.round(r * per10)),
    y0: by,
  });
  // ---- onda d'urto
  const ring = acquireImage(scene, x, y, ringKeys(R)[0]).setDepth(depth - 0.5);
  s.anims.push({ img: ring, keys: ringKeys(R), ms: X.ringFrameMs, t0: s.t, y0: y });

  // ---- scintille veloci
  spawnParticles(scene, x, y, {
    count: opts.sparks ?? Math.round(X.sparksPer10 * per10),
    colors: [C.white, C.yellow, C.yellow, C.orange],
    speed: X.sparkSpeed,
    gravity: 0.1,
    lifeMs: 420,
    depth: depth + 1,
  });

  // ---- schegge che ruotano e rimbalzano
  const nDebris = opts.debris ?? Math.round(X.debrisPer10 * per10);
  const extra = opts.pieces ?? [];
  for (let i = 0; i < nDebris; i++) {
    // verso l'alto se è a terra, ovunque se è in aria
    const a = nearFloor ? -Math.PI / 2 + (Math.random() - 0.5) * 2.6 : Math.random() * Math.PI * 2;
    const v = X.debrisSpeed * (0.45 + Math.random() * 0.75);
    const life = Phaser.Math.Between(X.debrisLifeMs[0], X.debrisLifeMs[1]);
    const roll = Math.random();
    let key: string;
    let cool: string | undefined;
    if (extra.length > 0 && roll < 0.4) key = extra[Math.floor(Math.random() * extra.length)];
    else if (roll < 0.75) {
      const h = Math.floor(Math.random() * HOT.length);
      key = HOT[h];
      cool = COLD[h];
    } else key = ROCK[Math.floor(Math.random() * ROCK.length)];
    addPiece(s, scene, x, y, key, Math.cos(a) * v, Math.sin(a) * v, life, depth - 1, 1, cool);
  }

  // ---- terra che schizza + bruciatura
  if (nearFloor) {
    const fy = bottom - 1;
    const dirt = opts.dirt ?? Math.round(X.dirtPer10 * per10);
    const colors = [C.orange, C.plum, C.charcoal, C.slate, C.yellow];
    spawnParticles(scene, x, fy, { count: dirt, colors, speed: 4, angle: -Math.PI / 2, spread: 1.2, gravity: 0.22, lifeMs: 700 });
    spawnParticles(scene, x - 2, fy, { count: Math.ceil(dirt / 3), colors, speed: 3.2, angle: -Math.PI + 0.35, spread: 0.5, gravity: 0.22, lifeMs: 550 });
    spawnParticles(scene, x + 2, fy, { count: Math.ceil(dirt / 3), colors, speed: 3.2, angle: -0.35, spread: 0.5, gravity: 0.22, lifeMs: 550 });
    if (opts.scorch !== false) {
      if (s.scorches.length >= X.maxScorch) {
        const old = s.scorches.shift();
        if (old) releaseImage(old.img);
      }
      const sx = Phaser.Math.Clamp(x, left + R, right - R);
      const img = acquireImage(scene, sx, bottom - 1, scorchKey(R)).setOrigin(0.5, 0).setDepth(5);
      s.scorches.push({ img, born: s.t });
    }
  }

  // ---- colonna di fumo: sbuffi scaglionati che salgono e si allargano
  const nSmoke = opts.smoke ?? Math.round(X.smokePer10 * per10);
  for (let i = 0; i < nSmoke; i++) {
    if (s.puffs.length >= X.maxSmoke) {
      const old = s.puffs.shift();
      if (old) releaseImage(old.img);
    }
    const ox = (Math.random() - 0.5) * R * 0.9;
    const img = acquireImage(scene, bx + ox, by, PUFF_KEYS[0]).setDepth(depth - 1.5).setVisible(false);
    const k = i / Math.max(1, nSmoke - 1);
    s.puffs.push({
      img,
      x: bx + ox,
      y: by - Math.random() * R * 0.4,
      vx: ox * X.smokeSpread * 0.2 + (Math.random() - 0.5) * 0.25,
      vy: -X.smokeRiseSpeed * (0.6 + Math.random() * 0.8) * (0.8 + per10 * 0.2),
      born: s.t,
      delay: X.fireballFrameMs[0] * 2 + k * X.smokeSpawnMs,
      life: Phaser.Math.Between(X.smokeLifeMs[0], X.smokeLifeMs[1]),
    });
  }

  shake(scene, opts.shakePx ?? Math.max(2, Math.round(R / 4.5)), opts.shakeMs ?? EXPLOSIVES.shakeMs);
  if (opts.hitStopMs) hitStop(scene, opts.hitStopMs);
  if (opts.sound !== false) explosionSound(typeof opts.sound === 'number' ? opts.sound : Phaser.Math.Clamp((R - 8) / 24, 0, 1));
}
