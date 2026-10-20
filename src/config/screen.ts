/**
 * Risoluzione logica, misurata dal riquadro VERO in cui Phaser adatta il
 * canvas (#game, fisso a schermo pieno) e ricalcolata dal vivo.
 *
 * Larghezza fissa, altezza dal rapporto del riquadro: su un telefono 9:19.5
 * lo schermo è 180x390 invece di 180x320, così il canvas riempie tutto il
 * display senza bande. Su finestre più larghe di 9:16 (desktop, tablet)
 * resta 320 e Scale.FIT mette le bande ai lati come prima.
 *
 * Il layout di base resta 180x320: le righe in più (`extra`) si aggiungono
 * SOPRA. Le scene "di mondo" (Game, Menu, Spritz) spostano la camera di
 * `top` (= -extra), quindi le coordinate 0..320 restano quelle di sempre e
 * il bordo basso dello schermo è ancora y 320; sopra lo 0 si allungano
 * cielo, volta della galleria e stanza. Le scene HUD usano invece 0..height
 * e si ancorano ai bordi.
 *
 * Dal vivo: su iPhone la finestra all'avvio è spesso più bassa di quella
 * finale (barre di Safari, avvio da Home non ancora assestato, schermo
 * intero), e anche env(safe-area-inset-*) può valere 0 nei primi istanti.
 * systems/screenWatch.ts rimisura a ogni resize / rotazione / cambio del
 * visualViewport (e qualche volta dopo l'avvio) e, se altezza o margini
 * cambiano davvero, aggiorna SCREEN sul posto (`applyScreen`), ridimensiona
 * il gioco ed emette 'screen:changed': le scene si ricostruiscono.
 */

export interface ScreenFit {
  width: number;
  /** altezza del layout di base (e minima) */
  baseHeight: number;
  /** altezza massima: oltre (schermi lunghissimi) bande sottili sopra e sotto */
  maxHeight: number;
  /** margine sicuro massimo (px logici) preso da notch / indicatore home */
  maxSafe: number;
}

/**
 * Margini di riserva per iPhone (px CSS) quando la pagina sta sotto la barra
 * di stato (app da Home, Safari di iOS 26) ma env(safe-area-inset-*) dice 0.
 */
export interface SafeFallback {
  /** altezza schermo (px CSS, verticale) da cui c'è la Dynamic Island */
  islandMinH: number;
  island: number;
  /** altezza schermo da cui c'è il notch */
  notchMinH: number;
  notch: number;
  /** iPhone col tasto Home: solo la barra di stato */
  legacy: number;
  /** indicatore Home (solo iPhone con notch / Dynamic Island) */
  bottom: number;
  /** prima versione di iOS / Safari in cui la pagina scorre sotto la barra di stato */
  edgeToEdgeIos: number;
}

