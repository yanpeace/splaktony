import type Phaser from 'phaser';
import { WEAPON_STATS } from '../config/balance';
import { C } from '../config/palette';
import { noise, tone } from '../audio/sfx';
import { acquireImage, releaseImage, shake, spawnParticles } from '../gfx/effects';
import { makeSprites, type SpriteData } from '../gfx/pixelSprite';
import type { WeaponPointer } from './Weapon';
import { glove, impactAt, PixelGrid, RifleWeapon, traceRay, type ViewSpec } from './rifleView';

type DoppiettaStats = (typeof WEAPON_STATS)['doppietta'];

const ICON: SpriteData = [
  '.........',
  '...000000',
  '..03dddd0',
  '.033cccc0',
  '034330000',
  '0343300..',
  '03430....',
  '0330.....',
  '000......',
];

type Breech = 'closed' | 'spent' | 'empty' | 'loaded';

/**
 * Doppietta a canne mozze vista da dietro: due canne affiancate, bascula di
 * metallo, impugnatura di legno, guanti. Aperta "a libro" le canne scendono
 * (più corte in prospettiva) e si vedono le due camere.
 */
function frame(state: Breech): SpriteData {
  const g = new PixelGrid(32, 36);
  const open = state !== 'closed';
  const top = open ? 13 : 1;
  // legno: astina ai lati delle canne, impugnatura e calcio
  g.trap(11, 22, 16, 8.5, 9.5, '3', '4', '2');
  g.rect(8, 15, 16, 1, '2').rect(8, 19, 16, 1, '2');
  g.trap(26, 34, 16, 6, 8, '3', '4', '2');
  g.set(13, 28, '2').set(18, 30, '2').set(14, 32, '2').set(19, 27, '1');
  // bascula
  g.trap(21, 25, 16, 7, 7.5, 'd', 'c', 'e');
  g.rect(12, 23, 8, 1, 'e');
  // canne + bindella in mezzo
  // canne cilindriche (più strette in cima: prospettiva), separate da una fessura nera
  for (const cx of [12.5, 19.5]) {
    g.trap(top, 21, cx, 2.5, 3.5, 'e', 'c', 'f');
    g.trap(top, 21, cx - 0.5, 0.5, 0.5, 'd');
  }
  g.rect(16, top, 1, 21 - top, '0');
  if (!open) {
    // volate: anello chiaro e anima nera
    for (const x of [10, 17]) {
      g.rect(x + 1, top, 4, 3, 'd');
      g.rect(x + 2, top, 2, 2, '0');
    }
  } else {
    // camere viste da dietro (bascula aperta a libro)
    const [rim, core] = state === 'empty' ? ['f', '0'] : state === 'spent' ? ['4', '1'] : ['4', '2'];
    for (const cx of [13, 20]) {
      g.rect(cx - 2, 14, 5, 5, 'd');
      g.rect(cx - 2, 15, 5, 3, rim).rect(cx - 1, 14, 3, 5, rim);
      g.rect(cx - 1, 15, 3, 3, core);
    }
  }
  // mani
  glove(g, 3, open ? 17 : 14, 5, 5);
  glove(g, 23, 27, 5, 6);
  return g.outline().sprite();
}

/** coppia di cartucce nuove tenute dal guanto */
function loaderSprite(): SpriteData {
  const g = new PixelGrid(15, 11);
  g.rect(3, 1, 3, 4, '2').rect(10, 1, 3, 4, '2');
  g.rect(3, 1, 1, 4, '3').rect(10, 1, 1, 4, '3');
  g.rect(3, 5, 3, 1, '4').rect(10, 5, 3, 1, '4');
  glove(g, 2, 6, 11, 3);
  return g.outline().sprite();
}

const SHELL_H: SpriteData = ['0000', '2224', '1124', '0000'];
const SHELL_V: SpriteData = ['0220', '0220', '0120', '0440'];
const SHELL_KEYS = ['fx-dshell-h', 'fx-dshell-v'] as const;

const VIEW: ViewSpec = {
  key: 'vm-doppietta',
  base: frame('closed'),
  muzzle: { x: 16, y: 1 },
  eject: { x: 16, y: 16 },
  frames: { spent: frame('spent'), empty: frame('empty'), loaded: frame('loaded') },
};

/**
 * Doppietta: ogni tap spara una rosa di pallini in un cono verso il dito
 * (ognuno fa danno alla parte che colpisce) con grossa spinta. Dopo 2 colpi
 * ricarica a libro: si apre, 2 cartucce rosse volano fuori, entrano le nuove,
 * si chiude con un CLACK.
 */
export class Doppietta extends RifleWeapon<DoppiettaStats> {
  readonly id = 'doppietta';
  readonly name = 'DOPPIETTA';
  readonly icon = ICON;

  private loaded = 2;
  /** inizio della ricarica (-1 = non in ricarica) */
  private reloadAt = -1;
  private ejected = false;
  private closed = false;
  private loader: Phaser.GameObjects.Image | null = null;

  protected viewSpec(): ViewSpec {
    return VIEW;
  }

  protected makeOwnSprites(): void {
    makeSprites(this.ctx.scene, {
      [SHELL_KEYS[0]]: SHELL_H,
      [SHELL_KEYS[1]]: SHELL_V,
      'vm-doppietta-loader': loaderSprite(),
    });
  }

