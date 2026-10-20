import { describe, expect, it } from 'vitest';
import { BASE_CHARACTERS } from './characters.ts';
import { renderCharacterSheets } from './characterSheets.ts';
import {
  BUILD_OPTIONS,
  CHARACTER_RENDER_VERSION,
  CLOTHING_COLORS,
  CUSTOM_ACCESSORIES,
  CUSTOM_CHARACTER_ID_PREFIX,
  HAIR_COLORS,
  HAIR_STYLE_OPTIONS,
  BOTTOM_STYLE_OPTIONS,
  SHOE_COLORS,
  SHOE_STYLE_OPTIONS,
  SKIN_TONES,
  TOP_STYLE_OPTIONS,
  CHARACTER_TEMPLATES,
  customCharacterHash,
  customCharacterHashOf,
  customCharacterId,
  encodeCustomCharacterSpec,
  parseCustomCharacterSpec,
  templateFromBase,
  toCharacterSpec,
  type CustomCharacterSpec,
} from './customCharacter.ts';

const SPEC: CustomCharacterSpec = {
  build: 'slim',
  skin: SKIN_TONES[2]!.hex,
  hair: { style: 'bob', color: HAIR_COLORS[0]!.hex },
  top: { style: 'blazer', color: CLOTHING_COLORS[3]!.hex },
  bottom: { style: 'skirt', color: CLOTHING_COLORS[5]!.hex },
  shoes: { style: 'heels', color: SHOE_COLORS[1]!.hex },
  accessory: 'tablet',
  glasses: true,
  earrings: false,
};

