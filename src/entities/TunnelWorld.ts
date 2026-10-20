import Phaser from 'phaser';
import { TUNNEL_WORLD as S } from '../config/balance';
import { C, col } from '../config/palette';
import { isMuted, noise, tone } from '../audio/sfx';
import { spawnParticles } from '../gfx/effects';
import { Subscriptions } from '../systems/events';
import {
  BELT,
  CUTTER_FRAMES,
  LAMPS,
  SIGNS,
  SMOKE,
  TBM,
  TBM_BEACONS_XY,
  TBM_CUTTER_XY,
  TBM_SHIELD_XY,
  ROAD,
  TW,
  VEHICLE_SIZES,
  VEHICLE_SPIN_MIN,
  VEHICLE_W,
  VEHICLE_BEACON_BIG,
  PERSON_H,
  WORKER_PTS,
  WORKER_TOP,
  WORKER_W,
  registerWorkerSprites,
  workerKey,
  type WorkerArmL,
  type WorkerArmR,
  proj,
  vehicleKey,
  registerTunnelSprites,
  signTopLeft,
} from '../gfx/tunnelSprites';

/**
 * MONDO 2: dentro la galleria. Vista centrale verso il fondo (punto di fuga
 * 90, 150), geometria e sprite in gfx/tunnelSprites.ts.
 *
 * - sfondo statico (una sola immagine 180x320): volta ad anelli di conci,
 *   tubo di ventilazione giallo appeso in chiave, cavi e staffe a sinistra,
 *   nastro trasportatore a destra, carreggiata in asfalto con mezzeria
 *   tratteggiata, margini e catarifrangenti, cordoli e marciapiedi di servizio,
 *   canaletta con grata, pozzanghere e riflessi dei neon, armadio rosso,
 *   armadietti, numeri degli anelli, cartelli appesi (uscita di emergenza,
 *   distanza), terreno di gioco in asfalto (y 292..319);
 * - 7 barre a neon in prospettiva: lampeggiano a scatti, ogni tanto una
 *   sfarfalla e si spegne (la sua "maschera d'ombra" scurisce la zona che
 *   illuminava), poi si riaccende; un colpo forte ne fa sfarfallare una;
 * - in fondo la talpa: testa fresante a 4 frame che gira, vibrazione e spinta
 *   di 1px, lampeggianti arancio, fumi e polvere in pool, scintille sul bordo,
 *   scavo a cicli con soste e ronzio basso;
 * - detriti che scorrono sul nastro, navetta da cantiere a 4 ruote (cassone
 *   passeggeri rialzato a finestrelle) che fa la spola sull'asfalto tra le
 *   fermate: verso di noi nella corsia sinistra con i fari e il loro alone,
 *   lontano nella destra con le luci rosse; lampeggiante arancio, ruote a 2
 *   frame, polvere; 2 operai lontani, luce di emergenza a raffiche;
 * - ogni tanto gli operai fanno la pausa sigaretta (insieme o uno alla volta):
 *   pacchetto, accendino, tirate con la brace di 1 px che lampeggia, sbuffi
 *   minuscoli, mozzicone lanciato; nel mondo 3 anche la birra (sorsi a
 *   garganella, goccia di schiuma) e una cassa accanto.
 *
 * Scala (1 unità ≈ 5 cm, vedi PERSON_H): tutto ciò che è dentro la galleria
 * ha la sua misura in unità mondo e diventa px con f / Z (operai, navetta,
 * detriti); a schermo restano interi.
 *
 * Depth: sfondo 0, ombre dei neon 0.05, neon/luce di emergenza 0.1, detriti
 * 0.12, talpa 0.2..0.22, alone dei fari 0.235, polvere 0.236 / 0.244, navetta
 * 0.24, cassa 0.249, operai 0.25, brace/goccia/accendino 0.251, fumi 0.3,
 * scintille 2.3.
 * Prestazioni: ~50 oggetti creati una volta (pool compresi); cambiano solo
 * texture, posizione e visibilità. Niente corpi fisici (vedi buildRoomBodies).
 */

/** Punto su cui parte zoomata la camera entrando nel mondo 2: il centro della talpa. */
export const TUNNEL_WORLD_FOCUS = { x: TBM.cx, y: TBM.cy } as const;

const D_SHADE = 0.05;
const D_NEON = 0.1;
const D_DEBRIS = 0.12;
const D_TBM = 0.2;
const D_CUTTER = 0.21;
const D_BEACON = 0.22;
const D_VEH = 0.24;
const D_WORKER = 0.25;
/** brace, mozzicone, goccia e accendino degli operai */
const D_WCIG = 0.251;
const D_SMOKE = 0.3;
const D_SPARK = 2.3;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

type NeonPhase = 'on' | 'flickerOff' | 'off' | 'flickerOn';
interface Neon {
  bar: Phaser.GameObjects.Image;
  shade: Phaser.GameObjects.Image;
  key: string;
  phase: NeonPhase;
  left: number;
  stepLeft: number;
  lit: boolean;
  blinkLeft: number;
}

