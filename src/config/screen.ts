/**
 * Risoluzione logica calcolata all'avvio (prima di creare Phaser.Game).
 *
 * Larghezza fissa, altezza dal rapporto della finestra: su un telefono 9:19.5
 * lo schermo è 180x390 invece di 180x320, così il canvas riempie tutto il
 * display senza bande nere. Su finestre più larghe di 9:16 (desktop, tablet)
 * resta 320 e Scale.FIT mette le bande ai lati come prima.
 *
 * Il layout di base resta 180x320: le righe in più (`extra`) si aggiungono
 * SOPRA. Le scene "di mondo" (Game, Menu, Spritz) spostano la camera di
 * `top` (= -extra), quindi le coordinate 0..320 restano quelle di sempre e
 * il bordo basso dello schermo è ancora y 320; sopra lo 0 si allungano
 * cielo, volta della galleria e stanza. Le scene HUD usano invece 0..height
 * e si ancorano ai bordi.
 *
 * Il rapporto si legge una volta sola: a un cambio di forma della finestra
 * (rotazione, barre del browser) Scale.FIT riadatta il canvas e alla
 * prossima apertura l'altezza si ricalcola.
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

/** Legge env(safe-area-inset-*) in px CSS con un elemento sonda invisibile. */
function readSafeArea(): { top: number; bottom: number } {
  const host = document.body ?? document.documentElement;
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
    'padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
  host.appendChild(probe);
  const cs = getComputedStyle(probe);
  const top = parseFloat(cs.paddingTop) || 0;
  const bottom = parseFloat(cs.paddingBottom) || 0;
  probe.remove();
  return { top, bottom };
}

export function computeScreen(fit: ScreenFit): ScreenSize {
  let height = fit.baseHeight;
  let safeTop = 0;
  let safeBottom = 0;
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const iw = window.innerWidth;
    const ih = window.innerHeight;
    if (iw > 0 && ih > 0) {
      height = Math.min(fit.maxHeight, Math.max(fit.baseHeight, Math.round((fit.width * ih) / iw)));
      // px CSS per pixel logico con Scale.FIT
      const k = Math.min(iw / fit.width, ih / height);
      const safe = readSafeArea();
      // la parte di margine già coperta dalle bande nere (FIT) non conta
      const band = Math.max(0, (ih - height * k) / 2);
      safeTop = Math.min(fit.maxSafe, Math.ceil(Math.max(0, safe.top - band) / k));
      safeBottom = Math.min(fit.maxSafe, Math.ceil(Math.max(0, safe.bottom - band) / k));
    }
  }
  const extra = height - fit.baseHeight;
  return { width: fit.width, height, baseHeight: fit.baseHeight, extra, top: -extra || 0, safeTop, safeBottom };
}
