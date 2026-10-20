import Phaser from 'phaser';
import { SCREEN, SPRITZ } from '../config/balance';
import { C, col, PALETTE_INT } from '../config/palette';
import { noise, playCoin, playLevelUp, tone, unlockAudio } from '../audio/sfx';
import { acquireImage, anchorBottom, popFrames, releaseImage, shake, spawnParticles } from '../gfx/effects';
import { pixelText, setPixelText } from '../gfx/pixelFont';
import {
  buildWallLayout,
  coatColor,
  registerSpritzSprites,
  SPLAT_FRAMES,
  viewKind,
  type CoatState,
  type WallLayout,
} from '../gfx/spritzSprites';
import { ArcadeButton, drawPanel } from '../gfx/ui';
import { economy } from '../systems/economy';
import { events, type WorldId } from '../systems/events';
import { getSave } from '../systems/save';
import { alignButtonHit } from './Shop';

/** Dati di avvio: scene.launch('Spritz', { world }). */
export interface SpritzData {
  world?: WorldId;
}

interface Drop {
  img: Phaser.GameObjects.Image;
  active: boolean;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  t0: number;
  dur: number;
  arc: number;
}

interface Drip {
  img: Phaser.GameObjects.Image;
  active: boolean;
  /** pixel che restano da scendere */
  left: number;
  nextAt: number;
  /** quando ha finito di scendere: resta ferma fino a holdUntil, poi lampeggia e sparisce */
  holdUntil: number;
}

interface FlyCoin {
  img: Phaser.GameObjects.Image;
  start: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const W = SCREEN.width;
/** layout di base 180x320: la camera è ancorata in basso, sugli schermi lunghi la vista continua sopra (y < 0) */
const H = SCREEN.baseHeight;
/** riga in alto della barra: bordo alto dello schermo + notch */
const HUD_Y = SCREEN.top + SCREEN.safeTop;
/** punto del dito → mondo (camera spostata) */
const tmpPoint = new Phaser.Math.Vector2();
const COAT_KEY = 'sz-coat';
/** profondità degli oggetti della scena */
const D = { view: 0, chunk: 1, coat: 2, flash: 3, drip: 4, drop: 6, lance: 20, reticle: 21, hud: 30, text: 40, party: 60, wipe: 1000 } as const;
/** impaginazione HUD (pixel interi) */
const BAR = { x: 58, y: HUD_Y + 13, w: 82, h: 8 } as const;
const GAUGE = { x: 3, y: 296 - SCREEN.safeBottom, w: 62, h: 21 } as const;
const PRIZE = { x: 115, y: 296 - SCREEN.safeBottom, w: 62, h: 21 } as const;

/**
 * Minigioco SPRITZ (mondi 2 e 3): il giocatore è salito in cima alla talpa e
 * spruzza calcestruzzo sulla roccia nuda della galleria.
 *
 * - Scena sovrapposta lanciata dal pulsante SPRITZ della UI: mette in pausa
 *   Game, addormenta UI e ProgressHUD, tendine nere a scatti e "salita" con
 *   zoom a scatti. All'uscita fa il contrario e si ferma.
 * - Tieni premuto e trascina: la lancia in basso segue il dito, il getto di
 *   gocce vola al bersaglio (sopra il dito, SPRITZ.aimOffsetY) e copre la
 *   griglia di celle della parete (gfx/spritzSprites.buildWallLayout). Due
 *   strati per cella (quattro sui blocchi sporgenti); una zona angolare quasi
 *   piena si completa da sola con un "pop".
 * - La pompa ha una pressione che cala mentre spruzzi e si ricarica quando
 *   molli; a secco si aspetta SPRITZ.lockoutResume.
 * - Avanzamento: 'spritz:progress' ogni SPRITZ.saveEveryMs e all'uscita; al
 *   rientro la copertura salvata si ricostruisce a macchie (ordine
 *   deterministico). Al 100%: festa, economy.add(premio) e 'spritz:done'
 *   (il save azzera la percentuale, progression dà l'XP).
 */
export class Spritz extends Phaser.Scene {
  private world: WorldId = 2;
  private layout!: WallLayout;
  private paint!: Float32Array;
  private coat!: Uint8Array;
  private regionFull: number[] = [];
  private regionDone: boolean[] = [];
  private covered = 0;
  private lastEmitted = -1;
  private shownPct = -1;

  private coatTex!: Phaser.Textures.CanvasTexture;
  private coatImg!: Phaser.GameObjects.Image;
  private coatData!: ImageData;
  private coatDirty = false;

  private viewObjs: Phaser.GameObjects.GameObject[] = [];
  private hudObjs: Phaser.GameObjects.GameObject[] = [];
  /** oggetti della festa al 100% */
  private partyObjs: Phaser.GameObjects.GameObject[] = [];
  private hudShown = false;
  private flashG!: Phaser.GameObjects.Graphics;
  private barG!: Phaser.GameObjects.Graphics;
  private gaugeG!: Phaser.GameObjects.Graphics;
  private hoseG!: Phaser.GameObjects.Graphics;
  private pctText!: Phaser.GameObjects.BitmapText;
  private gaugeLabel!: Phaser.GameObjects.BitmapText;
  private refillLabel!: Phaser.GameObjects.BitmapText;
  private hint: Phaser.GameObjects.BitmapText[] = [];
  private lance!: Phaser.GameObjects.Image;
  private reticle!: Phaser.GameObjects.Image;
  private wipeTop!: Phaser.GameObjects.Rectangle;
  private wipeBottom!: Phaser.GameObjects.Rectangle;

