import Phaser from 'phaser';
import { TUNNEL_DEEP as S } from '../config/balance';
import { C, col } from '../config/palette';
import { isMuted, tone } from '../audio/sfx';
import { spawnParticles } from '../gfx/effects';
import { pixelText } from '../gfx/pixelFont';
import { makeSprite, type SpriteData } from '../gfx/pixelSprite';
import { Subscriptions } from '../systems/events';
import { ROAD, TBM, TW, proj } from '../gfx/tunnelSprites';

/**
 * MONDO 3 (500 M): extra sopra la galleria del mondo 2 (buildTunnelWorld),
 * chiamato da Game solo nel mondo 3. Più in fondo: più sporco, più buio, più
 * roba che si muove. Le posizioni sono in coordinate mondo della galleria e
 * passano da `proj` (stesse misure dello sfondo, vedi gfx/tunnelSprites.ts).
 *
 * - velo scuro e rosso caldo sopra lo sfondo (più scuro in alto): luce calda e sporca;
 * - gocce che si formano sulla volta e cadono nelle pozzanghere (3 dello
 *   sfondo + 2 nuove), cerchi nell'acqua in prospettiva, schizzi e "plic";
 * - ventilatore a getto appeso alla volta, pale a 4 frame che ogni tanto rallentano;
 * - lampada da lavoro appesa vicino a chi guarda: pendolo con cono di luce a
 *   retino, dondola ai colpi forti e ogni tanto sfarfalla;
 * - cartello PERICOLO appeso a due catene con le lucine rosse alternate;
 * - mini escavatore sul marciapiede sinistro: braccio a 3 frame che scava,
 *   lampeggiante, polvere a ogni affondo;
 * - radio su una cassa (marciapiede destro) con l'altoparlante che pulsa e le
 *   note che salgono;
 * - topo che corre lungo un cordolo verso chi guarda (3 taglie secondo la
 *   profondità), si ferma ad annusare, scappa più veloce ai colpi forti;
 * - polvere di roccia: velo a retino davanti alla talpa e granelli sospesi;
 *   ai colpi forti cadono sassolini dalla volta.
 *
 * Depth: pozzanghere 0.06, cerchi 0.07, ventilatore 0.11, foschia 0.3,
 * escavatore / radio / topo 0.225..0.255 (secondo la profondità), velo 0.31,
 * gocce 0.32, sassolini 0.33, granelli 0.35, cartello e lampada 0.4.
 * Prestazioni: ~45 oggetti creati una volta (pool compresi); le due Graphics
 * (cerchi, lampada) si ridisegnano solo quando cambiano. Niente corpi fisici.
 */

const D_PUDDLE = 0.06;
const D_RIPPLE = 0.07;
const D_FAN = 0.11;
const D_HAZE = 0.3;
const D_MOOD = 0.31;
const D_DROP = 0.32;
const D_PEBBLE = 0.33;
const D_MOTE = 0.35;
const D_NEAR = 0.4;

/** depth degli oggetti sul pavimento: più vicini = più sopra (talpa 0.2..0.22, navetta 0.24) */
const floorDepth = (Z: number) => 0.225 + 0.03 * (1 - Z / TW.tbmZ);

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
/** quota della volta sopra una X (mondo) */
const vaultY = (X: number) => TW.yc - Math.sqrt(TW.r * TW.r - X * X);
/** quota del marciapiede rialzato */
const WALK_Y = TW.yf - ROAD.curbH;

/** pozzanghere nuove del mondo 3 (centro X, Z e semiassi), oltre a quelle dello sfondo */
const NEW_PUDDLES: readonly [number, number, number, number][] = [
  [38, 160, 9, 14],
  [-30, 121, 7, 10],
];
/** punti di gocciolamento: sopra le pozzanghere dello sfondo e sopra quelle nuove */
const DRIPS: readonly { X: number; Z: number }[] = [
  { X: 14, Z: 132 },
  { X: -40, Z: 205 },
  { X: -20, Z: 290 },
  { X: 38, Z: 160 },
  { X: -30, Z: 121 },
];

/** ventilatore a getto (centro in mondo, raggio a schermo dello sprite) */
const FAN = { X: 22, Y: -36, Z: 115, r: 7 } as const;
/** perno della lampada appesa (mondo) */
const LAMP = { X: 24, Z: 62 } as const;
/** cartello PERICOLO: profondità e mezza distanza tra le catene (mondo) */
const DANGER = { Z: 56, half: 9 } as const;
/** escavatore (cingoli sul marciapiede sinistro), radio (marciapiede destro) */
const DIGGER = { X: -82, Z: 205 } as const;
const RADIO = { X: 76, Z: 165 } as const;
/** percorso del topo lungo il cordolo */
const RAT = { X: 66, z0: 300, z1: 95 } as const;

