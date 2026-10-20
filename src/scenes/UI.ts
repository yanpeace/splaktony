import Phaser from 'phaser';
import { HUD_MENU, JUICE, SCREEN } from '../config/balance';
import { C, col, type ColorIndex } from '../config/palette';
import { playClick } from '../audio/sfx';
import { bindFlyingCoins } from '../gfx/juice';
import { formatCompact, measureText, pixelText, setPixelText } from '../gfx/pixelFont';
import { ArcadeButton, drawPanel } from '../gfx/ui';
import { events, Subscriptions } from '../systems/events';
import { getSave } from '../systems/save';
import { bindRelayout } from '../systems/screenWatch';
import { WEAPON_REGISTRY } from '../weapons/registry';
import type { Game } from './Game';
import { alignButtonHit, weaponMeta } from './Shop';

type Content = Phaser.GameObjects.Container;
type MenuState = 'closed' | 'panel' | 'picker';

/**
 * HUD sovrapposto alla scena di gioco (scena separata, non trema con lo shake).
 * Legge lo stato SOLO dagli eventi (con replay per i valori già emessi).
 *
 * Il fondo dello schermo resta libero per Tony: arma, MENU, NEGOZIO e SPRITZ
 * stanno in un menu rapido che si apre dal pulsantino in alto a sinistra
 * (icona dell'arma attiva) e si richiude appena si torna a giocare.
 */
export class UI extends Phaser.Scene {
  private subs = new Subscriptions();
  private world = 1;
  private menuState: MenuState = 'closed';
  /** pannello o griglia aperti (uno solo alla volta) */
  private drawer: Content | null = null;
  private idleTimer: Phaser.Time.TimerEvent | null = null;
  private slideTimer: Phaser.Time.TimerEvent | null = null;
  private toggleArrow!: Phaser.GameObjects.Graphics;
  private toggleIcon!: Phaser.GameObjects.Image;
  private weaponId = '';
  private weaponName = '';
  private pickPage = 0;
  private spritzPercent = 0;
  /** SPRITZ mai provato: il pulsante (e il pulsantino del menu) lampeggiano */
  private spritzPulse = false;
  private spritzBtn: ArcadeButton | null = null;

  constructor() {
    super('UI');
  }

