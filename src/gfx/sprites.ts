import Phaser from 'phaser';
import { makeSprites, type SpriteData } from './pixelSprite';

/**
 * Sprite del gioco come array di stringhe (indici palette 0-f, '.' = vuoto).
 *   0 black 1 plum 2 red 3 orange 4 yellow 5 lime 6 green 7 teal
 *   8 navy 9 blue a sky b cyan c white d silver e slate f charcoal
 *   g pink (#f2a7a0, solo per la pelle di Tony)
 * Le chiavi texture sono quelle di SPRITES; per sostituirle con immagini
 * Aseprite basta caricare un PNG con la stessa chiave in Boot.
 */

// ------------------------------------------------------------ Tony: pelle
// Tony è un operaio dalla pelle rosa. Le parti di pelle negli sprite sono
// scritte con segnaposto ('s' base, 'h' ombra, 'l' luce) e skin() li converte
// negli indici qui sotto: per cambiare carnagione basta cambiare le costanti.
//   g #f2a7a0 rosa: 17° colore aggiunto a Sweetie 16 SOLO per la pelle
//   3 #ef7d57 pesca: ombra calda, resta rosata accanto al rosa
//   c #f4f4f4 bianco: riflessi
const SKIN_BASE = 'g';
const SKIN_SHADE = '3';
const SKIN_LIGHT = 'c';

function skin(rows: SpriteData): SpriteData {
  return rows.map((r) => r.replace(/s/g, SKIN_BASE).replace(/h/g, SKIN_SHADE).replace(/l/g, SKIN_LIGHT));
}

// ------------------------------------------------------------ Tony: testa
// 16x17: caschetto giallo (righe 0-5, falda sporgente alla riga 5, bordo scuro
// alla riga 6) + faccia sotto la falda.

const HELMET = [
  '.....000000.....',
  '...004c444300...',
  '..04c444444430..',
  '.04c44444444330.',
  '.04444444444330.',
  '0444444444444330',
];
const BRIM_EDGE = '0000000000000000';
const CHEEKS = '0shhsssssssshhs0';
const CHEEKS_SWEAT = '0shhsssssssshha0';
const CHIN = ['.0sssssssssssh0.', '..00sssssshh00..', '....00000000....'];

type Rows3 = readonly [string, string, string];

function head(eyes: Rows3, mouth: Rows3, sweat = false): SpriteData {
  return skin([
    ...HELMET,
    BRIM_EDGE,
    ...eyes,
    sweat ? CHEEKS_SWEAT : CHEEKS,
    ...mouth,
    ...CHIN,
  ]);
}

/** origine Y della testa: centro del cerchio fisico (riga 9.5 su 17, sotto la falda) */
export const HEAD_ORIGIN_Y = 9.5 / 17;

const EYES_OPEN: Rows3 = ['0hssssssssssssh0', '0ssc0ssssss0css0', '0ssc0ssssss0css0'];
const EYES_BLINK: Rows3 = ['0hssssssssssssh0', '0ssssssssssssss0', '0ss00ssssss00ss0'];
const EYES_HURT: Rows3 = ['0ss0ssssssss0sa0', '0sss00ssss00sss0', '0ss0ssssssss0ss0'];
const EYES_DIZZY_A: Rows3 = ['0ss0s0ssss0s0ss0', '0sss0ssssss0sss0', '0ss0s0ssss0s0ss0'];
const EYES_DIZZY_B: Rows3 = ['0sss0ssssss0sss0', '0ss000ssss000ss0', '0sss0ssssss0sss0'];

const MOUTH_SMILE: Rows3 = ['0ssss0ssss0ssss0', '0sssss0000sssss0', '0ssssssssssssss0'];
const MOUTH_OUCH: Rows3 = ['0sssss0000sssss0', '0ssss022220ssss0', '0sssss0000sssss0'];
const MOUTH_DIZZY: Rows3 = ['0ssssssssssssss0', '0ssss000000ssss0', '0sssssss22sssss0'];

