import Phaser from 'phaser';
import { MENU, MOOD, SCREEN, WORLDS } from '../config/balance';
import { C, col, hex, type ColorIndex } from '../config/palette';
import { playError, unlockAudio } from '../audio/sfx';
import { drawSiteBackdrop } from '../entities/Room';
import { pixelText } from '../gfx/pixelFont';
import { makeSprite, type SpriteData } from '../gfx/pixelSprite';
import { ArcadeButton, drawPanel } from '../gfx/ui';
import { events } from '../systems/events';
import { getLevel } from '../systems/progression';
import { getSave } from '../systems/save';
import type { GameData, WorldId } from './Game';

/**
 * Menu iniziale: titolo "SPLAK TONY" a lettere che saltano e cambiano colore
 * a scatti, Tony seduto su un'altalena che oscilla con rotazione quantizzata,
 * pulsanti GIOCA (→ Game, prova fullscreen + verticale), scelta del mondo
 * (MONDO 1 / 2 / 3, il 2 si sblocca a WORLDS.unlockLevel, il 3 a
 * WORLDS.unlockLevel3) e IMPOSTAZIONI. GIOCA col mondo 2 o 3 scelto: Game parte
 * nel mondo 1 con l'intro (l'auto entra nella galleria e porta al mondo scelto).
 */

/** lucchetto 7x8 per i mondi bloccati */
const LOCK: SpriteData = [
  '..000..',
  '.0ddd0.',
  '.0d0d0.',
  '0000000',
  '0443440',
  '0440440',
  '0444440',
  '0000000',
];

// glifi 5x7 del font (stessi di gfx/pixelFont.ts) per le sole lettere del titolo
const TITLE_GLYPHS: Record<string, string> = {
  S: '.#### #.... #.... .###. ....# ....# ####.',
  P: '####. #...# #...# ####. #.... #.... #....',
  L: '#.... #.... #.... #.... #.... #.... #####',
  A: '.###. #...# #...# ##### #...# #...# #...#',
  K: '#...# #..#. #.#.. ##... #.#.. #..#. #...#',
  T: '##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..',
  O: '.###. #...# #...# #...# #...# #...# .###.',
  N: '#...# #...# ##..# #.#.# #..## #...# #...#',
  Y: '#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..',
};

/** combinazioni [colore, ombra] del titolo, cicliche */
const TITLE_COLORS: readonly (readonly [ColorIndex, ColorIndex])[] = [
  [C.yellow, C.orange],
  [C.orange, C.red],
  [C.white, C.silver],
  [C.cyan, C.sky],
];

const GW = 5;
const GH = 7;

/** Texture di una lettera del titolo: glifo ingrandito, ombra a righe, contorno 1px. */
function titleLetterKey(scene: Phaser.Scene, ch: string, variant: number): string {
  const key = `menu-title-${ch}-${variant}`;
  if (scene.textures.exists(key)) return key;
  const s = MENU.titleScale;
  const [main, shade] = TITLE_COLORS[variant];
  const rows = TITLE_GLYPHS[ch].split(' ');
  const w = GW * s + 2;
  const h = GH * s + 2;
  const filled = (x: number, y: number) => {
    const gx = Math.floor((x - 1) / s);
    const gy = Math.floor((y - 1) / s);
    if (x < 1 || y < 1 || gx >= GW || gy >= GH) return false;
    return rows[gy][gx] === '#';
  };
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) throw new Error(`menu: impossibile creare ${key}`);
  const ctx = tex.getContext();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (filled(x, y)) {
        // ultima riga di ogni pixel ingrandito in ombra: effetto "a strisce"
        ctx.fillStyle = hex((y - 1) % s === s - 1 ? shade : main);
        ctx.fillRect(x, y, 1, 1);
        continue;
      }
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) {
        for (let dx = -1; dx <= 1 && !near; dx++) near = filled(x + dx, y + dy);
      }
      if (near) {
        ctx.fillStyle = hex(C.black);
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  tex.refresh();
  return key;
}

interface TitleWord {
  letters: Phaser.GameObjects.Image[];
  chars: string[];
  baseY: number;
  colorOffset: number;
}

