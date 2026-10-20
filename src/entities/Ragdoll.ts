import Phaser from 'phaser';
import { DAMAGE, GRAB, MOOD, RAGDOLL, ROOM_INNER } from '../config/balance';
import { hitFlash } from '../gfx/effects';
import { HEAD_ORIGIN_Y } from '../gfx/sprites';
import { dealDamage, impactDamage } from '../systems/damage';
import { events, Subscriptions, type Mood, type PartName } from '../systems/events';

type Body = MatterJS.BodyType;
type Vec = { x: number; y: number };

interface PartDef {
  name: PartName;
  texture: string;
  /** dimensioni del corpo fisico */
  w: number;
  h: number;
  circle?: number;
  density: number;
  /** posizione iniziale relativa al centro del busto */
  x: number;
  y: number;
  depth: number;
  originY?: number;
}

interface JointDef {
  a: PartName;
  b: PartName;
  /** ancoraggi locali (rispetto al centro del corpo) */
  pa: Vec;
  pb: Vec;
}

const D_TORSO = RAGDOLL.densityTorso;
const D_HEAD = RAGDOLL.densityHead;
const D_LIMB = RAGDOLL.densityLimb;

const PARTS: PartDef[] = [
  { name: 'legUpperL', texture: 'tony-leg-upper', w: 5, h: 10, density: D_LIMB, x: -3, y: 13, depth: 10 },
  { name: 'legLowerL', texture: 'tony-leg-lower', w: 5, h: 11, density: D_LIMB, x: -3, y: 23, depth: 10 },
  { name: 'legUpperR', texture: 'tony-leg-upper', w: 5, h: 10, density: D_LIMB, x: 3, y: 13, depth: 11 },
  { name: 'legLowerR', texture: 'tony-leg-lower', w: 5, h: 11, density: D_LIMB, x: 3, y: 23, depth: 11 },
  { name: 'torso', texture: 'tony-torso', w: 12, h: 16, density: D_TORSO, x: 0, y: 0, depth: 12 },
  { name: 'armUpperL', texture: 'tony-arm-upper', w: 4, h: 9, density: D_LIMB, x: -7, y: -2, depth: 13 },
  { name: 'armLowerL', texture: 'tony-arm-lower', w: 4, h: 9, density: D_LIMB, x: -7, y: 6, depth: 13 },
  { name: 'armUpperR', texture: 'tony-arm-upper', w: 4, h: 9, density: D_LIMB, x: 7, y: -2, depth: 14 },
  { name: 'armLowerR', texture: 'tony-arm-lower', w: 4, h: 9, density: D_LIMB, x: 7, y: 6, depth: 14 },
  {
    name: 'head',
    texture: 'tony-head',
    w: 14,
    h: 14,
    circle: 7,
    density: D_HEAD,
    x: 0,
    y: -15,
    depth: 15,
    originY: HEAD_ORIGIN_Y,
  },
];

const JOINTS: JointDef[] = [
  { a: 'torso', b: 'head', pa: { x: 0, y: -8 }, pb: { x: 0, y: 7 } },
  { a: 'torso', b: 'armUpperL', pa: { x: -7, y: -6 }, pb: { x: 0, y: -4 } },
  { a: 'armUpperL', b: 'armLowerL', pa: { x: 0, y: 4 }, pb: { x: 0, y: -4 } },
  { a: 'torso', b: 'armUpperR', pa: { x: 7, y: -6 }, pb: { x: 0, y: -4 } },
  { a: 'armUpperR', b: 'armLowerR', pa: { x: 0, y: 4 }, pb: { x: 0, y: -4 } },
  { a: 'torso', b: 'legUpperL', pa: { x: -3, y: 8 }, pb: { x: 0, y: -5 } },
  { a: 'legUpperL', b: 'legLowerL', pa: { x: 0, y: 5 }, pb: { x: 0, y: -5 } },
  { a: 'torso', b: 'legUpperR', pa: { x: 3, y: 8 }, pb: { x: 0, y: -5 } },
  { a: 'legUpperR', b: 'legLowerR', pa: { x: 0, y: 5 }, pb: { x: 0, y: -5 } },
];

