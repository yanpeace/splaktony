import Phaser from 'phaser';
import { FIREARMS, GUN_VIEW, PHYSICS, ROOM_INNER } from '../config/balance';
import { C, col } from '../config/palette';
import { tone, noise } from '../audio/sfx';
import { acquireImage, isFrozen, popFrames, releaseImage, shake, spawnParticles } from '../gfx/effects';
import { makeSprite, makeSprites, type SpriteData } from '../gfx/pixelSprite';
import type { HitInput } from '../systems/damage';
import type { Ragdoll } from '../entities/Ragdoll';

/**
 * ARMI DA FUOCO: arma in mano a schermo (viewmodel stile FPS rétro / Doom) +
 * utility condivise (colpo hitscan, fori nel muro, bossoli, fumo, tracciante).
 * Usato da Pistola e Mitragliatrice; le armi nuove (fucili, RPG...) possono
 * adottarlo così:
 *
 *   const ART: GunArt = { key: 'gv-fucile', idle: SPRITE, pivot, muzzle, port, ... };
 *   activate():   this.view = new GunView(scene, ART); this.view.show();
 *                 this.holes = new BulletHoles(scene);
 *   deactivate(): this.view?.hide(); this.holes?.clear();
 *   onPointerDown(p):
 *     this.view.aimAt(p.x, p.y, true);           // punta subito verso il dito
 *     if (this.view.reloading || !this.tryUse(p.time)) return;
 *     const m = this.view.fire();                // rinculo, carrello, vampata, alone, shake
 *     fireHitscan(scene, ragdoll, holes, (h) => this.hit(h), this.id, stats, p.x, p.y,
 *                 { fromX: m.x, fromY: m.y });   // danno nel punto + impatto (scintille/polvere)
 *     this.view.tracer(p.x, p.y);                // linea pixel bocca → punto
 *     this.view.ejectShell();                    // bossolo dalla finestra di espulsione
 *     this.view.queueSmoke(GUN_VIEW.smokePuffsSingle); // fumo quando smetti di sparare
 *     if (--ammo <= 0) this.view.startReload(ms, () => (ammo = mag));
 *   onPointerMove(p): this.view.aimAt(p.x, p.y);
 *   update(dt):   this.view.update(dt); this.holes.update();
 *
 * API di GunView:
 *   show() / hide()            crea / rilascia tutto (hide = pulizia completa per deactivate)
 *   aimAt(x, y, snap?)         bersaglio: sceglie la posa (5 inclinazioni) e sposta l'arma
 *   fire(opts?) → {x, y}       un colpo: rinculo (kick su), frame carrello indietro, vampata
 *                              alla volata (opts.altFlash = vampata alternata), alone di luce,
 *                              shake 1px, calore (opts.heat). Ritorna la bocca della canna.
 *   muzzle() / port()          posizioni mondo attuali di bocca e finestra di espulsione
 *   tracer(x, y)               tracciante Bresenham dalla bocca al punto (1-2 frame)
 *   ejectShell()               bossolo con gravità, rimbalzi e "tin" sul pavimento in primo piano
 *   queueSmoke(n)              n sbuffi di fumo dalla canna dopo l'ultimo colpo
 *   startReload(ms, onDone)    ricarica a 4 frame (caricatore che esce/entra, carrello)
 *   reloading / heat           stato (heat 0..1, la canna si arrossa 3 → 2 se art.heat)
 *   update(dtMs)               da chiamare ogni frame
 *
 * Sprite (GunArt.idle): canna verso l'alto, mano in basso; la posa centrale viene
 * inclinata a pixel interi (shear attorno a `pivot`) per le altre 4 pose.
 * Segnaposto della canna che si scalda: H (corpo), K (luce), J (ombra).
 * Tutti i numeri stanno in GUN_VIEW / FIREARMS (config/balance.ts).
 */

// ---------------------------------------------------------------- sprite condivisi

const FLASH_A: SpriteData = [
  '...4...',
  '.4.c.4.',
  '..ccc..',
  '4ccccc4',
  '..ccc..',
  '.4.c.4.',
  '...4...',
];

const FLASH_B: SpriteData = [
  '.......',
  '...4...',
  '..4c4..',
  '.4ccc4.',
  '..4c4..',
  '...4...',
  '.......',
];

const FLASH_C: SpriteData = [
  '.......',
  '.......',
  '...4...',
  '..434..',
  '...4...',
  '.......',
  '.......',
];

/** Vampata grande alla volata (3 frame) + variante alternata per le raffiche. */
const MUZZLE_A: SpriteData = [
  '.....3.....',
  '.3...c...3.',
  '..c..c..c..',
  '...4ccc4...',
  '...ccccc...',
  '3ccccccccc3',
  '...ccccc...',
  '...4ccc4...',
  '..c..c..c..',
  '.3...4...3.',
  '.....3.....',
];

const MUZZLE_A2: SpriteData = [
  '.....c.....',
  '....3c3....',
  '....4c4....',
  '.3..ccc..3.',
  '..c4ccc4c..',
  '.3ccccccc3.',
  '..c4ccc4c..',
  '...3.c.3...',
  '.....4.....',
  '.....3.....',
  '...........',
];

const MUZZLE_B: SpriteData = [
  '....3....',
  '.3..c..3.',
  '..c.c.c..',
  '...ccc...',
  '3ccccccc3',
  '...ccc...',
  '..c.c.c..',
  '.3..c..3.',
  '....3....',
];