export class Menu extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    this.input.enabled = true;
    this.input.once(Phaser.Input.Events.POINTER_DOWN, () => unlockAudio());

    this.buildBackground();
    // l'altalena prima del titolo: le corde passano dietro la scritta
    this.buildSwing();
    this.buildTitle();
    this.buildButtons();
  }

  // ---------------------------------------------------------- sfondo

  private buildBackground(): void {
    // stesso cantiere del gioco, tutto a depth 0 (titolo, altalena e pulsanti sopra)
    drawSiteBackdrop(this, { flat: true });
    pixelText(this, SCREEN.width / 2, SCREEN.height - 15, 'V0.1', C.plum, C.black).setOrigin(0.5, 0);
  }

  // ---------------------------------------------------------- titolo

  private buildTitle(): void {
    const s = MENU.titleScale;
    const advance = GW * s + 2;
    const makeWord = (text: string, y: number, colorOffset: number): TitleWord => {
      const chars = [...text];
      const width = chars.length * advance;
      const x0 = Math.round((SCREEN.width - width) / 2);
      const letters = chars.map((ch, i) =>
        this.add.image(x0 + i * advance, y, titleLetterKey(this, ch, colorOffset % TITLE_COLORS.length)).setOrigin(0),
      );
      return { letters, chars, baseY: y, colorOffset };
    };
    const words = [makeWord('SPLAK', 12, 0), makeWord('TONY', 12 + GH * s + 5, 2)];
    const total = words.reduce((n, w) => n + w.letters.length, 0);

    let frame = 0;
    this.time.addEvent({
      delay: MENU.titleFrameMs,
      loop: true,
      callback: () => {
        frame++;
        // un'onda che scorre su tutte le lettere (con una pausa di 3 frame)
        const active = frame % (total + 3);
        const variantStep = Math.floor(frame / MENU.titleColorEvery);
        let idx = 0;
        for (const w of words) {
          const variant = (variantStep + w.colorOffset) % TITLE_COLORS.length;
          w.letters.forEach((img, i) => {
            const d = Math.abs(idx - active);
            const jump = d === 0 ? MENU.titleJumpPx : d === 1 ? 1 : 0;
            img.y = w.baseY - jump;
            img.setTexture(titleLetterKey(this, w.chars[i], variant));
            idx++;
          });
        }
      },
    });
  }

  // ---------------------------------------------------------- Tony sull'altalena

  private buildSwing(): void {
    const ax = SCREEN.width / 2;
    const ay = MENU.swingPivotY;
    const L = MENU.swingRope;

    // appesa a qualcosa fuori schermo: le corde di rame salgono ed escono dal bordo alto
    const swing = this.add.container(ax, ay);
    const g = this.add.graphics();
    for (const rx of [-12, 10]) drawCopperRope(g, rx, 0, L);
    swing.add(g);

    // sedile
    const seat = this.add.graphics();
    drawPanel(seat, -16, L, 32, 4, { fill: C.red, highlight: C.orange, shadow: C.black });
    swing.add(seat);

    // busto dietro, poi le gambe che penzolano DAVANTI al sedile
    swing.add(this.add.image(0, L, 'tony-torso').setOrigin(0.5, 1));
    const legs: Phaser.GameObjects.Image[] = [];
    for (const side of [-1, 1]) {
      const lx = side * 4;
      swing.add(this.add.image(lx, L - 2, 'tony-leg-upper').setOrigin(0.5, 0));
      const lower = this.add.image(lx, L + 8, 'tony-leg-lower').setOrigin(0.5, 0);
      legs.push(lower);
      swing.add(lower);
    }
    const head = this.add.image(0, L - 17, 'tony-head').setOrigin(0.5, 1);
    swing.add(head);

    // braccia alzate che stringono le corde: capovolte, così la manica sta alla
    // spalla (in basso) e il guanto in alto sulla corda
    for (const side of [-1, 1]) {
      const upper = this.add.image(side * 9, L - 13, 'tony-arm-upper').setOrigin(0.5, 1).setFlipY(true);
      upper.angle = side * 10;
      const lower = this.add.image(side * 11, L - 22, 'tony-arm-lower');
      lower.setOrigin(0.5, 1).setFlipY(true);
      swing.add([upper, lower]);
    }

    // oscillazione a scatti: seno campionato e quantizzato a passi di swingStepDeg
    let frame = 0;
    const apply = () => {
      const phase = (frame / MENU.swingPeriodFrames) * Math.PI * 2;
      const step = Math.round(Math.sin(phase) * MENU.swingSteps);
      swing.angle = step * MENU.swingStepDeg;
      // gambe: scalciano in avanti quando l'altalena sale da un lato
      const kick = Math.cos(phase) > 0 ? -1 : 1;
      legs.forEach((leg) => (leg.angle = kick * 16));
    };
    apply();
    this.time.addEvent({
      delay: MENU.swingFrameMs,
      loop: true,
      callback: () => {
        frame++;
        apply();
      },
    });

    // battito di ciglia
    this.time.addEvent({
      delay: MOOD.blinkEveryMs,
      loop: true,
      callback: () => {
        head.setTexture('tony-head-blink');
        this.time.delayedCall(MOOD.blinkMs, () => head.setTexture('tony-head'));
      },
    });

    // tocco su Tony: faccia buffa per un attimo
    const hit = this.add.zone(ax - 16, ay + L - 34, 32, 54).setOrigin(0).setInteractive();
    hit.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      head.setTexture('tony-head-hurt');
      this.time.delayedCall(350, () => head.setTexture('tony-head'));
    });
  }

  // ---------------------------------------------------------- pulsanti

  private buildButtons(): void {
    const cx = SCREEN.width / 2;
    const play = pixelText(this, 0, 0, 'GIOCA', C.white).setOrigin(0.5);
    new ArcadeButton(this, cx - 48, 216, {
      w: 96,
      h: 24,
      fill: C.green,
      content: play,
      onClick: () => this.startGame(),
    });
    // "GIOCA" lampeggia a 2 frame
    this.time.addEvent({
      delay: 450,
      loop: true,
      callback: () => play.setVisible(!play.visible),
    });

    this.buildWorldButtons(cx, 245);

    new ArcadeButton(this, cx - 48, 266, {
      w: 96,
      h: 18,
      fill: C.blue,
      content: pixelText(this, 0, 0, 'IMPOSTAZIONI', C.white).setOrigin(0.5),
      onClick: () => this.scene.launch('Settings', { from: 'Menu' }),
    });
  }

  /** MONDO 1 / 2 / 3 affiancati sotto GIOCA (3 x 52 px + 2 spazi = 160); quello scelto è arancione. */
  private buildWorldButtons(cx: number, y: number): void {
    const w = 52;
    const h = 15;
    const gap = 2;
    const ids = [1, 2, 3] as const;
    const x0 = cx - Math.floor((ids.length * w + (ids.length - 1) * gap) / 2);
    const buttons = new Map<WorldId, ArcadeButton>();
    const refresh = () => {
      const sel = selectedWorld();
      for (const [id, b] of buttons) b.setFill(!isWorldUnlocked(id) ? C.charcoal : id === sel ? C.orange : C.slate);
    };
    ids.forEach((id, k) => {
      const locked = !isWorldUnlocked(id);
      const parts: Phaser.GameObjects.GameObject[] = [];
      if (locked) {
        // lucchetto + "LV n"
        const lv = pixelText(this, 0, 0, `LV ${unlockLevelOf(id)}`, C.silver);
        const total = 7 + 2 + lv.width;
        const x0 = -Math.floor(total / 2);
        parts.push(this.add.image(x0, -4, makeSprite(this, 'ui-lock', LOCK)).setOrigin(0));
        parts.push(lv.setPosition(x0 + 9, -4));
      } else {
        const t = pixelText(this, 0, 0, `MONDO ${id}`, C.white);
        parts.push(t.setPosition(-Math.floor(t.width / 2), -4));
      }
      const b = new ArcadeButton(this, x0 + k * (w + gap), y, {
        w,
        h,
        content: this.add.container(0, 0, parts),
        sound: !locked,
        onClick: () => {
          if (locked) {
            playError();
            return;
          }
          if (selectedWorld() !== id) events.emit('world:changed', { world: id });
          refresh();
        },
      });
      buttons.set(id, b);
    });
    refresh();
  }

  private startGame(): void {
    unlockAudio();
    goFullscreenPortrait();
    this.scene.stop('Settings');
    // mondo 2 / 3: si parte nel cantiere e l'auto ci porta dentro la galleria
    const sel = selectedWorld();
    const data: GameData = sel === 1 ? { world: 1 } : { world: 1, intro: true, introTo: sel };
    this.scene.start('Game', data);
  }
}

