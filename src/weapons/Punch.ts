import type Phaser from 'phaser';
import { ANIM_MELEE, ROOM_INNER, SCREEN, WEAPON_STATS } from '../config/balance';
import { C } from '../config/palette';
import { noise, playPunch, playWhiff, tone } from '../audio/sfx';
import type { Part } from '../entities/Ragdoll';
import { spawnParticles } from '../gfx/effects';
import { makeSprites, type SpriteData } from '../gfx/pixelSprite';
import { FxActors, rasterSprite, type FxFrame, type ShapeFn } from './Shuriken';
import { Weapon, type WeaponPointer } from './Weapon';

type PunchStats = (typeof WEAPON_STATS)['punch'];

const GLOVE_ICON: SpriteData = [
  '..00000..',
  '.0233220.',
  '023322220',
  '022222220',
  '022222220',
  '022222220',
  '.0222220.',
  '..0ccc0..',
  '..00000..',
];

// ---------------------------------------------------------------- sprite del guantone

/** semiassi del guanto "a riposo" (px): lungo il pugno e di traverso */
const GA = 6.5;
const GB = 5.6;
/** il montante è più grande */
const BIG = 1.3;

/**
 * Guantone rosso lungo +u (pollice sopra), polsino bianco dietro.
 * `flat`: fronte schiacciata (frame d'impatto).
 */
function gloveShape(a: number, b: number, flat = 1e9): ShapeFn {
  const cuff = GA * 0.8;
  return (u, v) => {
    if (u > flat) return null;
    // pollice: gobba sopra, davanti, separata dal resto da una cucitura scura
    const th = ((u - a * 0.18) / (a * 0.46)) ** 2 + ((v + b * 0.8) / (b * 0.38)) ** 2;
    const e = (u / a) ** 2 + (v / b) ** 2;
    if (th <= 1) {
      if ((u - a * 0.3) ** 2 + (v + b * 0.92) ** 2 < 1) return 'c';
      return v < -b * 0.95 ? '3' : '2';
    }
    if (e <= 1) {
      if (th < 1.9 && v > -b * 0.8 && u > -a * 0.4) return '1'; // cucitura del pollice
      if ((u - a * 0.45) ** 2 + (v - b * 0.05) ** 2 < 1.6) return '3'; // riflesso sulle nocche
      const d = (u / a) * 0.55 - (v / b) * 0.83;
      if (d > 0.62) return '3';
      if (d < -0.55) return '1';
      return '2';
    }
    if (u >= -a - cuff && u <= -a * 0.5 && Math.abs(v) <= GB * 0.62) {
      if (u < -a - cuff + 1.1) return 'd';
      return v > GB * 0.2 ? 'd' : 'c';
    }
    return null;
  };
}

/** scie di movimento dietro al guanto allungato (senza contorno) */
function smearFx(a: number, b: number, len: number): ShapeFn {
  const back = -a - GA * 0.8;
  const lines: readonly [number, number][] = [
    [-b * 0.62, len * 0.7],
    [0, len],
    [b * 0.62, len * 0.55],
  ];
  return (u, v) => {
    if (u > back + 1.5) return null;
    for (let k = 0; k < lines.length; k++) {
      const [vi, l] = lines[k];
      if (Math.abs(v - vi) >= (k === 1 ? 1.05 : 0.6) || u < back - l) continue;
      // tratteggio: pezzi lunghi vicino al guanto, più radi in fondo
      const d = back + 1.5 - u;
      if (d > l * 0.55 && Math.floor(d + k * 2) % 5 >= 3) return null;
      return d < l * 0.45 ? 'c' : 'd';
    }
    return null;
  };
}

function ringFx(r: number, th: number, ch: string, dashed: boolean): ShapeFn {
  return (u, v) => {
    const d = Math.hypot(u, v);
    if (r <= 3.5 ? d > r : Math.abs(d - r) > th / 2) return null;
    if (dashed && Math.floor(((Math.atan2(v, u) + Math.PI) / (Math.PI * 2)) * 16) % 2 === 1) return null;
    return ch;
  };
}

function starShape(arm: number): ShapeFn {
  return (u, v) => {
    const au = Math.abs(u);
    const av = Math.abs(v);
    if (au < 0.6 && av < 0.6) return 'c';
    if ((av < 0.6 && au < arm) || (au < 0.6 && av < arm)) return '4';
    return null;
  };
}

