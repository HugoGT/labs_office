/**
 * Custom characters built from parts (the entrance creator). A CustomCharacterSpec is a closed
 * choice: every style comes from the renderer's own enums and every color from a curated swatch
 * list derived from the 18 base palettes, so any combination stays legible and nobody can make
 * the server draw arbitrary colors. The spec is stored by content hash; the avatar id
 * `character-custom-<hash>` is what users.avatar_id and PlayerState.avatarId carry.
 *
 * Pure TS (the roster and a pure SHA-256 only), so the browser, the server and the tools share it.
 */
import {
  BASE_CHARACTERS,
  type Accessory,
  type BottomStyle,
  type Build,
  type CharacterSpec,
  type Glasses,
  type HairStyle,
  type ShoeStyle,
  type TopStyle,
} from './characters.ts';
import { sha256Hex } from './sha256.ts';

/**
 * Bump when the renderer draws the same spec differently: the hash (and so the immutable
 * `/assets/characters/<hash>/*` URLs) changes, so no browser keeps a stale cached sheet for a
 * newly saved character. Rows saved before keep their hash and are drawn by the current renderer.
 */
export const CHARACTER_RENDER_VERSION = 2;

export const CUSTOM_CHARACTER_ID_PREFIX = 'character-custom-';
const HASH_LENGTH = 32;
const HASH_PATTERN = /^[0-9a-f]{32}$/;

export interface Swatch {
  readonly hex: string;
  readonly label: string;
}

export interface HairSwatch extends Swatch {
  /** Brown hair is painted one ramp tone darker so it separates from the face (like the pack). */
  readonly darker?: boolean;
}

export interface Option<T extends string> {
  readonly value: T;
  readonly label: string;
}

export const SKIN_TONES: readonly Swatch[] = [
  { hex: '#f7d2b0', label: 'Muy clara' },
  { hex: '#f4c9a4', label: 'Clara' },
  { hex: '#e3ae86', label: 'Media' },
  { hex: '#c98b62', label: 'Bronceada' },
  { hex: '#a8704c', label: 'Morena' },
  { hex: '#7c4b33', label: 'Oscura' },
  { hex: '#5c3626', label: 'Muy oscura' },
];

export const HAIR_COLORS: readonly HairSwatch[] = [
  { hex: '#201816', label: 'Negro' },
  { hex: '#3d2622', label: 'Castaño oscuro', darker: true },
  { hex: '#6b3c22', label: 'Castaño', darker: true },
  { hex: '#9b6a3a', label: 'Castaño claro', darker: true },
  { hex: '#efd395', label: 'Rubio' },
  { hex: '#8a4122', label: 'Cobrizo', darker: true },
  { hex: '#c2292c', label: 'Rojo' },
  { hex: '#e9619b', label: 'Rosa' },
  { hex: '#7b3ba9', label: 'Morado' },
  { hex: '#2b3ba9', label: 'Azul' },
];

export const CLOTHING_COLORS: readonly Swatch[] = [
  { hex: '#f3efe6', label: 'Blanco' },
  { hex: '#ead5b0', label: 'Beige' },
  { hex: '#f1c948', label: 'Amarillo' },
  { hex: '#e98639', label: 'Naranja' },
  { hex: '#e8685a', label: 'Coral' },
  { hex: '#d12a3b', label: 'Rojo' },
  { hex: '#8f2138', label: 'Burdeos' },
  { hex: '#b99be9', label: 'Lavanda' },
  { hex: '#7a30b0', label: 'Morado' },
  { hex: '#2b45c9', label: 'Azul' },
  { hex: '#2f3572', label: 'Azul marino' },
  { hex: '#98dcc3', label: 'Menta' },
  { hex: '#2f9d3b', label: 'Verde' },
  { hex: '#2f6046', label: 'Verde bosque' },
  { hex: '#4b4752', label: 'Gris carbón' },
  { hex: '#4b3529', label: 'Marrón' },
];

export const SHOE_COLORS: readonly Swatch[] = [
  { hex: '#262130', label: 'Negro' },
  { hex: '#7a4527', label: 'Marrón' },
  { hex: '#f3efe6', label: 'Blanco' },
  { hex: '#c8283c', label: 'Rojo' },
  { hex: '#e25a8b', label: 'Rosa' },
  { hex: '#7b3a9c', label: 'Morado' },
  { hex: '#2c4cc9', label: 'Azul' },
  { hex: '#e8b030', label: 'Dorado' },
];

