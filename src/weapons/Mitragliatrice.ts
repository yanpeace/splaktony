import { GUN_VIEW, WEAPON_STATS } from '../config/balance';
import { noise, playShot, tone } from '../audio/sfx';
import type { SpriteData } from '../gfx/pixelSprite';
import { BulletHoles, GunView, fireHitscan, type GunArt } from './gunView';
import { Weapon, type WeaponPointer } from './Weapon';

type MitraStats = (typeof WEAPON_STATS)['mitragliatrice'];

const ICON_MITRA: SpriteData = [
  '...........',
  '.000000000.',
  '0ddddddddd0',
  '0eeeeeeeee0',
  '00e00ee0000',
  '.0e0.0e0...',
  '.0f0.0e0...',
  '.000.0e0...',
  '.....000...',
];

/*
 * Mitra in mano visto da dietro: canna lunga con copricanna forato (H/K/J =
 * canna che si scalda), castello, caricatore a sinistra (si stacca nella
 * ricarica), guanto giallo sull'impugnatura e manica blu.
 */
const MITRA_IDLE: SpriteData = [
  '..........000..........',
  '..........0c0..........',
  '..........0d0..........',
  '.........0KHK0.........',
  '.........0HJH0.........',
  '.........0KHK0.........',
  '........0fKHKf0........',
  '........0fHJHf0........',
  '........0fKHKf0........',
  '........0fHJHf0........',
  '.......0ffKHKff0.......',
  '.......0eeeeeeee0......',
  '......0eedddddee0......',
  '......0edd0f0dde0......',
  '......0efffffffe0......',
  '.....0eeffffffffe0.....',
  '.....0effe0ff0ffe0.....',
  '....00ffffffffff00.....',
  '...0ff0fffffff03330....',
  '...0ef0ffffff0222210...',
  '...0ef0.0fff02222210...',
  '...0ef0..0f022212220...',
  '...0ef0...0222222210...',
  '...0ee0...02222122100..',
  '....00....01122222111..',
  '...........0111111199..',
  '............099999989..',
  '............09999998...',
];

const MITRA_ART: GunArt = {
  key: 'gv-mitra',
  idle: MITRA_IDLE,
  slideRow: 10,
  pivot: { x: 13, y: 21 },
  muzzle: { x: 11, y: 0 },
  port: { x: 16, y: 12 },
  ejectDir: 1,
  magRect: { x: 3, y: 18, w: 4, h: 7 },
  heat: true,
  kickJitterX: GUN_VIEW.mitraKickJitterX,
  reloadPose: 2,
};

/**
 * Mitragliatrice: tieni premuto per sparare a raffica. Ogni colpo va verso la
 * posizione ATTUALE del dito, con dispersione che cresce durante la raffica e
 * la mira che sale col rinculo. Canna che si scalda, bossoli a pioggia, fumo al
 * rilascio, caricatore da `magSize`. Non afferra Tony.
 */
export class Mitragliatrice extends Weapon<MitraStats> {
  readonly id = 'mitragliatrice';
  readonly name = 'MITRA';
  readonly icon = ICON_MITRA;
  override readonly allowsGrab = false;

  private holes: BulletHoles | null = null;
  private view: GunView | null = null;
  /** dito che tiene premuto il grilletto (null = nessuna raffica) */
  private triggerId: number | null = null;
  private targetX = 0;
  private targetY = 0;
  private ammo = 0;
  /** colpi della raffica in corso (per rinculo e dispersione) */
  private burst = 0;
  private lastShotAt = -1e9;

  activate(): void {
    super.activate();
    const scene = this.ctx.scene;
    this.holes = new BulletHoles(scene);
    this.view = new GunView(scene, MITRA_ART);
    this.view.show();
    this.ammo = this.stats.magSize;
    this.burst = 0;
  }

  deactivate(): void {
    this.triggerId = null;
    this.holes?.clear();
    this.view?.hide();
    this.holes = null;
    this.view = null;
  }

