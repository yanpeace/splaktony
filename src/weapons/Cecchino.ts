import Phaser from 'phaser';
import { RIFLES, SCREEN, SCREEN_FIT, WEAPON_STATS } from '../config/balance';
import { C, hex } from '../config/palette';
import { noise, tone } from '../audio/sfx';
import { acquireImage, hitStop, releaseImage, shake } from '../gfx/effects';
import { makeSprites, type SpriteData } from '../gfx/pixelSprite';
import type { WeaponPointer } from './Weapon';
import { glove, impactAt, PixelGrid, RifleWeapon, type ViewSpec } from './rifleView';

type CecchinoStats = (typeof WEAPON_STATS)['cecchino'];

const R = RIFLES;

const ICON: SpriteData = [
  '.........',
  '..000000.',
  '..0aeeea0',
  '...0000..',
  '000000000',
  '0566dddd0',
  '06600000.',
  '0660.....',
  '0000.....',
];

type Bolt = 'down' | 'up' | 'back';

/**
 * Fucile di precisione visto da dietro: canna lunga, cannocchiale con le
 * lenti azzurre, castello, otturatore a leva sul lato destro, calcio verde.
 */
function frame(bolt: Bolt): SpriteData {
  const g = new PixelGrid(28, 44);
  // calcio
  g.trap(32, 42, 14, 5, 6.5, '6', '5', '7');
  g.set(12, 36, '7').set(16, 39, '7').rect(11, 33, 6, 1, '7');
  // astina verde sotto la canna
  g.trap(14, 31, 14, 3.5, 4.5, '6', '5', '7');
  // canna lunga con freno di bocca
  g.rect(13, 1, 2, 18, 'f').rect(13, 1, 1, 18, 'e');
  g.rect(12, 1, 4, 3, 'f').set(12, 2, '0').set(15, 2, '0');
  // castello
  g.trap(22, 31, 14, 4, 4.5, 'e', 'd', 'f');
  if (bolt === 'back') g.rect(16, 25, 3, 3, '0');
  // cannocchiale: tubo, anelli, torretta, obiettivo e oculare
  g.trap(11, 27, 14, 2.5, 3, '0', 'f', '0');
  g.rect(10, 15, 8, 1, 'e').rect(10, 22, 8, 1, 'e');
  g.rect(17, 18, 2, 2, 'f');
  g.trap(9, 12, 14, 4, 4, '0').rect(12, 10, 4, 2, '9').set(12, 10, 'a');
  g.trap(25, 28, 14, 3.5, 3.5, '0').rect(12, 26, 4, 2, 'a').set(12, 26, 'b');
  // otturatore a leva sul lato destro
  if (bolt === 'down') g.rect(19, 29, 4, 1, 'd').rect(22, 28, 3, 3, 'e').set(23, 29, 'd');
  else {
    const y = bolt === 'up' ? 23 : 26;
    g.rect(19, y, 1, 6, 'd').rect(19, y - 3, 3, 3, 'e').set(20, y - 2, 'd');
  }
  // mani
  glove(g, 6, 17, 5, 5);
  glove(g, 20, 33, 5, 6);
  return g.outline().sprite();
}

const SKULL: SpriteData = [
  '..00000..',
  '.0ccccc0.',
  '0ccccccc0',
  '0c00c00c0',
  '0c00c00c0',
  '0cccdccc0',
  '.0cc0cc0.',
  '.0c0c0c0.',
  '..00000..',
];

const SHELL_H: SpriteData = ['4443', '3333'];
const SHELL_V: SpriteData = ['43', '43', '43', '33'];
const SHELL_KEYS = ['fx-sshell-h', 'fx-sshell-v'] as const;
const SCOPE_KEY = 'fx-scope';

const VIEW: ViewSpec = {
  key: 'vm-cecchino',
  base: frame('down'),
  muzzle: { x: 14, y: 1 },
  eject: { x: 17, y: 26 },
  frames: { up: frame('up'), back: frame('back') },
};

/**
 * Mirino a cannocchiale: texture grande il doppio dello schermo, nera tranne
 * un cerchio trasparente col reticolo, così centrandola in un punto qualsiasi
 * copre sempre tutto lo schermo. Un'immagine sola, niente disegno per frame.
 */
function ensureScopeTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(SCOPE_KEY)) return;
  const w = SCREEN.width * 2;
  // alta come lo schermo più lungo possibile: resta valida se l'altezza cambia dal vivo
  const h = SCREEN_FIT.maxHeight * 2;
  const cx = SCREEN.width;
  const cy = SCREEN_FIT.maxHeight;
  const r = R.scopeRadius;
  const tex = scene.textures.createCanvas(SCOPE_KEY, w, h);
  if (!tex) return;
  const c = tex.getContext();
  const fill = (color: number, x: number, y: number, ww: number, hh: number) => {
    c.fillStyle = hex(color);
    c.fillRect(x, y, ww, hh);
  };
  // nero fuori dal cerchio, riga per riga (bordo a pixel interi)
  for (let y = 0; y < h; y++) {
    const dy = y - cy + 0.5;
    if (Math.abs(dy) >= r) {
      fill(C.black, 0, y, w, 1);
      continue;
    }
    const half = Math.round(Math.sqrt(r * r - dy * dy));
    fill(C.black, 0, y, cx - half, 1);
    fill(C.black, cx + half, y, w - cx - half, 1);
    // bordo interno della lente
    fill(C.charcoal, cx - half, y, 1, 1);
    fill(C.charcoal, cx + half - 1, y, 1, 1);
  }
  fill(C.charcoal, cx - 6, cy - r, 12, 1);
  fill(C.charcoal, cx - 6, cy + r - 1, 12, 1);
  // reticolo: fili sottili al centro, spessi verso il bordo, tacche ogni 8 px
  const gap = 3;
  fill(C.black, cx - r, cy, r - gap, 1);
  fill(C.black, cx + gap + 1, cy, r - gap - 1, 1);
  fill(C.black, cx, cy - r, 1, r - gap);
  fill(C.black, cx, cy + gap + 1, 1, r - gap - 1);
  const thick = Math.round(r * 0.62);
  fill(C.black, cx - r, cy - 1, r - thick, 3);
  fill(C.black, cx + thick + 1, cy - 1, r - thick - 1, 3);
  fill(C.black, cx - 1, cy + thick + 1, 3, r - thick - 1);
  fill(C.black, cx - 1, cy - r, 3, r - thick);
  for (let d = 8; d < thick; d += 8) {
    fill(C.black, cx - d, cy - 1, 1, 3);
    fill(C.black, cx + d, cy - 1, 1, 3);
    fill(C.black, cx - 1, cy + d, 3, 1);
    fill(C.black, cx - 1, cy - d, 3, 1);
  }
  fill(C.red, cx, cy, 1, 1);
  tex.refresh();
}

interface Skull {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  born: number;
}

/**
 * Cecchino: tieni premuto per guardare nel cannocchiale (segue il dito con un
 * leggero ondeggiamento che si calma tenendo fermo), rilascia per sparare al
 * centro del reticolo. Colpo alla testa: danno grezzo x3 (oltre al x2 della
 * testa) e un teschietto che sale. Poi si riarma l'otturatore (bossolo fuori).
 */
export class Cecchino extends RifleWeapon<CecchinoStats> {
  readonly id = 'cecchino';
  readonly name = 'CECCHINO';
  readonly icon = ICON;

  private scope: Phaser.GameObjects.Image | null = null;
  private scopedAt = -1;
  private cx = 0;
  private cy = 0;
  private boltEjected = true;
  private boltClosed = true;
  private skulls: Skull[] = [];

  protected viewSpec(): ViewSpec {
    return VIEW;
  }

  protected makeOwnSprites(): void {
    ensureScopeTexture(this.ctx.scene);
    makeSprites(this.ctx.scene, { [SHELL_KEYS[0]]: SHELL_H, [SHELL_KEYS[1]]: SHELL_V, 'fx-skull': SKULL });
  }

  protected cleanup(): void {
    this.closeScope();
    this.skulls.forEach((s) => releaseImage(s.img));
    this.skulls = [];
  }

  private get ready(): boolean {
    return this.ctx.scene.time.now - this.lastUseAt >= this.stats.cooldownMs;
  }

  private get scoped(): boolean {
    return this.scope !== null;
  }

  protected onTriggerDown(): void {
    if (this.ready) this.openScope();
  }

  protected onTriggerUp(p: WeaponPointer): void {
    if (!this.scoped) return;
    this.updateScope();
    const x = this.cx;
    const y = this.cy;
    this.closeScope();
    if (this.tryUse(p.time)) this.fire(x, y);
  }

  private openScope(): void {
    if (this.scope) return;
    const scene = this.ctx.scene;
    this.scope = acquireImage(scene, this.aimX, this.aimY, SCOPE_KEY).setDepth(R.scopeDepth);
    this.scopedAt = scene.time.now;
    this.view?.setVisible(false);
    // lente che si avvicina all'occhio
    tone({ type: 'triangle', from: 300, to: 600, dur: 0.08, vol: 0.08 });
    this.updateScope();
  }

  private closeScope(): void {
    releaseImage(this.scope);
    this.scope = null;
    this.view?.setVisible(true);
  }

  /** Centro del mirino = dito + ondeggiamento che si calma col tempo. */
  private updateScope(): void {
    if (!this.scope) return;
    const s = this.stats;
    const now = this.ctx.scene.time.now;
    const k = Math.min(1, (now - this.scopedAt) / s.steadyMs);
    const amp = s.swayStartPx + (s.swayPx - s.swayStartPx) * k;
    this.cx = Math.round(this.aimX + Math.sin(now * R.swayFreqX) * amp);
    this.cy = Math.round(this.aimY + Math.sin(now * R.swayFreqY + 1.3) * amp * 0.8);
    this.scope.setPosition(this.cx, this.cy);
  }