const MUZZLE_C: SpriteData = [
  '.......',
  '...3...',
  '..4c4..',
  '.3ccc3.',
  '..4c4..',
  '...3...',
  '.......',
];

/** Alone di luce attorno alla canna: anello a scacchi (generato). */
function haloSprite(r: number): SpriteData {
  const size = r * 2 + 1;
  const rows: string[] = [];
  for (let y = 0; y < size; y++) {
    let row = '';
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - r, y - r);
      const on = (x + y) % 2 === 0;
      row += on && d <= r && d >= r * 0.4 ? (d > r * 0.75 ? '4' : 'c') : '.';
    }
    rows.push(row);
  }
  return rows;
}

/** Impatto (scintilla) nel punto colpito. */
const IMPACT_A: SpriteData = ['..4..', '.4c4.', '4ccc4', '.4c4.', '..4..'];
const IMPACT_B: SpriteData = ['4...4', '.4.4.', '..c..', '.4.4.', '4...4'];
const IMPACT_C: SpriteData = ['.....', '..3..', '.3.3.', '..3..', '.....'];

/** Sbuffo di polvere/schegge dal muro. */
const DUST_A: SpriteData = ['..d..', '.ded.', 'ddcdd', '.ded.', '..d..'];
const DUST_B: SpriteData = ['..d.d..', '.d.e.d.', 'd.ede.d', '.e.d.e.', 'd.ede.d', '.d.e.d.', '..d.d..'];
const DUST_C: SpriteData = ['e.....e', '...e...', '.......', 'e..f..e', '.......', '...e...', 'e.....e'];

/** Imbottitura di Tony che esce dal foro. */
const STUFF_A: SpriteData = ['..c..', '.cdc.', 'cdcdc', '.cdc.', '..c..'];
const STUFF_B: SpriteData = ['.c...c.', '..c.c..', 'c.d.d.c', '...c...', 'c.d.d.c', '..c.c..', '.c...c.'];
const STUFF_C: SpriteData = ['c.....c', '.......', '..d.d..', '.......', '..d.d..', '.......', 'c.....c'];

/** Fumo dalla canna: denso → rado. */
const SMOKE_A: SpriteData = ['.dd.', 'dccd', 'dcde', '.ee.'];
const SMOKE_B: SpriteData = ['.d.d.', 'dcdd.', '.ddde', 'dde.e', '.e.e.'];
const SMOKE_C: SpriteData = ['.e...', '..d.e', 'e.e..', '...e.', '.e..e'];
const SMOKE_D: SpriteData = ['.e.', 'e.e', '.e.'];

const HOLE_A: SpriteData = ['efe', 'f0f', 'efe'];
const HOLE_B: SpriteData = ['ee.', 'e0f', '.fe'];

/** Bossolo: due frame (orizzontale / verticale) alternati mentre vola = rotazione a scatti. */
const SHELL_H: SpriteData = ['443', '333'];
const SHELL_V: SpriteData = ['43', '43', '33'];

export const FLASH_FRAMES = ['fx-shot-a', 'fx-shot-b', 'fx-shot-c'] as const;
const MUZZLE_FRAMES = ['fx-muzzle-a', 'fx-muzzle-b', 'fx-muzzle-c'] as const;
const MUZZLE_FRAMES_ALT = ['fx-muzzle-a2', 'fx-muzzle-b', 'fx-muzzle-c'] as const;
const IMPACT_FRAMES = ['fx-impact-a', 'fx-impact-b', 'fx-impact-c'] as const;
const DUST_FRAMES = ['fx-dust-a', 'fx-dust-b', 'fx-dust-c'] as const;
const STUFF_FRAMES = ['fx-stuff-a', 'fx-stuff-b', 'fx-stuff-c'] as const;
const SMOKE_KEYS = ['fx-smoke-a', 'fx-smoke-b', 'fx-smoke-c', 'fx-smoke-d'] as const;
const HOLE_KEYS = ['fx-hole-a', 'fx-hole-b'] as const;
const HALO_KEY = 'fx-gun-halo';
export const SHELL_KEYS = { h: 'fx-shell-h', v: 'fx-shell-v' } as const;

/** Registra le texture condivise delle armi da fuoco (idempotente). */
export function ensureFirearmSprites(scene: Phaser.Scene): void {
  makeSprites(scene, {
    'fx-shot-a': FLASH_A,
    'fx-shot-b': FLASH_B,
    'fx-shot-c': FLASH_C,
    'fx-muzzle-a': MUZZLE_A,
    'fx-muzzle-a2': MUZZLE_A2,
    'fx-muzzle-b': MUZZLE_B,
    'fx-muzzle-c': MUZZLE_C,
    'fx-impact-a': IMPACT_A,
    'fx-impact-b': IMPACT_B,
    'fx-impact-c': IMPACT_C,
    'fx-dust-a': DUST_A,
    'fx-dust-b': DUST_B,
    'fx-dust-c': DUST_C,
    'fx-stuff-a': STUFF_A,
    'fx-stuff-b': STUFF_B,
    'fx-stuff-c': STUFF_C,
    'fx-smoke-a': SMOKE_A,
    'fx-smoke-b': SMOKE_B,
    'fx-smoke-c': SMOKE_C,
    'fx-smoke-d': SMOKE_D,
    'fx-hole-a': HOLE_A,
    'fx-hole-b': HOLE_B,
    [SHELL_KEYS.h]: SHELL_H,
    [SHELL_KEYS.v]: SHELL_V,
    [HALO_KEY]: haloSprite(8),
  });
}

