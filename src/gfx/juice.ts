import Phaser from 'phaser';
import { JUICE, SCREEN } from '../config/balance';
import { C, col, hex, type ColorIndex } from '../config/palette';
import { noise, tone } from '../audio/sfx';
import type { Ragdoll } from '../entities/Ragdoll';
import { events, type DamageEvent } from '../systems/events';
import { acquireImage, releaseImage } from './effects';
import { ensurePixelFont, normalizeText } from './pixelFont';

/**
 * "Dopamina" sui colpi, in stile pixel e tutta a pool (niente add/destroy a
 * ogni colpo). Parte da sola dall'evento 'damage' (systems/feedback.ts chiama
 * juiceHit), quindi ogni arma la riceve gratis:
 *
 *  - scritte fumetto (SMACK! ZAP! KABOOM!...) sui colpi forti / critici,
 *    scelte per famiglia d'arma (WORD_FAMILIES / WEAPON_FAMILY qui sotto);
 *  - impact frame (Tony sagoma bianca, sfondo scuro, ≤ 2 frame, max 1/s) e
 *    punch-zoom della camera sui colpi molto forti;
 *  - linee d'impatto radiali sui colpi forti;
 *  - cornice rossa/gialla dello schermo (nella scena UI) sui critici;
 *  - squash & stretch della parte colpita (solo sprite, la fisica non cambia);
 *  - suoni: "ding" cattivo dei critici e "swoosh" delle scritte.
 *
 * Le monete che volano verso il contatore stanno in bindFlyingCoins(), che
 * la scena UI aggancia al proprio contatore.
 */

// ---------------------------------------------------------------- parole per arma

/** Parole per famiglia d'arma. Per una famiglia nuova: aggiungi qui e in WEAPON_FAMILY / FAMILY_PATTERNS. */
export const WORD_FAMILIES = {
  blunt: ['SMACK!', 'POW!', 'BAM!', 'WHAM!'],
  blade: ['SLASH!', 'ZAC!', 'SWISH!'],
  gun: ['BANG!', 'BLAM!', 'PAM!'],
  auto: ['RATATA!', 'TATATA!', 'BANG!'],
  boom: ['KABOOM!', 'BOOM!'],
  fire: ['FIUUU!', 'BRUCIA!'],
  shock: ['ZAP!', 'BZZT!'],
  ice: ['CRACK!', 'BRRR!'],
  wind: ['WHOOSH!', 'FWOOSH!'],
  impact: ['SBONK!', 'THUD!', 'CRASH!'],
  default: ['POW!'],
} as const satisfies Record<string, readonly string[]>;

export type WordFamily = keyof typeof WORD_FAMILIES;

/** weaponId → famiglia (corrispondenza esatta, vince sui pattern). */
export const WEAPON_FAMILY: Record<string, WordFamily> = {
  punch: 'blunt',
  shuriken: 'blade',
  coltello: 'blade',
  pistola: 'gun',
  mitragliatrice: 'auto',
  granata: 'boom',
  dinamite: 'boom',
  impact: 'impact',
};

/** Fallback per le armi nuove: primo pattern che corrisponde al weaponId (in ordine). */
export const FAMILY_PATTERNS: readonly (readonly [RegExp, WordFamily])[] = [
  [/granat|dinamit|rpg|bazook|razz|rocket|bomb|esplos|explo|missil|nuke|tnt|c4/, 'boom'],
  [/mitra|machine|smg|uzi|minigun|gatling|raffica/, 'auto'],
  [/pistol|fucil|gun|rifle|shotgun|revolver|sniper|cecchin|lupara/, 'gun'],
  [/fuoco|fiamm|fire|flame|lava|napalm|incend|brace|drago/, 'fire'],
  [/fulmin|elettr|lightning|thunder|zap|tesla|shock|taser|saetta/, 'shock'],
  [/ghiacc|gelo|frost|cryo|neve|ice$|^ice/, 'ice'],
  [/vento|wind|tornad|uragan|soffi|ventilat|turbine/, 'wind'],
  [/lam|spad|katana|sword|coltel|knife|motoseg|saw|ascia|axe|shuriken|machete|forbic|falce|pugnal/, 'blade'],
  [/pugn|punch|mazz|bat|martell|hammer|piede|porco|crowbar|tubo|pala|chiave|mattone|padell|calc|kick|bastone/, 'blunt'],
];