/** Una parte del pupazzo: corpo fisico + sprite sincronizzato a pixel interi. */
export interface Part {
  name: PartName;
  def: PartDef;
  body: Body;
  sprite: Phaser.GameObjects.Image;
  lastHitAt: number;
}

export interface PartHit {
  part: Part;
  /** punto toccato in coordinate mondo */
  x: number;
  y: number;
}

interface Grab {
  part: Part;
  constraint: MatterJS.ConstraintType;
}

interface CollisionPair {
  bodyA: Body;
  bodyB: Body;
  collision: { normal: Vec; supports?: Vec[] };
}

/** passo fisico fisso al quadrato (ms²): serve per convertire Δv in forza */
const DT2 = (1000 / 60) ** 2;

/**
 * Tony, il pupazzo di pezza: 10 parti unite da giunti morbidi Matter.
 * Si afferra/lancia (grab/moveGrab/release), prende danno dagli urti,
 * cambia espressione in base ai colpi recenti e non esce mai dalla stanza.
 */
export class Ragdoll {
  readonly parts = new Map<PartName, Part>();
  private byBodyId = new Map<number, Part>();
  private joints: { def: JointDef; c: MatterJS.ConstraintType }[] = [];
  private grabs = new Map<number, Grab>();
  private subs = new Subscriptions();
  private group: number;

  private stress = 0;
  private mood: Mood = 'normal';
  private moodHoldUntil = 0;
  private nextBlinkAt = 0;
  private stars: Phaser.GameObjects.Image[] = [];
  private stretchedSince = -1;

  constructor(
    private scene: Phaser.Scene,
    private spawnX: number = RAGDOLL.spawnX,
    private spawnY: number = RAGDOLL.spawnY,
  ) {
    this.group = scene.matter.world.nextGroup(true);

    for (const def of PARTS) {
      const opts: Phaser.Types.Physics.Matter.MatterBodyConfig = {
        label: `tony:${def.name}`,
        density: def.density,
        friction: RAGDOLL.friction,
        frictionAir: RAGDOLL.frictionAir,
        restitution: RAGDOLL.restitution,
        collisionFilter: { group: this.group, category: 1, mask: 0xffffffff },
      };
      const x = spawnX + def.x;
      const y = spawnY + def.y;
      const body = def.circle
        ? scene.matter.add.circle(x, y, def.circle, opts)
        : scene.matter.add.rectangle(x, y, def.w, def.h, { ...opts, chamfer: { radius: 1.5 } });
      const sprite = scene.add.image(x, y, def.texture).setDepth(def.depth);
      if (def.originY !== undefined) sprite.setOrigin(0.5, def.originY);
      const part: Part = { name: def.name, def, body, sprite, lastHitAt: -1e9 };
      this.parts.set(def.name, part);
      this.byBodyId.set(body.id, part);
    }

    for (const def of JOINTS) {
      const c = scene.matter.add.constraint(this.part(def.a).body, this.part(def.b).body, 0, RAGDOLL.jointStiffness, {
        pointA: { ...def.pa },
        pointB: { ...def.pb },
        damping: RAGDOLL.jointDamping,
      });
      this.joints.push({ def, c });
    }

    for (let i = 0; i < 3; i++) {
      this.stars.push(scene.add.image(0, 0, 'fx-star-a').setDepth(16).setVisible(false));
    }

    scene.matter.world.on('collisionstart', this.onCollision, this);
    scene.matter.world.on('beforeupdate', this.enforceJointLimits, this);
    this.subs.on('damage', (e) => {
      const p = this.parts.get(e.part);
      if (p) hitFlash(p.sprite);
      this.stress += e.amount;
    });
    this.nextBlinkAt = scene.time.now + MOOD.blinkEveryMs;
  }

  // ---------------------------------------------------------------- API pubblica