  private fire(x: number, y: number): void {
    const view = this.view;
    const sc = this.shotCtx;
    if (!view || !sc) return;
    const scene = this.ctx.scene;
    const s = this.stats;
    view.setAim(x, y);
    view.update(0);
    const m = this.muzzleFlash(3);
    let target = this.ctx.ragdoll.partAt(x, y, s.hitTolerance)?.part ?? null;
    // testa "pulita": se il punto è anche dentro il busto (Tony accartocciato) vale come busto
    if (target?.name === 'head') {
      const torso = this.ctx.ragdoll.part('torso');
      if (torso.body.vertices && this.ctx.scene.matter.verts.contains(torso.body.vertices, { x, y })) target = torso;
    }
    const head = target?.name === 'head';
    impactAt(sc, s, x, y, m.x, m.y, scene, target, head ? s.headMult : 1);
    this.tracers?.add(m.x, m.y, x, y, C.white);
    view.kickBack(7);
    shake(scene, 3, 160);
    if (target) hitStop(scene, head ? 60 : 35);
    if (head) this.spawnSkull(x, y - 14); // sopra il numero di danno
    this.boltEjected = false;
    this.boltClosed = false;
    // CRACK potente con coda
    noise({ dur: 0.4, vol: 0.55, freq: 8000, freqTo: 180 });
    tone({ type: 'square', from: 1300, to: 60, dur: 0.24, vol: 0.22 });
    tone({ type: 'triangle', from: 140, to: 40, dur: 0.4, vol: 0.32 });
    noise({ dur: 0.3, vol: 0.12, freq: 900, freqTo: 120, delay: 0.12 });
  }

  private spawnSkull(x: number, y: number): void {
    const scene = this.ctx.scene;
    if (this.skulls.length >= R.maxSkulls) releaseImage(this.skulls.shift()?.img);
    const img = acquireImage(scene, x, y, 'fx-skull').setDepth(R.scopeDepth + 1);
    this.skulls.push({ img, x: Math.round(x), y: Math.round(y), born: scene.time.now });
    tone({ type: 'square', from: 880, to: 440, dur: 0.12, vol: 0.1, delay: 0.05 });
    tone({ type: 'square', from: 660, to: 330, dur: 0.16, vol: 0.1, delay: 0.16 });
  }

  protected tick(): void {
    const view = this.view;
    if (!view) return;
    const scene = this.ctx.scene;
    const now = scene.time.now;
    if (this.triggerHeld && !this.scoped && this.ready) this.openScope();
    if (this.scoped) this.updateScope();

    // otturatore: su, indietro (bossolo fuori), avanti, giù
    const t = (now - this.lastUseAt) / this.stats.cooldownMs;
    if (t < 1 && !this.boltClosed) {
      if (t < 0.2) view.setFrame(null);
      else if (t < 0.38) view.setFrame('up', 0, 2);
      else if (t < 0.62) view.setFrame('back', 0, 3);
      else if (t < 0.8) view.setFrame('up', 0, 2);
      else view.setFrame(null);
      if (t >= 0.45 && !this.boltEjected) {
        this.boltEjected = true;
        const e = view.ejectPort();
        this.debris?.spawn(e.x, e.y, 1.6 + Math.random(), -3.4 - Math.random(), SHELL_KEYS);
        tone({ type: 'square', from: 800, to: 500, dur: 0.04, vol: 0.12 });
        noise({ dur: 0.05, vol: 0.12, freq: 3500, freqTo: 1000 });
      }
      if (t >= 0.8) {
        this.boltClosed = true;
        view.setFrame(null);
        tone({ type: 'square', from: 600, to: 300, dur: 0.05, vol: 0.14 });
        noise({ dur: 0.04, vol: 0.14, freq: 4000, freqTo: 1200 });
      }
    } else if (!this.boltClosed) {
      this.boltClosed = true;
      view.setFrame(null);
    }

    // teschietti che salgono e lampeggiano
    for (let i = this.skulls.length - 1; i >= 0; i--) {
      const sk = this.skulls[i];
      const k = (now - sk.born) / R.skullMs;
      if (k >= 1) {
        releaseImage(sk.img);
        this.skulls.splice(i, 1);
        continue;
      }
      const rise = Math.sin(Math.min(1, k / 0.5) * Math.PI * 0.5) * R.skullRise;
      sk.img.setPosition(sk.x, Math.round(sk.y - rise));
      sk.img.setVisible(k < 0.6 || Math.floor(k * 20) % 2 === 0);
    }
  }

  protected tinkSound(speed: number): void {
    const f = 2200 + Math.random() * 600;
    tone({ type: 'square', from: f, to: f * 0.8, dur: 0.04, vol: Math.min(0.06, 0.014 * speed) });
  }

  get debugState(): { scoped: boolean; center: { x: number; y: number } } {
    return { scoped: this.scoped, center: { x: this.cx, y: this.cy } };
  }
}