/** livello giocatore che sblocca un mondo (il 1 è sempre aperto) */
function unlockLevelOf(id: WorldId): number {
  return id === 3 ? WORLDS.unlockLevel3 : id === 2 ? WORLDS.unlockLevel : 0;
}

function isWorldUnlocked(id: WorldId): boolean {
  return getLevel() >= unlockLevelOf(id);
}

/** mondo scelto (salvato); se è bloccato vale il più alto sbloccato sotto di lui */
function selectedWorld(): WorldId {
  const w = getSave().world;
  if (w === 3 && isWorldUnlocked(3)) return 3;
  if (w >= 2 && isWorldUnlocked(2)) return 2;
  return 1;
}

/** Schermo intero + verticale (se supportati, errori ignorati). */
function goFullscreenPortrait(): void {
  try {
    const el = document.documentElement;
    if (!document.fullscreenElement && typeof el.requestFullscreen === 'function') {
      el.requestFullscreen()
        .then(lockPortrait)
        .catch(() => undefined);
    } else {
      lockPortrait();
    }
  } catch {
    /* non supportato */
  }
}

function lockPortrait(): void {
  try {
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    o?.lock?.('portrait')?.catch(() => undefined);
  } catch {
    /* non supportato */
  }
}

/** Corda di rame 2px intrecciata: rame chiaro/scuro con riflessi che girano a spirale. */
function drawCopperRope(g: Phaser.GameObjects.Graphics, x: number, y0: number, len: number): void {
  g.fillStyle(col(C.orange));
  g.fillRect(x, y0, 1, len);
  g.fillStyle(col(C.red));
  g.fillRect(x + 1, y0, 1, len);
  // trefoli: ogni 4px un riflesso giallo che passa da una fibra all'altra
  g.fillStyle(col(C.yellow));
  for (let y = y0; y < y0 + len; y += 4) g.fillRect(x + ((y >> 2) & 1), y, 1, 1);
  g.fillStyle(col(C.plum));
  for (let y = y0 + 2; y < y0 + len; y += 4) g.fillRect(x + 1 - ((y >> 2) & 1), y, 1, 1);
}
