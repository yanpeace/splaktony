import Phaser from 'phaser';
import { SCREEN, SHOP } from '../config/balance';
import { C, col, type ColorIndex } from '../config/palette';
import { playBuy, playClick, playError, playLevelUp } from '../audio/sfx';
import type { Ragdoll } from '../entities/Ragdoll';
import { formatCompact, pixelText, setPixelText } from '../gfx/pixelFont';
import { makeSprite } from '../gfx/pixelSprite';
import { ArcadeButton, drawPanel } from '../gfx/ui';
import { buyWeapon, economy, isWeaponOwned, upgradeWeapon, weaponLevel } from '../systems/economy';
import { events, Subscriptions } from '../systems/events';
import { upgradeCost, weaponPrice } from '../systems/upgrades';
import { bindRelayout } from '../systems/screenWatch';
import { WEAPON_REGISTRY, type WeaponEntry } from '../weapons/registry';
import type { WeaponContext } from '../weapons/Weapon';

type GO = Phaser.GameObjects.GameObject;
type Content = Phaser.GameObjects.Container;

// ------------------------------------------------------------ dati delle armi

interface WeaponMeta {
  id: string;
  name: string;
  /** texture dell'icona, o null se l'arma non si è lasciata istanziare */
  iconKey: string | null;
  iconW: number;
  iconH: number;
}

const metaCache = new Map<string, WeaponMeta>();

/** Oggetto "inerte": ogni proprietà o chiamata ritorna se stesso (niente effetti). */
const inert: unknown = new Proxy(function inertFn() {}, {
  get: (_t, key) => (key === 'then' ? undefined : key === Symbol.toPrimitive ? () => 0 : inert),
  apply: () => inert,
  construct: () => inert as object,
});

/**
 * Contesto finto per istanziare un'arma solo per leggerne id/nome/icona:
 * della scena è reale solo il texture manager (serve a ensureIcon), tutto il
 * resto (ragdoll, add, matter, time...) è inerte, così un costruttore con
 * side effect non tocca né il negozio né la partita.
 */
function metaContext(scene: Phaser.Scene): WeaponContext {
  const fakeScene = new Proxy(scene, {
    get: (target, key) => (key === 'textures' ? target.textures : inert),
  });
  return { scene: fakeScene, ragdoll: inert as Ragdoll, dealDamage: () => 0 };
}

function weaponMeta(scene: Phaser.Scene, entry: WeaponEntry): WeaponMeta {
  const cached = metaCache.get(entry.id);
  if (cached) return cached;
  let meta: WeaponMeta = { id: entry.id, name: entry.id.toUpperCase(), iconKey: null, iconW: 0, iconH: 0 };
  try {
    const w = entry.create(metaContext(scene));
    const key = w.ensureIcon();
    const frame = scene.textures.getFrame(key);
    meta = { id: entry.id, name: w.name, iconKey: key, iconW: frame.width, iconH: frame.height };
  } catch (err) {
    console.warn(`Shop: impossibile leggere i dati dell'arma "${entry.id}"`, err);
  }
  metaCache.set(entry.id, meta);
  return meta;
}

// ------------------------------------------------------------ layout

const ROW_X = 3;
const ROW_W = SCREEN.width - 6;
const ROW_H = 40;
const ROW_GAP = 2;
const ICON_BOX = 24;
const UP_W = 52;
const UP_H = 14;
/**
 * Righe verticali dallo schermo attuale (SCREEN cambia dal vivo: layoutShop()
 * a ogni create). In alto sotto il notch; il piede si ancora al bordo basso.
 */
let HEAD_Y = 0;
let LIST_Y = 0;
let FOOT_Y = 0;
let TOAST_Y = 0;
let PAGE_Y = 0;
/** righe per pagina: quante ne entrano tra intestazione e piede (6 su 180x320, di più sugli schermi lunghi) */
let PER_PAGE = 6;

function layoutShop(): void {
  HEAD_Y = SCREEN.safeTop + 3;
  LIST_Y = HEAD_Y + 17;
  FOOT_Y = SCREEN.height - SCREEN.safeBottom - 20;
  TOAST_Y = FOOT_Y - 24;
  PAGE_Y = FOOT_Y - 12;
  PER_PAGE = Math.max(6, Math.floor((TOAST_Y - 3 - LIST_Y + ROW_GAP) / (ROW_H + ROW_GAP)));
}

