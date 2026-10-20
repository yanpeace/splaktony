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
 *   frame, polvere; 2 operai lontani, luce di emergenza a raffiche.
 *
 * Depth: sfondo 0, ombre dei neon 0.05, neon/luce di emergenza 0.1, detriti
 * 0.12, talpa 0.2..0.22, alone dei fari 0.235, polvere 0.236 / 0.244, navetta
 * 0.24, operai 0.25, fumi 0.3, scintille 2.3.
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
  set: 0 | 1;
  step: number;
  active: boolean;
}

interface Debris {
  rect: Phaser.GameObjects.Rectangle;
  X: number;
  Z: number;
}

/** operai lontani: posizione mondo (piedi) e tipo */
const WORKERS: readonly { X: number; Z: number; kind: 0 | 1 }[] = [
  { X: -62, Z: 318, kind: 0 },
  { X: 50, Z: 300, kind: 1 },
];

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
export function buildTunnelWorld(scene: Phaser.Scene, _opts: { world: 2 | 3 } = { world: 2 }): void {
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
    debris.push({ rect, X: 0, Z: 0 });
  }
  const zNear = 105;
  const zFar = TW.tbmZ - 2;
  const resetDebris = (d: Debris, z: number) => {
    d.X = Math.round(rand(BELT.x0 + 3, BELT.x1 - 3));
    d.Z = z;
  };
  const drawDebris = (d: Debris) => {
    const p = proj(d.X, BELT.y, d.Z);
    const sz = d.Z < 190 ? 2 : 1;
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
    vBeacon.setPosition(cx - 1, bottom - h - 1);
    vGlow.setVisible(vehFront);
    if (vehFront) {
      const gk = `tw-vglow${w}`;
      if (vGlow.texture.key !== gk) vGlow.setTexture(gk);
      vGlow.setPosition(cx - vGlow.width / 2, bottom + 1);
    }
  };
  drawVehicle();

  // ---- operai lontani
  const workers = WORKERS.map((wk) => {
    const p = proj(wk.X, TW.yf, wk.Z);
    const img = add(p.x - 3, p.y - 17, `tw-worker${wk.kind}-0`, D_WORKER);
    return { img, kind: wk.kind, frame: 0, left: rand(S.workerMinMs, S.workerMaxMs) };
  });

  // ---- fumi e polvere (pool)
  const puffs: Puff[] = [];
  for (let i = 0; i < S.smokePool; i++) {
    const img = add(0, 0, 'tw-smoke0-0', D_SMOKE).setVisible(false);
    puffs.push({ img, x: 0, y: 0, drift: 0, set: 0, step: 0, active: false });
  }
  const drawPuff = (p: Puff) => {
    const ph = Math.min(3, Math.floor((p.step * 4) / S.smokeSteps));
    const key = `tw-smoke${p.set}-${ph}`;
    if (p.img.texture.key !== key) p.img.setTexture(key);
    const rows = SMOKE[p.set][ph];
    p.img.setPosition(Math.round(p.x - rows[0].length / 2), Math.round(p.y - rows.length / 2));
    p.img.setVisible(ph < 3 || p.step % 2 === 0);
  };
  const spawnPuff = (x: number, y: number, set: 0 | 1, drift: number, pool: Puff[] = puffs) => {
    const p = pool.find((q) => !q.active);
    if (!p) return undefined;
    Object.assign(p, { x, y, set, drift, step: 0, active: true });
    drawPuff(p);
    return p;
  };
  const stepPuffs = (pool: Puff[]) => {
    for (const p of pool) {
      if (!p.active) continue;
      p.step++;
      if (p.step >= S.smokeSteps) {
        p.active = false;
        p.img.setVisible(false);
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
    dust.push({ img, x: 0, y: 0, drift: 0, set: 1, step: 0, active: false });
  }

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
          vBeacon.setTexture('tw-vbeacon-off');
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
        vBeaconAcc += step;
        if (vBeaconAcc >= S.vehicleBeaconMs) {
          vBeaconAcc %= S.vehicleBeaconMs;
          vBeaconOn = !vBeaconOn;
          vBeacon.setTexture(vBeaconOn ? 'tw-vbeacon-on' : 'tw-vbeacon-off');
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

    // ---- operai
    for (const w of workers) {
      w.left -= dt;
      if (w.left <= 0) {
        w.left = rand(S.workerMinMs, S.workerMaxMs);
        w.frame ^= 1;
        w.img.setTexture(`tw-worker${w.kind}-${w.frame}`);
      }
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
