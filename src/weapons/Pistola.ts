import Phaser from 'phaser';
import { FIREARMS, ROOM_INNER, WEAPON_STATS } from '../config/balance';
import { C } from '../config/palette';
import { playShot } from '../audio/sfx';
import { acquireImage, popFrames, releaseImage, spawnParticles } from '../gfx/effects';
import { makeSprites, type SpriteData } from '../gfx/pixelSprite';
import type { HitInput } from '../systems/damage';
import type { Ragdoll } from '../entities/Ragdoll';
import { Weapon, type WeaponPointer } from './Weapon';

type PistolaStats = (typeof WEAPON_STATS)['pistola'];

const ICON_PISTOLA: SpriteData = [
  '.........',
  '.0000000.',
  '0ddddddd0',
  '0eeeeeee0',
  '0ee00000.',
  '0ee0e0...',
  '0ff00....',
  '0ff0.....',
  '0000.....',
];

// ---- grafica condivisa delle armi da fuoco (usata anche da Mitragliatrice) ----

const FLASH_A: SpriteData = [
  '...4...',
  '.4.c.4.',
  '..ccc..',
  '4ccccc4',
  '..ccc..',
  '.4.c.4.',
  '...4...',
];

const FLASH_B: SpriteData = [
  '.......',
  '...4...',
  '..4c4..',
  '.4ccc4.',
  '..4c4..',
  '...4...',
  '.......',
];

const FLASH_C: SpriteData = [
  '.......',
  '.......',
  '...4...',
  '..434..',
  '...4...',
  '.......',
  '.......',
];

const HOLE_A: SpriteData = ['efe', 'f0f', 'efe'];
const HOLE_B: SpriteData = ['ee.', 'e0f', '.fe'];

export const FLASH_FRAMES = ['fx-shot-a', 'fx-shot-b', 'fx-shot-c'] as const;
const HOLE_KEYS = ['fx-hole-a', 'fx-hole-b'] as const;

/** Registra le texture condivise (idempotente). */
export function ensureFirearmSprites(scene: Phaser.Scene): void {
  makeSprites(scene, {
    'fx-shot-a': FLASH_A,
    'fx-shot-b': FLASH_B,
    'fx-shot-c': FLASH_C,
    'fx-hole-a': HOLE_A,
    'fx-hole-b': HOLE_B,
  });
}

interface Hole {
  img: Phaser.GameObjects.Image;
  bornAt: number;
}

/** Fori di proiettile sul muro: restano un po', poi spariscono lampeggiando. */
export class BulletHoles {
  private holes: Hole[] = [];

  constructor(private readonly scene: Phaser.Scene) {}

  /** true se il punto è sulla parete interna della stanza. */
  static inRoom(x: number, y: number): boolean {
    return x >= ROOM_INNER.left + 1 && x < ROOM_INNER.right - 1 && y >= ROOM_INNER.top + 1 && y < ROOM_INNER.bottom - 1;
  }

  add(x: number, y: number): void {
    if (this.holes.length >= FIREARMS.maxHoles) releaseImage(this.holes.shift()?.img);
    const key = HOLE_KEYS[Math.floor(Math.random() * HOLE_KEYS.length)];
    const img = acquireImage(this.scene, Math.round(x) - 1, Math.round(y) - 1, key)
      .setOrigin(0)
      .setDepth(FIREARMS.holeDepth);
    this.holes.push({ img, bornAt: this.scene.time.now });
  }

  update(): void {
    const now = this.scene.time.now;
    const end = FIREARMS.holeLifeMs + FIREARMS.holeBlinkMs;
    for (let i = this.holes.length - 1; i >= 0; i--) {
      const h = this.holes[i];
      const age = now - h.bornAt;
      if (age >= end) {
        releaseImage(h.img);
        this.holes.splice(i, 1);
      } else if (age > FIREARMS.holeLifeMs) {
        // lampeggio a scatti, sempre più spento verso la fine
        const step = Math.floor((age - FIREARMS.holeLifeMs) / FIREARMS.holeBlinkStepMs);
        h.img.setVisible(step % 2 === 1);
      }
    }
  }

  clear(): void {
    this.holes.forEach((h) => releaseImage(h.img));
    this.holes = [];
  }

  get count(): number {
    return this.holes.length;
  }
}

export interface ShotStats {
  damage: number;
  impulse: number;
  bodyShare: number;
  hitTolerance: number;
}

/**
 * Colpo istantaneo (hitscan) nel punto (x,y): se prende Tony fa danno + spinta
 * dal basso; se no, foro nel muro e scintille. Lampo di sparo in ogni caso.
 * Ritorna true se ha colpito Tony.
 */
export function fireHitscan(
  scene: Phaser.Scene,
  ragdoll: Ragdoll,
  holes: BulletHoles,
  hit: (h: HitInput) => number,
  weaponId: string,
  s: ShotStats,
  x: number,
  y: number,
): boolean {
  const px = Math.round(x);
  const py = Math.round(y);
  popFrames(scene, px, py, FLASH_FRAMES, FIREARMS.flashFrameMs);

  const target = ragdoll.partAt(px, py, s.hitTolerance);
  if (!target) {
    if (BulletHoles.inRoom(px, py)) {
      holes.add(px, py);
      spawnParticles(scene, px, py, {
        count: 3,
        colors: [C.yellow, C.white, C.silver],
        speed: 1.8,
        size: 1,
        lifeMs: 220,
        gravity: 0.12,
      });
    }
    return false;
  }

  // direzione: dal punto (fuori schermo, in basso) da cui spara il giocatore verso il bersaglio
  let dx = px - FIREARMS.originX;
  let dy = py - FIREARMS.originY;
  let len = Math.hypot(dx, dy) || 1;
  dx = dx / len + (Math.random() - 0.5) * 2 * FIREARMS.impulseJitter;
  dy /= len;
  len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  const part = target.part;
  ragdoll.applyImpulse(part, px, py, dx * s.impulse, dy * s.impulse);
  if (s.bodyShare > 0) ragdoll.addVelocity(dx * s.impulse * s.bodyShare, dy * s.impulse * s.bodyShare, part);
  hit({ part: part.name, x: px, y: py, amount: s.damage, weaponId });

  spawnParticles(scene, px, py, {
    count: 4,
    colors: [C.yellow, C.white],
    speed: 2.2,
    angle: Math.atan2(-dy, -dx),
    spread: 1.4,
    size: 1,
    lifeMs: 200,
    gravity: 0,
  });
  return true;
}

/**
 * Pistola: ogni tap spara un colpo istantaneo nel punto toccato.
 * Spara al pointerdown (più reattivo) e non afferra Tony.
 */
export class Pistola extends Weapon<PistolaStats> {
  readonly id = 'pistola';
  readonly name = 'PISTOLA';
  readonly icon = ICON_PISTOLA;
  override readonly allowsGrab = false;
  private holes: BulletHoles | null = null;

  activate(): void {
    super.activate();
    ensureFirearmSprites(this.ctx.scene);
    this.holes = new BulletHoles(this.ctx.scene);
  }

  deactivate(): void {
    this.holes?.clear();
    this.holes = null;
  }

  onPointerDown(p: WeaponPointer): void {
    if (!this.holes || !this.tryUse(p.time)) return;
    const { scene, ragdoll } = this.ctx;
    playShot();
    fireHitscan(scene, ragdoll, this.holes, (h) => this.hit(h), this.id, this.stats, p.x, p.y);
  }

  update(): void {
    this.holes?.update();
  }
}
