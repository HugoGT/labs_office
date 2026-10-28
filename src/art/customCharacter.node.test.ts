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
  GLASSES_OPTIONS,
  customCharacterHash,
  customCharacterHashOf,
  customCharacterId,
  encodeCustomCharacterSpec,
  parseCustomCharacterSpec,
  templateFromBase,
  toCharacterSpec,
  type CustomCharacterSpec,
} from './customCharacter.ts';

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  return Math.abs(luminance(a) - luminance(b));
}

const SPEC: CustomCharacterSpec = {
  build: 'slim',
  skin: SKIN_TONES[2]!.hex,
  hair: { style: 'bob', color: HAIR_COLORS[0]!.hex },
  top: { style: 'blazer', color: CLOTHING_COLORS[3]!.hex },
  bottom: { style: 'skirt', color: CLOTHING_COLORS[5]!.hex },
  shoes: { style: 'heels', color: SHOE_COLORS[1]!.hex },
  accessory: 'tablet',
  glasses: 'glasses',
  earrings: false,
};

describe('curated options', () => {
  it('keeps every preset list unique and within its curated size', () => {
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

  it('still reads the boolean glasses of specs saved before sunglasses existed', () => {
    expect(parseCustomCharacterSpec({ ...SPEC, glasses: true })).toEqual({ ok: true, spec: { ...SPEC, glasses: 'glasses' } });
    expect(parseCustomCharacterSpec({ ...SPEC, glasses: false })).toEqual({ ok: true, spec: { ...SPEC, glasses: 'none' } });
  });

  it('offers no glasses, glasses and sunglasses', () => {
    expect(GLASSES_OPTIONS.map((option) => [option.value, option.label])).toEqual([
      ['none', 'Ninguno'],
      ['glasses', 'Lentes'],
      ['sunglasses', 'Lentes de sol'],
    ]);
  });

  it('accepts upper case colors, normalized to lower case', () => {
    const result = parseCustomCharacterSpec({ ...SPEC, skin: SPEC.skin.toUpperCase() });
    expect(result).toEqual({ ok: true, spec: SPEC });
  });

  it('accepts any rgb color, presets being only suggestions', () => {
    const spec = {
      ...SPEC,
      skin: '#123456',
      hair: { style: 'bob', color: '#00FF7f' },
      top: { style: 'suit', color: '#000000' },
      bottom: { style: 'pants', color: '#ffffff' },
      shoes: { style: 'dress', color: '#abcdef' },
    };
    expect(parseCustomCharacterSpec(spec)).toEqual({ ok: true, spec: { ...spec, hair: { style: 'bob', color: '#00ff7f' } } });
  });

  it.each([
    [null, 'spec'],
    ['spec', 'spec'],
    [[], 'spec'],
    [{ ...SPEC, build: 'tall' }, 'build'],
    [{ ...SPEC, skin: '#12345' }, 'skin'],
    [{ ...SPEC, skin: '#1234567' }, 'skin'],
    [{ ...SPEC, skin: 'red' }, 'skin'],
    [{ ...SPEC, skin: '123456' }, 'skin'],
    [{ ...SPEC, hair: 'bob' }, 'hair'],
    [{ ...SPEC, hair: { style: 'mohawk', color: SPEC.hair.color } }, 'hair.style'],
    [{ ...SPEC, hair: { style: 'bob', color: '#00000g' } }, 'hair.color'],
    [{ ...SPEC, top: { style: 'hoodie', color: SPEC.top.color } }, 'top.style'],
    [{ ...SPEC, top: { style: 'suit', color: 'rgb(1,2,3)' } }, 'top.color'],
    [{ ...SPEC, bottom: { style: 'shorts', color: SPEC.bottom.color } }, 'bottom.style'],
    [{ ...SPEC, bottom: { style: 'pants', color: 42 } }, 'bottom.color'],
    [{ ...SPEC, shoes: { style: 'boots', color: SPEC.shoes.color } }, 'shoes.style'],
    [{ ...SPEC, shoes: { style: 'dress', color: ' #ffffff' } }, 'shoes.color'],
    [{ ...SPEC, accessory: 'umbrella' }, 'accessory'],
    [{ ...SPEC, glasses: 'yes' }, 'glasses'],
    [{ ...SPEC, glasses: 1 }, 'glasses'],
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
    expect(customCharacterHash({ ...SPEC, glasses: 'sunglasses' })).not.toBe(hash);
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
      glasses: 'glasses',
      earrings: false,
      palette: { skin: SPEC.skin, hair: SPEC.hair.color, top: SPEC.top.color, bottom: SPEC.bottom.color, shoes: SPEC.shoes.color },
    });
    expect(spec.palette.inner).not.toBe(SPEC.top.color);
  });

  it.each(['#000000', '#ffffff', '#f3efe6', '#808080', '#ff00ff'])('derives a shirt and tie that stand out from a %s jacket', (color) => {
    const spec = toCharacterSpec({ ...SPEC, top: { style: 'suit', color } });
    expect(contrast(spec.palette.inner, color)).toBeGreaterThan(0.3);
    expect(spec.palette.tie).toMatch(/^#[0-9a-f]{6}$/);
    expect(spec.palette.tie).not.toBe(color);
  });

  it('keeps the scrunchie apart from hair of the same yellow', () => {
    const yellow = toCharacterSpec({ ...SPEC, hair: { style: 'ponytail', color: '#f2c230' } });
    expect(yellow.palette.scrunchie).not.toBe('#f2c230');
    const blond = toCharacterSpec({ ...SPEC, hair: { style: 'ponytail', color: '#efd395' } });
    expect(blond.palette.scrunchie).toBe('#e8508a');
  });

  it('pins the hash of a fixed spec, so a new render version or encoding is a visible decision', () => {
    // Version 4: derived colors follow rules for any rgb input. Update only together with the version.
    expect(CHARACTER_RENDER_VERSION).toBe(4);
    expect(customCharacterHash(CHARACTER_TEMPLATES[0]!.spec)).toBe('23fb28cf061fb37021d909fb39d7b97a');
  });

  it('uses the top color as the shirt itself when there is no jacket', () => {
    const spec = toCharacterSpec({ ...SPEC, top: { style: 'blouse', color: SPEC.top.color } });
    expect(spec.palette.inner).toBe(SPEC.top.color);
  });

  // Renders every option's full walk and seated sheets: under 1s locally, but
  // a loaded CI shard ran it past the 5s default, so it gets its own budget.
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
        glasses: pick(GLASSES_OPTIONS).value,
        earrings: i % 3 === 0,
      };
      const { walk, seated } = renderCharacterSheets(toCharacterSpec(custom));
      expect(walk.countOpaque()).toBeGreaterThan(0);
      expect(seated.countOpaque()).toBeGreaterThan(0);
    }
  }, 20000);

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

  it('keeps the exact colors of every base character, and its darker hair', () => {
    for (const base of BASE_CHARACTERS) {
      const template = templateFromBase(base);
      expect(template).toMatchObject({
        skin: base.palette.skin,
        hair: { color: base.palette.hair },
        top: { color: base.palette.top },
        bottom: { color: base.palette.bottom },
        shoes: { color: base.palette.shoes },
      });
      expect(toCharacterSpec(template).darkerHair, base.id).toBe(base.darkerHair ?? false);
    }
  });

  it('names each template after its base character', () => {
    expect(CHARACTER_TEMPLATES.map((template) => template.name)).toEqual(BASE_CHARACTERS.map((base) => base.name));
    expect(CHARACTER_TEMPLATES[0]!.baseId).toBe(`character-${BASE_CHARACTERS[0]!.id}`);
  });
});