export const BUILD_OPTIONS: readonly Option<Build>[] = [
  { value: 'broad', label: 'Robusta' },
  { value: 'slim', label: 'Delgada' },
];

export const HAIR_STYLE_OPTIONS: readonly Option<HairStyle>[] = [
  { value: 'messy', label: 'Despeinado' },
  { value: 'spiky', label: 'De punta' },
  { value: 'shortCurly', label: 'Rizado corto' },
  { value: 'bigCurly', label: 'Rizado voluminoso' },
  { value: 'longStraight', label: 'Largo liso' },
  { value: 'ponytail', label: 'Coleta' },
  { value: 'wavyPonytail', label: 'Coleta ondulada' },
  { value: 'bob', label: 'Melena corta' },
];

export const TOP_STYLE_OPTIONS: readonly Option<TopStyle>[] = [
  { value: 'suit', label: 'Traje con corbata' },
  { value: 'blazer', label: 'Blazer' },
  { value: 'shirt', label: 'Camisa con corbata' },
  { value: 'blouse', label: 'Blusa' },
  { value: 'longCoat', label: 'Abrigo largo' },
];

export const BOTTOM_STYLE_OPTIONS: readonly Option<BottomStyle>[] = [
  { value: 'pants', label: 'Jean' },
  { value: 'widePants', label: 'Pantalón ancho' },
  { value: 'skirt', label: 'Falda' },
];

export const SHOE_STYLE_OPTIONS: readonly Option<ShoeStyle>[] = [
  { value: 'dress', label: 'Zapatos' },
  { value: 'heels', label: 'Tacones' },
];

export const CUSTOM_ACCESSORIES: readonly Option<Accessory>[] = [
  { value: 'none', label: 'Ninguno' },
  { value: 'coffee', label: 'Café' },
  { value: 'handbag', label: 'Bolso' },
  { value: 'laptop', label: 'Portátil' },
  { value: 'tablet', label: 'Tableta' },
  { value: 'briefcase', label: 'Maletín' },
  { value: 'folder', label: 'Carpeta' },
  { value: 'jacketOverShoulder', label: 'Chaqueta al hombro' },
];

export const GLASSES_OPTIONS: readonly Option<Glasses>[] = [
  { value: 'none', label: 'Ninguno' },
  { value: 'glasses', label: 'Lentes' },
  { value: 'sunglasses', label: 'Lentes de sol' },
];

export interface CustomCharacterSpec {
  readonly build: Build;
  readonly skin: string;
  readonly hair: { readonly style: HairStyle; readonly color: string };
  readonly top: { readonly style: TopStyle; readonly color: string };
  readonly bottom: { readonly style: BottomStyle; readonly color: string };
  readonly shoes: { readonly style: ShoeStyle; readonly color: string };
  readonly accessory: Accessory;
  readonly glasses: Glasses;
  readonly earrings: boolean;
}

/** The dotted path of the first field that is not a curated choice. */
export type CustomCharacterField =
  | 'spec'
  | 'build'
  | 'skin'
  | 'hair'
  | 'hair.style'
  | 'hair.color'
  | 'top'
  | 'top.style'
  | 'top.color'
  | 'bottom'
  | 'bottom.style'
  | 'bottom.color'
  | 'shoes'
  | 'shoes.style'
  | 'shoes.color'
  | 'accessory'
  | 'glasses'
  | 'earrings';

export type CustomCharacterParse =
  | { readonly ok: true; readonly spec: CustomCharacterSpec }
  | { readonly ok: false; readonly field: CustomCharacterField };

