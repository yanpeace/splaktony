import Phaser from 'phaser';
import { SITE_AMBIENT as S } from '../config/balance';
import { makeSprite, type SpriteData } from '../gfx/pixelSprite';
import { Subscriptions } from '../systems/events';

/**
 * Animazioni ambientali del cantiere: lo sfondo "vive" dietro Tony.
 *
 * - gru a torre a sinistra (pilone x 21..27, braccio y 50..53 da x 8 a 162):
 *   carrello che scorre a scatti, gancio con una trave che dondola a scatti
 *   (frame pre-disegnati, niente rotazioni sub-pixel), lampeggiante rosso in cima;
 * - lampeggianti giallo/arancio alternati su transenna e cono dello sfondo;
 * - bandierina a 2 frame (x 163) e sbuffi di polvere dalla strada.
 *
 * Prestazioni: 13 oggetti creati una volta sola (un'immagine statica per la
 * struttura della gru, il resto cambia solo texture/posizione); la polvere usa
 * un piccolo pool interno. Niente corpi fisici, niente creazione continua.
 * Layout: niente nella zona dell'albero/incidente (x 60..120, y 105..190).
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
const LAMP_Y_ON: SpriteData = ['.4.', '4c4', '.f.'];
const LAMP_O_ON: SpriteData = ['.3.', '343', '.f.'];
const LAMP_OFF: SpriteData = ['.1.', '111', '.f.'];



/** Palo + bandierina al vento (verso destra), 2 frame. */
function flagSprite(frame: 0 | 1): string[] {
  const g = new Grid(0, 0, 8, 31);
  g.set(0, 0, '4');
  g.rect(0, 1, 1, 30, 'e');
  g.blit(
    1,
    1,
    frame === 0
      ? ['33.....', '33332..', '3333322', '332....']
      : ['332....', '3333322', '33332..', '33.....'],
  );
  return g.rows();
}

const DUST: readonly SpriteData[] = [
  ['.d.', '4d4'],
  ['.d4.', '4dd4', '.44.'],
  ['.d..e', '4..d.', '.e4..'],
  ['d...', '...e'],
];

// ---------------------------------------------------------------- posizioni

const BEACON_X = TOWER_C - 1;
const BEACON_Y = APEX_Y - 2;
/** sopra la transenna a terra (12, 279) e sulla punta del cono sullo sterrato (37, 157) */
const LAMP_A_X = 14;
const LAMP_A_Y = 276;
const LAMP_B_X = 40;
const LAMP_B_Y = 154;
/** bandierina sullo sterrato dietro la strada, al bordo destro */
const FLAG_X = 163;
const FLAG_Y = 136;
/** sbuffi di polvere: solo fuori dalla zona albero/incidente (x 60..120) */
const DUST_SPANS: readonly [number, number][] = [
  [12, 52],
  [128, 166],
];
const DUST_Y_MIN = 182;
const DUST_Y_MAX = 185;

/** gru dietro recinzione e attrezzi (1..1.2) ma davanti al palazzo (0.5) */
const DEPTH_CRANE = 0.8;
const DEPTH_LOAD = 0.9;
const DEPTH_PROPS = 1.8;
const DEPTH_DUST = 1.9;

interface Puff {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  step: number;
  active: boolean;
}

