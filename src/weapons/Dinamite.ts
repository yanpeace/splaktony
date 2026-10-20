import Phaser from 'phaser';
import { EXPLOSIVES, EXPLOSIVE_ANIM, WEAPON_STATS } from '../config/balance';
import { C, type ColorIndex } from '../config/palette';
import { noise } from '../audio/sfx';
import { acquireImage, releaseImage, spawnParticles } from '../gfx/effects';
import { makeSprites, type SpriteData } from '../gfx/pixelSprite';
import { tossPiece } from './explosionFx';
import { ThrownExplosive, type AimView, type LiveExplosive } from './Granata';

type DinamiteStats = (typeof WEAPON_STATS)['dinamite'];

const E = EXPLOSIVES;
const A = EXPLOSIVE_ANIM;

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

/** scintilla della miccia: 3 frame che si alternano a scatti */
const SPARK_A: SpriteData = ['.4.', '4c4', '.4.'];
const SPARK_B: SpriteData = ['4.4', '.c.', '4.4'];
const SPARK_C: SpriteData = ['..3..', '.343.', '34c43', '.343.', '..3..'];
const SPARK_KEYS = ['fx-dyn-spark-a', 'fx-dyn-spark-b', 'fx-dyn-spark-c'];

/** fiammifero (5 di altezza, capocchia in alto): sfregato, acceso, bruciato */
const MATCH_STRIKE: SpriteData = ['c4c', '.2.', '.3.', '.3.', '.3.'];
const MATCH_FLAME_A: SpriteData = ['.4.', '4c4', '.2.', '.3.', '.3.'];
const MATCH_FLAME_B: SpriteData = ['4..', '.c4', '.2.', '.3.', '.3.'];
const MATCH_BURNT: SpriteData = ['f', '0', '3', '3'];

/** schegge di carta rossa del candelotto */
const PAPER_A: SpriteData = ['22', '21'];
const PAPER_B: SpriteData = ['32.', '221'];

function stickWithFuse(len: number): SpriteData {
  const rows: string[] = [];
  for (let i = 0; i < E.fuseLength; i++) rows.push(i >= E.fuseLength - len ? '..d..' : '.....');
  return [...rows, ...STICK];
}

/**
 * Dinamite: in mira si accende la miccia con un fiammifero (primo
 * trascinamento); in volo la miccia sfrigola, scintilla e si accorcia;
 * dopo ~3s esplode con raggio grande e più danno (cooldown maggiore).
 */
export class Dinamite extends ThrownExplosive<DinamiteStats> {
  readonly id = 'dinamite';
  readonly name = 'DINAMITE';
  readonly icon = DINAMITE_ICON;
  private lastSizzleAt = -1e9;
  private aimFx = { nextFxAt: 0 };

  protected get idleTexture(): string {
    return `dinamite-${E.fuseLength}`;
  }

  protected get handDy(): number {
    return 1;
  }

  protected get trailColors(): readonly ColorIndex[] {
    return [C.charcoal, C.slate];
  }

  protected get shrapnelKeys(): readonly string[] {
    return ['dyn-paper-a', 'dyn-paper-b'];
  }

  protected makeOwnSprites(): void {
    const sprites: Record<string, SpriteData> = {
      'fx-dyn-spark-a': SPARK_A,
      'fx-dyn-spark-b': SPARK_B,
      'fx-dyn-spark-c': SPARK_C,
      'dyn-match-strike': MATCH_STRIKE,
      'dyn-match-a': MATCH_FLAME_A,
      'dyn-match-b': MATCH_FLAME_B,
      'dyn-match-burnt': MATCH_BURNT,
      'dyn-paper-a': PAPER_A,
      'dyn-paper-b': PAPER_B,
    };
    for (let l = 0; l <= E.fuseLength; l++) sprites[`dinamite-${l}`] = stickWithFuse(l);
    makeSprites(this.ctx.scene, sprites);
  }

  /** ruota attorno al centro del candelotto, non della texture con la miccia */
  protected prepareSprite(img: Phaser.GameObjects.Image): void {
    img.setOrigin(0.5, (E.fuseLength + STICK.length / 2) / (E.fuseLength + STICK.length));
  }

  /** punta della miccia lunga len, ruotata con lo sprite */
  private fuseTip(x: number, y: number, a: number, len: number): { x: number; y: number } {
    const dist = len + STICK.length / 2;
    return { x: Math.round(x + Math.sin(a) * dist), y: Math.round(y - Math.cos(a) * dist) };
  }

  // ---------------------------------------------------------------- mira: fiammifero

  /** Primo trascinamento: compare il fiammifero accanto alla miccia e si sfrega. */
  protected armAim(a: AimView): void {
    const tip = this.fuseTip(a.x, a.y, 0, E.fuseLength);
    a.extras.push(acquireImage(this.ctx.scene, tip.x + 4, tip.y + 1, 'dyn-match-strike').setDepth(21));
    noise({ dur: 0.07, vol: 0.12, freq: 2500, freqTo: 6000, highpass: true });
  }

