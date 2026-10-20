import Phaser from 'phaser';
import { refreshScreen, SCREEN, SCREEN_WATCH } from '../config/balance';
import { events } from './events';

/**
 * Altezza logica dal vivo (vedi config/screen.ts).
 *
 * Rimisura il riquadro del gioco a ogni resize / rotazione / cambio del
 * visualViewport / schermo intero (con un debounce), qualche volta subito
 * dopo l'avvio e con un controllo periodico leggero. Se l'altezza intera o i
 * margini sicuri cambiano davvero: SCREEN è già aggiornato da refreshScreen(),
 * qui si ridimensiona il gioco (setGameSize) e si emette 'screen:changed'.
 * Niente cicli: se la misura non cambia non succede nulla.
 */

let schedule: () => void = () => undefined;

/** Chiede una rimisura a breve (es. dopo la richiesta di schermo intero). */
export function scheduleScreenCheck(): void {
  schedule();
}

export function watchScreen(game: Phaser.Game): void {
  let timer = 0;

  const check = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = 0;
    }
    // prima del READY il canvas ha ancora l'altezza della config: si rimisura dopo
    if (!game.isBooted || !refreshScreen()) return;
    game.scale.setGameSize(SCREEN.width, SCREEN.height);
    events.emit('screen:changed', { height: SCREEN.height, safeTop: SCREEN.safeTop, safeBottom: SCREEN.safeBottom });
  };

  schedule = () => {
    if (timer) clearTimeout(timer);
    timer = window.setTimeout(check, SCREEN_WATCH.debounceMs);
  };

  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  document.addEventListener('fullscreenchange', schedule);
  document.addEventListener('webkitfullscreenchange', schedule);
  // tornando in primo piano (app da Home) la finestra può essere cambiata
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) schedule();
  });

  game.events.once(Phaser.Core.Events.READY, () => {
    check();
    for (const ms of SCREEN_WATCH.bootChecksMs) window.setTimeout(check, ms);
    // rete di sicurezza: non tutti i browser mandano un resize quando spariscono le barre
    window.setInterval(() => {
      if (!timer && !document.hidden) check();
    }, SCREEN_WATCH.pollMs);
  });
}

/**
 * Ricostruisce una scena quando lo schermo cambia ('screen:changed').
 * Se la scena non sta girando (in pausa, addormentata) o `canNow()` dice di
 * no (passaggio in corso), la ricostruzione aspetta il primo frame utile.
 * Si chiude da sola allo shutdown della scena.
 */
export function bindRelayout(scene: Phaser.Scene, relayout: () => void, canNow: () => boolean = () => true): void {
  let pending = false;
  const tryNow = (): void => {
    if (!pending || !scene.sys.isActive() || !canNow()) return;
    pending = false;
    relayout();
  };
  const off = events.on('screen:changed', () => {
    pending = true;
    tryNow();
  });
  scene.events.on(Phaser.Scenes.Events.UPDATE, tryNow);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    off();
    scene.events.off(Phaser.Scenes.Events.UPDATE, tryNow);
  });
}
