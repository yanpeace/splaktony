# Splak Tony: architettura e contratti

Leggi questo file prima di toccare il codice. Descrive le regole che tengono
insieme il progetto quando ci lavorano più agenti.

Gioco: il giocatore colpisce **Tony**, un pupazzo di pezza ragdoll.
Core loop: colpisci → danno → monete → armi migliori → più danno.

Stack: Vite + TypeScript (strict) + Phaser 3.90 con Matter.js.

```
npm install
npm run dev -- --host     # dev server, raggiungibile dal telefono in LAN
npm run typecheck         # tsc, deve restare a 0 errori
npm run build
```

---

## 1. Regole vincolanti

1. **Risoluzione logica 180x320** (verticale), `pixelArt`, `roundPixels`,
   `Scale.FIT`. Posizioni a schermo sempre intere (`Math.round`).
2. **Solo la palette Sweetie 16 + 1 rosa pelle** (`src/config/palette.ts`).
   Nel codice usa `C.<nome>` + `col()` (intero) o `hex()` (CSS). Mai colori
   letterali. L'indice 16 (`g`, `C.pink`) è riservato alla pelle di Tony.
3. **Niente asset esterni**: sprite da stringhe (`gfx/pixelSprite.ts`), font
   da codice (`gfx/pixelFont.ts`), audio Web Audio (`audio/sfx.ts`).
4. **Tutti i numeri di gameplay stanno in `src/config/balance.ts`**:
   danni, prezzi, soglie, durate, fisica. Niente numeri magici nei sistemi.
5. **I sistemi comunicano solo tramite eventi** (`systems/events.ts`).
   Non importare un sistema dentro un altro per chiamarne i metodi; emetti o
   ascolta un evento. Eccezioni ammesse: le utility pure (`gfx/*`,
   `audio/sfx`, `systems/damage.dealDamage`, `save.getSave/patchSave`).
6. Ogni `events.on(...)` di una scena va chiuso allo shutdown: usa
   `Subscriptions` e chiama `subs.clear()` su `Phaser.Scenes.Events.SHUTDOWN`.
7. Testo: solo con `pixelText()` (contorno scuro di 1px incluso). Il font ha
   maiuscole, cifre e `. , ! ? : - + / % ' ( ) = < > # $ *`; minuscole e
   accenti vengono convertiti, gli altri caratteri diventano spazi.
   `*` è una "x" piccola per i moltiplicatori (`*2`).

---

## 2. Struttura cartelle

```
src/
  main.ts               config Phaser (WebGL, matter, autoUpdate: false)
  config/
    balance.ts          TUTTI i numeri (SCREEN, ROOM, PHYSICS, RAGDOLL, GRAB,
                        DAMAGE, ECONOMY, MOOD, FX, WEAPON_STATS)
    palette.ts          Sweetie 16 + rosa pelle: PALETTE_HEX, C, col(), hex()
  gfx/
    pixelSprite.ts      SpriteData (string[]) → texture: makeSprite/makeSprites
    sprites.ts          sprite di Tony, stanza e UI + registerSprites()
    pixelFont.ts        font bitmap 5x7: pixelText, setPixelText, formatCompact
    effects.ts          spawnParticles, hitFlash, shake, hitStop/isFrozen,
                        damageNumber, hitNumber, damageColor, popFrames
    juice.ts            scritte fumetto, impact frame, zoom, linee, cornice
                        critici, squash, monete che volano (bindFlyingCoins)
    ui.ts               drawPanel (riquadro 1px), ArcadeButton (si abbassa di 1px)
  audio/
    sfx.ts              unlockAudio, setMuted, tone, noise, playHit, playPunch,
                        playSqueak, playWhiff, playShot, playExplosion, playCoin,
                        playClick, playBuy, playError, playLevelUp, playWhoosh
  entities/
    Ragdoll.ts          Tony: 10 parti Matter + giunti, presa/lancio, umore
    Room.ts             stanza: grafica + 4 corpi statici
  weapons/
    Weapon.ts           classe base astratta + WeaponContext + WeaponPointer
    Punch.ts            Pugno (unica arma per ora)
    registry.ts         WEAPON_REGISTRY: elenco delle armi
  systems/
    events.ts           event bus tipizzato (CONTRATTO PRINCIPALE)
    damage.ts           dealDamage(), impactDamage(): unica fonte di 'damage'
    economy.ts          danno → monete, spend/add/canAfford
    save.ts             localStorage versionato: load/save/getSave/patchSave
    upgrades.ts         prezzi, costi e scaleStats dei potenziamenti (puro)
    feedback.ts         numeri, particelle, shake, hit-stop e suoni sui colpi
  scenes/
    Boot.ts             genera texture/font, init save + economy, avvia Game
    Game.ts             stanza, Tony, fisica a passo fisso, input → arma
    UI.ts               HUD sovrapposto (scena separata, non trema)
    Shop.ts             negozio armi + potenziamenti (sopra UI)
```

