import Phaser from 'phaser';
import { GRAB, ROOM_INNER, SCIFI, WEAPON_STATS } from '../config/balance';
import { C, col } from '../config/palette';
import { noise, tone } from '../audio/sfx';
import { popFrames, shake, spawnParticles } from '../gfx/effects';
import { makeSprites, type SpriteData } from '../gfx/pixelSprite';
import type { Part } from '../entities/Ragdoll';
import { DotLayer, PixelGrid, ViewModel, energyBall, pointerStillDown } from './scifiView';
import { Weapon, type WeaponPointer } from './Weapon';

type GravitaStats = (typeof WEAPON_STATS)['gravita'];

const ICON_GRAVITA: SpriteData = [
  '0.......0',
  '30.....03',
  '.30.4.03.',
  '..03c30..',
  '..03330..',
  '.0f333f0.',
  '.0ff3ff0.',
  '..0fff0..',
  '...000...',
];

const BLAST_KEYS = ['fx-grav-a', 'fx-grav-b', 'fx-grav-c'] as const;

/**
 * Viewmodel: manipolatore gravitazionale arancione con tre artigli attorno al
 * nucleo. Frame: 0 = artigli aperti (a riposo), 1 = chiusi e nucleo acceso
 * (presa), 2 = nucleo al massimo (sparo).
 */
function gravitaFrames(): SpriteData[] {
  const variants: [number, string, string][] = [
    [0, '3', '4'],
    [2, '4', 'c'],
    [3, 'c', 'c'],
  ];
  return variants.map(([close, core, hot]) => {
    const g = new PixelGrid(30, 28);
    // artigli laterali (si chiudono verso il centro)
    g.line(8, 15, 5 + close, 4, '0', 3).line(9, 15, 6 + close, 5, 'f', 1).line(8, 14, 6 + close, 6, 'e', 1);
    g.line(6 + close, 4, 9 + close, 1, '0', 2).px(8 + close, 2, '3').px(7 + close, 3, '3');
    g.mirrorX();
    // artiglio posteriore al centro (sopra il nucleo)
    g.rect(13, 0, 4, 6, '0').rect(14, 1, 2, 4, 'f').px(14, 1, '3').px(15, 1, '3');
    // nucleo
    g.ball(14.5, 9.5, 4, '3').disc(14.5, 9.5, 2.6, core).disc(14.5, 9.5, 1.2, hot);
    // corpo arancione con fasce scure
    g.box(6, 13, 18, 10, '3');
    g.hline(7, 14, 16, '4').px(7, 15, '4');
    g.rect(7, 17, 16, 2, 'f').px(10, 17, '0').px(19, 17, '0');
    g.hline(7, 21, 16, '2').vline(22, 14, 7, '2');
    g.rect(13, 15, 4, 2, '0').px(14, 15, core).px(15, 15, core);
    // impugnatura e guanto
    g.box(10, 21, 10, 7, 'f').hline(11, 22, 8, 'e').px(12, 24, '0').px(14, 24, '0').px(16, 24, '0').px(18, 24, '0').hline(11, 26, 8, '0');
    return g.rows();
  });
}

/**
 * Pistola gravità: tieni premuto su Tony per agganciare la parte toccata con
 * un raggio arancio e tirarla verso l'arma sollevandolo in aria (segue il
 * dito); al rilascio lo SPARA lontano nella direzione del dito. Tap su Tony
 * senza tenere = spintone. La presa viene SEMPRE rilasciata.
 */
export class Gravita extends Weapon<GravitaStats> {
  readonly id = 'gravita';
  readonly name = 'GRAVITA';
  readonly icon = ICON_GRAVITA;
  override readonly allowsGrab = false;

  private view: ViewModel | null = null;
  private dots: DotLayer | null = null;
  private orbiters: Phaser.GameObjects.Rectangle[] = [];
  private holdId: number | null = null;
  private grabbed: Part | null = null;
  private grabAt = 0;
  private fingerX = 90;
  private fingerY = 150;
  private fingerVx = 0;
  private fingerVy = 0;
  private nextHumAt = 0;
  private shotUntil = 0;
  /** fino a quando Tony "lanciato" fa danno extra sbattendo contro la stanza */
  private slamUntil = 0;
  private prevVel = new Map<Part, { x: number; y: number; hitAt: number }>();

