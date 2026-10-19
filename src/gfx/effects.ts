import Phaser from 'phaser';
import { FX } from '../config/balance';
import { C, col, type ColorIndex } from '../config/palette';
import { fontKey, ensurePixelFont, normalizeText } from './pixelFont';

/**
 * Effetti riutilizzabili in stile pixel: particelle quadrate, flash bianco,
 * screen shake a pixel interi, hit-stop, numeri di danno, pop a pochi frame.
 * Tutte le funzioni prendono la scena come primo argomento; lo stato per
 * scena viene creato al primo uso e ripulito allo shutdown della scena.
 *
 * Prestazioni (60 fps su telefono): particelle, numeri, pop e le immagini
 * delle armi vengono da pool riutilizzati; nessun oggetto viene creato o
 * distrutto a ogni colpo una volta "scaldati" i pool. Ogni pool ha un tetto
 * (FX.max*): oltre il tetto si ricicla l'elemento più vecchio.
 * Le armi usano acquireImage()/releaseImage() per proiettili, bossoli, fori...
 */

interface Particle {
  obj: Phaser.GameObjects.Rectangle;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  gravity: number;
}

interface FloatingNumber {
  obj: Phaser.GameObjects.BitmapText;
  x0: number;
  y0: number;
  drift: number;
  start: number;
}

interface Pop {
  img: Phaser.GameObjects.Image;
  frames: readonly string[];
  frameMs: number;
  start: number;
}

interface FxState {
  particles: Particle[];
  freeRects: Phaser.GameObjects.Rectangle[];
  numbers: FloatingNumber[];
  freeTexts: Phaser.GameObjects.BitmapText[];
  pops: Pop[];
  freeImages: Phaser.GameObjects.Image[];
  shakeUntil: number;
  shakeStart: number;
  shakePx: number;
  freezeUntil: number;
}

const states = new WeakMap<Phaser.Scene, FxState>();

function state(scene: Phaser.Scene): FxState {
  let s = states.get(scene);
  if (s) return s;
  const st: FxState = {
    particles: [],
    freeRects: [],
    numbers: [],
    freeTexts: [],
    pops: [],
    freeImages: [],
    shakeUntil: 0,
    shakeStart: 0,
    shakePx: 0,
    freezeUntil: 0,
  };
  states.set(scene, st);
  const onUpdate = (_t: number, dt: number) => tick(scene, st, dt);
  scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
    // gli oggetti di scena vengono distrutti da Phaser: basta dimenticarli
    states.delete(scene);
  });
  return st;
}

const STEP_MS = 1000 / 60;

function tick(scene: Phaser.Scene, s: FxState, dtMs: number): void {
  const now = scene.time.now;
  const cam = scene.cameras.main;

  // screen shake: offset intero e casuale, che decresce nel tempo
  if (now < s.shakeUntil) {
    const k = (s.shakeUntil - now) / Math.max(1, s.shakeUntil - s.shakeStart);
    const a = Math.max(1, Math.round(s.shakePx * k));
    cam.setScroll(Phaser.Math.Between(-a, a), Phaser.Math.Between(-a, a));
  } else if (cam.scrollX !== 0 || cam.scrollY !== 0) {
    cam.setScroll(0, 0);
  }

  tickNumbers(s, now);
  tickPops(s, now);

  // durante l'hit-stop anche le particelle restano ferme
  if (now < s.freezeUntil) return;
  const steps = dtMs / STEP_MS;
  const drag = Math.pow(0.96, steps);
  const ps = s.particles;
  let w = 0;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    p.life -= dtMs;
    if (p.life <= 0) {
      recycleRect(s, p.obj);
      continue;
    }
    p.vy += p.gravity * steps;
    p.x += p.vx * steps;
    p.y += p.vy * steps;
    p.vx *= drag;
    p.obj.setPosition(Math.round(p.x), Math.round(p.y));
    // ultimi istanti: lampeggio invece di dissolvenza (più retro)
    if (p.life < 150) p.obj.setVisible(Math.floor(p.life / 50) % 2 === 0);
    ps[w++] = p;
  }
  ps.length = w;
}

// ---------------------------------------------------------------- pool di immagini

/**
 * Immagine dal pool (o nuova se il pool è vuoto), già visibile e con stato
 * azzerato: origine 0.5, depth 0, niente rotazione/flip/tint/alpha/scala.
 * Restituiscila con releaseImage() invece di destroy().
 */
