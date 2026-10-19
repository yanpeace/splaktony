import Phaser from 'phaser';
import { ROOM, ROOM_INNER, SCREEN } from '../config/balance';
import { C, col } from '../config/palette';

/**
 * Stanza chiusa: carta da parati, muri di mattoni, soffitto e pavimento in
 * legno (grafica) + 4 corpi statici molto spessi (fisica, anti-tunneling).
 * Le etichette dei corpi sono 'room:floor', 'room:ceiling', 'room:wall'.
 */
export function buildRoom(scene: Phaser.Scene): MatterJS.BodyType[] {
  const { width: W, height: H } = SCREEN;
  const { left, right, top, bottom } = ROOM_INNER;
  const innerW = right - left;
  const innerH = bottom - top;

  scene.add.tileSprite(left, top, innerW, innerH, 'room-wallpaper').setOrigin(0).setDepth(0);
  scene.add.tileSprite(0, top, left, innerH, 'room-brick').setOrigin(0).setDepth(2);
  scene.add.tileSprite(right, top, W - right, innerH, 'room-brick').setOrigin(0).setDepth(2);
  scene.add.tileSprite(0, bottom, W, H - bottom, 'room-floor').setOrigin(0).setDepth(2);

  const g = scene.add.graphics().setDepth(1);
  // ombra dei muri sulla carta da parati
  g.fillStyle(col(C.black));
  g.fillRect(left, top, 1, innerH);
  g.fillRect(right - 1, top, 1, innerH);
  // battiscopa
  g.fillStyle(col(C.slate));
  g.fillRect(left, bottom - 5, innerW, 5);
  g.fillStyle(col(C.silver));
  g.fillRect(left, bottom - 5, innerW, 1);
  g.fillStyle(col(C.charcoal));
  g.fillRect(left, bottom - 1, innerW, 1);

  const gTop = scene.add.graphics().setDepth(3);
  // soffitto con cornice
  gTop.fillStyle(col(C.charcoal));
  gTop.fillRect(0, 0, W, top);
  gTop.fillStyle(col(C.slate));
  gTop.fillRect(0, top - 3, W, 1);
  gTop.fillStyle(col(C.silver));
  gTop.fillRect(0, top - 2, W, 1);
  gTop.fillStyle(col(C.black));
  gTop.fillRect(0, top - 1, W, 1);
  // bordo superiore del pavimento
  gTop.fillStyle(col(C.red));
  gTop.fillRect(0, bottom, W, 1);

  // decorazioni: quadretto e lampada
  scene.add.image(36, 84, 'room-picture').setOrigin(0).setDepth(1);
  const lampX = 132;
  g.fillStyle(col(C.slate));
  g.fillRect(lampX, top, 1, 14);
  scene.add.image(lampX - 4, top + 14, 'room-lamp').setOrigin(0).setDepth(1);

  // corpi statici: superfici interne allineate a ROOM_INNER, spessore enorme verso l'esterno
  const T = ROOM.solidThickness;
  const opts = { isStatic: true, friction: ROOM.friction, restitution: ROOM.restitution };
  const m = scene.matter.add;
  return [
    m.rectangle(W / 2, bottom + T / 2, W + T * 2, T, { ...opts, label: 'room:floor' }),
    m.rectangle(W / 2, top - T / 2, W + T * 2, T, { ...opts, label: 'room:ceiling' }),
    m.rectangle(left - T / 2, H / 2, T, H + T * 2, { ...opts, label: 'room:wall' }),
    m.rectangle(right + T / 2, H / 2, T, H + T * 2, { ...opts, label: 'room:wall' }),
  ];
}