  private get grabId(): number {
    return SCIFI.gravGrabId + (this.holdId ?? 0);
  }

  activate(): void {
    super.activate();
    const scene = this.ctx.scene;
    makeSprites(scene, {
      [BLAST_KEYS[0]]: energyBall(4, '3', '4', 'c'),
      [BLAST_KEYS[1]]: ringSprite(6, '3', '4'),
      [BLAST_KEYS[2]]: ringSprite(8, '2', '3'),
    });
    this.view = new ViewModel(scene, { key: 'vm-gravita', frames: gravitaFrames(), muzzleRow: 9, muzzleCol: 14 });
    this.view.show();
    this.dots = new DotLayer(scene, SCIFI.viewDepth - 1);
    // particelle che girano attorno alla parte presa: create una volta, poi solo spostate
    for (let i = 0; i < SCIFI.gravOrbiters; i++) {
      this.orbiters.push(
        scene.add
          .rectangle(0, 0, 2, 2, col(i % 2 ? C.red : C.yellow))
          .setOrigin(0)
          .setDepth(17)
          .setVisible(false),
      );
    }
  }

  deactivate(): void {
    this.drop();
    this.holdId = null;
    this.slamUntil = 0;
    this.prevVel.clear();
    this.view?.hide();
    this.view = null;
    this.dots?.destroy();
    this.dots = null;
    this.orbiters.forEach((o) => o.destroy());
    this.orbiters = [];
  }

  onPointerDown(p: WeaponPointer): void {
    this.view?.aim(p.x, p.y);
    if (this.holdId !== null) return;
    this.holdId = p.id;
    this.track(p);
    this.tryGrab(p.x, p.y);
  }

  onPointerMove(p: WeaponPointer): void {
    if (p.id !== this.holdId) return;
    this.track(p);
    this.view?.aim(p.x, p.y);
  }

  onPointerUp(p: WeaponPointer): void {
    if (p.id !== this.holdId) return;
    this.track(p);
    if (this.grabbed) this.shoot();
    else this.punt();
    this.holdId = null;
  }

  private track(p: WeaponPointer): void {
    this.fingerX = p.x;
    this.fingerY = p.y;
    this.fingerVx = p.vx;
    this.fingerVy = p.vy;
  }

  private tryGrab(x: number, y: number): void {
    if (this.grabbed || this.holdId === null) return;
    const hit = this.ctx.ragdoll.partAt(x, y, this.stats.pickTolerance);
    if (!hit) return;
    const pos = hit.part.body.position;
    this.ctx.ragdoll.grab(this.grabId, { part: hit.part, x: pos.x, y: pos.y });
    this.grabbed = hit.part;
    this.grabAt = this.ctx.scene.time.now;
    tone({ type: 'square', from: 180, to: 520, dur: 0.12, vol: 0.08 });
    noise({ dur: 0.1, vol: 0.08, freq: 500, freqTo: 2500, highpass: true });
  }

  /** Lascia la presa senza lanciare (sempre sicuro). */
  private drop(): void {
    if (this.holdId !== null) this.ctx.ragdoll.release(this.grabId, 0, 0, false);
    this.grabbed = null;
    this.orbiters.forEach((o) => o.setVisible(false));
  }

  update(dtMs: number): void {
    const view = this.view;
    if (!view) return;
    const { scene, ragdoll } = this.ctx;
    const now = scene.time.now;

    if (this.holdId !== null && !pointerStillDown(scene, this.holdId)) {
      this.drop();
      this.holdId = null;
    }
    // il Ragdoll può aver lasciato la presa da solo (respawn anti-incastro)
    if (this.grabbed && !ragdoll.isGrabbed()) this.grabbed = null;
    if (this.holdId !== null && !this.grabbed) this.tryGrab(this.fingerX, this.fingerY);

    if (this.grabbed) {
      const m = view.muzzle();
      const s = this.stats;
      const k = s.pull * Math.min(1, (now - this.grabAt) / SCIFI.gravPullRampMs);
      const tx = this.fingerX + (m.x - this.fingerX) * k;
      const ty = Math.min(this.fingerY + (m.y - this.fingerY) * k, ROOM_INNER.bottom - s.lift);
      ragdoll.moveGrab(this.grabId, tx, ty);
      if (now >= this.nextHumAt) {
        this.nextHumAt = now + SCIFI.gravHumMs;
        tone({ type: 'triangle', from: 120, to: 135, dur: 0.1, vol: 0.12 });
        tone({ type: 'square', from: 480 + Math.random() * 60, to: 500, dur: 0.05, vol: 0.025 });
      }
    }

    view.setFrame(now < this.shotUntil ? 2 : this.grabbed ? 1 : 0);
    view.update(dtMs);
    this.drawBeam(now);
    this.checkSlams(now);
  }