// ---------------------------------------------------------------- sprite (da stringhe)

/** Ventilatore 15x15: anello grigio con contorno, 3 pale chiare larghe che girano (4 frame). */
function fanRows(frame: number): SpriteData {
  const n = FAN.r * 2 + 1;
  const rows: string[] = [];
  const phase = (frame * (Math.PI * 2)) / 3 / 4;
  for (let j = 0; j < n; j++) {
    let row = '';
    for (let i = 0; i < n; i++) {
      const dx = i - FAN.r;
      const dy = j - FAN.r;
      const d = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      if (d > FAN.r + 0.5) row += '.';
      else if (d > FAN.r - 0.5) row += '0';
      else if (d > FAN.r - 1.5) row += dy < -2 ? 'd' : 'e';
      else if (d < 1.5) row += '3';
      else {
        // pala: bordo d'attacco bianco, corpo argento; tra le pale il buio del condotto
        const b = Math.sin(3 * (a - phase));
        row += b > 0.75 ? 'c' : b > 0.1 ? 'd' : d > FAN.r - 2.5 ? '0' : 'f';
      }
    }
    rows.push(row);
  }
  return rows;
}

/** Escavatore 18x14 (cabina a sinistra, braccio verso la strada), 3 pose del braccio. */
const DIGGER_BASE: readonly string[] = [
  '..................',
  '..................',
  '..................',
  '..................',
  '..................',
  '..................',
  '.00000............',
  '.0bb40............',
  '.0ab440...........',
  '0444444000........',
  '0333333330........',
  '0ffffffff0........',
  '0f0ff0ff0f........',
  '.00000000.........',
];
/** [gomito, punta della benna] per posa: alto, a metà, dentro la terra */
const DIGGER_POSES: readonly (readonly [number, number, number, number])[] = [
  [11, 2, 14, 6],
  [12, 3, 16, 9],
  [12, 5, 15, 12],
];
const DIGGER_ROOT = { x: 6, y: 8 } as const;

function diggerRows(pose: number): SpriteData {
  const g = DIGGER_BASE.map((r) => [...r]);
  const W = g[0].length;
  const H = g.length;
  const arm: [number, number][] = [];
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let k = 0; k <= n; k++) arm.push([Math.round(x0 + ((x1 - x0) * k) / n), Math.round(y0 + ((y1 - y0) * k) / n)]);
  };
  const [ex, ey, tx, ty] = DIGGER_POSES[pose];
  line(DIGGER_ROOT.x, DIGGER_ROOT.y, ex, ey);
  line(ex, ey, tx, ty);
  const set = (x: number, y: number, c: string) => {
    if (x >= 0 && y >= 0 && x < W && y < H) g[y][x] = c;
  };
  for (const [x, y] of arm) set(x, y, '4');
  // benna 2x2 alla punta
  for (const [x, y] of [[tx, ty], [tx + 1, ty], [tx, ty - 1], [tx + 1, ty - 1]] as const) set(x, y, 'e');
  // contorno scuro attorno a braccio e benna (solo sui pixel vuoti)
  const out: [number, number][] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (g[y][x] !== '.') continue;
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const c = g[y + dy]?.[x + dx];
        return c === '4' || c === 'e';
      });
      if (near) out.push([x, y]);
    }
  }
  for (const [x, y] of out) g[y][x] = '0';
  return g.map((r) => r.join(''));
}

/** Radio rossa su una cassa di legno, 12x14; il frame 1 sposta il retino dell'altoparlante. */
function radioRows(frame: 0 | 1): SpriteData {
  const grille = frame === 0 ? '.02d0d0d20..' : '.020d0d0d0..';
  return [
    '........0...',
    '.......0....',
    '..0000000...',
    '.022222220..',
    grille,
    frame === 0 ? '.020d0d040..' : '.02d0d0d40..',
    '.022222220..',
    '.000000000..',
    '000000000000',
    '033333333330',
    '011111111110',
    '033333333330',
    '011111111110',
    '000000000000',
  ];
}

const NOTE: SpriteData = ['.44', '.4.', '.4.', '44.', '44.'];
const NOTE_B: SpriteData = ['.bb', '.b.', '.b.', 'bb.', 'bb.'];

