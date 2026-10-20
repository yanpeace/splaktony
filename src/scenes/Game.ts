import Phaser from 'phaser';
import { GRAB, PHYSICS, SCREEN, WORLDS } from '../config/balance';
import { C, PALETTE_INT } from '../config/palette';
import { unlockAudio } from '../audio/sfx';
import { Ragdoll } from '../entities/Ragdoll';
import { buildRoom, buildRoomBodies } from '../entities/Room';
import { bindSiteAmbient } from '../entities/SiteAmbient';
import { bindCarCrash, driveIntoTunnel } from '../entities/CarCrash';
import { TUNNEL } from '../entities/siteLayout';
import { buildTunnelWorld, TUNNEL_WORLD_FOCUS } from '../entities/TunnelWorld';
import { tunnelBackdrop } from '../gfx/tunnelSprites';
import { isFrozen } from '../gfx/effects';
import { dealDamage } from '../systems/damage';
import { events, Subscriptions, type WorldId } from '../systems/events';
import { bindHitFeedback } from '../systems/feedback';
import { getSave } from '../systems/save';
import { installUpgrades } from '../systems/upgrades';
import { bindWeather } from '../systems/weather';
import { WEAPON_REGISTRY } from '../weapons/registry';
import type { Weapon, WeaponContext, WeaponPointer } from '../weapons/Weapon';

interface PointerState extends WeaponPointer {
  samples: { x: number; y: number; t: number }[];
}

export type { WorldId };

/** Dati di avvio: scene.start('Game', { world, intro }) / scene.restart({ world: 2 }). */
export interface GameData {
  /** 1 = cantiere (default), 2 = dentro la galleria (250 M), 3 = galleria più profonda (500 M) */
  world?: WorldId;
  /** solo nel mondo 1: dopo WORLDS.introDelayMs l'auto entra nella galleria → mondo 2 */
  intro?: boolean;
}

/** Punto (frazione dello schermo) attorno a cui zooma la camera: la bocca della galleria. */
const ZOOM_FOCUS = { x: TUNNEL.x / SCREEN.width, y: (TUNNEL.y - TUNNEL.h / 2) / SCREEN.height } as const;

/** I puntatori touch extra si aggiungono una volta sola (l'InputManager è globale). */
let pointersAdded = false;

/**
 * Scena di gioco: stanza, Tony, fisica a step fissi, input unificato
 * (mouse + touch) e smistamento dei puntatori verso l'arma attiva.
 *
 * Regola input: un tocco su Tony diventa "presa" (trascina/lancia) se il dito
 * si muove oltre GRAB.dragStartDistance o resta giù oltre GRAB.holdStartMs.
 * Altrimenti al rilascio è un "tap" e l'arma decide cosa fare.
 *
 * Mondi: 1 = cantiere (sfondo, animazioni, incidente), 2 = dentro la galleria
 * (stessa fisica, grafica di TunnelWorld, niente incidente). Intro del mondo 2:
 * si parte nel mondo 1 con intro = true (incidenti automatici spenti); dopo
 * WORLDS.introDelayMs l'auto entra nella galleria, poi zoom a scatti dentro la
 * bocca, dissolvenza e restart({ world: 2 }), che parte zoomato e fa zoom-out.
 * Tony resta giocabile nei 5 s e mentre l'auto sale; l'input si blocca solo
 * dal momento in cui l'auto entra (zoom + dissolvenza, < 1 s).
 */
export class Game extends Phaser.Scene {
  ragdoll!: Ragdoll;
  private weapons = new Map<string, Weapon>();
  private weapon!: Weapon;
  private pointers = new Map<number, PointerState>();
  private accumulator = 0;
  private subs = new Subscriptions();
  private worldId: WorldId = 1;
  private transitioning = false;

  constructor() {
    super('Game');
  }

  create(data: GameData = {}): void {
    this.accumulator = 0;
    this.pointers.clear();
    this.weapons.clear();
    this.worldId = data.world === 2 || data.world === 3 ? data.world : 1;
    this.transitioning = false;
    this.input.enabled = true;
    if (!pointersAdded) {
      pointersAdded = true;
      this.input.addPointer(2);
    }
    const cam = this.cameras.main;
    cam.resetFX();
    cam.setZoom(1).setOrigin(0.5).setScroll(0, 0);

    const intro = this.worldId === 1 && !!data.intro;
    if (this.worldId !== 1) {
      buildRoomBodies(this);
      buildTunnelWorld(this, { world: this.worldId }); // dentro la galleria: niente ambiente del cantiere né incidente
    } else {
      buildRoom(this);
      bindSiteAmbient(this);
      bindCarCrash(this, { auto: !intro }); // cantiere: albero al centro + incidente ogni tanto
    }
    this.ragdoll = new Ragdoll(this);
    bindWeather(this, this.ragdoll, { outdoor: this.worldId === 1 }); // in galleria solo gocce e correnti

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

    if (intro) {
      // lo sfondo della galleria (~60 ms, poi in cache) si prepara durante l'attesa, non allo zoom
      this.time.delayedCall(1000, () => tunnelBackdrop());
      this.time.delayedCall(WORLDS.introDelayMs, () => driveIntoTunnel(this, () => this.enterTunnel()));
    }
    if (this.worldId !== 1) this.arriveInTunnel();
  }

  get world(): WorldId {
    return this.worldId;
  }

  // ---------------------------------------------------------------- passaggio al mondo 2

  /** L'auto è entrata nella galleria: zoom a scatti nella bocca, nero, mondo 2. */
  private enterTunnel(): void {
    if (this.transitioning) return;
    this.transitioning = true;
    this.releaseAll();
    this.input.enabled = false;
    this.scene.stop('Shop');
    // l'HUD (scene separate) non zooma: via durante il passaggio, torna col restart
    this.scene.setVisible(false, 'UI');
    this.scene.setVisible(false, 'ProgressHUD');
    const cam = this.cameras.main;
    cam.setOrigin(ZOOM_FOCUS.x, ZOOM_FOCUS.y);
    this.stepZoom(WORLDS.zoomIn, () => {
      const black = PALETTE_INT[C.black];
      cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.restart({ world: 2 } satisfies GameData));
      cam.fadeOut(WORLDS.fadeOutMs, (black >> 16) & 0xff, (black >> 8) & 0xff, black & 0xff);
    });
  }

  /** Arrivo nel mondo 2: camera zoomata sulla bocca, schiarita e zoom-out a scatti fino a 1. */
  private arriveInTunnel(): void {
    const cam = this.cameras.main;
    const black = PALETTE_INT[C.black];
    // si "esce" dalla talpa in fondo alla galleria
    cam.setOrigin(TUNNEL_WORLD_FOCUS.x / SCREEN.width, TUNNEL_WORLD_FOCUS.y / SCREEN.height).setZoom(WORLDS.zoomOut[0]);
    cam.fadeIn(WORLDS.fadeInMs, (black >> 16) & 0xff, (black >> 8) & 0xff, black & 0xff);
    this.stepZoom(WORLDS.zoomOut.slice(1), () => cam.setZoom(1).setOrigin(0.5));
  }

  /** Imposta uno zoom ogni WORLDS.zoomStepMs (scatti, niente zoom continuo). */
  private stepZoom(levels: readonly number[], done: () => void): void {
    const cam = this.cameras.main;
    let i = 0;
    this.time.addEvent({
      delay: WORLDS.zoomStepMs,
      repeat: levels.length - 1,
      callback: () => {
        cam.setZoom(levels[i++]);
        if (i >= levels.length) done();
      },
    });
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
