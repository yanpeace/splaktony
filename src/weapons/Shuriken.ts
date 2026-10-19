import Phaser from 'phaser';
import { PHYSICS, ROOM_INNER, THROWN, WEAPON_STATS, type WeaponStats } from '../config/balance';
import { C } from '../config/palette';
import { noise, tone } from '../audio/sfx';
import type { Part } from '../entities/Ragdoll';
import { acquireImage, isFrozen, releaseImage, spawnParticles } from '../gfx/effects';
import { makeSprites, type SpriteData } from '../gfx/pixelSprite';
import { Weapon, type WeaponPointer } from './Weapon';

// ============================================================================
// Base comune delle armi da lancio (usata anche da Coltello.ts).
// Proiettile cinematico: niente corpo Matter, movimento calcolato a mano.
// ============================================================================

/** Stats minime di un'arma da lancio (vedi WEAPON_STATS in balance.ts). */
export interface ThrownStats extends WeaponStats {
  speed: number;
  impulse: number;
  stickMs: number;
}

type ProjState = 'fly' | 'stuck' | 'wall' | 'fall' | 'blink';

interface Projectile {
  img: Phaser.GameObjects.Image;
  state: ProjState;
  x: number;
  y: number;
  /** direzione di volo (normalizzata) */
  dx: number;
  dy: number;
  vx: number;
  vy: number;
  /** angolo "vero" (rad); lo sprite lo mostra quantizzato */
  angle: number;
  /** ms passati nello stato corrente */
  t: number;
  /** tempo totale (per l'animazione a scatti) */
  age: number;
  part: Part | null;
  /** offset e angolo relativi al corpo della parte (sistema locale) */
  lx: number;
  ly: number;
  la: number;
}

const STEP45 = Math.PI / 4;

/** Rotazione quantizzata a 45°: frame pari = sprite dritto, dispari = sprite diagonale; il resto via multipli di 90° (senza ricampionare i pixel). */
export function quantize45(angle: number): { diagonal: boolean; rotation: number } {
  const k = Math.round(angle / STEP45);
  const odd = ((k % 2) + 2) % 2 === 1;
  return { diagonal: odd, rotation: (odd ? k - 1 : k) * STEP45 };
}

export abstract class ThrownWeapon<S extends ThrownStats> extends Weapon<S> {
  private projectiles: Projectile[] = [];
  private shutdownHooked = false;

  /** texture per un proiettile all'angolo dato (spinning = in rotazione) */
  protected abstract frameFor(angle: number, age: number, spinning: boolean): { key: string; rotation: number };
  /** registra le texture dei proiettili */
  protected abstract makeTextures(): void;
  protected abstract playSwish(): void;
  /** true = in volo ruota su se stesso, false = punta nella direzione di volo */
  protected abstract readonly spinsInFlight: boolean;