  private drops: Drop[] = [];
  private drips: Drip[] = [];
  private coins: FlyCoin[] = [];

  /** stato del gioco */
  private ready = false;
  private finished = false;
  private exiting = false;
  private sprayId = -1;
  private targetX = 90;
  private targetY = 110;
  private aimX = 90;
  private aimY = 110;
  private tipX = 90;
  private tipY = 290;
  private pressure = 1;
  private locked = false;
  private lastSprayAt = -1e9;
  private dropAcc = 0;
  private landed = 0;
  private nextHissAt = 0;
  private finishedAt = 0;
  private reward = 0;

  constructor() {
    super('Spritz');
  }

  create(data: SpritzData = {}): void {
    this.world = data.world === 3 ? 3 : 2;
    this.ready = false;
    this.finished = false;
    this.exiting = false;
    this.sprayId = -1;
    this.pressure = 1;
    this.locked = false;
    this.lastSprayAt = -1e9;
    this.dropAcc = 0;
    this.landed = 0;
    this.covered = 0;
    this.shownPct = -1;
    this.viewObjs = [];
    this.hudObjs = [];
    this.partyObjs = [];
    this.hudShown = false;
    this.drops = [];
    this.drips = [];
    this.coins = [];
    this.hint = [];
    this.targetX = this.aimX = 90;
    this.targetY = this.aimY = 110;
    this.cameras.main.setZoom(1).setOrigin(0.5);
    anchorBottom(this);

    this.scene.pause('Game');
    registerSpritzSprites(this);

    // la stessa parete (volte completato + mondo) si ricostruisce sempre uguale
    const sp = getSave().spritz;
    this.layout = buildWallLayout(sp.completed * 3 + this.world);
    this.reward = spritzReward(sp.completed, this.world);
    this.buildView();
    this.buildHud();
    this.restore(sp.percent);

    // un fondo interattivo a schermo pieno: niente tocchi alle scene sotto
    this.add.zone(0, SCREEN.top, W, SCREEN.height).setOrigin(0).setInteractive().setDepth(-1);
    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    this.input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    this.input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    this.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
    this.input.on(Phaser.Input.Events.GAME_OUT, () => (this.sprayId = -1));

    this.time.addEvent({ delay: SPRITZ.saveEveryMs, loop: true, callback: () => this.emitProgress() });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      // in ogni caso il gioco sotto non resta in pausa né senza HUD
      if (this.scene.isPaused('Game')) this.scene.resume('Game');
      for (const k of ['UI', 'ProgressHUD']) if (this.scene.isSleeping(k)) this.scene.wake(k);
      for (const c of this.coins) releaseImage(c.img);
      this.coins = [];
      this.input.off(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
      this.input.off(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
      this.input.off(Phaser.Input.Events.POINTER_UP, this.onUp, this);
      this.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
    });

    this.enter();
  }

  // ---------------------------------------------------------------- costruzione

  private buildView(): void {
    const v = this.viewObjs;
    v.push(this.add.image(0, SCREEN.top, 'sz-view').setOrigin(0).setDepth(D.view));
    for (const c of this.layout.chunks) v.push(this.add.image(c.x, c.y, c.key).setDepth(D.chunk));

    // cemento: una canvas a schermo pieno, scritta a pixel e caricata al massimo una volta per frame
    const existing = this.textures.exists(COAT_KEY) ? (this.textures.get(COAT_KEY) as Phaser.Textures.CanvasTexture) : null;
    this.coatTex = existing ?? (this.textures.createCanvas(COAT_KEY, W, H) as Phaser.Textures.CanvasTexture);
    this.coatData = this.coatTex.getContext().createImageData(W, H);
    this.coatImg = this.add.image(0, 0, COAT_KEY).setOrigin(0).setDepth(D.coat);
    v.push(this.coatImg);

    this.flashG = this.add.graphics().setDepth(D.flash);
    this.hoseG = this.add.graphics().setDepth(D.lance - 1);
    this.lance = this.add.image(90, SPRITZ.lanceBaseY, 'sz-lance').setOrigin(0.5, 1).setScale(SPRITZ.lanceScale).setDepth(D.lance);
    this.reticle = this.add.image(90, 110, 'sz-reticle-a').setDepth(D.reticle).setVisible(false);
    v.push(this.flashG, this.hoseG, this.lance);

    // gocce e colature: pool creati una volta, poi solo mostrati/nascosti
    for (let i = 0; i < SPRITZ.maxDrops; i++) {
      this.drops.push({
        img: this.add.image(0, 0, 'sz-drop').setDepth(D.drop).setVisible(false),
        active: false,
        x0: 0,
        y0: 0,
        x1: 0,
        y1: 0,
        t0: 0,
        dur: 1,
        arc: 0,
      });
    }
    for (let i = 0; i < SPRITZ.maxDrips; i++) {
      this.drips.push({
        img: this.add.image(0, 0, 'sz-drip').setOrigin(0).setDepth(D.drip).setVisible(false),
        active: false,
        left: 0,
        nextAt: 0,
        holdUntil: 0,
      });
    }
  }

