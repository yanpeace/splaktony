import Phaser from 'phaser';
import { PHYSICS, ROOM_INNER, SCIFI, WEAPON_STATS } from '../config/balance';
import { C } from '../config/palette';
import { noise, tone } from '../audio/sfx';
import { acquireImage, isFrozen, popFrames, releaseImage, shake, spawnParticles } from '../gfx/effects';
import { makeSprites, type SpriteData } from '../gfx/pixelSprite';
import { BulletHoles, ensureFirearmSprites, FLASH_FRAMES } from './Pistola';
import { DotLayer, PixelGrid, ViewModel, pointerStillDown } from './scifiView';
import { Weapon, type WeaponPointer } from './Weapon';

type MinigunStats = (typeof WEAPON_STATS)['minigun'];

const ICON_MINIGUN: SpriteData = [
  '.........',
  '0000000..',
  'dededed00',
  '00000000e',
  'ededede0f',
  '0000000ef',
  '.....0fff',
  '.....0f40',
  '......04.',
];

/** Viewmodel: 6 canne rotanti (3 frame), carter del motore, guanti e nastro di cartucce. */
function minigunFrames(): SpriteData[] {
  const W = 30;
  const H = 28;
  const frames: SpriteData[] = [];
  for (let f = 0; f < 3; f++) {
    const g = new PixelGrid(W, H);
    // --- fascio di canne: si allarga verso il basso (prospettiva); a righe
    // verticali canna/canna/fessura che scorrono di 1px per frame = rotazione
    for (let r = 0; r < 14; r++) {
      const w = r < 4 ? 8 : r < 9 ? 10 : 12;
      const left = 15 - w / 2;
      g.px(left, r, '0').px(left + w - 1, r, '0');
      const wi = w - 2;
      for (let i = 0; i < wi; i++) {
        const k = (i + f) % 3;
        const lit = i < wi / 2;
        const c = k === 0 ? (lit ? 'f' : '0') : k === 1 ? (lit ? 'c' : 'd') : lit ? 'd' : 'e';
        g.px(left + 1 + i, r, c);
      }
    }
    // bocche nere in cima, anello di bocca e fascetta a metà
    g.hline(11, 0, 8, '0');
    g.hline(11, 1, 8, 'd').px(11, 1, '0').px(18, 1, '0').px(12, 1, 'c');
    g.hline(10, 8, 10, 'e').px(10, 8, '0').px(19, 8, '0').px(11, 8, 'd');
    // --- carter del motore
    g.box(4, 13, 22, 9, 'e');
    g.hline(5, 14, 20, 'd').vline(5, 14, 6, 'd').px(6, 14, 'c').px(7, 14, 'c');
    g.vline(24, 14, 7, 'f').hline(5, 20, 20, 'f');
    g.rect(12, 15, 6, 4, 'f').rect(13, 16, 4, 2, '0').px(14, 16, '2').px(15, 16, '3');
    g.px(8, 17, '0').px(10, 17, '0').px(20, 17, '0').px(22, 17, '0');
    // --- guanto sinistro sulla maniglia laterale
    g.box(0, 15, 7, 7, 'f').hline(1, 16, 5, 'e').px(2, 18, '0').px(4, 18, '0').px(2, 20, 'e');
    // --- nastro di cartucce che scende a destra
    for (let k = 0; k < 6; k++) {
      const x = 22 + k;
      const y = 21 + k;
      g.px(x, y, '4').px(x + 1, y, '3').px(x, y + 1, '3').px(x + 1, y + 1, '0');
    }
    // --- impugnatura posteriore con guanto
    g.box(10, 21, 10, 7, 'f').hline(11, 22, 8, 'e');
    g.px(12, 24, '0').px(14, 24, '0').px(16, 24, '0').px(18, 24, '0').hline(11, 26, 8, '0');
    frames.push(g.rows());
  }
  return frames;
}

const SHELL_H: SpriteData = ['443', '333'];
const SHELL_V: SpriteData = ['43', '43', '33'];
const SHELL_KEYS = { h: 'fx-sf-shell-h', v: 'fx-sf-shell-v' } as const;

interface Shell {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
  restAt: number;
  vertical: boolean;
}

interface Tracer {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  bornAt: number;
}

/**
 * Minigun: tieni premuto. Le 6 canne prima girano a vuoto (spin-up con suono
 * che sale), poi sparano una raffica altissima: traccianti, pioggia di bossoli
 * e Tony che "balla" sotto i colpi. Al rilascio le canne rallentano.
 */
export class Minigun extends Weapon<MinigunStats> {
  readonly id = 'minigun';
  readonly name = 'MINIGUN';
  readonly icon = ICON_MINIGUN;
  override readonly allowsGrab = false;