  activate(): void {
    super.activate();
    this.makeTextures();
    if (!this.shutdownHooked) {
      this.shutdownHooked = true;
      this.ctx.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        this.clearAll();
        this.shutdownHooked = false;
      });
    }
  }

  deactivate(): void {
    this.clearAll();
    super.deactivate();
  }

  onPointerUp(p: WeaponPointer): void {
    if (p.wasGrab) return;
    if (!this.tryUse(p.time)) return;
    this.launch(p.x, p.y);
  }

  update(dtMs: number): void {
    if (this.projectiles.length === 0) return;
    if (isFrozen(this.ctx.scene)) return;
    const dt = Math.min(dtMs, PHYSICS.stepMs * PHYSICS.maxStepsPerFrame);
    const steps = dt / PHYSICS.stepMs;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.t += dt;
      pr.age += dt;
      const alive = this.step(pr, steps);
      if (!alive) {
        releaseImage(pr.img);
        this.projectiles.splice(i, 1);
      } else {
        this.draw(pr);
      }
    }
  }

  // ---------------------------------------------------------------- lancio

  private launch(tx: number, ty: number): void {
    const scene = this.ctx.scene;
    // lancio dall'angolo in basso opposto al punto toccato: la traiettoria
    // diagonale evita di trapassare le gambe di Tony quando si mira alla testa
    const midX = (ROOM_INNER.left + ROOM_INNER.right) / 2;
    const fromRight = tx < midX || (tx === midX && Math.random() < 0.5);
    const ox = fromRight ? ROOM_INNER.right - THROWN.originInset : ROOM_INNER.left + THROWN.originInset;
    // bersaglio basso (Tony sdraiato a terra): il lancio parte più in alto e
    // scende verso di lui, altrimenti la traiettoria gli passerebbe sopra
    const oy = Math.min(ROOM_INNER.bottom - THROWN.originAboveFloor, ty - THROWN.lowTargetLift);

    let dx = tx - ox;
    let dy = ty - oy;
    let len = Math.hypot(dx, dy);
    if (len < 1) {
      dx = 0;
      dy = -1;
      len = 1;
    }
    dx /= len;
    dy /= len;

    while (this.projectiles.length >= THROWN.maxProjectiles) releaseImage(this.projectiles.shift()?.img);

    const angle = Math.atan2(dy, dx);
    const img = acquireImage(scene, ox, oy, this.frameFor(angle, 0, this.spinsInFlight).key).setDepth(17);
    const pr: Projectile = {
      img,
      state: 'fly',
      x: ox,
      y: oy,
      dx,
      dy,
      vx: 0,
      vy: 0,
      angle,
      t: 0,
      age: 0,
      part: null,
      lx: 0,
      ly: 0,
      la: 0,
    };
    this.projectiles.push(pr);
    this.draw(pr);
    this.playSwish();
  }

  // ---------------------------------------------------------------- simulazione

  /** Avanza un proiettile; false = da rimuovere. */
  private step(pr: Projectile, steps: number): boolean {
    switch (pr.state) {
      case 'fly':
        return this.stepFly(pr, steps);
      case 'stuck':
        return this.stepStuck(pr);
      case 'wall':
        if (pr.t >= THROWN.wallStickMs) this.startFall(pr, 0, 0);
        return true;
      case 'fall':
        return this.stepFall(pr, steps);
      case 'blink':
        pr.img.setVisible(Math.floor(pr.t / THROWN.blinkFlashMs) % 2 === 0);
        return pr.t < THROWN.blinkMs;
    }
  }

  private stepFly(pr: Projectile, steps: number): boolean {
    const s = this.stats;
    const dist = s.speed * steps;
    const n = Math.max(1, Math.ceil(dist / THROWN.subStepPx));
    const d = dist / n;
    const { ragdoll } = this.ctx;
    for (let i = 0; i < n; i++) {
      pr.x += pr.dx * d;
      pr.y += pr.dy * d;

      const hit = ragdoll.partAt(pr.x, pr.y, THROWN.hitTolerance);
      if (hit) {
        this.stickInto(pr, hit.part);
        return true;
      }

      if (pr.x <= ROOM_INNER.left || pr.x >= ROOM_INNER.right || pr.y <= ROOM_INNER.top) {
        pr.x = Phaser.Math.Clamp(pr.x, ROOM_INNER.left + 1, ROOM_INNER.right - 1);
        pr.y = Math.max(pr.y, ROOM_INNER.top + 1);
        this.setState(pr, 'wall');
        this.playTink();
        spawnParticles(this.ctx.scene, pr.x, pr.y, {
          count: 3,
          colors: [C.white, C.yellow],
          speed: 1.5,
          angle: Math.atan2(-pr.dy, -pr.dx),
          spread: 1.4,
          size: 1,
          lifeMs: 200,
          gravity: 0.1,
        });
        return true;
      }
      if (pr.y >= ROOM_INNER.bottom) {
        pr.y = ROOM_INNER.bottom - 2;
        this.setState(pr, 'blink');
        return true;
      }
    }
    if (pr.age >= THROWN.maxFlightMs) this.startFall(pr, pr.dx, pr.dy);
    return true;
  }

  private stickInto(pr: Projectile, part: Part): void {
    const s = this.stats;
    const { ragdoll } = this.ctx;
    const hx = pr.x;
    const hy = pr.y;

    ragdoll.applyImpulse(part, hx, hy, pr.dx * s.impulse, pr.dy * s.impulse);
    this.hit({ part: part.name, x: hx, y: hy, amount: s.damage, weaponId: this.id });
    this.playThunk();
    spawnParticles(this.ctx.scene, hx, hy, {
      count: 3,
      colors: [C.white, C.silver],
      speed: 1.8,
      angle: Math.atan2(-pr.dy, -pr.dx),
      spread: 1.2,
      size: 1,
      lifeMs: 220,
      gravity: 0.1,
    });

    // entra un poco nella parte, poi memorizza la posa nel sistema locale del corpo
    pr.x += pr.dx * THROWN.embedPx;
    pr.y += pr.dy * THROWN.embedPx;
    const b = part.body;
    const ox = pr.x - b.position.x;
    const oy = pr.y - b.position.y;
    const c = Math.cos(-b.angle);
    const sn = Math.sin(-b.angle);
    pr.lx = ox * c - oy * sn;
    pr.ly = ox * sn + oy * c;
    pr.la = pr.angle - b.angle;
    pr.part = part;
    this.setState(pr, 'stuck');
  }

  private stepStuck(pr: Projectile): boolean {
    const part = pr.part;
    if (!part || !part.body) {
      this.startFall(pr, 0, 0);
      return true;
    }
    const b = part.body;
    const c = Math.cos(b.angle);
    const sn = Math.sin(b.angle);
    pr.x = b.position.x + pr.lx * c - pr.ly * sn;
    pr.y = b.position.y + pr.lx * sn + pr.ly * c;
    pr.angle = b.angle + pr.la;
    if (pr.t >= this.stats.stickMs) {
      this.startFall(pr, b.velocity.x, b.velocity.y);
    }
    return true;
  }

  private startFall(pr: Projectile, vx: number, vy: number): void {
    const sp = Math.hypot(vx, vy);
    const k = sp > THROWN.fallMaxSpeed ? THROWN.fallMaxSpeed / sp : 1;
    pr.vx = vx * k;
    pr.vy = vy * k;
    pr.part = null;
    this.setState(pr, 'fall');
  }

  private stepFall(pr: Projectile, steps: number): boolean {
    pr.vy += THROWN.fallGravity * steps;
    pr.x += pr.vx * steps;
    pr.y += pr.vy * steps;
    pr.angle += THROWN.fallSpin * steps * (pr.vx < 0 ? -1 : 1);
    if (pr.x < ROOM_INNER.left + 2 || pr.x > ROOM_INNER.right - 2) {
      pr.x = Phaser.Math.Clamp(pr.x, ROOM_INNER.left + 2, ROOM_INNER.right - 2);
      pr.vx = -pr.vx * THROWN.fallWallBounce;
    }
    if (pr.y >= ROOM_INNER.bottom - 2) {
      pr.y = ROOM_INNER.bottom - 2;
      // a terra: appoggiato (sprite dritto) e poi lampeggia
      pr.angle = Math.round(pr.angle / Math.PI) * Math.PI;
      this.setState(pr, 'blink');
    }
    return true;
  }

  private setState(pr: Projectile, state: ProjState): void {
    pr.state = state;
    pr.t = 0;
  }

  private draw(pr: Projectile): void {
    const spinning = (pr.state === 'fly' && this.spinsInFlight) || pr.state === 'fall';
    const f = this.frameFor(pr.angle, pr.age, spinning);
    if (pr.img.texture.key !== f.key) pr.img.setTexture(f.key);
    pr.img.setRotation(f.rotation);
    pr.img.setPosition(Math.round(pr.x), Math.round(pr.y));
  }

  private clearAll(): void {
    for (const pr of this.projectiles) releaseImage(pr.img);
    this.projectiles.length = 0;
  }

  // ---------------------------------------------------------------- suoni comuni

  /** "tunk" sordo quando si conficca nella stoffa */
  protected playThunk(): void {
    tone({ type: 'square', from: 320, to: 110, dur: 0.05, vol: 0.12 });
  }

  /** "tink" metallico contro muro/soffitto */
  protected playTink(): void {
    tone({ type: 'square', from: 1800, to: 1500, dur: 0.05, vol: 0.08 });
    noise({ dur: 0.03, vol: 0.1, freq: 3000, highpass: true });
  }
}