const familyCache = new Map<string, WordFamily>();

export function wordFamily(weaponId: string): WordFamily {
  let f = familyCache.get(weaponId);
  if (f) return f;
  const id = weaponId.toLowerCase();
  f = WEAPON_FAMILY[id] ?? FAMILY_PATTERNS.find(([re]) => re.test(id))?.[1] ?? 'default';
  familyCache.set(weaponId, f);
  return f;
}

export function pickWord(weaponId: string): string {
  const list: readonly string[] = WORD_FAMILIES[wordFamily(weaponId)];
  return list[Math.floor(Math.random() * list.length)];
}

/** Colori a rotazione: testo + "esplosione" dietro (fondo e nucleo). */
const WORD_STYLES: readonly { text: ColorIndex; burst: ColorIndex; core: ColorIndex }[] = [
  { text: C.yellow, burst: C.red, core: C.orange },
  { text: C.white, burst: C.orange, core: C.yellow },
  { text: C.red, burst: C.yellow, core: C.white },
  { text: C.cyan, burst: C.blue, core: C.sky },
  { text: C.orange, burst: C.plum, core: C.red },
  { text: C.white, burst: C.red, core: C.orange },
];

// ---------------------------------------------------------------- texture "esplosione"

const BURST_SIZES = { s: [84, 40], l: [118, 44] } as const;
type BurstSize = keyof typeof BURST_SIZES;

/** 3 frame: piccola, grande, grande con le punte sfasate (tremolio). */
function burstKeys(scene: Phaser.Scene, size: BurstSize, fill: ColorIndex, core: ColorIndex): string[] {
  const keys: string[] = [];
  const frames = [
    { k: 0.62, phase: 0 },
    { k: 1, phase: 0 },
    { k: 0.94, phase: 0.5 },
  ];
  frames.forEach((fr, i) => {
    const key = `juice-burst-${size}-${fill}-${core}-${i}`;
    keys.push(key);
    if (scene.textures.exists(key)) return;
    const [w, h] = BURST_SIZES[size];
    const tex = scene.textures.createCanvas(key, w, h);
    if (!tex) return;
    const ctx = tex.getContext();
    const cx = (w - 1) / 2;
    const cy = (h - 1) / 2;
    const spikes = size === 'l' ? 13 : 11;
    const inside = (x: number, y: number, shrink = 1): boolean => {
      const nx = (x - cx) / (cx * fr.k * shrink);
      const ny = (y - cy) / (cy * fr.k * shrink);
      const d = Math.hypot(nx, ny);
      const u = (Math.atan2(ny, nx) / (Math.PI * 2)) * spikes + fr.phase;
      const tri = 1 - Math.abs(2 * (u - Math.floor(u)) - 1);
      return d <= 0.62 + 0.38 * tri * tri;
    };
    const mask: boolean[][] = [];
    for (let y = 0; y < h; y++) {
      mask.push([]);
      for (let x = 0; x < w; x++) mask[y].push(inside(x, y));
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let c: ColorIndex | null = null;
        if (mask[y][x]) {
          const edge = !mask[y - 1]?.[x] || !mask[y + 1]?.[x] || !mask[y][x - 1] || !mask[y][x + 1];
          c = edge ? C.black : inside(x, y, 0.62) ? core : fill;
        }
        if (c === null) continue;
        ctx.fillStyle = hex(c);
        ctx.fillRect(x, y, 1, 1);
      }
    }
    tex.refresh();
  });
  return keys;
}

