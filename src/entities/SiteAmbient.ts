import Phaser from 'phaser';
import { SITE_AMBIENT as S } from '../config/balance';
import { makeSprite, type SpriteData } from '../gfx/pixelSprite';
import { Subscriptions } from '../systems/events';
import { HORIZON_Y, NEAR_Y, TREE, TUNNEL, roadAt } from './siteLayout';
import { TUNNEL_LAMPS } from '../gfx/siteSprites';

/**
 * Animazioni ambientali del cantiere della galleria: lo sfondo "vive" dietro Tony.
 * Le posizioni derivano tutte da siteLayout.ts (strada a curve in prospettiva).
 *
 * - gru a torre a sinistra (pilone x 21..27, braccio y 50..53 da x 8 a 162):
 *   carrello che scorre a scatti, gancio con una trave che dondola a scatti
 *   (frame pre-disegnati, niente rotazioni sub-pixel), lampeggiante rosso in cima;
 * - galleria: 2 luci ai lati del portale che lampeggiano alternate e una fila
 *   di lucine dentro la bocca che si accendono in sequenza verso il fondo;
 * - coni con lampeggiante ai bordi della strada (3 taglie pre-disegnate, scelte
 *   dalla scala 1/z), bandierina a terra a lato della strada;
 * - sbuffi di polvere dai bordi della strada, più piccoli lontano.
 *
 * Prestazioni: 11 oggetti creati una volta sola (+ pool della polvere); cambiano
 * solo texture/posizione. Niente corpi fisici, niente creazione continua.
 * Layout: niente nella zona dell'albero (x 52..76, y 150..178) né sul tratto
 * dritto dell'auto (da roadAt(CRASH_LEAVE_Z) all'albero).
 * Chiavi texture: prefisso `amb-` (le `site-*` sono dello sfondo).
 */


// ---------------------------------------------------------------- disegno a griglia

/** Griglia di caratteri di palette con origine in (ox, oy): si disegna in coordinate assolute. */
class Grid {
  private cells: string[][];
  constructor(
    readonly ox: number,
    readonly oy: number,
    readonly w: number,
    readonly h: number,
  ) {
    this.cells = Array.from({ length: h }, () => new Array<string>(w).fill('.'));
  }
  set(x: number, y: number, c: string): void {
    const gx = x - this.ox;
    const gy = y - this.oy;
    if (gx < 0 || gy < 0 || gx >= this.w || gy >= this.h) return;
    this.cells[gy][gx] = c;
  }
  rect(x: number, y: number, w: number, h: number, c: string): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  /** Linea di Bresenham (pixel interi). */
  line(x0: number, y0: number, x1: number, y1: number, c: string): void {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) return;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }
  /** Copia uno sprite a stringhe con l'angolo in alto a sinistra in (x, y). */
  blit(x: number, y: number, rows: SpriteData): void {
    rows.forEach((r, j) => {
      for (let i = 0; i < r.length; i++) if (r[i] !== '.') this.set(x + i, y + j, r[i]);
    });
  }
  rows(): string[] {
    return this.cells.map((r) => r.join(''));
  }
}

// ---------------------------------------------------------------- geometria della gru

const TOWER_L = 21; // pilone x 21..27
const TOWER_R = 27;
const TOWER_C = 24;
const APEX_Y = 43;
const JIB_Y = 50; // braccio y 50..53
const JIB_L = 8;
const JIB_R = 162;
const TOWER_BOTTOM = 165;
const TROLLEY_Y = 54; // il carrello pende sotto il corrente inferiore
const CABLE_Y = 57;
const CABLE_LEN = 20;
const BEAM_HALF = 8;

const CRANE_X0 = 8;
const CRANE_Y0 = 43;