  private view: ViewModel | null = null;
  private holes: BulletHoles | null = null;
  private dots: DotLayer | null = null;
  private triggerId: number | null = null;
  private targetX = 0;
  private targetY = 0;
  /** 0 = canne ferme, 1 = a regime */
  private spin = 0;
  private barrelPhase = 0;
  private nextWhirAt = 0;
  private shots = 0;
  private danceSign = 1;
  private shells: Shell[] = [];
  private tracers: Tracer[] = [];
  private lastTinkAt = 0;

  activate(): void {
    super.activate();
    const scene = this.ctx.scene;
    ensureFirearmSprites(scene);
    makeSprites(scene, { [SHELL_KEYS.h]: SHELL_H, [SHELL_KEYS.v]: SHELL_V });
    this.view = new ViewModel(scene, { key: 'vm-minigun', frames: minigunFrames(), muzzleRow: 0 });
    this.view.show();
    this.holes = new BulletHoles(scene);
    this.dots = new DotLayer(scene, SCIFI.viewDepth - 1);
    this.spin = 0;
  }

  deactivate(): void {
    this.triggerId = null;
    this.spin = 0;
    this.view?.hide();
    this.view = null;
    this.holes?.clear();
    this.holes = null;
    this.dots?.destroy();
    this.dots = null;
    this.shells.forEach((s) => releaseImage(s.img));
    this.shells = [];
    this.tracers = [];
  }

  onPointerDown(p: WeaponPointer): void {
    this.view?.aim(p.x, p.y);
    if (this.triggerId !== null) return;
    this.triggerId = p.id;
    this.targetX = p.x;
    this.targetY = p.y;
  }

  onPointerMove(p: WeaponPointer): void {
    if (p.id !== this.triggerId) return;
    this.targetX = p.x;
    this.targetY = p.y;
    this.view?.aim(p.x, p.y);
  }

  onPointerUp(p: WeaponPointer): void {
    if (p.id === this.triggerId) this.triggerId = null;
  }

  update(dtMs: number): void {
    if (!this.view) return;
    const s = this.stats;
    const now = this.ctx.scene.time.now;
    if (this.triggerId !== null && !pointerStillDown(this.ctx.scene, this.triggerId)) this.triggerId = null;
    const held = this.triggerId !== null;

    // canne: spin-up tenendo premuto, spin-down al rilascio
    if (held) this.spin = Math.min(1, this.spin + dtMs / s.spinUpMs);
    else this.spin = Math.max(0, this.spin - dtMs / s.spinDownMs);
    if (this.spin > 0) {
      const frameMs = Phaser.Math.Linear(SCIFI.minigunBarrelMinMs, SCIFI.minigunBarrelMaxMs, this.spin);
      this.barrelPhase += dtMs / frameMs;
      this.view.setFrame(Math.floor(this.barrelPhase) % 3);
      if (now >= this.nextWhirAt) {
        this.nextWhirAt = now + SCIFI.minigunWhirMs;
        const f = 70 + this.spin * this.spin * 420;
        tone({ type: 'square', from: f, to: f * (held ? 1.12 : 0.9), dur: 0.06, vol: 0.03 + this.spin * 0.04 });
      }
    }

    if (held && this.spin >= 1) this.fire(now);

    this.view.update(dtMs);
    this.holes?.update();
    this.updateShells(dtMs, now);
    this.drawTracers(now);
  }

  private fire(now: number): void {
    if (!this.view || !this.holes || !this.tryUse(now)) return;
    const s = this.stats;
    const { scene, ragdoll } = this.ctx;
    const m = this.view.muzzle();
    this.view.recoil(1);
    this.shots++;
    if (this.shots % 2 === 0) popFrames(scene, m.x, m.y - 2, FLASH_FRAMES, 30, { depth: SCIFI.viewDepth + 1 });
    noise({ dur: 0.035, vol: 0.1, freq: 3500, freqTo: 400 });
    tone({ type: 'square', from: 220, to: 70, dur: 0.035, vol: 0.06 });
    if (this.shots % 4 === 0) shake(scene, 1, 80);
    if (this.shots % SCIFI.shellEvery === 0) this.ejectShell(m.x + 10, m.y + 18);

    for (let k = 0; k < s.pellets; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * s.spread;
      const x = Math.round(this.targetX + Math.cos(a) * r);
      const y = Math.round(this.targetY + Math.sin(a) * r);
      this.addTracer(m.x + (k === 0 ? -2 : 2), m.y, x, y, now);
      const target = ragdoll.partAt(x, y, s.hitTolerance);
      if (!target) {
        if (BulletHoles.inRoom(x, y) && Math.random() < 0.5) this.holes.add(x, y);
        spawnParticles(scene, x, y, { count: 2, colors: [C.yellow, C.white], speed: 1.6, size: 1, lifeMs: 160, gravity: 0.1 });
        continue;
      }
      let dx = x - m.x;
      let dy = y - m.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      // mai verso il pavimento; scossa laterale alternata + salto: Tony "balla"
      this.danceSign = -this.danceSign;
      const side = this.danceSign * s.dance * (0.5 + Math.random() * 0.5);
      ragdoll.applyImpulse(target.part, x, y, dx * s.impulse - dy * side, Math.min(0, dy * s.impulse) + dx * side - s.lift);
      if (s.bodyShare > 0) ragdoll.addVelocity(dx * s.impulse * s.bodyShare, dy * s.impulse * s.bodyShare, target.part);
      this.hit({ part: target.part.name, x, y, amount: s.damage, weaponId: this.id });
    }
  }

