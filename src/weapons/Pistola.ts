import { GUN_VIEW, WEAPON_STATS } from '../config/balance';
import { playShot, tone } from '../audio/sfx';
import type { SpriteData } from '../gfx/pixelSprite';
import { BulletHoles, GunView, fireHitscan, type GunArt } from './gunView';
import { Weapon, type WeaponPointer } from './Weapon';

// compatibilità: le utility comuni delle armi da fuoco ora stanno in gunView.ts
export {
  BulletHoles,
  FLASH_FRAMES,
  GunView,
  Shells,
  ensureFirearmSprites,
  fireHitscan,
  type GunArt,
  type ShotStats,
} from './gunView';

type PistolaStats = (typeof WEAPON_STATS)['pistola'];

const ICON_PISTOLA: SpriteData = [
  '.........',
  '.0000000.',
  '0ddddddd0',
  '0eeeeeee0',
  '0ee00000.',
  '0ee0e0...',
  '0ff00....',
  '0ff0.....',
  '0000.....',
];

/*
 * Pistola in mano vista da dietro (stile Doom): carrello in alto con mirino,
 * guanto da lavoro giallo e manica blu in basso. FIRE = carrello arretrato
 * verso chi guarda, con la canna che spunta davanti.
 */
const PISTOL_IDLE: SpriteData = [
  '........0........',
  '.......0c0.......',
  '.....0000000.....',
  '.....0cddde0.....',
  '.....0cddde0.....',
  '....0cddddde0....',
  '....0cddddde0....',
  '...0cddddddde0...',
  '...0ddddddddd0...',
  '...0eee0f0eee0...',
  '...0efffffffe0...',
  '...0eff0e0ffe0...',
  '...0efff0fffe0...',
  '....00fffff00....',
  '..00330fff03300..',
  '.0222210f0222220.',
  '.0222210002222210',
  '.0222210222222210',
  '.0222221222221210',
  '..02222222222100.',
  '..01112222221110.',
  '...01111111119990',
  '....0999999998990',
  '....099999999890.',
  '.....0999999890..',
];

const PISTOL_FIRE: SpriteData = [
  '.................',
  '.................',
  '........0........',
  '.......0f0.......',
  '.....0000000.....',
  '.....0cddde0.....',
  '....0cddddde0....',
  '....0cddddde0....',
  '...0cddddddde0...',
  '...0cddddddde0...',
  '..0ddddddddddd0..',
  '..0eeee0f0eeee0..',
  '..0efffffffffe0..',
  '..0efff0e0fffe0..',
  '..00fffffffff00..',
  '..00330fff03300..',
  '.0222210f0222220.',
  '.0222210002222210',
  '.0222210222222210',
  '.0222221222221210',
  '..02222222222100.',
  '..01112222221110.',
  '...01111111119990',
  '....0999999998990',
  '.....0999999890..',
];

/** Caricatore (esce dal fondo dell'impugnatura durante la ricarica). */
const PISTOL_MAG: SpriteData = ['0000', '0ff0', '0fe0', '0fe0', '0fe0', '0ef0', '0dd0', '0000'];

const PISTOL_ART: GunArt = {
  key: 'gv-pistola',
  idle: PISTOL_IDLE,
  fire: PISTOL_FIRE,
  pivot: { x: 8, y: 16 },
  muzzle: { x: 8, y: 1 },
  port: { x: 12, y: 7 },
  ejectDir: 1,
  magSprite: PISTOL_MAG,
  magAt: { x: 7, y: 15 },
  reloadPose: 3,
};

/**
 * Pistola: ogni tap spara un colpo istantaneo nel punto toccato.
 * Spara al pointerdown (più reattivo) e non afferra Tony. L'arma è disegnata
 * in basso (GunView): rinculo, carrello, vampata, tracciante, bossolo, fumo;
 * dopo `magSize` colpi una breve ricarica.
 */
export class Pistola extends Weapon<PistolaStats> {
  readonly id = 'pistola';
  readonly name = 'PISTOLA';
  readonly icon = ICON_PISTOLA;
  override readonly allowsGrab = false;
  private holes: BulletHoles | null = null;
  private view: GunView | null = null;
  private ammo = 0;

  activate(): void {
    super.activate();
    const scene = this.ctx.scene;
    this.holes = new BulletHoles(scene);
    this.view = new GunView(scene, PISTOL_ART);
    this.view.show();
    this.ammo = this.stats.magSize;
  }

  deactivate(): void {
    this.holes?.clear();
    this.view?.hide();
    this.holes = null;
    this.view = null;
  }

  onPointerDown(p: WeaponPointer): void {
    const view = this.view;
    if (!this.holes || !view) return;
    view.aimAt(p.x, p.y, true);
    if (view.reloading || !this.tryUse(p.time)) return;
    const { scene, ragdoll } = this.ctx;
    const s = this.stats;
    const m = view.fire();
    playShot();
    tone({ type: 'triangle', from: 150, to: 45, dur: 0.1, vol: 0.32 });
    fireHitscan(scene, ragdoll, this.holes, (h) => this.hit(h), this.id, s, p.x, p.y, { fromX: m.x, fromY: m.y });
    view.tracer(p.x, p.y);
    view.ejectShell();
    view.queueSmoke(GUN_VIEW.smokePuffsSingle);
    if (--this.ammo <= 0) view.startReload(s.reloadMs, () => (this.ammo = this.stats.magSize));
  }

  onPointerMove(p: WeaponPointer): void {
    this.view?.aimAt(p.x, p.y);
  }

  update(dtMs: number): void {
    this.view?.update(dtMs);
    this.holes?.update();
  }

  /** Per il debug da console. */
  get debugState(): { ammo: number; reloading: boolean; holes: number } & Record<string, number | boolean> {
    return {
      ammo: this.ammo,
      reloading: !!this.view?.reloading,
      holes: this.holes?.count ?? 0,
      ...(this.view?.debugCounts ?? {}),
    };
  }
}