/**
 * Allinea l'area di tocco di un ArcadeButton al riquadro disegnato.
 * Phaser somma displayOrigin (= metà dimensione per i Container) alle
 * coordinate locali, quindi il Rectangle(0, 0, w, h + 1) di ArcadeButton
 * risulta spostato di mezzo pulsante in alto a sinistra. Impostazione
 * assoluta: resta corretta anche se gfx/ui.ts verrà corretto.
 */
export function alignButtonHit<T extends ArcadeButton>(btn: T): T {
  const area = btn.input?.hitArea as Phaser.Geom.Rectangle | undefined;
  area?.setTo(btn.displayOriginX, btn.displayOriginY, btn.width, btn.height + 1);
  return btn;
}

/** Testo centrato su (0,0) con offset interi, da usare come contenuto di ArcadeButton. */
function centeredText(scene: Phaser.Scene, text: string, color: ColorIndex | number): Content {
  const t = pixelText(scene, 0, 0, text, color);
  t.setPosition(-Math.floor(t.width / 2), -4);
  return scene.add.container(0, 0, [t]);
}

/**
 * Negozio arcade: scena sovrapposta a Game/UI (lanciata da UI con
 * scene.launch('Shop')). Un fondo interattivo a schermo pieno blocca i tocchi
 * verso le scene sotto. Lista armi da WEAPON_REGISTRY, a pagine.
 */
export class Shop extends Phaser.Scene {
  private subs = new Subscriptions();
  private page = 0;
  private pages = 1;
  private pageObjs: GO[] = [];
  private selectedId = '';
  private dirty = true;
  private affordSig = '';
  private toast!: Phaser.GameObjects.BitmapText;
  private toastTimer: Phaser.Time.TimerEvent | null = null;
  private pageText: Phaser.GameObjects.BitmapText | null = null;

  constructor() {
    super('Shop');
  }

