import Phaser from 'phaser';
import { FX } from '../config/balance';
import { C, col, type ColorIndex } from '../config/palette';
import { pixelText } from './pixelFont';

/**
 * Effetti riutilizzabili in stile pixel: particelle quadrate, flash bianco,
 * screen shake a pixel interi, hit-stop, numeri di danno, pop a pochi frame.
 * Tutte le funzioni prendono la scena come primo argomento; lo stato per
 * scena viene creato al primo uso e ripulito allo shutdown della scena.
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

interface FxState {
  particles: Particle[];
  shakeUntil: number;
  shakeStart: number;
  shakePx: number;
  freezeUntil: number;
}

const states = new WeakMap<Phaser.Scene, FxState>();

function state(scene: Phaser.Scene): FxState {
  let s = states.get(scene);
  if (s) return s;
  const st: FxState = { particles: [], shakeUntil: 0, shakeStart: 0, shakePx: 0, freezeUntil: 0 };
  states.set(scene, st);
  scene.events.on(Phaser.Scenes.Events.UPDATE, (_t: number, dt: number) => tick(scene, st, dt));
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    st.particles.forEach((p) => p.obj.destroy());
    states.delete(scene);
  });
  return st;
}

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

  // durante l'hit-stop anche le particelle restano ferme
  if (now < s.freezeUntil) return;
  const steps = dtMs / (1000 / 60);
  for (let i = s.particles.length - 1; i >= 0; i--) {
    const p = s.particles[i];
    p.vy += p.gravity * steps;
    p.x += p.vx * steps;
    p.y += p.vy * steps;
    p.vx *= Math.pow(0.96, steps);
    p.life -= dtMs;
    p.obj.setPosition(Math.round(p.x), Math.round(p.y));
    // ultimi istanti: lampeggio invece di dissolvenza (più retro)
    if (p.life < 150) p.obj.setVisible(Math.floor(p.life / 50) % 2 === 0);
    if (p.life <= 0) {
      p.obj.destroy();
      s.particles.splice(i, 1);
    }
  }
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

/** Particelle quadrate 1x1 / 2x2 con gravità, che lampeggiano prima di sparire. */
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
  const n = Math.min(count, FX.maxParticles - s.particles.length);
  for (let i = 0; i < n; i++) {
    const a = angle === undefined ? Math.random() * Math.PI * 2 : angle + (Math.random() - 0.5) * spread;
    const v = speed * (0.35 + Math.random() * 0.65);
    const sz = size ?? (Math.random() < 0.4 ? 2 : 1);
    const color = colors[Math.floor(Math.random() * colors.length)];
    const obj = scene.add.rectangle(Math.round(x), Math.round(y), sz, sz, col(color)).setOrigin(0).setDepth(depth);
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

/** Numero pixel che salta su, rimbalza e sparisce lampeggiando. */
export function damageNumber(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  color: ColorIndex | number = C.white,
  depth = 60,
): void {
  const t = pixelText(scene, x, y, text, color).setOrigin(0.5, 1).setDepth(depth);
  const dir = Math.random() < 0.5 ? -1 : 1;
  const drift = dir * (2 + Math.random() * 6);
  // resta sempre dentro lo schermo, anche a fine deriva
  const half = Math.ceil(t.width / 2) + 9;
  const x0 = Phaser.Math.Clamp(x, half, scene.scale.gameSize.width - half);
  const y0 = y;
  const duration = 650;
  const start = scene.time.now;
  const onUpdate = () => {
    const k = Math.min(1, (scene.time.now - start) / duration);
    // salto parabolico rapido nel primo 40%, poi fermo e lampeggio
    const jump = k < 0.4 ? Math.sin((k / 0.4) * Math.PI * 0.5) : 1;
    t.setPosition(Math.round(x0 + drift * jump), Math.round(y0 - 14 * jump));
    if (k > 0.65) t.setVisible(Math.floor(k * 20) % 2 === 0);
    if (k >= 1) {
      scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
      t.destroy();
    }
  };
  scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate));
}

// ---------------------------------------------------------------- pop a frame

/**
 * Mostra una breve animazione a pochi frame (chiavi di texture) in un punto,
 * poi la distrugge. Utile per pugni, scintille, "poof".
 */
export function popFrames(
  scene: Phaser.Scene,
  x: number,
  y: number,
  frames: readonly string[],
  frameMs = 50,
  opts: { depth?: number; rotation?: number; flipX?: boolean } = {},
): Phaser.GameObjects.Image {
  const img = scene.add
    .image(Math.round(x), Math.round(y), frames[0])
    .setDepth(opts.depth ?? 55)
    .setRotation(opts.rotation ?? 0)
    .setFlipX(!!opts.flipX);
  let i = 0;
  scene.time.addEvent({
    delay: frameMs,
    repeat: frames.length - 1,
    callback: () => {
      i++;
      if (i >= frames.length) img.destroy();
      else img.setTexture(frames[i]);
    },
  });
  return img;
}