interface Puff {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  drift: number;
  /** 0 fumi della talpa, 1 polvere, 2 fumo di sigaretta */
  set: 0 | 1 | 2;
  step: number;
  steps: number;
  active: boolean;
}

interface Debris {
  rect: Phaser.GameObjects.Rectangle;
  X: number;
  Z: number;
  /** lato del sasso (mondo) */
  size: number;
}

type WorkerPhase = 'work' | 'pocket' | 'place' | 'light' | 'drag' | 'idle' | 'drinkUp' | 'drinkTilt' | 'drinkDown' | 'throw';
interface Worker {
  img: Phaser.GameObjects.Image;
  kind: 0 | 1;
  /** profondità (mondo): decide se la navetta gli passa davanti */
  Z: number;
  h: number;
  mirror: boolean;
  /** angolo in alto a sinistra dello sprite e riga dei piedi */
  x0: number;
  y0: number;
  feetY: number;
  phase: WorkerPhase;
  left: number;
  frame: 0 | 1;
  frameLeft: number;
  r: WorkerArmR;
  l: WorkerArmL;
  /** tempo di pausa rimasto (finita la tirata in corso butta il mozzicone) */
  breakLeft: number;
  lit: boolean;
  ember: Phaser.GameObjects.Rectangle;
  emberAcc: number;
  emberHot: boolean;
  flash: Phaser.GameObjects.Image;
  flashAcc: number;
  puffsLeft: number;
  puffAcc: number;
  idleSmokeAcc: number;
  butt: Phaser.GameObjects.Rectangle;
  buttLeft: number;
  buttAcc: number;
  buttVx: number;
  buttVy: number;
  buttLanded: boolean;
  drop: Phaser.GameObjects.Rectangle;
  dropAcc: number;
}

/**
 * operai lontani: posizione mondo (piedi) e tipo. Fuori dalla sagoma della navetta
 * (corsie |X| <= 48): il primo sul marciapiede sinistro, il secondo sul bordo destro
 * della carreggiata, specchiato per fumare con la mano verso l'asse.
 */
const WORKERS: readonly { X: number; Z: number; kind: 0 | 1; mirror: boolean }[] = [
  { X: -68, Z: 318, kind: 0, mirror: false },
  { X: 56, Z: 300, kind: 1, mirror: true },
];
/** cassa di birra del mondo 3, sul marciapiede destro accanto al secondo operaio */
const CRATE = { X: 74, Z: 304 } as const;

/** quota del piano di calpestio: carreggiata o marciapiede rialzato */
const floorY = (X: number) => (Math.abs(X) >= ROAD.side ? TW.yf - ROAD.curbH : TW.yf);

let lastBzz = 0;
function playBzz(): void {
  if (isMuted()) return;
  const now = performance.now();
  if (now - lastBzz < S.bzzMinGapMs) return;
  lastBzz = now;
  tone({ type: 'square', from: 120, to: 110, dur: 0.05, vol: 0.03 });
  noise({ dur: 0.04, vol: 0.02, freq: 2500, highpass: true });
}
function playHum(start: boolean): void {
  if (isMuted()) return;
  tone({ type: 'triangle', from: 62, to: 48, dur: 1.3, vol: 0.09 });
  noise({ dur: 1.1, vol: 0.045, freq: 260, freqTo: 110 });
  if (start) tone({ type: 'square', from: 38, to: 58, dur: 0.6, vol: 0.035 });
}