  part(name: PartName): Part {
    const p = this.parts.get(name);
    if (!p) throw new Error(`Ragdoll: parte sconosciuta ${name}`);
    return p;
  }

  get bodies(): Body[] {
    return [...this.parts.values()].map((p) => p.body);
  }

  get currentMood(): Mood {
    return this.mood;
  }

  /** Parte del corpo a cui appartiene un corpo Matter (o undefined). */
  partOfBody(body: Body): Part | undefined {
    return this.byBodyId.get(body.id) ?? this.byBodyId.get(body.parent?.id);
  }

  /** Centro di massa approssimato (media pesata delle parti). */
  centerOfMass(): Vec {
    let x = 0;
    let y = 0;
    let m = 0;
    for (const p of this.parts.values()) {
      x += p.body.position.x * p.body.mass;
      y += p.body.position.y * p.body.mass;
      m += p.body.mass;
    }
    return { x: x / m, y: y / m };
  }

  /**
   * Parte sotto il punto (x,y). Se nessuna parte contiene il punto, ritorna
   * la più vicina entro `tolerance` px (le parti sono piccole per un dito).
   */
  partAt(x: number, y: number, tolerance: number = GRAB.pickTolerance): PartHit | null {
    let best: Part | null = null;
    let bestDist = Infinity;
    for (const p of this.parts.values()) {
      const d = this.distanceToPart(p, x, y);
      if (d > tolerance) continue;
      // se il punto è dentro più parti, vince quella disegnata sopra
      const better = !best || (d <= 0 && bestDist <= 0 ? p.def.depth > best.def.depth : d < bestDist);
      if (better) {
        best = p;
        bestDist = d;
      }
    }
    return best ? { part: best, x, y } : null;
  }

  /**
   * Cambio di velocità `dv` (px/step) applicato nel punto (x,y) della parte:
   * genera anche rotazione se il punto non è al centro. Il danno NON è
   * incluso: chi colpisce chiama systems/damage.dealDamage().
   */
  applyImpulse(part: Part, x: number, y: number, dvx: number, dvy: number): void {
    const m = part.body.mass;
    this.scene.matter.body.applyForce(part.body, { x, y }, { x: (dvx * m) / DT2, y: (dvy * m) / DT2 });
  }

  /** Aggiunge velocità a tutte le parti (es. spinta globale). */
  addVelocity(dvx: number, dvy: number, except?: Part): void {
    for (const p of this.parts.values()) {
      if (p === except) continue;
      const v = p.body.velocity;
      this.scene.matter.body.setVelocity(p.body, { x: v.x + dvx, y: v.y + dvy });
    }
  }

  /** Spinta radiale (esplosioni, onde d'urto). strength in px/step al centro. */
  applyRadialImpulse(x: number, y: number, radius: number, strength: number): Part[] {
    const hit: Part[] = [];
    for (const p of this.parts.values()) {
      const dx = p.body.position.x - x;
      const dy = p.body.position.y - y;
      const d = Math.hypot(dx, dy);
      if (d > radius) continue;
      const k = strength * (1 - d / radius);
      const nx = d > 0.001 ? dx / d : 0;
      const ny = d > 0.001 ? dy / d : -1;
      const v = p.body.velocity;
      this.scene.matter.body.setVelocity(p.body, { x: v.x + nx * k, y: v.y + ny * k });
      hit.push(p);
    }
    return hit;
  }

  isGrabbed(): boolean {
    return this.grabs.size > 0;
  }

  /** Afferra una parte con il puntatore `pointerId` nel punto (x,y). */
  grab(pointerId: number, hit: PartHit): void {
    this.release(pointerId, 0, 0, false);
    const { part } = hit;
    const pos = part.body.position;
    const target = clampInside(hit.x, hit.y, 3);
    const constraint = this.scene.matter.add.worldConstraint(part.body, 0, GRAB.stiffness, {
      pointA: target,
      pointB: { x: hit.x - pos.x, y: hit.y - pos.y },
      damping: GRAB.damping,
      angularStiffness: 0,
    });
    this.grabs.set(pointerId, { part, constraint });
    events.emit('ragdoll:grab', { part: part.name });
  }