type DirKey = 'h' | 'd' | 'u';
const DIR_ANGLE: Record<DirKey, number> = { h: 0, d: -Math.PI / 4, u: -Math.PI / 2 };

const NONE: ShapeFn = () => null;

/** misure di un frame del guanto per posizionarlo rispetto al bersaglio */
interface GloveDims {
  /** metà lunghezza della parte piena davanti al centro */
  front: number;
}

function gloveDims(big: boolean): Record<'charge' | 'smear' | 'impact' | 'norm', GloveDims> {
  const k = big ? BIG : 1;
  return {
    charge: { front: GA * 0.78 * k },
    smear: { front: GA * 1.35 * k },
    impact: { front: GA * 0.55 * k },
    norm: { front: GA * k },
  };
}

function makeGloveTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists('fx-glove-h-norm')) return;
  const sprites: Record<string, SpriteData> = {};
  const build = (dir: DirKey, big: boolean) => {
    const k = big ? BIG : 1;
    const a = GA * k;
    const b = GB * k;
    const ang = DIR_ANGLE[dir];
    const pre = `fx-glove-${dir}${big ? '-big' : ''}`;
    const n = Math.ceil(30 * k) | 1;
    const ns = Math.ceil(52 * k) | 1;
    sprites[`${pre}-charge`] = rasterSprite(n, n, ang, gloveShape(a * 0.78, b * 0.78));
    sprites[`${pre}-smear`] = rasterSprite(ns, ns, ang, gloveShape(a * 1.35, b * 0.8), smearFx(a * 1.35, b * 0.8, 17 * k));
    sprites[`${pre}-impact`] = rasterSprite(n, n, ang, gloveShape(a * 0.74, b * 1.32, a * 0.55));
    sprites[`${pre}-norm`] = rasterSprite(n, n, ang, gloveShape(a, b));
  };
  for (const d of ['h', 'd', 'u'] as const) build(d, false);
  build('u', true);
  build('d', true);
  build('h', true);
  // anello d'urto (3 frame) e stelline
  for (const big of [false, true]) {
    const k = big ? 1.4 : 1;
    const s = Math.ceil(24 * k) | 1;
    const pre = big ? 'fx-pring-big' : 'fx-pring';
    sprites[`${pre}-0`] = rasterSprite(s, s, 0, NONE, ringFx(3.2 * k, 0, 'c', false));
    sprites[`${pre}-1`] = rasterSprite(s, s, 0, NONE, ringFx(6.5 * k, 2, 'c', false));
    sprites[`${pre}-2`] = rasterSprite(s, s, 0, NONE, ringFx(9.5 * k, 1.1, '4', true));
  }
  sprites['fx-pstar-0'] = rasterSprite(7, 7, 0, starShape(2.6));
  sprites['fx-pstar-1'] = rasterSprite(5, 5, 0, starShape(1.6));
  makeSprites(scene, sprites);
}

// ---------------------------------------------------------------- suoni

/** colpo pieno e gommoso: schiocco + tonfo + "boing" del guanto imbottito */
function playGloveSmack(big: boolean): void {
  playPunch();
  tone({ type: 'triangle', from: big ? 170 : 220, to: 46, dur: big ? 0.2 : 0.12, vol: 0.4 });
  tone({ type: 'sine', from: big ? 320 : 440, to: big ? 150 : 240, dur: 0.08, vol: 0.14, delay: 0.012 });
  noise({ dur: 0.045, vol: 0.2, freq: 1000, freqTo: 180 });
  if (big) {
    tone({ type: 'square', from: 95, to: 38, dur: 0.18, vol: 0.14 });
    noise({ dur: 0.18, vol: 0.08, freq: 600, freqTo: 3000, highpass: true, delay: 0.03 });
  }
}

function playWindup(): void {
  noise({ dur: 0.05, vol: 0.06, freq: 900, freqTo: 2600, highpass: true });
}

// ---------------------------------------------------------------- arma

interface Track {
  anchor: { x: number; y: number };
  part: Part;
  lx: number;
  ly: number;
  done: boolean;
}

/**
 * Pugno: un tap su Tony (tocco breve, senza trascinare) fa arrivare da fuori
 * schermo un guantone (carica → scia → impatto schiacciato → rinculo →
 * uscita). Tap ravvicinati alternano sinistro/destro; ogni 4° è un montante.
 * Il danno parte nel frame d'impatto. Un tap a vuoto fende l'aria.
 */