function craneSprite(): string[] {
  const g = new Grid(CRANE_X0, CRANE_Y0, JIB_R - CRANE_X0 + 1, 171 - CRANE_Y0 + 1);
  // tiranti dalla punta ai due bracci
  g.line(TOWER_C, APEX_Y, JIB_L + 2, JIB_Y - 1, 'e');
  g.line(TOWER_C, APEX_Y, 124, JIB_Y - 1, 'e');
  // punta a "A" sopra il pilone
  g.line(TOWER_C, APEX_Y, TOWER_L, JIB_Y - 1, '4');
  g.line(TOWER_C, APEX_Y, TOWER_R, JIB_Y - 1, '3');
  g.line(TOWER_C, APEX_Y + 2, TOWER_C, JIB_Y - 1, '3');
  // braccio + controbraccio: correnti gialli, diagonali arancio
  for (let x = JIB_L; x <= JIB_R; x++) {
    g.set(x, JIB_Y, '4');
    g.set(x, JIB_Y + 3, '4');
    const m = (x - JIB_L) % 4;
    if (m === 0) g.set(x, JIB_Y + 2, '3');
    if (m === 1 || m === 3) g.set(x, JIB_Y + 1, '3');
  }
  g.set(JIB_R, JIB_Y + 1, '4');
  g.set(JIB_R, JIB_Y + 2, '4');
  // pilone a traliccio
  for (let y = JIB_Y + 4; y <= TOWER_BOTTOM; y++) {
    g.set(TOWER_L, y, '4');
    g.set(TOWER_R, y, '3');
    const k = (y - JIB_Y - 4) % 6;
    if (k === 0) g.rect(TOWER_L + 1, y, TOWER_R - TOWER_L - 1, 1, '4');
    else g.set(TOWER_L + k, y, '3');
  }
  // cabina sotto il braccio, a destra del pilone
  g.blit(TOWER_R + 1, JIB_Y + 4, ['444443', '4baa43', '4aaa43', '444443', '333333']);
  // zavorra in cemento sul controbraccio
  g.blit(9, JIB_Y + 4, ['ddddddddd', 'eeeefeeee', 'eeeefeeee', 'eeeefeeee', 'fffffffff']);
  // basamento
  g.rect(17, TOWER_BOTTOM + 1, 15, 1, 'd');
  g.rect(17, TOWER_BOTTOM + 2, 15, 3, 'e');
  g.rect(17, TOWER_BOTTOM + 5, 15, 1, 'f');
  return g.rows();
}

/** Massimo spostamento orizzontale del gancio (px) all'ampiezza massima. */
const MAX_DX = Math.ceil(CABLE_LEN * Math.sin((S.swingMaxSteps * S.swingStepDeg * Math.PI) / 180));
const HANG_CX = BEAM_HALF + MAX_DX;
const HANG_W = HANG_CX * 2 + 1;
const HANG_H = CABLE_LEN + 9;

/** Cavo + gancio + brache + trave, inclinato di `step` scatti (frame pre-disegnato). */
function hangSprite(step: number): string[] {
  const g = new Grid(0, 0, HANG_W, HANG_H);
  const a = (step * S.swingStepDeg * Math.PI) / 180;
  const hx = HANG_CX + Math.round(CABLE_LEN * Math.sin(a));
  const hy = Math.round(CABLE_LEN * Math.cos(a));
  g.line(HANG_CX, 0, hx, hy - 1, 'e');
  g.rect(hx - 1, hy, 3, 1, '4');
  g.set(hx, hy + 1, 'f');
  g.line(hx, hy + 2, hx - 6, hy + 5, 'e');
  g.line(hx, hy + 2, hx + 6, hy + 5, 'e');
  // trave a doppio T vista di lato: ala chiara, anima scura con bulloni, ala in ombra
  for (let x = hx - BEAM_HALF; x <= hx + BEAM_HALF; x++) {
    g.set(x, hy + 6, '3');
    g.set(x, hy + 7, (x - hx) % 4 === 0 ? '0' : '1');
    g.set(x, hy + 8, '2');
  }
  return g.rows();
}

const TROLLEY: SpriteData = ['eddddde', '.eeeee.', '..e4e..'];
const BEACON_ON: SpriteData = ['.2.', '232'];
const BEACON_OFF: SpriteData = ['.1.', '111'];

// ---------------------------------------------------------------- coni con lampeggiante

/** colori del lampeggiante: [esterno, centro] acceso giallo / acceso arancio / spento */
type LampColor = 'y' | 'o' | 'off';
const LAMP_PIX: Record<LampColor, [string, string]> = { y: ['4', 'c'], o: ['3', '4'], off: ['1', '1'] };