// ---------------------------------------------------------------- stato per scena

interface Word {
  burst: Phaser.GameObjects.Image;
  text: Phaser.GameObjects.BitmapText;
  frames: string[];
  start: number;
  x: number;
  y: number;
  rot: number;
  live: boolean;
}

interface LineBurst {
  x: number;
  y: number;
  start: number;
  angles: number[];
  lens: number[];
}

interface Squash {
  sprite: Phaser.GameObjects.Image;
  start: number;
}

interface JuiceState {
  words: Word[];
  lastWordAt: number;
  styleIdx: number;
  lines: LineBurst[];
  linesG: Phaser.GameObjects.Graphics | null;
  linesDirty: boolean;
  overlay: Phaser.GameObjects.Rectangle | null;
  impactLeft: number;
  impactShown: boolean;
  lastImpactAt: number;
  zoomStart: number;
  zoomSet: number;
  borderStart: number;
  borderG: Phaser.GameObjects.Graphics | null;
  borderShown: boolean;
  squashes: Squash[];
}

const states = new WeakMap<Phaser.Scene, JuiceState>();

function state(scene: Phaser.Scene): JuiceState {
  let s = states.get(scene);
  if (s) return s;
  const st: JuiceState = {
    words: [],
    lastWordAt: -1e9,
    styleIdx: 0,
    lines: [],
    linesG: null,
    linesDirty: false,
    overlay: null,
    impactLeft: 0,
    impactShown: false,
    lastImpactAt: -1e9,
    zoomStart: -1,
    zoomSet: 1,
    borderStart: -1e9,
    borderG: null,
    borderShown: false,
    squashes: [],
  };
  states.set(scene, st);
  const onRender = () => tick(scene, st);
  scene.events.on(Phaser.Scenes.Events.PRE_RENDER, onRender);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
    scene.events.off(Phaser.Scenes.Events.PRE_RENDER, onRender);
    if (st.borderG?.scene) st.borderG.setVisible(false);
    states.delete(scene);
  });
  return st;
}

function ragdollOf(scene: Phaser.Scene): Ragdoll | undefined {
  return (scene as Phaser.Scene & { ragdoll?: Ragdoll }).ragdoll;
}

// ---------------------------------------------------------------- ingresso

/** Tutti gli effetti "juice" di un colpo. Chiamato da systems/feedback.ts su 'damage'. */
export function juiceHit(scene: Phaser.Scene, e: DamageEvent): void {
  const s = state(scene);
  const now = scene.time.now;
  const veryStrong = e.amount >= JUICE.veryStrongDamage;

  squashPart(scene, s, e, now);
  if (e.strong || e.crit) comicWord(scene, s, e, now);
  if (e.strong) speedLines(s, e, now);
  if (veryStrong) {
    if (now - s.lastImpactAt >= JUICE.impactCooldownMs) {
      s.lastImpactAt = now;
      s.impactLeft = Math.min(2, JUICE.impactFrames);
    }
    punchZoom(scene, s, now);
  }
  if (e.crit) {
    s.borderStart = now;
    playCritSound();
  }
}

function tick(scene: Phaser.Scene, s: JuiceState): void {
  const now = scene.time.now;
  tickSquash(s, now);
  tickWords(s, now);
  tickLines(scene, s, now);
  tickImpact(scene, s);
  tickZoom(scene, s, now);
  tickBorder(scene, s, now);
}

// ---------------------------------------------------------------- squash & stretch

function squashPart(scene: Phaser.Scene, s: JuiceState, e: DamageEvent, now: number): void {
  const sprite = ragdollOf(scene)?.parts.get(e.part)?.sprite;
  if (!sprite) return;
  const old = s.squashes.find((q) => q.sprite === sprite);
  if (old) old.start = now;
  else s.squashes.push({ sprite, start: now });
}