Ordine scene: `Boot` → `Game` → (`Game` lancia) `UI` in parallelo.
Nuove scene sovrapposte (negozio, popup livello) si lanciano con
`this.scene.launch('Shop')` e si mettono **sopra** `UI` nella lista scene di
`main.ts`.

---

## 3. Event bus (`src/systems/events.ts`)

```ts
import { events, Subscriptions } from '../systems/events';

const off = events.on('damage', (e) => { /* ... */ });
events.on('coins:changed', (e) => {/* ... */}, true); // replay: riceve subito l'ultimo valore
events.emit('weapon:request', { weaponId: 'bat' });
events.peek('coins:changed');                     // ultimo payload, senza iscriversi
```

| Evento | Payload | Chi lo emette | Note |
|---|---|---|---|
| `damage` | `{ amount, part, x, y, weaponId, strong, crit? }` | solo `damage.dealDamage()` | `amount` è finale (testa x2, critico x2, arrotondato, >= 1). `weaponId` = id arma o `'impact'` per urti contro la stanza. `strong` = sopra `FX.strongHitDamage`. `crit` = colpo CRITICO (`JUICE.critChance`, già moltiplicato per `JUICE.critMultiplier`) |
| `coins:changed` | `{ coins, delta }` | `economy` | `delta` < 0 = spesa |
| `damage:total` | `{ total }` | `economy` | danno cumulativo |
| `weapon:selected` | `{ weaponId, name, iconKey }` | `Game.selectWeapon` | il save lo memorizza |
| `weapon:request` | `{ weaponId }` | negozio / barra armi | `Game` seleziona l'arma |
| `weapon:bought` | `{ weaponId, price }` | `economy.buyWeapon` | arma aggiunta a `ownedWeapons` |
| `weapon:upgraded` | `{ weaponId, level, cost }` | `economy.upgradeWeapon` | `Game` aggiorna `weapon.level` |
| `level:up` | `{ level }` | sistema livelli (da fare) | il save salva `level` |
| `mood:changed` | `{ mood: 'normal' \| 'hurt' \| 'dizzy' }` | `Ragdoll` | |
| `ragdoll:grab` | `{ part }` | `Ragdoll` | |
| `ragdoll:release` | `{ part, vx, vy }` | `Ragdoll` | velocità del lancio in px/step |
| `settings:changed` | `{ muted }` | UI | sfx e save ascoltano |
| `world:changed` | `{ world: WorldId }` (`1 \| 2 \| 3`) | `Menu` (scelta MONDO 1 / 2 / 3) | il save memorizza `world` |
| `spritz:progress` | `{ percent }` (0..100) | `Spritz` (minigioco) | il save memorizza `spritz.percent` |
| `spritz:done` | `{ reward }` | `Spritz` al 100% | il save azzera `percent` e incrementa `spritz.completed` |

Per aggiungere un evento: aggiungi la chiave a `GameEvents` con il tipo del
payload e una riga in questa tabella. Nomi in stile `area:azione`.

`PartName` = `'head' | 'torso' | 'armUpperL' | 'armLowerL' | 'armUpperR' |
'armLowerR' | 'legUpperL' | 'legLowerL' | 'legUpperR' | 'legLowerR'`.

---

## 4. Danno (`src/systems/damage.ts`)

