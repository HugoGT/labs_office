/**
 * Custom characters built from parts (the entrance creator). Every style comes from the
 * renderer's own enums; every color is any `#rrggbb`, with curated swatch lists (taken from the
 * 18 base palettes) offered as presets only. The derived colors (shirt, tie, scrunchie, darker
 * hair) follow rules that keep any combination legible. The spec is stored by content hash; the avatar id
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
export const CHARACTER_RENDER_VERSION = 4;

export const CUSTOM_CHARACTER_ID_PREFIX = 'character-custom-';
const HASH_LENGTH = 32;
const HASH_PATTERN = /^[0-9a-f]{32}$/;

export interface Swatch {
  readonly hex: string;
  readonly label: string;
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

export const HAIR_COLORS: readonly Swatch[] = [
  { hex: '#201816', label: 'Negro' },
  { hex: '#3d2622', label: 'Castaño oscuro' },
  { hex: '#6b3c22', label: 'Castaño' },
  { hex: '#9b6a3a', label: 'Castaño claro' },
  { hex: '#efd395', label: 'Rubio' },
  { hex: '#8a4122', label: 'Cobrizo' },
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

/** The dotted path of the first field that is not a valid choice (an unknown style or a malformed color). */
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

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Any `#rrggbb`, normalized to lower case; the swatch lists are presets, not limits. */
function pickColor(value: unknown, field: CustomCharacterField): string {
  if (typeof value !== 'string' || !HEX_COLOR.test(value)) throw new InvalidField(field);
  return value.toLowerCase();
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
    const skin = pickColor(input.skin, 'skin');
    const hair = part(input, 'hair');
    const hairStyle = pickOption(HAIR_STYLE_OPTIONS, hair.style, 'hair.style');
    const hairColor = pickColor(hair.color, 'hair.color');
    const top = part(input, 'top');
    const topStyle = pickOption(TOP_STYLE_OPTIONS, top.style, 'top.style');
    const topColor = pickColor(top.color, 'top.color');
    const bottom = part(input, 'bottom');
    const bottomStyle = pickOption(BOTTOM_STYLE_OPTIONS, bottom.style, 'bottom.style');
    const bottomColor = pickColor(bottom.color, 'bottom.color');
    const shoes = part(input, 'shoes');
    const shoeStyle = pickOption(SHOE_STYLE_OPTIONS, shoes.style, 'shoes.style');
    const shoeColor = pickColor(shoes.color, 'shoes.color');
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
const SCRUNCHIE = '#f2c230';

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

function rgbOf(hex: string): readonly [number, number, number] {
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)) as unknown as readonly [number, number, number];
}

function toHex(channels: readonly number[]): string {
  return `#${channels.map((value) => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0')).join('')}`;
}

/** Toward black (`amount` > 0) or toward white (`amount` < 0). */
function shade(hex: string, amount: number): string {
  return toHex(rgbOf(hex).map((value) => (amount >= 0 ? value * (1 - amount) : value + (255 - value) * -amount)));
}

/** Relative luminance, 0 (black) to 1 (white). */
function luminance(hex: string): number {
  const [r, g, b] = rgbOf(hex).map((value) => value / 255) as unknown as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function distance(a: string, b: string): number {
  const [ar, ag, ab] = rgbOf(a);
  const [br, bg, bb] = rgbOf(b);
  return Math.hypot(ar - br, ag - bg, ab - bb);
}

/**
 * Warm mid browns get the darker hair ramp so they separate from the face, as
 * the pack does by hand (`darkerHair`): red over green over blue, a clear warm
 * lean, and not light. It reproduces every base character's choice.
 */
function darkerHair(hex: string): boolean {
  const [r, g, b] = rgbOf(hex);
  return r > g && g > b && r - b >= 0x18 && luminance(hex) < 0.5;
}

function hasJacket(style: TopStyle): boolean {
  return style === 'suit' || style === 'blazer' || style === 'longCoat';
}

/** A suit's tie: darker than a light or mid jacket, lighter than a very dark one, never the jacket itself. */
function tieFor(jacket: string): string {
  return luminance(jacket) < 0.2 ? shade(jacket, -0.35) : shade(jacket, 0.25);
}

/** The renderer's spec: chosen colors as they are, the rest derived so it reads like the pack. */
export function toCharacterSpec(custom: CustomCharacterSpec): CharacterSpec {
  // A white shirt under a jacket, unless the jacket is light enough to swallow it.
  const lightTop = luminance(custom.top.color) > 0.6;
  const inner = hasJacket(custom.top.style) ? (lightTop ? NAVY_SHIRT : WHITE_SHIRT) : custom.top.color;
  const tie = custom.top.style === 'suit' ? tieFor(custom.top.color) : custom.top.style === 'shirt' ? SHIRT_TIE : undefined;
  const accessory = ACCESSORY_COLORS[custom.accessory];
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
    darkerHair: darkerHair(custom.hair.color),
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
      // Yellow, unless the hair is close enough to yellow to hide it.
      scrunchie: distance(custom.hair.color, SCRUNCHIE) < 128 ? '#e8508a' : SCRUNCHIE,
    },
  };
}

/** A base character as a starting point: same parts and the same colors. */
export function templateFromBase(base: CharacterSpec): CustomCharacterSpec {
  const p = base.palette;
  return {
    build: base.build,
    skin: p.skin.toLowerCase(),
    hair: { style: base.hair, color: p.hair.toLowerCase() },
    top: { style: base.top, color: p.top.toLowerCase() },
    bottom: { style: base.bottom, color: p.bottom.toLowerCase() },
    shoes: { style: base.shoes, color: p.shoes.toLowerCase() },
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