function tickSquash(s: JuiceState, now: number): void {
  let w = 0;
  for (const q of s.squashes) {
    if (!q.sprite.active) continue;
    const f = Math.floor((now - q.start) / JUICE.squashFrameMs);
    const step = JUICE.squash[f];
    if (!step) {
      q.sprite.setScale(1);
      continue;
    }
    q.sprite.setScale(step[0], step[1]);
    s.squashes[w++] = q;
  }
  s.squashes.length = w;
}

// ---------------------------------------------------------------- scritte fumetto

function comicWord(scene: Phaser.Scene, s: JuiceState, e: DamageEvent, now: number): void {
  if (now - s.lastWordAt < JUICE.wordMinGapMs) return;
  let word = s.words.find((w) => !w.live);
  if (!word) {
    if (s.words.length < JUICE.maxWords) {
      word = {
        burst: scene.add.image(0, 0, '__DEFAULT').setDepth(68),
        text: scene.add.bitmapText(0, 0, ensurePixelFont(scene, C.white), '').setDepth(70),
        frames: [],
        start: 0,
        x: 0,
        y: 0,
        rot: 0,
        live: false,
      };
      word.text.setLetterSpacing(-1).setOrigin(0.5);
      s.words.push(word);
    } else {
      // tetto raggiunto: ricicla la scritta più vecchia
      word = s.words.reduce((a, b) => (a.start <= b.start ? a : b));
    }
  }
  s.lastWordAt = now;
  const style = WORD_STYLES[s.styleIdx++ % WORD_STYLES.length];
  const label = normalizeText(e.crit && Math.random() < 0.3 ? 'CRIT!' : pickWord(e.weaponId));
  const size: BurstSize = label.length <= 5 ? 's' : 'l';
  word.frames = burstKeys(scene, size, style.burst, style.core);
  const textKey = ensurePixelFont(scene, style.text);
  if (word.text.font !== textKey) word.text.setFont(textKey);
  word.text.setText(label);
  // sopra il colpo, sempre dentro lo schermo e sotto l'HUD
  const halfW = Math.ceil(BURST_SIZES[size][0] / 2);
  const halfH = Math.ceil(BURST_SIZES[size][1] / 2);
  word.x = Math.round(Phaser.Math.Clamp(e.x, halfW + 1, SCREEN.width - halfW - 1));
  word.y = Math.round(Phaser.Math.Clamp(e.y - 50, 20 + halfH, SCREEN.height - 40 - halfH));
  const steps = Math.round(JUICE.wordRotMax / JUICE.wordRotStep);
  const k = Phaser.Math.Between(1, steps) * (Math.random() < 0.5 ? -1 : 1);
  word.rot = k * JUICE.wordRotStep;
  word.start = now;
  word.live = true;
  playWordSwoosh();
}

function tickWords(s: JuiceState, now: number): void {
  for (const w of s.words) {
    if (!w.live) continue;
    const age = now - w.start;
    const k = age / JUICE.wordMs;
    if (k >= 1 || !w.text.active) {
      w.live = false;
      w.burst.setVisible(false);
      w.text.setVisible(false);
      continue;
    }
    // pop a scatti: scala 3 → 2, rotazione dimezzata (quantizzata) al secondo frame
    const popF = Math.floor(age / JUICE.wordPopFrameMs);
    const scale = popF === 0 ? 3 : 2;
    const half = Math.trunc(w.rot / JUICE.wordRotStep / 2) * JUICE.wordRotStep;
    const rot = popF === 0 ? w.rot : half;
    // tremolio di 1px a scatti (cambia ogni 2 frame)
    let dx = 0;
    let dy = 0;
    if (k >= JUICE.wordShakeFrom) {
      const t = Math.floor(age / 33);
      dx = (t % 3) - 1;
      dy = ((t >> 1) % 2) * (t % 2 === 0 ? 1 : -1);
    }
    const visible = k < JUICE.wordBlinkFrom || Math.floor(age / 50) % 2 === 0;
    const bf = age < JUICE.wordBurstFrameMs ? 0 : 1 + (Math.floor(age / JUICE.wordBurstFrameMs) % 2);
    const x = w.x + dx;
    const y = w.y + dy;
    w.burst
      .setTexture(w.frames[bf])
      .setPosition(x, y)
      .setRotation(rot)
      .setScale(popF === 0 ? 1.25 : 1)
      .setVisible(visible);
    w.text.setScale(scale).setRotation(rot).setPosition(x, y).setVisible(visible);
  }
}