  moveGrab(pointerId: number, x: number, y: number): void {
    const g = this.grabs.get(pointerId);
    if (!g) return;
    const t = clampInside(x, y, 3);
    g.constraint.pointA.x = t.x;
    g.constraint.pointA.y = t.y;
  }

  /**
   * Rilascia la presa e lancia: la parte presa prende la velocità del gesto
   * (px/step), il resto del corpo una quota (GRAB.throwBodyShare).
   */
  release(pointerId: number, vx: number, vy: number, throwIt = true): void {
    const g = this.grabs.get(pointerId);
    if (!g) return;
    this.scene.matter.world.removeConstraint(g.constraint);
    this.grabs.delete(pointerId);
    if (!throwIt) return;

    const speed = Math.hypot(vx, vy);
    if (speed > GRAB.maxThrowSpeed) {
      vx = (vx / speed) * GRAB.maxThrowSpeed;
      vy = (vy / speed) * GRAB.maxThrowSpeed;
    }
    const share = GRAB.throwBodyShare;
    for (const p of this.parts.values()) {
      const v = p.body.velocity;
      const k = p === g.part ? 1 : share;
      this.scene.matter.body.setVelocity(p.body, { x: v.x * (1 - k) + vx * k, y: v.y * (1 - k) + vy * k });
    }
    events.emit('ragdoll:release', { part: g.part.name, vx, vy });
  }

  /** Riporta Tony in piedi al centro (usato anche dall'anti-incastro). */
  respawn(): void {
    for (const id of [...this.grabs.keys()]) this.release(id, 0, 0, false);
    for (const p of this.parts.values()) {
      const mb = this.scene.matter.body;
      mb.setPosition(p.body, { x: this.spawnX + p.def.x, y: this.spawnY + p.def.y }, false);
      mb.setAngle(p.body, 0, false);
      mb.setVelocity(p.body, { x: 0, y: 0 });
      mb.setAngularVelocity(p.body, 0);
    }
    this.stretchedSince = -1;
  }

  // ---------------------------------------------------------------- aggiornamento

  /** Da chiamare ogni frame DOPO gli step di fisica. */
  update(dtMs: number): void {
    const now = this.scene.time.now;
    this.keepSane(now);
    this.syncSprites();
    this.updateMood(now, dtMs);
  }

  destroy(): void {
    this.subs.clear();
    // allo shutdown della scena il mondo Matter può essere già stato distrutto
    const world = this.scene.matter?.world as Phaser.Physics.Matter.World | null | undefined;
    if (world?.engine) {
      world.off('collisionstart', this.onCollision, this);
      world.off('beforeupdate', this.enforceJointLimits, this);
      for (const id of [...this.grabs.keys()]) this.release(id, 0, 0, false);
      for (const j of this.joints) world.removeConstraint(j.c);
      for (const p of this.parts.values()) world.remove(p.body);
    }
    this.grabs.clear();
    for (const p of this.parts.values()) p.sprite.destroy();
    this.stars.forEach((s) => s.destroy());
    this.parts.clear();
    this.byBodyId.clear();
  }

  // ---------------------------------------------------------------- interni

  private distanceToPart(p: Part, x: number, y: number): number {
    const b = p.body;
    const dx = x - b.position.x;
    const dy = y - b.position.y;
    if (p.def.circle) return Math.hypot(dx, dy) - p.def.circle;
    // punto nel sistema locale del rettangolo ruotato
    const c = Math.cos(-b.angle);
    const s = Math.sin(-b.angle);
    const lx = Math.abs(dx * c - dy * s) - p.def.w / 2;
    const ly = Math.abs(dx * s + dy * c) - p.def.h / 2;
    const ox = Math.max(lx, 0);
    const oy = Math.max(ly, 0);
    return ox === 0 && oy === 0 ? Math.max(lx, ly) : Math.hypot(ox, oy);
  }