/** Corpo del cono (arancio a strisce bianche) per taglia: 0 grande, 1 media, 2 piccola. */
const CONE_BODY: readonly SpriteData[] = [
  ['...3...', '..333..', '..ccc..', '.33333.', '.ccccc.', '3333333', 'fffffff'],
  ['..3..', '.333.', '.ccc.', '33333', 'fffff'],
  ['.3.', '3c3', 'fff'],
];

/** Cono + lampeggiante in cima, già composto (un'immagine sola per cono). */
function coneSprite(size: number, c: LampColor): string[] {
  const body = CONE_BODY[size];
  const w = body[0].length;
  const [a, b] = LAMP_PIX[c];
  const pad = (s: string) => {
    const l = (w - s.length) >> 1;
    return '.'.repeat(l) + s + '.'.repeat(w - s.length - l);
  };
  const lamp = size === 2 ? [pad(a)] : [pad(a), pad(a + b + a), pad('f')];
  return [...lamp, ...body];
}

/** taglia del cono dalla scala a schermo */
const coneSize = (s: number) => (s >= 0.5 ? 0 : s >= 0.3 ? 1 : 2);

// ---------------------------------------------------------------- galleria

/** luci ai lati del portale (3x2): coprono esattamente le lampade statiche dello sfondo */
const PORTAL_Y = TUNNEL_LAMPS[0].y + 1;
const PORTAL_LX = TUNNEL_LAMPS[0].x;
const PORTAL_RX = TUNNEL_LAMPS[1].x;
const PORTAL_ON_Y: SpriteData = ['4c4', '343'];
const PORTAL_ON_O: SpriteData = ['3c3', '232'];
const PORTAL_OFF: SpriteData = ['f1f', '1f1'];

/** le due luci in un'immagine sola: frame 0 sinistra accesa, frame 1 destra accesa */
function portalSprite(frame: 0 | 1): string[] {
  const g = new Grid(PORTAL_LX, PORTAL_Y, PORTAL_RX - PORTAL_LX + 3, 2);
  g.blit(PORTAL_LX, PORTAL_Y, frame === 0 ? PORTAL_ON_Y : PORTAL_OFF);
  g.blit(PORTAL_RX, PORTAL_Y, frame === 0 ? PORTAL_OFF : PORTAL_ON_O);
  return g.rows();
}

/**
 * Lucine sulle pareti dentro la bocca (oltre l'imbocco, z > Z_FAR), a metà
 * altezza dell'arco: proiettate con la stessa prospettiva della strada.
 */
const WALL_Z = [9, 10.5, 12.5, 15] as const;
/** mezza larghezza (mondo) della fila e altezza (mondo) da terra */
const WALL_HALF = (TUNNEL.w / 2) * TUNNEL.z * 0.75;
const WALL_H = (TUNNEL.h / 2) * TUNNEL.z;
const WALL_PTS = WALL_Z.map((z) => ({
  dx: Math.round(WALL_HALF / z),
  y: Math.round(HORIZON_Y + (NEAR_Y - HORIZON_Y - WALL_H) / z),
}));
const WALL_X0 = TUNNEL.x - WALL_PTS[0].dx;
const WALL_Y0 = Math.min(...WALL_PTS.map((p) => p.y));
const WALL_Y1 = Math.max(...WALL_PTS.map((p) => p.y));

/** frame k: la lucina k è accesa (gialla), la precedente sfuma (arancio), le altre spente */
function wallSprite(k: number): string[] {
  const n = WALL_PTS.length;
  const g = new Grid(WALL_X0, WALL_Y0, WALL_PTS[0].dx * 2 + 1, WALL_Y1 - WALL_Y0 + 1);
  WALL_PTS.forEach((p, i) => {
    const c = i === k ? '4' : i === (k + n - 1) % n ? '3' : '1';
    g.set(TUNNEL.x - p.dx, p.y, c);
    g.set(TUNNEL.x + p.dx, p.y, c);
  });
  return g.rows();
}

// ---------------------------------------------------------------- bandierina e polvere

