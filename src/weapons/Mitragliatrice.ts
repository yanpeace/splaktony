import Phaser from 'phaser';
import { FIREARMS, PHYSICS, ROOM_INNER, WEAPON_STATS } from '../config/balance';
import { noise, playShot, tone } from '../audio/sfx';
import { acquireImage, isFrozen, releaseImage } from '../gfx/effects';
import { makeSprites, type SpriteData } from '../gfx/pixelSprite';
import { BulletHoles, ensureFirearmSprites, fireHitscan } from './Pistola';
import { Weapon, type WeaponPointer } from './Weapon';

type MitraStats = (typeof WEAPON_STATS)['mitragliatrice'];

const ICON_MITRA: SpriteData = [
  '...........',
  '.000000000.',
  '0ddddddddd0',
  '0eeeeeeeee0',
  '00e00ee0000',
  '.0e0.0e0...',
  '.0f0.0e0...',
  '.000.0e0...',
  '.....000...',
];

/** Bossolo: due frame (orizzontale / verticale) alternati mentre vola = rotazione a scatti. */
const SHELL_H: SpriteData = ['443', '333'];
const SHELL_V: SpriteData = ['43', '43', '33'];
const SHELL_KEYS = { h: 'fx-shell-h', v: 'fx-shell-v' } as const;

interface Shell {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** quando si è fermato a terra (-1 = ancora in volo) */
  restAt: number;
  spinAt: number;
  vertical: boolean;
}

/** Bossoli con gravità, rimbalzo sul pavimento, sosta a terra e sparizione lampeggiante. */
class Shells {
  private list: Shell[] = [];
  private lastTinkAt = -1e9;

  constructor(private readonly scene: Phaser.Scene) {}

  eject(): void {
    if (this.list.length >= FIREARMS.maxShells) releaseImage(this.list.shift()?.img);
    const x = FIREARMS.shellEjectX;
    const y = FIREARMS.shellEjectY;
    const img = acquireImage(this.scene, x, y, SHELL_KEYS.h).setOrigin(0).setDepth(FIREARMS.shellDepth);
    this.list.push({
      img,
      x,
      y,
      vx: FIREARMS.shellVx + (Math.random() - 0.5) * 2 * FIREARMS.shellVxJitter,
      vy: FIREARMS.shellVy + (Math.random() - 0.5) * 2 * FIREARMS.shellVyJitter,
      restAt: -1,
      spinAt: this.scene.time.now,
      vertical: false,
    });
  }

  update(dtMs: number): void {
    const now = this.scene.time.now;
    const frozen = isFrozen(this.scene);
    const steps = dtMs / PHYSICS.stepMs;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i];
      if (s.restAt < 0) {
        if (!frozen) this.fly(s, steps, now);
      } else {
        const age = now - s.restAt;
        if (age >= FIREARMS.shellRestMs + FIREARMS.shellBlinkMs) {
          releaseImage(s.img);
          this.list.splice(i, 1);
          continue;
        }
        if (age > FIREARMS.shellRestMs) {
          const step = Math.floor((age - FIREARMS.shellRestMs) / FIREARMS.shellBlinkStepMs);
          s.img.setVisible(step % 2 === 1);
        }
      }
      s.img.setPosition(Math.round(s.x), Math.round(s.y));
    }
  }

  private fly(s: Shell, steps: number, now: number): void {
    s.vy += FIREARMS.shellGravity * steps;
    s.x += s.vx * steps;
    s.y += s.vy * steps;

    // rotazione a scatti
    if (now - s.spinAt >= FIREARMS.shellSpinMs) {
      s.spinAt = now;
      s.vertical = !s.vertical;
      s.img.setTexture(s.vertical ? SHELL_KEYS.v : SHELL_KEYS.h);
    }

    // muri laterali
    const w = s.vertical ? 2 : 3;
    if (s.x < ROOM_INNER.left) {
      s.x = ROOM_INNER.left;
      s.vx = Math.abs(s.vx) * FIREARMS.shellBounce;
    } else if (s.x > ROOM_INNER.right - w) {
      s.x = ROOM_INNER.right - w;
      s.vx = -Math.abs(s.vx) * FIREARMS.shellBounce;
    }

    // pavimento
    const h = s.vertical ? 3 : 2;
    const floorY = ROOM_INNER.bottom - h;
    if (s.y >= floorY && s.vy > 0) {
      s.y = floorY;
      s.vx *= FIREARMS.shellFriction;
      if (s.vy < FIREARMS.shellStopSpeed) {
        // fermo: sdraiato in orizzontale, appoggiato al pavimento
        s.vertical = false;
        s.img.setTexture(SHELL_KEYS.h);
        s.y = ROOM_INNER.bottom - 2;
        s.vx = 0;
        s.vy = 0;
        s.restAt = now;
      } else {
        this.tink(s.vy);
        s.vy = -s.vy * FIREARMS.shellBounce;
      }
    }
  }

  /** "tin" metallico del bossolo che rimbalza (pochi alla volta). */
  private tink(speed: number): void {
    const now = this.scene.time.now;
    if (now - this.lastTinkAt < 70) return;
    this.lastTinkAt = now;
    const f = 2600 + Math.random() * 900;
    tone({ type: 'square', from: f, to: f * 0.8, dur: 0.03, vol: Math.min(0.06, 0.015 * speed) });
  }

  clear(): void {
    this.list.forEach((s) => releaseImage(s.img));
    this.list = [];
  }

  get count(): number {
    return this.list.length;
  }
}