  private onCollision(event: { pairs: CollisionPair[] }): void {
    const now = this.scene.time.now;
    for (const pair of event.pairs) {
      const pa = this.partOfBody(pair.bodyA);
      const pb = this.partOfBody(pair.bodyB);
      if ((pa && pb) || (!pa && !pb)) continue;
      const part = (pa ?? pb) as Part;
      const self = part.body;
      const other = pa ? pair.bodyB : pair.bodyA;
      const otherRoot = other.parent ?? other;

      const vo = otherRoot.isStatic ? { x: 0, y: 0 } : otherRoot.velocity;
      const rvx = self.velocity.x - vo.x;
      const rvy = self.velocity.y - vo.y;
      const n = pair.collision.normal;
      const speed = Math.abs(rvx * n.x + rvy * n.y);

      const meta = otherRoot as unknown as { weaponId?: string; damageScale?: number };
      const amount = impactDamage(speed) * (meta.damageScale ?? 1);
      if (amount <= 0 || now - part.lastHitAt < DAMAGE.partCooldownMs) continue;
      part.lastHitAt = now;

      const sp = pair.collision.supports?.[0];
      dealDamage({
        part: part.name,
        x: sp ? sp.x : self.position.x,
        y: sp ? sp.y : self.position.y,
        amount,
        weaponId: meta.weaponId ?? 'impact',
      });
    }
  }

  /**
   * Limiti morbidi degli angoli dei giunti (ogni step di fisica): se una parte
   * ruota oltre RAGDOLL.jointLimitDeg rispetto al genitore, le due parti
   * ricevono una spinta angolare opposta che la riporta dentro il limite.
   */
  private enforceJointLimits(): void {
    const mb = this.scene.matter.body;
    const k = RAGDOLL.jointLimitStiffness;
    for (const { def } of this.joints) {
      const limitDeg = RAGDOLL.jointLimitDeg[def.b as keyof typeof RAGDOLL.jointLimitDeg];
      if (limitDeg === undefined) continue;
      const a = this.part(def.a).body;
      const b = this.part(def.b).body;
      const rel = Phaser.Math.Angle.Wrap(b.angle - a.angle);
      const limit = Phaser.Math.DegToRad(limitDeg);
      const excess = rel > limit ? rel - limit : rel < -limit ? rel + limit : 0;
      if (excess === 0) continue;
      // la parte figlia (più leggera) si corregge di più del genitore
      mb.setAngularVelocity(b, b.angularVelocity - excess * k);
      mb.setAngularVelocity(a, a.angularVelocity + excess * k * 0.3);
    }
  }

  /** Limiti di velocità, anti-uscita dalla stanza e anti-incastro. */
  private keepSane(now: number): void {
    const mb = this.scene.matter.body;
    for (const p of this.parts.values()) {
      const b = p.body;
      const v = b.velocity;
      const sp = Math.hypot(v.x, v.y);
      if (sp > RAGDOLL.maxSpeed) mb.setVelocity(b, { x: (v.x / sp) * RAGDOLL.maxSpeed, y: (v.y / sp) * RAGDOLL.maxSpeed });
      if (Math.abs(b.angularVelocity) > RAGDOLL.maxAngularSpeed) {
        mb.setAngularVelocity(b, Math.sign(b.angularVelocity) * RAGDOLL.maxAngularSpeed);
      }
      // se il centro di una parte finisce dentro un muro, la riportiamo dentro
      const r = Math.max(p.def.w, p.def.h) / 2;
      const { x, y } = b.position;
      if (x < ROOM_INNER.left || x > ROOM_INNER.right || y < ROOM_INNER.top || y > ROOM_INNER.bottom) {
        mb.setPosition(b, clampInside(x, y, r), false);
        mb.setVelocity(b, { x: 0, y: 0 });
      }
    }

    // giunti stirati troppo a lungo = pupazzo incastrato → reset
    let maxStretch = 0;
    for (const { c } of this.joints) {
      const a = c.bodyA;
      const b = c.bodyB;
      if (!a || !b) continue;
      const d = Math.hypot(
        a.position.x + c.pointA.x - (b.position.x + c.pointB.x),
        a.position.y + c.pointA.y - (b.position.y + c.pointB.y),
      );
      maxStretch = Math.max(maxStretch, d);
    }
    if (maxStretch > RAGDOLL.maxJointStretch && !this.isGrabbed()) {
      if (this.stretchedSince < 0) this.stretchedSince = now;
      else if (now - this.stretchedSince > RAGDOLL.stretchResetMs) this.respawn();
    } else {
      this.stretchedSince = -1;
    }
  }