  /**
   * Dopo lo sparo: una parte che frena di colpo vicino a muro/soffitto/pavimento
   * si è schiantata → danno extra dell'arma (l'urto normale lo conta già il Ragdoll).
   */
  private checkSlams(now: number): void {
    if (now >= this.slamUntil) {
      if (this.prevVel.size) this.prevVel.clear();
      return;
    }
    const s = this.stats;
    const m = SCIFI.gravSlamWallPx;
    for (const p of this.ctx.ragdoll.parts.values()) {
      const v = p.body.velocity;
      const prev = this.prevVel.get(p);
      if (!prev) {
        this.prevVel.set(p, { x: v.x, y: v.y, hitAt: -1e9 });
        continue;
      }
      const dv = Math.hypot(v.x - prev.x, v.y - prev.y);
      prev.x = v.x;
      prev.y = v.y;
      if (dv <= s.slamMinDv || now - prev.hitAt < SCIFI.gravSlamCooldownMs) continue;
      const { x, y } = p.body.position;
      const nearWall = x < ROOM_INNER.left + m || x > ROOM_INNER.right - m || y < ROOM_INNER.top + m || y > ROOM_INNER.bottom - m;
      if (!nearWall) continue;
      prev.hitAt = now;
      this.hit({ part: p.name, x: Math.round(x), y: Math.round(y), amount: (dv - s.slamMinDv) * s.slamScale, weaponId: this.id });
      spawnParticles(this.ctx.scene, x, y, { count: 3, colors: [C.orange, C.yellow], speed: 2, gravity: 0.1, lifeMs: 220, size: 1 });
    }
  }

  /** Raggio arancio dalla bocca alla parte presa (o al dito, a vuoto) + particelle in orbita. */
  private drawBeam(now: number): void {
    const dots = this.dots;
    const view = this.view;
    if (!dots || !view) return;
    dots.begin();
    const m = view.muzzle();
    const part = this.grabbed;
    if (!part) {
      this.orbiters.forEach((o) => o.setVisible(false));
      if (this.holdId !== null) {
        dots.line(m.x, m.y, this.fingerX, this.fingerY, C.red, 3);
        dots.line(m.x, m.y, this.fingerX, this.fingerY, C.white, 9);
      }
      return;
    }
    const px = part.body.position.x;
    const py = part.body.position.y;
    const dx = px - m.x;
    const dy = py - m.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const phase = now / 40;
    // raggio: alone scuro (si vede anche sulla strada gialla) + nucleo che pulsa
    for (let d = 0; d <= len; d += 1) {
      const wob = Math.round(Math.sin(d * 0.3 - phase) * 1.5);
      const x = m.x + (dx * d) / len + nx * wob;
      const y = m.y + (dy * d) / len + ny * wob;
      dots.dot(x - 1, y - 1, d % 4 < 2 ? C.red : C.plum, 3);
    }
    for (let d = 0; d <= len; d += 1) {
      const wob = Math.round(Math.sin(d * 0.3 - phase) * 1.5);
      const c = (d + Math.floor(phase * 2)) % 6 < 2 ? C.white : d % 2 ? C.orange : C.yellow;
      dots.dot(m.x + (dx * d) / len + nx * wob, m.y + (dy * d) / len + ny * wob, c);
    }
    if (Math.random() < 0.4) {
      const t = Math.random();
      spawnParticles(this.ctx.scene, m.x + dx * t, m.y + dy * t, { count: 1, colors: [C.yellow, C.white, C.orange], speed: 0.8, gravity: 0, lifeMs: 200, size: 1 });
    }
    const n = this.orbiters.length;
    this.orbiters.forEach((o, i) => {
      const a = now / 120 + (i / n) * Math.PI * 2;
      const r = SCIFI.gravOrbitRadius + (i % 2) * 3;
      o.setVisible(true).setPosition(Math.round(px + Math.cos(a) * r), Math.round(py + Math.sin(a) * r * 0.7));
      o.setDepth(Math.sin(a) > 0 ? 17 : 9);
    });
  }