export function acquireImage(scene: Phaser.Scene, x: number, y: number, key: string): Phaser.GameObjects.Image {
  const s = state(scene);
  let img = s.freeImages.pop();
  // un'immagine distrutta da altri (es. pulizia manuale) non ha più scene: scartala
  while (img && !img.scene) img = s.freeImages.pop();
  if (!img) return scene.add.image(Math.round(x), Math.round(y), key);
  return img
    .setTexture(key)
    .setPosition(Math.round(x), Math.round(y))
    .setOrigin(0.5)
    .setDepth(0)
    .setRotation(0)
    .setScale(1)
    .setAlpha(1)
    .setFlip(false, false)
    .clearTint()
    .setActive(true)
    .setVisible(true);
}

/** Rimette un'immagine nel pool (nascosta). Sicuro anche se già rilasciata o distrutta. */
export function releaseImage(img: Phaser.GameObjects.Image | null | undefined): void {
  if (!img || !img.scene || !img.active) return;
  const s = states.get(img.scene);
  if (!s || s.freeImages.length >= FX.maxPooledImages) {
    img.destroy();
    return;
  }
  img.setActive(false).setVisible(false);
  s.freeImages.push(img);
}

// ---------------------------------------------------------------- shake

/** Scuote la camera di `px` pixel interi per `ms` millisecondi. */
export function shake(scene: Phaser.Scene, px: number = FX.shakePx, ms: number = FX.shakeMs): void {
  const s = state(scene);
  const now = scene.time.now;
  const active = now < s.shakeUntil;
  s.shakePx = Math.max(active ? s.shakePx : 0, Math.round(px));
  s.shakeStart = now;
  s.shakeUntil = Math.max(s.shakeUntil, now + ms);
}

// ---------------------------------------------------------------- hit-stop

/**
 * Congela la fisica e le particelle per `ms` (30-60ms sui colpi forti).
 * La scena di gioco controlla isFrozen() prima di avanzare la fisica.
 */
export function hitStop(scene: Phaser.Scene, ms: number): void {
  const s = state(scene);
  s.freezeUntil = Math.max(s.freezeUntil, scene.time.now + ms);
}

export function isFrozen(scene: Phaser.Scene): boolean {
  const s = states.get(scene);
  return !!s && scene.time.now < s.freezeUntil;
}

// ---------------------------------------------------------------- particelle

export interface ParticleOpts {
  count?: number;
  colors?: readonly (ColorIndex | number)[];
  /** velocità massima iniziale (px/step) */
  speed?: number;
  /** direzione preferita in radianti (default: tutte le direzioni) */
  angle?: number;
  /** ampiezza del cono attorno ad angle */
  spread?: number;
  gravity?: number;
  lifeMs?: number;
  /** 1 o 2 px; default: misto */
  size?: 1 | 2;
  depth?: number;
}

function recycleRect(s: FxState, r: Phaser.GameObjects.Rectangle): void {
  r.setVisible(false).setActive(false);
  s.freeRects.push(r);
}

/**
 * Particelle quadrate 1x1 / 2x2 con gravità, che lampeggiano prima di sparire.
 * Al massimo FX.maxParticles vive: oltre, si riciclano le più vecchie.
 */
export function spawnParticles(scene: Phaser.Scene, x: number, y: number, opts: ParticleOpts = {}): void {
  const s = state(scene);
  const {
    count = 8,
    colors = [C.white, C.silver],
    speed = 3,
    angle,
    spread = Math.PI * 2,
    gravity = 0.18,
    lifeMs = 500,
    size,
    depth = 50,
  } = opts;
  const n = Math.min(count, FX.maxParticles);
  // fa spazio riciclando le particelle più vecchie (in testa all'array)
  const overflow = s.particles.length + n - FX.maxParticles;
  if (overflow > 0) {
    for (let i = 0; i < overflow; i++) recycleRect(s, s.particles[i].obj);
    s.particles.splice(0, overflow);
  }
  const rx = Math.round(x);
  const ry = Math.round(y);
  for (let i = 0; i < n; i++) {
    const a = angle === undefined ? Math.random() * Math.PI * 2 : angle + (Math.random() - 0.5) * spread;
    const v = speed * (0.35 + Math.random() * 0.65);
    const sz = size ?? (Math.random() < 0.4 ? 2 : 1);
    const color = col(colors[Math.floor(Math.random() * colors.length)]);
    let obj = s.freeRects.pop();
    if (obj) {
      obj.setPosition(rx, ry).setSize(sz, sz).setFillStyle(color).setDepth(depth).setActive(true).setVisible(true);
    } else {
      obj = scene.add.rectangle(rx, ry, sz, sz, color).setOrigin(0).setDepth(depth);
    }
    s.particles.push({
      obj,
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      life: lifeMs * (0.6 + Math.random() * 0.4),
      gravity,
    });
  }
}