// ---------------------------------------------------------------- linee d'impatto

function speedLines(s: JuiceState, e: DamageEvent, now: number): void {
  if (s.lines.length >= JUICE.maxSpeedLines) s.lines.shift();
  const n = JUICE.speedLineCount;
  const off = Math.random() * Math.PI * 2;
  const angles: number[] = [];
  const lens: number[] = [];
  for (let i = 0; i < n; i++) {
    angles.push(off + (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.3);
    lens.push(Phaser.Math.Between(JUICE.speedLineLen[0], JUICE.speedLineLen[1]));
  }
  s.lines.push({ x: Math.round(e.x), y: Math.round(e.y), start: now, angles, lens });
}

function tickLines(scene: Phaser.Scene, s: JuiceState, now: number): void {
  // al massimo 2 frame per raggiera
  s.lines = s.lines.filter((l) => now - l.start < JUICE.speedLineFrameMs * 2);
  if (s.lines.length === 0) {
    if (s.linesDirty && s.linesG) s.linesG.clear();
    s.linesDirty = false;
    return;
  }
  if (!s.linesG || !s.linesG.scene) {
    s.linesG = scene.add.graphics().setDepth(52);
    // creato dentro PRE_RENDER, dopo il depthSort di questo frame: riordina subito
    scene.children.depthSort();
  }
  const g = s.linesG;
  g.clear();
  s.linesDirty = true;
  for (const l of s.lines) {
    const second = now - l.start >= JUICE.speedLineFrameMs;
    const r0 = JUICE.speedLineInner + (second ? 5 : 0);
    for (let i = 0; i < l.angles.length; i++) {
      const len = second ? Math.ceil(l.lens[i] * 0.5) : l.lens[i];
      const cx = Math.cos(l.angles[i]);
      const cy = Math.sin(l.angles[i]);
      g.fillStyle(col(i % 3 === 0 ? C.yellow : C.white), 1);
      for (let r = r0; r < r0 + len; r++) g.fillRect(Math.round(l.x + cx * r), Math.round(l.y + cy * r), 1, 1);
    }
  }
}

// ---------------------------------------------------------------- impact frame

function tickImpact(scene: Phaser.Scene, s: JuiceState): void {
  const parts = ragdollOf(scene)?.parts;
  if (s.impactLeft > 0) {
    if (!s.overlay || !s.overlay.scene) {
      // fra lo sfondo (depth <= 4) e Tony (depth 9..16); non segue scroll/shake
      s.overlay = scene.add
        .rectangle(-20, -20, SCREEN.width + 40, SCREEN.height + 40, col(C.black))
        .setOrigin(0)
        .setScrollFactor(0)
        .setDepth(8);
      scene.children.depthSort();
    }
    const i = Math.min(JUICE.impactFrames, 2) - s.impactLeft;
    s.overlay.setAlpha(JUICE.impactOverlayAlpha[i] ?? 0.8).setVisible(true);
    parts?.forEach((p) => p.sprite.setTintFill(col(C.white)));
    s.impactLeft--;
    s.impactShown = true;
  } else if (s.impactShown) {
    s.impactShown = false;
    s.overlay?.setVisible(false);
    parts?.forEach((p) => p.sprite.clearTint());
  }
}

// ---------------------------------------------------------------- punch-zoom

function punchZoom(scene: Phaser.Scene, s: JuiceState, now: number): void {
  const cam = scene.cameras.main;
  // non toccare gli zoom di altri (passaggio in galleria): solo da 1, origine al centro
  if (s.zoomStart >= 0 || cam.zoom !== 1 || cam.originX !== 0.5 || cam.originY !== 0.5) return;
  s.zoomStart = now;
  s.zoomSet = 1;
}

function tickZoom(scene: Phaser.Scene, s: JuiceState, now: number): void {
  if (s.zoomStart < 0) return;
  const cam = scene.cameras.main;
  if (cam.zoom !== s.zoomSet) {
    s.zoomStart = -1; // qualcun altro ha cambiato lo zoom: lascia stare
    return;
  }
  const f = Math.floor((now - s.zoomStart) / JUICE.zoomStepMs);
  const z = JUICE.zoomSteps[Math.min(f, JUICE.zoomSteps.length - 1)];
  if (z !== cam.zoom) cam.setZoom(z);
  s.zoomSet = z;
  if (f >= JUICE.zoomSteps.length - 1) {
    cam.setZoom(1);
    s.zoomStart = -1;
  }
}

// ---------------------------------------------------------------- cornice dei critici (scena UI)

function tickBorder(scene: Phaser.Scene, s: JuiceState, now: number): void {
  const f = Math.floor((now - s.borderStart) / JUICE.borderFrameMs);
  const on = f >= 0 && f < JUICE.borderFrames;
  if (!on) {
    if (s.borderShown && s.borderG?.scene) s.borderG.clear();
    s.borderShown = false;
    return;
  }
  const ui = scene.scene.get('UI');
  if (!ui || !ui.sys.isActive()) return;
  if (!s.borderG || s.borderG.scene !== ui) s.borderG = ui.add.graphics().setDepth(1000);
  const g = s.borderG;
  const p = JUICE.borderPx;
  const w = SCREEN.width;
  const h = SCREEN.height;
  g.clear().setVisible(true);
  g.fillStyle(col(f % 2 === 0 ? C.red : C.yellow), 1);
  g.fillRect(0, 0, w, p).fillRect(0, h - p, w, p).fillRect(0, p, p, h - 2 * p).fillRect(w - p, p, p, h - 2 * p);
  s.borderShown = true;
}

// ---------------------------------------------------------------- audio

let lastDing = -1e9;
let lastSwoosh = -1e9;

/** Critico: botta sporca + "ding" acuto. */
function playCritSound(): void {
  const t = performance.now();
  if (t - lastDing < 90) return;
  lastDing = t;
  const v = JUICE.dingVol;
  noise({ dur: 0.12, vol: v * 2, freq: 900, freqTo: 120 });
  tone({ type: 'sawtooth', from: 170, to: 45, dur: 0.16, vol: v * 1.4 });
  tone({ type: 'square', from: 1568, dur: 0.06, vol: v, delay: 0.03 });
  tone({ type: 'square', from: 2093, to: 2000, dur: 0.18, vol: v, delay: 0.08 });
}

/** Scritta fumetto: soffio rapido che sale. */
function playWordSwoosh(): void {
  const t = performance.now();
  if (t - lastSwoosh < 120) return;
  lastSwoosh = t;
  noise({ dur: 0.11, vol: JUICE.swooshVol, freq: 500, freqTo: 4000, highpass: true });
}

// ---------------------------------------------------------------- monete che volano (scena UI)

interface FlyingCoin {
  img: Phaser.GameObjects.Image;
  start: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface FlyingCoinsOpts {
  /** centro dell'icona del contatore (coordinate della scena UI) */
  x: number;
  y: number;
  /** chiamata a ogni moneta arrivata: il contatore fa il "bump" */
  onArrive: () => void;
  texture?: string;
}

/**
 * Quando si guadagnano monete, 1..JUICE.maxCoinsPerGain monetine partono
 * dal punto dell'ultimo colpo e volano a scatti verso il contatore della UI.
 * Da chiamare nella create() della scena UI; ritorna la funzione per staccarle.
 */
export function bindFlyingCoins(ui: Phaser.Scene, opts: FlyingCoinsOpts): () => void {
  const flying: FlyingCoin[] = [];
  const key = opts.texture ?? 'ui-coin';
  let lastSeen: DamageEvent | undefined = events.peek('damage');
  let lastSeenAt = -1e9;

  const origin = (): { x: number; y: number } => {
    const d = events.peek('damage');
    // economy emette 'coins:changed' DENTRO l'emissione di 'damage': se il colpo
    // in corso non l'abbiamo ancora visto, è quello che ha fatto le monete
    const fresh = !!d && (d !== lastSeen || ui.time.now - lastSeenAt <= JUICE.coinOriginMaxAgeMs);
    if (!d || !fresh) return { x: SCREEN.width / 2, y: SCREEN.height / 2 };
    const game = ui.scene.get('Game');
    const cam = game?.cameras?.main;
    if (!cam) return { x: d.x, y: d.y };
    // mondo di Game → schermo (stessa risoluzione; conta shake e punch-zoom)
    const ox = cam.width * cam.originX;
    const oy = cam.height * cam.originY;
    return { x: (d.x - cam.scrollX - ox) * cam.zoom + ox, y: (d.y - cam.scrollY - oy) * cam.zoom + oy };
  };

  const offDamage = events.on('damage', (e) => {
    lastSeen = e;
    lastSeenAt = ui.time.now;
  });
  const offCoins = events.on('coins:changed', (e) => {
    if (e.delta <= 0) return;
    const o = origin();
    const n = Phaser.Math.Clamp(Math.ceil(e.delta), 1, JUICE.maxCoinsPerGain);
    const now = ui.time.now;
    for (let i = 0; i < n; i++) {
      if (flying.length >= JUICE.maxFlyingCoins) {
        opts.onArrive();
        continue;
      }
      const x0 = o.x + Phaser.Math.Between(-6, 6);
      const y0 = o.y + Phaser.Math.Between(-6, 2);
      const img = acquireImage(ui, x0, y0, key).setDepth(900).setVisible(false);
      flying.push({
        img,
        start: now + i * JUICE.coinStaggerMs,
        x0,
        y0,
        x1: x0 + Phaser.Math.Between(-30, 30),
        y1: y0 - Phaser.Math.Between(30, 50),
      });
    }
  });

  const onUpdate = () => {
    const now = ui.time.now;
    let w = 0;
    for (const c of flying) {
      if (!c.img.active) continue;
      const el = now - c.start;
      if (el < 0) {
        flying[w++] = c;
        continue;
      }
      // a scatti: il tempo avanza a passi di JUICE.coinStepMs
      const t = (Math.floor(el / JUICE.coinStepMs) * JUICE.coinStepMs) / JUICE.coinFlyMs;
      if (t >= 1) {
        releaseImage(c.img);
        opts.onArrive();
        continue;
      }
      const u = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
      const a = (1 - u) * (1 - u);
      const b = 2 * (1 - u) * u;
      const cc = u * u;
      c.img
        .setPosition(Math.round(a * c.x0 + b * c.x1 + cc * opts.x), Math.round(a * c.y0 + b * c.y1 + cc * opts.y))
        .setVisible(true);
      // scintilla: un frame bianco ogni 4 passi
      if (Math.floor(el / JUICE.coinStepMs) % 4 === 3) c.img.setTintFill(col(C.white));
      else c.img.clearTint();
      flying[w++] = c;
    }
    flying.length = w;
  };
  ui.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);

  return () => {
    offDamage();
    offCoins();
    ui.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
    for (const c of flying) releaseImage(c.img);
    flying.length = 0;
  };
}
