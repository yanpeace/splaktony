import type Phaser from 'phaser';
import { PHYSICS, WEAPON_STATS } from '../config/balance';
import { C } from '../config/palette';
import { noise, tone } from '../audio/sfx';
import { acquireImage, releaseImage } from '../gfx/effects';
import { makeSprites, type SpriteData } from '../gfx/pixelSprite';
import { glove, impactAt, PixelGrid, RifleWeapon, type ViewSpec } from './rifleView';

type FucileStats = (typeof WEAPON_STATS)['fucile'];

const ICON: SpriteData = [
  '.........',
  '.......0.',
  '00000000d',
  '0433dd330',
  '03300d000',
  '000.0d0..',
  '.....0d0.',
  '.....0d0.',
  '.....000.',
];

/** caricatore curvo: colonne x di ogni riga (scende verso sinistra) */
const MAG_ROWS = [8, 8, 7, 7, 6, 6, 5, 5, 4, 4, 3, 3];

/**
 * Fucile d'assalto visto da dietro: mirino a palo, canna, paramano di legno,
 * castello scuro, caricatore curvo, calcio di legno, guanti.
 */
function frame(withMag: boolean): SpriteData {
  const g = new PixelGrid(28, 42);
  // caricatore curvo, sotto il castello (disegnato per primo: sta dietro)
  if (withMag) {
    MAG_ROWS.forEach((x, i) => {
      g.rect(x, 27 + i, 4, 1, i % 4 === 3 ? 'f' : 'e').set(x, 27 + i, 'd');
    });
  }
  // calcio
  g.trap(33, 40, 14, 5, 6, '3', '4', '2');
  g.set(12, 35, '2').set(16, 37, '2').set(13, 39, '2');
  // castello + tacca di mira + manetta d'armamento + finestra d'espulsione
  g.trap(24, 32, 14, 5, 5.5, 'f', 'e', '0');
  g.rect(10, 24, 8, 1, 'e');
  g.rect(13, 23, 2, 1, 'd');
  g.rect(19, 26, 3, 1, 'd');
  g.rect(16, 27, 2, 2, '0');
  // paramano di legno con le feritoie
  g.trap(12, 23, 14, 3, 4.5, '3', '4', '2');
  g.rect(13, 15, 2, 1, '2').rect(13, 18, 2, 1, '2').rect(13, 21, 2, 1, '2');
  // canna, base del mirino, palo, freno di bocca
  g.rect(13, 2, 2, 10, 'f').rect(13, 2, 1, 10, 'e');
  g.rect(12, 6, 4, 2, 'f').set(12, 6, 'e');
  g.rect(14, 3, 1, 3, 'f');
  g.rect(12, 1, 4, 2, 'f').rect(13, 1, 2, 1, '0');
  // mani
  glove(g, 6, 15, 5, 5);
  glove(g, 20, 32, 5, 6);
  return g.outline().sprite();
}

function magSprite(vertical: boolean): SpriteData {
  const g = vertical ? new PixelGrid(5, 9) : new PixelGrid(9, 5);
  if (vertical) g.rect(1, 1, 3, 7, 'e').rect(1, 1, 1, 7, 'd').rect(1, 1, 3, 1, '4');
  else g.rect(1, 1, 7, 3, 'e').rect(1, 1, 7, 1, 'd').rect(1, 1, 1, 3, '4');
  return g.outline().sprite();
}

const SHELL_H: SpriteData = ['443', '333'];
const SHELL_V: SpriteData = ['43', '43', '33'];
const SHELL_KEYS = ['fx-rshell-h', 'fx-rshell-v'] as const;
const MAG_KEYS = ['fx-rmag-h', 'fx-rmag-v'] as const;

const VIEW: ViewSpec = {
  key: 'vm-fucile',
  base: frame(true),
  muzzle: { x: 14, y: 1 },
  eject: { x: 17, y: 27 },
  frames: { nomag: frame(false) },
};

/**
 * Fucile d'assalto: tieni premuto per la raffica a cadenza alta. Il rinculo
 * fa salire la mira a ogni colpo (recupera quando smetti). Caricatore da 30,
 * poi ricarica rapida: il caricatore vuoto cade a terra e ne sale uno nuovo.
 */
export class Fucile extends RifleWeapon<FucileStats> {
  readonly id = 'fucile';
  readonly name = 'FUCILE';
  readonly icon = ICON;

  private mag = 30;
  private reloadAt = -1;
  private dropped = false;
  private seated = false;
  /** salita della mira dovuta al rinculo (px) */
  private climb = 0;
  private newMag: Phaser.GameObjects.Image | null = null;

  protected viewSpec(): ViewSpec {
    return VIEW;
  }

