import Phaser from 'phaser';
import { PHYSICS, SCREEN } from './config/balance';
import { hex, C } from './config/palette';
import { Boot } from './scenes/Boot';
import { Game } from './scenes/Game';
import { Shop } from './scenes/Shop';
import { UI } from './scenes/UI';
import { ProgressHUD } from './scenes/ProgressHUD';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: SCREEN.width,
  height: SCREEN.height,
  backgroundColor: hex(C.black),
  pixelArt: true,
  roundPixels: true,
  antialias: false,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  input: { activePointers: 3 },
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
  scene: [Boot, Game, UI, ProgressHUD, Shop],
});

// utile per il debug da console: window.game
(window as unknown as { game: Phaser.Game }).game = game;