export interface ScreenSize {
  readonly width: number;
  /** altezza logica reale del canvas */
  readonly height: number;
  /** altezza del layout di base (320) */
  readonly baseHeight: number;
  /** righe aggiunte sopra il layout di base (height - baseHeight, >= 0) */
  readonly extra: number;
  /** y "di mondo" del bordo alto dello schermo nelle scene ancorate in basso (-extra) */
  readonly top: number;
  /** margini sicuri (notch in alto, indicatore home in basso), in px logici */
  readonly safeTop: number;
  readonly safeBottom: number;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** sonda invisibile per env(safe-area-inset-*): creata una volta, resta nel DOM e si rilegge a ogni misura */
let probe: HTMLDivElement | null = null;

function safeProbe(): HTMLDivElement | null {
  if (probe?.isConnected) return probe;
  const host = document.body;
  if (!host) return null; // prima del <body>: si riprova alla prossima misura
  probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText =
    'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
    'padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)';
  host.appendChild(probe);
  return probe;
}

/** env(safe-area-inset-*) in px CSS (0 se la sonda non c'è ancora). */
function readSafeArea(): { top: number; bottom: number } {
  const p = safeProbe();
  if (!p) return { top: 0, bottom: 0 };
  const cs = getComputedStyle(p);
  return { top: parseFloat(cs.paddingTop) || 0, bottom: parseFloat(cs.paddingBottom) || 0 };
}

/** Riquadro (px CSS) in cui Phaser adatta il canvas: #game se misurabile, altrimenti la finestra. */
function viewportBox(): { w: number; h: number; top: number } {
  const el = document.getElementById('game');
  const r = el?.getBoundingClientRect();
  if (r && r.width > 0 && r.height > 0) return { w: r.width, h: r.height, top: r.top };
  return { w: window.innerWidth, h: window.innerHeight, top: 0 };
}

/**
 * iPhone con la pagina sotto la barra di stato (app da Home / schermo intero,
 * oppure Safari di iOS 26+ che disegna fino al bordo alto): se env() dice 0
 * si usa un margine di riserva, altrimenti l'HUD finisce sotto ora e batteria.
 */
function iosFallback(fb: SafeFallback, box: { w: number; h: number; top: number }): { top: number; bottom: number } {
  const none = { top: 0, bottom: 0 };
  const nav = navigator as Navigator & { standalone?: boolean };
  const ua = nav.userAgent;
  if (!/iPhone|iPod/.test(ua) || box.h <= box.w || box.top > 0) return none;
  const mm = (q: string) => typeof window.matchMedia === 'function' && window.matchMedia(q).matches;
  const standalone = nav.standalone === true || mm('(display-mode: standalone)') || mm('(display-mode: fullscreen)') || !!document.fullscreenElement;
  // iOS 26 congela "OS 18_6" nello user agent: conta la versione di Safari
  const ver = Math.max(Number(/Version\/(\d+)/.exec(ua)?.[1] ?? 0), Number(/OS (\d+)_/.exec(ua)?.[1] ?? 0));
  if (!standalone && ver < fb.edgeToEdgeIos) return none;
  const sh = Math.max(screen.width, screen.height);
  const top = sh >= fb.islandMinH ? fb.island : sh >= fb.notchMinH ? fb.notch : fb.legacy;
  const bottom = sh >= fb.notchMinH ? fb.bottom : 0;
  return { top, bottom };
}

/** Misura lo schermo adesso (nessun effetto collaterale a parte la sonda). */
export function measureScreen(fit: ScreenFit, fb: SafeFallback): ScreenSize {
  let height = fit.baseHeight;
  let safeTop = 0;
  let safeBottom = 0;
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const box = viewportBox();
    const { w: iw, h: ih } = box;
    if (iw > 0 && ih > 0) {
      height = Math.min(fit.maxHeight, Math.max(fit.baseHeight, Math.round((fit.width * ih) / iw)));
      // px CSS per pixel logico con Scale.FIT
      const k = Math.min(iw / fit.width, ih / height);
      const safe = readSafeArea();
      const ios = iosFallback(fb, box);
      const sTop = safe.top > 0 ? safe.top : ios.top;
      const sBottom = safe.bottom > 0 ? safe.bottom : ios.bottom;
      // la parte di margine già coperta dalle bande (FIT) non conta
      const band = Math.max(0, (ih - height * k) / 2);
      safeTop = Math.min(fit.maxSafe, Math.ceil(Math.max(0, sTop - band) / k));
      safeBottom = Math.min(fit.maxSafe, Math.ceil(Math.max(0, sBottom - band) / k));
    }
  }
  const extra = height - fit.baseHeight;
  return { width: fit.width, height, baseHeight: fit.baseHeight, extra, top: -extra || 0, safeTop, safeBottom };
}

/**
 * Copia `next` dentro `target` (lo stesso oggetto SCREEN che tutti importano).
 * Ritorna true solo se altezza o margini sono cambiati davvero.
 */
export function applyScreen(target: ScreenSize, next: ScreenSize): boolean {
  if (target.height === next.height && target.safeTop === next.safeTop && target.safeBottom === next.safeBottom) return false;
  Object.assign(target as Mutable<ScreenSize>, next);
  return true;
}
