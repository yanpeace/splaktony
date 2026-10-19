import Phaser from 'phaser';
import { COMBO, DAILY, PROGRESSION, SCREEN } from '../config/balance';
import { C, col, type ColorIndex } from '../config/palette';
import { playBuy, playLevelUp } from '../audio/sfx';
import { spawnParticles } from '../gfx/effects';
import { ensurePixelFont, pixelText, setPixelText } from '../gfx/pixelFont';
import { ArcadeButton, drawPanel } from '../gfx/ui';
import { Subscriptions } from '../systems/events';
import {
  getCombo,
  getDailyGoals,
  getLevel,
  getXp,
  goalLabel,
  goalProgressText,
  onProgress,
  xpForLevel,
  type DailyGoal,
} from '../systems/progression';

/** Impaginazione (pixel interi) della HUD di progressione. */
const XP_BAR = { x: 3, y: 18, w: 174, h: 3 } as const;
const LV_POS = { x: 4, y: 25 } as const;
const OBJ_BTN = { x: 156, y: 25, w: 21, h: 12 } as const;
const COMBO_POS = { y: 26, barY: 36, barW: 40 } as const;
const PANEL = { x: 6, y: 40, w: 168, rowH: 22, top: 14 } as const;
const TOAST_Y = 64;
const LEVEL_UP_Y = 112;

/**
 * HUD della progressione (feature E): barra XP sotto i riquadri in alto,
 * livello, combo, "LEVEL UP!", toast degli obiettivi e pannello obiettivi.
 * Scena sovrapposta sopra UI; lo stato lo legge da systems/progression.
 */
export class ProgressHUD extends Phaser.Scene {
  private subs = new Subscriptions();
  private xpG!: Phaser.GameObjects.Graphics;
  private lvText!: Phaser.GameObjects.BitmapText;
  private comboText!: Phaser.GameObjects.BitmapText;
  private comboG!: Phaser.GameObjects.Graphics;
  private objLabel!: Phaser.GameObjects.BitmapText;
  private panel: Phaser.GameObjects.Container | null = null;
  private lastXpFill = -1;
  private lastLevel = -1;
  private lastMult = 1;
  private toastQueue: DailyGoal[] = [];
  private toastBusy = false;

  constructor() {
    super('ProgressHUD');
  }