  private buildHud(): void {
    const h = this.hudObjs;
    const g = this.add.graphics().setDepth(D.hud);
    h.push(g);

    // barra in alto: percentuale grande, barra di avanzamento, ESCI
    drawPanel(g, 0, SCREEN.top, W, 24 + SCREEN.safeTop, { shadow: C.black });
    this.pctText = pixelText(this, 4, HUD_Y + 3, '0%', C.white).setScale(2).setDepth(D.hud + 1);
    h.push(this.pctText, pixelText(this, BAR.x, HUD_Y + 3, 'RIVESTIMENTO', C.silver).setDepth(D.hud + 1));
    this.barG = this.add.graphics().setDepth(D.hud + 1);
    h.push(this.barG);

    const exitLabel = pixelText(this, 0, 0, 'ESCI', C.white);
    exitLabel.setPosition(-Math.floor(exitLabel.width / 2), -4);
    const exitBtn = alignButtonHit(
      new ArcadeButton(this, W - 3 - 31, HUD_Y + 4, {
        w: 31,
        h: 15,
        fill: C.red,
        content: this.add.container(0, 0, [exitLabel]),
        onClick: () => this.exit(),
      }),
    ).setDepth(D.hud + 2);
    h.push(exitBtn);

    // in basso a sinistra: manometro della pompa
    drawPanel(g, GAUGE.x, GAUGE.y, GAUGE.w, GAUGE.h, { shadow: C.black });
    this.gaugeLabel = pixelText(this, GAUGE.x + 3, GAUGE.y + 2, 'PRESSIONE', C.white).setDepth(D.hud + 1);
    this.refillLabel = pixelText(this, GAUGE.x + 3, GAUGE.y + 2, 'RICARICA', C.orange).setDepth(D.hud + 1).setVisible(false);
    this.gaugeG = this.add.graphics().setDepth(D.hud + 1);
    h.push(this.gaugeLabel, this.refillLabel, this.gaugeG);

    // in basso a destra: il premio in palio
    drawPanel(g, PRIZE.x, PRIZE.y, PRIZE.w, PRIZE.h, { fill: C.navy, highlight: C.blue, shadow: C.black });
    h.push(
      pixelText(this, PRIZE.x + 3, PRIZE.y + 2, 'PREMIO', C.silver).setDepth(D.hud + 1),
      this.add.image(PRIZE.x + 4, PRIZE.y + 12, 'ui-coin').setOrigin(0).setDepth(D.hud + 1),
      pixelText(this, PRIZE.x + PRIZE.w - 3, PRIZE.y + 11, `+${this.reward}`, C.yellow).setOrigin(1, 0).setDepth(D.hud + 1),
    );

    // suggerimento finché non si spruzza
    this.hint = [
      pixelText(this, W / 2, 196, 'TIENI PREMUTO', C.yellow).setOrigin(0.5, 0).setDepth(D.text),
      pixelText(this, W / 2, 206, 'E SPRUZZA LA ROCCIA!', C.white).setOrigin(0.5, 0).setDepth(D.text),
    ];
    h.push(...this.hint);
    this.time.addEvent({
      delay: 420,
      loop: true,
      callback: () => this.hint[0]?.active && this.hint[0].setVisible(!this.hint[0].visible),
    });

    // tendine nere per ingresso/uscita (sempre sopra a tutto)
    const black = col(C.black);
    this.wipeTop = this.add.rectangle(0, SCREEN.top, W, 0, black).setOrigin(0).setDepth(D.wipe);
    this.wipeBottom = this.add.rectangle(0, H, W, 0, black).setOrigin(0, 1).setDepth(D.wipe);
  }

  /** Ricostruisce la copertura salvata: le prime celle dell'ordine a macchie, coperte. */
  private restore(percent: number): void {
    const L = this.layout;
    this.paint = new Float32Array(L.need.length);
    this.coat = new Uint8Array(L.need.length);
    this.regionFull = L.regionCells.map(() => 0);
    this.regionDone = L.regionCells.map(() => false);
    const n = Math.min(L.total - 1, Math.round((Phaser.Math.Clamp(percent, 0, 100) / 100) * L.total));
    for (let k = 0; k < n; k++) {
      const i = L.order[k];
      this.paint[i] = L.need[i];
      this.coat[i] = 2;
      this.regionFull[L.region[i]]++;
      this.covered++;
    }
    this.coatData.data.fill(0);
    for (let i = 0; i < this.coat.length; i++) if (this.coat[i]) this.paintCell(i);
    this.flushCoat();
    this.lastEmitted = percent;
    this.updateHud();
  }