/** topo che corre verso sinistra: [piccolo, medio, grande] x 2 frame */
const RAT_ROWS: readonly (readonly [SpriteData, SpriteData])[] = [
  [
    ['ff.', 'fff'],
    ['ff.', 'f.f'],
  ],
  [
    ['.ffff...', '2ffffff.', '.ffffffe', '..0..0.e'],
    ['.ffff...', '2ffffff.', '.ffffffe', '.0...0e.'],
  ],
  [
    ['..eeee.....', '.ffffff....', '2fffffffe..', '.ffffffff.e', '..00..00.e.'],
    ['..eeee.....', '.ffffff....', '2fffffffe..', '.ffffffffe.', '.0..0..0..e'],
  ],
];
/** taglia del topo per profondità */
const ratSize = (Z: number) => (Z > 200 ? 0 : Z > 128 ? 1 : 2);

/** Velo di polvere davanti alla talpa: retino rado di grigi dentro un'ellisse. */
function hazeRows(): SpriteData {
  const w = 96;
  const h = 46;
  const rows: string[] = [];
  for (let j = 0; j < h; j++) {
    let row = '';
    for (let i = 0; i < w; i++) {
      const e = ((i - w / 2) / (w / 2)) ** 2 + ((j - h / 2) / (h / 2)) ** 2;
      const k = (i * 7 + j * 13) % 17;
      row += e < 1 && (k === 0 || (e < 0.45 && k === 9)) ? (j % 3 === 0 ? 'd' : 'e') : '.';
    }
    rows.push(row);
  }
  return rows;
}

/** Registra le texture del mondo 3 (chiavi `td-`, saltate se già presenti). */
function registerDeepSprites(scene: Phaser.Scene): void {
  for (let k = 0; k < 4; k++) makeSprite(scene, `td-fan${k}`, fanRows(k));
  for (let k = 0; k < DIGGER_POSES.length; k++) makeSprite(scene, `td-dig${k}`, diggerRows(k));
  makeSprite(scene, 'td-radio0', radioRows(0));
  makeSprite(scene, 'td-radio1', radioRows(1));
  makeSprite(scene, 'td-note0', NOTE);
  makeSprite(scene, 'td-note1', NOTE_B);
  RAT_ROWS.forEach((frames, s) => frames.forEach((rows, f) => makeSprite(scene, `td-rat${s}-${f}`, rows)));
  makeSprite(scene, 'td-haze', hazeRows());
}

// ---------------------------------------------------------------- suoni

let lastPlink = 0;
function playPlink(near: boolean): void {
  if (isMuted()) return;
  const now = performance.now();
  if (now - lastPlink < S.plinkMinGapMs) return;
  lastPlink = now;
  const f = near ? 1500 : 2100;
  tone({ type: 'sine', from: f, to: f * 0.55, dur: 0.07, vol: near ? 0.035 : 0.018 });
}

// ---------------------------------------------------------------- stato dei pool

interface Drop {
  rect: Phaser.GameObjects.Rectangle;
  X: number;
  Z: number;
  Y: number;
  vy: number;
  /** ms in cui la goccia si gonfia attaccata alla volta prima di cadere */
  hang: number;
  active: boolean;
}
interface Ripple {
  X: number;
  Z: number;
  step: number;
  active: boolean;
}
interface Note {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  step: number;
  active: boolean;
}
interface Mote {
  rect: Phaser.GameObjects.Rectangle;
  x: number;
  y: number;
  dx: number;
}

