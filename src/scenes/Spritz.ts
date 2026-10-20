import Phaser from 'phaser';
import { SCREEN, SPRITZ } from '../config/balance';
import { C, col, PALETTE_INT } from '../config/palette';
import { noise, playCoin, playLevelUp, tone, unlockAudio } from '../audio/sfx';
import { acquireImage, anchorBottom, popFrames, releaseImage, shake, spawnParticles } from '../gfx/effects';
import { measureText, pixelText, setPixelText } from '../gfx/pixelFont';
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
  /** monetina di una zona (va al riquadro premio e lo fa sobbalzare) */
  small: boolean;
}

/** Scritta volante dal pool (parole delle zone, "+1%"): testo bianco tinto col colore voluto. */
interface FloatText {
  t: Phaser.GameObjects.BitmapText;
  active: boolean;
  start: number;
  life: number;
  x: number;
  y: number;
  /** pixel di salita in tutta la vita */
  rise: number;
  /** scala del "pop" iniziale e scala a riposo */
  s0: number;
  s1: number;
  /** rotazione dei primi frame (scatto fumetto) */
  rot: number;
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
const D = { view: 0, chunk: 1, coat: 2, flash: 3, drip: 4, drop: 6, lance: 20, reticle: 21, hud: 30, text: 40, banner: 50, party: 60, screenFlash: 90, wipe: 1000 } as const;
/** impaginazione HUD (pixel interi): barra ancorata in alto (HUD_Y), riquadri in basso sopra l'indicatore home */
const BAR = { x: 58, y: HUD_Y + 13, w: 82, h: 8 } as const;
/** riga alta dei riquadri in basso (manometro, timer, premio) */
const HUD_BOTTOM_Y = H - 24 - SCREEN.safeBottom;
const GAUGE = { x: 3, w: 57, h: 21 } as const;
const TIMER = { x: 62, w: 56, h: 21 } as const;
const PRIZE = { x: 120, w: 57, h: 21 } as const;
/** striscione dei traguardi / tempo scaduto e scritta della combo (sotto la barra in alto) */
const BANNER = { y: HUD_Y + 50, h: 40 } as const;
const COMBO_Y = HUD_Y + 31;
/** colori delle parole delle zone, a giro con la combo */
const WORD_COLORS = [C.lime, C.yellow, C.orange, C.cyan, C.white] as const;
/** colori di coriandoli e fuochi */
const CONFETTI = [C.yellow, C.lime, C.white, C.cyan, C.orange, C.red] as const;
const CEMENT = [C.white, C.silver, C.slate] as const;

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
 *   molli; a secco si aspetta SPRITZ.lockoutResume (raro: dura ~17 s).
 * - Timer: SPRITZ.timerMs a ogni ingresso. Al 100% in tempo premio + bonus
 *   tempo; scaduto → "TEMPO SCADUTO!", niente premio, ma si può finire la
 *   parete ('spritz:done' con reward 0, niente XP).
 * - Juice: parole fumetto e monetine a ogni zona, COMBO, "+1%" vicino al
 *   getto, striscioni ogni SPRITZ.milestoneStep %, barra che si illumina,
 *   festa finale con fuochi di cemento e pioggia di monete.
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
  /** riga alta dei riquadri in basso */
  private hudY: number = HUD_BOTTOM_Y;
  private timerWarned = false;

  /** timer */
  private timeLeft = 0;
  private timedOut = false;
  private lastSec = -1;
  private timerPulseUntil = 0;
  private timerG!: Phaser.GameObjects.Graphics;
  private timerText!: Phaser.GameObjects.BitmapText;
  /** riquadro premio: monete in palio oppure "NIENTE PREMIO" */
  private prizeObjs: Phaser.GameObjects.GameObject[] = [];
  private noPrizeObjs: Phaser.GameObjects.GameObject[] = [];
  private prizeText!: Phaser.GameObjects.BitmapText;
  private prizeBumpUntil = 0;

  /** juice */
  private floats: FloatText[] = [];
  private fxObjs: Phaser.GameObjects.GameObject[] = [];
  private combo = 0;
  private lastRegionAt = -1e9;
  private comboText!: Phaser.GameObjects.BitmapText;
  private comboStart = 0;
  private milestone = 0;
  private lastFloatPct = 0;
  private bannerG!: Phaser.GameObjects.Graphics;
  private bannerBig!: Phaser.GameObjects.BitmapText;
  private bannerSub!: Phaser.GameObjects.BitmapText;
  private bannerStart = 0;
  private bannerUntil = 0;
  private bannerScale = 3;
  private bannerPop = 4;
  private barGlowUntil = 0;
  private barGlowing = false;
  private screenFlash!: Phaser.GameObjects.Rectangle;
  private splats = 0;
  private lastWord = '';

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
    this.timeLeft = SPRITZ.timerMs;
    this.timedOut = false;
    this.timerWarned = false;
    this.lastSec = -1;
    this.timerPulseUntil = 0;
    this.prizeObjs = [];
    this.noPrizeObjs = [];
    this.prizeBumpUntil = 0;
    this.floats = [];
    this.fxObjs = [];
    this.combo = 0;
    this.lastRegionAt = -1e9;
    this.bannerUntil = 0;
    this.barGlowUntil = 0;
    this.barGlowing = false;
    this.splats = 0;
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

