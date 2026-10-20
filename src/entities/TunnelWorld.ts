import Phaser from 'phaser';
import { ROOM_INNER, SCREEN } from '../config/balance';
import { C, col } from '../config/palette';

/**
 * Mondo 2: dentro la galleria (solo grafica; la fisica è buildRoomBodies).
 *
 * STUB: sostituito da feat/mondo2-grafica.
 * Per ora: fondo scuro a tutto schermo e pavimento grigio (y 292..320).
 */
export function buildTunnelWorld(scene: Phaser.Scene): void {
  const { width: W, height: H } = SCREEN;
  scene.add.rectangle(0, 0, W, H, col(C.black)).setOrigin(0).setDepth(0);
  scene.add.rectangle(0, 0, W, ROOM_INNER.bottom, col(C.charcoal)).setOrigin(0).setDepth(0);
  scene.add.rectangle(0, ROOM_INNER.bottom, W, H - ROOM_INNER.bottom, col(C.slate)).setOrigin(0).setDepth(0);
}
