/**
 * Character roster. BASE_CHARACTERS holds the 18 office characters from base/players.png,
 * base/players2.png and base/players3.png (6 per sheet, read left to right, top to bottom);
 * CUSTOM_CHARACTERS holds user-created ones. Everything the renderer needs to draw a character
 * is data: body build, hair style, outfit pieces, accessory and palette.
 */

export type Build = 'broad' | 'slim';

export type HairStyle =
  | 'messy'
  | 'spiky'
  | 'shortCurly'
  | 'bigCurly'
  | 'longStraight'
  | 'ponytail'
  | 'wavyPonytail'
  | 'bob';

/** suit: jacket, shirt and tie. blazer: open jacket over a top. shirt: tie, rolled sleeves. */
export type TopStyle = 'suit' | 'blazer' | 'shirt' | 'blouse' | 'longCoat';

export type BottomStyle = 'pants' | 'widePants' | 'skirt';

export type ShoeStyle = 'dress' | 'heels';

export type Accessory = 'coffee' | 'handbag' | 'laptop' | 'tablet' | 'briefcase' | 'folder' | 'jacketOverShoulder';

export interface Palette {
  readonly skin: string;
  readonly hair: string;
  /** Jacket, blazer, coat, or the shirt/blouse itself when there is no jacket. */
  readonly top: string;
  /** Shirt or top worn under the jacket. */
  readonly inner: string;
  readonly tie?: string;
  readonly bottom: string;
  readonly shoes: string;
  readonly accessory: string;
  readonly accessoryDetail?: string;
  readonly scrunchie?: string;
}

export interface CharacterSpec {
  readonly id: string;
  readonly name: string;
  /** Where a base character comes from in base/; omitted for user-created characters. */
  readonly source?: { readonly sheet: 1 | 2 | 3; readonly slot: number };
  readonly build: Build;
  readonly hair: HairStyle;
  readonly top: TopStyle;
  readonly bottom: BottomStyle;
  readonly shoes: ShoeStyle;
  readonly accessory: Accessory;
  readonly glasses: boolean;
  readonly earrings: boolean;
  /** Paints the whole hair ramp one tone darker so brown hair separates clearly from the face. */
  readonly darkerHair?: boolean;
  readonly palette: Palette;
}

const WHITE_SHIRT = '#f3efe6';
const LIGHT_SKIN = '#f4c9a4';
const FAIR_SKIN = '#f7d2b0';
const TAN_SKIN = '#c98b62';
const DEEP_SKIN = '#7c4b33';
const BLACK_SHOES = '#262130';
const BROWN_SHOES = '#7a4527';

