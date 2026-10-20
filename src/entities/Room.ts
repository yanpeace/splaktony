import Phaser from 'phaser';
import { ROOM, ROOM_INNER, SCREEN, SITE } from '../config/balance';
import { C } from '../config/palette';
import { pixelText } from '../gfx/pixelFont';
import { spriteSize } from '../gfx/pixelSprite';
import {
  MOUNTAIN_Y0,
  PLAIN_Y0,
  PORTAL_X0,
  PORTAL_Y0,
  registerSiteSprites,
  SITE_SPRITES,
  TUNNEL_SIGN,
} from '../gfx/siteSprites';
import { roadAtY, TREE } from './siteLayout';

/**
 * Cantiere di una galleria, in prospettiva (geometria in siteLayout.ts):
 * cielo, montagna con il fronte di scavo in roccia e il portale in fondo al centro,
 * strada di sabbia a curve che scende dalla galleria al bordo basso,
 * sterrato con oggetti in scala (grandi davanti, piccoli vicino alla
 * galleria), terreno di gioco in ghiaia (y 292..320) e tubi d'impalcatura
 * come bordi. Fisica invariata: 4 corpi statici molto spessi allineati a
 * ROOM_INNER, etichette 'room:floor', 'room:ceiling', 'room:wall'.
 *
 * Depth: cielo 0, nuvole 0.1, montagna 0.3, piana (terreno + strada) 0.6,
 * portale 0.65 e cartello 0.66 (sotto la gru, 0.8-0.9), oggetti lontani 1,
 * medi 1.1, vicini 1.2, bordi 2. Liberi: la zona dell'albero, la strada e il
 * tratto tra la strada e l'albero (vedi checkProps).
 */

export interface SiteBackdropOptions {
  /** tutto a depth 0 (il Menu disegna il resto sopra in ordine di creazione) */
  flat?: boolean;
}

/** Oggetto appoggiato a terra: x = bordo sinistro, y = riga della base (ultima riga dello sprite). */
interface Prop {
  key: string;
  x: number;
  y: number;
}

/**
 * Oggetti del cantiere, dal fondo verso chi guarda (ordine di disegno).
 * La taglia segue scaleAtY(y): S ≈ 0.15-0.25, M ≈ 0.3-0.5, L ≥ 0.6.
 */
const PROPS: readonly Prop[] = [
  // lontani, vicino alla galleria (depth 1)
  { key: 'site-cabin-s', x: 32, y: 160 },
  { key: 'site-mound-s', x: 140, y: 158 },
  { key: 'site-excavator', x: 122, y: 166 },
  { key: 'site-cone-s', x: 104, y: 171 },
  { key: 'site-barrier-s', x: 102, y: 180 },
  { key: 'site-cone-s', x: 44, y: 177 },
  // medi (depth 1.1)
  { key: 'site-cabin-m', x: 12, y: 206 },
  { key: 'site-mound-m', x: 138, y: 200 },
  { key: 'site-cone-m', x: 70, y: 214 },
  { key: 'site-pipes-m', x: 148, y: 228 },
  { key: 'site-barrier-m', x: 52, y: 232 },
  { key: 'site-bricks', x: 150, y: 250 },
  // vicini (depth 1.2)
  { key: 'site-sign', x: 10, y: 272 },
  { key: 'site-pipes-l', x: 145, y: 274 },
  { key: 'site-mound-l', x: 9, y: 291 },
  { key: 'site-cone-l', x: 49, y: 291 },
  { key: 'site-cone-l', x: 154, y: 291 },
];

const propDepth = (y: number) => (y < 185 ? 1 : y < 255 ? 1.1 : 1.2);