  // ---------------------------------------------------------------- traccianti

  private addTracer(x0: number, y0: number, x1: number, y1: number, now: number): void {
    if (this.tracers.length >= SCIFI.maxTracers) this.tracers.shift();
    this.tracers.push({ x0, y0, x1, y1, bornAt: now });
  }

  private drawTracers(now: number): void {
    const dots = this.dots;
    if (!dots) return;
    dots.begin();
    let w = 0;
    for (let i = 0; i < this.tracers.length; i++) {
      const t = this.tracers[i];
      const k = (now - t.bornAt) / SCIFI.tracerMs;
      if (k >= 1) continue;
      this.tracers[w++] = t;
      const dx = t.x1 - t.x0;
      const dy = t.y1 - t.y0;
      const len = Math.hypot(dx, dy) || 1;
      const head = Math.min(len, len * (k + 0.35));
      const tail = Math.max(0, head - SCIFI.tracerLen);
      for (let d = tail; d <= head; d += 1) {
        dots.dot(t.x0 + (dx * d) / len, t.y0 + (dy * d) / len, d > head - 2 ? C.white : d < tail + 3 ? C.red : C.yellow);
      }
    }
    this.tracers.length = w;
  }

  // ---------------------------------------------------------------- bossoli

  private ejectShell(x: number, y: number): void {
    if (this.shells.length >= SCIFI.maxShells) releaseImage(this.shells.shift()?.img);
    const img = acquireImage(this.ctx.scene, x, y, SHELL_KEYS.h).setOrigin(0).setDepth(SCIFI.shellDepth);
    this.shells.push({
      img,
      x,
      y,
      vx: 0.6 + Math.random() * 1.8,
      vy: -3.5 - Math.random() * 2.5,
      restAt: -1,
      vertical: false,
    });
  }

  private updateShells(dtMs: number, now: number): void {
    const frozen = isFrozen(this.ctx.scene);
    const steps = dtMs / PHYSICS.stepMs;
    const floor = ROOM_INNER.bottom - 2;
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const sh = this.shells[i];
      if (sh.restAt < 0) {
        if (frozen) continue;
        sh.vy += SCIFI.shellGravity * steps;
        sh.x += sh.vx * steps;
        sh.y += sh.vy * steps;
        if (sh.x > ROOM_INNER.right - 3) {
          sh.x = ROOM_INNER.right - 3;
          sh.vx = -Math.abs(sh.vx) * SCIFI.shellBounce;
        }
        if (sh.y >= floor && sh.vy > 0) {
          sh.y = floor;
          if (sh.vy < 1.2) {
            sh.restAt = now;
            sh.vertical = false;
            sh.img.setTexture(SHELL_KEYS.h).setDepth(SCIFI.shellFloorDepth);
          } else {
            sh.vy = -sh.vy * SCIFI.shellBounce;
            sh.vx *= 0.6;
            this.tink();
          }
        }
        // rotazione a scatti
        if (Math.floor(now / 60) % 2 === 0 !== sh.vertical && sh.restAt < 0) {
          sh.vertical = !sh.vertical;
          sh.img.setTexture(sh.vertical ? SHELL_KEYS.v : SHELL_KEYS.h);
        }
      } else {
        const age = now - sh.restAt;
        if (age >= SCIFI.shellRestMs + SCIFI.shellBlinkMs) {
          releaseImage(sh.img);
          this.shells.splice(i, 1);
          continue;
        }
        if (age > SCIFI.shellRestMs) sh.img.setVisible(Math.floor(age / 80) % 2 === 1);
      }
      sh.img.setPosition(Math.round(sh.x), Math.round(sh.y));
    }
  }

  private tink(): void {
    const now = this.ctx.scene.time.now;
    if (now - this.lastTinkAt < 60) return;
    this.lastTinkAt = now;
    const f = 2800 + Math.random() * 900;
    tone({ type: 'square', from: f, to: f * 0.8, dur: 0.025, vol: 0.035 });
  }

  /** Per il debug da console. */
  get debugCounts(): { spin: number; shells: number; tracers: number; holes: number } {
    return { spin: this.spin, shells: this.shells.length, tracers: this.tracers.length, holes: this.holes?.count ?? 0 };
  }
}