  private syncSprites(): void {
    const step = (Math.PI * 2) / RAGDOLL.rotationSteps;
    for (const p of this.parts.values()) {
      const b = p.body;
      p.sprite.setPosition(Math.round(b.position.x), Math.round(b.position.y));
      p.sprite.setRotation(Math.round(b.angle / step) * step);
    }
  }

  private updateMood(now: number, dtMs: number): void {
    this.stress = Math.max(0, this.stress - (MOOD.decayPerSec * dtMs) / 1000);
    const target: Mood = this.stress >= MOOD.dizzyAt ? 'dizzy' : this.stress >= MOOD.hurtAt ? 'hurt' : 'normal';
    const rank = { normal: 0, hurt: 1, dizzy: 2 } as const;

    if (rank[target] > rank[this.mood]) {
      this.setMood(target, now);
    } else if (rank[target] < rank[this.mood] && now >= this.moodHoldUntil) {
      this.setMood(target, now);
    } else if (target === this.mood && target !== 'normal') {
      // colpi continui: prolunga l'espressione
      this.moodHoldUntil = Math.max(this.moodHoldUntil, now + 120);
    }

    const head = this.part('head').sprite;
    let key = 'tony-head';
    if (this.mood === 'dizzy') {
      key = Math.floor(now / 200) % 2 === 0 ? 'tony-head-dizzy-a' : 'tony-head-dizzy-b';
    } else if (this.mood === 'hurt') {
      key = 'tony-head-hurt';
    } else {
      if (now >= this.nextBlinkAt + MOOD.blinkMs) {
        this.nextBlinkAt = now + MOOD.blinkEveryMs * (0.6 + Math.random() * 0.8);
      }
      if (now >= this.nextBlinkAt) key = 'tony-head-blink';
    }
    if (head.texture.key !== key) head.setTexture(key);

    // stelline che girano sopra la testa quando è stordito
    const dizzy = this.mood === 'dizzy';
    const phase = Math.floor(now / 90) % 12;
    this.stars.forEach((s, i) => {
      s.setVisible(dizzy);
      if (!dizzy) return;
      const a = ((phase + i * 4) / 12) * Math.PI * 2;
      s.setPosition(Math.round(head.x + Math.cos(a) * 10), Math.round(head.y - 11 + Math.sin(a) * 3));
      s.setTexture((phase + i) % 2 === 0 ? 'fx-star-a' : 'fx-star-b');
      s.setDepth(Math.sin(a) > 0 ? 16 : 9);
    });
  }

  private setMood(mood: Mood, now: number): void {
    if (mood === this.mood) return;
    this.mood = mood;
    this.moodHoldUntil = now + (mood === 'dizzy' ? MOOD.dizzyHoldMs : mood === 'hurt' ? MOOD.hurtHoldMs : 0);
    events.emit('mood:changed', { mood });
  }
}

/** Limita un punto all'interno della stanza con un margine. */
export function clampInside(x: number, y: number, margin = 0): Vec {
  return {
    x: Phaser.Math.Clamp(x, ROOM_INNER.left + margin, ROOM_INNER.right - margin),
    y: Phaser.Math.Clamp(y, ROOM_INNER.top + margin, ROOM_INNER.bottom - margin),
  };
}