// ---------------------------------------------------------------- fori nel muro

interface Hole {
  img: Phaser.GameObjects.Image;
  bornAt: number;
}

/** Fori di proiettile sul muro: restano un po', poi spariscono lampeggiando. */
export class BulletHoles {
  private holes: Hole[] = [];

  constructor(private readonly scene: Phaser.Scene) {}

  /** true se il punto è sulla parete interna della stanza. */
  static inRoom(x: number, y: number): boolean {
    return x >= ROOM_INNER.left + 1 && x < ROOM_INNER.right - 1 && y >= ROOM_INNER.top + 1 && y < ROOM_INNER.bottom - 1;
  }

  add(x: number, y: number): void {
    if (this.holes.length >= FIREARMS.maxHoles) releaseImage(this.holes.shift()?.img);
    const key = HOLE_KEYS[Math.floor(Math.random() * HOLE_KEYS.length)];
    const img = acquireImage(this.scene, Math.round(x) - 1, Math.round(y) - 1, key)
      .setOrigin(0)
      .setDepth(FIREARMS.holeDepth);
    this.holes.push({ img, bornAt: this.scene.time.now });
  }

  update(): void {
    const now = this.scene.time.now;
    const end = FIREARMS.holeLifeMs + FIREARMS.holeBlinkMs;
    for (let i = this.holes.length - 1; i >= 0; i--) {
      const h = this.holes[i];
      const age = now - h.bornAt;
      if (age >= end) {
        releaseImage(h.img);
        this.holes.splice(i, 1);
      } else if (age > FIREARMS.holeLifeMs) {
        // lampeggio a scatti, sempre più spento verso la fine
        const step = Math.floor((age - FIREARMS.holeLifeMs) / FIREARMS.holeBlinkStepMs);
        h.img.setVisible(step % 2 === 1);
      }
    }
  }

  clear(): void {
    this.holes.forEach((h) => releaseImage(h.img));
    this.holes = [];
  }

  get count(): number {
    return this.holes.length;
  }
}

// ---------------------------------------------------------------- colpo hitscan

export interface ShotStats {
  damage: number;
  impulse: number;
  bodyShare: number;
  hitTolerance: number;
}

export interface ShotOpts {
  /** da dove parte il colpo (bocca dell'arma): dà la direzione della spinta e dell'impatto */
  fromX?: number;
  fromY?: number;
}

/**
 * Colpo istantaneo (hitscan) nel punto (x,y): se prende Tony fa danno + spinta
 * (dalla bocca dell'arma verso il punto) con scintille e imbottitura; se no,
 * foro nel muro con sbuffo di polvere e schegge.
 * Senza `opts.fromX/fromY` (vecchio uso, niente arma a schermo) mostra anche il
 * lampo nel punto e spinge dal basso dello schermo. Ritorna true se ha colpito Tony.
 */
export function fireHitscan(
  scene: Phaser.Scene,
  ragdoll: Ragdoll,
  holes: BulletHoles,
  hit: (h: HitInput) => number,
  weaponId: string,
  s: ShotStats,
  x: number,
  y: number,
  opts: ShotOpts = {},
): boolean {
  const px = Math.round(x);
  const py = Math.round(y);
  const fromView = opts.fromX !== undefined && opts.fromY !== undefined;
  const ox = fromView ? (opts.fromX as number) : FIREARMS.originX;
  const oy = fromView ? (opts.fromY as number) : FIREARMS.originY;
  if (!fromView) popFrames(scene, px, py, FLASH_FRAMES, FIREARMS.flashFrameMs);
  // direzione del proiettile
  let dx = px - ox;
  let dy = py - oy;
  let len = Math.hypot(dx, dy) || 1;
  const back = Math.atan2(-dy, -dx);

  const target = ragdoll.partAt(px, py, s.hitTolerance);
  if (!target) {
    if (BulletHoles.inRoom(px, py)) {
      holes.add(px, py);
      if (fromView) {
        popFrames(scene, px, py, IMPACT_FRAMES, GUN_VIEW.flashFrameMs, { depth: 54 });
        popFrames(scene, px, py, DUST_FRAMES, 70, { depth: 53 });
        // schegge che cadono + polvere che torna verso chi spara
        spawnParticles(scene, px, py, {
          count: 4,
          colors: [C.silver, C.slate, C.charcoal],
          speed: 1.6,
          angle: back,
          spread: 2.2,
          size: 1,
          lifeMs: 380,
          gravity: 0.16,
        });
      }
      spawnParticles(scene, px, py, {
        count: 3,
        colors: [C.yellow, C.white, C.silver],
        speed: 1.8,
        size: 1,
        lifeMs: 220,
        gravity: 0.12,
      });
    }
    return false;
  }

  dx = dx / len + (Math.random() - 0.5) * 2 * FIREARMS.impulseJitter;
  dy /= len;
  len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  const part = target.part;
  ragdoll.applyImpulse(part, px, py, dx * s.impulse, dy * s.impulse);
  if (s.bodyShare > 0) ragdoll.addVelocity(dx * s.impulse * s.bodyShare, dy * s.impulse * s.bodyShare, part);
  hit({ part: part.name, x: px, y: py, amount: s.damage, weaponId });

  spawnParticles(scene, px, py, {
    count: 4,
    colors: [C.yellow, C.white],
    speed: 2.2,
    angle: Math.atan2(-dy, -dx),
    spread: 1.4,
    size: 1,
    lifeMs: 200,
    gravity: 0,
  });
  if (fromView) {
    popFrames(scene, px, py, IMPACT_FRAMES, GUN_VIEW.flashFrameMs, { depth: 54 });
    popFrames(scene, px, py, STUFF_FRAMES, 60, { depth: 53 });
    // fiocchi d'imbottitura che escono dal foro e ricadono
    spawnParticles(scene, px, py, {
      count: 3,
      colors: [C.white, C.silver],
      speed: 1.3,
      angle: back,
      spread: 2.4,
      size: 1,
      lifeMs: 450,
      gravity: 0.08,
    });
  }
  return true;
}