describe('curated options', () => {
  it('keeps every list unique and within its curated size', () => {
    for (const [list, min, max] of [
      [SKIN_TONES, 6, 8],
      [HAIR_COLORS, 8, 10],
      [CLOTHING_COLORS, 12, 16],
      [SHOE_COLORS, 4, 8],
    ] as const) {
      expect(list.length).toBeGreaterThanOrEqual(min);
      expect(list.length).toBeLessThanOrEqual(max);
      expect(new Set(list.map((swatch) => swatch.hex)).size).toBe(list.length);
      for (const swatch of list) {
        expect(swatch.hex).toMatch(/^#[0-9a-f]{6}$/);
        expect(swatch.label.length).toBeGreaterThan(0);
      }
    }
    for (const options of [BUILD_OPTIONS, HAIR_STYLE_OPTIONS, TOP_STYLE_OPTIONS, BOTTOM_STYLE_OPTIONS, SHOE_STYLE_OPTIONS, CUSTOM_ACCESSORIES]) {
      expect(new Set(options.map((option) => option.value)).size).toBe(options.length);
    }
  });
});

describe('parseCustomCharacterSpec', () => {
  it('accepts a spec built from the lists and returns a canonical copy without extra keys', () => {
    const result = parseCustomCharacterSpec({ ...SPEC, extra: 1, hair: { ...SPEC.hair, shine: true } });
    expect(result).toEqual({ ok: true, spec: SPEC });
  });

  it('accepts upper case colors as the same swatch', () => {
    const result = parseCustomCharacterSpec({ ...SPEC, skin: SPEC.skin.toUpperCase() });
    expect(result).toEqual({ ok: true, spec: SPEC });
  });

  it.each([
    [null, 'spec'],
    ['spec', 'spec'],
    [[], 'spec'],
    [{ ...SPEC, build: 'tall' }, 'build'],
    [{ ...SPEC, skin: '#123456' }, 'skin'],
    [{ ...SPEC, hair: 'bob' }, 'hair'],
    [{ ...SPEC, hair: { style: 'mohawk', color: SPEC.hair.color } }, 'hair.style'],
    [{ ...SPEC, hair: { style: 'bob', color: '#000001' } }, 'hair.color'],
    [{ ...SPEC, top: { style: 'hoodie', color: SPEC.top.color } }, 'top.style'],
    [{ ...SPEC, top: { style: 'suit', color: SKIN_TONES[0]!.hex } }, 'top.color'],
    [{ ...SPEC, bottom: { style: 'shorts', color: SPEC.bottom.color } }, 'bottom.style'],
    [{ ...SPEC, bottom: { style: 'pants', color: 42 } }, 'bottom.color'],
    [{ ...SPEC, shoes: { style: 'boots', color: SPEC.shoes.color } }, 'shoes.style'],
    [{ ...SPEC, shoes: { style: 'dress', color: '#ffffff' } }, 'shoes.color'],
    [{ ...SPEC, accessory: 'umbrella' }, 'accessory'],
    [{ ...SPEC, glasses: 'yes' }, 'glasses'],
    [{ ...SPEC, earrings: undefined }, 'earrings'],
  ])('rejects %j at %s', (input, field) => {
    expect(parseCustomCharacterSpec(input)).toEqual({ ok: false, field });
  });
});

describe('canonical encoding and hash', () => {
  it('encodes the same spec the same way whatever the key order', () => {
    const reversed = Object.fromEntries(Object.entries(SPEC).reverse());
    const shuffled = { ...reversed, hair: { color: SPEC.hair.color, style: SPEC.hair.style } } as CustomCharacterSpec;
    expect(encodeCustomCharacterSpec(shuffled)).toBe(encodeCustomCharacterSpec(SPEC));
  });

  it('hashes to 32 lower case hex digits that change with the spec and with the render version', () => {
    const hash = customCharacterHash(SPEC);
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
    expect(customCharacterHash({ ...SPEC })).toBe(hash);
    expect(customCharacterHash({ ...SPEC, glasses: false })).not.toBe(hash);
    expect(customCharacterHash(SPEC, CHARACTER_RENDER_VERSION + 1)).not.toBe(hash);
  });

  it('round-trips the avatar id of a hash and refuses anything else', () => {
    const hash = customCharacterHash(SPEC);
    const id = customCharacterId(hash);
    expect(id).toBe(`${CUSTOM_CHARACTER_ID_PREFIX}${hash}`);
    expect(customCharacterHashOf(id)).toBe(hash);
    expect(customCharacterHashOf('character-p01-burgundy-suit')).toBeNull();
    expect(customCharacterHashOf(`${CUSTOM_CHARACTER_ID_PREFIX}${hash.toUpperCase()}`)).toBeNull();
    expect(customCharacterHashOf(`${CUSTOM_CHARACTER_ID_PREFIX}${hash}0`)).toBeNull();
  });
});

describe('toCharacterSpec', () => {
  it('paints the chosen colors and derives the rest', () => {
    const spec = toCharacterSpec(SPEC);
    expect(spec).toMatchObject({
      id: customCharacterId(customCharacterHash(SPEC)),
      build: 'slim',
      hair: 'bob',
      top: 'blazer',
      bottom: 'skirt',
      shoes: 'heels',
      accessory: 'tablet',
      glasses: true,
      earrings: false,
      palette: { skin: SPEC.skin, hair: SPEC.hair.color, top: SPEC.top.color, bottom: SPEC.bottom.color, shoes: SPEC.shoes.color },
    });
    expect(spec.palette.inner).not.toBe(SPEC.top.color);
  });

  it('uses the top color as the shirt itself when there is no jacket', () => {
    const spec = toCharacterSpec({ ...SPEC, top: { style: 'blouse', color: SPEC.top.color } });
    expect(spec.palette.inner).toBe(SPEC.top.color);
  });

  it('draws every option of every part', () => {
    const rounds = Math.max(HAIR_STYLE_OPTIONS.length, TOP_STYLE_OPTIONS.length, CUSTOM_ACCESSORIES.length);
    for (let i = 0; i < rounds; i += 1) {
      const pick = <T,>(list: readonly T[]): T => list[i % list.length]!;
      const custom: CustomCharacterSpec = {
        build: pick(BUILD_OPTIONS).value,
        skin: pick(SKIN_TONES).hex,
        hair: { style: pick(HAIR_STYLE_OPTIONS).value, color: pick(HAIR_COLORS).hex },
        top: { style: pick(TOP_STYLE_OPTIONS).value, color: pick(CLOTHING_COLORS).hex },
        bottom: { style: pick(BOTTOM_STYLE_OPTIONS).value, color: pick(CLOTHING_COLORS).hex },
        shoes: { style: pick(SHOE_STYLE_OPTIONS).value, color: pick(SHOE_COLORS).hex },
        accessory: pick(CUSTOM_ACCESSORIES).value,
        glasses: i % 2 === 0,
        earrings: i % 3 === 0,
      };
      const { walk, seated } = renderCharacterSheets(toCharacterSpec(custom));
      expect(walk.countOpaque()).toBeGreaterThan(0);
      expect(seated.countOpaque()).toBeGreaterThan(0);
    }
  });

  it('draws no accessory for none', () => {
    const none = renderCharacterSheets(toCharacterSpec({ ...SPEC, accessory: 'none' })).walk;
    const tablet = renderCharacterSheets(toCharacterSpec(SPEC)).walk;
    expect(none.countOpaque()).toBeLessThan(tablet.countOpaque());
  });
});

describe('templates', () => {
  it('turns every base character into a valid spec with its own parts', () => {
    expect(CHARACTER_TEMPLATES).toHaveLength(BASE_CHARACTERS.length);
    for (const base of BASE_CHARACTERS) {
      const template = templateFromBase(base);
      expect(parseCustomCharacterSpec(template)).toEqual({ ok: true, spec: template });
      expect(template).toMatchObject({
        build: base.build,
        hair: { style: base.hair },
        top: { style: base.top },
        bottom: { style: base.bottom },
        shoes: { style: base.shoes },
        accessory: base.accessory,
        glasses: base.glasses,
        earrings: base.earrings,
      });
    }
  });

  it('keeps the exact colors of a base character whose colors are curated', () => {
    const base = BASE_CHARACTERS[0]!;
    const template = templateFromBase(base);
    expect(template.skin).toBe(base.palette.skin);
    expect(template.top.color).toBe(base.palette.top);
  });

  it('names each template after its base character', () => {
    expect(CHARACTER_TEMPLATES.map((template) => template.name)).toEqual(BASE_CHARACTERS.map((base) => base.name));
    expect(CHARACTER_TEMPLATES[0]!.baseId).toBe(`character-${BASE_CHARACTERS[0]!.id}`);
  });
});