  create(): void {
    this.lastXpFill = -1;
    this.lastLevel = -1;
    this.lastMult = 1;
    this.toastQueue = [];
    this.toastBusy = false;
    this.panel = null;

    this.xpG = this.add.graphics();
    this.lvText = pixelText(this, LV_POS.x, LV_POS.y, 'LV 1', C.yellow);

    this.comboG = this.add.graphics();
    this.comboText = pixelText(this, SCREEN.width / 2, COMBO_POS.y, '', C.yellow).setOrigin(0.5, 0).setVisible(false);

    this.objLabel = pixelText(this, 0, 0, 'OBJ', C.white).setOrigin(0.5, 0.5);
    new ArcadeButton(this, OBJ_BTN.x, OBJ_BTN.y, {
      w: OBJ_BTN.w,
      h: OBJ_BTN.h,
      content: this.objLabel,
      onClick: () => this.togglePanel(),
    }).setDepth(20);
    this.refreshObjLabel();

    this.subs.on('level:up', (e) => this.showLevelUp(e.level));
    this.subs.add(
      onProgress((n) => {
        if (n.type === 'goal') this.queueToast(n.goal);
        this.refreshObjLabel();
        if (this.panel) this.buildPanel();
      }),
    );

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.subs.clear());
    this.drawXp();
  }

  update(): void {
    this.drawXp();
    this.drawCombo();
  }

  // ---------------------------------------------------------------- XP

  private drawXp(): void {
    const level = getLevel();
    const inner = XP_BAR.w - 2;
    const fill = Math.min(inner, Math.floor((inner * getXp()) / xpForLevel(level)));
    if (fill === this.lastXpFill && level === this.lastLevel) return;
    this.lastXpFill = fill;
    if (level !== this.lastLevel) {
      this.lastLevel = level;
      setPixelText(this.lvText, `LV ${level}`);
    }
    const g = this.xpG;
    g.clear();
    g.fillStyle(col(C.black));
    g.fillRect(XP_BAR.x, XP_BAR.y, XP_BAR.w, XP_BAR.h);
    g.fillStyle(col(C.charcoal));
    g.fillRect(XP_BAR.x + 1, XP_BAR.y + 1, inner, XP_BAR.h - 2);
    if (fill > 0) {
      g.fillStyle(col(C.lime));
      g.fillRect(XP_BAR.x + 1, XP_BAR.y + 1, fill, XP_BAR.h - 2);
    }
  }

  // ---------------------------------------------------------------- combo

  private drawCombo(): void {
    const c = getCombo();
    this.comboG.clear();
    if (c.mult <= 1) {
      this.comboText.setVisible(false);
      this.lastMult = 1;
      return;
    }
    const color: ColorIndex = c.mult >= 5 ? C.red : c.mult >= 3 ? C.orange : C.yellow;
    if (c.mult !== this.lastMult) {
      // nuovo moltiplicatore: testo ricreato nel colore giusto + saltello di 1px
      this.lastMult = c.mult;
      this.comboText.setFont(ensurePixelFont(this, color));
      setPixelText(this.comboText, `COMBO *${c.mult}`);
      this.comboText.y = COMBO_POS.y - 1;
      this.time.delayedCall(80, () => (this.comboText.y = COMBO_POS.y));
    }
    // ultimi 300 ms: lampeggio
    const blinkOff = c.remainingMs < 300 && Math.floor(c.remainingMs / 60) % 2 === 1;
    this.comboText.setVisible(!blinkOff);

    const w = Math.max(1, Math.ceil((COMBO_POS.barW * c.remainingMs) / COMBO.resetMs));
    const x0 = Math.round(SCREEN.width / 2 - COMBO_POS.barW / 2);
    this.comboG.fillStyle(col(C.black));
    this.comboG.fillRect(x0 - 1, COMBO_POS.barY - 1, COMBO_POS.barW + 2, 4);
    this.comboG.fillStyle(col(C.charcoal));
    this.comboG.fillRect(x0, COMBO_POS.barY, COMBO_POS.barW, 2);
    this.comboG.fillStyle(col(color));
    this.comboG.fillRect(x0, COMBO_POS.barY, w, 2);
  }

  // ---------------------------------------------------------------- level up

  private showLevelUp(level: number): void {
    playLevelUp();
    const cx = SCREEN.width / 2;
    const big = pixelText(this, cx, LEVEL_UP_Y, 'LEVEL UP!', C.yellow).setOrigin(0.5, 0.5).setScale(2).setDepth(40);
    const sub = pixelText(this, cx, LEVEL_UP_Y + 14, `LIVELLO ${level}`, C.white).setOrigin(0.5, 0).setDepth(40);
    const burst = (x: number, y: number) =>
      spawnParticles(this, x, y, { count: 14, colors: [C.yellow, C.orange, C.lime, C.white], speed: 3, lifeMs: 700 });
    burst(cx, LEVEL_UP_Y);
    this.time.delayedCall(200, () => burst(cx - 44, LEVEL_UP_Y + 4));
    this.time.delayedCall(350, () => burst(cx + 44, LEVEL_UP_Y + 4));

    // lampeggio a due colori (cambio font, niente tinte fuori palette)
    const white = ensurePixelFont(this, C.white);
    const yellow = ensurePixelFont(this, C.yellow);
    let frame = 0;
    const blink = this.time.addEvent({
      delay: 100,
      loop: true,
      callback: () => {
        frame++;
        big.setVisible(frame % 4 !== 3);
        big.setFont(frame % 2 === 0 ? white : yellow);
      },
    });
    // flash della barra XP
    this.xpG.setVisible(false);
    this.time.delayedCall(90, () => this.xpG.setVisible(true));
    this.time.delayedCall(PROGRESSION.levelUpShowMs, () => {
      blink.remove();
      big.destroy();
      sub.destroy();
    });
  }

  // ---------------------------------------------------------------- toast obiettivi

  private queueToast(goal: DailyGoal): void {
    this.toastQueue.push(goal);
    if (!this.toastBusy) this.nextToast();
  }

  private nextToast(): void {
    const goal = this.toastQueue.shift();
    if (!goal) {
      this.toastBusy = false;
      return;
    }
    this.toastBusy = true;
    playBuy();
    const cx = SCREEN.width / 2;
    const g = this.add.graphics().setDepth(30);
    drawPanel(g, cx - 40, TOAST_Y, 80, 22, { fill: C.teal, highlight: C.cyan, shadow: C.black });
    const t1 = pixelText(this, cx, TOAST_Y + 2, 'OBIETTIVO!', C.lime).setOrigin(0.5, 0).setDepth(31);
    const t2 = pixelText(this, cx - 4, TOAST_Y + 11, `+${goal.reward}`, C.yellow).setOrigin(0.5, 0).setDepth(31);
    const coin = this.add
      .image(Math.round(cx - 4 + t2.width / 2 + 2), TOAST_Y + 12, 'ui-coin')
      .setOrigin(0)
      .setDepth(31);
    spawnParticles(this, cx, TOAST_Y + 11, { count: 10, colors: [C.yellow, C.lime], speed: 2.5, depth: 32 });
    const parts = [g, t1, t2, coin];
    const blinkStart = DAILY.toastMs - 400;
    const blink = this.time.addEvent({
      delay: 80,
      startAt: 0,
      repeat: 4,
      paused: true,
      callback: () => parts.forEach((p) => p.setVisible(!p.visible)),
    });
    this.time.delayedCall(blinkStart, () => (blink.paused = false));
    this.time.delayedCall(DAILY.toastMs, () => {
      blink.remove();
      parts.forEach((p) => p.destroy());
      this.nextToast();
    });
  }

  // ---------------------------------------------------------------- pannello obiettivi

  private refreshObjLabel(): void {
    const goals = getDailyGoals();
    const allDone = goals.length > 0 && goals.every((g) => g.claimed);
    this.objLabel.setFont(ensurePixelFont(this, allDone ? C.lime : C.white));
  }

  private togglePanel(): void {
    if (this.panel) {
      this.panel.destroy();
      this.panel = null;
    } else {
      this.buildPanel();
    }
  }

  private buildPanel(): void {
    this.panel?.destroy();
    const goals = getDailyGoals();
    const h = PANEL.top + goals.length * PANEL.rowH + 2;
    const c = this.add.container(PANEL.x, PANEL.y).setDepth(10);
    const g = this.add.graphics();
    drawPanel(g, 0, 0, PANEL.w, h, { shadow: C.black });
    c.add(g);
    c.add(pixelText(this, PANEL.w / 2, 3, 'OBIETTIVI DI OGGI', C.yellow).setOrigin(0.5, 0));

    goals.forEach((goal, i) => {
      const y = PANEL.top + i * PANEL.rowH;
      g.fillStyle(col(C.slate));
      g.fillRect(3, y, PANEL.w - 6, 1);
      c.add(pixelText(this, 4, y + 2, goalLabel(goal), goal.claimed ? C.lime : C.white));
      // barra di avanzamento a pixel interi
      const bw = 60;
      const fill = Math.floor((bw * Math.min(goal.progress, goal.target)) / goal.target);
      g.fillStyle(col(C.black));
      g.fillRect(4, y + 13, bw + 2, 4);
      g.fillStyle(col(C.navy));
      g.fillRect(5, y + 14, bw, 2);
      if (fill > 0) {
        g.fillStyle(col(goal.claimed ? C.lime : C.sky));
        g.fillRect(5, y + 14, fill, 2);
      }
      c.add(pixelText(this, 69, y + 11, goalProgressText(goal), C.silver));
      if (goal.claimed) {
        c.add(pixelText(this, PANEL.w - 4, y + 11, 'OK!', C.lime).setOrigin(1, 0));
      } else {
        c.add(this.add.image(PANEL.w - 11, y + 12, 'ui-coin').setOrigin(0));
        c.add(pixelText(this, PANEL.w - 12, y + 11, `+${goal.reward}`, C.yellow).setOrigin(1, 0));
      }
    });

    // tocco sul pannello: lo chiude (e non arriva al gioco sotto)
    c.setSize(PANEL.w, h);
    c.setInteractive(new Phaser.Geom.Rectangle(0, 0, PANEL.w, h), Phaser.Geom.Rectangle.Contains);
    c.on('pointerup', () => this.togglePanel());
    this.panel = c;
  }
}