- **Non emettere mai `damage` a mano.** Chiama
  `dealDamage({ part, x, y, amount, weaponId })` con il danno *grezzo*:
  applica `DAMAGE.partMultiplier` (testa x2), arrotonda ed emette.
- Gli urti di Tony contro qualunque corpo non suo li gestisce già il
  Ragdoll: `impactDamage(velocitàRelativaNormale)` restituisce 0 sotto
  `DAMAGE.impactThreshold` (e sotto `minImpactDamage`), con un cooldown per
  parte (`partCooldownMs`).
- **Armi fisiche** (mazza, palla, proiettile con corpo Matter): metti sul
  corpo `body.weaponId = '<id>'` e, se serve, `body.damageScale = 1.5`.
  Gli urti con Tony verranno attribuiti a quell'arma e scalati, senza
  codice in più.
- L'economia, l'HUD, il feedback e il flash ascoltano `damage`: un'arma
  nuova riceve tutto gratis chiamando `dealDamage`.

---

## 5. Armi (`src/weapons/`)

### Classe base `Weapon<S>`

```ts
abstract class Weapon<S extends WeaponStats = WeaponStats> {
  abstract readonly id: string;      // = chiave in WEAPON_STATS
  abstract readonly name: string;    // per HUD/negozio, MAIUSCOLO
  abstract readonly icon: SpriteData;// icona pixel, texture `icon-<id>`
  readonly allowsGrab = true;        // false = la scena non trascina Tony
  level = 0;                         // potenziamento, lo imposta il negozio
  get stats(): S;                    // WEAPON_STATS[id] passato a statsForLevel()
  protected statsForLevel(base: S, level: number): S; // override per gli upgrade
  protected tryUse(now?): boolean;   // rispetta stats.cooldownMs
  protected hit(h: HitInput): number;// = ctx.dealDamage
  ensureIcon(): string;              // crea la texture dell'icona
  activate(): void; deactivate(): void;
  onPointerDown(p: WeaponPointer): void;
  onPointerMove(p: WeaponPointer): void;
  onPointerUp(p: WeaponPointer): void;
  update(dtMs: number): void;
}
```

`WeaponContext` (passato al costruttore): `{ scene, ragdoll, dealDamage }`.

`WeaponPointer` (stato di un dito/mouse, coordinate mondo):
`id, x, y, downX, downY, downTime, time, downHit (parte sotto il dito al
pointerdown, o null), grabbing, wasGrab, vx, vy` (velocità del gesto in px/step).

### Regola tap / presa (in `Game.ts`)

Se il tocco parte su Tony e il dito si muove di `GRAB.dragStartDistance` px
o resta giù per `GRAB.holdStartMs`, la scena **afferra** Tony
(`grabbing = wasGrab = true`); al rilascio lo lancia con la velocità del
gesto. Altrimenti il rilascio è un **tap** (`wasGrab === false`). Le armi
ricevono comunque tutti gli eventi e decidono: il Pugno agisce solo
`onPointerUp` se `!p.wasGrab`. Un'arma che non vuole la presa (es. una
pistola che spara tenendo premuto) imposta `allowsGrab = false`.

### Aggiungere un'arma

1. `config/balance.ts`: aggiungi in `WEAPON_STATS` una voce con `price`,
   `damage`, `cooldownMs` + i campi propri dell'arma.
2. `src/weapons/<Nome>.ts`: `class Bat extends Weapon<(typeof WEAPON_STATS)['bat']>`
   con `id`, `name`, `icon`; usa `this.ctx.ragdoll` per spingere Tony e
   `this.hit()` per il danno diretto; `effects`/`sfx` per il feedback extra.
3. `src/weapons/registry.ts`: `{ id: 'bat', create: (ctx) => new Bat(ctx) }`.
4. Selezione: `events.emit('weapon:request', { weaponId: 'bat' })`.

### API di Tony utili alle armi (`entities/Ragdoll.ts`)

- `ragdoll.partAt(x, y, tolleranza?)` → `{ part, x, y } | null`
- `ragdoll.applyImpulse(part, x, y, dvx, dvy)`: Δv in px/step applicato in un
  punto (genera anche rotazione)
