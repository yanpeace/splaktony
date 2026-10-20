import Phaser from 'phaser';
import { MENU, SCREEN } from '../config/balance';
import { C, col, type ColorIndex } from '../config/palette';
import { ensurePixelFont, pixelText, setPixelText } from '../gfx/pixelFont';
import { ArcadeButton, drawPanel } from '../gfx/ui';
import { events, Subscriptions } from '../systems/events';
import { getSave } from '../systems/save';
import { bindRelayout } from '../systems/screenWatch';

/**
 * Impostazioni: audio (via evento 'settings:changed', lo salva save.ts),
 * vibrazione e scanline CRT (salvate qui, chiave LOCAL_SETTINGS_KEY).
 *
 * Funzioni globali da chiamare UNA volta all'avvio:
 *   initLocalSettings()      applica la scanline e registra la vibrazione
 *   registerServiceWorker()  solo in produzione (PWA)
 *
 * Scena sovrapposta: this.scene.launch('Settings', { from: 'Menu' }).
 * La scena chiamante riceve di nuovo l'input quando si chiude.
 */

// ------------------------------------------------------------ impostazioni locali

export const LOCAL_SETTINGS_KEY = 'splaktony.settings';
const LOCAL_SETTINGS_VERSION = 1;

export interface LocalSettings {
  vibration: boolean;
  scanline: boolean;
}

const DEFAULT_LOCAL: LocalSettings = { vibration: true, scanline: true };

let local: LocalSettings | null = null;

function readLocal(): LocalSettings {
  try {
    const txt = localStorage.getItem(LOCAL_SETTINGS_KEY);
    if (!txt) return { ...DEFAULT_LOCAL };
    const raw = JSON.parse(txt) as Partial<LocalSettings> & { version?: number };
    return {
      vibration: typeof raw.vibration === 'boolean' ? raw.vibration : DEFAULT_LOCAL.vibration,
      scanline: typeof raw.scanline === 'boolean' ? raw.scanline : DEFAULT_LOCAL.scanline,
    };
  } catch {
    return { ...DEFAULT_LOCAL };
  }
}

export function getLocalSettings(): LocalSettings {
  if (!local) local = readLocal();
  return local;
}

export function patchLocalSettings(patch: Partial<LocalSettings>): LocalSettings {
  local = { ...getLocalSettings(), ...patch };
  try {
    localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify({ version: LOCAL_SETTINGS_VERSION, ...local }));
  } catch (err) {
    console.warn('settings: impossibile scrivere', err);
  }
  applyScanline(local.scanline);
  return local;
}

/** Overlay CSS #crt sopra il canvas (vedi index.html): acceso con la classe body.crt */
export function applyScanline(on: boolean): void {
  document.body.classList.toggle('crt', on);
}

let vibrationBound = false;

/** Vibrazione sui colpi forti. Registrata una sola volta, a livello globale. */
export function initVibration(): void {
  if (vibrationBound) return;
  vibrationBound = true;
  events.on('damage', (e) => {
    if (!e.strong || !getLocalSettings().vibration) return;
    if (typeof navigator.vibrate !== 'function') return;
    try {
      navigator.vibrate(MENU.vibrateMs);
    } catch {
      /* non supportata: ignora */
    }
  });
}

/** Da chiamare all'avvio (Boot): scanline + vibrazione. */
export function initLocalSettings(): void {
  applyScanline(getLocalSettings().scanline);
  initVibration();
}

/** Registra il service worker solo nella build di produzione. */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('sw: registrazione fallita', err));
  });
}

// ------------------------------------------------------------ scena

interface SettingsData {
  /** scena sotto: le si toglie l'input finché le impostazioni sono aperte */
  from?: string;
}

interface Toggle {
  set(on: boolean): void;
}

/** riquadro centrato in verticale anche sugli schermi lunghi (y ricalcolata a ogni create) */
const PANEL = { x: 18, y: 64, w: 144, h: 168 };
const PANEL_BASE_Y = 64;

export class Settings extends Phaser.Scene {
  private subs = new Subscriptions();
  private from: string | null = null;

