import Phaser from 'phaser';
import { MENU, MOOD, SCREEN } from '../config/balance';
import { C, col, hex, type ColorIndex } from '../config/palette';
import { unlockAudio } from '../audio/sfx';
import { drawSiteBackdrop } from '../entities/Room';
import { pixelText } from '../gfx/pixelFont';
import { ArcadeButton, drawPanel } from '../gfx/ui';

/**
 * Menu iniziale: titolo "SPLAK TONY" a lettere che saltano e cambiano colore
 * a scatti, Tony seduto su un'altalena che oscilla con rotazione quantizzata,
 * pulsanti GIOCA (→ Game, prova fullscreen + verticale) e IMPOSTAZIONI.
 */

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
    this.buildTitle();
    this.buildSwing();
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
    const ay = 74;
    const L = MENU.swingRope;

    // trave fissa con due ganci
    const beam = this.add.graphics();
    drawPanel(beam, ax - 34, ay - 5, 68, 6, { fill: C.plum, highlight: C.red, shadow: C.black });

    const swing = this.add.container(ax, ay);
    const g = this.add.graphics();
    // corde
    g.fillStyle(col(C.silver));
    g.fillRect(-12, 0, 1, L);
    g.fillRect(11, 0, 1, L);
    swing.add(g);

    // gambe che penzolano (sotto il sedile)
    const legs: Phaser.GameObjects.Image[] = [];
    for (const side of [-1, 1]) {
      const lx = side * 4;
      swing.add(this.add.image(lx, L - 2, 'tony-leg-upper').setOrigin(0.5, 0));
      const lower = this.add.image(lx, L + 8, 'tony-leg-lower').setOrigin(0.5, 0);
      legs.push(lower);
      swing.add(lower);
    }

    // sedile
    const seat = this.add.graphics();
    drawPanel(seat, -16, L, 32, 4, { fill: C.red, highlight: C.orange, shadow: C.black });
    swing.add(seat);

    // busto e testa
    swing.add(this.add.image(0, L, 'tony-torso').setOrigin(0.5, 1));
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

    new ArcadeButton(this, cx - 48, 248, {
      w: 96,
      h: 18,
      fill: C.blue,
      content: pixelText(this, 0, 0, 'IMPOSTAZIONI', C.white).setOrigin(0.5),
      onClick: () => this.scene.launch('Settings', { from: 'Menu' }),
    });
  }

  private startGame(): void {
    unlockAudio();
    goFullscreenPortrait();
    this.scene.stop('Settings');
    this.scene.start('Game');
  }
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