/** Palo + bandierina al vento (verso destra), 2 frame, già in scala (~1/3). */
const FLAG_H = 12;
function flagSprite(frame: 0 | 1): string[] {
  const g = new Grid(0, 0, 5, FLAG_H);
  g.set(0, 0, '4');
  g.rect(0, 1, 1, FLAG_H - 1, 'e');
  g.blit(1, 1, frame === 0 ? ['33..', '3332', '32..'] : ['32..', '3332', '33..']);
  return g.rows();
}

/** sbuffi: set 0 vicino (grandi), set 1 lontano (piccoli); 4 fasi ciascuno */
const DUST: readonly (readonly SpriteData[])[] = [
  [
    ['.d.', '4d4'],
    ['.d4.', '4dd4', '.44.'],
    ['.d..e', '4..d.', '.e4..'],
    ['d...', '...e'],
  ],
  [['d4'], ['.d', 'd4'], ['d.', '.e'], ['.d', 'e.']],
];
/** scala sotto la quale si usano gli sbuffi piccoli */
const DUST_FAR_S = 0.45;

// ---------------------------------------------------------------- posizioni

const BEACON_X = TOWER_C - 1;
const BEACON_Y = APEX_Y - 2;

/** zona libera dell'albero dell'incidente: x 52..76, y 150..178 */
const TREE_FREE = { x0: TREE.x - 12, x1: TREE.x + 12, y0: TREE.y - 23, y1: TREE.y + 5 };
/** uno sbuffo nato in (x, y) che sale di h px (e scivola col vento) toccherebbe la zona? */
const inTreeZone = (x: number, y: number, h: number) =>
  x >= TREE_FREE.x0 - 3 && x <= TREE_FREE.x1 + 3 && y >= TREE_FREE.y0 && y - h <= TREE_FREE.y1;

/** gru dietro lo sfondo vicino (1..1.2), tutto il resto 1.5..1.9 */
const DEPTH_CRANE = 0.8;
const DEPTH_LOAD = 0.9;
const DEPTH_TUNNEL = 1.5;
const DEPTH_PROPS = 1.8;
const DEPTH_DUST = 1.9;

interface Puff {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  step: number;
  set: 0 | 1;
  active: boolean;
}

