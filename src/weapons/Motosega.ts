import Phaser from 'phaser';
import { DAMAGE, FX, MELEE2, WEAPON_STATS } from '../config/balance';
import { C } from '../config/palette';
import { noise, tone } from '../audio/sfx';
import type { Part } from '../entities/Ragdoll';
import { acquireImage, releaseImage, spawnParticles } from '../gfx/effects';
import { makeSprites, type SpriteData } from '../gfx/pixelSprite';
import { Weapon, type WeaponPointer } from './Weapon';

type SawStats = (typeof WEAPON_STATS)['motosega'];

/** icona: motosega arancio/rossa con la lama a destra */
const SAW_ICON: SpriteData = [
  '..00.....',
  '.0ff0....',
  '0f00f00..',
  '033330c0.',
  '03443ddd0',
  '02222eee0',
  '022220c0.',
  '.0ff0.0..',
  '..00.....',
];

/** a schermo (lama a destra), due frame della catena che gira */
const SAW_A: SpriteData = [
  '...000000...............',
  '..0ffffff0..............',
  '.0f000000f0.............',
  '0333333333300.0.0.0.0...',
  '034443333330c0c0c0c0c0..',
  '03300003333ddddddddddd0.',
  '02222222222eeeeeeeeeeec0',
  '02222222222dddddddddd00.',
  '02222222222c0c0c0c0c0...',
  '.0ffffffff00.0.0.0.0....',
  '..00000000..............',
  '........................',
];
const SAW_B: SpriteData = [
  '...000000...............',
  '..0ffffff0..............',
  '.0f000000f0.............',
  '033333333330.0.0.0.0.0..',
  '03444333333c0c0c0c0c0c0.',
  '03300003333ddddddddddd0.',
  '02222222222eeeeeeeeeeec0',
  '02222222222dddddddddd00.',
  '022222222220c0c0c0c0c0..',
  '.0ffffffff0.0.0.0.0.0...',
  '..00000000..............',
  '........................',
];

/** imbottitura bianca e scintille */
const STUFFING = [C.white, C.white, C.silver] as const;
const SPARKS = [C.yellow, C.white, C.orange] as const;

/**
 * Motosega: TIENI PREMUTO. La motosega compare sotto il dito e vibra; se la
 * lama tocca Tony gli fa danno continuo (un "morso" ogni cooldownMs) con
 * scintille e imbottitura che vola, Tony trema e il motore sale di giri.
 * Al rilascio il motore rallenta e si spegne. Non afferra Tony.
 */
export class Motosega extends Weapon<SawStats> {
  readonly id = 'motosega';
  readonly name = 'MOTOSEGA';
  readonly icon = SAW_ICON;
  override readonly allowsGrab = false;

  private img: Phaser.GameObjects.Image | null = null;
  private holderId: number | null = null;
  private fx = 0;
  private fy = 0;
  /** giri del motore 0..1 */
  private rpm = 0;
  private cutting = false;
  private nextEngineAt = 0;
  private chainAt = 0;
  private chainB = false;

  activate(): void {
    super.activate();
    makeSprites(this.ctx.scene, { 'fx-saw-a': SAW_A, 'fx-saw-b': SAW_B });
  }

  deactivate(): void {
    if (this.holderId !== null) this.stopEngine();
    this.holderId = null;
    releaseImage(this.img);
    this.img = null;
  }

  onPointerDown(p: WeaponPointer): void {
    if (this.holderId !== null) return;
    this.holderId = p.id;
    this.fx = p.x;
    this.fy = p.y;
    this.rpm = 0.2;
    this.cutting = false;
    this.nextEngineAt = 0;
    // "strappo" d'avviamento
    noise({ dur: 0.08, vol: 0.18, freq: 900, freqTo: 200 });
    tone({ type: 'square', from: 40, to: 90, dur: 0.12, vol: 0.12 });
    if (!this.img) this.img = acquireImage(this.ctx.scene, p.x, p.y, 'fx-saw-a').setDepth(56);
    this.place();
  }

  onPointerMove(p: WeaponPointer): void {
    if (p.id !== this.holderId) return;
    this.fx = p.x;
    this.fy = p.y;
  }

  onPointerUp(p: WeaponPointer): void {
    if (p.id !== this.holderId) return;
    this.release();
  }