/** In sviluppo: avvisa se un oggetto invade la strada o la zona dell'albero/incidente. */
function checkProps(): void {
  const t = SITE.treeClear;
  const tree = { l: TREE.x - t.side, r: TREE.x + t.side, top: TREE.y - t.above, bottom: TREE.y + t.below };
  for (const p of PROPS) {
    const { w, h } = spriteSize(SITE_SPRITES[p.key]);
    const top = p.y - h + 1;
    if (p.x <= tree.r && p.x + w > tree.l && p.y >= tree.top && top <= tree.bottom) {
      console.warn(`[Room] ${p.key} invade la zona dell'albero`);
    }
    for (let y = Math.max(top, 153); y <= p.y; y++) {
      const q = roadAtY(y);
      const half = q.w / 2 + SITE.roadClear;
      if (p.x < q.x + half && p.x + w > q.x - half) {
        console.warn(`[Room] ${p.key} invade la strada a y=${y}`);
        break;
      }
    }
  }
}

/** Disegna lo sfondo del cantiere, senza corpi fisici (usato anche dal Menu). */
export function drawSiteBackdrop(scene: Phaser.Scene, opts: SiteBackdropOptions = {}): void {
  registerSiteSprites(scene);
  if (import.meta.env.DEV) checkProps();
  const { width: W } = SCREEN;
  const { left, right, top, bottom } = ROOM_INNER;
  const z = (d: number) => (opts.flat ? 0 : d);
  const img = (x: number, y: number, key: string, d: number) =>
    scene.add.image(x, y, key).setOrigin(0).setDepth(z(d));
  const tile = (x: number, y: number, w: number, h: number, key: string, d: number) =>
    scene.add.tileSprite(x, y, w, h, key).setOrigin(0).setDepth(z(d));

  // ---- cielo e montagna (depth 0..0.3): l'HUD sta sopra il cielo scuro
  tile(0, 0, W, 156, 'site-sky', 0);
  img(132, 60, 'site-cloud-a', 0.1);
  img(36, 68, 'site-cloud-b', 0.1);
  img(0, MOUNTAIN_Y0, 'site-mountain', 0.3);

  // ---- piana: sterrato + strada a curve + terreno di gioco (depth 0.6)
  img(0, PLAIN_Y0, 'site-plain', 0.6);

  // ---- portale della galleria e targa "GALLERIA" (depth 0.65..0.66, sotto la gru)
  img(PORTAL_X0, PORTAL_Y0, 'site-portal', 0.65);
  img(TUNNEL_SIGN.x, TUNNEL_SIGN.y, 'site-tunnel-sign', 0.66);

  // ---- oggetti del cantiere in scala (depth 1..1.2)
  for (const p of PROPS) {
    const { h } = spriteSize(SITE_SPRITES[p.key]);
    img(p.x, p.y - h + 1, p.key, propDepth(p.y));
  }
  const sign = PROPS.find((p) => p.key === 'site-sign');
  if (sign) {
    const sy = sign.y - spriteSize(SITE_SPRITES['site-sign']).h + 1;
    pixelText(scene, sign.x + 28, sy + 3, 'LAVORI', C.black, C.white).setOrigin(0.5, 0).setDepth(z(1.25));
    pixelText(scene, sign.x + 28, sy + 12, 'IN CORSO', C.red, C.white).setOrigin(0.5, 0).setDepth(z(1.25));
  }

  // ---- bordi: tubi d'impalcatura ai lati e sotto l'HUD (depth 2)
  const pipeY = top - 4;
  tile(0, pipeY, left, bottom - pipeY, 'site-pole', 2);
  tile(right, pipeY, W - right, bottom - pipeY, 'site-pole', 2);
  tile(0, pipeY, W, 4, 'site-pipe', 2);
}

/** Cantiere completo: grafica + 4 corpi statici (fisica invariata). */
export function buildRoom(scene: Phaser.Scene): MatterJS.BodyType[] {
  drawSiteBackdrop(scene);
  return buildRoomBodies(scene);
}

/**
 * Solo la fisica della stanza: 4 corpi statici molto spessi con le superfici
 * interne allineate a ROOM_INNER. Uguale in tutti i mondi (la grafica cambia).
 */
export function buildRoomBodies(scene: Phaser.Scene): MatterJS.BodyType[] {
  const { width: W, height: H } = SCREEN;
  const { left, right, top, bottom } = ROOM_INNER;
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