function registerTextures(scene: Phaser.Scene): void {
  makeSprite(scene, 'amb-crane', craneSprite());
  for (let k = -S.swingMaxSteps; k <= S.swingMaxSteps; k++) makeSprite(scene, `amb-hang${k}`, hangSprite(k));
  makeSprite(scene, 'amb-trolley', TROLLEY);
  makeSprite(scene, 'amb-beacon-on', BEACON_ON);
  makeSprite(scene, 'amb-beacon-off', BEACON_OFF);
  for (let size = 0; size < CONE_BODY.length; size++) {
    for (const c of ['y', 'o', 'off'] as const) makeSprite(scene, `amb-cone${size}-${c}`, coneSprite(size, c));
  }
  makeSprite(scene, 'amb-portal0', portalSprite(0));
  makeSprite(scene, 'amb-portal1', portalSprite(1));
  WALL_PTS.forEach((_, k) => makeSprite(scene, `amb-tunnel${k}`, wallSprite(k)));
  makeSprite(scene, 'amb-flag0', flagSprite(0));
  makeSprite(scene, 'amb-flag1', flagSprite(1));
  DUST.forEach((set, j) => set.forEach((d, i) => makeSprite(scene, `amb-dust${j}-${i}`, d)));
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Punto a terra appena fuori dal bordo della strada (lato -1/1) alla profondità z. */
function roadside(z: number, side: number, extra: number): { x: number; y: number; s: number } {
  const p = roadAt(z);
  return { x: Math.round(p.x + side * (p.w / 2 + extra)), y: Math.round(p.y), s: p.s };
}

/**
 * Crea le animazioni del cantiere nella scena (una volta, in create()).
 * Si ripulisce da sola allo shutdown della scena.
 */
export function bindSiteAmbient(scene: Phaser.Scene): void {
  registerTextures(scene);
  const add = (x: number, y: number, key: string, depth: number) =>
    scene.add.image(x, y, key).setOrigin(0).setDepth(depth);

  // --- gru
  add(CRANE_X0, CRANE_Y0, 'amb-crane', DEPTH_CRANE);
  const beacon = add(BEACON_X, BEACON_Y, 'amb-beacon-on', DEPTH_CRANE);
  let trolleyX = Math.round(rand(S.trolleyMinX, S.trolleyMaxX));
  const trolley = add(trolleyX - 3, TROLLEY_Y, 'amb-trolley', DEPTH_LOAD);
  const hang = add(trolleyX - HANG_CX, CABLE_Y, 'amb-hang0', DEPTH_LOAD);

  // --- galleria
  const portal = add(PORTAL_LX, PORTAL_Y, 'amb-portal0', DEPTH_TUNNEL);
  const tunnel = add(WALL_X0, WALL_Y0, 'amb-tunnel0', DEPTH_TUNNEL);

  // --- coni: base al centro sul terreno, appena fuori dal bordo della strada;
  // i pari lampeggiano gialli, i dispari arancio, in controfase
  const cones = S.cones.map(([z, side], i) => {
    const r = roadside(z, side, 2 + 6 / z);
    const size = coneSize(r.s);
    const rows = coneSprite(size, 'off');
    const odd = i % 2 === 1;
    const color: LampColor = odd ? 'o' : 'y';
    const img = add(r.x - (rows[0].length >> 1), r.y - rows.length + 1, `amb-cone${size}-${odd ? 'off' : color}`, DEPTH_PROPS);
    return { img, size, color, odd };
  });

  // --- bandierina a terra a lato della strada (base del palo sul terreno)
  const fp = roadside(S.flagZ, S.flagSide, 24 / S.flagZ);
  const flag = add(fp.x, fp.y - FLAG_H + 1, 'amb-flag0', DEPTH_PROPS);

  const puffs: Puff[] = [];
  for (let i = 0; i < S.dustPool; i++) {
    const img = add(0, 0, 'amb-dust0-0', DEPTH_DUST).setVisible(false);
    puffs.push({ img, x: 0, y: 0, step: 0, set: 0, active: false });
  }

  // stato
  let target = trolleyX;
  let trolleyAcc = 0;
  let pauseLeft = rand(S.trolleyPauseMinMs, S.trolleyPauseMaxMs);
  let phase = 0;
  let amp: number = S.swingAmpRest;
  let hangStep = 0;
  let beaconAcc = 0;
  let beaconOn = true;
  let lampAcc = 0;
  let lampPhase = false;
  let portalAcc = 0;
  let portalFrame = 0;
  let tunnelAcc = 0;
  let tunnelFrame = 0;
  let flagAcc = 0;
  let flagFrame = 0;
  let dustLeft = rand(S.dustMinMs, S.dustMaxMs);
  let dustAcc = 0;

  const placeHang = () => hang.setPosition(trolleyX - HANG_CX, CABLE_Y);

  const drawPuff = (p: Puff) => {
    const f = p.step < 2 ? 0 : p.step < 5 ? 1 : p.step < 7 ? 2 : 3;
    const key = `amb-dust${p.set}-${f}`;
    if (p.img.texture.key !== key) p.img.setTexture(key);
    const rows = DUST[p.set][f];
    p.img.setPosition(p.x - (rows[0].length >> 1), p.y - rows.length + 1);
    // ultimi scatti: lampeggio invece di dissolvenza
    p.img.setVisible(f !== 3 || p.step % 2 === 1);
  };
  const spawnPuff = (x: number, y: number, set: 0 | 1) => {
    const p = puffs.find((q) => !q.active);
    if (!p) return;
    p.active = true;
    p.x = x;
    p.y = y;
    p.set = set;
    p.step = 0;
    drawPuff(p);
  };
  /** sbuffo su un bordo a caso della strada, fuori dalla zona dell'albero */
  const spawnDust = () => {
    for (let tries = 0; tries < 6; tries++) {
      const z = rand(S.dustZMin, S.dustZMax);
      const side = Math.random() < 0.5 ? -1 : 1;
      const r = roadside(z, side, rand(-2, 3) / z);
      if (inTreeZone(r.x, r.y, S.dustSteps)) continue;
      const set = r.s >= DUST_FAR_S ? 0 : 1;
      spawnPuff(r.x, r.y, set);
      if (set === 0 && Math.random() < 0.4) spawnPuff(r.x + 4 * side, r.y + 1, 0);
      return;
    }
  };

  const onUpdate = (_t: number, dt: number) => {
    // --- carrello: 1px a scatti verso il bersaglio, poi sosta
    if (trolleyX === target) {
      pauseLeft -= dt;
      if (pauseLeft <= 0) {
        target = Math.round(rand(S.trolleyMinX, S.trolleyMaxX));
        pauseLeft = rand(S.trolleyPauseMinMs, S.trolleyPauseMaxMs);
        trolleyAcc = 0;
      }
    } else {
      trolleyAcc += dt;
      if (trolleyAcc >= S.trolleyStepMs) {
        trolleyAcc -= S.trolleyStepMs;
        trolleyX += trolleyX < target ? 1 : -1;
        trolley.setX(trolleyX - 3);
        placeHang();
        if (trolleyX === target) amp = Math.max(amp, S.swingAmpStop); // frenata: il carico dondola
      }
    }

    // --- dondolo quantizzato del carico
    phase = (phase + (Math.PI * 2 * dt) / S.swingPeriodMs) % (Math.PI * 2);
    if (amp > S.swingAmpRest) {
      amp = Math.max(S.swingAmpRest, amp - ((S.swingAmpStrong - S.swingAmpRest) * dt) / S.swingDecayMs);
    }
    const step = Phaser.Math.Clamp(Math.round(amp * Math.sin(phase)), -S.swingMaxSteps, S.swingMaxSteps);
    if (step !== hangStep) {
      hangStep = step;
      hang.setTexture(`amb-hang${step}`);
    }

    // --- lampeggianti: gru, coni, portale, lucine nella bocca
    beaconAcc += dt;
    if (beaconAcc >= S.beaconMs) {
      beaconAcc %= S.beaconMs;
      beaconOn = !beaconOn;
      beacon.setTexture(beaconOn ? 'amb-beacon-on' : 'amb-beacon-off');
    }
    lampAcc += dt;
    if (lampAcc >= S.lampMs) {
      lampAcc %= S.lampMs;
      lampPhase = !lampPhase;
      for (const c of cones) c.img.setTexture(`amb-cone${c.size}-${c.odd === lampPhase ? c.color : 'off'}`);
    }
    portalAcc += dt;
    if (portalAcc >= S.tunnelLampMs) {
      portalAcc %= S.tunnelLampMs;
      portalFrame ^= 1;
      portal.setTexture(`amb-portal${portalFrame}`);
    }
    tunnelAcc += dt;
    if (tunnelAcc >= S.tunnelSeqMs) {
      tunnelAcc %= S.tunnelSeqMs;
      tunnelFrame = (tunnelFrame + 1) % WALL_PTS.length;
      tunnel.setTexture(`amb-tunnel${tunnelFrame}`);
    }
    flagAcc += dt;
    if (flagAcc >= S.flagMs) {
      flagAcc %= S.flagMs;
      flagFrame ^= 1;
      flag.setTexture(flagFrame ? 'amb-flag1' : 'amb-flag0');
    }

    // --- polvere: nuovi sbuffi ogni tanto, salgono a scatti e svaniscono
    dustLeft -= dt;
    if (dustLeft <= 0) {
      dustLeft = rand(S.dustMinMs, S.dustMaxMs);
      spawnDust();
    }
    dustAcc += dt;
    if (dustAcc >= S.dustStepMs) {
      dustAcc %= S.dustStepMs;
      for (const p of puffs) {
        if (!p.active) continue;
        p.step++;
        if (p.step >= S.dustSteps) {
          p.active = false;
          p.img.setVisible(false);
          continue;
        }
        // lontano gli sbuffi salgono la metà
        if (p.set === 0 || p.step % 2 === 0) p.y -= 1;
        if (p.step % 3 === 0) p.x += 1; // vento verso destra, come la bandierina
        drawPuff(p);
      }
    }
  };

  const subs = new Subscriptions();
  // colpo forte: il carico della gru dondola di più per un attimo
  subs.on('damage', (e) => {
    if (e.strong) amp = Math.max(amp, S.swingAmpStrong);
  });
  scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
    subs.clear();
  });
}