  // ---------------------------------------------------------------- ingresso / uscita

  /** Tendine che si chiudono sul gioco, poi "salita" sulla talpa con zoom a scatti. */
  private enter(): void {
    this.setVisible(this.viewObjs, false);
    this.setVisible(this.hudObjs, false);
    this.wipe(true, () => {
      this.scene.sleep('UI');
      this.scene.sleep('ProgressHUD');
      this.setVisible(this.viewObjs, true);
      this.wipeTop.height = 0;
      this.wipeBottom.height = 0;
      const cam = this.cameras.main.setOrigin(0.5, 1);
      const zooms = SPRITZ.climbZoom;
      cam.setZoom(zooms[0]);
      let i = 1;
      this.time.addEvent({
        delay: SPRITZ.climbStepMs,
        repeat: zooms.length - 2,
        callback: () => {
          // passi sulla scaletta della talpa
          tone({ type: 'square', from: i % 2 ? 196 : 247, to: 150, dur: 0.05, vol: 0.12 });
          cam.setZoom(zooms[i++]);
          if (i >= zooms.length) {
            cam.setOrigin(0.5);
            this.setVisible(this.hudObjs, true);
            this.hudShown = true;
            this.ready = true;
          }
        },
      });
    });
  }

  /** ESCI (o fine della festa): salva, tendine, gioco ripreso, scena ferma. */
  private exit(): void {
    if (this.exiting || (!this.ready && !this.finished)) return;
    this.exiting = true;
    this.ready = false;
    this.sprayId = -1;
    if (!this.finished) this.emitProgress();
    this.wipe(true, () => {
      this.setVisible(this.viewObjs, false);
      this.setVisible(this.hudObjs, false);
      this.setVisible(this.partyObjs, false);
      this.hudShown = false;
      this.reticle.setVisible(false);
      for (const c of this.coins) releaseImage(c.img);
      this.coins = [];
      for (const d of this.drops) d.img.setVisible(false);
      for (const d of this.drips) d.img.setVisible(false);
      this.scene.wake('UI');
      this.scene.wake('ProgressHUD');
      this.scene.resume('Game');
      this.wipe(false, () => this.scene.stop());
    });
  }

  /** Tendine nere dall'alto e dal basso, a scatti (close = si chiudono). */
  private wipe(close: boolean, done: () => void): void {
    const n = SPRITZ.wipeSteps;
    let k = 0;
    const set = (step: number) => {
      const h = Math.ceil((SCREEN.height / 2) * (step / n));
      this.wipeTop.height = h;
      this.wipeBottom.height = h;
    };
    set(close ? 0 : n);
    this.time.addEvent({
      delay: SPRITZ.wipeStepMs,
      repeat: n - 1,
      callback: () => {
        k++;
        set(close ? k : n - k);
        if (k >= n) done();
      },
    });
  }

  private setVisible(list: Phaser.GameObjects.GameObject[], v: boolean): void {
    for (const o of list) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(v);
  }

  // ---------------------------------------------------------------- input

  private onDown(p: Phaser.Input.Pointer): void {
    unlockAudio();
    if (this.finished) {
      if (this.time.now - this.finishedAt >= SPRITZ.celebrateMinMs) this.exit();
      return;
    }
    if (!this.ready || this.sprayId >= 0) return;
    this.sprayId = p.id;
    this.setTarget(p);
    if (this.hint.length) {
      for (const t of this.hint) t.destroy();
      this.hint = [];
    }
  }

  private onMove(p: Phaser.Input.Pointer): void {
    if (p.id === this.sprayId) this.setTarget(p);
  }

  private onUp(p: Phaser.Input.Pointer): void {
    if (p.id === this.sprayId) this.sprayId = -1;
  }

  private setTarget(p: Phaser.Input.Pointer): void {
    const w = this.cameras.main.getWorldPoint(p.x, p.y, tmpPoint);
    this.targetX = Phaser.Math.Clamp(Math.round(w.x), 2, W - 3);
    this.targetY = Phaser.Math.Clamp(Math.round(w.y + SPRITZ.aimOffsetY), SPRITZ.wallTop, SPRITZ.deckY - 2);
  }

  // ---------------------------------------------------------------- ciclo