  create(): void {
    layoutShop();
    this.pageObjs = [];
    this.dirty = true;
    this.affordSig = '';
    this.toastTimer = null;
    this.pageText = null;
    this.pages = Math.max(1, Math.ceil(WEAPON_REGISTRY.length / PER_PAGE));

    // fondo: retino 50% nero (resta in palette) + zona che assorbe i tocchi
    makeSprite(this, 'shop-dither', ['0.', '.0']);
    this.add.tileSprite(0, 0, SCREEN.width, SCREEN.height, 'shop-dither').setOrigin(0);
    this.add.zone(0, 0, SCREEN.width, SCREEN.height).setOrigin(0).setInteractive();

    // intestazione: titolo + monete + chiudi
    const g = this.add.graphics();
    drawPanel(g, 3, HEAD_Y, 152, 13);
    pixelText(this, 6, HEAD_Y + 2, 'NEGOZIO', C.yellow);
    this.add.image(91, HEAD_Y + 3, 'ui-coin').setOrigin(0);
    const coinText = pixelText(this, 152, HEAD_Y + 2, '0', C.yellow).setOrigin(1, 0);
    alignButtonHit(new ArcadeButton(this, 158, HEAD_Y, {
      w: 19,
      h: 13,
      fill: C.red,
      content: centeredText(this, 'X', C.white),
      onClick: () => this.close(),
    }));

    // piede: pagine + chiudi, su una fascia piena (il retino resta solo dietro la lista)
    g.fillStyle(col(C.black));
    g.fillRect(0, TOAST_Y - 3, SCREEN.width, SCREEN.height - (TOAST_Y - 3));
    g.fillStyle(col(C.charcoal));
    g.fillRect(0, TOAST_Y - 3, SCREEN.width, 1);
    alignButtonHit(new ArcadeButton(this, 60, FOOT_Y, {
      w: 60,
      h: 15,
      content: centeredText(this, 'CHIUDI', C.white),
      onClick: () => this.close(),
    }));
    if (this.pages > 1) {
      alignButtonHit(new ArcadeButton(this, 3, FOOT_Y, {
        w: 30,
        h: 15,
        content: centeredText(this, '<', C.white),
        onClick: () => this.turnPage(-1),
      }));
      alignButtonHit(new ArcadeButton(this, SCREEN.width - 33, FOOT_Y, {
        w: 30,
        h: 15,
        content: centeredText(this, '>', C.white),
        onClick: () => this.turnPage(1),
      }));
      this.pageText = pixelText(this, 0, PAGE_Y, '', C.silver);
    }

    this.toast = pixelText(this, 0, TOAST_Y, '', C.red).setVisible(false);

    this.subs
      .on(
        'weapon:selected',
        (e) => {
          this.selectedId = e.weaponId;
          this.dirty = true;
        },
        true,
      )
      .on(
        'coins:changed',
        (e) => {
          setPixelText(coinText, formatCompact(e.coins));
          // ricostruisci solo se cambia cosa ci si può permettere
          if (this.affordabilitySignature() !== this.affordSig) this.dirty = true;
        },
        true,
      )
      .on('weapon:bought', () => (this.dirty = true))
      .on('weapon:upgraded', () => (this.dirty = true));

    // apri sulla pagina dell'arma in uso
    const idx = WEAPON_REGISTRY.findIndex((w) => w.id === this.selectedId);
    this.page = idx > 0 ? Math.floor(idx / PER_PAGE) : 0;

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.subs.clear();
      this.toastTimer?.remove();
    });
    // schermo cambiato: negozio rifatto con le misure nuove (righe per pagina comprese)
    bindRelayout(this, () => this.scene.restart());
    this.renderPage();
  }

  update(): void {
    // le ricostruzioni avvengono qui, mai dentro l'handler di un pulsante
    if (this.dirty) this.renderPage();
  }

  private close(): void {
    this.scene.stop();
  }

  private turnPage(dir: number): void {
    this.page = (this.page + dir + this.pages) % this.pages;
    this.dirty = true;
  }

  private visibleEntries(): WeaponEntry[] {
    return WEAPON_REGISTRY.slice(this.page * PER_PAGE, (this.page + 1) * PER_PAGE);
  }

  /** Stringa che cambia quando cambia l'accessibilità di un acquisto visibile. */
  private affordabilitySignature(): string {
    return this.visibleEntries()
      .map((e) => {
        const cost = isWeaponOwned(e.id) ? upgradeCost(e.id, weaponLevel(e.id)) : weaponPrice(e.id);
        return economy.canAfford(cost) ? '1' : '0';
      })
      .join('');
  }

  private renderPage(): void {
    this.dirty = false;
    this.pageObjs.forEach((o) => o.destroy());
    this.pageObjs = [];
    this.page = Math.min(this.page, this.pages - 1);
    this.visibleEntries().forEach((entry, i) => this.buildRow(entry, LIST_Y + i * (ROW_H + ROW_GAP)));
    this.affordSig = this.affordabilitySignature();
    if (this.pageText) {
      setPixelText(this.pageText, `${this.page + 1}/${this.pages}`);
      this.pageText.x = Math.floor(SCREEN.width / 2) - Math.floor(this.pageText.width / 2);
    }
  }

  private buildRow(entry: WeaponEntry, y: number): void {
    const meta = weaponMeta(this, entry);
    const id = entry.id;
    const owned = isWeaponOwned(id);
    const inUse = owned && id === this.selectedId;
    const level = weaponLevel(id);
    const price = weaponPrice(id);

    // il contenuto di ArcadeButton è centrato: lavoro in coordinate locali al riquadro
    const ox = -Math.floor(ROW_W / 2);
    const oy = -Math.floor((ROW_H - 1) / 2);
    const parts: GO[] = [];

    const g = this.add.graphics();
    drawPanel(g, ox + 4, oy + 4, ICON_BOX, ICON_BOX, { fill: C.black, border: C.black, highlight: null });
    if (owned) {
      for (let i = 0; i < SHOP.maxLevel; i++) {
        drawPanel(g, ox + 32 + i * 8, oy + 28, 7, 6, {
          fill: i < level ? C.lime : C.charcoal,
          border: C.black,
          highlight: null,
        });
      }
    }
    parts.push(g);

    if (meta.iconKey) {
      const s = Math.max(1, Math.min(2, Math.floor((ICON_BOX - 4) / Math.max(meta.iconW, meta.iconH))));
      const ix = ox + 4 + Math.floor((ICON_BOX - meta.iconW * s) / 2);
      const iy = oy + 4 + Math.floor((ICON_BOX - meta.iconH * s) / 2);
      parts.push(this.add.image(ix, iy, meta.iconKey).setOrigin(0).setScale(s));
    }

    parts.push(pixelText(this, ox + 32, oy + 4, meta.name, C.white));
    const state = inUse ? 'IN USO' : owned ? 'COMPRATA' : 'BLOCCATA';
    parts.push(pixelText(this, ox + 32, oy + 14, state, inUse ? C.lime : owned ? C.cyan : C.orange));

    const canBuy = economy.canAfford(price);
    if (!owned) {
      parts.push(this.add.image(ox + 32, oy + 28, 'ui-coin').setOrigin(0));
      parts.push(pixelText(this, ox + 41, oy + 27, formatCompact(price), canBuy ? C.yellow : C.red));
    }
    const hint = inUse ? '' : owned ? 'USA' : 'COMPRA';
    if (hint) {
      const t = pixelText(this, 0, oy + 4, hint, owned ? C.white : canBuy ? C.yellow : C.silver);
      t.x = ox + ROW_W - 5 - t.width;
      parts.push(t);
    }
    if (owned && level >= SHOP.maxLevel) {
      const t = pixelText(this, 0, oy + 26, 'MAX', C.yellow);
      t.x = ox + ROW_W - 5 - t.width;
      parts.push(t);
    }

    const row = alignButtonHit(new ArcadeButton(this, ROW_X, y, {
      w: ROW_W,
      h: ROW_H,
      fill: inUse ? C.teal : owned ? C.slate : C.charcoal,
      content: this.add.container(0, 0, parts),
      sound: false,
      onClick: () => this.onRowTap(id, meta.name, row),
    }));
    this.pageObjs.push(row);

    if (owned && level < SHOP.maxLevel) this.buildUpgradeButton(id, meta.name, level, y);
  }

  private buildUpgradeButton(id: string, name: string, level: number, rowY: number): void {
    const cost = upgradeCost(id, level);
    const can = economy.canAfford(cost);
    const plus = pixelText(this, 0, -4, '+', C.white);
    const coin = this.add.image(0, -3, 'ui-coin').setOrigin(0);
    const label = pixelText(this, 0, -4, formatCompact(cost), can ? C.yellow : C.red);
    const total = plus.width + 1 + coin.width + 1 + label.width;
    plus.x = -Math.floor(total / 2);
    coin.x = plus.x + plus.width + 1;
    label.x = coin.x + coin.width + 1;
    const btn = alignButtonHit(new ArcadeButton(this, ROW_X + ROW_W - 4 - UP_W, rowY + 23, {
      w: UP_W,
      h: UP_H,
      fill: can ? C.green : C.charcoal,
      content: this.add.container(0, 0, [plus, coin, label]),
      sound: false,
      onClick: () => {
        const r = upgradeWeapon(id);
        if (r === 'ok') {
          playLevelUp();
          this.showToast(`${name} LV ${weaponLevel(id)}!`, C.lime);
        } else if (r === 'poor') {
          playError();
          this.showToast('MONETE INSUFFICIENTI', C.red);
          this.wobble(btn);
        }
      },
    }));
    this.pageObjs.push(btn);
  }

  private onRowTap(id: string, name: string, row: ArcadeButton): void {
    if (isWeaponOwned(id)) {
      playClick();
      if (id !== this.selectedId) events.emit('weapon:request', { weaponId: id });
      return;
    }
    const r = buyWeapon(id);
    if (r === 'ok') {
      playBuy();
      this.showToast(`${name} COMPRATA!`, C.lime);
      events.emit('weapon:request', { weaponId: id });
    } else if (r === 'poor') {
      playError();
      this.showToast('MONETE INSUFFICIENTI', C.red);
      this.wobble(row);
    }
  }

  private showToast(text: string, color: ColorIndex): void {
    this.toast.destroy();
    this.toast = pixelText(this, 0, TOAST_Y, text, color);
    this.toast.x = Math.floor(SCREEN.width / 2) - Math.floor(this.toast.width / 2);
    this.toastTimer?.remove();
    this.toastTimer = this.time.delayedCall(SHOP.toastMs, () => this.toast.setVisible(false));
  }

  /** Scuote un oggetto di 1px a destra/sinistra (feedback "non puoi"). */
  private wobble(obj: Phaser.GameObjects.Container): void {
    const x0 = obj.x;
    const offs = [1, -1, 1, -1, 0];
    let i = 0;
    this.time.addEvent({
      delay: 35,
      repeat: offs.length - 1,
      callback: () => {
        if (obj.active) obj.x = x0 + offs[i++];
      },
    });
  }
}