// ---------------------------------------------------------------- bossoli

interface Shell {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** quando si è fermato a terra (-1 = ancora in volo) */
  restAt: number;
  spinAt: number;
  vertical: boolean;
}

export interface ShellOpts {
  /** y del pavimento su cui rimbalzano (default: pavimento della stanza) */
  floorY?: number;
  depth?: number;
}

/** Bossoli con gravità, rimbalzo sul pavimento ("tin"), sosta a terra e sparizione lampeggiante. */
export class Shells {
  private list: Shell[] = [];
  private lastTinkAt = -1e9;
  private readonly floorY: number;
  private readonly depth: number;

  constructor(
    private readonly scene: Phaser.Scene,
    opts: ShellOpts = {},
  ) {
    this.floorY = opts.floorY ?? ROOM_INNER.bottom;
    this.depth = opts.depth ?? FIREARMS.shellDepth;
  }

  /** Espelle un bossolo da (x,y) con velocità orizzontale vx (px/step, segno = lato). */
  eject(x: number = FIREARMS.shellEjectX, y: number = FIREARMS.shellEjectY, vx: number = FIREARMS.shellVx): void {
    if (this.list.length >= FIREARMS.maxShells) releaseImage(this.list.shift()?.img);
    const img = acquireImage(this.scene, x, y, SHELL_KEYS.h).setOrigin(0).setDepth(this.depth);
    this.list.push({
      img,
      x,
      y,
      vx: vx + (Math.random() - 0.5) * 2 * FIREARMS.shellVxJitter,
      vy: FIREARMS.shellVy + (Math.random() - 0.5) * 2 * FIREARMS.shellVyJitter,
      restAt: -1,
      spinAt: this.scene.time.now,
      vertical: Math.random() < 0.5,
    });
  }

  update(dtMs: number): void {
    const now = this.scene.time.now;
    const frozen = isFrozen(this.scene);
    const steps = dtMs / PHYSICS.stepMs;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const s = this.list[i];
      if (s.restAt < 0) {
        if (!frozen) this.fly(s, steps, now);
      } else {
        const age = now - s.restAt;
        if (age >= FIREARMS.shellRestMs + FIREARMS.shellBlinkMs) {
          releaseImage(s.img);
          this.list.splice(i, 1);
          continue;
        }
        if (age > FIREARMS.shellRestMs) {
          const step = Math.floor((age - FIREARMS.shellRestMs) / FIREARMS.shellBlinkStepMs);
          s.img.setVisible(step % 2 === 1);
        }
      }
      s.img.setPosition(Math.round(s.x), Math.round(s.y));
    }
  }

  private fly(s: Shell, steps: number, now: number): void {
    s.vy += FIREARMS.shellGravity * steps;
    s.x += s.vx * steps;
    s.y += s.vy * steps;

    // rotazione a scatti
    if (now - s.spinAt >= FIREARMS.shellSpinMs) {
      s.spinAt = now;
      s.vertical = !s.vertical;
      s.img.setTexture(s.vertical ? SHELL_KEYS.v : SHELL_KEYS.h);
    }

    // muri laterali
    const w = s.vertical ? 2 : 3;
    if (s.x < ROOM_INNER.left) {
      s.x = ROOM_INNER.left;
      s.vx = Math.abs(s.vx) * FIREARMS.shellBounce;
    } else if (s.x > ROOM_INNER.right - w) {
      s.x = ROOM_INNER.right - w;
      s.vx = -Math.abs(s.vx) * FIREARMS.shellBounce;
    }

    // pavimento
    const h = s.vertical ? 3 : 2;
    const floorY = this.floorY - h;
    if (s.y >= floorY && s.vy > 0) {
      s.y = floorY;
      s.vx *= FIREARMS.shellFriction;
      if (s.vy < FIREARMS.shellStopSpeed) {
        // fermo: sdraiato in orizzontale, appoggiato al pavimento
        s.vertical = false;
        s.img.setTexture(SHELL_KEYS.h);
        s.y = this.floorY - 2;
        s.vx = 0;
        s.vy = 0;
        s.restAt = now;
      } else {
        this.tink(s.vy);
        s.vy = -s.vy * FIREARMS.shellBounce;
      }
    }
  }

  /** "tin" metallico del bossolo che rimbalza (pochi alla volta). */
  private tink(speed: number): void {
    const now = this.scene.time.now;
    if (now - this.lastTinkAt < 70) return;
    this.lastTinkAt = now;
    const f = 2600 + Math.random() * 900;
    tone({ type: 'square', from: f, to: f * 0.8, dur: 0.03, vol: Math.min(0.06, 0.015 * speed) });
  }

  clear(): void {
    this.list.forEach((s) => releaseImage(s.img));
    this.list = [];
  }

  get count(): number {
    return this.list.length;
  }
}

// ---------------------------------------------------------------- manipolazione sprite

/** Sostituisce i caratteri segnaposto (es. H/K/J della canna). */
export function substSprite(rows: SpriteData, map: Record<string, string>): string[] {
  return rows.map((r) => r.replace(/[A-Z]/g, (ch) => map[ch] ?? '.'));
}