- `ragdoll.addVelocity(dvx, dvy, tranne?)`: spinta a tutto il corpo
- `ragdoll.applyRadialImpulse(x, y, raggio, forza)` → parti colpite (esplosioni)
- `ragdoll.centerOfMass()`, `ragdoll.parts`, `ragdoll.bodies`,
  `ragdoll.partOfBody(body)`, `ragdoll.currentMood`, `ragdoll.respawn()`
- `ragdoll.isGrabbed()`

Tony non esce mai dalla stanza: velocità limitata, parti fuori dai bordi
riportate dentro, giunti stirati per troppo tempo → `respawn()`.

---

## 6. Effetti e audio

`gfx/effects.ts` (tutte con `scene` come primo argomento):

| Funzione | Uso |
|---|---|
| `spawnParticles(scene, x, y, { count, colors, speed, angle, spread, gravity, lifeMs, size })` | quadratini 1x1/2x2 che lampeggiano prima di sparire |
| `hitFlash(sprite, frames = 2)` | flash bianco pieno |
| `shake(scene, px, ms)` | screen shake a pixel interi (solo camera di gioco) |
| `hitStop(scene, ms)` / `isFrozen(scene)` | freeze di fisica e particelle (30-60 ms) |
| `damageNumber(scene, x, y, testo, colore)` / `damageColor(n)` | numero pixel che salta e svanisce |
| `hitNumber(scene, x, y, amount, { mergeKey, crit, depth })` | numero "ricco" usato da feedback: scala 2 sopra `JUICE.numberScale2At`, pop + rimbalzo a 3 frame, somma i colpi con la stessa `mergeKey` entro `JUICE.numberMergeMs`, "CRIT!" sopra i critici |
| `popFrames(scene, x, y, [chiaviTexture], frameMs)` | animazione usa e getta a pochi frame |
| `acquireImage(scene, x, y, chiave)` / `releaseImage(img)` | immagine dal pool condiviso (proiettili, bossoli, fori, fumo...) |

**Prestazioni (60 fps su telefono): niente `scene.add.*` / `destroy()` a ogni
colpo.** Particelle, numeri di danno e pop vengono da pool interni con un
tetto (`FX.maxParticles`, `FX.maxDamageNumbers`, `FX.maxPops`; oltre il tetto
si ricicla il più vecchio). Per gli oggetti di un'arma usa
`acquireImage()` al posto di `scene.add.image()` e `releaseImage()` al posto
di `destroy()`: l'immagine torna con stato azzerato (origine 0.5, depth 0,
niente rotazione/tint/alpha), quindi reimposta ciò che ti serve.

Il feedback standard dei colpi è già cablato in `systems/feedback.ts`
(ascolta `damage`): un'arma nuova non deve rifarlo, solo aggiungere il suo
effetto specifico (scintille, bossolo, esplosione...).

**Juice** (`gfx/juice.ts`, numeri in `JUICE` in fondo a `balance.ts`), tutto
automatico da `damage` tramite `juiceHit()` chiamato da feedback:

| Effetto | Quando |
|---|---|
| squash & stretch della parte colpita (1.2x0.8 → 1, solo sprite) | ogni colpo |
| scritta fumetto (scala 3→2, rotazione a scatti, "esplosione" a 3 frame, trema e lampeggia) + swoosh | `strong` o `crit`; max 1 ogni `wordMinGapMs`, max `maxWords` a schermo |
| linee d'impatto radiali 1px, 2 frame | `strong` |
| impact frame: Tony sagoma bianca, sfondo scuro (≤ 2 frame, max 1 al secondo) | `amount >= JUICE.veryStrongDamage` |
| punch-zoom 1 → 1.04 → 1.02 → 1 (solo se la camera è a zoom 1) | `amount >= JUICE.veryStrongDamage` |
| cornice 2px rossa/gialla (nella scena UI) + suono "ding" cattivo | `crit` |
| monete che volano dal colpo al contatore + bump (`bindFlyingCoins`, agganciato da UI) | `coins:changed` con `delta > 0` |

