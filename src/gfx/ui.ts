import Phaser from 'phaser';
import { C, col, type ColorIndex } from '../config/palette';
import { playClick } from '../audio/sfx';

/**
 * Componenti UI stile arcade: riquadri con bordo di 1px e pulsanti che si
 * "abbassano" di 1px quando premuti. Coordinate sempre intere.
 */

export interface PanelStyle {
  fill?: ColorIndex | number;
  border?: ColorIndex | number;
  /** riga di luce interna in alto (0 = nessuna) */
  highlight?: ColorIndex | number | null;
  /** ombra di 1px sotto il riquadro */
  shadow?: ColorIndex | number | null;
}

/** Disegna un riquadro con bordo 1px su un Graphics. */
export function drawPanel(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  { fill = C.charcoal, border = C.black, highlight = C.slate, shadow = null }: PanelStyle = {},
): void {
  x = Math.round(x);
  y = Math.round(y);
  if (shadow !== null) {
    g.fillStyle(col(shadow));
    g.fillRect(x + 1, y + h, w - 1, 1);
  }
  g.fillStyle(col(border));
  g.fillRect(x, y, w, h);
  g.fillStyle(col(fill));
  g.fillRect(x + 1, y + 1, w - 2, h - 2);
  if (highlight !== null) {
    g.fillStyle(col(highlight));
    g.fillRect(x + 1, y + 1, w - 2, 1);
  }
}

export interface ButtonOpts {
  w: number;
  h: number;
  fill?: ColorIndex | number;
  /** contenuto (icona/testo) già creato, centrato nel pulsante */
  content?: Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform;
  onClick?: () => void;
  sound?: boolean;
}

/**
 * Pulsante arcade. Premuto: si abbassa di 1px e perde l'ombra.
 * Ritorna un Container; il contenuto si sposta insieme al pulsante.
 */
export class ArcadeButton extends Phaser.GameObjects.Container {
  private g: Phaser.GameObjects.Graphics;
  private pressed = false;
  private opts: Required<Omit<ButtonOpts, 'content' | 'onClick'>> & Pick<ButtonOpts, 'content' | 'onClick'>;

  constructor(scene: Phaser.Scene, x: number, y: number, opts: ButtonOpts) {
    super(scene, Math.round(x), Math.round(y));
    this.opts = { fill: C.slate, sound: true, ...opts };
    this.g = scene.add.graphics();
    this.add(this.g);
    if (opts.content) {
      opts.content.setPosition(Math.floor(opts.w / 2), Math.floor((opts.h - 1) / 2));
      this.add(opts.content);
    }
    this.setSize(opts.w, opts.h);
    // Phaser somma displayOrigin (metà Container) al punto locale: l'area parte da (w/2, h/2)
    this.setInteractive(
      new Phaser.Geom.Rectangle(opts.w / 2, opts.h / 2, opts.w, opts.h + 1),
      Phaser.Geom.Rectangle.Contains,
    );
    this.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      this.setPressed(true);
    });
    this.on('pointerup', () => {
      if (!this.pressed) return;
      this.setPressed(false);
      if (this.opts.sound) playClick();
      this.opts.onClick?.();
    });
    this.on('pointerout', () => this.setPressed(false));
    this.redraw();
    scene.add.existing(this);
  }

  setFill(fill: ColorIndex | number): this {
    this.opts.fill = fill;
    this.redraw();
    return this;
  }

  private setPressed(v: boolean): void {
    if (this.pressed === v) return;
    this.pressed = v;
    if (this.opts.content) this.opts.content.y += v ? 1 : -1;
    this.redraw();
  }

  private redraw(): void {
    const { w, h, fill } = this.opts;
    this.g.clear();
    if (this.pressed) {
      drawPanel(this.g, 0, 1, w, h - 1, { fill, highlight: null });
    } else {
      drawPanel(this.g, 0, 0, w, h, { fill, highlight: C.silver, shadow: C.black });
    }
  }
}