    // in basso a sinistra: manometro della pompa (ancorato al fondo dello schermo)
    const y = this.hudY;
    drawPanel(g, GAUGE.x, y, GAUGE.w, GAUGE.h, { shadow: C.black });
    this.gaugeLabel = pixelText(this, GAUGE.x + 3, y + 2, 'PRESSIONE', C.white).setDepth(D.hud + 1);
    this.refillLabel = pixelText(this, GAUGE.x + 3, y + 2, 'RICARICA', C.orange).setDepth(D.hud + 1).setVisible(false);
    this.gaugeG = this.add.graphics().setDepth(D.hud + 1);
    h.push(this.gaugeLabel, this.refillLabel, this.gaugeG);

    // in basso al centro: il timer grande (testo bianco tinto: bianco, rosso negli ultimi secondi, grigio a tempo scaduto)
    this.timerG = this.add.graphics().setDepth(D.hud);
    this.timerText = pixelText(this, TIMER.x + TIMER.w / 2, y + Math.floor(TIMER.h / 2) + 1, '', C.white)
      .setOrigin(0.5)
      .setScale(2)
      .setDepth(D.hud + 2);
    h.push(this.timerG, this.timerText);
    this.drawTimerPanel();
    this.updateTimerText(true);

    // in basso a destra: il premio in palio (o "NIENTE PREMIO" a tempo scaduto)
    drawPanel(g, PRIZE.x, y, PRIZE.w, PRIZE.h, { fill: C.navy, highlight: C.blue, shadow: C.black });
    this.prizeText = pixelText(this, PRIZE.x + PRIZE.w - 3, y + 11, `+${this.reward}`, C.white)
      .setOrigin(1, 0)
      .setTint(col(C.yellow))
      .setDepth(D.hud + 1);
    this.prizeObjs = [
      pixelText(this, PRIZE.x + 3, y + 2, 'PREMIO', C.silver).setDepth(D.hud + 1),
      this.add.image(PRIZE.x + 4, y + 12, 'ui-coin').setOrigin(0).setDepth(D.hud + 1),
      this.prizeText,
    ];
    this.noPrizeObjs = [
      pixelText(this, PRIZE.x + PRIZE.w / 2, y + 2, 'NIENTE', C.red).setOrigin(0.5, 0).setDepth(D.hud + 1),
      pixelText(this, PRIZE.x + PRIZE.w / 2, y + 11, 'PREMIO', C.silver).setOrigin(0.5, 0).setDepth(D.hud + 1),
    ];
    h.push(...this.prizeObjs, ...this.noPrizeObjs);

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

    this.buildFx();