// ------------------------------------------------------------ Tony: corpo
// Maglietta nera (f/0), pettorina gialla (4/3) con bande riflettenti (d/c)
// e apertura centrale, cintura e jeans (9/8/a), scarpe antinfortunistiche.

const TORSO: SpriteData = [
  '..0000000000..',
  '.0444ffff4430.',
  '0444ff00ff4430',
  '04444ffff44430',
  '04444ffff44430',
  '0cdddffffdddd0',
  '04444ffff44430',
  '04444ffff44430',
  '04444ffff44430',
  '0cdddffffdddd0',
  '04444ffff44430',
  '04444ffff44330',
  '03333ffff33330',
  '0fffffddfffff0',
  '09999999999980',
  '0a999998999980',
  '09999998999880',
  '.000000000000.',
];

/** braccio superiore: bordo della pettorina, manica corta nera, pelle */
const ARM_UPPER: SpriteData = [
  '.000.',
  '04430',
  '0fff0',
  '0fff0',
  '0fff0',
  '00000',
  '0lsh0',
  '0ssh0',
  '0ssh0',
  '.000.',
];

/** avambraccio rosa + guanto da lavoro (polsino giallo) */
const ARM_LOWER: SpriteData = [
  '.000.',
  '0lsh0',
  '0ssh0',
  '0ssh0',
  '0ssh0',
  '0ssh0',
  '04430',
  '0dde0',
  '0dde0',
  '.000.',
];

const LEG_UPPER: SpriteData = [
  '.0000.',
  '099980',
  '0a9980',
  '0a9980',
  '099980',
  '099980',
  '099980',
  '099980',
  '0a9980',
  '099880',
  '.0000.',
];

/** jeans con risvolto + scarpa antinfortunistica (lacci gialli, puntale) */
const LEG_LOWER: SpriteData = [
  '.0000.',
  '099980',
  '0a9980',
  '099980',
  '099980',
  '088880',
  '0f44f0',
  '0ffff0',
  '0ddef0',
  '0eeef0',
  '0ffff0',
  '.0000.',
];

const STAR_A: SpriteData = ['..4..', '..4..', '44c44', '..4..', '..4..'];
const STAR_B: SpriteData = ['.....', '..4..', '.4c4.', '..4..', '.....'];

// ------------------------------------------------------------ UI

const COIN: SpriteData = [
  '.00000.',
  '04c4440',
  '0c44440',
  '0444430',
  '0444430',
  '0443330',
  '.00000.',
];

const SPEAKER_ON: SpriteData = [
  '...c..c',
  '..cc.c.',
  'cccc..c',
  'cccc..c',
  'cccc..c',
  '..cc.c.',
  '...c..c',
];

const SPEAKER_OFF: SpriteData = [
  '...c...',
  '..cc...',
  'cccc2.2',
  'cccc.2.',
  'cccc2.2',
  '..cc...',
  '...c...',
];

export const SPRITES = {
  'tony-head': head(EYES_OPEN, MOUTH_SMILE),
  'tony-head-blink': head(EYES_BLINK, MOUTH_SMILE),
  'tony-head-hurt': head(EYES_HURT, MOUTH_OUCH, true),
  'tony-head-dizzy-a': head(EYES_DIZZY_A, MOUTH_DIZZY),
  'tony-head-dizzy-b': head(EYES_DIZZY_B, MOUTH_DIZZY),
  'tony-torso': TORSO,
  'tony-arm-upper': skin(ARM_UPPER),
  'tony-arm-lower': skin(ARM_LOWER),
  'tony-leg-upper': LEG_UPPER,
  'tony-leg-lower': LEG_LOWER,
  'fx-star-a': STAR_A,
  'fx-star-b': STAR_B,
  'ui-coin': COIN,
  'ui-speaker-on': SPEAKER_ON,
  'ui-speaker-off': SPEAKER_OFF,
} satisfies Record<string, SpriteData>;

export type SpriteKey = keyof typeof SPRITES;

export function registerSprites(scene: Phaser.Scene): void {
  makeSprites(scene, SPRITES);
}