export class Punch extends Weapon<PunchStats> {
  readonly id = 'punch';
  readonly name = 'PUGNO';
  readonly icon = GLOVE_ICON;

  private fxActors: FxActors | null = null;
  private tracks: Track[] = [];
  private combo = 0;
  private lastPunchAt = -1e9;
  /** +1 = guanto da sinistra, -1 = da destra */
  private side = 1;

  private get fx(): FxActors {
    if (!this.fxActors || this.fxActors.scene !== this.ctx.scene) this.fxActors = new FxActors(this.ctx.scene, 48);
    return this.fxActors;
  }

  activate(): void {
    super.activate();
    makeGloveTextures(this.ctx.scene);
  }

  deactivate(): void {
    this.fxActors?.clear();
    this.tracks.length = 0;
    super.deactivate();
  }

  update(dtMs: number): void {
    const dt = dtMs * this.ctx.scene.time.timeScale;
    // il bersaglio segue la parte di Tony finché il guanto non arriva
    let w = 0;
    for (let i = 0; i < this.tracks.length; i++) {
      const t = this.tracks[i];
      if (t.done) continue;
      const b = t.part.body;
      const c = Math.cos(b.angle);
      const s = Math.sin(b.angle);
      t.anchor.x = b.position.x + t.lx * c - t.ly * s;
      t.anchor.y = b.position.y + t.lx * s + t.ly * c;
      this.tracks[w++] = t;
    }
    this.tracks.length = w;
    this.fxActors?.update(dt);
  }

  onPointerUp(p: WeaponPointer): void {
    if (p.wasGrab) return;
    if (!this.tryUse(p.time)) return;
    const A = ANIM_MELEE;

    // combo: sinistro/destro alternati, ogni N-esimo il montante
    if (p.time - this.lastPunchAt > A.comboWindowMs) this.combo = 0;
    this.lastPunchAt = p.time;
    this.combo++;
    const x = p.downX;
    const y = p.downY;
    const midX = (ROOM_INNER.left + ROOM_INNER.right) / 2;
    this.side = this.combo === 1 ? (x >= midX ? 1 : -1) : -this.side;
    const upper = this.combo % A.uppercutEvery === 0;

    let dir: DirKey = 'h';
    if (upper) dir = 'u';
    else {
      const room = this.side > 0 ? x - ROOM_INNER.left : ROOM_INNER.right - x;
      if (room < A.punchSideRoomPx || y < A.punchHighY) dir = 'd';
    }
    const ang = DIR_ANGLE[dir];
    const dx = dir === 'u' ? 0 : Math.cos(ang) * this.side;
    const dy = Math.sin(ang);
    const flipX = dir !== 'u' && this.side < 0;

    const hit = p.downHit;
    const anchor = { x, y };
    if (hit) {
      // memorizza il punto nel sistema della parte: il guanto lo insegue
      const b = hit.part.body;
      const ox = x - b.position.x;
      const oy = y - b.position.y;
      const c = Math.cos(-b.angle);
      const s = Math.sin(-b.angle);
      this.tracks.push({ anchor, part: hit.part, lx: ox * c - oy * s, ly: ox * s + oy * c, done: false });
    }
    const track = hit ? this.tracks[this.tracks.length - 1] : null;

    const big = upper;
    const pre = `fx-glove-${dir}${big ? '-big' : ''}`;
    const dims = gloveDims(big);
    const edge = edgeDistance(x, y, -dx, -dy);
    const at = (dist: number) => ({ x: -dx * dist, y: -dy * dist });

    const frames: FxFrame[] = [
      { key: `${pre}-charge`, ms: A.punchChargeMs, ...at(edge - 2) },
      { key: `${pre}-smear`, ms: A.punchSmearMs, ...at(dims.smear.front + 3) },
    ];
    if (hit && track) {
      const impact = () => {
        track.done = true;
        this.land(hit.part, anchor.x, anchor.y, dx, dy, upper);
      };
      frames.push(
        { key: `${pre}-impact`, ms: A.punchFlashMs, ...at(dims.impact.front - 1), fill: C.white, enter: impact },
        { key: `${pre}-impact`, ms: A.punchImpactMs, ...at(dims.impact.front - 1) },
        { key: `${pre}-norm`, ms: A.punchRecoilMs, ...at(dims.norm.front + 4) },
        { key: `${pre}-norm`, ms: A.punchExitMs, ...at(edge * 0.55) },
        { key: `${pre}-charge`, ms: A.punchExitMs, ...at(edge + 1) },
      );
      playWindup();
    } else {
      // a vuoto: il guanto fende l'aria, passa oltre e torna indietro
      frames.push(
        { key: `${pre}-smear`, ms: A.punchSmearMs, ...at(-8) },
        { key: `${pre}-norm`, ms: A.punchRecoilMs, ...at(-10) },
        { key: `${pre}-norm`, ms: A.punchExitMs, ...at(edge * 0.5) },
        { key: `${pre}-charge`, ms: A.punchExitMs, ...at(edge + 1) },
      );
      playWhiff();
      tone({ type: 'triangle', from: 180, to: 320, dur: 0.07, vol: 0.06 });
    }
    this.fx.play(anchor, frames, { depth: 45, flipX });
  }

