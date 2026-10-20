import Phaser from 'phaser';
import { PHYSICS, RIFLES, ROOM_INNER, WEAPON_STATS } from '../config/balance';
import { C } from '../config/palette';
import { noise, playExplosion, tone } from '../audio/sfx';
import { acquireImage, hitStop, isFrozen, popFrames, releaseImage, shake, spawnParticles } from '../gfx/effects';
import { makeSprites, type SpriteData } from '../gfx/pixelSprite';
import { boomFrames } from './Granata';
import type { WeaponPointer } from './Weapon';
import { glove, PixelGrid, RifleWeapon, type ViewSpec } from './rifleView';

type RpgStats = (typeof WEAPON_STATS)['rpg'];

const R = RIFLES;
const STEP = PHYSICS.stepMs;
const DIRS = 16;

const ICON: SpriteData = [
  '.........',
  '.....00..',
  '000006600',
  '0d3d66650',
  '000006600',
  '..0e000..',
  '..0e0....',
  '..000....',
  '.........',
];

/** testata conica (verde) con spoletta, usata in cima al tubo: 14 righe da y */
function warhead(g: PixelGrid, cx: number, y: number): void {
  g.trap(y + 2, y + 9, cx, 1, 5, '6', '5', '7');
  g.trap(y + 10, y + 13, cx, 5, 2.5, '6', '5', '7');
  g.rect(cx - 4, y + 8, 8, 1, '7');
  g.rect(cx - 1, y, 2, 2, 'd').set(cx - 1, y, 'c');
}

/**
 * Lanciarazzi a spalla visto da dietro: testata conica in cima, tubo scuro,
 * paracalore di legno, mirino laterale, impugnatura e guanti.
 */
function frame(loaded: boolean): SpriteData {
  const g = new PixelGrid(30, 44);
  g.trap(14, 42, 15, 3.5, 4, 'f', 'e', '0');
  g.trap(21, 31, 15, 5.5, 5.5, '3', '4', '2');
  g.rect(12, 24, 2, 1, '2').rect(16, 27, 3, 1, '2').rect(13, 30, 2, 1, '2');
  g.rect(21, 17, 3, 4, 'f').set(22, 18, 'a');
  g.rect(14, 33, 3, 4, 'f');
  if (loaded) warhead(g, 15, 0);
  else g.rect(12, 14, 6, 2, '0');
  glove(g, 4, 19, 5, 5);
  glove(g, 20, 33, 5, 6);
  return g.outline().sprite();
}

function loaderSprite(): SpriteData {
  const g = new PixelGrid(14, 18);
  warhead(g, 7, 1);
  g.rect(6, 15, 2, 2, 'e');
  return g.outline().sprite();
}

/** Razzo in volo visto di lato, rasterizzato in una delle 16 direzioni. */
function rocketSprite(angle: number): SpriteData {
  const g = new PixelGrid(13, 13);
  const c = 6;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  for (let y = 0; y < 13; y++) {
    for (let x = 0; x < 13; x++) {
      const px = x - c;
      const py = y - c;
      const t = px * dx + py * dy;
      const u = -px * dy + py * dx;
      const au = Math.abs(u);
      let ch = '';
      if (t > 4.6 || t < -4.6) continue;
      if (t >= 3.6 && au <= 0.6) ch = 'd';
      else if (t >= 0.8 && au <= (t > 2.6 ? 0.75 : 1.3)) ch = u < 0 ? '5' : '6';
      else if (t >= -3 && t < 0.8 && au <= 0.6) ch = 'e';
      else if (t < -3 && au <= 1.7) ch = 'f';
      if (ch) g.set(x, y, ch);
    }
  }
  return g.outline().sprite();
}

/** lampo bianco iniziale dell'esplosione (disco pieno con contorno) */
function flashDisc(r: number): SpriteData {
  const size = r * 2 + 1;
  const g = new PixelGrid(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - r, y - r);
      if (d <= r * 0.45) g.set(x, y, 'c');
      else if (d <= r * 0.55) g.set(x, y, '4');
    }
  }
  return g.outline().sprite();
}

