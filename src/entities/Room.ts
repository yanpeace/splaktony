import Phaser from 'phaser';
import { ROOM, ROOM_INNER, SCREEN, SITE } from '../config/balance';
import { C } from '../config/palette';
import { pixelText } from '../gfx/pixelFont';
import { registerSiteSprites } from '../gfx/siteSprites';

/**
 * Cantiere all'aperto: cielo, città lontana, palazzo in costruzione,
 * recinzione e attrezzi, strada di sabbia (SITE.roadTop..roadBottom),
 * sterrato e terreno di ghiaia; tubi d'impalcatura come bordi.
 * Fisica invariata: 4 corpi statici molto spessi allineati a ROOM_INNER,
 * etichette 'room:floor', 'room:ceiling', 'room:wall'.
 *
 * Depth: cielo e sfondo lontano 0..0.5, recinzione e oggetti 1..1.2,
 * strada/terreno/bordi 2. La zona SITE.treeZone resta libera da oggetti.
 */

export interface SiteBackdropOptions {
  /** tutto a depth 0 (il Menu disegna il resto sopra in ordine di creazione) */
  flat?: boolean;
}

/** Disegna lo sfondo del cantiere, senza corpi fisici (usato anche dal Menu). */
export function drawSiteBackdrop(scene: Phaser.Scene, opts: SiteBackdropOptions = {}): void {
  registerSiteSprites(scene);
  const { width: W, height: H } = SCREEN;
  const { left, right, top, bottom } = ROOM_INNER;
  const z = (d: number) => (opts.flat ? 0 : d);
  const img = (x: number, y: number, key: string, d: number) =>
    scene.add.image(x, y, key).setOrigin(0).setDepth(z(d));
  const tile = (x: number, y: number, w: number, h: number, key: string, d: number) =>
    scene.add.tileSprite(x, y, w, h, key).setOrigin(0).setDepth(z(d));

  const horizon = SITE.horizon;
  const roadTop = SITE.roadTop;
  const roadH = SITE.roadBottom - SITE.roadTop;

  // ---- cielo e sfondo lontano (depth 0..0.5)
  tile(0, 0, W, horizon, 'site-sky', 0);
  img(36, 50, 'site-cloud-a', 0);
  img(126, 30, 'site-cloud-b', 0);
  img(14, 98, 'site-cloud-b', 0);
  tile(0, horizon - 24, W, 24, 'site-skyline', 0);
  img(114, 56, 'site-building', 0.5); // a destra: la sinistra resta libera per una gru

  // ---- recinzione, cartello e attrezzi (depth 1..1.2), fuori dalla zona dell'albero
  tile(0, horizon, W, roadTop - horizon, 'site-backdirt', 1);
  tile(10, 149, 51, 18, 'site-fence', 1);
  tile(119, 149, 51, 18, 'site-fence', 1);

  img(10, 121, 'site-sign', 1);
  pixelText(scene, 38, 123, 'LAVORI', C.black, C.white).setOrigin(0.5, 0).setDepth(z(1.1));
  pixelText(scene, 38, 132, 'IN CORSO', C.red, C.white).setOrigin(0.5, 0).setDepth(z(1.1));

  img(12, 158, 'site-sandbags', 1.2);
  img(37, 157, 'site-cone', 1.2);
  img(48, 156, 'site-bricks', 1.2);
  img(112, 157, 'site-cone', 1.2);
  img(122, 156, 'site-bricks', 1.2);
  img(141, 144, 'site-mixer', 1.2);

  // ---- terra e strada di sabbia (depth 2)
  tile(0, SITE.roadBottom, W, bottom - SITE.roadBottom, 'site-dirt', 2);
  tile(0, roadTop, W, roadH, 'site-road', 2);
  tile(0, bottom, W, H - bottom, 'site-ground', 2);
  img(12, bottom - 13, 'site-barrier', 2);
  img(160, bottom - 11, 'site-cone', 2);

  // ---- bordi: tubi d'impalcatura ai lati e sotto l'HUD
  const pipeY = top - 4;
  tile(0, pipeY, left, bottom - pipeY, 'site-pole', 2);
  tile(right, pipeY, W - right, bottom - pipeY, 'site-pole', 2);
  tile(0, pipeY, W, 4, 'site-pipe', 2);
}

/** Cantiere completo: grafica + 4 corpi statici (fisica invariata). */
export function buildRoom(scene: Phaser.Scene): MatterJS.BodyType[] {
  const { width: W, height: H } = SCREEN;
  const { left, right, top, bottom } = ROOM_INNER;

  drawSiteBackdrop(scene);

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
