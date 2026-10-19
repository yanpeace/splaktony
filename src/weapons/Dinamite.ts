import type Phaser from 'phaser';
import { EXPLOSIVES, WEAPON_STATS } from '../config/balance';
import { C } from '../config/palette';
import { spawnParticles } from '../gfx/effects';
import { makeSprites, type SpriteData } from '../gfx/pixelSprite';
import { ThrownExplosive, type LiveExplosive } from './Granata';

type DinamiteStats = (typeof WEAPON_STATS)['dinamite'];

const E = EXPLOSIVES;

const DINAMITE_ICON: SpriteData = [
  '.....4.4.',
  '......c..',
  '.....d...',
  '.000d000.',
  '.0320320.',
  '.0dd0dd0.',
  '.0220220.',
  '.0210210.',
  '.0000000.',
];

/** candelotto 5x9; sopra c'è spazio per la miccia (EXPLOSIVES.fuseLength px) */
const STICK: SpriteData = ['00000', '03220', '02220', '0ddd0', '02220', '02220', '0ddd0', '02210', '00000'];

const SPARK_A: SpriteData = ['.4.', '4c4', '.4.'];
const SPARK_B: SpriteData = ['4.4', '.c.', '4.4'];

function stickWithFuse(len: number): SpriteData {
  const rows: string[] = [];
  for (let i = 0; i < E.fuseLength; i++) rows.push(i >= E.fuseLength - len ? '..d..' : '.....');
  return [...rows, ...STICK];
}

/**
 * Dinamite: come la granata ma con miccia che scintilla e si accorcia;
 * dopo ~3s esplode con raggio grande e più danno (cooldown maggiore).
 */
export class Dinamite extends ThrownExplosive<DinamiteStats> {
  readonly id = 'dinamite';
  readonly name = 'DINAMITE';
  readonly icon = DINAMITE_ICON;

  protected get idleTexture(): string {
    return `dinamite-${E.fuseLength}`;
  }

  protected makeOwnSprites(): void {
    const sprites: Record<string, SpriteData> = { 'fx-dyn-spark-a': SPARK_A, 'fx-dyn-spark-b': SPARK_B };
    for (let l = 0; l <= E.fuseLength; l++) sprites[`dinamite-${l}`] = stickWithFuse(l);
    makeSprites(this.ctx.scene, sprites);
  }

  /** ruota attorno al centro del candelotto, non della texture con la miccia */
  protected prepareSprite(img: Phaser.GameObjects.Image): void {
    img.setOrigin(0.5, (E.fuseLength + STICK.length / 2) / (E.fuseLength + STICK.length));
  }

  protected renderFuse(e: LiveExplosive, now: number): void {
    const scene = this.ctx.scene;
    const left = Math.max(0, 1 - e.age / e.fuseMs);
    const len = Math.ceil(left * E.fuseLength);
    const key = `dinamite-${len}`;
    if (e.sprite.texture.key !== key) e.sprite.setTexture(key);

    // punta della miccia ruotata con lo sprite (a scatti)
    const a = this.snappedAngle(e);
    const dist = len + STICK.length / 2;
    const tx = Math.round(e.sprite.x + Math.sin(a) * dist);
    const ty = Math.round(e.sprite.y - Math.cos(a) * dist);
    if (!e.extra) e.extra = scene.add.image(tx, ty, 'fx-dyn-spark-a').setDepth(21);
    e.extra.setPosition(tx, ty);
    e.extra.setTexture(Math.floor(now / 60) % 2 === 0 ? 'fx-dyn-spark-a' : 'fx-dyn-spark-b');

    if (now >= e.nextFxAt) {
      e.nextFxAt = now + E.sparkEveryMs;
      spawnParticles(scene, tx, ty, {
        count: 1,
        colors: [C.yellow, C.white, C.orange],
        speed: 1,
        angle: a - Math.PI / 2,
        spread: 2.2,
        gravity: 0.05,
        lifeMs: 220,
        size: 1,
        depth: 21,
      });
    }
  }
}
