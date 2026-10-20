import Phaser from 'phaser';
import { JUICE, ROOM_INNER, SCREEN } from '../config/balance';
import { C } from '../config/palette';
import { bindFlyingCoins } from '../gfx/juice';
import { formatCompact, measureText, pixelText, setPixelText } from '../gfx/pixelFont';
import { ArcadeButton, drawPanel } from '../gfx/ui';
import { events, Subscriptions } from '../systems/events';
import { getSave } from '../systems/save';
import type { Game } from './Game';
import { alignButtonHit } from './Shop';

/**
 * HUD sovrapposto alla scena di gioco (scena separata, non trema con lo shake).
 * Legge lo stato SOLO dagli eventi (con replay per i valori già emessi).
 */
export class UI extends Phaser.Scene {
  private subs = new Subscriptions();

  constructor() {
    super('UI');
  }

  create(): void {
    const g = this.add.graphics();

    // --- danno totale
    drawPanel(g, 3, 3, 82, 13);
    pixelText(this, 6, 5, 'DANNO', C.silver);
    const dmgText = pixelText(this, 82, 5, '0', C.white).setOrigin(1, 0);

    // --- monete
    drawPanel(g, 88, 3, 67, 13);
    const coinIcon = this.add.image(91, 6, 'ui-coin').setOrigin(0);
    const coinText = pixelText(this, 152, 5, '0', C.yellow).setOrigin(1, 0);

    // --- audio on/off
    const icon = this.add.image(0, 0, 'ui-speaker-on');
    let muted = getSave().settings.muted;
    const muteBtn = new ArcadeButton(this, 158, 3, {
      w: 19,
      h: 13,
      content: icon,
      onClick: () => events.emit('settings:changed', { muted: !muted }),
    });

    // --- arma attiva (in basso, sopra il pavimento)
    const wy = ROOM_INNER.bottom + 8;
    drawPanel(g, 3, wy, 70, 15);
    const weaponIcon = this.add.image(5, wy + 3, '__DEFAULT').setOrigin(0).setVisible(false);
    const weaponName = pixelText(this, 17, wy + 3, '', C.white);

    // --- negozio (in basso a destra): lancia la scena Shop sopra l'HUD
    const shopLabel = pixelText(this, 0, 0, 'NEGOZIO', C.white);
    shopLabel.setPosition(-Math.floor(shopLabel.width / 2), -4);
    alignButtonHit(
      new ArcadeButton(this, SCREEN.width - 3 - 60, wy, {
        w: 60,
        h: 15,
        fill: C.red,
        content: this.add.container(0, 0, [shopLabel]),
        onClick: () => {
          if (!this.scene.isActive('Shop')) this.scene.launch('Shop');
        },
      }),
    );

    // --- torna al Menu (in basso al centro, tra arma e negozio: x 78..112)
    const menuLabel = pixelText(this, 0, 0, 'MENU', C.white);
    menuLabel.setPosition(-Math.floor(menuLabel.width / 2), -4);
    alignButtonHit(
      new ArcadeButton(this, 78, wy, {
        w: 34,
        h: 15,
        content: this.add.container(0, 0, [menuLabel]),
        onClick: () => {
          for (const k of ['Shop', 'Settings', 'ProgressHUD', 'Game']) this.scene.stop(k);
          this.scene.start('Menu'); // ferma anche UI
        },
      }),
    );

    // --- minigioco SPRITZ (solo in galleria, mondi 2 e 3): sopra il negozio, con la percentuale
    const game = this.scene.get('Game') as Game | null;
    const world = game?.world ?? 1;
    if (world !== 1) {
      const spritzLabel = pixelText(this, 0, 0, '', C.white);
      const setSpritzLabel = (percent: number) => {
        setPixelText(spritzLabel, `SPRITZ ${Math.min(99, Math.floor(percent))}%`);
        spritzLabel.setPosition(-Math.floor(spritzLabel.width / 2), -4);
      };
      setSpritzLabel(getSave().spritz.percent);
      const spritzBtn = alignButtonHit(
        new ArcadeButton(this, SCREEN.width - 3 - SPRITZ_BTN_W, wy - 17, {
          w: SPRITZ_BTN_W,
          h: 15,
          fill: C.orange,
          content: this.add.container(0, 0, [spritzLabel]),
          onClick: () => {
            if (this.scene.isActive('Spritz')) return;
            this.scene.stop('Shop');
            this.scene.stop('Settings');
            this.scene.launch('Spritz', { world });
          },
        }),
      );
      // finché non l'ha mai provato il pulsante pulsa (arancio / rosso)
      const s = getSave().spritz;
      if (s.completed === 0 && s.percent === 0) {
        const pulse = this.time.addEvent({
          delay: 500,
          loop: true,
          callback: () => spritzBtn.setFill(Math.floor(this.time.now / 500) % 2 ? C.red : C.orange),
        });
        this.subs.on('spritz:progress', () => {
          pulse.remove();
          spritzBtn.setFill(C.orange);
        });
      }
      this.subs.on('spritz:progress', (e) => setSpritzLabel(e.percent)).on('spritz:done', () => setSpritzLabel(0));
    }

    // --- suggerimento iniziale lampeggiante
    const hint = pixelText(this, SCREEN.width / 2, 250, 'TOCCA TONY!', C.yellow).setOrigin(0.5, 0);
    const hint2 = pixelText(this, SCREEN.width / 2, 261, 'TRASCINA E LANCIA', C.silver).setOrigin(0.5, 0);
    const blink = this.time.addEvent({
      delay: 400,
      loop: true,
      callback: () => hint.setVisible(!hint.visible),
    });
    const hideHint = () => {
      blink.remove();
      hint.destroy();
      hint2.destroy();
    };
    if (getSave().totalDamage > 0) hideHint();

    // --- eventi
    // monete che volano dal punto del colpo al contatore (gfx/juice): a ogni arrivo
    // "bump" di 2px del contatore e dell'icona, poi torna giù a scatti
    let bump: Phaser.Time.TimerEvent | null = null;
    const bumpCoins = () => {
      coinText.y = 3;
      coinIcon.y = 4;
      bump?.remove();
      bump = this.time.delayedCall(JUICE.coinBumpMs, () => {
        coinText.y = 4;
        coinIcon.y = 5;
        bump = this.time.delayedCall(JUICE.coinBumpMs, () => {
          coinText.y = 5;
          coinIcon.y = 6;
        });
      });
    };
    this.subs.add(bindFlyingCoins(this, { x: 94, y: 9, onArrive: bumpCoins }));
    this.subs
      .on('coins:changed', (e) => setPixelText(coinText, formatCompact(e.coins)), true)
      .on('damage:total', (e) => setPixelText(dmgText, formatCompact(e.total)), true)
      .on(
        'weapon:selected',
        (e) => {
          weaponIcon.setTexture(e.iconKey).setVisible(true);
          setPixelText(weaponName, fitName(e.name, WEAPON_NAME_MAX_PX));
        },
        true,
      )
      .on(
        'settings:changed',
        (s) => {
          muted = s.muted;
          icon.setTexture(muted ? 'ui-speaker-off' : 'ui-speaker-on');
          muteBtn.setFill(muted ? C.charcoal : C.slate);
        },
        true,
      );

    let hintShown = hint.active;
    this.subs.on('damage', () => {
      if (!hintShown) return;
      hintShown = false;
      hideHint();
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.subs.clear());
  }
}

/** larghezza del pulsante SPRITZ (entra "SPRITZ 99%") */
const SPRITZ_BTN_W = 66;

/** spazio per il nome dell'arma nel riquadro in basso (da x 17 al bordo a x 71) */
const WEAPON_NAME_MAX_PX = 54;

/**
 * Nome che entra in `maxPx`: parole intere finché ci stanno, poi un punto
 * ("FUCILE D'ASSALTO" → "FUCILE."); se non entra neanche la prima, la tronca.
 */
function fitName(name: string, maxPx: number): string {
  if (measureText(name) <= maxPx) return name;
  const words = name.split(' ');
  let out = '';
  for (const w of words) {
    const next = out ? `${out} ${w}` : w;
    if (measureText(`${next}.`) > maxPx) break;
    out = next;
  }
  if (out) return `${out}.`;
  let cut = name;
  while (cut.length > 1 && measureText(`${cut}.`) > maxPx) cut = cut.slice(0, -1);
  return `${cut}.`;
}