  constructor() {
    super('Settings');
  }

  init(data: SettingsData): void {
    this.from = data?.from ?? null;
  }

  create(): void {
    PANEL.y = PANEL_BASE_Y + Math.round(SCREEN.extra / 2);
    if (this.from) this.scene.get(this.from).input.enabled = false;

    // fondo che oscura e blocca i tocchi sulla scena sotto
    this.add
      .rectangle(0, 0, SCREEN.width, SCREEN.height, col(C.black), 0.75)
      .setOrigin(0)
      .setInteractive();

    const g = this.add.graphics();
    drawPanel(g, PANEL.x, PANEL.y, PANEL.w, PANEL.h, { fill: C.navy, highlight: C.blue, shadow: C.black });
    drawPanel(g, PANEL.x + 4, PANEL.y + 4, PANEL.w - 8, 15, { fill: C.plum, highlight: C.red });
    pixelText(this, SCREEN.width / 2, PANEL.y + 7, 'IMPOSTAZIONI', C.yellow).setOrigin(0.5, 0);

    const rowX = PANEL.x + 8;
    const btnX = PANEL.x + PANEL.w - 8 - 38;
    let y = PANEL.y + 30;

    // --- audio (stato condiviso via evento; save.ts e sfx ascoltano)
    const audio = this.toggleRow(rowX, btnX, y, 'AUDIO', () => {
      const prev = events.peek('settings:changed') ?? getSave().settings;
      events.emit('settings:changed', { ...prev, muted: !prev.muted });
    });
    this.subs.on('settings:changed', (s) => audio.set(!s.muted), true);
    if (!events.peek('settings:changed')) audio.set(!getSave().settings.muted);
    y += 26;

    // --- vibrazione
    const vib = this.toggleRow(rowX, btnX, y, 'VIBRAZIONE', () => {
      const on = !getLocalSettings().vibration;
      patchLocalSettings({ vibration: on });
      vib.set(on);
      if (on && typeof navigator.vibrate === 'function') navigator.vibrate(MENU.vibrateMs);
    });
    vib.set(getLocalSettings().vibration);
    if (typeof navigator.vibrate !== 'function') {
      pixelText(this, rowX, y + 14, 'NON SUPPORTATA', C.slate);
    }
    y += 26;

    // --- scanline CRT
    const crt = this.toggleRow(rowX, btnX, y, 'SCANLINE', () => {
      const on = !getLocalSettings().scanline;
      patchLocalSettings({ scanline: on });
      crt.set(on);
    });
    crt.set(getLocalSettings().scanline);

    // --- indietro
    new ArcadeButton(this, SCREEN.width / 2 - 45, PANEL.y + PANEL.h - 30, {
      w: 90,
      h: 19,
      fill: C.red,
      content: pixelText(this, 0, 0, '< INDIETRO', C.white).setOrigin(0.5),
      onClick: () => this.close(),
    });

    this.input.keyboard?.once('keydown-ESC', () => this.close());

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.subs.clear();
      if (this.from && this.scene.manager.isActive(this.from)) this.scene.get(this.from).input.enabled = true;
    });
    // schermo cambiato: pannello rifatto con le misure nuove
    bindRelayout(this, () => this.scene.restart({ from: this.from ?? undefined } satisfies SettingsData));
  }

  private close(): void {
    this.scene.stop();
  }

  /** Riga etichetta + pulsante ON/OFF con colore di stato. */
  private toggleRow(x: number, btnX: number, y: number, label: string, onClick: () => void): Toggle {
    pixelText(this, x, y + 3, label, C.white);
    const text = pixelText(this, 0, 0, 'OFF', C.silver).setOrigin(0.5);
    const btn = new ArcadeButton(this, btnX, y, { w: 38, h: 15, content: text, onClick });
    return {
      set: (on: boolean) => {
        const color: ColorIndex = on ? C.white : C.silver;
        text.setFont(ensurePixelFont(this, color));
        setPixelText(text, on ? 'ON' : 'OFF');
        btn.setFill(on ? C.green : C.charcoal);
      },
    };
  }
}