  /** frame d'impatto: spinta, danno, anello d'urto, stelline, suono */
  private land(part: Part, x: number, y: number, gx: number, gy: number, upper: boolean): void {
    const s = this.stats;
    const A = ANIM_MELEE;
    const { ragdoll } = this.ctx;

    // direzione del guanto con la spinta in su che fa "saltare" il pupazzo
    let dx = gx;
    let dy = gy - s.upwardBias;
    if (upper) dx = (Math.random() - 0.5) * 0.3;
    const n = Math.hypot(dx, dy) || 1;
    dx /= n;
    dy /= n;
    const imp = s.impulse * (upper ? A.uppercutImpulseMult : 1);
    const share = upper ? A.uppercutBodyShare : s.bodyShare;
    ragdoll.applyImpulse(part, x, y, dx * imp, dy * imp);
    ragdoll.addVelocity(dx * imp * share, dy * imp * share, part);
    this.hit({ part: part.name, x, y, amount: s.damage * (upper ? A.uppercutDamageMult : 1), weaponId: this.id });

    playGloveSmack(upper);
    const fx = this.fx;
    const ring = upper ? 'fx-pring-big' : 'fx-pring';
    const rm = A.ringFrameMs;
    fx.play({ x, y }, [
      { key: `${ring}-0`, ms: rm },
      { key: `${ring}-1`, ms: rm },
      { key: `${ring}-2`, ms: rm },
    ], { depth: 44 });

    // stelline che schizzano indietro rispetto al pugno, a scatti
    const count = upper ? A.uppercutStars : A.punchStars;
    const base = Math.atan2(-gy, -gx);
    const st = A.starStepPx;
    const sm = A.starFrameMs;
    for (let i = 0; i < count; i++) {
      const a = base + ((i + 0.5) / count - 0.5) * (upper ? 4.2 : 3) + (Math.random() - 0.5) * 0.4;
      const cx = Math.cos(a);
      const cy = Math.sin(a);
      const k = 0.8 + Math.random() * 0.5;
      fx.play({ x, y }, [
        { key: 'fx-pstar-0', ms: sm, x: cx * st * k, y: cy * st * k },
        { key: 'fx-pstar-0', ms: sm, x: cx * st * 2 * k, y: cy * st * 2 * k },
        { key: 'fx-pstar-1', ms: sm, x: cx * st * 2.7 * k, y: cy * st * 2.7 * k + 1 },
        { key: 'fx-pstar-1', ms: sm, x: cx * st * 3.1 * k, y: cy * st * 3.1 * k + 2, hidden: true },
        { key: 'fx-pstar-1', ms: sm, x: cx * st * 3.4 * k, y: cy * st * 3.4 * k + 3 },
      ], { depth: 46 });
    }
    spawnParticles(this.ctx.scene, x, y, {
      count: upper ? 5 : 3,
      colors: [C.white, C.yellow],
      speed: 2.5,
      angle: base,
      spread: 1.6,
      size: 1,
      lifeMs: 220,
      gravity: 0,
    });
  }
}

/** distanza da (x, y) al bordo dello schermo andando lungo (bx, by) */
function edgeDistance(x: number, y: number, bx: number, by: number): number {
  let t = 1e9;
  if (bx < 0) t = Math.min(t, -x / bx);
  else if (bx > 0) t = Math.min(t, (SCREEN.width - x) / bx);
  if (by < 0) t = Math.min(t, -y / by);
  else if (by > 0) t = Math.min(t, (SCREEN.height - y) / by);
  return Math.min(t, 400);
}
