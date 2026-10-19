import Phaser from 'phaser';
import { C } from '../config/palette';
import { setMuted } from '../audio/sfx';
import { ensurePixelFont } from '../gfx/pixelFont';
import { registerSprites } from '../gfx/sprites';
import { initEconomy } from '../systems/economy';
import { events } from '../systems/events';
import { initProgression } from '../systems/progression';
import { initSave } from '../systems/save';
import { initLocalSettings } from './Settings';

/** Genera texture e font, inizializza i sistemi globali e avvia il gioco. */
export class Boot extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    registerSprites(this);
    for (const c of [C.white, C.yellow, C.orange, C.red, C.silver, C.lime]) ensurePixelFont(this, c);

    const save = initSave();
    initEconomy();
    initProgression();
    setMuted(save.settings.muted);
    events.on('settings:changed', (s) => setMuted(s.muted));
    events.emit('settings:changed', { ...save.settings });
    initLocalSettings();

    this.scene.start('Menu');
  }
}