  protected renderAim(a: AimView, now: number): void {
    if (!a.armed) return;
    const scene = this.ctx.scene;
    const tip = this.fuseTip(a.x, a.y, 0, E.fuseLength);
    const t = now - a.armedAt;
    const match = a.extras[0];
    const lit = t >= A.matchStrikeMs + A.matchFlameMs;
    if (match && match.texture.key.startsWith('dyn-match')) {
      if (!lit) {
        // sfregato → fiamma che guizza e si avvicina alla miccia
        const flame = t >= A.matchStrikeMs;
        const key = !flame ? 'dyn-match-strike' : Math.floor(t / 50) % 2 === 0 ? 'dyn-match-a' : 'dyn-match-b';
        if (match.texture.key !== key) match.setTexture(key);
        match.setPosition(tip.x + (flame ? 3 : 4), tip.y + (flame ? 1 : 2));
        if (!flame && Math.floor(t / 30) % 2 === 0) {
          spawnParticles(scene, tip.x + 4, tip.y, {
            count: 1,
            colors: [C.white, C.yellow],
            speed: 1.4,
            angle: -Math.PI / 2,
            spread: 2,
            gravity: 0.08,
            lifeMs: 160,
            size: 1,
            depth: 22,
          });
        }
        return;
      }
      // miccia accesa: il fiammifero bruciato cade, fiammata di scintille
      releaseImage(match);
      a.extras.shift();
      tossPiece(scene, tip.x + 3, tip.y + 2, 'dyn-match-burnt', 0.7, -1.4, { lifeMs: 1200 });
      noise({ dur: 0.18, vol: 0.14, freq: 1200, freqTo: 5000, highpass: true });
      spawnParticles(scene, tip.x, tip.y, {
        count: 7,
        colors: [C.white, C.yellow, C.orange],
        speed: 1.8,
        angle: -Math.PI / 2,
        spread: 2.4,
        gravity: 0.06,
        lifeMs: 260,
        size: 1,
        depth: 22,
      });
      a.extras.push(acquireImage(scene, tip.x, tip.y, SPARK_KEYS[2]).setDepth(21));
    }
    const spark = a.extras[0];
    if (lit && spark) {
      spark.setPosition(tip.x, tip.y);
      spark.setTexture(SPARK_KEYS[Math.floor(now / 55) % 3]);
      this.sizzle(tip.x, tip.y, -Math.PI / 2, 0.3, now, this.aimFx);
    }
  }

  // ---------------------------------------------------------------- volo

  protected renderFuse(e: LiveExplosive, now: number): void {
    const scene = this.ctx.scene;
    const left = Math.max(0, 1 - e.age / e.fuseMs);
    const len = Math.ceil(left * E.fuseLength);
    const key = `dinamite-${len}`;
    if (e.sprite.texture.key !== key) e.sprite.setTexture(key);

    // punta della miccia ruotata con lo sprite (a scatti)
    const a = this.snappedAngle(e);
    const tip = this.fuseTip(e.sprite.x, e.sprite.y, a, len);
    if (!e.extra) e.extra = acquireImage(scene, tip.x, tip.y, SPARK_KEYS[0]).setDepth(21);
    e.extra.setPosition(tip.x, tip.y);
    // a fine miccia la scintilla grande compare più spesso
    const frames = left < 0.35 ? 3 : 2;
    e.extra.setTexture(SPARK_KEYS[Math.floor(now / (left < 0.35 ? 40 : 60)) % frames]);
    this.sizzle(tip.x, tip.y, a - Math.PI / 2, 1 - left, now, e);
  }

  /** Scintille + fumo dalla punta e sfrigolio (limitato per non fare raffica). */
  private sizzle(x: number, y: number, angle: number, heat: number, now: number, t: { nextFxAt: number }): void {
    const scene = this.ctx.scene;
    if (now >= t.nextFxAt || now < t.nextFxAt - E.sparkEveryMs * 2) {
      t.nextFxAt = now + E.sparkEveryMs;
      spawnParticles(scene, x, y, {
        count: 1 + (heat > 0.6 ? 1 : 0),
        colors: [C.yellow, C.white, C.orange],
        speed: 1 + heat * 0.8,
        angle,
        spread: 2.4,
        gravity: 0.05,
        lifeMs: 240,
        size: 1,
        depth: 21,
      });
      if (Math.random() < 0.3) {
        spawnParticles(scene, x, y - 1, {
          count: 1,
          colors: [C.slate, C.charcoal],
          speed: 0.3,
          angle: -Math.PI / 2,
          spread: 0.8,
          gravity: -0.02,
          lifeMs: 360,
          size: 1,
          depth: 19,
        });
      }
    }
    if (now - this.lastSizzleAt >= A.sizzleEveryMs || now < this.lastSizzleAt) {
      this.lastSizzleAt = now;
      noise({ dur: 0.05, vol: 0.025 + heat * 0.025, freq: 4500 + Math.random() * 2500, highpass: true });
    }
  }
}