  update(dtMs: number): void {
    if (this.holderId === null) return;
    // dito perso (uscito dal canvas, ecc.): spegni
    const id = this.holderId;
    const ptr = this.ctx.scene.input.manager.pointers.find((q) => q.id === id);
    if (!ptr || !ptr.isDown) {
      this.release();
      return;
    }

    const now = this.ctx.scene.time.now;
    const hit = this.ctx.ragdoll.partAt(this.fx, this.fy, this.stats.hitTolerance);
    this.cutting = !!hit;
    // i giri salgono mentre taglia, scendono al minimo a vuoto
    const target = this.cutting ? 1 : 0.45;
    const k = Math.min(1, dtMs / MELEE2.sawSpinUpMs);
    this.rpm += (target - this.rpm) * (target > this.rpm ? k * 2.5 : k * 1.5);

    if (hit && this.tryUse(now)) this.bite(hit.part, this.fx, this.fy);

    // catena che gira: più veloce con più giri
    if (now >= this.chainAt) {
      this.chainAt = now + (this.cutting ? 30 : 70);
      this.chainB = !this.chainB;
    }
    this.place();
    this.engine(now);
  }

  private bite(part: Part, x: number, y: number): void {
    const s = this.stats;
    const name = part.name;
    const { ragdoll, scene } = this.ctx;
    // danno continuo: ogni morso resta sotto la soglia del "colpo forte"
    // (niente hit-stop a raffica, la fisica non si congela)
    const cap = (FX.strongHitDamage - 1) / DAMAGE.partMultiplier[name];
    this.hit({ part: name, x, y, amount: Math.min(s.damage, cap), weaponId: this.id });

    // Tony trema e viene "trattenuto" dalla lama
    const bx = part.body.position.x;
    const by = part.body.position.y;
    const d = Math.max(1, Math.hypot(x - bx, y - by));
    const j = s.jitter;
    ragdoll.applyImpulse(
      part,
      x,
      y,
      (Math.random() - 0.5) * 2 * j + ((x - bx) / d) * s.pull,
      (Math.random() - 0.5) * 2 * j + ((y - by) / d) * s.pull - 0.4,
    );
    ragdoll.addVelocity((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6 - 0.15, part);

    const away = this.fx < 90 ? -1 : 1; // le scintille escono dal lato del motore
    spawnParticles(scene, x, y, {
      count: 2,
      colors: SPARKS,
      speed: 3.5,
      angle: away > 0 ? -Math.PI * 0.8 : -Math.PI * 0.2,
      spread: 0.9,
      size: 1,
      lifeMs: 220,
      gravity: 0.15,
    });
    spawnParticles(scene, x, y, {
      count: 1,
      colors: STUFFING,
      speed: 1.6,
      angle: -Math.PI / 2,
      spread: 2.4,
      size: 2,
      lifeMs: 650,
      gravity: 0.06,
    });
  }

  /** Posiziona lo sprite: la lama sotto il dito, il motore verso il centro. */
  private place(): void {
    if (!this.img) return;
    const left = this.fx >= 90; // dito a destra → lama verso destra, motore a sinistra
    const shakePx = MELEE2.sawShakePx * (this.cutting ? 1 : 0.5);
    const ox = Math.round((Math.random() - 0.5) * 2 * shakePx);
    const oy = Math.round((Math.random() - 0.5) * 2 * shakePx);
    // centro sprite = 12; punto di taglio sulla lama ~ colonna 12 + sawOffset·0.6
    const off = Math.round(MELEE2.sawOffset * 0.6);
    this.img
      .setTexture(this.chainB ? 'fx-saw-b' : 'fx-saw-a')
      .setFlipX(!left)
      .setPosition(Math.round(this.fx + (left ? -off : off)) + ox, Math.round(this.fy) + oy);
  }

  /** Motore: brevi impulsi di onda quadra a frequenza crescente con i giri. */
  private engine(now: number): void {
    if (now < this.nextEngineAt) return;
    this.nextEngineAt = now + MELEE2.sawEngineMs;
    const hz = MELEE2.sawIdleHz + (MELEE2.sawMaxHz - MELEE2.sawIdleHz) * this.rpm;
    tone({ type: 'square', from: hz, to: hz * 1.08, dur: 0.07, vol: 0.07 + this.rpm * 0.05 });
    tone({ type: 'square', from: hz * 2.01, dur: 0.04, vol: 0.025 });
    if (this.cutting) noise({ dur: 0.06, vol: 0.12, freq: 2500 + this.rpm * 2500, freqTo: 900 });
  }

  private release(): void {
    this.stopEngine();
    this.holderId = null;
    this.cutting = false;
    releaseImage(this.img);
    this.img = null;
  }

  /** Il motore rallenta e si spegne. */
  private stopEngine(): void {
    const hz = MELEE2.sawIdleHz + (MELEE2.sawMaxHz - MELEE2.sawIdleHz) * this.rpm;
    tone({ type: 'square', from: hz, to: 28, dur: 0.55, vol: 0.09 });
    tone({ type: 'square', from: hz * 2, to: 50, dur: 0.35, vol: 0.03 });
    this.rpm = 0;
  }
}