/** Inclina lo sprite a pixel interi attorno alla riga `pivotY` (shear orizzontale). */
export function shearSprite(rows: SpriteData, slope: number, pivotY: number, pad: number): string[] {
  return rows.map((r, y) => {
    const s = Math.round(slope * (pivotY - y));
    return '.'.repeat(pad + s) + r + '.'.repeat(pad - s);
  });
}

/** Cancella (trasparente) un rettangolo dello sprite. */
export function eraseRect(rows: SpriteData, r: GunRect): string[] {
  return rows.map((row, y) =>
    y < r.y || y >= r.y + r.h ? row : row.slice(0, r.x) + '.'.repeat(r.w) + row.slice(r.x + r.w),
  );
}

/** Ritaglia un rettangolo dello sprite. */
export function cropRect(rows: SpriteData, r: GunRect): string[] {
  return rows.slice(r.y, r.y + r.h).map((row) => row.slice(r.x, r.x + r.w));
}

/** Frame di sparo generico: la parte sopra `row` arretra di 1px verso chi guarda. */
export function pushBack(rows: SpriteData, row: number): string[] {
  const blank = '.'.repeat(rows[0].length);
  return [blank, ...rows.slice(0, row), ...rows.slice(row + 1)];
}

// ---------------------------------------------------------------- GunView

export interface GunPoint {
  x: number;
  y: number;
}

export interface GunRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GunArt {
  /** prefisso unico delle texture generate (es. 'gv-pistola') */
  key: string;
  /** posa centrale a riposo: canna in alto, mano/manica in basso */
  idle: SpriteData;
  /** frame di sparo (carrello/otturatore indietro); default pushBack(idle, slideRow) */
  fire?: SpriteData;
  slideRow?: number;
  /** punto della mano che resta fermo quando l'arma si inclina (coordinate sprite) */
  pivot: GunPoint;
  /** bocca della canna e finestra di espulsione (coordinate sprite, posa centrale) */
  muzzle: GunPoint;
  port: GunPoint;
  /** lato verso cui escono i bossoli: 1 = destra, -1 = sinistra */
  ejectDir?: 1 | -1;
  /** caricatore visibile nello sprite (viene staccato durante la ricarica) */
  magRect?: GunRect;
  /** oppure caricatore separato (nascosto nell'impugnatura) e dove esce (coordinate sprite) */
  magSprite?: SpriteData;
  magAt?: GunPoint;
  /** true = la canna (H/K/J) si scalda */
  heat?: boolean;
  /** rinculo: offset x casuale (px) a ogni colpo */
  kickJitterX?: number;
  /** posa forzata durante la ricarica (indice in GUN_VIEW.poseSlopes) */
  reloadPose?: number;
}

type Frame = 'idle' | 'fire' | 'nomag';

/** Colori della canna per livello di calore: fredda, calda (arancio), rovente (rosso). */
const HEAT_MAPS: readonly Record<string, string>[] = [
  { H: 'e', K: 'd', J: 'f' },
  { H: '3', K: '4', J: '2' },
  { H: '2', K: '3', J: '1' },
];

interface Puff {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  born: number;
}

interface Tracer {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  until: number;
}

interface FallingMag {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export class GunView {
  private img: Phaser.GameObjects.Image | null = null;
  private halo: Phaser.GameObjects.Image | null = null;
  private gfx: Phaser.GameObjects.Graphics | null = null;
  private shells: Shells | null = null;
  private readonly pad: number;
  private readonly h: number;
  private readonly magKey: string;

  /** posizione orizzontale del pivot (intera) e bersaglio */
  private viewX: number = GUN_VIEW.centerX;
  private targetX: number = GUN_VIEW.centerX;
  private aimX: number = GUN_VIEW.centerX;
  private aimY = 0;
  private lastAimAt = -1e9;
  private pose = 2;
  private offX = 0;
  private offY = 0;
  private firedAt = -1e9;
  private kickX = 0;
  private heatValue = 0;

  private reloadStart = -1;
  private reloadMs = 0;
  private reloadFrame = -1;
  private reloadDone: (() => void) | null = null;
  private newMag: Phaser.GameObjects.Image | null = null;
  private falling: FallingMag[] = [];

  private puffs: Puff[] = [];
  private smokePending = 0;
  private smokeAt = 0;
  private tracers: Tracer[] = [];
  private tracersDirty = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly art: GunArt,
  ) {
    this.h = art.idle.length;
    const maxSlope = Math.max(...GUN_VIEW.poseSlopes.map(Math.abs));
    this.pad = Math.ceil(maxSlope * Math.max(art.pivot.y, this.h - 1 - art.pivot.y)) + 1;
    this.magKey = `${art.key}-mag`;
    this.aimY = GUN_VIEW.baseY - 100;
  }

  // ---------------------------------------------------------------- ciclo di vita

  show(): void {
    if (this.img) return;
    const scene = this.scene;
    ensureFirearmSprites(scene);
    this.buildTextures();
    this.img = acquireImage(scene, 0, 0, this.texKey('idle')).setOrigin(0).setDepth(GUN_VIEW.depth);
    this.halo = acquireImage(scene, 0, 0, HALO_KEY).setDepth(GUN_VIEW.haloDepth).setVisible(false);
    this.gfx = scene.add.graphics().setDepth(GUN_VIEW.tracerDepth);
    this.shells = new Shells(scene, { floorY: FIREARMS.shellFloorY, depth: GUN_VIEW.shellDepth });
    this.viewX = this.targetX = GUN_VIEW.centerX;
    this.pose = 2;
    this.heatValue = 0;
    this.firedAt = -1e9;
    this.lastAimAt = -1e9;
    this.layout(scene.time.now);
  }