const BOOM_KEYS = [0, 1, 2, 3, 4].map((i) => `fx-rpg-boom-${i}`);
const rocketKey = (i: number) => `fx-rocket-${i}`;

const VIEW: ViewSpec = {
  key: 'vm-rpg',
  base: frame(true),
  muzzle: { x: 15, y: 1 },
  eject: { x: 15, y: 40 },
  frames: { empty: frame(false) },
};

interface Rocket {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  /** direzione (versore) e velocità scalare */
  dx: number;
  dy: number;
  speed: number;
  vy: number;
  /** distanza percorsa e distanza dal punto mirato */
  travelled: number;
  range: number;
  age: number;
  steps: number;
  /** posizione disegnata (con l'oscillazione) */
  rx: number;
  ry: number;
}

/**
 * RPG: un tap lancia un razzo che parte dall'arma con fiammata posteriore e
 * scia di fumo, vola verso il punto (lieve arco e oscillazione) ed esplode
 * all'impatto con Tony, con la stanza o arrivato al punto: danno ad area che
 * cala con la distanza su tutte le parti + forte spinta radiale. Poi si
 * infila un razzo nuovo nel tubo.
 */
export class Rpg extends RifleWeapon<RpgStats> {
  readonly id = 'rpg';
  readonly name = 'RPG';
  readonly icon = ICON;

  private rockets: Rocket[] = [];
  private acc = 0;
  private loader: Phaser.GameObjects.Image | null = null;
  private reloaded = true;

  protected viewSpec(): ViewSpec {
    return VIEW;
  }

  protected makeOwnSprites(): void {
    const sprites: Record<string, SpriteData> = { 'vm-rpg-loader': loaderSprite() };
    for (let i = 0; i < DIRS; i++) sprites[rocketKey(i)] = rocketSprite((i / DIRS) * Math.PI * 2);
    const frames = [flashDisc(Math.round(this.stats.boomSize * 0.7)), ...boomFrames(this.stats.boomSize)];
    BOOM_KEYS.forEach((k, i) => (sprites[k] = frames[i]));
    makeSprites(this.ctx.scene, sprites);
  }

  protected cleanup(): void {
    this.rockets.forEach((r) => releaseImage(r.img));
    this.rockets = [];
    releaseImage(this.loader);
    this.loader = null;
    this.reloaded = true;
  }

  protected onTriggerDown(p: WeaponPointer): void {
    if (this.rockets.length >= R.maxRockets || !this.tryUse(p.time)) return;
    this.launch(p.x, p.y);
  }

  private launch(tx: number, ty: number): void {
    const view = this.view;
    if (!view) return;
    const scene = this.ctx.scene;
    const s = this.stats;
    view.setAim(tx, ty);
    view.update(0);
    const m = view.muzzle();
    let dx = tx - m.x;
    let dy = ty - m.y;
    const range = Math.hypot(dx, dy) || 1;
    dx /= range;
    dy /= range;
    const img = acquireImage(scene, m.x, m.y, rocketKey(this.dirIndex(dx, dy))).setDepth(R.rocketDepth);
    this.rockets.push({ img, x: m.x, y: m.y, dx, dy, speed: s.speed, vy: 0, travelled: 0, range, age: 0, steps: 0, rx: m.x, ry: m.y });
    this.reloaded = false;

    // vampata davanti e fiammata posteriore (dal fondo del tubo)
    this.muzzleFlash(2);
    const back = view.point(15, 40);
    popFrames(scene, back.x, back.y, ['fx-shot-a', 'fx-shot-b', 'fx-shot-c'], 45, { depth: R.viewDepth + 1 });
    spawnParticles(scene, back.x, back.y, { count: 8, colors: [C.yellow, C.orange, C.red], speed: 2.4, angle: Math.PI / 2 + 0.4, spread: 1.6, gravity: 0, lifeMs: 220, size: 1 });
    for (let i = 0; i < 4; i++) this.puffs?.spawn(back.x + (Math.random() - 0.5) * 8, back.y - 2, (Math.random() - 0.3) * 1.6, -0.6 - Math.random(), 700, i < 2);
    view.kickBack(5);
    shake(scene, 2, 120);
    // FWOOSH del lancio
    noise({ dur: 0.45, vol: 0.4, freq: 300, freqTo: 3500, highpass: true });
    noise({ dur: 0.2, vol: 0.35, freq: 2500, freqTo: 200 });
    tone({ type: 'square', from: 220, to: 60, dur: 0.18, vol: 0.2 });
  }

