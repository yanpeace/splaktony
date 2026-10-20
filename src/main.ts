import Phaser from 'phaser';
import { PHYSICS, SCREEN } from './config/balance';
import { hex, C } from './config/palette';
import { Boot } from './scenes/Boot';
import { Game } from './scenes/Game';
import { Shop } from './scenes/Shop';
import { Menu } from './scenes/Menu';
import { Settings, registerServiceWorker } from './scenes/Settings';
import { UI } from './scenes/UI';
import { ProgressHUD } from './scenes/ProgressHUD';
import { Spritz } from './scenes/Spritz';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: SCREEN.width,
  height: SCREEN.height,
  backgroundColor: hex(C.black),
  pixelArt: true,
  roundPixels: true,
  antialias: false,
  // altezza logica dal rapporto dello schermo (config/screen.ts): sui telefoni
  // lunghi niente bande nere; su finestre più larghe di 9:16 FIT mette le bande ai lati
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  input: { activePointers: 3 },
  disableContextMenu: true,
  // 60 fps stabili su telefono: GPU ad alte prestazioni, niente MSAA (pixel art)
  fps: { target: 60, smoothStep: true },
  render: { powerPreference: 'high-performance', antialiasGL: false },
  physics: {
    default: 'matter',
    matter: {
      gravity: { x: 0, y: PHYSICS.gravityY },
      // la fisica avanza a passo fisso da Game.update()
      autoUpdate: false,
      positionIterations: PHYSICS.positionIterations,
      velocityIterations: PHYSICS.velocityIterations,
      constraintIterations: PHYSICS.constraintIterations,
      debug: false,
    },
  },
  scene: [Boot, Menu, Game, UI, ProgressHUD, Spritz, Shop, Settings],
});

registerServiceWorker();

/** Overlay #crt (index.html) sopra l'area reale del canvas: una riga scura per pixel logico. */
function syncCrt(): void {
  const crt = document.getElementById('crt');
  if (!crt || !game.canvas) return;
  const r = game.canvas.getBoundingClientRect();
  crt.style.left = `${r.left}px`;
  crt.style.top = `${r.top}px`;
  crt.style.width = `${r.width}px`;
  crt.style.height = `${r.height}px`;
  crt.style.backgroundSize = `100% ${r.height / SCREEN.height}px`;
}
game.events.once(Phaser.Core.Events.READY, syncCrt);
game.scale.on(Phaser.Scale.Events.RESIZE, syncCrt);
// Scale.FIT ridimensiona il canvas al frame dopo il resize della finestra
window.addEventListener('resize', () => requestAnimationFrame(syncCrt));

// utile per il debug da console: window.game
(window as unknown as { game: Phaser.Game }).game = game;