  /** Rilascia tutto (da chiamare in deactivate()). */
  hide(): void {
    releaseImage(this.img);
    releaseImage(this.halo);
    releaseImage(this.newMag);
    this.img = this.halo = this.newMag = null;
    if (this.gfx?.scene) this.gfx.destroy();
    this.gfx = null;
    this.shells?.clear();
    this.shells = null;
    this.puffs.forEach((p) => releaseImage(p.img));
    this.puffs = [];
    this.falling.forEach((m) => releaseImage(m.img));
    this.falling = [];
    this.tracers = [];
    this.smokePending = 0;
    this.reloadStart = -1;
    this.reloadFrame = -1;
    this.reloadDone = null;
  }

  get visible(): boolean {
    return !!this.img;
  }

  // ---------------------------------------------------------------- texture

  private texKey(frame: Frame, pose = this.pose, heat = this.heatLevel): string {
    return `${this.art.key}-p${pose}-${frame}-h${heat}`;
  }

  private buildTextures(): void {
    const a = this.art;
    const fire = a.fire ?? pushBack(a.idle, a.slideRow ?? Math.floor(this.h / 2));
    const frames: Record<Frame, SpriteData> = {
      idle: a.idle,
      fire,
      nomag: a.magRect ? eraseRect(a.idle, a.magRect) : a.idle,
    };
    const heats = a.heat ? HEAT_MAPS.length : 1;
    for (let p = 0; p < GUN_VIEW.poseSlopes.length; p++) {
      for (const f of Object.keys(frames) as Frame[]) {
        for (let h = 0; h < heats; h++) {
          const key = this.texKey(f, p, h);
          if (this.scene.textures.exists(key)) continue;
          const rows = shearSprite(substSprite(frames[f], HEAT_MAPS[h]), GUN_VIEW.poseSlopes[p], a.pivot.y, this.pad);
          makeSprite(this.scene, key, rows);
        }
      }
    }
    const mag = a.magRect ? cropRect(substSprite(a.idle, HEAT_MAPS[0]), a.magRect) : a.magSprite;
    if (mag) makeSprite(this.scene, this.magKey, mag);
  }

  // ---------------------------------------------------------------- geometria

  private shift(pose: number, sy: number): number {
    return Math.round(GUN_VIEW.poseSlopes[pose] * (this.art.pivot.y - sy));
  }

  private get top(): number {
    return GUN_VIEW.baseY - (this.h - 1) + this.offY;
  }

  /** Punto dello sprite (posa centrale) → coordinate mondo nella posa attuale. */
  toWorld(p: GunPoint): GunPoint {
    return {
      x: this.viewX + this.offX + (p.x - this.art.pivot.x) + this.shift(this.pose, p.y),
      y: this.top + p.y,
    };
  }

  muzzle(): GunPoint {
    return this.toWorld(this.art.muzzle);
  }

  port(): GunPoint {
    return this.toWorld(this.art.port);
  }

  private get heatLevel(): number {
    if (!this.art.heat) return 0;
    return this.heatValue >= GUN_VIEW.heatHot ? 2 : this.heatValue >= GUN_VIEW.heatWarm ? 1 : 0;
  }

  get heat(): number {
    return this.heatValue;
  }

  get reloading(): boolean {
    return this.reloadStart >= 0;
  }

  // ---------------------------------------------------------------- mira

  /** Bersaglio della mira; snap = posa e posizione subito (per il colpo al tap). */
  aimAt(x: number, y: number, snap = false): void {
    this.aimX = x;
    this.aimY = y;
    this.lastAimAt = this.scene.time.now;
    this.targetX = Math.round(
      Phaser.Math.Clamp(GUN_VIEW.centerX + (x - GUN_VIEW.centerX) * GUN_VIEW.follow, GUN_VIEW.minX, GUN_VIEW.maxX),
    );
    if (snap) {
      this.viewX = this.targetX;
      if (!this.reloading) this.pose = this.poseFor(x, y);
      this.layout(this.scene.time.now);
    }
  }

  private poseFor(x: number, y: number): number {
    const pivotY = this.top + this.art.pivot.y;
    const a = Math.atan2(x - this.viewX, Math.max(4, pivotY - y));
    const t = GUN_VIEW.poseAngles;
    let i = 0;
    while (i < t.length && a > t[i]) i++;
    return i;
  }

  // ---------------------------------------------------------------- sparo

  /**
   * Un colpo: rinculo, carrello indietro, vampata alla volata, alone di luce,
   * shake. `heat` = calore aggiunto (0..1), `altFlash` = vampata alternata.
   * Ritorna la posizione mondo della bocca della canna (dopo il rinculo).
   */
  fire(opts: { heat?: number; altFlash?: boolean } = {}): GunPoint {
    const scene = this.scene;
    const now = scene.time.now;
    this.firedAt = now;
    const j = this.art.kickJitterX ?? 0;
    this.kickX = j > 0 ? Math.round((Math.random() * 2 - 1) * j) : 0;
    if (opts.heat) this.heatValue = Math.min(1, this.heatValue + opts.heat);
    if (this.smokePending > 0) this.smokeAt = now + GUN_VIEW.smokeDelayMs;
    this.layout(now);
    const m = this.muzzle();
    popFrames(scene, m.x, m.y - 2, opts.altFlash ? MUZZLE_FRAMES_ALT : MUZZLE_FRAMES, GUN_VIEW.flashFrameMs, {
      depth: GUN_VIEW.flashDepth,
    });
    this.halo?.setPosition(m.x, m.y - 1).setVisible(true);
    shake(scene, FIREARMS.shotShakePx, FIREARMS.shotShakeMs);
    return m;
  }