Le parole dipendono dalla famiglia dell'arma: `WEAPON_FAMILY` (id esatto →
famiglia), poi `FAMILY_PATTERNS` (regex sul weaponId, per le armi nuove), poi
`default` (POW!). Le parole di ogni famiglia sono in `WORD_FAMILIES`. Arma
nuova con un nome "parlante" (es. `katana`, `lanciafiamme`) = niente da fare;
altrimenti aggiungi una riga a `WEAPON_FAMILY`.

`audio/sfx.ts`: tutte le `play*()` sono sicure anche ad audio bloccato e
hanno un limitatore anti-raffica. Per nuovi suoni usa `tone()` e `noise()`.

UI (`gfx/ui.ts`): `drawPanel(g, x, y, w, h, stile)` e
`new ArcadeButton(scene, x, y, { w, h, content, onClick })`.

---

## 7. Sprite (`gfx/pixelSprite.ts`)

```ts
const ICON: SpriteData = [
  '..0000..',
  '.033330.',   // ogni carattere = indice palette 0-f, '.' = trasparente
];
makeSprite(scene, 'icon-bat', ICON);
```

Legenda: `0` black `1` plum `2` red `3` orange `4` yellow `5` lime `6` green
`7` teal `8` navy `9` blue `a` sky `b` cyan `c` white `d` silver `e` slate
`f` charcoal, più `g` pink (#f2a7a0, indice 16) **solo per la pelle**.
Contorno scuro `0` attorno agli oggetti. Animazioni: 2-4
texture distinte (`fx-pow`, `fx-pow-small`...). Per passare agli sprite
Aseprite: aggiungi un `preload()` in `Boot` che carica un PNG con la stessa chiave (`makeSprite` salta le chiavi già esistenti).

Tony (operaio): testa 16x17 (caschetto giallo; faccia `tony-head`, `-blink`,
`-hurt`, `-dizzy-a/b`), busto 14x18 (maglietta nera + pettorina gialla,
cintura e jeans), braccia 5x10 (manica + avambraccio con guanto), gambe
6x11 + 6x12 (jeans + scarpa antinfortunistica). La pelle negli sprite usa i
segnaposto `s`/`h`/`l` convertiti da `skin()` (costanti `SKIN_*` in
`gfx/sprites.ts`).

---

## 8. Salvataggio (`src/systems/save.ts`)

- Chiave `localStorage`: `splaktony.save`; `SAVE_VERSION = 2`.
- `load()` / `save(data)`: lettura/scrittura diretta.
- `getSave()` / `patchSave(patch)`: stato condiviso in memoria con scrittura
  debounce (800 ms) + flush su `pagehide` / tab nascosta.
- Schema v1: `coins, totalDamage, coinRemainder, level, xp, selectedWeapon,
  ownedWeapons, weaponLevels, settings.muted`.
- Schema v2: + `world: 1 | 2` (mondo scelto nel Menu, default 1; migrazione 1→2).
- Schema v3: `world: WorldId` (anche 3) + `spritz: { percent, completed }` (minigioco SPRITZ; migrazione 2→3).
- **Cambiare schema**: incrementa `SAVE_VERSION`, aggiorna `SaveData` e
  `defaultSave()`, aggiungi `MIGRATIONS[vecchia] = (d) => ({ ...d, version: nuova, ... })`.
  Non cancellare mai una migrazione.

## 9. Economia (`src/systems/economy.ts`)

1 moneta ogni `ECONOMY.damagePerCoin` (10) danni, con resto conservato.
`economy.canAfford(n)`, `economy.spend(n)` (true se riuscita),
`economy.add(n)`. Ogni variazione emette `coins:changed` e salva.

---

### Negozio e potenziamenti

- `scenes/Shop.ts`: scena sovrapposta (pulsante NEGOZIO dell'HUD), lista da
  `WEAPON_REGISTRY` a pagine da 6. Per nome/icona istanzia ogni arma con un
  `WeaponContext` inerte (solo `scene.textures` è reale): **i costruttori delle
  armi non devono fare lavoro importante**, mettilo in `activate()`.
- `systems/upgrades.ts` (puro): `weaponPrice(id)` (`WEAPON_STATS[id].price` se
  > 0, altrimenti `SHOP.prices[id]`), `upgradeCost(id, livello)`,
  `scaleStats(base, livello)` (danno * `SHOP.damageMult`, cooldown /
  `SHOP.rateMult`), `installUpgrades(arma, livello)`: la usa `Game` per ogni
  arma; se l'arma ha un suo override di `statsForLevel` viene rispettato.
- `economy.buyWeapon(id)` / `economy.upgradeWeapon(id)`: spendono, salvano
  subito ed emettono `weapon:bought` / `weapon:upgraded`.
- Il save garantisce sempre `punch` in `ownedWeapons` e una `selectedWeapon`
  posseduta.

## 9b. Mondi (`scenes/Game.ts`, `scenes/Menu.ts`, `WORLDS` in balance.ts)

- `WorldId = 1 | 2 | 3` (in `systems/events.ts`). Metri di galleria per mondo in `WORLDS.meters`
  (0, 250, 500, 1000, 2000, 4000: i mondi successivi, poi il boss finale).
  Mondi 2 e 3 = `buildTunnelWorld(scene, { world })`.
- `scene.start('Game', { world?: WorldId, intro?: boolean })`. Mondo 1 =
  cantiere (`buildRoom` + `bindSiteAmbient` + `bindCarCrash`); mondo 2 =
  dentro la galleria (`buildRoomBodies` + `buildTunnelWorld` da
  `entities/TunnelWorld.ts`, niente ambiente né incidente). Stessa fisica.
- Menu: MONDO 1 / 2 / 3 sotto GIOCA; il 2 si sblocca a
  `WORLDS.unlockLevel`, il 3 a `WORLDS.unlockLevel3` (lucchetto + "LV n", al
  tocco `playError`). Un mondo salvato ma bloccato ripiega sul più alto sbloccato.
- GIOCA col mondo 2 o 3 → Game nel mondo 1 con `intro: true, introTo` (incidenti
  automatici spenti: `bindCarCrash(scene, { auto: false })`). Dopo
  `WORLDS.introDelayMs` `driveIntoTunnel(scene, onInside)` (CarCrash.ts):
  l'auto segue la strada fino a `Z_FAR`, sagoma nel buio e lampo dei fanali.
  Quando entra: input bloccato, HUD nascosto, zoom a scatti (`WORLDS.zoomIn`)
  attorno alla bocca (origine camera, scroll sempre 0 per lo shake), fade al
  nero, `scene.restart({ world: introTo })`, che parte zoomato, fa zoom-out
  (`WORLDS.zoomOut`) e mostra a schermo i metri ("500 M" + "MONDO 3",
  `WORLDS.title*`). Tony resta giocabile fino all'ingresso dell'auto.
- Cartello dei metri: `gfx/tunnelSprites.ts` lo cuoce nello sfondo leggendo
  `WORLDS.meters` (`worldMeters(world)`, `distSign(world)`): un mondo nuovo
  ha il suo cartello senza codice in più. Sfondi in cache per mondo
  (`tunnelBackdrop(world)`, pre-calcolato durante l'intro per `introTo`).
  `Game` chiama `setTunnelWorld(world)` prima di `buildTunnelWorld`; le chiavi
  fisse `tw-bg` / `tw-shade<i>` contengono sempre il mondo attivo (gli altri
  restano parcheggiati come `<chiave>@w<mondo>`, rinominati al cambio).
- Mondo 3 (500 M): stessa galleria + `bindTunnelDeep(scene)`
  (`entities/TunnelDeep.ts`, numeri in `TUNNEL_DEEP`): velo scuro/rosso caldo
  sullo sfondo, gocce dalla volta con cerchi nelle pozzanghere, ventilatore,
  lampada appesa che dondola ai colpi forti, cartello PERICOLO con lucine,
  mini escavatore, radio con le note, topo sul cordolo, polvere e sassolini.
- Pulsante MENU nell'HUD (in basso al centro): ferma Shop/Settings/
  ProgressHUD/Game e torna al Menu.

## 10. Cosa NON c'è ancora (per i prossimi agenti)

- Altre armi.
- Livelli/XP (`level:up`, campi `level`/`xp` già nel save).
- Barra di selezione armi (il riquadro arma in basso a sinistra dell'HUD
  mostra già l'arma attiva da `weapon:selected`).
