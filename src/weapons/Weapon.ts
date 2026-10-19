import Phaser from 'phaser';
import { WEAPON_STATS, type WeaponStats } from '../config/balance';
import type { PartHit, Ragdoll } from '../entities/Ragdoll';
import { makeSprite, type SpriteData } from '../gfx/pixelSprite';
import type { HitInput } from '../systems/damage';

/** Cosa la scena di gioco mette a disposizione delle armi. */
export interface WeaponContext {
  scene: Phaser.Scene;
  ragdoll: Ragdoll;
  /** applica moltiplicatori ed emette 'damage' (vedi systems/damage.ts) */
  dealDamage: (hit: HitInput) => number;
}

/** Stato di un puntatore (dito o mouse) passato alle armi. */
export interface WeaponPointer {
  id: number;
  /** posizione attuale (mondo) */
  x: number;
  y: number;
  /** dove e quando è iniziato il tocco */
  downX: number;
  downY: number;
  downTime: number;
  time: number;
  /** parte di Tony sotto il dito al momento del pointerdown (o null) */
  downHit: PartHit | null;
  /** true se in questo momento la scena sta trascinando Tony con questo dito */
  grabbing: boolean;
  /** true se durante questo tocco Tony è stato afferrato (anche se ora è rilasciato) */
  wasGrab: boolean;
  /** velocità del gesto in px/step (stimata sugli ultimi ms) */
  vx: number;
  vy: number;
}

/**
 * Classe base di tutte le armi.
 *
 * - id: chiave in WEAPON_STATS (config/balance.ts) e nel salvataggio
 * - name: nome mostrato in HUD/negozio (font pixel: maiuscole e numeri)
 * - icon: sprite pixel dell'icona (SpriteData); la texture è `iconKey`
 * - stats: letti da balance.ts, eventualmente modificati dal livello
 * - allowsGrab: se false, la scena non trascina Tony mentre l'arma è attiva
 *
 * Ciclo di vita: costruttore → activate() quando selezionata →
 * onPointerDown/Move/Up e update() ogni frame → deactivate() quando si cambia arma.
 */
export abstract class Weapon<S extends WeaponStats = WeaponStats> {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly icon: SpriteData;
  readonly allowsGrab: boolean = true;
  /** livello di potenziamento (0 = base); lo imposta il sistema negozio */
  level = 0;
  protected lastUseAt = -1e9;

  constructor(protected readonly ctx: WeaponContext) {}

  get iconKey(): string {
    return `icon-${this.id}`;
  }

  /** Stats correnti: base da balance.ts, scalate da statsForLevel(). */
  get stats(): S {
    const base = (WEAPON_STATS as Record<string, WeaponStats>)[this.id];
    if (!base) throw new Error(`Weapon: nessuna stat in balance.ts per "${this.id}"`);
    return this.statsForLevel(base as S, this.level);
  }

  /** Override per i potenziamenti (default: nessuna modifica). */
  protected statsForLevel(base: S, _level: number): S {
    return base;
  }

  /** true se il cooldown è passato; se sì lo fa ripartire. */
  protected tryUse(now: number = this.ctx.scene.time.now): boolean {
    if (now - this.lastUseAt < this.stats.cooldownMs) return false;
    this.lastUseAt = now;
    return true;
  }

  /** Crea la texture dell'icona (idempotente). */
  ensureIcon(): string {
    return makeSprite(this.ctx.scene, this.iconKey, this.icon);
  }

  activate(): void {
    this.ensureIcon();
  }
  deactivate(): void {}

  onPointerDown(_p: WeaponPointer): void {}
  onPointerMove(_p: WeaponPointer): void {}
  onPointerUp(_p: WeaponPointer): void {}
  update(_dtMs: number): void {}

  /** Comodità per le sottoclassi. */
  protected hit(hit: HitInput): number {
    return this.ctx.dealDamage(hit);
  }
}