  update(_time: number, delta: number): void {
    const dt = Math.min(delta, 50);
    const now = this.time.now;
    const spraying = this.ready && this.sprayId >= 0;

    // pompa: cala mentre spruzzi, si ricarica quando molli (o a secco)
    if (spraying && !this.locked) {
      this.pressure -= (SPRITZ.pressureDrainPerSec * dt) / 1000;
      this.lastSprayAt = now;
      if (this.pressure <= 0) {
        this.pressure = 0;
        this.locked = true;
        // "pfff" della pompa a secco
        noise({ dur: 0.35, vol: 0.12, freq: 900, freqTo: 120 });
        tone({ type: 'square', from: 180, to: 90, dur: 0.18, vol: 0.1 });
      }
    } else if (this.locked || now - this.lastSprayAt >= SPRITZ.rechargeDelayMs) {
      this.pressure = Math.min(1, this.pressure + (SPRITZ.pressureRechargePerSec * dt) / 1000);
      if (this.locked && this.pressure >= SPRITZ.lockoutResume) {
        this.locked = false;
        tone({ type: 'square', from: 660, to: 880, dur: 0.06, vol: 0.1 });
      }
    }

    // lancia: insegue il bersaglio, la base sotto lo schermo segue di meno
    const k = 1 - Math.pow(1 - SPRITZ.aimFollow, dt / (1000 / 60));
    this.aimX += (this.targetX - this.aimX) * k;
    this.aimY += (this.targetY - this.aimY) * k;
    this.updateLance();

    // getto
    if (spraying && !this.locked) {
      this.dropAcc += (SPRITZ.dropsPerSec * dt) / 1000;
      while (this.dropAcc >= 1) {
        this.dropAcc -= 1;
        // pressione bassa: il getto tossisce
        if (this.pressure < SPRITZ.sputterBelow && Math.random() < 0.5) continue;
        this.spawnDrop();
      }
      if (now >= this.nextHissAt) {
        this.nextHissAt = now + SPRITZ.hissEveryMs;
        noise({ dur: 0.14, vol: 0.04 + this.pressure * 0.05, freq: 3200, freqTo: 2200, highpass: true });
      }
    } else {
      this.dropAcc = 0;
    }
    this.reticle
      .setVisible(spraying)
      .setPosition(Math.round(this.aimX), Math.round(this.aimY))
      .setTexture(Math.floor(now / 160) % 2 ? 'sz-reticle-b' : 'sz-reticle-a');

    this.updateDrops(now);
    this.updateDrips(now);
    this.updateCoins(now);
    this.flushCoat();
    this.updateHud();
  }

  private updateLance(): void {
    const baseX = 90 + (this.aimX - 90) * SPRITZ.baseFollow;
    const baseY = SPRITZ.lanceBaseY;
    const ang = Math.atan2(this.aimY - baseY, this.aimX - baseX);
    this.lance.setPosition(Math.round(baseX), baseY).setRotation(ang + Math.PI / 2);
    const len = (SPRITZ.lanceLen - 2) * SPRITZ.lanceScale;
    this.tipX = baseX + Math.cos(ang) * len;
    this.tipY = baseY + Math.sin(ang) * len;

    // tubo: curva dal fondo della lancia all'angolo in basso a destra (quadratini 3x3 bordati)
    const g = this.hoseG.clear();
    const gx = baseX + Math.cos(ang) * 8 * SPRITZ.lanceScale;
    const gy = baseY + Math.sin(ang) * 8 * SPRITZ.lanceScale;
    const cx = gx + 34;
    const cy = H + 8;
    for (const [color, s] of [
      [C.black, 8],
      [C.charcoal, 6],
    ] as const) {
      g.fillStyle(col(color));
      for (let t = 0; t <= 1; t += 0.05) {
        const a = (1 - t) * (1 - t);
        const b = 2 * (1 - t) * t;
        const x = a * gx + b * cx + t * t * (W + 4);
        const y = a * gy + b * cy + t * t * (H - 6);
        g.fillRect(Math.round(x - s / 2), Math.round(y - s / 2), s, s);
      }
    }
  }

  // ---------------------------------------------------------------- gocce, macchie, colature

  private spawnDrop(): void {
    const d = this.drops.find((o) => !o.active);
    if (!d) return;
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * SPRITZ.dropJitter;
    d.x0 = this.tipX;
    d.y0 = this.tipY;
    d.x1 = Math.round(this.aimX + Math.cos(a) * r);
    d.y1 = Math.round(this.aimY + Math.sin(a) * r);
    const dist = Math.hypot(d.x1 - d.x0, d.y1 - d.y0);
    d.dur = Math.max(60, dist / SPRITZ.dropSpeed);
    d.arc = dist * SPRITZ.dropArc;
    d.t0 = this.time.now;
    d.active = true;
    d.img.setTexture('sz-drop').setPosition(Math.round(d.x0), Math.round(d.y0)).setVisible(true);
    // nebbiolina all'ugello
    if (this.landed % 4 === 0) {
      spawnParticles(this, this.tipX, this.tipY, { count: 1, colors: [C.white, C.silver], speed: 0.6, lifeMs: 220, size: 1, gravity: 0.02, depth: D.lance + 1 });
    }
  }

  private updateDrops(now: number): void {
    for (const d of this.drops) {
      if (!d.active) continue;
      const t = (now - d.t0) / d.dur;
      if (t >= 1) {
        d.active = false;
        d.img.setVisible(false);
        this.land(d.x1, d.y1);
        continue;
      }
      const x = d.x0 + (d.x1 - d.x0) * t;
      const y = d.y0 + (d.y1 - d.y0) * t - Math.sin(Math.PI * t) * d.arc;
      // prospettiva: la goccia si rimpicciolisce mentre va verso la parete
      if (t > 0.55) d.img.setTexture('sz-drop-s');
      d.img.setPosition(Math.round(x), Math.round(y));
    }
  }