function registerTextures(scene: Phaser.Scene): void {
  makeSprite(scene, 'site-crane', craneSprite());
  for (let k = -S.swingMaxSteps; k <= S.swingMaxSteps; k++) makeSprite(scene, `site-hang${k}`, hangSprite(k));
  makeSprite(scene, 'site-trolley', TROLLEY);
  makeSprite(scene, 'site-beacon-on', BEACON_ON);
  makeSprite(scene, 'site-beacon-off', BEACON_OFF);
  makeSprite(scene, 'site-lamp-y', LAMP_Y_ON);
  makeSprite(scene, 'site-lamp-o', LAMP_O_ON);
  makeSprite(scene, 'site-lamp-off', LAMP_OFF);
  makeSprite(scene, 'site-flag0', flagSprite(0));
  makeSprite(scene, 'site-flag1', flagSprite(1));
  DUST.forEach((d, i) => makeSprite(scene, `site-dust${i}`, d));
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * Crea le animazioni del cantiere nella scena (una volta, in create()).
 * Si ripulisce da sola allo shutdown della scena.
 */
export function bindSiteAmbient(scene: Phaser.Scene): void {
  registerTextures(scene);
  const add = (x: number, y: number, key: string, depth: number) =>
    scene.add.image(x, y, key).setOrigin(0).setDepth(depth);

  add(CRANE_X0, CRANE_Y0, 'site-crane', DEPTH_CRANE);
  const beacon = add(BEACON_X, BEACON_Y, 'site-beacon-on', DEPTH_CRANE);
  let trolleyX = Math.round(rand(S.trolleyMinX, S.trolleyMaxX));
  const trolley = add(trolleyX - 3, TROLLEY_Y, 'site-trolley', DEPTH_LOAD);
  const hang = add(trolleyX - HANG_CX, CABLE_Y, 'site-hang0', DEPTH_LOAD);

  // i lampeggianti stanno sopra la transenna e il cono disegnati dallo sfondo (Room.ts)
  const lampA = add(LAMP_A_X, LAMP_A_Y, 'site-lamp-y', DEPTH_PROPS);
  const lampB = add(LAMP_B_X, LAMP_B_Y, 'site-lamp-off', DEPTH_PROPS);
  const flag = add(FLAG_X, FLAG_Y, 'site-flag0', DEPTH_PROPS);

  const puffs: Puff[] = [];
  for (let i = 0; i < S.dustPool; i++) {
    const img = add(0, 0, 'site-dust0', DEPTH_DUST).setVisible(false);
    puffs.push({ img, x: 0, y: 0, step: 0, active: false });
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
  let flagAcc = 0;
  let flagFrame = 0;
  let dustLeft = rand(S.dustMinMs, S.dustMaxMs);
  let dustAcc = 0;

  const placeHang = () => hang.setPosition(trolleyX - HANG_CX, CABLE_Y);

  const spawnPuff = (x: number, y: number) => {
    const p = puffs.find((q) => !q.active);
    if (!p) return;
    p.active = true;
    p.x = x;
    p.y = y;
    p.step = 0;
    p.img.setVisible(true);
    drawPuff(p);
  };
  const drawPuff = (p: Puff) => {
    const f = p.step < 2 ? 0 : p.step < 5 ? 1 : p.step < 7 ? 2 : 3;
    const key = `site-dust${f}`;
    if (p.img.texture.key !== key) p.img.setTexture(key);
    p.img.setPosition(p.x - (DUST[f][0].length >> 1), p.y);
    // ultimi scatti: lampeggio invece di dissolvenza
    if (f === 3) p.img.setVisible(p.step % 2 === 1);
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
      hang.setTexture(`site-hang${step}`);
    }

    // --- lampeggianti e bandierina
    beaconAcc += dt;
    if (beaconAcc >= S.beaconMs) {
      beaconAcc %= S.beaconMs;
      beaconOn = !beaconOn;
      beacon.setTexture(beaconOn ? 'site-beacon-on' : 'site-beacon-off');
    }
    lampAcc += dt;
    if (lampAcc >= S.lampMs) {
      lampAcc %= S.lampMs;
      lampPhase = !lampPhase;
      lampA.setTexture(lampPhase ? 'site-lamp-off' : 'site-lamp-y');
      lampB.setTexture(lampPhase ? 'site-lamp-o' : 'site-lamp-off');
    }
    flagAcc += dt;
    if (flagAcc >= S.flagMs) {
      flagAcc %= S.flagMs;
      flagFrame ^= 1;
      flag.setTexture(flagFrame ? 'site-flag1' : 'site-flag0');
    }

    // --- polvere: nuovi sbuffi ogni tanto, salgono a scatti e svaniscono
    dustLeft -= dt;
    if (dustLeft <= 0) {
      dustLeft = rand(S.dustMinMs, S.dustMaxMs);
      const [a, b] = DUST_SPANS[Math.random() < 0.5 ? 0 : 1];
      const x = Math.round(rand(a, b - 6));
      const y = Math.round(rand(DUST_Y_MIN, DUST_Y_MAX));
      spawnPuff(x, y);
      if (Math.random() < 0.4) spawnPuff(x + 4, y + 1);
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
        p.y -= 1;
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