// ---------------------------------------------------------------- flash

type Tintable = Phaser.GameObjects.Components.Tint & Phaser.GameObjects.GameObject;

/** Flash bianco pieno per `frames` frame (1-2) su uno sprite. */
export function hitFlash(target: Tintable, frames: number = FX.flashFrames): void {
  const scene = target.scene;
  if (!scene) return;
  target.setTintFill(col(C.white));
  let left = frames;
  const onUpdate = () => {
    if (--left > 0) return;
    scene.events.off(Phaser.Scenes.Events.POST_UPDATE, onUpdate);
    if (target.active) target.clearTint();
  };
  scene.events.on(Phaser.Scenes.Events.POST_UPDATE, onUpdate);
}

// ---------------------------------------------------------------- numeri di danno

export function damageColor(amount: number): ColorIndex {
  if (amount >= FX.numberHuge) return C.red;
  if (amount >= FX.numberBig) return C.orange;
  if (amount >= FX.numberMid) return C.yellow;
  return C.white;
}

const NUMBER_MS = 650;

function tickNumbers(s: FxState, now: number): void {
  const list = s.numbers;
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const n = list[i];
    const k = Math.min(1, (now - n.start) / NUMBER_MS);
    if (k >= 1) {
      n.obj.setVisible(false).setActive(false);
      s.freeTexts.push(n.obj);
      continue;
    }
    // salto parabolico rapido nel primo 40%, poi fermo e lampeggio
    const jump = k < 0.4 ? Math.sin((k / 0.4) * Math.PI * 0.5) : 1;
    n.obj.setPosition(Math.round(n.x0 + n.drift * jump), Math.round(n.y0 - 14 * jump));
    n.obj.setVisible(k <= 0.65 || Math.floor(k * 20) % 2 === 0);
    list[w++] = n;
  }
  list.length = w;
}

/** Numero pixel che salta su, rimbalza e sparisce lampeggiando. */
export function damageNumber(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  color: ColorIndex | number = C.white,
  depth = 60,
): void {
  const s = state(scene);
  // troppi numeri a schermo: ricicla il più vecchio
  if (s.numbers.length >= FX.maxDamageNumbers) {
    const old = s.numbers.shift();
    if (old) s.freeTexts.push(old.obj);
  }
  const key = ensurePixelFont(scene, color);
  let t = s.freeTexts.pop();
  if (t) {
    if (t.font !== fontKey(color)) t.setFont(key);
    t.setText(normalizeText(text)).setDepth(depth).setActive(true).setVisible(true);
  } else {
    t = scene.add.bitmapText(0, 0, key, normalizeText(text)).setLetterSpacing(-1).setOrigin(0.5, 1).setDepth(depth);
  }
  const dir = Math.random() < 0.5 ? -1 : 1;
  const drift = dir * (2 + Math.random() * 6);
  // resta sempre dentro lo schermo, anche a fine deriva
  const half = Math.ceil(t.width / 2) + 9;
  const x0 = Phaser.Math.Clamp(x, half, scene.scale.gameSize.width - half);
  t.setPosition(Math.round(x0), Math.round(y));
  s.numbers.push({ obj: t, x0, y0: y, drift, start: scene.time.now });
}

// ---------------------------------------------------------------- pop a frame

function tickPops(s: FxState, now: number): void {
  const list = s.pops;
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const f = Math.floor((now - p.start) / p.frameMs);
    if (f >= p.frames.length) {
      releaseImage(p.img);
      continue;
    }
    const key = p.frames[f];
    if (p.img.texture.key !== key) p.img.setTexture(key);
    list[w++] = p;
  }
  list.length = w;
}

/**
 * Mostra una breve animazione a pochi frame (chiavi di texture) in un punto,
 * poi la rimette nel pool. Utile per pugni, scintille, "poof", esplosioni.
 */
export function popFrames(
  scene: Phaser.Scene,
  x: number,
  y: number,
  frames: readonly string[],
  frameMs = 50,
  opts: { depth?: number; rotation?: number; flipX?: boolean } = {},
): Phaser.GameObjects.Image {
  const s = state(scene);
  if (s.pops.length >= FX.maxPops) releaseImage(s.pops.shift()?.img);
  const img = acquireImage(scene, x, y, frames[0])
    .setDepth(opts.depth ?? 55)
    .setRotation(opts.rotation ?? 0)
    .setFlipX(!!opts.flipX);
  s.pops.push({ img, frames, frameMs, start: scene.time.now });
  return img;
}