class InvalidField extends Error {
  readonly field: CustomCharacterField;
  constructor(field: CustomCharacterField) {
    super(field);
    this.field = field;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickOption<T extends string>(options: readonly Option<T>[], value: unknown, field: CustomCharacterField): T {
  const option = options.find((candidate) => candidate.value === value);
  if (!option) throw new InvalidField(field);
  return option.value;
}

function pickColor(swatches: readonly Swatch[], value: unknown, field: CustomCharacterField): string {
  if (typeof value !== 'string') throw new InvalidField(field);
  const hex = value.toLowerCase();
  if (!swatches.some((swatch) => swatch.hex === hex)) throw new InvalidField(field);
  return hex;
}

/** Specs saved before sunglasses existed carry a boolean: `true` was the only glasses there were. */
function pickGlasses(value: unknown): Glasses {
  if (value === true) return 'glasses';
  if (value === false) return 'none';
  return pickOption(GLASSES_OPTIONS, value, 'glasses');
}

function pickBoolean(value: unknown, field: CustomCharacterField): boolean {
  if (typeof value !== 'boolean') throw new InvalidField(field);
  return value;
}

function part(input: Record<string, unknown>, key: 'hair' | 'top' | 'bottom' | 'shoes'): Record<string, unknown> {
  const value = input[key];
  if (!isRecord(value)) throw new InvalidField(key);
  return value;
}

/** Validates untrusted input (a request body, a stored row) into a canonical spec, or names the field. */
export function parseCustomCharacterSpec(input: unknown): CustomCharacterParse {
  try {
    if (!isRecord(input)) throw new InvalidField('spec');
    const build = pickOption(BUILD_OPTIONS, input.build, 'build');
    const skin = pickColor(SKIN_TONES, input.skin, 'skin');
    const hair = part(input, 'hair');
    const hairStyle = pickOption(HAIR_STYLE_OPTIONS, hair.style, 'hair.style');
    const hairColor = pickColor(HAIR_COLORS, hair.color, 'hair.color');
    const top = part(input, 'top');
    const topStyle = pickOption(TOP_STYLE_OPTIONS, top.style, 'top.style');
    const topColor = pickColor(CLOTHING_COLORS, top.color, 'top.color');
    const bottom = part(input, 'bottom');
    const bottomStyle = pickOption(BOTTOM_STYLE_OPTIONS, bottom.style, 'bottom.style');
    const bottomColor = pickColor(CLOTHING_COLORS, bottom.color, 'bottom.color');
    const shoes = part(input, 'shoes');
    const shoeStyle = pickOption(SHOE_STYLE_OPTIONS, shoes.style, 'shoes.style');
    const shoeColor = pickColor(SHOE_COLORS, shoes.color, 'shoes.color');
    return {
      ok: true,
      spec: {
        build,
        skin,
        hair: { style: hairStyle, color: hairColor },
        top: { style: topStyle, color: topColor },
        bottom: { style: bottomStyle, color: bottomColor },
        shoes: { style: shoeStyle, color: shoeColor },
        accessory: pickOption(CUSTOM_ACCESSORIES, input.accessory, 'accessory'),
        glasses: pickGlasses(input.glasses),
        earrings: pickBoolean(input.earrings, 'earrings'),
      },
    };
  } catch (error) {
    if (error instanceof InvalidField) return { ok: false, field: error.field };
    throw error;
  }
}

/** Canonical JSON: fixed key order, so equal specs always encode (and hash) the same. */
export function encodeCustomCharacterSpec(spec: CustomCharacterSpec): string {
  return JSON.stringify({
    build: spec.build,
    skin: spec.skin,
    hair: { style: spec.hair.style, color: spec.hair.color },
    top: { style: spec.top.style, color: spec.top.color },
    bottom: { style: spec.bottom.style, color: spec.bottom.color },
    shoes: { style: spec.shoes.style, color: spec.shoes.color },
    accessory: spec.accessory,
    glasses: spec.glasses,
    earrings: spec.earrings,
  });
}

export function customCharacterHash(spec: CustomCharacterSpec, renderVersion: number = CHARACTER_RENDER_VERSION): string {
  return sha256Hex(`custom-character:v${renderVersion}:${encodeCustomCharacterSpec(spec)}`).slice(0, HASH_LENGTH);
}

export function customCharacterId(hash: string): string {
  return `${CUSTOM_CHARACTER_ID_PREFIX}${hash}`;
}

export function isCustomCharacterHash(value: string): boolean {
  return HASH_PATTERN.test(value);
}

/** The hash of a `character-custom-<hash>` avatar id, or null for any other id. */
export function customCharacterHashOf(avatarId: string): string | null {
  if (!avatarId.startsWith(CUSTOM_CHARACTER_ID_PREFIX)) return null;
  const hash = avatarId.slice(CUSTOM_CHARACTER_ID_PREFIX.length);
  return isCustomCharacterHash(hash) ? hash : null;
}

const WHITE_SHIRT = '#f3efe6';
const NAVY_SHIRT = '#1f2442';
const SHIRT_TIE = '#3a3945';
const BLOND = '#efd395';

/** Fixed colors per held item, taken from the base characters that carry it. */
const ACCESSORY_COLORS: Readonly<Record<Accessory, { readonly main: string; readonly detail?: string }>> = {
  none: { main: '#3b3942' },
  coffee: { main: '#f1e8da', detail: '#8b5a3c' },
  handbag: { main: '#6d4131', detail: '#d9a441' },
  laptop: { main: '#3a3848', detail: '#9aa0b8' },
  tablet: { main: '#2e2c3e', detail: '#8fd3ea' },
  briefcase: { main: '#6b3a28', detail: '#d9a441' },
  folder: { main: '#b0283a', detail: '#f3efe6' },
  jacketOverShoulder: { main: '#3b3942' },
};

function darken(hex: string, amount: number): string {
  const channel = (offset: number): string =>
    Math.round(Number.parseInt(hex.slice(offset, offset + 2), 16) * (1 - amount))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

function hasJacket(style: TopStyle): boolean {
  return style === 'suit' || style === 'blazer' || style === 'longCoat';
}

/** The renderer's spec: chosen colors as they are, the rest derived so it reads like the pack. */
export function toCharacterSpec(custom: CustomCharacterSpec): CharacterSpec {
  const lightTop = custom.top.color === WHITE_SHIRT || custom.top.color === '#ead5b0';
  const inner = hasJacket(custom.top.style) ? (lightTop ? NAVY_SHIRT : WHITE_SHIRT) : custom.top.color;
  const tie = custom.top.style === 'suit' ? darken(custom.top.color, 0.25) : custom.top.style === 'shirt' ? SHIRT_TIE : undefined;
  const accessory = ACCESSORY_COLORS[custom.accessory];
  const darker = HAIR_COLORS.find((swatch) => swatch.hex === custom.hair.color)?.darker === true;
  return {
    id: customCharacterId(customCharacterHash(custom)),
    name: 'Personaje propio',
    build: custom.build,
    hair: custom.hair.style,
    top: custom.top.style,
    bottom: custom.bottom.style,
    shoes: custom.shoes.style,
    accessory: custom.accessory,
    glasses: custom.glasses,
    earrings: custom.earrings,
    darkerHair: darker,
    palette: {
      skin: custom.skin,
      hair: custom.hair.color,
      top: custom.top.color,
      inner,
      ...(tie ? { tie } : {}),
      bottom: custom.bottom.color,
      shoes: custom.shoes.color,
      accessory: accessory.main,
      ...(accessory.detail ? { accessoryDetail: accessory.detail } : {}),
      scrunchie: custom.hair.color === BLOND ? '#e8508a' : '#f2c230',
    },
  };
}

function rgbOf(hex: string): readonly [number, number, number] {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)) as unknown as readonly [number, number, number];
}

function nearest(swatches: readonly Swatch[], hex: string): string {
  const [r, g, b] = rgbOf(hex.toLowerCase());
  let best = swatches[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const swatch of swatches) {
    const [sr, sg, sb] = rgbOf(swatch.hex);
    const distance = (sr - r) ** 2 + (sg - g) ** 2 + (sb - b) ** 2;
    if (distance < bestDistance) {
      best = swatch;
      bestDistance = distance;
    }
  }
  return best.hex;
}

/** A base character as a starting point: same parts, each color snapped to its closest swatch. */
export function templateFromBase(base: CharacterSpec): CustomCharacterSpec {
  const p = base.palette;
  return {
    build: base.build,
    skin: nearest(SKIN_TONES, p.skin),
    hair: { style: base.hair, color: nearest(HAIR_COLORS, p.hair) },
    top: { style: base.top, color: nearest(CLOTHING_COLORS, p.top) },
    bottom: { style: base.bottom, color: nearest(CLOTHING_COLORS, p.bottom) },
    shoes: { style: base.shoes, color: nearest(SHOE_COLORS, p.shoes) },
    accessory: base.accessory,
    glasses: base.glasses,
    earrings: base.earrings,
  };
}

export interface CharacterTemplate {
  /** The pack piece the template comes from (`character-<base id>`). */
  readonly baseId: string;
  readonly name: string;
  readonly spec: CustomCharacterSpec;
}

export const CHARACTER_TEMPLATES: readonly CharacterTemplate[] = BASE_CHARACTERS.map((base) => ({
  baseId: `character-${base.id}`,
  name: base.name,
  spec: templateFromBase(base),
}));
