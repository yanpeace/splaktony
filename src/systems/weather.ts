import Phaser from 'phaser';
import { WEATHER as W } from '../config/balance';
import { noise, tone } from '../audio/sfx';
import type { Ragdoll } from '../entities/Ragdoll';
import { WeatherFx, type WeatherLevels } from '../entities/WeatherFx';
import { isFrozen, shake } from '../gfx/effects';

/**
 * Meteo a fasi: sereno → evento → sereno.
 *
 * All'aperto (mondo 1): neve, pioggia, vento, temporale (pioggia forte + vento
 * + fulmini). Ogni evento dura WEATHER.eventMs, la pausa di sereno
 * WEATHER.clearMs; la densità sale e scende a scatti (WEATHER.rampSteps).
 * Al chiuso (mondo 2): solo gocce dal soffitto e qualche corrente d'aria.
 *
 * Su Tony:
 * - vento: accelerazione orizzontale a ogni step di fisica (beforeupdate di
 *   Matter), più forte sulle parti leggere, con un tetto di velocità
 *   (WEATHER.windMaxVx) così le raffiche da sole non lo sbattono forte;
 * - neve: i fiocchi si posano sulle parti e sul caschetto; neve forte = tremito;
 * - pioggia: schizzi sulle parti colpite (in WeatherFx).
 *
 * Debug/test: forceWeather(kind) e window.weather = { force, current, stats }.
 */

export type WeatherKind = 'snow' | 'rain' | 'wind' | 'storm' | 'clear';
type Phase = 'clear' | 'in' | 'hold' | 'out';

const ANNOUNCE: Record<Exclude<WeatherKind, 'clear'>, string> = {
  snow: 'NEVE!',
  rain: 'PIOGGIA!',
  wind: 'VENTO!',
  storm: 'TEMPORALE!',
};

const rand = (r: readonly number[]) => r[0] + Math.random() * (r[1] - r[0]);

class WeatherController {
  kind: WeatherKind = 'clear';
  phase: Phase = 'clear';
  /** densità corrente 0..1, a gradini */
  level = 0;
  private phaseAt = 0;
  private holdUntil = 0;
  private nextEventAt: number;
  private strength = 1;
  private dir = 1;
  private outFrom = 1;

  private gust = W.gustLow;
  private gustTarget = 1;
  private nextGustAt = 0;
  private nextGustStepAt = 0;
  /** vento effettivo su Tony (con segno, 0..1) */
  private windForce = 0;

  private nextShiverAt = 0;
  private nextLightningAt = 0;
  private thunders: number[] = [];
  private nextRainSfxAt = 0;
  private nextWindSfxAt = 0;

  // al chiuso
  private nextDripAt = 0;
  private dripBurstUntil = 0;
  private nextDraftAt = 0;
  private draftUntil = 0;

  private fx: WeatherFx;
  private levels: WeatherLevels = { snow: 0, rain: 0, rainMax: W.rainMax, wind: 0, drift: 0 };