    // tendine nere per ingresso/uscita (sempre sopra a tutto)
    const black = col(C.black);
    this.wipeTop = this.add.rectangle(0, SCREEN.top, W, 0, black).setOrigin(0).setDepth(D.wipe);
    this.wipeBottom = this.add.rectangle(0, H, W, 0, black).setOrigin(0, 1).setDepth(D.wipe);
  }

  /** Oggetti del juice creati una volta sola: pool di scritte, combo, striscione, lampo a schermo pieno. */
  private buildFx(): void {
    for (let i = 0; i < SPRITZ.maxFloatTexts; i++) {
      const t = pixelText(this, 0, 0, '', C.white).setOrigin(0.5).setDepth(D.text).setVisible(false);
      this.floats.push({ t, active: false, start: 0, life: 1, x: 0, y: 0, rise: 0, s0: 1, s1: 1, rot: 0 });
    }
    this.comboText = pixelText(this, W / 2, COMBO_Y, '', C.white).setOrigin(0.5, 0).setDepth(D.text + 2).setVisible(false);
    this.bannerG = this.add.graphics().setDepth(D.banner).setVisible(false);
    this.bannerBig = pixelText(this, W / 2, BANNER.y + 15, '', C.white).setOrigin(0.5).setDepth(D.banner + 1).setVisible(false);
    this.bannerSub = pixelText(this, W / 2, BANNER.y + 31, '', C.white).setOrigin(0.5).setDepth(D.banner + 1).setVisible(false);
    this.screenFlash = this.add.rectangle(0, SCREEN.top, W, SCREEN.height, col(C.white)).setOrigin(0).setDepth(D.screenFlash).setVisible(false);
    this.fxObjs = [...this.floats.map((f) => f.t), this.comboText, this.bannerG, this.bannerBig, this.bannerSub, this.screenFlash];
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
    // traguardi e "+1%" ripartono da dove si era rimasti
    this.milestone = Math.floor(this.percent() / SPRITZ.milestoneStep);
    this.lastFloatPct = Math.floor(this.percent());
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
            this.applyPrizeVisibility();
            this.ready = true;
            // il timer parte adesso: "VIA!" con un bip
            this.showFloat(W / 2, this.hudY - 10, `${Math.round(SPRITZ.timerMs / 60000)} MINUTI!`, C.yellow, { scale: 1, pop: 2, rise: 18, life: 1100 });
            tone({ type: 'square', from: 880, to: 1320, dur: 0.12, vol: 0.12 });
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
      this.setVisible(this.fxObjs, false);
      for (const f of this.floats) f.active = false;
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

    // timer: corre solo mentre si gioca (non durante salita, festa o uscita)
    if (this.ready && !this.finished && !this.timedOut) {
      this.timeLeft -= Math.min(delta, 250);
      if (this.timeLeft <= 0) this.timeUp();
      else this.updateTimerText(false);
    }

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
    this.checkProgressFx();
    this.updateFloats(now);
    this.updateBanner(now);
    this.updateCombo(now);
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
      // macchie varie: girate a scatti di 90 gradi, specchiate, a volte doppie
      const img = popFrames(this, x, y, SPLAT_FRAMES, SPRITZ.splatFrameMs, {
        depth: D.drop + 1,
        rotation: (Math.floor(Math.random() * 4) * Math.PI) / 2,
        flipX: Math.random() < 0.5,
      });
      if (Math.random() < SPRITZ.splatBigChance) img.setScale(2);
      // "sploosh": schiocco filtrato + un "blop" grave, intonazione sempre un po' diversa
      noise({ dur: 0.05, vol: 0.05, freq: 1100 + Math.random() * 900, freqTo: 220 + Math.random() * 200 });
      if (++this.splats % 2 === 0) {
        const f = 150 + Math.random() * 170;
        tone({ type: 'sine', from: f * 1.6, to: f * 0.6, dur: 0.07, vol: 0.09 });
      }
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

  /**
   * Zona quasi piena: si completa da sola. Lampo a scacchi, parola fumetto,
   * accordo che sale con la COMBO, coriandoli, scossa e monetine al premio.
   */
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

    // combo: zone una dopo l'altra entro comboWindowMs
    const now = this.time.now;
    this.combo = now - this.lastRegionAt <= SPRITZ.comboWindowMs ? this.combo + 1 : 1;
    this.lastRegionAt = now;
    const step = Math.min(this.combo, SPRITZ.comboMax) - 1;

    spawnParticles(this, cx, cy, {
      count: SPRITZ.regionParticles + SPRITZ.regionParticlesPerCombo * step,
      colors: step > 0 ? CONFETTI : [C.white, C.silver, C.yellow],
      speed: 2.4 + step * 0.25,
      lifeMs: 560,
      depth: D.text,
    });
    // accordo maggiore che sale di comboSemitones per gradino; dalla combo 3 anche l'ottava
    const base = SPRITZ.chimeBaseHz * Math.pow(2, (step * SPRITZ.comboSemitones) / 12);
    const notes = step >= 2 ? [1, 1.26, 1.5, 2] : [1, 1.26, 1.5];
    notes.forEach((m, k) => tone({ type: 'square', from: base * m, dur: 0.08, vol: 0.1, delay: k * 0.045 }));
    shake(this, step >= 2 ? 2 : 1, 120 + step * 20);
    if (this.finished) return;

    // parola fumetto: con la combo si pesca dalle più "forti", più grande
    const words = SPRITZ.regionWords;
    const lo = Math.min(words.length - 3, step);
    let word = words[lo + Math.floor(Math.random() * (words.length - lo))];
    if (word === this.lastWord) word = words[lo + ((words.indexOf(word) - lo + 1) % (words.length - lo))];
    this.lastWord = word;
    const scale = step >= 2 ? 3 : 2;
    const wy = Phaser.Math.Clamp(cy, SPRITZ.wallTop + 16, SPRITZ.deckY - 10);
    this.showFloat(cx, wy, word, WORD_COLORS[step % WORD_COLORS.length], {
      scale,
      pop: scale + 1,
      rise: 12,
      life: SPRITZ.regionPopMs,
      rot: (Math.random() < 0.5 ? -1 : 1) * 0.15,
    });
    if (this.combo >= 2) this.showCombo();

    // monetine dalla zona al riquadro premio (solo se c'è ancora un premio)
    if (!this.timedOut) {
      const n = SPRITZ.regionCoins + Math.floor(step / 2);
      for (let k = 0; k < n; k++) {
        const img = acquireImage(this, cx, cy, 'ui-coin').setDepth(D.party + 2).setVisible(false);
        this.coins.push({ img, start: now + 120 + k * SPRITZ.coinStaggerMs, x0: cx + Phaser.Math.Between(-6, 6), y0: cy, x1: PRIZE.x + 8, y1: this.hudY + 16, small: true });
      }
    }
  }

  // ---------------------------------------------------------------- juice: scritte, combo, traguardi

  /** Scritta volante dal pool: pop di scala, salita, lampeggio finale (ricicla la più vecchia se piene). */
  private showFloat(
    x: number,
    y: number,
    text: string,
    color: number,
    o: { scale?: number; pop?: number; rise?: number; life?: number; rot?: number } = {},
  ): void {
    // la scritta resta tutta dentro lo schermo: scala ridotta se non ci sta, x spostata dai bordi
    const tw = measureText(text);
    let s1 = o.scale ?? 1;
    while (s1 > 1 && tw * s1 > W - 8) s1--;
    let s0 = Math.max(s1, o.pop ?? s1);
    while (s0 > s1 && tw * s0 > W - 2) s0--;
    const half = Math.ceil((tw * s0) / 2) + 1;
    x = Phaser.Math.Clamp(x, half, W - half);
    let f = this.floats.find((e) => !e.active);
    if (!f) f = this.floats.reduce((a, b) => (a.start <= b.start ? a : b));
    f.active = true;
    f.start = this.time.now;
    f.life = o.life ?? 700;
    f.x = Math.round(x);
    f.y = Math.round(y);
    f.rise = o.rise ?? 10;
    f.s1 = s1;
    f.s0 = s0;
    f.rot = o.rot ?? 0;
    setPixelText(f.t, text);
    f.t.setTint(col(color)).setScale(f.s0).setRotation(f.rot).setPosition(f.x, f.y).setVisible(this.hudShown).setDepth(D.text + 1);
  }

  private updateFloats(now: number): void {
    for (const f of this.floats) {
      if (!f.active) continue;
      const el = now - f.start;
      const t = el / f.life;
      if (t >= 1 || !this.hudShown) {
        f.active = false;
        f.t.setVisible(false);
        continue;
      }
      // pop a scatti: grande per 2 frame, poi a riposo; sale veloce e rallenta
      f.t.setScale(el < 70 ? f.s0 : f.s1).setRotation(el < 140 ? f.rot : 0);
      const u = 1 - (1 - t) * (1 - t);
      f.t.setPosition(f.x, Math.round(f.y - f.rise * u));
      f.t.setVisible(t < 0.7 || Math.floor(el / 60) % 2 === 0);
    }
  }

  /** "COMBO *N" in alto: pop e colore che cambia col gradino. */
  private showCombo(): void {
    const step = Math.min(this.combo, SPRITZ.comboMax) - 1;
    setPixelText(this.comboText, `COMBO *${this.combo}`);
    this.comboText.setTint(col(WORD_COLORS[(step + 1) % WORD_COLORS.length])).setVisible(this.hudShown);
    this.comboStart = this.time.now;
    if (step >= 3) spawnParticles(this, W / 2, COMBO_Y + 6, { count: 8, colors: CONFETTI, speed: 2, lifeMs: 420, depth: D.text + 1 });
  }

  private updateCombo(now: number): void {
    if (!this.comboText.visible) return;
    const el = now - this.comboStart;
    if (el >= SPRITZ.comboWindowMs || !this.hudShown || this.finished) {
      this.comboText.setVisible(false);
      return;
    }
    const big = Math.min(this.combo, SPRITZ.comboMax) >= 4 ? 3 : 2;
    this.comboText.setScale(el < 80 ? big + 1 : big);
    // ultimo terzo della finestra: lampeggia (la combo sta per finire)
    if (el > (SPRITZ.comboWindowMs * 2) / 3) this.comboText.setAlpha(Math.floor(el / 90) % 2 ? 0.4 : 1);
    else this.comboText.setAlpha(1);
  }

  /** "+1%" vicino al getto, traguardi ogni milestoneStep %, barra che si illumina. */
  private checkProgressFx(): void {
    if (this.finished) return;
    const pct = this.percent();
    const whole = Math.floor(pct);
    if (whole > this.lastFloatPct) {
      const gain = whole - this.lastFloatPct;
      this.lastFloatPct = whole;
      this.barGlowUntil = this.time.now + SPRITZ.barGlowMs;
      if (this.hudShown) {
        const x = Phaser.Math.Clamp(Math.round(this.aimX) + Phaser.Math.Between(-8, 8), 14, W - 14);
        const y = Math.max(SPRITZ.wallTop + 20, Math.round(this.aimY) - 10);
        this.showFloat(x, y, `+${gain}%`, gain > 1 ? C.yellow : C.lime, { scale: 1, pop: 2, rise: 14, life: SPRITZ.pctFloatMs });
      }
    }
    const m = Math.floor(pct / SPRITZ.milestoneStep);
    if (m > this.milestone) {
      this.milestone = m;
      if (m * SPRITZ.milestoneStep < 100) this.showMilestone(m * SPRITZ.milestoneStep);
    }
  }

  /** Striscione del traguardo: numero grande che "esplode", suono; 50% e 90% con lampo e coriandoli. */
  private showMilestone(pct: number): void {
    const special = pct === 50 || pct === 90;
    const sub = pct === 50 ? "SEI A META'!" : pct === 90 ? 'QUASI FATTO!' : pct >= 70 ? 'DAI CHE CI SEI!' : 'BEL LAVORO!';
    this.showBanner(`${pct}%`, sub, special ? C.yellow : C.lime, C.white, special ? 4 : 3, special ? C.plum : C.navy);
    const base = special ? 659 : 523;
    const notes = special ? [1, 1.26, 1.5, 2, 2.52] : [1, 1.26, 1.5, 2];
    notes.forEach((m, k) => tone({ type: 'square', from: base * m, dur: 0.1, vol: 0.12, delay: k * 0.07 }));
    if (special) {
      tone({ type: 'triangle', from: base / 2, to: base, dur: 0.4, vol: 0.18 });
      this.flashScreen(2);
      shake(this, 2, 260);
      for (let k = 0; k < 3; k++) {
        this.time.delayedCall(k * 120, () =>
          spawnParticles(this, 30 + k * 60, BANNER.y + BANNER.h / 2, { count: 16, colors: CONFETTI, speed: 3, lifeMs: 700, gravity: 0.1, depth: D.banner + 2 }),
        );
      }
    } else {
      shake(this, 1, 150);
      spawnParticles(this, W / 2, BANNER.y + BANNER.h / 2, { count: 14, colors: CONFETTI, speed: 2.6, lifeMs: 600, depth: D.banner + 2 });
    }
  }

  /** Striscione orizzontale con una scritta grande e una piccola (traguardi, tempo scaduto). */
  private showBanner(big: string, sub: string, bigColor: number, subColor: number, scale: number, fill: number, ms: number = SPRITZ.milestoneMs): void {
    this.bannerStart = this.time.now;
    this.bannerUntil = this.time.now + ms;
    this.bannerScale = scale;
    // il "pop" ingrandisce di 1 solo se la scritta ci sta ancora
    this.bannerPop = measureText(big) * (scale + 1) <= W - 2 ? scale + 1 : scale;
    const g = this.bannerG.clear();
    drawPanel(g, -1, BANNER.y, W + 2, BANNER.h, { fill, highlight: C.white, shadow: C.black });
    g.fillStyle(col(C.black)).fillRect(0, BANNER.y + BANNER.h - 2, W, 1);
    setPixelText(this.bannerBig, big);
    setPixelText(this.bannerSub, sub);
    this.bannerBig.setTint(col(bigColor)).setScale(this.bannerPop);
    this.bannerSub.setTint(col(subColor));
    const v = this.hudShown;
    this.bannerG.setVisible(v);
    this.bannerBig.setVisible(v);
    this.bannerSub.setVisible(v);
  }

  private updateBanner(now: number): void {
    if (!this.bannerG.visible) return;
    const el = now - this.bannerStart;
    if (now >= this.bannerUntil || !this.hudShown) {
      this.bannerG.setVisible(false);
      this.bannerBig.setVisible(false);
      this.bannerSub.setVisible(false);
      return;
    }
    // entra a scatti dal lato, pop della scritta grande, lampeggio negli ultimi 300 ms
    const slide = el < 90 ? Math.round(W * (1 - el / 90)) : 0;
    this.bannerG.x = -slide;
    this.bannerBig.setScale(el < 140 ? this.bannerPop : this.bannerScale).setX(W / 2 - slide);
    this.bannerSub.setX(W / 2 - slide).setVisible(el > 120);
    const blink = this.bannerUntil - now < 300 && Math.floor(el / 60) % 2 === 0;
    this.bannerBig.setAlpha(blink ? 0.3 : 1);
  }

  /** Lampo bianco a schermo pieno per `frames` scatti da 2 frame. */
  private flashScreen(times: number): void {
    for (let k = 0; k < times; k++) {
      this.time.delayedCall(k * 120, () => this.screenFlash.setVisible(this.hudShown).setAlpha(0.8));
      this.time.delayedCall(k * 120 + 40, () => this.screenFlash.setVisible(false));
    }
  }

  // ---------------------------------------------------------------- timer

  private drawTimerPanel(): void {
    const g = this.timerG.clear();
    const warn = !this.timedOut && this.timeLeft <= SPRITZ.timerWarnMs;
    const fill = this.timedOut ? C.charcoal : warn ? C.plum : C.navy;
    const highlight = this.timedOut ? C.slate : warn ? C.red : C.blue;
    drawPanel(g, TIMER.x, this.hudY, TIMER.w, TIMER.h, { fill, highlight, shadow: C.black });
  }

  /** Testo del timer "M:SS"; negli ultimi secondi rosso, tic e pulsazione a ogni secondo. */
  private updateTimerText(force: boolean): void {
    const sec = Math.max(0, Math.ceil(this.timeLeft / 1000));
    const now = this.time.now;
    if (sec !== this.lastSec || force) {
      const crossed = this.lastSec > sec;
      this.lastSec = sec;
      setPixelText(this.timerText, `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`);
      const warn = this.timeLeft <= SPRITZ.timerWarnMs;
      if (warn && crossed) {
        this.timerPulseUntil = now + 110;
        const panic = this.timeLeft <= SPRITZ.timerPanicMs;
        tone({ type: 'square', from: panic ? 1568 : 1175, to: panic ? 1400 : 1000, dur: 0.04, vol: 0.1 });
        if (panic) tone({ type: 'square', from: 1568, to: 1400, dur: 0.04, vol: 0.08, delay: 0.12 });
      }
      // entrata negli ultimi secondi: riquadro rosso
      if (warn && !this.timerWarned) {
        this.timerWarned = true;
        this.drawTimerPanel();
      }
    }
    const warn = !this.timedOut && this.timeLeft <= SPRITZ.timerWarnMs;
    const pulse = now < this.timerPulseUntil;
    this.timerText
      .setTint(col(this.timedOut ? C.silver : warn ? (pulse ? C.white : C.red) : C.white))
      .setScale(pulse ? 3 : 2);
  }

  /** Tempo scaduto: scritta grande, timer grigio, niente premio; si può continuare a spruzzare. */
  private timeUp(): void {
    this.timedOut = true;
    this.timeLeft = 0;
    this.reward = 0;
    this.combo = 0;
    this.lastSec = -1;
    this.updateTimerText(true);
    this.drawTimerPanel();
    this.applyPrizeVisibility();
    this.showBanner('TEMPO SCADUTO!', 'NIENTE PREMIO', C.red, C.white, 2, C.black, SPRITZ.timeoutBannerMs);
    this.flashScreen(1);
    shake(this, 2, 300);
    // "uoo-uoo": tre note che scendono + soffio
    [392, 330, 262].forEach((f, k) => tone({ type: 'square', from: f, to: f * 0.94, dur: 0.18, vol: 0.12, delay: k * 0.2 }));
    noise({ dur: 0.5, vol: 0.06, freq: 700, freqTo: 120, delay: 0.55 });
    // monetine ancora in volo: spariscono
    for (const c of this.coins) if (c.small) releaseImage(c.img);
    this.coins = this.coins.filter((c) => !c.small);
  }

  /** Riquadro premio: monete in palio, oppure "NIENTE PREMIO" a tempo scaduto. */
  private applyPrizeVisibility(): void {
    const v = this.hudShown;
    this.setVisible(this.prizeObjs, v && !this.timedOut);
    this.setVisible(this.noPrizeObjs, v && this.timedOut);
  }

  // ---------------------------------------------------------------- HUD

  private percent(): number {
    return (this.covered / this.layout.total) * 100;
  }

  private updateHud(): void {
    const now = this.time.now;
    const pct = this.percent();
    const shown = this.finished ? 100 : Math.min(99, Math.floor(pct));
    const glow = now < this.barGlowUntil;
    if (shown !== this.shownPct || glow || this.barGlowing) {
      if (shown !== this.shownPct) setPixelText(this.pctText, `${shown}%`);
      this.shownPct = shown;
      this.barGlowing = glow;
      const g = this.barG.clear();
      // bordo che lampeggia giallo/bianco mentre la barra cresce
      const border = glow ? (Math.floor(now / 60) % 2 ? C.yellow : C.white) : C.black;
      drawPanel(g, BAR.x, BAR.y, BAR.w, BAR.h, { fill: C.black, border, highlight: null });
      const fw = Math.round(((BAR.w - 2) * shown) / 100);
      if (fw > 0) {
        g.fillStyle(col(glow ? C.white : C.lime)).fillRect(BAR.x + 1, BAR.y + 1, fw, BAR.h - 2);
        g.fillStyle(col(glow ? C.lime : C.green)).fillRect(BAR.x + 1, BAR.y + BAR.h - 3, fw, 2);
        // punta luminosa
        if (glow && fw > 2) g.fillStyle(col(C.yellow)).fillRect(BAR.x + fw - 1, BAR.y + 1, 2, BAR.h - 2);
      }
      // tacche ogni 25%
      g.fillStyle(col(C.charcoal));
      for (let q = 1; q < 4; q++) g.fillRect(BAR.x + 1 + Math.round(((BAR.w - 2) * q) / 4), BAR.y + 1, 1, 2);
      // la percentuale sobbalza di 1px e diventa gialla
      this.pctText.setY(HUD_Y + (glow ? 2 : 3)).setTint(col(glow ? C.yellow : C.white));
    }

    // riquadro premio: sobbalzo quando arriva una monetina
    const bump = now < this.prizeBumpUntil;
    this.prizeText.setY(this.hudY + (bump ? 10 : 11)).setTint(col(bump ? C.white : C.yellow));

    // manometro: azzurro, arancio quando tossisce, rosso lampeggiante a secco
    const g = this.gaugeG.clear();
    const bx = GAUGE.x + 3;
    const by = this.hudY + 12;
    const bw = GAUGE.w - 6;
    g.fillStyle(col(C.black)).fillRect(bx, by, bw, 6);
    const pw = Math.round((bw - 2) * this.pressure);
    const blink = Math.floor(now / 150) % 2 === 0;
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
    this.comboText.setVisible(false);
    for (const f of this.floats) {
      f.active = false;
      f.t.setVisible(false);
    }
    this.bannerUntil = 0;
    // premio subito (anche se si chiude la pagina durante la festa); il save azzera la percentuale.
    // A tempo scaduto la parete si chiude lo stesso, ma con premio 0 (progression non dà XP)
    const secLeft = this.timedOut ? 0 : Math.ceil(this.timeLeft / 1000);
    const bonus = this.timedOut ? 0 : Math.round(secLeft * SPRITZ.timeBonusPerSec);
    const total = this.timedOut ? 0 : this.reward + bonus;
    if (total > 0) economy.add(total);
    events.emit('spritz:done', { reward: total });

    const won = total > 0;
    if (won) playLevelUp();
    else [523, 659, 784].forEach((f, i) => tone({ type: 'square', from: f, dur: 0.1, vol: 0.12, delay: i * 0.08 }));
    if (won) {
      // fanfara: accordo lungo sotto l'arpeggio
      tone({ type: 'triangle', from: 262, to: 523, dur: 0.6, vol: 0.2, delay: 0.1 });
      [1047, 1319, 1568, 2093].forEach((f, i) => tone({ type: 'square', from: f, dur: 0.12, vol: 0.1, delay: 0.5 + i * 0.09 }));
    }
    shake(this, 3, 450);
    this.flashScreen(won ? 3 : 1);
    // lampo bianco a scatti di tutta la parete
    this.coatImg.setTintFill(col(C.white));
    this.time.delayedCall(70, () => this.coatImg.clearTint());
    this.time.delayedCall(140, () => this.coatImg.setTintFill(col(C.white)));
    this.time.delayedCall(210, () => this.coatImg.clearTint());

    const cx = W / 2;
    const party = this.partyObjs;
    const top = 60;
    const g = this.add.graphics().setDepth(D.party);
    const bigA = pixelText(this, cx, top + 20, '100%!', C.lime).setOrigin(0.5).setScale(5).setDepth(D.party + 1);
    const bigB = pixelText(this, cx, top + 20, '100%!', C.yellow).setOrigin(0.5).setScale(4).setDepth(D.party + 1).setVisible(false);
    this.time.delayedCall(70, () => bigA.setScale(4));
    this.time.addEvent({
      delay: 150,
      loop: true,
      callback: () => {
        if (!this.hudShown) return;
        bigA.setVisible(!bigA.visible);
        bigB.setVisible(!bigA.visible);
      },
    });
    party.push(g, bigA, bigB);

    // righe impilate che entrano una alla volta con un "pop" e un bip che sale
    const lines: { text: string; color: number; coin?: boolean }[] = [
      { text: 'GALLERIA', color: C.white },
      { text: 'RIVESTITA!', color: C.white },
    ];
    if (won) {
      lines.push({ text: `+${this.reward}`, color: C.yellow, coin: true });
      if (bonus > 0) lines.push({ text: `BONUS TEMPO +${bonus}`, color: C.orange });
      lines.push({ text: '+XP BONUS!', color: C.cyan });
    } else {
      lines.push({ text: 'TEMPO SCADUTO', color: C.silver }, { text: 'NIENTE PREMIO', color: C.red });
    }
    // pannello alto quanto le righe, con lo spazio per "TOCCA PER CONTINUARE"
    const tapY = top + 38 + lines.length * 11 + 4;
    drawPanel(g, 12, top, W - 24, tapY + 14 - top, { fill: C.navy, highlight: C.blue, shadow: C.black });
    let coinX = cx;
    let coinY = top + 60;
    lines.forEach((l, k) => {
      const y = top + 38 + k * 11;
      const t = pixelText(this, l.coin ? cx + 6 : cx, y, l.text, l.color).setOrigin(0.5, 0).setDepth(D.party + 1).setVisible(false);
      party.push(t);
      let coin: Phaser.GameObjects.Image | null = null;
      if (l.coin) {
        coinX = Math.round(cx + 6 - t.width / 2 - 10);
        coinY = y + 1;
        coin = this.add.image(coinX, coinY, 'ui-coin').setOrigin(0).setDepth(D.party + 1).setVisible(false);
        party.push(coin);
      }
      this.time.delayedCall(260 + k * 200, () => {
        if (!this.hudShown) return;
        t.setVisible(true).setScale(2);
        coin?.setVisible(true);
        this.time.delayedCall(70, () => t.setScale(1));
        tone({ type: 'square', from: 660 * Math.pow(2, (k * 2) / 12), dur: 0.06, vol: 0.1 });
      });
    });

    // pioggia di monete dalla parete al premio
    const now = this.time.now;
    if (won) {
      for (let i = 0; i < SPRITZ.celebrateCoins; i++) {
        const x0 = Phaser.Math.Between(10, W - 10);
        const y0 = Phaser.Math.Between(SPRITZ.wallTop + 4, SPRITZ.deckY - 10);
        const img = acquireImage(this, x0, y0, 'ui-coin').setDepth(D.party + 2).setVisible(false);
        this.coins.push({ img, start: now + 650 + i * SPRITZ.coinStaggerMs, x0, y0, x1: coinX + 4, y1: coinY + 3, small: false });
      }
    }
    // fuochi d'artificio di cemento e coriandoli, con il "bum"
    this.time.addEvent({
      delay: SPRITZ.fireworkEveryMs,
      repeat: SPRITZ.fireworks - 1,
      callback: () => {
        if (!this.hudShown) return;
        const x = Phaser.Math.Between(16, W - 16);
        const y = Phaser.Math.Between(SPRITZ.wallTop + 6, SPRITZ.deckY - 20);
        const cement = Math.random() < 0.35;
        spawnParticles(this, x, y, {
          count: 14,
          colors: cement ? CEMENT : CONFETTI,
          speed: 3,
          gravity: 0.09,
          lifeMs: 800,
          depth: D.party + 3,
        });
        popFrames(this, x, y, SPLAT_FRAMES, SPRITZ.splatFrameMs, { depth: D.party - 1 }).setScale(2);
        noise({ dur: 0.18, vol: 0.08, freq: 1800 + Math.random() * 800, freqTo: 120 });
        tone({ type: 'triangle', from: 110 + Math.random() * 60, to: 50, dur: 0.15, vol: 0.12 });
      },
    });
    this.time.delayedCall(SPRITZ.celebrateMinMs, () => {
      if (this.exiting) return;
      const t = pixelText(this, cx, tapY, 'TOCCA PER CONTINUARE', C.silver).setOrigin(0.5, 0).setDepth(D.party + 1);
      party.push(t);
      this.time.addEvent({ delay: 400, loop: true, callback: () => this.hudShown && t.setVisible(!t.visible) });
    });
    this.time.delayedCall(SPRITZ.celebrateMs, () => this.exit());
  }

  /** Monete in volo: a scatti su una curva, scintilla bianca ogni 4 passi; le monetine delle zone fanno sobbalzare il premio. */
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
        if (c.small) this.prizeBumpUntil = now + 100;
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