/**
 * Mitragliatrice: tieni premuto per sparare a raffica. Ogni colpo va verso la
 * posizione ATTUALE del dito, con una piccola dispersione casuale. Non afferra Tony.
 */
export class Mitragliatrice extends Weapon<MitraStats> {
  readonly id = 'mitragliatrice';
  readonly name = 'MITRA';
  readonly icon = ICON_MITRA;
  override readonly allowsGrab = false;

  private holes: BulletHoles | null = null;
  private shells: Shells | null = null;
  /** dito che tiene premuto il grilletto (null = nessuna raffica) */
  private triggerId: number | null = null;
  private targetX = 0;
  private targetY = 0;

  activate(): void {
    super.activate();
    const scene = this.ctx.scene;
    ensureFirearmSprites(scene);
    makeSprites(scene, { [SHELL_KEYS.h]: SHELL_H, [SHELL_KEYS.v]: SHELL_V });
    this.holes = new BulletHoles(scene);
    this.shells = new Shells(scene);
  }

  deactivate(): void {
    this.triggerId = null;
    this.holes?.clear();
    this.shells?.clear();
    this.holes = null;
    this.shells = null;
  }

  onPointerDown(p: WeaponPointer): void {
    if (this.triggerId !== null) return;
    this.triggerId = p.id;
    this.targetX = p.x;
    this.targetY = p.y;
    this.fire();
  }

  onPointerMove(p: WeaponPointer): void {
    if (p.id !== this.triggerId) return;
    this.targetX = p.x;
    this.targetY = p.y;
  }

  onPointerUp(p: WeaponPointer): void {
    if (p.id === this.triggerId) this.triggerId = null;
  }

  update(dtMs: number): void {
    if (this.triggerId !== null) {
      // sicurezza: se il dito è stato perso (es. uscito dal canvas) la raffica si ferma
      const id = this.triggerId;
      const ptr = this.ctx.scene.input.manager.pointers.find((q) => q.id === id);
      if (ptr && ptr.isDown) this.fire();
      else this.triggerId = null;
    }
    this.holes?.update();
    this.shells?.update(dtMs);
  }

  private fire(): void {
    if (!this.holes || !this.shells || !this.tryUse()) return;
    const s = this.stats;
    // dispersione uniforme in un disco di raggio s.spread
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * s.spread;
    const x = this.targetX + Math.cos(a) * r;
    const y = this.targetY + Math.sin(a) * r;
    playShot();
    noise({ dur: 0.04, vol: 0.12, freq: 1200, freqTo: 200 });
    fireHitscan(this.ctx.scene, this.ctx.ragdoll, this.holes, (h) => this.hit(h), this.id, s, x, y);
    this.shells.eject();
  }

  /** Per il debug da console. */
  get debugCounts(): { holes: number; shells: number } {
    return { holes: this.holes?.count ?? 0, shells: this.shells?.count ?? 0 };
  }
}
