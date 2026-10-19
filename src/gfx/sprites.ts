import Phaser from 'phaser';
import { makeSprites, type SpriteData } from './pixelSprite';

/**
 * Sprite del gioco come array di stringhe (indici palette 0-f, '.' = vuoto).
 *   0 black 1 plum 2 red 3 orange 4 yellow 5 lime 6 green 7 teal
 *   8 navy 9 blue a sky b cyan c white d silver e slate f charcoal
 * Le chiavi texture sono quelle di SPRITES; per sostituirle con immagini
 * Aseprite basta caricare un PNG con la stessa chiave in Boot.
 */

// ------------------------------------------------------------ Tony: testa
// 16x17: 2 righe di ciuffo di lana + faccia 16x15 (centro faccia = riga 9)

const HEAD_TOP = ['.....1..1..1....', '......1.1.1.....', '....00000000....', '..003333333300..', '.03333333333330.'];
const HEAD_SEAM = '.033e3e3e3e3330.';
const HEAD_SEAM_SWEAT = '.033e3e3e3e3a30.';
const HEAD_FOREHEAD = '0333333333333330';
const HEAD_CHEEKS = '0322333333332230';
const HEAD_BOTTOM = ['.03333333333330.', '..003333333300..', '....00000000....'];

type Rows3 = readonly [string, string, string];

function head(eyes: Rows3, mouth: Rows3, seam = HEAD_SEAM): SpriteData {
  return [...HEAD_TOP, seam, HEAD_FOREHEAD, ...eyes, HEAD_CHEEKS, ...mouth, ...HEAD_BOTTOM];
}

/** origine Y della testa: centro della faccia (riga 9.5 su 17) */
export const HEAD_ORIGIN_Y = 9.5 / 17;

const EYES_BUTTON: Rows3 = ['0330003333000330', '0330c033330c0330', '0330003333000330'];
const EYES_BLINK: Rows3 = ['0333333333333330', '0330003333000330', '0333333333333330'];
const EYES_HURT: Rows3 = ['0330333333330330', '0333003333003330', '0330333333330330'];
const EYES_DIZZY_A: Rows3 = ['0330303333030330', '0333033333303330', '0330303333030330'];
const EYES_DIZZY_B: Rows3 = ['0333033333303330', '0330003333000330', '0333033333303330'];

const MOUTH_SMILE: Rows3 = ['0333303333033330', '0333330000333330', '0333333333333330'];
const MOUTH_OUCH: Rows3 = ['0333330000333330', '0333302222033330', '0333330000333330'];
const MOUTH_DIZZY: Rows3 = ['0333333333333330', '0333300000033330', '0333333322333330'];

// ------------------------------------------------------------ Tony: corpo

const TORSO: SpriteData = [
  '..0000000000..',
  '.033333333330.',
  '033e3e3e3e3330',
  '03333333333330',
  '02333333333320',
  '02333333333320',
  '02330000000320',
  '02330c999c0320',
  '023309a9990320',
  '023309999a0320',
  '02330c999c0320',
  '02330000000320',
  '02333333333320',
  '09999999999990',
  '09e9e9e9e9e9e0',
  '09999999999990',
  '09999999999990',
  '.000000000000.',
];

const ARM_UPPER: SpriteData = [
  '.000.',
  '03330',
  '03330',
  '03e30',
  '03330',
  '03330',
  '03e30',
  '03330',
  '03330',
  '.000.',
];

const ARM_LOWER: SpriteData = [
  '.000.',
  '03330',
  '03330',
  '03e30',
  '03330',
  '0e3e0',
  '03330',
  '03330',
  '03330',
  '.000.',
];

const LEG_UPPER: SpriteData = [
  '.0000.',
  '099990',
  '099990',
  '099e90',
  '099990',
  '099990',
  '099990',
  '09e990',
  '099990',
  '033330',
  '.0000.',
];

const LEG_LOWER: SpriteData = [
  '.0000.',
  '033330',
  '033330',
  '0cccc0',
  '022220',
  '0cccc0',
  '022220',
  '0cccc0',
  '0ffff0',
  '0ffff0',
  '0ffff0',
  '.0000.',
];

const STAR_A: SpriteData = ['..4..', '..4..', '44c44', '..4..', '..4..'];
const STAR_B: SpriteData = ['.....', '..4..', '.4c4.', '..4..', '.....'];

// ------------------------------------------------------------ stanza

const WALLPAPER: SpriteData = [
  '8f88888888888888',
  '8f88888888888888',
  '8f88888888888888',
  '8f88888898888888',
  '8f8888889a988888',
  '8f88888898888888',
  '8f88888888888888',
  '8f88888888888888',
  'ff88888888888888',
  '8f88888888888888',
  '8f88888888888888',
  '8f88888888888888',
  '8f88888888888888',
  '8f88888888888888',
  '8f88888888888888',
  '8f88888888888888',
];

const BRICK: SpriteData = [
  '00000000',
  'ffff0fff',
  'ffff0fff',
  'ffff0fff',
  '00000000',
  '0fffffff',
  '0fffffff',
  '0fffffff',
];

const FLOOR: SpriteData = [
  '0000000000000000',
  '1111111101111111',
  '1121111101111111',
  '1111111101111211',
  '0000000000000000',
  '1111011111111111',
  '1111011112111111',
  '1111011111111111',
];

const PICTURE: SpriteData = [
  '0000000000000000',
  '0444444444444430',
  '04aaaaaaaaaaaa30',
  '04aaaaaaaa44aa30',
  '04aaaaaaaa44aa30',
  '04aaaaaaaaaaaa30',
  '04aa55aaaaaaaa30',
  '04a5555aaa66aa30',
  '0455555566666630',
  '0466666666666630',
  '0433333333333330',
  '0000000000000000',
];

const LAMP: SpriteData = [
  '...000...',
  '..0aaa0..',
  '.0aaaaa0.',
  '099999990',
  '000000000',
  '...4c4...',
  '....4....',
];

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
  'tony-head': head(EYES_BUTTON, MOUTH_SMILE),
  'tony-head-blink': head(EYES_BLINK, MOUTH_SMILE),
  'tony-head-hurt': head(EYES_HURT, MOUTH_OUCH, HEAD_SEAM_SWEAT),
  'tony-head-dizzy-a': head(EYES_DIZZY_A, MOUTH_DIZZY),
  'tony-head-dizzy-b': head(EYES_DIZZY_B, MOUTH_DIZZY),
  'tony-torso': TORSO,
  'tony-arm-upper': ARM_UPPER,
  'tony-arm-lower': ARM_LOWER,
  'tony-leg-upper': LEG_UPPER,
  'tony-leg-lower': LEG_LOWER,
  'fx-star-a': STAR_A,
  'fx-star-b': STAR_B,
  'room-wallpaper': WALLPAPER,
  'room-brick': BRICK,
  'room-floor': FLOOR,
  'room-picture': PICTURE,
  'room-lamp': LAMP,
  'ui-coin': COIN,
  'ui-speaker-on': SPEAKER_ON,
  'ui-speaker-off': SPEAKER_OFF,
} satisfies Record<string, SpriteData>;

export type SpriteKey = keyof typeof SPRITES;

export function registerSprites(scene: Phaser.Scene): void {
  makeSprites(scene, SPRITES);
}