  onPointerDown(p: WeaponPointer): void {
    if (this.triggerId !== null) return;
    this.triggerId = p.id;
    this.targetX = p.x;
    this.targetY = p.y;
    this.view?.aimAt(p.x, p.y, true);
    this.fire();
  }

  onPointerMove(p: WeaponPointer): void {
    if (p.id !== this.triggerId) {
      if (this.triggerId === null) this.view?.aimAt(p.x, p.y);
      return;
    }
    this.targetX = p.x;
    this.targetY = p.y;
  }

  onPointerUp(p: WeaponPointer): void {
    if (p.id === this.triggerId) this.release();
  }

  private release(): void {
    this.triggerId = null;
    // fumo dalla canna al rilascio (di più se è calda)
    const view = this.view;
    if (view && this.burst > 0) {
      const hot = view.heat >= GUN_VIEW.heatWarm ? GUN_VIEW.smokePuffsHot : 0;
      view.queueSmoke(GUN_VIEW.smokePuffsBurst + hot);
    }
  }

  update(dtMs: number): void {
    const now = this.ctx.scene.time.now;
    if (this.triggerId !== null) {
      // sicurezza: se il dito è stato perso (es. uscito dal canvas) la raffica si ferma
      const id = this.triggerId;
      const ptr = this.ctx.scene.input.manager.pointers.find((q) => q.id === id);
      if (ptr && ptr.isDown) {
        this.view?.aimAt(this.targetX, this.targetY - this.climb());
        this.fire();
      } else this.release();
    }
    if (this.burst > 0 && now - this.lastShotAt > GUN_VIEW.burstResetMs) this.burst = 0;
    this.view?.update(dtMs);
    this.holes?.update();
  }

  /** Quanto è salita la mira per il rinculo (px). */
  private climb(): number {
    const s = this.stats;
    return Math.min(s.climbMax, this.burst * s.climbPerShot);
  }

  private fire(): void {
    const view = this.view;
    if (!this.holes || !view || view.reloading || !this.tryUse()) return;
    const s = this.stats;
    // recoil pattern: la mira sale e ondeggia; la dispersione cresce con la raffica
    const n = this.burst;
    const cx = this.targetX + Math.sin(n * 0.8) * GUN_VIEW.mitraWander * Math.min(1, n / 6);
    const cy = this.targetY - this.climb();
    const spread = s.spread + Math.min(s.spreadMax, n * s.spreadGrowth);
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * spread;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;

    const m = view.fire({ heat: GUN_VIEW.heatPerShot, altFlash: n % 2 === 1 });
    // RATATA pieno: schiocco + corpo basso + "tac" metallico alternato
    playShot();
    noise({ dur: 0.06, vol: 0.2, freq: 2400, freqTo: 140 });
    tone({ type: 'square', from: n % 2 ? 150 : 175, to: 55, dur: 0.06, vol: 0.13 });
    fireHitscan(this.ctx.scene, this.ctx.ragdoll, this.holes, (h) => this.hit(h), this.id, s, x, y, {
      fromX: m.x,
      fromY: m.y,
    });
    view.tracer(x, y);
    view.ejectShell();
    this.burst++;
    this.lastShotAt = this.ctx.scene.time.now;
    if (--this.ammo <= 0) {
      view.queueSmoke(GUN_VIEW.smokePuffsBurst);
      view.startReload(s.reloadMs, () => {
        this.ammo = this.stats.magSize;
        this.burst = 0;
      });
    }
  }

  /** Per il debug da console. */
  get debugCounts(): Record<string, number | boolean> {
    return {
      holes: this.holes?.count ?? 0,
      ammo: this.ammo,
      burst: this.burst,
      heat: Math.round((this.view?.heat ?? 0) * 100) / 100,
      reloading: !!this.view?.reloading,
      ...(this.view?.debugCounts ?? {}),
    };
  }
}