/** Disegna l'interno della galleria e avvia le animazioni; si ripulisce allo shutdown della scena. */
export function buildTunnelWorld(scene: Phaser.Scene, opts: { world: 2 | 3 } = { world: 2 }): void {
  const beer = opts.world === 3;
  const bd = registerTunnelSprites(scene);
  const add = (x: number, y: number, key: string, depth: number) =>
    scene.add.image(Math.round(x), Math.round(y), key).setOrigin(0).setDepth(depth);

  // ---- sfondo statico
  add(0, 0, 'tw-bg', 0);

  // ---- neon + maschere d'ombra
  const neons: Neon[] = LAMPS.map((_, i) => {
    const b = bd.bars[i].on;
    const s = bd.shades[i];
    return {
      bar: add(b.x, b.y, `tw-neon${i}-on`, D_NEON),
      shade: add(s.x, s.y, `tw-shade${i}`, D_SHADE).setVisible(false),
      key: `tw-neon${i}`,
      phase: 'on',
      left: 0,
      stepLeft: 0,
      lit: true,
      blinkLeft: 0,
    };
  });
  const setLit = (n: Neon, lit: boolean) => {
    if (n.lit === lit) return;
    n.lit = lit;
    n.bar.setTexture(`${n.key}-${lit ? 'on' : 'off'}`);
    n.shade.setVisible(!lit);
    if (lit) playBzz();
  };
  const startFlicker = (n: Neon) => {
    n.phase = 'flickerOff';
    n.left = S.neonFlickerMs;
    n.stepLeft = 0;
  };

  // ---- luce di emergenza accanto al cartello di uscita
  const exitXY = signTopLeft(SIGNS.exit);
  const emer = add(exitXY.x - 4, exitXY.y + 4, 'tw-emer-off', D_NEON);

  // ---- talpa
  const shield = add(TBM_SHIELD_XY.x, TBM_SHIELD_XY.y, 'tw-tbm-shield', D_TBM);
  const cutter = add(TBM_CUTTER_XY.x, TBM_CUTTER_XY.y, 'tw-cutter0', D_CUTTER);
  const beacons = add(TBM_BEACONS_XY.x, TBM_BEACONS_XY.y, 'tw-beacons0', D_BEACON);
  const placeTbm = (dx: number, dy: number) => {
    shield.setPosition(TBM_SHIELD_XY.x + dx, TBM_SHIELD_XY.y + dy);
    cutter.setPosition(TBM_CUTTER_XY.x + dx, TBM_CUTTER_XY.y + dy);
    beacons.setPosition(TBM_BEACONS_XY.x + dx, TBM_BEACONS_XY.y + dy);
  };

  // ---- detriti sul nastro (passano dietro lo scudo)
  const debris: Debris[] = [];
  const debrisColors = [C.slate, C.silver, C.charcoal, C.plum];
  for (let i = 0; i < S.debrisPool; i++) {
    const rect = scene.add.rectangle(0, 0, 1, 1, col(pick(debrisColors))).setOrigin(0).setDepth(D_DEBRIS);
    debris.push({ rect, X: 0, Z: 0, size: 1 });
  }
  const zNear = 105;
  const zFar = TW.tbmZ - 2;
  const resetDebris = (d: Debris, z: number) => {
    d.X = Math.round(rand(BELT.x0 + 3, BELT.x1 - 3));
    d.Z = z;
    d.size = rand(S.debrisMinSize, S.debrisMaxSize);
  };
  const drawDebris = (d: Debris) => {
    const p = proj(d.X, BELT.y, d.Z);
    // sasso di 12-23 cm: 3-4 px vicino, 1 px in fondo al nastro
    const sz = Phaser.Math.Clamp(Math.round((d.size * TW.f) / d.Z), 1, S.debrisMaxPx);
    d.rect.setSize(sz, sz).setPosition(Math.round(p.x), Math.round(p.y) - sz);
  };
  debris.forEach((d, i) => {
    resetDebris(d, zNear + ((zFar - zNear) * (i + Math.random() * 0.5)) / S.debrisPool);
    drawDebris(d);
  });

  // ---- navetta da cantiere sull'asfalto
  const veh = add(0, 0, vehicleKey(VEHICLE_SIZES[0], true, 0), D_VEH);
  const vGlow = add(0, 0, `tw-vglow${VEHICLE_SIZES[0]}`, D_VEH - 0.005);
  const vBeacon = add(0, 0, 'tw-vbeacon-off', D_VEH + 0.001);
  let vehZ = S.vehicleStops[0];
  let vehStop = 0;
  let vehWait = rand(S.vehicleStopMinMs, S.vehicleStopMaxMs);
  let vehFront = true;
  let vehX = -ROAD.lane;
  let vehAcc = 0;
  let vBeaconAcc = 0;
  let vBeaconOn = false;
  let vBeaconKey = 'tw-vbeacon';
  let wheelFrame: 0 | 1 = 0;
  let wheelAcc = 0;
  let dustLeft = 0;
  const drawVehicle = () => {
    const want = (VEHICLE_W * TW.f) / vehZ;
    let w = VEHICLE_SIZES[0];
    for (const s of VEHICLE_SIZES) if (Math.abs(s - want) < Math.abs(w - want)) w = s;
    const key = vehicleKey(w, vehFront, w >= VEHICLE_SPIN_MIN ? wheelFrame : 0);
    if (veh.texture.key !== key) veh.setTexture(key);
    const p = proj(vehX, TW.yf, vehZ);
    const bottom = Math.round(p.y) - 1;
    const h = veh.height;
    const cx = Math.round(p.x);
    veh.setPosition(cx - w / 2, bottom - h + 1);
    // lampeggiante: 3x2 da vicino, 1 px da lontano
    const bk = w >= VEHICLE_BEACON_BIG ? 'tw-vbeacon' : 'tw-vbeacon-s';
    if (bk !== vBeaconKey) {
      vBeaconKey = bk;
      vBeacon.setTexture(`${bk}-${vBeaconOn ? 'on' : 'off'}`);
    }
    vBeacon.setPosition(cx - Math.floor(vBeacon.width / 2), bottom - h + 1 - vBeacon.height);
    vGlow.setVisible(vehFront);
    if (vehFront) {
      const gk = `tw-vglow${w}`;
      if (vGlow.texture.key !== gk) vGlow.setTexture(gk);
      vGlow.setPosition(cx - vGlow.width / 2, bottom + 1);
    }
  };
  drawVehicle();

  // ---- fumi e polvere (pool)
  const puffs: Puff[] = [];
  for (let i = 0; i < S.smokePool; i++) {
    const img = add(0, 0, 'tw-smoke0-0', D_SMOKE).setVisible(false);
    puffs.push({ img, x: 0, y: 0, drift: 0, set: 0, step: 0, steps: S.smokeSteps, active: false });
  }
  const drawPuff = (p: Puff) => {
    const ph = Math.min(3, Math.floor((p.step * 4) / p.steps));
    const key = `tw-smoke${p.set}-${ph}`;
    if (p.img.texture.key !== key) p.img.setTexture(key);
    const rows = SMOKE[p.set][ph];
    p.img.setPosition(Math.round(p.x - rows[0].length / 2), Math.round(p.y - rows.length / 2));
    p.img.setVisible(ph < 3 || p.step % 2 === 0);
  };
  const spawnPuff = (x: number, y: number, set: 0 | 1 | 2, drift: number, pool: Puff[] = puffs) => {
    const p = pool.find((q) => !q.active);
    if (!p) return undefined;
    Object.assign(p, { x, y, set, drift, step: 0, steps: set === 2 ? S.cigSmokeSteps : S.smokeSteps, active: true });
    drawPuff(p);
    return p;
  };
  const stepPuffs = (pool: Puff[]) => {
    for (const p of pool) {
      if (!p.active) continue;
      p.step++;
      if (p.step >= p.steps) {
        p.active = false;
        p.img.setVisible(false);
        continue;
      }
      if (p.set === 2) {
        // fumo di sigaretta: sale piano e piega dal lato della mano
        if (p.step % 2 === 1) p.y -= 1;
        if (p.step % 3 === 0) p.x += p.drift;
        drawPuff(p);
        continue;
      }
      if (p.set === 0) p.y -= p.step % 2 === 0 ? 2 : 1;
      else if (p.step % 2 === 0) p.y -= 1;
      if (p.step % 2 === 0) p.x += p.drift;
      drawPuff(p);
    }
  };
  // polvere sollevata dalle ruote della navetta (pool a parte, depth secondo il verso)
  const dust: Puff[] = [];
  for (let i = 0; i < S.vehicleDustPool; i++) {
    const img = add(0, 0, 'tw-smoke1-0', D_VEH - 0.004).setVisible(false);
    dust.push({ img, x: 0, y: 0, drift: 0, set: 1, step: 0, steps: S.smokeSteps, active: false });
  }
  // fumo delle sigarette (sbuffi da 1-2 px, in scala con gli operai lontani)
  const cigPuffs: Puff[] = [];
  for (let i = 0; i < S.cigSmokePool; i++) {
    const img = add(0, 0, 'tw-smoke2-0', D_SMOKE).setVisible(false);
    cigPuffs.push({ img, x: 0, y: 0, drift: 0, set: 2, step: 0, steps: S.cigSmokeSteps, active: false });
  }

  // ---- operai lontani: alti PERSON_H (1.8 m) alla loro profondità
  const workers: Worker[] = WORKERS.map((wk) => {
    const h = Math.round((PERSON_H * TW.f) / wk.Z);
    registerWorkerSprites(scene, h, wk.kind, wk.mirror);
    const p = proj(wk.X, floorY(wk.X), wk.Z);
    const rows = h + WORKER_TOP;
    const x0 = Math.round(p.x) - (WORKER_W >> 1);
    const y0 = Math.round(p.y) - rows;
    const dot = (c: number) => scene.add.rectangle(0, 0, 1, 1, col(c)).setOrigin(0).setDepth(D_WCIG).setVisible(false);
    return {
      img: add(x0, y0, workerKey(h, wk.kind, wk.mirror, 'tool0', 'down'), D_WORKER),
      kind: wk.kind,
      Z: wk.Z,
      h,
      mirror: wk.mirror,
      x0,
      y0,
      feetY: y0 + rows - 1,
      phase: 'work',
      left: rand(S.breakMinMs, S.breakMaxMs),
      frame: 0,
      frameLeft: rand(S.workerMinMs, S.workerMaxMs),
      r: 'tool0',
      l: 'down',
      breakLeft: 0,
      lit: false,
      ember: dot(C.orange),
      emberAcc: 0,
      emberHot: false,
      flash: add(0, 0, 'tw-wflash', D_WCIG).setVisible(false),
      flashAcc: 0,
      puffsLeft: 0,
      puffAcc: 0,
      idleSmokeAcc: 0,
      butt: dot(C.orange),
      buttLeft: 0,
      buttAcc: 0,
      buttVx: 0,
      buttVy: 0,
      buttLanded: false,
      drop: dot(C.white),
      dropAcc: 0,
    };
  });
  // mondo 3: cassa di birra accanto al secondo operaio
  if (beer) {
    const p = proj(CRATE.X, floorY(CRATE.X), CRATE.Z);
    add(Math.round(p.x) - 1, Math.round(p.y) - 3, 'tw-crate', D_WORKER - 0.001);
  }
  // la navetta più vicina di un operaio gli passa davanti: l'operaio scende sotto la navetta
  const sortWorkers = () => {
    for (const w of workers) {
      const d = vehZ < w.Z ? D_VEH - 0.01 : D_WORKER;
      if (w.img.depth === d) continue;
      w.img.setDepth(d);
      for (const o of [w.ember, w.flash, w.butt, w.drop]) o.setDepth(d + 0.001);
    }
  };
  sortWorkers();

  /** punto dello sprite (coordinate non specchiate, WORKER_PTS) a schermo */
  const wpt = (w: Worker, pt: readonly [number, number]) => ({
    x: w.x0 + (w.mirror ? WORKER_W - 1 - pt[0] : pt[0]),
    y: w.y0 + pt[1],
  });
  /** verso "in fuori" dal lato della sigaretta */
  const out = (w: Worker) => (w.mirror ? -1 : 1);
  // brace (o punta bianca ancora spenta) alla bocca o nella mano abbassata
  const placeEmber = (w: Worker) => {
    const atMouth = w.r === 'mouth';
    const show = (w.lit || w.phase === 'place' || w.phase === 'light') && (atMouth || w.r === 'down');
    w.ember.setVisible(show);
    if (!show) return;
    const p = wpt(w, atMouth ? WORKER_PTS.emberMouth : WORKER_PTS.emberDown);
    w.ember.setPosition(p.x, p.y);
    if (!w.lit) w.ember.setFillStyle(col(C.white));
  };
  const setPose = (w: Worker, r: WorkerArmR, l: WorkerArmL) => {
    w.r = r;
    w.l = l;
    const key = workerKey(w.h, w.kind, w.mirror, r, l);
    if (w.img.texture.key !== key) w.img.setTexture(key);
    placeEmber(w);
  };
  const go = (w: Worker, phase: WorkerPhase, ms: number, r: WorkerArmR, l: WorkerArmL) => {
    w.phase = phase;
    w.left = ms;
    setPose(w, r, l);
  };
  const dragGap = () => rand(S.cigDragGapMinMs, S.cigDragGapMaxMs);
  const startBreak = (w: Worker) => {
    w.breakLeft = rand(S.cigSmokeMinMs, S.cigSmokeMaxMs);
    go(w, 'pocket', S.cigPocketMs, 'pocket', beer ? 'bottle' : 'down');
  };
  /** fine di una fase della pausa: decide la successiva */
  const endPhase = (w: Worker) => {
    switch (w.phase) {
      case 'work':
        startBreak(w);
        // a volte si ferma anche il collega
        for (const o of workers) if (o !== w && o.phase === 'work' && Math.random() < S.breakTogetherChance) startBreak(o);
        break;
      case 'pocket':
        go(w, 'place', S.cigPlaceMs, 'mouth', w.l);
        break;
      case 'place': {
        // accendino: lampi della fiammella sulla punta
        go(w, 'light', S.cigLightMs, 'mouth', w.l);
        const p = wpt(w, WORKER_PTS.emberMouth);
        w.flash.setPosition(p.x - 1, p.y - 1).setVisible(true);
        w.flashAcc = 0;
        break;
      }
      case 'light':
        w.flash.setVisible(false);
        w.lit = true;
        w.emberAcc = 0;
        go(w, 'drag', S.cigDragMs, 'mouth', w.l);
        break;
      case 'drag':
        // abbassa la mano e butta fuori il fumo
        w.puffsLeft = S.cigExhalePuffs;
        w.puffAcc = S.cigExhaleGapMs;
        go(w, 'idle', dragGap(), 'down', w.l);
        break;
      case 'idle':
        if (w.breakLeft <= 0) {
          // finita: colpetto al mozzicone e si torna al lavoro
          w.lit = false;
          go(w, 'throw', S.cigThrowMs, 'throw', w.l);
          const p = wpt(w, WORKER_PTS.butt);
          w.butt.setPosition(p.x, p.y).setFillStyle(col(C.orange)).setVisible(true);
          w.buttVx = out(w);
          w.buttVy = -1;
          w.buttLeft = 0;
          w.buttAcc = 0;
          w.buttLanded = false;
        } else if (beer && Math.random() < S.beerChance) go(w, 'drinkUp', S.beerUpMs, 'down', 'drink');
        else go(w, 'drag', S.cigDragMs, 'mouth', w.l);
        break;
      case 'drinkUp':
        go(w, 'drinkTilt', S.beerTiltMs, 'down', 'tilt');
        if (Math.random() < S.beerFoamChance) {
          // goccia di schiuma che cola dalla mano
          const p = wpt(w, WORKER_PTS.drip);
          w.drop.setPosition(p.x, p.y).setVisible(true);
          w.dropAcc = 0;
        }
        break;
      case 'drinkTilt':
        go(w, 'drinkDown', S.beerUpMs, 'down', 'drink');
        break;
      case 'drinkDown':
        go(w, 'idle', dragGap(), 'down', 'bottle');
        break;
      case 'throw':
        w.frame = 0;
        go(w, 'work', rand(S.breakMinMs, S.breakMaxMs), 'tool0', 'down');
        break;
    }
  };

  const updateWorker = (w: Worker, dt: number) => {
    if (w.phase === 'work') {
      w.frameLeft -= dt;
      if (w.frameLeft <= 0) {
        w.frameLeft = rand(S.workerMinMs, S.workerMaxMs);
        w.frame = w.frame === 0 ? 1 : 0;
        setPose(w, w.frame === 0 ? 'tool0' : 'tool1', 'down');
      }
    } else w.breakLeft -= dt;
    w.left -= dt;
    if (w.left <= 0) endPhase(w);

    // fiammella dell'accendino a lampi
    if (w.phase === 'light') {
      w.flashAcc += dt;
      if (w.flashAcc >= S.cigFlashMs) {
        w.flashAcc %= S.cigFlashMs;
        w.flash.setVisible(!w.flash.visible);
      }
    }
    // brace: arancio/rosso a riposo, giallo/bianco mentre tira
    if (w.lit && w.ember.visible) {
      const drag = w.phase === 'drag';
      const ms = drag ? S.cigDragEmberMs : S.cigEmberMs;
      w.emberAcc += dt;
      if (w.emberAcc >= ms) {
        w.emberAcc %= ms;
        w.emberHot = !w.emberHot;
      }
      const c = col(drag ? (w.emberHot ? C.white : C.yellow) : w.emberHot ? C.orange : C.red);
      if (w.ember.fillColor !== c) w.ember.setFillStyle(c);
    }
    // sbuffi dalla bocca dopo la tirata, filo di fumo dalla brace a riposo
    if (w.puffsLeft > 0) {
      w.puffAcc += dt;
      if (w.puffAcc >= S.cigExhaleGapMs) {
        w.puffAcc = 0;
        w.puffsLeft--;
        const p = wpt(w, WORKER_PTS.exhale);
        spawnPuff(p.x, p.y, 2, out(w), cigPuffs);
      }
    } else if (w.lit && w.r === 'down') {
      w.idleSmokeAcc += dt;
      if (w.idleSmokeAcc >= S.cigIdleSmokeMs) {
        w.idleSmokeAcc = 0;
        spawnPuff(w.ember.x, w.ember.y - 1, 2, out(w), cigPuffs);
      }
    }
    // mozzicone: vola in arco fino a terra, ci resta un attimo e si spegne
    if (w.butt.visible) {
      w.buttAcc += dt;
      if (w.buttLanded) {
        w.buttLeft -= dt;
        if (w.buttAcc >= S.cigEmberMs) {
          w.buttAcc %= S.cigEmberMs;
          w.butt.setFillStyle(col(w.butt.fillColor === col(C.red) ? C.plum : C.red));
        }
        if (w.buttLeft <= 0) w.butt.setVisible(false);
      } else if (w.buttAcc >= S.cigButtStepMs) {
        w.buttAcc %= S.cigButtStepMs;
        w.buttLeft++;
        const x = w.butt.x + (w.buttLeft % 2 === 1 ? w.buttVx : 0);
        let y = w.butt.y + w.buttVy;
        w.buttVy = Math.min(2, w.buttVy + 1);
        if (y >= w.feetY) {
          y = w.feetY;
          w.buttLanded = true;
          w.buttLeft = S.cigButtMs;
          w.butt.setFillStyle(col(C.red));
        }
        w.butt.setPosition(x, y);
      }
    }
    // goccia di schiuma che cade
    if (w.drop.visible) {
      w.dropAcc += dt;
      if (w.dropAcc >= S.beerDropStepMs) {
        w.dropAcc %= S.beerDropStepMs;
        w.drop.y += 1;
        if (w.drop.y >= w.feetY) w.drop.setVisible(false);
      }
    }
  };
  let cigAcc = 0;

  // ---- stato
  let running = true;
  let stateLeft = rand(S.runMinMs, S.runMaxMs);
  let spinUp = 0;
  let cutFrame = 0;
  let cutAcc = 0;
  let vibAcc = 0;
  let jx = 0;
  let thrustAcc = 0;
  let thrust = 0;
  let beaconAcc = 0;
  let beaconFrame = 0;
  let smokeLeft = 0;
  let smokeAcc = 0;
  let sparkLeft = rand(S.sparkMinMs, S.sparkMaxMs);
  let debrisAcc = 0;
  let neonEvent = rand(S.neonEventMinMs, S.neonEventMaxMs);
  let neonBlink = rand(S.neonBlinkMinMs, S.neonBlinkMaxMs);
  let emerLeft = rand(S.emergencyMinMs, S.emergencyMaxMs);
  let emerBlinks = 0;
  let emerAcc = 0;
  let humLeft = rand(1500, S.humMinMs);

  const onUpdate = (_t: number, dt: number) => {
    // ---- talpa: ciclo scavo / sosta
    stateLeft -= dt;
    if (stateLeft <= 0) {
      running = !running;
      stateLeft = running ? rand(S.runMinMs, S.runMaxMs) : rand(S.pauseMinMs, S.pauseMaxMs);
      if (running) {
        spinUp = 900;
        playHum(true);
      }
    }
    if (running) {
      spinUp = Math.max(0, spinUp - dt);
      cutAcc += dt;
      const frameMs = S.cutterFrameMs * (spinUp > 0 ? 2.2 : 1);
      if (cutAcc >= frameMs) {
        cutAcc %= frameMs;
        cutFrame = (cutFrame + 1) % CUTTER_FRAMES;
        cutter.setTexture(`tw-cutter${cutFrame}`);
      }
      vibAcc += dt;
      if (vibAcc >= S.vibrateMs) {
        vibAcc %= S.vibrateMs;
        jx = Math.random() < S.vibrateChance ? (Math.random() < 0.5 ? -1 : 1) : 0;
        placeTbm(jx, thrust);
      }
      thrustAcc += dt;
      if (thrustAcc >= S.thrustMs) {
        thrustAcc %= S.thrustMs;
        thrust = thrust === 0 ? -1 : 0;
        placeTbm(jx, thrust);
      }
      humLeft -= dt;
      if (humLeft <= 0) {
        humLeft = rand(S.humMinMs, S.humMaxMs);
        playHum(false);
      }
      sparkLeft -= dt;
      if (sparkLeft <= 0) {
        sparkLeft = rand(S.sparkMinMs, S.sparkMaxMs);
        const a = rand(0, Math.PI * 2);
        const rr = TBM.cutterR - 1;
        const sx = TBM.cx + Math.cos(a) * rr;
        const sy = Math.min(TBM.bottom - 1, TBM.cy + Math.sin(a) * rr);
        spawnParticles(scene, sx, sy, {
          count: 2 + Math.floor(Math.random() * 3),
          colors: [C.yellow, C.orange, C.white],
          speed: 1.3,
          angle: a,
          spread: 1.4,
          gravity: 0.09,
          lifeMs: 320,
          size: 1,
          depth: D_SPARK,
        });
      }
    } else if (jx !== 0) {
      jx = 0;
      placeTbm(0, thrust);
    }

    beaconAcc += dt;
    if (beaconAcc >= S.beaconMs) {
      beaconAcc %= S.beaconMs;
      beaconFrame ^= 1;
      beacons.setTexture(`tw-beacons${beaconFrame}`);
    }

    // ---- fumi: sbuffi dal bordo della testa e polvere bassa
    smokeLeft -= dt;
    if (smokeLeft <= 0) {
      smokeLeft = rand(S.smokeMinMs, S.smokeMaxMs) * (running ? 1 : 3);
      if (Math.random() < 0.7) {
        const a = rand(Math.PI * 1.05, Math.PI * 1.95);
        const rr = TBM.cutterR + 2;
        spawnPuff(TBM.cx + jx + Math.cos(a) * rr, TBM.cy + thrust + Math.sin(a) * rr, 0, Math.cos(a) < 0 ? -1 : 1);
      } else {
        const side = Math.random() < 0.5 ? -1 : 1;
        spawnPuff(TBM.cx + side * rand(8, 26), TBM.bottom - 1, 1, side);
      }
    }
    smokeAcc += dt;
    if (smokeAcc >= S.smokeStepMs) {
      smokeAcc %= S.smokeStepMs;
      stepPuffs(puffs);
      stepPuffs(dust);
    }

    // ---- nastro: i detriti scorrono solo mentre la talpa scava
    debrisAcc += dt;
    if (debrisAcc >= S.debrisStepMs) {
      const step = debrisAcc;
      debrisAcc = 0;
      if (running) {
        for (const d of debris) {
          d.Z -= (S.debrisSpeed * step) / 1000;
          if (d.Z < zNear) resetDebris(d, zFar + rand(0, 20));
          drawDebris(d);
        }
      }
    }

    // ---- neon: lampeggi a scatti, sfarfallio, spegnimento
    neonEvent -= dt;
    if (neonEvent <= 0) {
      neonEvent = rand(S.neonEventMinMs, S.neonEventMaxMs);
      const dark = neons.filter((n) => n.phase !== 'on').length;
      const cand = neons.filter((n) => n.phase === 'on');
      if (dark < 2 && cand.length > 0) startFlicker(pick(cand));
    }
    neonBlink -= dt;
    if (neonBlink <= 0) {
      neonBlink = rand(S.neonBlinkMinMs, S.neonBlinkMaxMs);
      const cand = neons.filter((n) => n.phase === 'on' && n.blinkLeft <= 0);
      if (cand.length > 0) {
        const n = pick(cand);
        n.blinkLeft = S.neonBlinkMs * (Math.random() < 0.5 ? 1 : 2);
        n.bar.setTexture(`${n.key}-dim`);
      }
    }
    for (const n of neons) {
      if (n.blinkLeft > 0) {
        n.blinkLeft -= dt;
        if (n.blinkLeft <= 0 && n.phase === 'on') n.bar.setTexture(`${n.key}-on`);
      }
      if (n.phase === 'on') continue;
      n.left -= dt;
      if (n.phase === 'off') {
        if (n.left <= 0) {
          n.phase = 'flickerOn';
          n.left = S.neonFlickerMs * 0.6;
        }
        continue;
      }
      n.stepLeft -= dt;
      if (n.stepLeft <= 0) {
        n.stepLeft = rand(S.neonFlickerStepMinMs, S.neonFlickerStepMaxMs);
        setLit(n, !n.lit);
      }
      if (n.left <= 0) {
        if (n.phase === 'flickerOff' && Math.random() < S.neonOffChance) {
          n.phase = 'off';
          n.left = rand(S.neonOffMinMs, S.neonOffMaxMs);
          setLit(n, false);
        } else {
          n.phase = 'on';
          n.blinkLeft = 0;
          setLit(n, true);
          n.bar.setTexture(`${n.key}-on`);
        }
      }
    }

    // ---- luce di emergenza a raffiche
    if (emerBlinks > 0) {
      emerAcc += dt;
      if (emerAcc >= S.emergencyMs) {
        emerAcc %= S.emergencyMs;
        emerBlinks--;
        emer.setTexture(emerBlinks % 2 === 1 ? 'tw-emer-on' : 'tw-emer-off');
      }
    } else {
      emerLeft -= dt;
      if (emerLeft <= 0) {
        emerLeft = rand(S.emergencyMinMs, S.emergencyMaxMs);
        emerBlinks = S.emergencyBlinks * 2;
        emerAcc = S.emergencyMs;
      }
    }

    // ---- navetta: spola tra le fermate sull'asfalto, nella sua corsia
    vehAcc += dt;
    if (vehAcc >= S.vehicleStepMs) {
      const step = vehAcc;
      vehAcc = 0;
      if (vehWait > 0) {
        vehWait -= step;
        if (vehWait <= 0) vehStop = (vehStop + 1) % S.vehicleStops.length;
        if (vBeaconOn) {
          vBeaconOn = false;
          vBeacon.setTexture(`${vBeaconKey}-off`);
        }
      } else {
        const target = S.vehicleStops[vehStop];
        const dz = (S.vehicleSpeed * step) / 1000;
        vehFront = target < vehZ;
        if (Math.abs(target - vehZ) <= dz) {
          vehZ = target;
          vehWait = rand(S.vehicleStopMinMs, S.vehicleStopMaxMs);
        } else vehZ += vehZ < target ? dz : -dz;
        // verso chi guarda tiene la corsia sinistra (a schermo), allontanandosi la destra
        const laneX = vehFront ? -ROAD.lane : ROAD.lane;
        const dx = (S.vehicleLaneSpeed * step) / 1000;
        vehX = Math.abs(laneX - vehX) <= dx ? laneX : vehX + Math.sign(laneX - vehX) * dx;
        wheelAcc += step;
        if (wheelAcc >= S.vehicleWheelMs) {
          wheelAcc %= S.vehicleWheelMs;
          wheelFrame = wheelFrame === 0 ? 1 : 0;
        }
        drawVehicle();
        sortWorkers();
        vBeaconAcc += step;
        if (vBeaconAcc >= S.vehicleBeaconMs) {
          vBeaconAcc %= S.vehicleBeaconMs;
          vBeaconOn = !vBeaconOn;
          vBeacon.setTexture(`${vBeaconKey}-${vBeaconOn ? 'on' : 'off'}`);
        }
        // polvere leggera dietro le ruote
        dustLeft -= step;
        if (dustLeft <= 0) {
          dustLeft = rand(S.vehicleDustMinMs, S.vehicleDustMaxMs);
          const side = Math.random() < 0.5 ? -1 : 1;
          const bottom = Math.round(veh.y + veh.height - 1);
          const half = veh.width / 2;
          const cx = veh.x + half;
          const p = vehFront
            ? spawnPuff(cx + side * (half + 1), bottom - 1, 1, side, dust) // dietro: spunta ai lati
            : spawnPuff(cx + side * (half - 2), bottom + 1, 1, side, dust); // dietro = verso di noi
          p?.img.setDepth(vehFront ? D_VEH - 0.004 : D_VEH + 0.004);
        }
      }
    }

    // ---- operai: lavoro e pausa sigaretta (birra nel mondo 3)
    for (const w of workers) updateWorker(w, dt);
    cigAcc += dt;
    if (cigAcc >= S.cigSmokeStepMs) {
      cigAcc %= S.cigSmokeStepMs;
      stepPuffs(cigPuffs);
    }
  };

  const subs = new Subscriptions();
  // colpo forte: un neon sfarfalla
  subs.on('damage', (e) => {
    if (!e.strong) return;
    const cand = neons.filter((n) => n.phase === 'on');
    if (cand.length > 0 && Math.random() < 0.5) startFlicker(pick(cand));
  });
  scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
    subs.clear();
  });
}