  constructor(
    private scene: Phaser.Scene,
    private ragdoll: Ragdoll,
    readonly outdoor: boolean,
  ) {
    this.fx = new WeatherFx(scene, ragdoll);
    const now = scene.time.now;
    this.nextEventAt = now + rand(W.firstClearMs);
    this.nextDripAt = now + rand(W.dripEveryMs);
    this.nextDraftAt = now + rand(W.draftEveryMs);
    this.fx.onDripLand = () => tone({ type: 'triangle', from: 1500, to: 700, dur: 0.05, vol: 0.06 });

    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.onUpdate, this);
    scene.matter.world.on('beforeupdate', this.onStep, this);
  }

  destroy(): void {
    this.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.onUpdate, this);
    const world = this.scene.matter?.world as Phaser.Physics.Matter.World | null | undefined;
    world?.off('beforeupdate', this.onStep, this);
    this.fx.destroy();
  }

  stats(): Record<string, unknown> {
    return {
      kind: this.kind,
      phase: this.phase,
      level: this.level,
      wind: Math.round(this.windForce * 100) / 100,
      outdoor: this.outdoor,
      objects: this.scene.children.length,
      ...this.fx.stats(),
    };
  }

  /** Debug: fulmine subito (solo all'aperto). */
  strike(): void {
    if (!this.outdoor) return;
    this.fx.lightning();
    this.thunders.push(this.scene.time.now + rand(W.thunderDelayMs));
  }

  // ---------------------------------------------------------------- fasi

  force(kind: WeatherKind): void {
    const now = this.scene.time.now;
    if (!this.outdoor) {
      // al chiuso: vento → corrente d'aria; pioggia/neve/temporale → gocciolio intenso
      if (kind === 'clear') {
        this.draftUntil = 0;
        this.dripBurstUntil = 0;
        this.kind = 'clear';
      } else if (kind === 'wind') {
        this.startDraft(now);
      } else {
        this.dripBurstUntil = now + W.dripBurstMs;
        this.kind = 'rain';
      }
      return;
    }
    if (kind === 'clear') {
      if (this.phase !== 'clear') this.startOut(now);
      return;
    }
    this.startEvent(kind, now);
  }

  private startEvent(kind: Exclude<WeatherKind, 'clear'>, now: number): void {
    this.kind = kind;
    this.phase = 'in';
    this.phaseAt = now;
    this.level = 0;
    this.holdUntil = now + rand(W.eventMs) - 2 * W.rampMs;
    this.strength = kind === 'storm' ? 1 : rand(W.strength);
    this.dir = Math.random() < 0.5 ? -1 : 1;
    this.gust = W.gustLow;
    this.gustTarget = 1;
    this.nextGustAt = now + rand(W.gustMs);
    this.nextLightningAt = now + W.rampMs + rand(W.lightningEveryMs) * 0.5;
    this.fx.announce(ANNOUNCE[kind]);
  }

  private startOut(now: number): void {
    this.phase = 'out';
    this.phaseAt = now;
    this.outFrom = this.level;
  }

  private pickKind(): Exclude<WeatherKind, 'clear'> {
    const entries = Object.entries(W.weights) as [Exclude<WeatherKind, 'clear'>, number][];
    let r = Math.random() * entries.reduce((s, [, w]) => s + w, 0);
    for (const [k, w] of entries) {
      r -= w;
      if (r <= 0) return k;
    }
    return entries[0][0];
  }

  private updatePhase(now: number): void {
    const steps = W.rampSteps;
    switch (this.phase) {
      case 'clear':
        if (now >= this.nextEventAt) this.startEvent(this.pickKind(), now);
        break;
      case 'in': {
        const k = Math.min(1, (now - this.phaseAt) / W.rampMs);
        this.level = Math.ceil(k * steps) / steps;
        if (k >= 1) this.phase = 'hold';
        break;
      }
      case 'hold':
        this.level = 1;
        if (now >= this.holdUntil) this.startOut(now);
        break;
      case 'out': {
        const k = Math.min(1, (now - this.phaseAt) / W.rampMs);
        this.level = (Math.floor((1 - k) * steps) / steps) * this.outFrom;
        if (k >= 1) {
          this.phase = 'clear';
          this.kind = 'clear';
          this.level = 0;
          this.nextEventAt = now + rand(W.clearMs);
        }
        break;
      }
    }
  }

  /** Raffiche: il bersaglio alterna basso/alto, il valore lo insegue a gradini. */
  private updateGust(now: number): void {
    if (now >= this.nextGustAt) {
      this.nextGustAt = now + rand(W.gustMs);
      this.gustTarget = this.gustTarget > 0.6 ? W.gustLow + Math.random() * 0.2 : 0.75 + Math.random() * 0.25;
    }
    if (now >= this.nextGustStepAt) {
      this.nextGustStepAt = now + W.gustStepMs;
      const d = this.gustTarget - this.gust;
      this.gust += Math.abs(d) <= W.gustStep ? d : Math.sign(d) * W.gustStep;
    }
  }

  // ---------------------------------------------------------------- frame

  private onUpdate(_time: number, delta: number): void {
    const now = this.scene.time.now;
    if (this.outdoor) this.updateOutdoor(now);
    else this.updateIndoor(now);
    this.fx.update(delta, this.levels, isFrozen(this.scene));
    this.updateAudio(now);
  }

  private updateOutdoor(now: number): void {
    this.updatePhase(now);
    this.updateGust(now);
    const lv = this.level;
    const k = this.kind;
    const L = this.levels;
    L.snow = k === 'snow' ? lv * this.strength : 0;
    L.rain = k === 'rain' ? lv * this.strength : k === 'storm' ? lv : 0;
    L.rainMax = k === 'storm' ? W.stormRainMax : W.rainMax;
    this.windForce =
      k === 'wind' ? this.dir * this.gust * lv * this.strength : k === 'storm' ? this.dir * this.gust * lv * W.stormWindMult : 0;
    L.wind = this.windForce;
    const breeze = k === 'snow' || k === 'rain' ? this.dir * W.breeze * lv : 0;
    L.drift = this.windForce * W.precipDriftPerWind + breeze;

    // neve forte: Tony trema (piccolissimi impulsi casuali)
    if (L.snow >= W.shiverAt && now >= this.nextShiverAt) {
      this.nextShiverAt = now + W.shiverEveryMs;
      const parts = [...this.ragdoll.parts.values()];
      const p = parts[Math.floor(Math.random() * parts.length)];
      if (p) {
        const s = W.shiverDv;
        this.ragdoll.applyImpulse(p, p.body.position.x, p.body.position.y - 2, (Math.random() - 0.5) * 2 * s, -Math.random() * s);
      }
    }

    // temporale: fulmini ogni tanto, tuono in ritardo
    if (k === 'storm' && lv >= 0.6 && now >= this.nextLightningAt) {
      this.nextLightningAt = now + rand(W.lightningEveryMs);
      this.fx.lightning();
      noise({ dur: 0.12, vol: 0.18, freq: 7000, freqTo: 1500, highpass: true });
      this.thunders.push(now + rand(W.thunderDelayMs));
    }
    for (let i = this.thunders.length - 1; i >= 0; i--) {
      if (now < this.thunders[i]) continue;
      this.thunders.splice(i, 1);
      this.thunder();
    }
  }

  private thunder(): void {
    noise({ dur: 1.3, vol: 0.45, freq: 500, freqTo: 40 });
    noise({ dur: 0.9, vol: 0.3, freq: 260, freqTo: 50, delay: 0.25 });
    tone({ type: 'square', from: 62, to: 30, dur: 0.7, vol: 0.16 });
    tone({ type: 'triangle', from: 90, to: 32, dur: 1, vol: 0.25, delay: 0.1 });
    shake(this.scene, W.thunderShakePx, W.thunderShakeMs);
  }

  private startDraft(now: number): void {
    this.draftUntil = now + rand(W.draftMs);
    this.dir = Math.random() < 0.5 ? -1 : 1;
    this.kind = 'wind';
  }

  private updateIndoor(now: number): void {
    const L = this.levels;
    L.snow = 0;
    L.rain = 0;
    const burst = now < this.dripBurstUntil;
    if (now >= this.nextDripAt) {
      this.nextDripAt = now + rand(burst ? W.dripBurstEveryMs : W.dripEveryMs);
      this.fx.drip();
    }
    if (now >= this.nextDraftAt && now >= this.draftUntil) {
      this.nextDraftAt = now + rand(W.draftEveryMs);
      this.startDraft(now);
    }
    this.updateGust(now);
    const drafting = now < this.draftUntil;
    this.windForce = drafting ? this.dir * this.gust * W.draftStrength : 0;
    L.wind = this.windForce;
    L.drift = 0;
    if (!drafting && !burst && this.kind !== 'clear') this.kind = 'clear';
  }

  // ---------------------------------------------------------------- fisica: vento su Tony

  /** A ogni step di Matter (prima dell'integrazione): spinta orizzontale moderata. */
  private onStep(): void {
    const w = this.windForce;
    if (Math.abs(w) < 0.01) return;
    const sign = Math.sign(w);
    for (const p of this.ragdoll.parts.values()) {
      const light = p.name !== 'torso';
      const vx = p.body.velocity.x;
      if (vx * sign >= W.windMaxVx) continue; // già abbastanza veloce: niente urti forti
      const mult = light ? W.lightPartMult : 1;
      const lift = light ? -Math.abs(w) * W.windLift : 0;
      this.ragdoll.applyImpulse(p, p.body.position.x, p.body.position.y, w * W.windAccel * mult, lift);
    }
  }

  // ---------------------------------------------------------------- audio

  /**
   * Fruscio della pioggia e del vento: brevi colpi di rumore filtrato ripetuti
   * (sfx.ts non ha loop; il mute lo gestisce il master). Si fermano da soli
   * quando l'intensità torna a 0.
   */
  private updateAudio(now: number): void {
    const rain = this.levels.rain;
    if (rain > 0 && now >= this.nextRainSfxAt) {
      this.nextRainSfxAt = now + W.rainChunkMs;
      noise({ dur: 0.22, vol: W.rainVol * rain, freq: 2600 + Math.random() * 1600, freqTo: 1800, highpass: true });
    }
    const wind = Math.abs(this.windForce);
    if (wind > 0.05 && now >= this.nextWindSfxAt) {
      this.nextWindSfxAt = now + W.windChunkMs;
      const f = 250 + this.gust * 900;
      noise({ dur: 0.42, vol: W.windVol * Math.min(1, wind * 1.4), freq: f, freqTo: f * (0.8 + Math.random() * 0.5) });
    }
  }
}

// ---------------------------------------------------------------- API pubblica

let active: WeatherController | null = null;

/**
 * Aggancia il meteo alla scena di gioco. outdoor=false (dentro la galleria):
 * solo gocce dal soffitto e correnti d'aria. Si pulisce da solo allo shutdown.
 */
export function bindWeather(scene: Phaser.Scene, ragdoll: Ragdoll, opts: { outdoor: boolean }): void {
  active?.destroy();
  const ctrl = new WeatherController(scene, ragdoll, opts.outdoor);
  active = ctrl;
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    ctrl.destroy();
    if (active === ctrl) active = null;
  });
}

/** Debug: avvia subito un evento (o 'clear' per farlo finire). */
export function forceWeather(kind: 'snow' | 'rain' | 'wind' | 'storm' | 'clear'): void {
  active?.force(kind);
}

if (typeof window !== 'undefined') {
  (window as unknown as { weather: unknown }).weather = {
    force: forceWeather,
    get current(): WeatherKind {
      return active?.kind ?? 'clear';
    },
    stats: () => active?.stats() ?? null,
    strike: () => active?.strike(),
  };
}