  protected makeOwnSprites(): void {
    makeSprites(this.ctx.scene, {
      [SHELL_KEYS[0]]: SHELL_H,
      [SHELL_KEYS[1]]: SHELL_V,
      [MAG_KEYS[0]]: magSprite(false),
      [MAG_KEYS[1]]: magSprite(true),
    });
  }

  activate(): void {
    super.activate();
    this.mag = this.stats.magSize;
    this.reloadAt = -1;
    this.climb = 0;
  }

  protected cleanup(): void {
    releaseImage(this.newMag);
    this.newMag = null;
    this.reloadAt = -1;
  }

  protected tick(dtMs: number): void {
    const view = this.view;
    if (!view) return;
    const s = this.stats;
    const firing = this.triggerHeld && this.reloadAt < 0;
    if (firing) this.fire();
    else this.climb = Math.max(0, this.climb - s.recoilRecover * (dtMs / PHYSICS.stepMs));
    view.setAim(this.aimX, this.aimY - this.climb);
    if (this.reloadAt >= 0) this.animateReload();
  }

  private fire(): void {
    const view = this.view;
    const sc = this.shotCtx;
    if (!view || !sc || !this.tryUse()) return;
    const scene = this.ctx.scene;
    const s = this.stats;
    view.update(0);
    const m = this.muzzleFlash(1);
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * (s.spread + this.climb * 0.2);
    const x = this.aimX + Math.cos(a) * r;
    const y = this.aimY - this.climb + Math.sin(a) * r;
    impactAt(sc, s, x, y, m.x, m.y, scene);
    this.tracers?.add(m.x, m.y, x, y, C.yellow);
    const e = view.ejectPort();
    this.debris?.spawn(e.x, e.y, 1.4 + Math.random() * 1.2, -2.8 - Math.random() * 1.4, SHELL_KEYS);
    view.kickBack(2);
    this.climb = Math.min(s.recoilMax, this.climb + s.recoilPerShot);
    // "tatata" secco
    noise({ dur: 0.06, vol: 0.26, freq: 5200, freqTo: 600 });
    tone({ type: 'square', from: 520 + Math.random() * 80, to: 130, dur: 0.05, vol: 0.14 });

    if (--this.mag <= 0) {
      this.reloadAt = scene.time.now;
      this.dropped = false;
      this.seated = false;
    }
  }

  private animateReload(): void {
    const view = this.view;
    if (!view) return;
    const scene = this.ctx.scene;
    const t = (scene.time.now - this.reloadAt) / this.stats.reloadMs;
    if (t >= 1) {
      this.reloadAt = -1;
      this.mag = this.stats.magSize;
      view.setFrame(null);
      return;
    }
    // l'arma si inclina e scende un po' mentre si cambia caricatore
    if (t < 0.12) view.setFrame(null);
    else if (t < 0.78) view.setFrame('nomag', -2, 3);
    else view.setFrame(null);

    if (t >= 0.12 && !this.dropped) {
      this.dropped = true;
      const p = view.point(MAG_ROWS[6] + 2, 33);
      this.debris?.spawn(p.x, p.y, -0.8 - Math.random() * 0.5, -0.6, MAG_KEYS);
      tone({ type: 'square', from: 900, to: 600, dur: 0.04, vol: 0.1 });
    }
    if (t >= 0.32 && t < 0.78) {
      const k = (t - 0.32) / 0.46;
      const dst = view.point(MAG_ROWS[6] + 2, 33);
      const x = Math.round(dst.x - 3 * (1 - k));
      const y = Math.round(dst.y + 24 * (1 - k));
      if (!this.newMag) this.newMag = acquireImage(scene, x, y, MAG_KEYS[1]).setDepth(view.img.depth - 0.5);
      this.newMag.setPosition(x, y);
    } else if (this.newMag) {
      releaseImage(this.newMag);
      this.newMag = null;
    }
    if (t >= 0.78 && !this.seated) {
      this.seated = true;
      // caricatore inserito + manetta: "clic-clac"
      noise({ dur: 0.04, vol: 0.2, freq: 4500, freqTo: 1200 });
      tone({ type: 'square', from: 260, to: 140, dur: 0.05, vol: 0.16 });
      tone({ type: 'square', from: 1100, to: 800, dur: 0.03, vol: 0.1, delay: 0.07 });
      view.kickBack(1);
    }
  }

  protected tinkSound(speed: number): void {
    const f = 2600 + Math.random() * 900;
    tone({ type: 'square', from: f, to: f * 0.8, dur: 0.03, vol: Math.min(0.05, 0.012 * speed) });
  }

  get debugState(): { mag: number; reloading: boolean; climb: number } {
    return { mag: this.mag, reloading: this.reloadAt >= 0, climb: this.climb };
  }
}
