import Phaser from 'phaser';
import { GRAB, PHYSICS } from '../config/balance';
import { unlockAudio } from '../audio/sfx';
import { Ragdoll } from '../entities/Ragdoll';
import { buildRoom } from '../entities/Room';
import { isFrozen } from '../gfx/effects';
import { dealDamage } from '../systems/damage';
import { events, Subscriptions } from '../systems/events';
import { bindHitFeedback } from '../systems/feedback';
import { getSave } from '../systems/save';
import { installUpgrades } from '../systems/upgrades';
import { WEAPON_REGISTRY } from '../weapons/registry';
import type { Weapon, WeaponContext, WeaponPointer } from '../weapons/Weapon';

interface PointerState extends WeaponPointer {
  samples: { x: number; y: number; t: number }[];
}

/**
 * Scena di gioco: stanza, Tony, fisica a step fissi, input unificato
 * (mouse + touch) e smistamento dei puntatori verso l'arma attiva.
 *
 * Regola input: un tocco su Tony diventa "presa" (trascina/lancia) se il dito
 * si muove oltre GRAB.dragStartDistance o resta giù oltre GRAB.holdStartMs.
 * Altrimenti al rilascio è un "tap" e l'arma decide cosa fare.
 */
export class Game extends Phaser.Scene {
  ragdoll!: Ragdoll;
  private weapons = new Map<string, Weapon>();
  private weapon!: Weapon;
  private pointers = new Map<number, PointerState>();
  private accumulator = 0;
  private subs = new Subscriptions();

  constructor() {
    super('Game');
  }

  create(): void {
    this.accumulator = 0;
    this.pointers.clear();
    this.weapons.clear();
    this.input.addPointer(2);

    buildRoom(this);
    this.ragdoll = new Ragdoll(this);

    const ctx: WeaponContext = { scene: this, ragdoll: this.ragdoll, dealDamage };
    for (const entry of WEAPON_REGISTRY) {
      const w = entry.create(ctx);
      installUpgrades(w, getSave().weaponLevels[entry.id] ?? 0); // negozio: livello di potenziamento
      this.weapons.set(entry.id, w);
    }
    this.selectWeapon(getSave().selectedWeapon);
    this.subs.on('weapon:upgraded', (e) => {
      const w = this.weapons.get(e.weaponId);
      if (w) installUpgrades(w, e.level);
    });

    const feedback = bindHitFeedback(this);
    this.subs.add(() => feedback.clear());
    this.subs.on('weapon:request', (e) => this.selectWeapon(e.weaponId));

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
    this.input.on(Phaser.Input.Events.GAME_OUT, () => this.releaseAll());

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.subs.clear();
      this.weapon?.deactivate();
      this.ragdoll.destroy();
    });

    this.scene.launch('UI');
    this.scene.launch('ProgressHUD');
  }

  selectWeapon(id: string): void {
    const next = this.weapons.get(id) ?? this.weapons.get(WEAPON_REGISTRY[0].id);
    if (!next || next === this.weapon) return;
    this.weapon?.deactivate();
    this.weapon = next;
    next.activate();
    events.emit('weapon:selected', { weaponId: next.id, name: next.name, iconKey: next.ensureIcon() });
  }

  get activeWeapon(): Weapon {
    return this.weapon;
  }

  update(_time: number, delta: number): void {
    // fisica a passo fisso: stessa velocità su schermi a 60/90/120 Hz
    if (!isFrozen(this)) {
      this.accumulator = Math.min(this.accumulator + delta, PHYSICS.stepMs * PHYSICS.maxStepsPerFrame);
      while (this.accumulator >= PHYSICS.stepMs) {
        this.matter.world.step(PHYSICS.stepMs);
        this.accumulator -= PHYSICS.stepMs;
      }
    }

    // presa per pressione prolungata (dito fermo su Tony)
    const now = this.time.now;
    for (const p of this.pointers.values()) {
      if (!p.grabbing && !p.wasGrab && p.downHit && now - p.downTime >= GRAB.holdStartMs) this.startGrab(p);
    }

    this.ragdoll.update(delta);
    this.weapon.update(delta);
  }

  // ---------------------------------------------------------------- input

  private onDown(pointer: Phaser.Input.Pointer): void {
    unlockAudio();
    const now = this.time.now;
    const x = pointer.worldX;
    const y = pointer.worldY;
    const p: PointerState = {
      id: pointer.id,
      x,
      y,
      downX: x,
      downY: y,
      downTime: now,
      time: now,
      downHit: this.ragdoll.partAt(x, y),
      grabbing: false,
      wasGrab: false,
      vx: 0,
      vy: 0,
      samples: [{ x, y, t: now }],
    };
    this.pointers.set(pointer.id, p);
    this.weapon.onPointerDown(p);
  }

  private onMove(pointer: Phaser.Input.Pointer): void {
    const p = this.pointers.get(pointer.id);
    if (!p) return;
    this.track(p, pointer.worldX, pointer.worldY);
    if (!p.grabbing && !p.wasGrab && p.downHit) {
      if (Math.hypot(p.x - p.downX, p.y - p.downY) >= GRAB.dragStartDistance) this.startGrab(p);
    }
    if (p.grabbing) this.ragdoll.moveGrab(p.id, p.x, p.y);
    this.weapon.onPointerMove(p);
  }

  private onUp(pointer: Phaser.Input.Pointer): void {
    const p = this.pointers.get(pointer.id);
    if (!p) return;
    this.track(p, pointer.worldX, pointer.worldY);
    if (p.grabbing) {
      this.ragdoll.release(p.id, p.vx * GRAB.throwScale, p.vy * GRAB.throwScale);
      p.grabbing = false;
    }
    this.pointers.delete(p.id);
    this.weapon.onPointerUp(p);
  }

  private releaseAll(): void {
    for (const p of this.pointers.values()) {
      if (p.grabbing) this.ragdoll.release(p.id, 0, 0, false);
    }
    this.pointers.clear();
  }

  private startGrab(p: PointerState): void {
    if (!this.weapon.allowsGrab || !p.downHit) return;
    // la parte potrebbe essersi spostata: riprendi quella sotto il dito ora
    const hit = this.ragdoll.partAt(p.x, p.y, GRAB.pickTolerance * 1.5) ?? p.downHit;
    this.ragdoll.grab(p.id, { ...hit, x: p.x, y: p.y });
    p.grabbing = true;
    p.wasGrab = true;
  }

  /** Aggiorna posizione e stima la velocità del gesto (px/step). */
  private track(p: PointerState, x: number, y: number): void {
    const now = this.time.now;
    p.x = x;
    p.y = y;
    p.time = now;
    p.samples.push({ x, y, t: now });
    while (p.samples.length > 2 && now - p.samples[0].t > GRAB.throwSampleMs) p.samples.shift();
    const first = p.samples[0];
    const dt = now - first.t;
    if (dt > 0 && dt <= GRAB.throwSampleMs * 1.5) {
      p.vx = ((x - first.x) / dt) * PHYSICS.stepMs;
      p.vy = ((y - first.y) / dt) * PHYSICS.stepMs;
    } else {
      p.vx = 0;
      p.vy = 0;
    }
  }
}