  /** Una goccia arriva: macchia di cemento sulla griglia, splat, polvere, a volte una colatura. */
  private land(x: number, y: number): void {
    this.landed++;
    const L = this.layout;
    const cs = SPRITZ.cell;
    const rad = SPRITZ.splatRadius + Math.random() * SPRITZ.splatRadiusVar;
    const c0 = Math.max(0, Math.floor((x - rad) / cs));
    const c1 = Math.min(L.cols - 1, Math.floor((x + rad) / cs));
    const r0 = Math.max(0, Math.floor((y - rad) / cs));
    const r1 = Math.min(L.rows - 1, Math.floor((y + rad) / cs));
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const d = Math.hypot(cx * cs + cs / 2 - x, cy * cs + cs / 2 - y);
        if (d > rad) continue;
        const amt = SPRITZ.dropPaintCenter + (SPRITZ.dropPaintEdge - SPRITZ.dropPaintCenter) * (d / rad);
        this.addPaint(cy * L.cols + cx, amt);
      }
    }
    if (this.finished) return;
    const onWall = viewKind(x, y) === 'wall';
    if (this.landed % SPRITZ.splatEvery === 0) {
      popFrames(this, x, y, SPLAT_FRAMES, SPRITZ.splatFrameMs, { depth: D.drop + 1 });
      noise({ dur: 0.04, vol: 0.05, freq: 1400, freqTo: 300 });
    }
    if (this.landed % SPRITZ.dustEvery === 0) {
      spawnParticles(this, x, y, { count: 2, colors: [C.slate, C.charcoal, C.silver], speed: 1.2, gravity: 0.12, lifeMs: 380, depth: D.drop + 2 });
    }
    if (onWall && Math.random() < SPRITZ.dripChance) this.spawnDrip(x, y + 2);
  }

  private spawnDrip(x: number, y: number): void {
    const d = this.drips.find((o) => !o.active);
    if (!d) return;
    d.active = true;
    d.left = Phaser.Math.Between(SPRITZ.dripMinPx, SPRITZ.dripMaxPx);
    d.nextAt = this.time.now + SPRITZ.dripStepMs;
    d.holdUntil = 0;
    d.img.setPosition(Math.round(x), Math.round(y)).setVisible(true);
  }

  private updateDrips(now: number): void {
    for (const d of this.drips) {
      if (!d.active) continue;
      if (d.left > 0) {
        if (now < d.nextAt) continue;
        d.nextAt = now + SPRITZ.dripStepMs;
        d.left--;
        d.img.y += 1;
        if (d.left === 0 || viewKind(d.img.x, d.img.y + 3) !== 'wall') {
          d.left = 0;
          d.holdUntil = now + SPRITZ.dripHoldMs;
        }
        continue;
      }
      // ferma, poi lampeggia e sparisce
      const rest = d.holdUntil - now;
      if (rest <= 0) {
        d.active = false;
        d.img.setVisible(false);
      } else if (rest < 240) {
        d.img.setVisible(Math.floor(rest / 60) % 2 === 0);
      }
    }
  }

  // ---------------------------------------------------------------- copertura

  private addPaint(i: number, amt: number): void {
    const need = this.layout.need[i];
    if (!need || this.coat[i] === 2) return;
    this.paint[i] += amt;
    const st: CoatState = this.paint[i] >= need ? 2 : this.paint[i] >= SPRITZ.thinAt ? 1 : 0;
    if (st !== this.coat[i]) this.setCell(i, st);
  }

  private setCell(i: number, st: CoatState): void {
    this.coat[i] = st;
    this.paintCell(i);
    if (st !== 2) return;
    this.covered++;
    const reg = this.layout.region[i];
    this.regionFull[reg]++;
    if (!this.regionDone[reg] && this.regionFull[reg] >= SPRITZ.regionAutoFill * this.layout.regionCells[reg].length) {
      this.completeRegion(reg);
    }
    if (!this.finished && this.covered >= this.layout.total) this.finish();
  }

  /** Scrive i pixel di una cella nell'ImageData del cemento. */
  private paintCell(i: number): void {
    const L = this.layout;
    const cs = SPRITZ.cell;
    const x0 = (i % L.cols) * cs;
    const y0 = Math.floor(i / L.cols) * cs;
    const st = this.coat[i] as CoatState;
    const px = this.coatData.data;
    for (let y = y0; y < y0 + cs; y++) {
      for (let x = x0; x < x0 + cs; x++) {
        const o = (y * W + x) * 4;
        const c = coatColor(x, y, st);
        if (c < 0) {
          px[o + 3] = 0;
          continue;
        }
        const rgb = PALETTE_INT[c];
        px[o] = (rgb >> 16) & 255;
        px[o + 1] = (rgb >> 8) & 255;
        px[o + 2] = rgb & 255;
        px[o + 3] = 255;
      }
    }
    this.coatDirty = true;
  }

  private flushCoat(): void {
    if (!this.coatDirty) return;
    this.coatDirty = false;
    this.coatTex.getContext().putImageData(this.coatData, 0, 0);
    this.coatTex.refresh();
  }

  /** Zona quasi piena: si completa da sola, lampo bianco, "OK!" e un accordo. */
  private completeRegion(reg: number): void {
    this.regionDone[reg] = true;
    const L = this.layout;
    const cells = L.regionCells[reg];
    const cs = SPRITZ.cell;
    let sx = 0;
    let sy = 0;
    this.flashG.clear().fillStyle(col(C.white));
    for (const i of cells) {
      const x = (i % L.cols) * cs;
      const y = Math.floor(i / L.cols) * cs;
      sx += x;
      sy += y;
      if (this.coat[i] !== 2) {
        this.paint[i] = L.need[i];
        this.setCell(i, 2);
      }
      // lampo a scacchi: si vede la zona intera senza coprire tutto
      if (((i % L.cols) + Math.floor(i / L.cols)) % 2 === 0) this.flashG.fillRect(x, y, cs, cs);
    }
    this.time.delayedCall(70, () => this.flashG.clear());
    const cx = Math.round(sx / cells.length + cs / 2);
    const cy = Math.round(sy / cells.length + cs / 2);
    spawnParticles(this, cx, cy, { count: 12, colors: [C.white, C.silver, C.yellow], speed: 2.4, lifeMs: 520, depth: D.text });
    [659, 880, 1175].forEach((f, k) => tone({ type: 'square', from: f, dur: 0.07, vol: 0.1, delay: k * 0.05 }));
    shake(this, 1, 120);
    if (this.finished) return;
    const ok = pixelText(this, cx, cy, 'OK!', C.lime).setOrigin(0.5).setScale(2).setDepth(D.text);
    this.time.delayedCall(80, () => ok.setScale(1));
    this.time.delayedCall(SPRITZ.regionPopMs, () => ok.destroy());
  }

  // ---------------------------------------------------------------- HUD

  private percent(): number {
    return (this.covered / this.layout.total) * 100;
  }

  private updateHud(): void {
    const pct = this.percent();
    const shown = this.finished ? 100 : Math.min(99, Math.floor(pct));
    if (shown !== this.shownPct) {
      this.shownPct = shown;
      setPixelText(this.pctText, `${shown}%`);
      const g = this.barG.clear();
      drawPanel(g, BAR.x, BAR.y, BAR.w, BAR.h, { fill: C.black, border: C.black, highlight: null });
      const fw = Math.round(((BAR.w - 2) * shown) / 100);
      if (fw > 0) {
        g.fillStyle(col(C.lime)).fillRect(BAR.x + 1, BAR.y + 1, fw, BAR.h - 2);
        g.fillStyle(col(C.green)).fillRect(BAR.x + 1, BAR.y + BAR.h - 3, fw, 2);
      }
      // tacche ogni 25%
      g.fillStyle(col(C.charcoal));
      for (let q = 1; q < 4; q++) g.fillRect(BAR.x + 1 + Math.round(((BAR.w - 2) * q) / 4), BAR.y + 1, 1, 2);
    }

    // manometro: azzurro, arancio quando tossisce, rosso lampeggiante a secco
    const g = this.gaugeG.clear();
    const bx = GAUGE.x + 3;
    const by = GAUGE.y + 12;
    const bw = GAUGE.w - 6;
    g.fillStyle(col(C.black)).fillRect(bx, by, bw, 6);
    const pw = Math.round((bw - 2) * this.pressure);
    const blink = Math.floor(this.time.now / 150) % 2 === 0;
    const fill = this.locked ? (blink ? C.red : C.plum) : this.pressure < SPRITZ.sputterBelow ? C.orange : C.cyan;
    if (pw > 0) g.fillStyle(col(fill)).fillRect(bx + 1, by + 1, pw, 4);
    if (this.locked) {
      const lx = bx + 1 + Math.round((bw - 2) * SPRITZ.lockoutResume);
      g.fillStyle(col(C.white)).fillRect(lx, by, 1, 6);
    }
    if (this.hudShown) {
      this.gaugeLabel.setVisible(!this.locked);
      this.refillLabel.setVisible(this.locked && blink);
    }
  }

  private emitProgress(): void {
    if (this.finished) return;
    const p = Math.floor(this.percent() * 10) / 10;
    if (p === this.lastEmitted) return;
    this.lastEmitted = p;
    events.emit('spritz:progress', { percent: p });
  }

  // ---------------------------------------------------------------- 100%: festa e premio

  private finish(): void {
    this.finished = true;
    this.finishedAt = this.time.now;
    this.sprayId = -1;
    for (const t of this.hint) t.destroy();
    this.hint = [];
    for (const d of this.drops) {
      d.active = false;
      d.img.setVisible(false);
    }
    // premio subito (anche se si chiude la pagina durante la festa); il save azzera la percentuale
    economy.add(this.reward);
    events.emit('spritz:done', { reward: this.reward });

    playLevelUp();
    shake(this, 2, 350);
    // lampo bianco a scatti di tutta la parete
    this.coatImg.setTintFill(col(C.white));
    this.time.delayedCall(70, () => this.coatImg.clearTint());
    this.time.delayedCall(140, () => this.coatImg.setTintFill(col(C.white)));
    this.time.delayedCall(210, () => this.coatImg.clearTint());

    const cx = W / 2;
    const party = this.partyObjs;
    const g = this.add.graphics().setDepth(D.party);
    drawPanel(g, 14, 80, W - 28, 90, { fill: C.navy, highlight: C.blue, shadow: C.black });
    const bigA = pixelText(this, cx, 102, '100%!', C.lime).setOrigin(0.5).setScale(4).setDepth(D.party + 1);
    const bigB = pixelText(this, cx, 102, '100%!', C.yellow).setOrigin(0.5).setScale(3).setDepth(D.party + 1).setVisible(false);
    this.time.delayedCall(70, () => bigA.setScale(3));
    this.time.addEvent({
      delay: 150,
      loop: true,
      callback: () => {
        if (!this.hudShown) return;
        bigA.setVisible(!bigA.visible);
        bigB.setVisible(!bigA.visible);
      },
    });
    const prize = pixelText(this, cx + 6, 146, `+${this.reward}`, C.yellow).setOrigin(0.5, 0).setDepth(D.party + 1);
    const coinX = Math.round(cx + 6 - prize.width / 2 - 10);
    party.push(
      g,
      bigA,
      bigB,
      prize,
      pixelText(this, cx, 122, 'GALLERIA', C.white).setOrigin(0.5, 0).setDepth(D.party + 1),
      pixelText(this, cx, 132, 'RIVESTITA!', C.white).setOrigin(0.5, 0).setDepth(D.party + 1),
      this.add.image(coinX, 147, 'ui-coin').setOrigin(0).setDepth(D.party + 1),
      pixelText(this, cx, 157, '+XP BONUS!', C.cyan).setOrigin(0.5, 0).setDepth(D.party + 1),
    );

    // monete che volano dalla parete al premio, coriandoli
    const now = this.time.now;
    for (let i = 0; i < SPRITZ.celebrateCoins; i++) {
      const x0 = Phaser.Math.Between(10, W - 10);
      const y0 = Phaser.Math.Between(SPRITZ.wallTop + 4, SPRITZ.deckY - 10);
      const img = acquireImage(this, x0, y0, 'ui-coin').setDepth(D.party + 2).setVisible(false);
      this.coins.push({ img, start: now + 250 + i * SPRITZ.coinStaggerMs, x0, y0, x1: coinX + 4, y1: 150 });
    }
    this.time.addEvent({
      delay: 160,
      repeat: 7,
      callback: () =>
        spawnParticles(this, Phaser.Math.Between(20, W - 20), Phaser.Math.Between(60, 200), {
          count: 10,
          colors: [C.yellow, C.lime, C.white, C.cyan, C.orange],
          speed: 2.6,
          lifeMs: 700,
          depth: D.party + 3,
        }),
    });
    this.time.delayedCall(SPRITZ.celebrateMinMs, () => {
      if (this.exiting) return;
      const t = pixelText(this, cx, 184, 'TOCCA PER CONTINUARE', C.silver).setOrigin(0.5, 0).setDepth(D.party + 1);
      party.push(t);
      this.time.addEvent({ delay: 400, loop: true, callback: () => this.hudShown && t.setVisible(!t.visible) });
    });
    this.time.delayedCall(SPRITZ.celebrateMs, () => this.exit());
  }

  /** Monete della festa: volo a scatti su una curva, scintilla bianca ogni 4 passi. */
  private updateCoins(now: number): void {
    let w = 0;
    for (const c of this.coins) {
      const el = now - c.start;
      if (el < 0) {
        this.coins[w++] = c;
        continue;
      }
      const t = (Math.floor(el / SPRITZ.coinStepMs) * SPRITZ.coinStepMs) / SPRITZ.coinFlyMs;
      if (t >= 1) {
        releaseImage(c.img);
        playCoin();
        continue;
      }
      const u = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
      const mx = (c.x0 + c.x1) / 2;
      const my = Math.min(c.y0, c.y1) - 30;
      const a = (1 - u) * (1 - u);
      const b = 2 * (1 - u) * u;
      c.img.setPosition(Math.round(a * c.x0 + b * mx + u * u * c.x1), Math.round(a * c.y0 + b * my + u * u * c.y1)).setVisible(true);
      if (Math.floor(el / SPRITZ.coinStepMs) % 4 === 3) c.img.setTintFill(col(C.white));
      else c.img.clearTint();
      this.coins[w++] = c;
    }
    this.coins.length = w;
  }
}

/** Monete premio di una parete completata (cresce con le pareti già fatte e col mondo). */
export function spritzReward(completed: number, world: WorldId): number {
  const base = SPRITZ.rewardBase + SPRITZ.rewardPerCompleted * Math.min(completed, SPRITZ.rewardMaxCompleted);
  return Math.round(base * (SPRITZ.worldRewardMult[world - 1] ?? 1));
}