  /** Rilascio con Tony agganciato: lo spara nella direzione del dito. */
  private shoot(): void {
    const part = this.grabbed;
    const view = this.view;
    if (!part || !view) {
      this.drop();
      return;
    }
    const { scene, ragdoll } = this.ctx;
    const s = this.stats;
    const now = scene.time.now;
    const m = view.muzzle();
    let dx: number;
    let dy: number;
    if (Math.hypot(this.fingerVx, this.fingerVy) >= SCIFI.gravFlickSpeed) {
      dx = this.fingerVx;
      dy = this.fingerVy;
    } else {
      dx = part.body.position.x - m.x;
      dy = part.body.position.y - m.y;
    }
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const power = Phaser.Math.Linear(s.minPower, 1, Math.min(1, (now - this.grabAt) / s.fullMs));
    const speed = Math.min(GRAB.maxThrowSpeed, s.throwSpeed) * power;
    ragdoll.release(this.grabId, dx * speed, dy * speed);
    ragdoll.addVelocity(dx * s.extraSpeed * power, dy * s.extraSpeed * power);
    this.grabbed = null;
    this.orbiters.forEach((o) => o.setVisible(false));
    this.slamUntil = now + s.slamMs;
    this.prevVel.clear();
    const px = Math.round(part.body.position.x);
    const py = Math.round(part.body.position.y);
    this.hit({ part: part.name, x: px, y: py, amount: s.damage * power, weaponId: this.id });
    this.fx(px, py, m, power);
  }

  /** Tap senza presa: spintone gravitazionale sulla parte sotto il dito. */
  private punt(): void {
    const view = this.view;
    if (!view || !this.tryUse()) return;
    const m = view.muzzle();
    const hit = this.ctx.ragdoll.partAt(this.fingerX, this.fingerY, this.stats.pickTolerance);
    if (hit) {
      const s = this.stats;
      let dx = hit.part.body.position.x - m.x;
      let dy = hit.part.body.position.y - m.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      this.ctx.ragdoll.applyImpulse(hit.part, this.fingerX, this.fingerY, dx * s.puntImpulse, dy * s.puntImpulse);
      this.ctx.ragdoll.addVelocity(dx * 2, dy * 2, hit.part);
      this.hit({ part: hit.part.name, x: Math.round(this.fingerX), y: Math.round(this.fingerY), amount: s.damage * 0.5, weaponId: this.id });
    }
    this.fx(Math.round(this.fingerX), Math.round(this.fingerY), m, hit ? 0.6 : 0.3);
  }

  private fx(x: number, y: number, m: { x: number; y: number }, power: number): void {
    const scene = this.ctx.scene;
    this.view?.recoil(2);
    this.shotUntil = scene.time.now + 120;
    popFrames(scene, x, y, BLAST_KEYS, 50);
    popFrames(scene, m.x, m.y, BLAST_KEYS, 40, { depth: SCIFI.viewDepth + 1 });
    spawnParticles(scene, x, y, { count: Math.round(6 + 10 * power), colors: [C.orange, C.yellow, C.white], speed: 3.5, gravity: 0.05, lifeMs: 360 });
    shake(scene, power > 0.7 ? 3 : 2, 160);
    // "thoom": colpo sordo + fischio che scende
    noise({ dur: 0.18, vol: 0.18 + 0.15 * power, freq: 1800, freqTo: 150 });
    tone({ type: 'square', from: 340, to: 55, dur: 0.2, vol: 0.15 });
    tone({ type: 'triangle', from: 1200, to: 300, dur: 0.15, vol: 0.06, delay: 0.02 });
  }

  /** Per il debug da console. */
  get debugState(): { holding: boolean; grabbed: string | null } {
    return { holding: this.holdId !== null, grabbed: this.grabbed?.name ?? null };
  }
}

/** Anello (cerchio vuoto) di raggio r. */
function ringSprite(r: number, outer: string, inner: string): SpriteData {
  const d = r * 2 + 1;
  return new PixelGrid(d, d).disc(r, r, r, outer).disc(r, r, r - 1, inner).disc(r, r, r - 2, '.').rows();
}