  private dirIndex(dx: number, dy: number): number {
    const a = Math.atan2(dy, dx);
    return ((Math.round((a / (Math.PI * 2)) * DIRS) % DIRS) + DIRS) % DIRS;
  }

  protected tick(dtMs: number): void {
    const view = this.view;
    if (!view) return;
    // durante l'hit-stop anche i razzi restano fermi
    if (!isFrozen(this.ctx.scene)) this.acc = Math.min(this.acc + dtMs, STEP * PHYSICS.maxStepsPerFrame);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      for (let i = this.rockets.length - 1; i >= 0; i--) {
        if (this.stepRocket(this.rockets[i])) {
          const r = this.rockets[i];
          this.rockets.splice(i, 1);
          this.explode(r.rx, r.ry);
          releaseImage(r.img);
        }
      }
    }
    for (const r of this.rockets) {
      const vx = r.dx * r.speed;
      const vy = r.dy * r.speed + r.vy;
      r.img.setTexture(rocketKey(this.dirIndex(vx, vy)));
      r.img.setPosition(Math.round(r.rx), Math.round(r.ry));
    }
    this.animateReload();
  }

  /** Un passo di volo; true se deve esplodere (posizione in rx, ry). */
  private stepRocket(r: Rocket): boolean {
    const s = this.stats;
    r.age += STEP;
    r.steps++;
    r.speed = Math.min(s.maxSpeed, r.speed + s.accel);
    r.vy += R.rocketGravity;
    const vx = r.dx * r.speed;
    const vy = r.dy * r.speed + r.vy;
    const len = Math.hypot(vx, vy);
    const n = Math.max(1, Math.ceil(len / 2));
    // oscillazione perpendicolare alla rotta
    const wob = Math.sin((r.age / R.rocketWobbleMs) * Math.PI * 2) * R.rocketWobblePx;
    const px = -vy / (len || 1);
    const py = vx / (len || 1);
    for (let k = 0; k < n; k++) {
      r.x += vx / n;
      r.y += vy / n;
      r.travelled += len / n;
      r.rx = r.x + px * wob;
      r.ry = r.y + py * wob;
      const inside =
        r.rx > ROOM_INNER.left + 1 && r.rx < ROOM_INNER.right - 1 && r.ry > ROOM_INNER.top + 1 && r.ry < ROOM_INNER.bottom - 1;
      if (!inside) {
        r.rx = Phaser.Math.Clamp(r.rx, ROOM_INNER.left + 1, ROOM_INNER.right - 1);
        r.ry = Phaser.Math.Clamp(r.ry, ROOM_INNER.top + 1, ROOM_INNER.bottom - 1);
        return true;
      }
      if (this.ctx.ragdoll.partAt(r.rx, r.ry, R.rocketHitTolerance)) return true;
      if (r.travelled >= r.range) return true;
    }
    if (r.age >= R.rocketMaxFlightMs) return true;
    // scia: fumo dietro la coda e qualche scintilla di fiamma
    if (r.steps % R.rocketTrailEvery === 0) {
      const tx = r.rx - (vx / (len || 1)) * 6;
      const ty = r.ry - (vy / (len || 1)) * 6;
      this.puffs?.spawn(tx, ty, (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, 420 + Math.random() * 200, r.steps % 2 === 0);
      spawnParticles(this.ctx.scene, tx, ty, { count: 1, colors: [C.yellow, C.orange], speed: 0.6, gravity: 0, lifeMs: 120, size: 1 });
    }
    return false;
  }

  private explode(x: number, y: number): void {
    const scene = this.ctx.scene;
    const ragdoll = this.ctx.ragdoll;
    const s = this.stats;
    const ex = Math.round(x);
    const ey = Math.round(y);
    for (const p of ragdoll.parts.values()) {
      const pos = p.body.position;
      const d = Math.hypot(pos.x - ex, pos.y - ey);
      if (d > s.radius) continue;
      const k = 1 - d / s.radius;
      const amount = s.damage * (R.rocketMinDamageShare + (1 - R.rocketMinDamageShare) * k);
      this.hitPart(p, Math.round(pos.x), Math.round(pos.y), amount);
    }
    const pushed = ragdoll.applyRadialImpulse(ex, ey, s.pushRadius, s.pushStrength);
    if (pushed.length > 0) {
      const com = ragdoll.centerOfMass();
      const near = Math.max(0, 1 - Math.hypot(com.x - ex, com.y - ey) / s.pushRadius);
      ragdoll.addVelocity(0, -s.upBoost * near);
    }
    const m = Math.round(s.boomSize * 0.5);
    const bx = Phaser.Math.Clamp(ex, ROOM_INNER.left + m, ROOM_INNER.right - m);
    const by = Math.min(ey, ROOM_INNER.bottom - m);
    popFrames(scene, bx, by, BOOM_KEYS, R.rocketBoomFrameMs, { depth: 55 });
    spawnParticles(scene, ex, ey, { count: R.rocketDebris, colors: [C.yellow, C.orange, C.red, C.white, C.charcoal], speed: 4, gravity: 0.14, lifeMs: 560 });
    for (let i = 0; i < R.rocketSmokePuffs; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.random() * s.boomSize * 0.7;
      this.puffs?.spawn(bx + Math.cos(a) * rr, by + Math.sin(a) * rr * 0.6, Math.cos(a) * 0.8, Math.sin(a) * 0.5 - 0.3, 900 + Math.random() * 500, true);
    }
    shake(scene, s.shakePx, R.rocketShakeMs);
    hitStop(scene, R.rocketHitStopMs);
    playExplosion();
    tone({ type: 'triangle', from: 70, to: 22, dur: 0.6, vol: 0.4 });
  }

  /** Nuovo razzo infilato nel tubo dall'alto. */
  private animateReload(): void {
    const view = this.view;
    if (!view || this.reloaded) return;
    const scene = this.ctx.scene;
    const t = (scene.time.now - this.lastUseAt) / this.stats.cooldownMs;
    if (t >= 1) {
      this.reloaded = true;
      view.setFrame(null);
      releaseImage(this.loader);
      this.loader = null;
      return;
    }
    if (t < 0.15) view.setFrame('empty');
    else if (t < 0.82) view.setFrame('empty', -2, 6);
    else view.setFrame(null);

    if (t >= 0.3 && t < 0.82) {
      const k = (t - 0.3) / 0.52;
      const dst = view.point(15, 8);
      const x = Math.round(dst.x - 16 * (1 - k));
      const y = Math.round(dst.y + 20 * (1 - k) * (1 - k));
      if (!this.loader) this.loader = acquireImage(scene, x, y, 'vm-rpg-loader').setDepth(view.img.depth + 0.5);
      this.loader.setPosition(x, y);
    } else if (this.loader) {
      releaseImage(this.loader);
      this.loader = null;
      // razzo in sede: "tunk" metallico
      noise({ dur: 0.05, vol: 0.22, freq: 2500, freqTo: 600 });
      tone({ type: 'square', from: 200, to: 90, dur: 0.08, vol: 0.2 });
      view.kickBack(1);
    }
  }

  get debugCounts(): Record<string, number> {
    return { ...super.debugCounts, rockets: this.rockets.length };
  }
}