  create(): void {
    this.menuState = 'closed';
    this.drawer = null;
    this.idleTimer = null;
    this.slideTimer = null;
    this.spritzBtn = null;
    this.pickPage = 0;

    const g = this.add.graphics();
    // riga in alto sotto il notch: il fondo dello schermo resta tutto per Tony
    const top = SCREEN.safeTop;

    // --- danno totale
    drawPanel(g, 3, top + 3, 82, 13);
    pixelText(this, 6, top + 5, 'DANNO', C.silver);
    const dmgText = pixelText(this, 82, top + 5, '0', C.white).setOrigin(1, 0);

    // --- monete
    drawPanel(g, 88, top + 3, 67, 13);
    const coinIcon = this.add.image(91, top + 6, 'ui-coin').setOrigin(0);
    const coinText = pixelText(this, 152, top + 5, '0', C.yellow).setOrigin(1, 0);

    // --- audio on/off
    const icon = this.add.image(0, 0, 'ui-speaker-on');
    let muted = getSave().settings.muted;
    const muteBtn = new ArcadeButton(this, 158, top + 3, {
      w: 19,
      h: 13,
      content: icon,
      onClick: () => events.emit('settings:changed', { muted: !muted }),
    });

    // --- mondo (SPRITZ solo in galleria, mondi 2 e 3)
    const game = this.scene.get('Game') as Game | null;
    this.world = game?.world ?? 1;
    const sp = getSave().spritz;
    this.spritzPercent = sp.percent;
    this.spritzPulse = this.world !== 1 && sp.completed === 0 && sp.percent === 0;

    // --- menu rapido: pulsantino in alto a sinistra sotto "LV" (ProgressHUD)
    const toggleBtn = this.buildToggle(top);
    if (this.spritzPulse) {
      // finché SPRITZ non è mai stato provato il pulsantino (e SPRITZ nel pannello) pulsano
      this.time.addEvent({
        delay: HUD_MENU.pulseMs,
        loop: true,
        callback: () => {
          if (!this.spritzPulse) return;
          const on = Math.floor(this.time.now / HUD_MENU.pulseMs) % 2 === 1;
          toggleBtn.setFill(on ? C.orange : C.slate);
          this.spritzBtn?.setFill(on ? C.red : C.orange);
        },
      });
    }

    // tocco fuori dal menu (gioco sotto): chiude, e il tocco arriva comunque a Game
    this.input.on(
      Phaser.Input.Events.POINTER_DOWN,
      (_p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
        if (this.menuState !== 'closed' && over.length === 0) this.closeMenu();
      },
    );

    // --- suggerimento iniziale lampeggiante
    const hint = pixelText(this, SCREEN.width / 2, SCREEN.extra + 250, 'TOCCA TONY!', C.yellow).setOrigin(0.5, 0);
    const hint2 = pixelText(this, SCREEN.width / 2, SCREEN.extra + 261, 'TRASCINA E LANCIA', C.silver).setOrigin(0.5, 0);
    const blink = this.time.addEvent({
      delay: 400,
      loop: true,
      callback: () => hint.setVisible(!hint.visible),
    });
    const hideHint = () => {
      blink.remove();
      hint.destroy();
      hint2.destroy();
    };
    if (getSave().totalDamage > 0) hideHint();

    // --- eventi
    // monete che volano dal punto del colpo al contatore (gfx/juice): a ogni arrivo
    // "bump" di 2px del contatore e dell'icona, poi torna giù a scatti
    let bump: Phaser.Time.TimerEvent | null = null;
    const bumpCoins = () => {
      coinText.y = top + 3;
      coinIcon.y = top + 4;
      bump?.remove();
      bump = this.time.delayedCall(JUICE.coinBumpMs, () => {
        coinText.y = top + 4;
        coinIcon.y = top + 5;
        bump = this.time.delayedCall(JUICE.coinBumpMs, () => {
          coinText.y = top + 5;
          coinIcon.y = top + 6;
        });
      });
    };
    this.subs.add(bindFlyingCoins(this, { x: 94, y: top + 9, onArrive: bumpCoins }));
    this.subs
      .on('coins:changed', (e) => setPixelText(coinText, formatCompact(e.coins)), true)
      .on('damage:total', (e) => setPixelText(dmgText, formatCompact(e.total)), true)
      .on(
        'weapon:selected',
        (e) => {
          this.weaponId = e.weaponId;
          this.weaponName = e.name;
          this.setToggleIcon(e.iconKey);
          // pannello aperto: riga dell'arma aggiornata
          if (this.menuState === 'panel') this.openPanel(false);
        },
        true,
      )
      .on(
        'settings:changed',
        (s) => {
          muted = s.muted;
          icon.setTexture(muted ? 'ui-speaker-off' : 'ui-speaker-on');
          muteBtn.setFill(muted ? C.charcoal : C.slate);
        },
        true,
      )
      .on('spritz:progress', (e) => {
        this.spritzPercent = e.percent;
        if (this.spritzPulse) {
          this.spritzPulse = false;
          toggleBtn.setFill(C.slate);
        }
      })
      .on('spritz:done', () => (this.spritzPercent = 0))
      // si torna a giocare: il menu si chiude (gli urti di Tony da soli no)
      .on('damage', (e) => {
        if (e.weaponId !== 'impact') this.closeMenu();
      })
      .on('ragdoll:grab', () => this.closeMenu());

    let hintShown = hint.active;
    this.subs.on('damage', () => {
      if (!hintShown) return;
      hintShown = false;
      hideHint();
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.subs.clear());
    // schermo cambiato: HUD rifatta con le misure nuove (addormentata durante SPRITZ: al risveglio)
    bindRelayout(this, () => this.scene.restart());
  }

  // ---------------------------------------------------------------- pulsantino del menu

  /** Pulsante con l'icona dell'arma attiva e una freccina: tocco = pannello, tenuto = griglia armi. */
  private buildToggle(top: number): ArcadeButton {
    const t = HUD_MENU.toggle;
    this.toggleIcon = this.add.image(0, 0, '__DEFAULT').setOrigin(0).setVisible(false);
    this.toggleArrow = this.add.graphics();
    const content = this.add.container(0, 0, [this.toggleIcon, this.toggleArrow]);
    let longFired = false;
    let longPress: Phaser.Time.TimerEvent | null = null;
    const btn = alignButtonHit(
      new ArcadeButton(this, t.x, top + t.dy, {
        w: t.w,
        h: t.h,
        content,
        onClick: () => {
          if (longFired) {
            longFired = false;
            return;
          }
          if (this.menuState === 'closed') this.openPanel(true);
          else this.closeMenu();
        },
      }),
    );
    btn.setDepth(10);
    // tenuto premuto: dritto alla griglia delle armi
    btn.on('pointerdown', () => {
      longFired = false;
      longPress?.remove();
      longPress = this.time.delayedCall(HUD_MENU.longPressMs, () => {
        longFired = true;
        playClick();
        this.openPicker(true);
      });
    });
    const cancel = () => {
      longPress?.remove();
      longPress = null;
    };
    btn.on('pointerup', cancel);
    btn.on('pointerout', () => {
      cancel();
      longFired = false;
    });
    this.drawToggleArrow();
    return btn;
  }

  private setToggleIcon(key: string): void {
    const icon = this.toggleIcon;
    icon.setTexture(key).setVisible(true);
    // icona a sinistra della freccina, centrata a pixel interi sul pulsante
    icon.setPosition(-5 - Math.floor(icon.width / 2), -Math.floor(icon.height / 2));
  }

  /** Freccina gialla: giù = menu chiuso, su = aperto. */
  private drawToggleArrow(): void {
    const g = this.toggleArrow;
    const up = this.menuState !== 'closed';
    g.clear();
    for (let r = 0; r < 3; r++) {
      const w = up ? 1 + 2 * r : 5 - 2 * r;
      g.fillStyle(col(C.black));
      g.fillRect(9 - Math.floor(w / 2) - 1, r - 1, w + 2, 2);
    }
    for (let r = 0; r < 3; r++) {
      const w = up ? 1 + 2 * r : 5 - 2 * r;
      g.fillStyle(col(C.yellow));
      g.fillRect(9 - Math.floor(w / 2), r - 1, w, 1);
    }
  }

  // ---------------------------------------------------------------- apertura / chiusura

  private closeMenu(): void {
    if (this.menuState === 'closed') return;
    this.clearDrawer();
    this.menuState = 'closed';
    this.drawToggleArrow();
  }

  private clearDrawer(): void {
    this.idleTimer?.remove();
    this.idleTimer = null;
    this.slideTimer?.remove();
    this.slideTimer = null;
    this.drawer?.destroy();
    this.drawer = null;
    this.spritzBtn = null;
  }

  /** Un tocco sul menu: riparte il conto alla rovescia della chiusura automatica. */
  private touchMenu(): void {
    this.idleTimer?.remove();
    this.idleTimer = this.time.delayedCall(HUD_MENU.autoCloseMs, () => this.closeMenu());
  }

  /** Riquadro del menu in (x, y): fondo che assorbe i tocchi (non arrivano a Game) + entrata a scatti. */
  private makeDrawer(x: number, y: number, w: number, h: number, slide: boolean): Content {
    this.clearDrawer();
    const c = this.add.container(x, y).setDepth(20);
    const g = this.add.graphics();
    drawPanel(g, 0, 0, w, h, { shadow: C.black });
    const pad = this.add.zone(0, 0, w, h + 1).setOrigin(0).setInteractive();
    pad.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      this.touchMenu();
    });
    c.add([pad, g]);
    if (slide) {
      // entra da sinistra in pochi frame, a pixel interi
      let i = 0;
      const step = () => {
        c.x = x - Math.round((x + w) * HUD_MENU.slideSteps[i]);
      };
      step();
      this.slideTimer = this.time.addEvent({
        delay: HUD_MENU.slideStepMs,
        repeat: HUD_MENU.slideSteps.length - 2,
        callback: () => {
          i++;
          step();
        },
      });
    }
    this.drawer = c;
    this.touchMenu();
    return c;
  }

  /** Pulsante di riga del menu (testo centrato), tocco = touchMenu + azione. */
  private rowButton(
    x: number,
    y: number,
    w: number,
    label: string,
    fill: ColorIndex,
    onClick: () => void,
  ): { btn: ArcadeButton; text: Phaser.GameObjects.BitmapText } {
    const text = pixelText(this, 0, 0, label, C.white);
    text.setPosition(-Math.floor(text.width / 2), -4);
    const btn = alignButtonHit(
      new ArcadeButton(this, x, y, {
        w,
        h: HUD_MENU.rowH,
        fill,
        content: this.add.container(0, 0, [text]),
        onClick,
      }),
    );
    return { btn, text };
  }

  // ---------------------------------------------------------------- pannello

  /** Pannello sotto il pulsantino: arma (→ griglia), MENU, NEGOZIO, SPRITZ (mondi 2 e 3). */
  private openPanel(slide: boolean): void {
    const t = HUD_MENU.toggle;
    const rows = this.world !== 1 ? 4 : 3;
    const step = HUD_MENU.rowH + HUD_MENU.rowGap;
    const w = HUD_MENU.panelW;
    const h = 3 + rows * step + 1;
    const c = this.makeDrawer(t.x, SCREEN.safeTop + t.dy + t.h + 2, w, h, slide);
    this.menuState = 'panel';
    this.drawToggleArrow();
    const bw = w - 6;
    let y = 3;

    // riga dell'arma: icona + nome + ">" (apre la griglia)
    const meta = this.weaponId ? this.metaOf(this.weaponId) : null;
    const parts: Phaser.GameObjects.GameObject[] = [];
    const half = Math.floor(bw / 2);
    let ix = -half + 3;
    if (meta?.iconKey) {
      parts.push(
        this.add.image(ix, -Math.floor(meta.iconH / 2), meta.iconKey).setOrigin(0),
      );
      ix += meta.iconW + 3;
    }
    const nameMax = half - 9 - ix;
    parts.push(pixelText(this, ix, -4, fitName(this.weaponName, nameMax), C.white));
    parts.push(pixelText(this, half - 8, -4, '>', C.yellow));
    const weaponBtn = alignButtonHit(
      new ArcadeButton(this, 3, y, {
        w: bw,
        h: HUD_MENU.rowH,
        fill: C.navy,
        content: this.add.container(0, 0, parts),
        onClick: () => this.openPicker(true),
      }),
    );
    c.add(weaponBtn);
    y += step;

    // torna al Menu
    c.add(
      this.rowButton(3, y, bw, 'MENU', C.slate, () => {
        for (const k of ['Shop', 'Settings', 'ProgressHUD', 'Game']) this.scene.stop(k);
        this.scene.start('Menu'); // ferma anche UI
      }).btn,
    );
    y += step;

    // negozio: lancia la scena Shop sopra l'HUD
    c.add(
      this.rowButton(3, y, bw, 'NEGOZIO', C.red, () => {
        this.closeMenu();
        if (!this.scene.isActive('Shop')) this.scene.launch('Shop');
      }).btn,
    );
    y += step;

    // minigioco SPRITZ (solo in galleria) con la percentuale
    if (this.world !== 1) {
      const world = this.world;
      const label = `SPRITZ ${Math.min(99, Math.floor(this.spritzPercent))}%`;
      const { btn } = this.rowButton(3, y, bw, label, C.orange, () => {
        this.closeMenu();
        if (this.scene.isActive('Spritz')) return;
        this.scene.stop('Shop');
        this.scene.stop('Settings');
        this.scene.launch('Spritz', { world });
      });
      c.add(btn);
      this.spritzBtn = btn;
    }
  }

  // ---------------------------------------------------------------- griglia armi

  private metaOf(id: string) {
    const entry = WEAPON_REGISTRY.find((e) => e.id === id);
    return entry ? weaponMeta(this, entry) : null;
  }

  /** Griglia delle armi possedute (ordine del negozio), a pagine se non entrano. */
  private openPicker(slide: boolean): void {
    const owned = new Set(getSave().ownedWeapons);
    const list = WEAPON_REGISTRY.filter((e) => owned.has(e.id));
    const t = HUD_MENU.toggle;
    const cols = HUD_MENU.pickCols;
    const cw = HUD_MENU.cellW;
    const ch = HUD_MENU.cellH;
    const gap = HUD_MENU.cellGap;
    const w = cols * cw + (cols - 1) * gap + 6;
    const x = Math.floor((SCREEN.width - w) / 2);
    const y = SCREEN.safeTop + t.dy + t.h + 2;
    const headH = 14;
    // righe che entrano tra il pannello e il fondo (piede delle pagine compreso)
    const room = SCREEN.height - SCREEN.safeBottom - 4 - y - headH - 3 - 18;
    const fitRows = Math.max(1, Math.min(HUD_MENU.pickMaxRows, Math.floor((room + gap) / (ch + gap))));
    const needRows = Math.max(1, Math.ceil(list.length / cols));
    const rows = Math.min(fitRows, needRows);
    const perPage = rows * cols;
    const pages = Math.max(1, Math.ceil(list.length / perPage));
    // prima apertura: pagina dell'arma attiva
    if (this.menuState !== 'picker') {
      const idx = list.findIndex((e) => e.id === this.weaponId);
      this.pickPage = idx >= 0 ? Math.floor(idx / perPage) : 0;
    }
    this.pickPage = Phaser.Math.Clamp(this.pickPage, 0, pages - 1);
    const footH = pages > 1 ? 18 : 0;
    const h = headH + rows * ch + (rows - 1) * gap + 3 + footH;
    const c = this.makeDrawer(x, y, w, h, slide);
    this.menuState = 'picker';
    this.drawToggleArrow();

    // intestazione: nome dell'arma attiva (o di quella sotto il dito)
    c.add(pixelText(this, 4, 4, 'ARMI', C.yellow));
    const nameMax = w - 4 - 30 - 20;
    const name = pixelText(this, 30, 4, fitName(this.weaponName, nameMax), C.white);
    c.add(name);
    const xText = pixelText(this, 0, 0, 'X', C.white);
    xText.setPosition(-Math.floor(xText.width / 2), -4);
    c.add(
      alignButtonHit(
        new ArcadeButton(this, w - 17, 2, {
          w: 14,
          h: 11,
          content: this.add.container(0, 0, [xText]),
          onClick: () => this.closeMenu(),
        }),
      ),
    );

    const g = this.add.graphics();
    c.add(g);
    list.slice(this.pickPage * perPage, (this.pickPage + 1) * perPage).forEach((entry, i) => {
      const meta = weaponMeta(this, entry);
      const cx = 3 + (i % cols) * (cw + gap);
      const cy = headH + Math.floor(i / cols) * (ch + gap);
      const current = entry.id === this.weaponId;
      if (current) {
        // arma attiva: cornice gialla attorno alla cella
        g.fillStyle(col(C.yellow));
        g.fillRect(cx - 1, cy - 1, cw + 2, ch + 3);
      }
      const parts: Phaser.GameObjects.GameObject[] = [];
      if (meta.iconKey) {
        const s = Math.max(1, Math.min(2, Math.floor((ch - 6) / Math.max(meta.iconW, meta.iconH))));
        parts.push(
          this.add
            .image(-Math.floor((meta.iconW * s) / 2), -Math.floor((meta.iconH * s) / 2), meta.iconKey)
            .setOrigin(0)
            .setScale(s),
        );
      } else {
        const q = pixelText(this, 0, 0, '?', C.silver);
        q.setPosition(-Math.floor(q.width / 2), -4);
        parts.push(q);
      }
      const btn = alignButtonHit(
        new ArcadeButton(this, cx, cy, {
          w: cw,
          h: ch,
          fill: current ? C.orange : C.slate,
          content: this.add.container(0, 0, parts),
          onClick: () => {
            this.closeMenu();
            if (entry.id !== this.weaponId) events.emit('weapon:request', { weaponId: entry.id });
          },
        }),
      );
      // dito sopra una cella: il suo nome nell'intestazione
      btn.on('pointerdown', () => {
        this.touchMenu();
        setPixelText(name, fitName(meta.name, nameMax));
      });
      btn.on('pointerout', () => setPixelText(name, fitName(this.weaponName, nameMax)));
      c.add(btn);
    });

    // piede: pagine
    if (pages > 1) {
      const fy = h - footH;
      const goTo = (d: number) => {
        this.pickPage = (this.pickPage + d + pages) % pages;
        this.openPicker(false);
      };
      c.add(this.rowButton(3, fy, 30, '<', C.slate, () => goTo(-1)).btn);
      c.add(this.rowButton(w - 33, fy, 30, '>', C.slate, () => goTo(1)).btn);
      c.add(pixelText(this, Math.floor(w / 2), fy + 4, `${this.pickPage + 1}/${pages}`, C.silver).setOrigin(0.5, 0));
    }
  }
}

/**
 * Nome che entra in `maxPx`: parole intere finché ci stanno, poi un punto
 * ("FUCILE D'ASSALTO" → "FUCILE."); se non entra neanche la prima, la tronca.
 */
function fitName(name: string, maxPx: number): string {
  if (measureText(name) <= maxPx) return name;
  const words = name.split(' ');
  let out = '';
  for (const w of words) {
    const next = out ? `${out} ${w}` : w;
    if (measureText(`${next}.`) > maxPx) break;
    out = next;
  }
  if (out) return `${out}.`;
  let cut = name;
  while (cut.length > 1 && measureText(`${cut}.`) > maxPx) cut = cut.slice(0, -1);
  return `${cut}.`;
}