export const BASE_CHARACTERS: readonly CharacterSpec[] = [
  {
    id: 'p01-burgundy-suit',
    name: 'Mateo',
    source: { sheet: 1, slot: 1 },
    build: 'broad',
    hair: 'messy',
    top: 'suit',
    bottom: 'pants',
    shoes: 'dress',
    accessory: 'coffee',
    glasses: false,
    earrings: false,
    darkerHair: true,
    palette: {
      skin: LIGHT_SKIN,
      hair: '#3d2622',
      top: '#8f2138',
      inner: WHITE_SHIRT,
      tie: '#6e1428',
      bottom: '#8a1f36',
      shoes: BLACK_SHOES,
      accessory: '#f1e8da',
      accessoryDetail: '#8b5a3c',
    },
  },
  {
    id: 'p02-beige-blazer',
    name: 'Lucia',
    source: { sheet: 1, slot: 2 },
    build: 'slim',
    hair: 'longStraight',
    top: 'blazer',
    bottom: 'widePants',
    shoes: 'heels',
    accessory: 'handbag',
    glasses: false,
    earrings: true,
    darkerHair: true,
    palette: {
      skin: FAIR_SKIN,
      hair: '#3b2420',
      top: '#ead5b0',
      inner: '#1f2442',
      bottom: '#e2c597',
      shoes: BLACK_SHOES,
      accessory: '#6d4131',
      accessoryDetail: '#d9a441',
    },
  },
  {
    id: 'p03-forest-suit',
    name: 'Diego',
    source: { sheet: 1, slot: 3 },
    build: 'broad',
    hair: 'spiky',
    top: 'suit',
    bottom: 'pants',
    shoes: 'dress',
    accessory: 'laptop',
    glasses: false,
    earrings: false,
    darkerHair: true,
    palette: {
      skin: TAN_SKIN,
      hair: '#6b3c22',
      top: '#2f6046',
      inner: WHITE_SHIRT,
      tie: '#2f8e93',
      bottom: '#2c5a42',
      shoes: BROWN_SHOES,
      accessory: '#3a3848',
      accessoryDetail: '#9aa0b8',
    },
  },
  {
    id: 'p04-coral-skirt',
    name: 'Valeria',
    source: { sheet: 1, slot: 4 },
    build: 'slim',
    hair: 'wavyPonytail',
    top: 'blazer',
    bottom: 'skirt',
    shoes: 'heels',
    accessory: 'tablet',
    glasses: false,
    earrings: true,
    darkerHair: true,
    palette: {
      skin: TAN_SKIN,
      hair: '#4b2a1c',
      top: '#e8685a',
      inner: WHITE_SHIRT,
      bottom: '#e0604f',
      shoes: '#c8283c',
      accessory: '#2e2c3e',
      accessoryDetail: '#8fd3ea',
      scrunchie: '#f2c230',
    },
  },
  {
    id: 'p05-charcoal-suit',
    name: 'Andre',
    source: { sheet: 1, slot: 5 },
    build: 'broad',
    hair: 'shortCurly',
    top: 'suit',
    bottom: 'pants',
    shoes: 'dress',
    accessory: 'briefcase',
    glasses: true,
    earrings: false,
    palette: {
      skin: DEEP_SKIN,
      hair: '#201816',
      top: '#4b4752',
      inner: WHITE_SHIRT,
      tie: '#6b3db3',
      bottom: '#46424d',
      shoes: '#1f1b26',
      accessory: '#6b3a28',
      accessoryDetail: '#d9a441',
    },
  },
  {
    id: 'p06-lavender-blouse',
    name: 'Imani',
    source: { sheet: 1, slot: 6 },
    build: 'slim',
    hair: 'bigCurly',
    top: 'blouse',
    bottom: 'widePants',
    shoes: 'heels',
    accessory: 'folder',
    glasses: false,
    earrings: true,
    palette: {
      skin: DEEP_SKIN,
      hair: '#1e1519',
      top: '#b99be9',
      inner: '#b99be9',
      bottom: '#2f3572',
      shoes: '#7b3a9c',
      accessory: '#b0283a',
      accessoryDetail: '#f3efe6',
    },
  },
  {
    id: 'p07-green-suit',
    name: 'Tomas',
    source: { sheet: 2, slot: 1 },
    build: 'broad',
    hair: 'messy',
    top: 'suit',
    bottom: 'pants',
    shoes: 'dress',
    accessory: 'coffee',
    glasses: false,
    earrings: false,
    palette: {
      skin: LIGHT_SKIN,
      hair: '#211c2a',
      top: '#2f9d3b',
      inner: WHITE_SHIRT,
      tie: '#1f5a55',
      bottom: '#2c9538',
      shoes: BROWN_SHOES,
      accessory: '#f1e8da',
      accessoryDetail: '#a0643a',
    },
  },
  {
    id: 'p08-purple-suit',
    name: 'Bruno',
    source: { sheet: 2, slot: 2 },
    build: 'broad',
    hair: 'messy',
    top: 'suit',
    bottom: 'pants',
    shoes: 'dress',
    accessory: 'briefcase',
    glasses: false,
    earrings: false,
    darkerHair: true,
    palette: {
      skin: LIGHT_SKIN,
      hair: '#8a4122',
      top: '#7a30b0',
      inner: WHITE_SHIRT,
      tie: '#c2283a',
      bottom: '#732ca6',
      shoes: '#1f1b26',
      accessory: '#1f1d2b',
      accessoryDetail: '#d9a441',
    },
  },
  {
    id: 'p09-mint-shirt',
    name: 'Nico',
    source: { sheet: 2, slot: 3 },
    build: 'broad',
    hair: 'messy',
    top: 'shirt',
    bottom: 'pants',
    shoes: 'dress',
    accessory: 'jacketOverShoulder',
    glasses: false,
    earrings: false,
    palette: {
      skin: LIGHT_SKIN,
      hair: '#efd395',
      top: '#98dcc3',
      inner: '#98dcc3',
      tie: '#3a3945',
      bottom: '#6a5b57',
      shoes: '#1f1b26',
      accessory: '#3b3942',
    },
  },
  {
    id: 'p10-orange-blazer',
    name: 'Sofia',
    source: { sheet: 2, slot: 4 },
    build: 'slim',
    hair: 'bob',
    top: 'blazer',
    bottom: 'pants',
    shoes: 'heels',
    accessory: 'tablet',
    glasses: false,
    earrings: false,
    palette: {
      skin: FAIR_SKIN,
      hair: '#7b3ba9',
      top: '#e98639',
      inner: '#1f1b26',
      bottom: '#e27f33',
      shoes: '#1f1b26',
      accessory: '#35457f',
      accessoryDetail: '#8fd3ea',
    },
  },
  {
    id: 'p11-white-blouse',
    name: 'Elena',
    source: { sheet: 2, slot: 5 },
    build: 'slim',
    hair: 'longStraight',
    top: 'blouse',
    bottom: 'skirt',
    shoes: 'heels',
    accessory: 'folder',
    glasses: false,
    earrings: true,
    palette: {
      skin: FAIR_SKIN,
      hair: '#1d1d3b',
      top: WHITE_SHIRT,
      inner: WHITE_SHIRT,
      bottom: '#3b2b27',
      shoes: '#b3203b',
      accessory: '#b3203b',
      accessoryDetail: '#f3efe6',
    },
  },
  {
    id: 'p12-mint-blazer',
    name: 'Camila',
    source: { sheet: 2, slot: 6 },
    build: 'slim',
    hair: 'wavyPonytail',
    top: 'blazer',
    bottom: 'pants',
    shoes: 'heels',
    accessory: 'handbag',
    glasses: false,
    earrings: true,
    palette: {
      skin: FAIR_SKIN,
      hair: '#b9203b',
      top: '#a6e0bf',
      inner: WHITE_SHIRT,
      bottom: '#9fd9b8',
      shoes: '#f3efe6',
      accessory: '#d8a868',
      accessoryDetail: '#8a5a30',
      scrunchie: '#f2c230',
    },
  },
  {
    id: 'p13-red-suit',
    name: 'Rafael',
    source: { sheet: 3, slot: 1 },
    build: 'broad',
    hair: 'spiky',
    top: 'suit',
    bottom: 'pants',
    shoes: 'dress',
    accessory: 'coffee',
    glasses: false,
    earrings: false,
    palette: {
      skin: LIGHT_SKIN,
      hair: '#c2292c',
      top: '#d12a3b',
      inner: WHITE_SHIRT,
      tie: '#a81c2c',
      bottom: '#c42637',
      shoes: BROWN_SHOES,
      accessory: '#f1e8da',
      accessoryDetail: '#c2292c',
    },
  },
  {
    id: 'p14-blue-suit',
    name: 'Kenji',
    source: { sheet: 3, slot: 2 },
    build: 'broad',
    hair: 'spiky',
    top: 'suit',
    bottom: 'pants',
    shoes: 'dress',
    accessory: 'briefcase',
    glasses: false,
    earrings: false,
    palette: {
      skin: LIGHT_SKIN,
      hair: '#2b3ba9',
      top: '#2b45c9',
      inner: WHITE_SHIRT,
      tie: '#e0a93a',
      bottom: '#2941bd',
      shoes: '#1f1b26',
      accessory: '#1f1d2b',
      accessoryDetail: '#d9a441',
    },
  },
  {
    id: 'p15-yellow-shirt',
    name: 'Pablo',
    source: { sheet: 3, slot: 3 },
    build: 'broad',
    hair: 'messy',
    top: 'shirt',
    bottom: 'pants',
    shoes: 'dress',
    accessory: 'jacketOverShoulder',
    glasses: false,
    earrings: false,
    darkerHair: true,
    palette: {
      skin: LIGHT_SKIN,
      hair: '#9b6a3a',
      top: '#f1c948',
      inner: '#f1c948',
      tie: '#6b4029',
      bottom: '#4b3529',
      shoes: BROWN_SHOES,
      accessory: '#7b5031',
    },
  },
  {
    id: 'p16-pink-ponytail',
    name: 'Daniela',
    source: { sheet: 3, slot: 4 },
    build: 'slim',
    hair: 'ponytail',
    top: 'blazer',
    bottom: 'skirt',
    shoes: 'heels',
    accessory: 'folder',
    glasses: false,
    earrings: false,
    palette: {
      skin: FAIR_SKIN,
      hair: '#e9619b',
      top: '#c9283b',
      inner: WHITE_SHIRT,
      bottom: '#c42637',
      shoes: '#e25a8b',
      accessory: '#ea6c9c',
      accessoryDetail: '#f3efe6',
      scrunchie: '#f2c230',
    },
  },
  {
    id: 'p17-blue-wide-pants',
    name: 'Aiko',
    source: { sheet: 3, slot: 5 },
    build: 'slim',
    hair: 'ponytail',
    top: 'blouse',
    bottom: 'widePants',
    shoes: 'heels',
    accessory: 'tablet',
    glasses: false,
    earrings: false,
    palette: {
      skin: FAIR_SKIN,
      hair: '#1f2b79',
      top: WHITE_SHIRT,
      inner: WHITE_SHIRT,
      bottom: '#2d5de1',
      shoes: '#2c4cc9',
      accessory: '#2e2c3e',
      accessoryDetail: '#8fd3ea',
      scrunchie: '#e8508a',
    },
  },
  {
    id: 'p18-yellow-coat',
    name: 'Martina',
    source: { sheet: 3, slot: 6 },
    build: 'slim',
    hair: 'longStraight',
    top: 'longCoat',
    bottom: 'skirt',
    shoes: 'heels',
    accessory: 'handbag',
    glasses: false,
    earrings: true,
    palette: {
      skin: FAIR_SKIN,
      hair: '#1f2b6b',
      top: '#f3b94b',
      inner: WHITE_SHIRT,
      bottom: '#f0c23f',
      shoes: '#e8b030',
      accessory: '#8b5a30',
      accessoryDetail: '#d9a441',
    },
  },
];

/**
 * User-created characters, drawn after the base roster. Managed by the character-creator skill
 * (.claude/skills/character-creator): ids follow `cNN-<look>` and specs omit `source`.
 */
export const CUSTOM_CHARACTERS: readonly CharacterSpec[] = [];

/** Every character the renderer and the simulation use: base roster first, then custom ones. */
export const CHARACTERS: readonly CharacterSpec[] = [...BASE_CHARACTERS, ...CUSTOM_CHARACTERS];