  /** Tracciante dalla bocca della canna al punto. */
  tracer(x: number, y: number): void {
    const m = this.muzzle();
    this.tracers.push({
      x0: m.x,
      y0: m.y - 3,
      x1: Math.round(x),
      y1: Math.round(y),
      until: this.scene.time.now + GUN_VIEW.tracerMs,
    });
    this.tracersDirty = true;
  }

  ejectShell(): void {
    if (!this.shells) return;
    const p = this.port();
    const dir = this.art.ejectDir ?? 1;
    this.shells.eject(p.x, p.y, dir * FIREARMS.shellViewVx);
  }

  /** Fumo dalla canna: `n` sbuffi quando si smette di sparare. */
  queueSmoke(n: number): void {
    this.smokePending = Math.min(GUN_VIEW.maxSmoke, Math.max(this.smokePending, n));
    this.smokeAt = this.scene.time.now + GUN_VIEW.smokeDelayMs;
  }

  // ---------------------------------------------------------------- ricarica

  startReload(ms: number, onDone?: () => void): void {
    if (this.reloading) return;
    this.reloadStart = this.scene.time.now;
    this.reloadMs = Math.max(120, ms);
    this.reloadFrame = -1;
    this.reloadDone = onDone ?? null;
  }

  private tickReload(now: number): void {
    if (this.reloadStart < 0) return;
    const k = (now - this.reloadStart) / this.reloadMs;
    if (k >= 1) {
      this.reloadStart = -1;
      this.reloadFrame = -1;
      releaseImage(this.newMag);
      this.newMag = null;
      const done = this.reloadDone;
      this.reloadDone = null;
      done?.();
      return;
    }
    const f = Math.min(3, Math.floor(k * 4));
    if (f !== this.reloadFrame) {
      this.reloadFrame = f;
      this.onReloadFrame(f);
    }
    if (f === 2 && this.newMag) {
      // il caricatore nuovo sale nell'impugnatura
      const sub = k * 4 - 2;
      const home = this.magHome();
      this.newMag.setPosition(home.x, home.y + Math.round((1 - sub) * 6));
    }
  }

  private magHome(): GunPoint {
    const a = this.art;
    const at = a.magRect ? { x: a.magRect.x, y: a.magRect.y } : (a.magAt ?? a.pivot);
    return this.toWorld(at);
  }

  private onReloadFrame(f: number): void {
    const scene = this.scene;
    const hasMag = scene.textures.exists(this.magKey);
    if (f === 0) {
      this.pose = this.art.reloadPose ?? 3;
      this.layout(scene.time.now);
      // il caricatore vuoto cade
      if (hasMag) {
        const home = this.magHome();
        const img = acquireImage(scene, home.x, home.y, this.magKey).setOrigin(0).setDepth(GUN_VIEW.magDepth);
        this.falling.push({ img, x: home.x, y: home.y, vx: GUN_VIEW.magDropVx, vy: 0.4 });
      }
      tone({ type: 'square', from: 520, to: 380, dur: 0.04, vol: 0.08 });
    } else if (f === 2) {
      if (hasMag) {
        const home = this.magHome();
        releaseImage(this.newMag);
        this.newMag = acquireImage(scene, home.x, home.y + 6, this.magKey).setOrigin(0).setDepth(GUN_VIEW.magDepth);
      }
    } else if (f === 3) {
      releaseImage(this.newMag);
      this.newMag = null;
      this.pose = 2;
      // caricatore dentro (clic) + carrello tirato (clac)
      tone({ type: 'square', from: 900, to: 600, dur: 0.03, vol: 0.09 });
      noise({ dur: 0.05, vol: 0.12, freq: 3500, freqTo: 1200, highpass: true, delay: 0.06 });
      tone({ type: 'square', from: 300, to: 180, dur: 0.05, vol: 0.08, delay: 0.06 });
    }
  }

  // ---------------------------------------------------------------- update

  update(dtMs: number): void {
    if (!this.img) return;
    const now = this.scene.time.now;
    const steps = dtMs / PHYSICS.stepMs;

    this.tickReload(now);

    // senza tocchi per un po' l'arma torna dritta al centro
    if (now - this.lastAimAt > GUN_VIEW.idleReturnMs) {
      this.targetX = GUN_VIEW.centerX;
      this.aimX = GUN_VIEW.centerX;
      this.aimY = GUN_VIEW.baseY - 120;
    }
    const d = this.targetX - this.viewX;
    if (d !== 0) this.viewX += Phaser.Math.Clamp(d, -GUN_VIEW.followStepPx, GUN_VIEW.followStepPx);
    if (!this.reloading) this.pose = this.poseFor(this.aimX, this.aimY);

    // calore: la canna si raffredda
    if (this.heatValue > 0) this.heatValue = Math.max(0, this.heatValue - (GUN_VIEW.coolPerSec * dtMs) / 1000);

    this.layout(now);

    if (this.halo && this.halo.visible && now - this.firedAt >= GUN_VIEW.haloMs) this.halo.setVisible(false);

    // fumo
    if (this.smokePending > 0 && now >= this.smokeAt && now - this.firedAt >= GUN_VIEW.smokeDelayMs) {
      this.smokePending--;
      this.smokeAt = now + GUN_VIEW.smokeEveryMs;
      this.puff();
    }
    this.tickSmoke(now, steps);
    this.tickMags(steps);
    this.tickTracers(now);
    this.shells?.update(dtMs);
  }