// ============================================================================
// Shuriken: veloce, danno basso, cooldown breve. Ruota a scatti in volo.
// ============================================================================

type ShurikenStats = (typeof WEAPON_STATS)['shuriken'];

/** stella a 4 punte dritta (+) */
const SHURIKEN_A: SpriteData = [
  '...00...',
  '..0cd0..',
  '.00cd00.',
  '0cc00dd0',
  '0dd00ee0',
  '.00de00.',
  '..0de0..',
  '...00...',
];

/** stella a 4 punte ruotata di 45° (x) */
const SHURIKEN_B: SpriteData = [
  '00....00',
  '0c0..0d0',
  '.0c00d0.',
  '..0cd0..',
  '..0de0..',
  '.0d00e0.',
  '0d0..0e0',
  '00....00',
];

export class Shuriken extends ThrownWeapon<ShurikenStats> {
  readonly id = 'shuriken';
  readonly name = 'SHURIKEN';
  readonly icon = SHURIKEN_A;
  protected readonly spinsInFlight = true;

  protected makeTextures(): void {
    makeSprites(this.ctx.scene, { 'fx-shuriken-a': SHURIKEN_A, 'fx-shuriken-b': SHURIKEN_B });
  }

  protected frameFor(angle: number, age: number, spinning: boolean): { key: string; rotation: number } {
    if (spinning) {
      // rotazione a scatti: alterna + e x (45° per frame)
      const f = Math.floor(age / THROWN.spinFrameMs) % 2;
      return { key: f === 0 ? 'fx-shuriken-a' : 'fx-shuriken-b', rotation: 0 };
    }
    const q = quantize45(angle);
    return { key: q.diagonal ? 'fx-shuriken-b' : 'fx-shuriken-a', rotation: q.rotation };
  }

  protected playSwish(): void {
    noise({ dur: 0.07, vol: 0.14, freq: 1500, freqTo: 6000, highpass: true });
    tone({ type: 'square', from: 1600, to: 2400, dur: 0.035, vol: 0.04 });
  }
}