/** Aggiunge gli extra del mondo 3 alla galleria; si ripulisce allo shutdown della scena. */
export function bindTunnelDeep(scene: Phaser.Scene): void {
  registerDeepSprites(scene);
  const add = (x: number, y: number, key: string, depth: number) =>
    scene.add.image(Math.round(x), Math.round(y), key).setOrigin(0).setDepth(depth);

  // ---- velo: luce più calda e sporca sullo sfondo (Tony resta pulito, è sopra)
  scene.add.rectangle(0, 0, TW.width, TW.groundY, col(C.black), S.moodDarkAlpha).setOrigin(0).setDepth(D_MOOD);
  scene.add.rectangle(0, 0, TW.width, TW.groundY, col(C.red), S.moodWarmAlpha).setOrigin(0).setDepth(D_MOOD);
  scene.add.rectangle(0, 0, TW.width, S.moodTopH, col(C.black), S.moodTopAlpha).setOrigin(0).setDepth(D_MOOD);

  // ---- pozzanghere nuove (disegnate una volta, in prospettiva, riga per riga)
  const pud = scene.add.graphics().setDepth(D_PUDDLE);
  for (const [px, pz, rx, rz] of NEW_PUDDLES) {
    const yTop = Math.floor(proj(0, TW.yf, pz + rz).y);
    const yBot = Math.ceil(proj(0, TW.yf, pz - rz).y);
    for (let y = yTop; y <= yBot; y++) {
      const Z = (TW.yf * TW.f) / (y + 0.5 - TW.vpY);
      for (let x = 0; x < TW.width; x++) {
        const X = ((x + 0.5 - TW.vpX) * Z) / TW.f;
        const e = ((X - px) / rx) ** 2 + ((Z - pz) / rz) ** 2;
        if (e >= 1) continue;
        // bordo lontano più chiaro (riflesso), dentro acqua scura con qualche luccichio
        const rim = e > 0.6 && Z > pz;
        pud.fillStyle(col(rim ? C.teal : (x * 3 + y * 5) % 23 === 0 ? C.sky : C.navy));
        pud.fillRect(x, y, 1, 1);
      }
    }
  }

  // ---- gocce dalla volta + cerchi nell'acqua
  const drops: Drop[] = [];
  for (let i = 0; i < S.dripPool; i++) {
    const rect = scene.add.rectangle(0, 0, 1, 1, col(C.cyan)).setOrigin(0).setDepth(D_DROP).setVisible(false);
    drops.push({ rect, X: 0, Z: 0, Y: 0, vy: 0, hang: 0, active: false });
  }
  const ripples: Ripple[] = Array.from({ length: S.ripplePool }, () => ({ X: 0, Z: 0, step: 0, active: false }));
  const rippleG = scene.add.graphics().setDepth(D_RIPPLE);
  const drawRipples = () => {
    rippleG.clear();
    for (const r of ripples) {
      if (!r.active) continue;
      const R = (S.rippleR * (r.step + 1)) / S.rippleSteps;
      rippleG.fillStyle(col(r.step < S.rippleSteps - 2 ? C.cyan : C.teal));
      const n = 10 + Math.round((R * 160) / r.Z);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const p = proj(r.X + R * Math.cos(a), TW.yf, r.Z + R * Math.sin(a));
        rippleG.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
      }
    }
  };
  const startRipple = (X: number, Z: number) => {
    const r = ripples.find((q) => !q.active) ?? ripples[0];
    Object.assign(r, { X, Z, step: 0, active: true });
  };
  const drawDrop = (d: Drop) => {
    const p = proj(d.X, d.Y, d.Z);
    const h = d.hang > 0 ? 1 : d.Z < 170 ? 2 : 1;
    d.rect.setSize(1, h).setPosition(Math.round(p.x), Math.round(p.y));
  };
  const spawnDrop = () => {
    const d = drops.find((q) => !q.active);
    if (!d) return;
    const at = pick(DRIPS);
    Object.assign(d, { X: at.X, Z: at.Z, Y: vaultY(at.X) + 1, vy: 0, hang: rand(200, 500), active: true });
    d.rect.setVisible(true);
    drawDrop(d);
  };

  // ---- ventilatore a getto appeso alla volta (staffa + pale)
  const fp = proj(FAN.X, FAN.Y, FAN.Z);
  const fx = Math.round(fp.x);
  const fy = Math.round(fp.y);
  const top = Math.round(proj(FAN.X, vaultY(FAN.X), FAN.Z).y);
  scene.add.rectangle(fx - 1, top, 3, fy - FAN.r - top, col(C.black)).setOrigin(0).setDepth(D_FAN);
  scene.add.rectangle(fx, top, 1, fy - FAN.r - top, col(C.slate)).setOrigin(0).setDepth(D_FAN);
  const fan = add(fx - FAN.r, fy - FAN.r, 'td-fan0', D_FAN);

  // ---- cartello PERICOLO appeso a due catene
  const crownY = Math.round(proj(0, TW.yc - TW.r, DANGER.Z).y);
  const chainL = Math.round(proj(-DANGER.half * 2, 0, DANGER.Z).x);
  const chainR = Math.round(proj(DANGER.half * 2, 0, DANGER.Z).x);
  const label = pixelText(scene, 0, 0, 'PERICOLO', C.yellow);
  const pw = label.width + 6;
  const ph = 13;
  const panelY = crownY + 7;
  const chains = scene.add.graphics().setDepth(D_NEAR);
  for (const cx of [chainL, chainR]) {
    for (let y = crownY; y < panelY; y++) {
      chains.fillStyle(col(y % 2 === 0 ? C.silver : C.charcoal));
      chains.fillRect(cx, y, 1, 1);
    }
  }
  const panel = scene.add.graphics();
  const px0 = -Math.floor(pw / 2);
  panel.fillStyle(col(C.black));
  panel.fillRect(px0, 0, pw, ph);
  panel.fillStyle(col(C.red));
  panel.fillRect(px0 + 1, 1, pw - 2, ph - 2);
  // fascia di pericolo gialla/nera in basso
  for (let x = px0 + 1; x < px0 + pw - 1; x++) {
    panel.fillStyle(col((Math.floor((x - px0) / 2) & 1) === 0 ? C.yellow : C.black));
    panel.fillRect(x, ph - 3, 1, 2);
  }
  label.setPosition(px0 + 3, 2);
  const lampL = scene.add.rectangle(px0 + 1, -2, 2, 2, col(C.red)).setOrigin(0);
  const lampR = scene.add.rectangle(px0 + pw - 3, -2, 2, 2, col(C.charcoal)).setOrigin(0);
  const danger = scene.add.container(90, panelY, [panel, label, lampL, lampR]).setDepth(D_NEAR);
  let dangerOn = false;
  let dangerAcc = 0;
  let swingLeft = 0;
  let swingAcc = 0;

  // ---- lampada da lavoro appesa: pendolo con cono di luce
  const lampPivot = proj(LAMP.X, vaultY(LAMP.X), LAMP.Z);
  const lpx = Math.round(lampPivot.x);
  const lpy = Math.round(lampPivot.y);
  const lampG = scene.add.graphics().setDepth(D_NEAR);
  let theta = 0.12;
  let omega = 0;
  let drawnQ = Number.NaN;
  let lampLit = true;
  let drawnLit = !lampLit;
  let flickerLeft = rand(S.lampFlickerMinMs, S.lampFlickerMaxMs);
  let flickerSteps = 0;
  let flickerAcc = 0;
  const drawLamp = () => {
    const q = Math.round(theta / S.lampStep);
    if (q === drawnQ && drawnLit === lampLit) return;
    drawnQ = q;
    drawnLit = lampLit;
    const a = q * S.lampStep;
    const sx = Math.sin(a);
    const sy = Math.cos(a);
    lampG.clear();
    // cono di luce a retino, dalla lampadina lungo il cavo
    if (lampLit) {
      for (let t = 3; t < 40; t++) {
        const hw = 1 + t * 0.36;
        for (let u = -hw; u <= hw; u += 1) {
          const x = Math.round(lpx + sx * (S.lampLen + t) + sy * u);
          const y = Math.round(lpy + sy * (S.lampLen + t) - sx * u);
          const near = t < 15;
          if (near ? (x + y * 3) % 4 !== 0 : (x * 2 + y * 3) % 7 !== 0) continue;
          lampG.fillStyle(col(near ? C.yellow : C.orange));
          lampG.fillRect(x, y, 1, 1);
        }
      }
    }
    // cavo
    lampG.fillStyle(col(C.black));
    for (let t = 0; t < S.lampLen; t++) lampG.fillRect(Math.round(lpx + sx * t), Math.round(lpy + sy * t), 1, 1);
    // paralume arancio con contorno e lampadina
    const bx = Math.round(lpx + sx * S.lampLen);
    const by = Math.round(lpy + sy * S.lampLen);
    lampG.fillStyle(col(C.black));
    lampG.fillRect(bx - 2, by - 1, 5, 3);
    lampG.fillRect(bx - 3, by + 1, 7, 2);
    lampG.fillStyle(col(C.orange));
    lampG.fillRect(bx - 1, by, 3, 1);
    lampG.fillRect(bx - 2, by + 1, 5, 1);
    lampG.fillStyle(col(lampLit ? C.white : C.charcoal));
    lampG.fillRect(bx - 1, by + 2, 3, 1);
    if (lampLit) {
      lampG.fillStyle(col(C.yellow));
      lampG.fillRect(bx, by + 3, 1, 1);
    }
  };
  drawLamp();

  // ---- mini escavatore sul marciapiede sinistro
  const dp = proj(DIGGER.X, WALK_Y, DIGGER.Z);
  const digX = Math.round(dp.x) - 6;
  const digY = Math.round(dp.y) - 14;
  const digger = add(digX, digY, 'td-dig0', floorDepth(DIGGER.Z));
  const beacon = scene.add.rectangle(digX + 3, digY + 5, 1, 1, col(C.orange)).setOrigin(0).setDepth(floorDepth(DIGGER.Z));
  const DIG_SEQ = [0, 1, 2, 2, 1, 0] as const;
  let digIdx = 0;
  let digAcc = 0;
  let digPause = rand(S.digPauseMinMs, S.digPauseMaxMs);
  let beaconAcc = 0;
  let beaconOn = true;

  // ---- radio sulla cassa (marciapiede destro) + note
  const rp = proj(RADIO.X, WALK_Y, RADIO.Z);
  const radioX = Math.round(rp.x) - 6;
  const radioY = Math.round(rp.y) - 14;
  const radio = add(radioX, radioY, 'td-radio0', floorDepth(RADIO.Z));
  let radioFrame: 0 | 1 = 0;
  let radioAcc = 0;
  const notes: Note[] = [];
  for (let i = 0; i < S.notePool; i++) {
    const img = add(0, 0, `td-note${i % 2}`, floorDepth(RADIO.Z) + 0.001).setVisible(false);
    notes.push({ img, x: 0, y: 0, step: 0, active: false });
  }
  let noteLeft = rand(S.noteMinMs, S.noteMaxMs);
  let noteAcc = 0;

  // ---- topo lungo il cordolo
  const rat = add(0, 0, 'td-rat0-0', D_DROP).setVisible(false);
  let ratZ = 0;
  let ratSide = -1;
  let ratRunning = false;
  let ratWait = rand(S.ratWaitMinMs, S.ratWaitMaxMs) * 0.4;
  let ratSniffZ = 0;
  let ratSniff = 0;
  let ratFlee = false;
  let ratFrame = 0;
  let ratFrameAcc = 0;
  let ratAcc = 0;
  const drawRat = () => {
    const s = ratSize(ratZ);
    const key = `td-rat${s}-${ratSniff > 0 ? 0 : ratFrame}`;
    if (rat.texture.key !== key) rat.setTexture(key);
    const p = proj(ratSide * RAT.X, WALK_Y, ratZ);
    const w = rat.width;
    // corre col muso verso il bordo dello schermo (verso chi guarda)
    rat.setFlipX(ratSide > 0);
    rat.setPosition(Math.round(p.x - w / 2), Math.round(p.y) - rat.height);
    rat.setDepth(floorDepth(ratZ) + 0.002);
  };

  // ---- polvere: velo davanti alla talpa + granelli sospesi
  const haze = add(TBM.cx - 48, TBM.cy - 10, 'td-haze', D_HAZE);
  let hazeAcc = 0;
  let hazeShift = 0;
  const moteColors = [C.slate, C.silver, C.charcoal];
  const motes: Mote[] = [];
  const resetMote = (m: Mote, anywhere: boolean) => {
    m.x = rand(4, TW.width - 4);
    m.y = anywhere ? rand(40, TW.groundY - 6) : TW.groundY - 6;
    m.dx = Math.random() < 0.5 ? -1 : 1;
  };
  for (let i = 0; i < S.motePool; i++) {
    const rect = scene.add.rectangle(0, 0, 1, 1, col(pick(moteColors))).setOrigin(0).setDepth(D_MOTE);
    const m: Mote = { rect, x: 0, y: 0, dx: 1 };
    resetMote(m, true);
    rect.setPosition(Math.round(m.x), Math.round(m.y));
    motes.push(m);
  }
  let moteAcc = 0;

  let dripLeft = rand(S.dripMinMs, S.dripMaxMs);
  let rippleAcc = 0;
  let fanAcc = 0;
  let fanFrame = 0;
  let fanSlowLeft = rand(S.fanSlowMinMs, S.fanSlowMaxMs);
  let fanSlow = 0;

  const onUpdate = (_t: number, rawDt: number) => {
    const dt = Math.min(rawDt, 50);

    // ---- gocce
    dripLeft -= dt;
    if (dripLeft <= 0) {
      dripLeft = rand(S.dripMinMs, S.dripMaxMs);
      spawnDrop();
    }
    for (const d of drops) {
      if (!d.active) continue;
      if (d.hang > 0) {
        d.hang -= dt;
        if (d.hang > 0) continue;
      } else {
        d.vy += (S.dripGravity * dt) / 1000;
        d.Y += (d.vy * dt) / 1000;
      }
      if (d.Y >= TW.yf) {
        d.active = false;
        d.rect.setVisible(false);
        startRipple(d.X, d.Z);
        const p = proj(d.X, TW.yf, d.Z);
        spawnParticles(scene, p.x, p.y - 1, {
          count: 2,
          colors: [C.cyan, C.white],
          speed: 0.6,
          angle: -Math.PI / 2,
          spread: 1.6,
          gravity: 0.08,
          lifeMs: 220,
          size: 1,
          depth: D_DROP,
        });
        if (Math.random() < S.plinkChance) playPlink(d.Z < 170);
        continue;
      }
      drawDrop(d);
    }
    rippleAcc += dt;
    if (rippleAcc >= S.rippleStepMs) {
      rippleAcc %= S.rippleStepMs;
      let any = false;
      for (const r of ripples) {
        if (!r.active) continue;
        any = true;
        r.step++;
        if (r.step >= S.rippleSteps) r.active = false;
      }
      if (any) drawRipples();
    }

    // ---- ventilatore (ogni tanto rallenta, come se mancasse corrente)
    fanSlowLeft -= dt;
    if (fanSlowLeft <= 0) {
      fanSlowLeft = rand(S.fanSlowMinMs, S.fanSlowMaxMs);
      fanSlow = S.fanSlowLenMs;
    }
    if (fanSlow > 0) fanSlow -= dt;
    fanAcc += dt;
    const fanMs = fanSlow > 0 ? S.fanSlowMs : S.fanFrameMs;
    if (fanAcc >= fanMs) {
      fanAcc %= fanMs;
      fanFrame = (fanFrame + 1) % 4;
      fan.setTexture(`td-fan${fanFrame}`);
    }

    // ---- lampada: pendolo smorzato, disegno solo quando cambia lo scatto
    omega += -S.lampGravity * Math.sin(theta) * dt;
    omega *= Math.pow(S.lampDamping, dt);
    theta += omega * dt;
    if (flickerSteps > 0) {
      flickerAcc += dt;
      if (flickerAcc >= S.lampFlickerStepMs) {
        flickerAcc %= S.lampFlickerStepMs;
        flickerSteps--;
        lampLit = flickerSteps === 0 || Math.random() < 0.4;
      }
    } else {
      flickerLeft -= dt;
      if (flickerLeft <= 0) {
        flickerLeft = rand(S.lampFlickerMinMs, S.lampFlickerMaxMs);
        flickerSteps = S.lampFlickerSteps;
        flickerAcc = 0;
        lampLit = false;
      }
    }
    drawLamp();

    // ---- cartello: lucine alternate e dondolio di 1px dopo un colpo
    dangerAcc += dt;
    if (dangerAcc >= S.dangerBlinkMs) {
      dangerAcc %= S.dangerBlinkMs;
      dangerOn = !dangerOn;
      lampL.setFillStyle(col(dangerOn ? C.red : C.charcoal));
      lampR.setFillStyle(col(dangerOn ? C.charcoal : C.red));
    }
    if (swingLeft > 0) {
      swingAcc += dt;
      if (swingAcc >= S.dangerSwingMs) {
        swingAcc %= S.dangerSwingMs;
        swingLeft--;
        danger.x = 90 + (swingLeft === 0 ? 0 : swingLeft % 2 === 0 ? 1 : -1);
      }
    }

    // ---- escavatore: ciclo del braccio, polvere all'affondo, lampeggiante
    if (digPause > 0) digPause -= dt;
    else {
      digAcc += dt;
      if (digAcc >= S.digFrameMs) {
        digAcc %= S.digFrameMs;
        digIdx++;
        if (digIdx >= DIG_SEQ.length) {
          digIdx = 0;
          digPause = rand(S.digPauseMinMs, S.digPauseMaxMs);
        }
        const pose = DIG_SEQ[digIdx];
        digger.setTexture(`td-dig${pose}`);
        if (pose === 2 && DIG_SEQ[digIdx - 1] === 1) {
          const [, , tx, ty] = DIGGER_POSES[2];
          spawnParticles(scene, digX + tx + 1, digY + ty, {
            count: 3,
            colors: [C.charcoal, C.slate, C.plum],
            speed: 0.5,
            angle: -Math.PI / 2,
            spread: 2,
            gravity: 0.05,
            lifeMs: 380,
            size: 1,
            depth: floorDepth(DIGGER.Z) + 0.001,
          });
        }
      }
    }
    beaconAcc += dt;
    if (beaconAcc >= S.beaconMs) {
      beaconAcc %= S.beaconMs;
      beaconOn = !beaconOn;
      beacon.setFillStyle(col(beaconOn ? C.yellow : C.red));
    }

    // ---- radio: altoparlante che pulsa e note che salgono ondeggiando
    radioAcc += dt;
    if (radioAcc >= S.radioBeatMs) {
      radioAcc %= S.radioBeatMs;
      radioFrame = radioFrame === 0 ? 1 : 0;
      radio.setTexture(`td-radio${radioFrame}`);
    }
    noteLeft -= dt;
    if (noteLeft <= 0) {
      noteLeft = rand(S.noteMinMs, S.noteMaxMs);
      const n = notes.find((q) => !q.active);
      if (n) {
        Object.assign(n, { x: radioX + rand(1, 7), y: radioY - 1, step: 0, active: true });
        n.img.setPosition(Math.round(n.x), Math.round(n.y) - 5).setVisible(true);
      }
    }
    noteAcc += dt;
    if (noteAcc >= S.noteStepMs) {
      noteAcc %= S.noteStepMs;
      for (const n of notes) {
        if (!n.active) continue;
        n.step++;
        if (n.step >= S.noteSteps) {
          n.active = false;
          n.img.setVisible(false);
          continue;
        }
        n.y -= 1;
        n.x += n.step % 4 < 2 ? 1 : -1;
        n.img.setPosition(Math.round(n.x), Math.round(n.y) - 5);
        n.img.setVisible(n.step < S.noteSteps - 3 || n.step % 2 === 0);
      }
    }

    // ---- topo
    if (!ratRunning) {
      ratWait -= dt;
      if (ratWait <= 0) {
        ratRunning = true;
        ratFlee = false;
        ratSide = Math.random() < 0.5 ? -1 : 1;
        ratZ = RAT.z0;
        ratSniff = 0;
        ratSniffZ = Math.random() < S.ratSniffChance ? rand(150, 240) : 0;
        rat.setVisible(true);
        drawRat();
      }
    } else {
      ratAcc += dt;
      if (ratAcc >= S.ratStepMs) {
        const step = ratAcc;
        ratAcc = 0;
        if (ratSniff > 0) ratSniff -= step;
        else {
          ratZ -= (S.ratSpeed * (ratFlee ? S.ratFleeMult : 1) * step) / 1000;
          if (ratSniffZ > 0 && ratZ <= ratSniffZ) {
            ratSniffZ = 0;
            ratSniff = S.ratSniffMs;
          }
          ratFrameAcc += step * (ratFlee ? 2 : 1);
          if (ratFrameAcc >= S.ratFrameMs) {
            ratFrameAcc %= S.ratFrameMs;
            ratFrame ^= 1;
          }
        }
        if (ratZ <= RAT.z1) {
          ratRunning = false;
          rat.setVisible(false);
          ratWait = rand(S.ratWaitMinMs, S.ratWaitMaxMs);
        } else drawRat();
      }
    }

    // ---- polvere
    hazeAcc += dt;
    if (hazeAcc >= S.moteStepMs * 4) {
      hazeAcc %= S.moteStepMs * 4;
      hazeShift = hazeShift === 0 ? 1 : 0;
      haze.setPosition(TBM.cx - 48 + hazeShift, TBM.cy - 10 - hazeShift);
    }
    moteAcc += dt;
    if (moteAcc >= S.moteStepMs) {
      moteAcc %= S.moteStepMs;
      for (const m of motes) {
        // salgono piano con la corrente d'aria e ondeggiano di lato
        m.y -= Math.random() < 0.5 ? 1 : 0;
        if (Math.random() < 0.3) m.x += m.dx;
        if (Math.random() < 0.05) m.dx = -m.dx;
        if (m.y < 36 || m.x < 1 || m.x > TW.width - 2) resetMote(m, false);
        m.rect.setPosition(Math.round(m.x), Math.round(m.y));
      }
    }
  };

  const subs = new Subscriptions();
  // colpo forte: la lampada dondola, il cartello trema, cadono sassolini, il topo scappa
  subs.on('damage', (e) => {
    if (!e.strong) return;
    const kick = Math.min(S.lampMaxSpeed, S.lampKick + e.amount * S.lampKickPerDamage);
    omega += (omega >= 0 ? 1 : -1) * (Math.random() < 0.25 ? -kick : kick);
    omega = Math.max(-S.lampMaxSpeed, Math.min(S.lampMaxSpeed, omega)); // colpi a raffica: non fa il giro della morte
    swingLeft = S.dangerSwingSteps;
    swingAcc = S.dangerSwingMs;
    for (let k = 0; k < 2; k++) {
      const X = rand(-70, 70);
      const Z = rand(70, 160);
      const p = proj(X, vaultY(X) + 2, Z);
      spawnParticles(scene, p.x, p.y, {
        count: Math.ceil(S.pebbleCount / 2),
        colors: [C.slate, C.charcoal, C.silver],
        speed: 0.4,
        angle: Math.PI / 2,
        spread: 0.8,
        gravity: 0.12,
        lifeMs: 900,
        size: 1,
        depth: D_PEBBLE,
      });
    }
    if (ratRunning) {
      ratFlee = true;
      ratSniff = 0;
      ratSniffZ = 0;
    }
  });
  scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
    subs.clear();
  });
}