  /** Posa, frame e offset (rinculo, bob, ricarica) → texture e posizione dell'immagine. */
  private layout(now: number): void {
    if (!this.img) return;
    const since = now - this.firedAt;
    const kf = Math.floor(since / GUN_VIEW.kickFrameMs);
    let frame: Frame = 'idle';
    let offY = 0;
    let offX = 0;
    if (this.reloading) {
      const f = Math.max(0, this.reloadFrame);
      offY = GUN_VIEW.reloadDip[f] ?? 0;
      frame = f === 3 ? 'fire' : f >= 0 && this.art.magRect ? 'nomag' : 'idle';
    } else if (kf >= 0 && kf < GUN_VIEW.kickFrames.length) {
      offY = GUN_VIEW.kickFrames[kf];
      offX = kf === 0 ? this.kickX : 0;
      if (kf < GUN_VIEW.slideFrames) frame = 'fire';
    } else {
      // oscillazione a riposo: 1px, 2 frame
      offY = Math.floor(now / GUN_VIEW.bobMs) % 2;
    }
    this.offX = offX;
    this.offY = offY;
    const key = this.texKey(frame);
    if (this.img.texture.key !== key) this.img.setTexture(key);
    this.img.setPosition(this.viewX + offX - this.art.pivot.x - this.pad, this.top);
  }

  private puff(): void {
    if (this.puffs.length >= GUN_VIEW.maxSmoke) releaseImage(this.puffs.shift()?.img);
    const m = this.muzzle();
    const img = acquireImage(this.scene, m.x, m.y - 3, SMOKE_KEYS[0]).setDepth(GUN_VIEW.smokeDepth);
    this.puffs.push({
      img,
      x: m.x,
      y: m.y - 3,
      vx: (Math.random() - 0.5) * 2 * GUN_VIEW.smokeDrift,
      born: this.scene.time.now,
    });
  }

  private tickSmoke(now: number, steps: number): void {
    const life = GUN_VIEW.smokeLifeMs;
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      const k = (now - p.born) / life;
      if (k >= 1) {
        releaseImage(p.img);
        this.puffs.splice(i, 1);
        continue;
      }
      // sale rallentando e ondeggia a scatti
      p.y -= GUN_VIEW.smokeRise * (1 - k * 0.6) * steps;
      p.x += (p.vx + Math.sin((now - p.born) / 140) * 0.08) * steps;
      const key = SMOKE_KEYS[Math.min(SMOKE_KEYS.length - 1, Math.floor(k * SMOKE_KEYS.length))];
      if (p.img.texture.key !== key) p.img.setTexture(key);
      p.img.setPosition(Math.round(p.x), Math.round(p.y));
    }
  }

  private tickMags(steps: number): void {
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const m = this.falling[i];
      m.vy += GUN_VIEW.magGravity * steps;
      m.x += m.vx * steps;
      m.y += m.vy * steps;
      if (m.y > GUN_VIEW.baseY - 2) {
        releaseImage(m.img);
        this.falling.splice(i, 1);
        continue;
      }
      m.img.setPosition(Math.round(m.x), Math.round(m.y));
    }
  }

  private tickTracers(now: number): void {
    const g = this.gfx;
    if (!g) return;
    const before = this.tracers.length;
    this.tracers = this.tracers.filter((t) => t.until > now);
    if (!this.tracersDirty && this.tracers.length === before) return;
    this.tracersDirty = false;
    g.clear();
    for (const t of this.tracers) drawTracerLine(g, t.x0, t.y0, t.x1, t.y1);
  }

  /** Per il debug da console. */
  get debugCounts(): { shells: number; smoke: number; mags: number; tracers: number } {
    return {
      shells: this.shells?.count ?? 0,
      smoke: this.puffs.length,
      mags: this.falling.length,
      tracers: this.tracers.length,
    };
  }
}

/** Linea pixel (Bresenham): bianca vicino alla bocca, poi bianca e gialla, tratteggiata in fondo. */
export function drawTracerLine(g: Phaser.GameObjects.Graphics, x0: number, y0: number, x1: number, y1: number): void {
  const white = col(C.white);
  const yellow = col(C.yellow);
  let x = Math.round(x0);
  let y = Math.round(y0);
  const tx = Math.round(x1);
  const ty = Math.round(y1);
  const dx = Math.abs(tx - x);
  const dy = -Math.abs(ty - y);
  const sx = x < tx ? 1 : -1;
  const sy = y < ty ? 1 : -1;
  const total = Math.max(dx, -dy) || 1;
  const whiteUntil = Math.round(total * GUN_VIEW.tracerWhite);
  let err = dx + dy;
  let i = 0;
  let current = -1;
  for (;;) {
    const c = i < whiteUntil || i % 3 !== 0 ? white : yellow;
    // ultimo tratto tratteggiato: il proiettile "si allontana"
    if (i < total * 0.85 || i % 2 === 0) {
      if (c !== current) {
        g.fillStyle(c, 1);
        current = c;
      }
      g.fillRect(x, y, 1, 1);
    }
    if (x === tx && y === ty) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
    i++;
  }
}
