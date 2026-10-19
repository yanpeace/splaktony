import Phaser from 'phaser';
import { ROOM_INNER, SCREEN } from '../config/balance';
import { C } from '../config/palette';
import { formatCompact, pixelText, setPixelText } from '../gfx/pixelFont';
import { ArcadeButton, drawPanel } from '../gfx/ui';
import { events, Subscriptions } from '../systems/events';
import { getSave } from '../systems/save';

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
    this.add.image(91, 6, 'ui-coin').setOrigin(0);
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
    let bump: Phaser.Time.TimerEvent | null = null;
    this.subs
      .on(
        'coins:changed',
        (e) => {
          setPixelText(coinText, formatCompact(e.coins));
          if (e.delta <= 0) return;
          // "saltello" di 1px per 2 frame quando arrivano monete
          coinText.y = 4;
          bump?.remove();
          bump = this.time.delayedCall(70, () => (coinText.y = 5));
        },
        true,
      )
      .on('damage:total', (e) => setPixelText(dmgText, formatCompact(e.total)), true)
      .on(
        'weapon:selected',
        (e) => {
          weaponIcon.setTexture(e.iconKey).setVisible(true);
          setPixelText(weaponName, e.name);
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