  activate(): void {
    super.activate();
    this.loaded = this.stats.shots;
    this.reloadAt = -1;
  }

  protected cleanup(): void {
    releaseImage(this.loader);
    this.loader = null;
    this.reloadAt = -1;
  }

  protected onTriggerDown(p: WeaponPointer): void {
    if (this.reloadAt >= 0 || this.loaded <= 0 || !this.tryUse(p.time)) return;
    this.fire();
    this.loaded--;
    if (this.loaded <= 0) {
      this.reloadAt = this.ctx.scene.time.now;
      this.ejected = false;
      this.closed = false;
    }
  }

  private fire(): void {
    const view = this.view;
    const sc = this.shotCtx;
    if (!view || !sc) return;
    const scene = this.ctx.scene;
    const s = this.stats;
    view.update(0);
    const m = this.muzzleFlash(3);
    spawnParticles(scene, m.x, m.y - 3, {
      count: 6,
      colors: [C.yellow, C.orange, C.white],
      speed: 2.4,
      angle: Math.atan2(this.aimY - m.y, this.aimX - m.x),
      spread: 0.9,
      size: 1,
      lifeMs: 160,
      gravity: 0,
    });
    const base = Math.atan2(this.aimY - m.y, this.aimX - m.x);
    const dist = Math.hypot(this.aimX - m.x, this.aimY - m.y);
    for (let i = 0; i < s.pellets; i++) {
      // dispersione uniforme nel cono, un po' più lunga del punto mirato
      const a = base + (Math.random() * 2 - 1) * s.coneRad;
      const reach = dist * (1.05 + Math.random() * 0.2) + 6;
      const ex = m.x + Math.cos(a) * reach;
      const ey = m.y + Math.sin(a) * reach;
      const hit = traceRay(this.ctx.ragdoll, m.x, m.y, ex, ey, s.hitTolerance);
      const hx = hit ? hit.x : ex;
      const hy = hit ? hit.y : ey;
      impactAt(sc, s, hx, hy, m.x, m.y, scene, hit?.part ?? null);
      this.tracers?.add(m.x, m.y, hx, hy, C.yellow);
    }
    view.kickBack(6);
    shake(scene, 2, 120);
    // BOOM grave e corposo
    noise({ dur: 0.28, vol: 0.5, freq: 3200, freqTo: 120 });
    tone({ type: 'square', from: 170, to: 40, dur: 0.22, vol: 0.28 });
    tone({ type: 'triangle', from: 110, to: 35, dur: 0.3, vol: 0.35 });
  }

  protected tick(): void {
    const view = this.view;
    if (!view) return;
    view.setAim(this.aimX, this.aimY);
    if (this.reloadAt < 0) return;
    const scene = this.ctx.scene;
    const t = (scene.time.now - this.reloadAt) / this.stats.reloadMs;
    if (t >= 1) {
      this.reloadAt = -1;
      this.loaded = this.stats.shots;
      view.setFrame(null);
      return;
    }
    if (t < 0.15) view.setFrame('spent', -2, 4);
    else if (t < 0.72) view.setFrame('empty', -3, 5);
    else if (t < 0.86) view.setFrame('loaded', -3, 5);
    else view.setFrame(null, 0, 0);

    if (t >= 0.15 && !this.ejected) {
      this.ejected = true;
      // apertura: "chk" e le due cartucce vuote saltano fuori
      tone({ type: 'square', from: 700, to: 420, dur: 0.04, vol: 0.12 });
      noise({ dur: 0.04, vol: 0.12, freq: 4000, freqTo: 1500 });
      for (const [px, vx] of [
        [13, -1.6],
        [20, 1.4],
      ] as const) {
        const e = view.point(px, 16);
        this.debris?.spawn(e.x, e.y - 2, vx + (Math.random() - 0.5) * 0.6, -3.6 - Math.random(), SHELL_KEYS);
      }
    }

    // le cartucce nuove salgono dal basso nelle camere
    if (t >= 0.35 && t < 0.72) {
      const k = (t - 0.35) / 0.37;
      const dst = view.point(16, 18);
      const x = Math.round(dst.x - 2 * (1 - k));
      const y = Math.round(dst.y + 22 * (1 - k) * (1 - k) + 4);
      if (!this.loader) this.loader = acquireImage(scene, x, y, 'vm-doppietta-loader').setDepth(view.img.depth + 0.5);
      this.loader.setPosition(x, y);
    } else if (this.loader) {
      releaseImage(this.loader);
      this.loader = null;
      tone({ type: 'square', from: 1500, to: 1300, dur: 0.03, vol: 0.08 });
    }

    if (t >= 0.86 && !this.closed) {
      this.closed = true;
      // CLACK
      noise({ dur: 0.06, vol: 0.3, freq: 5000, freqTo: 900 });
      tone({ type: 'square', from: 320, to: 120, dur: 0.07, vol: 0.2 });
      tone({ type: 'square', from: 1200, to: 900, dur: 0.03, vol: 0.1, delay: 0.02 });
      view.kickBack(2);
    }
  }

  protected tinkSound(): void {
    // cartuccia di plastica: "toc" sordo
    tone({ type: 'triangle', from: 500, to: 300, dur: 0.04, vol: 0.06 });
  }

  get debugState(): { loaded: number; reloading: boolean } {
    return { loaded: this.loaded, reloading: this.reloadAt >= 0 };
  }
}
