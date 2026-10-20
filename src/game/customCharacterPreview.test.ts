import { describe, expect, it } from 'vitest';
import { CHARACTER_TEMPLATES } from '../art/customCharacter';
import { CHARACTER_PARTS, customCharacterPart, customCharacterPreview } from './customCharacterPreview';

const SPEC = CHARACTER_TEMPLATES[2]!.spec;

describe('customCharacterPreview', () => {
  it('draws the idle frame once per spec and reuses it', () => {
    const idle = customCharacterPreview(SPEC);
    expect([idle.width, idle.height]).toEqual([32, 52]);
    expect(customCharacterPreview({ ...SPEC })).toBe(idle);
  });
});

describe('customCharacterPart', () => {
  it.each(Object.keys(CHARACTER_PARTS) as (keyof typeof CHARACTER_PARTS)[])('crops the %s region of the idle frame', (part) => {
    const region = CHARACTER_PARTS[part];
    const idle = customCharacterPreview(SPEC);
    const crop = customCharacterPart(SPEC, part);

    expect([crop.width, crop.height]).toEqual([region.width, region.height]);
    for (const [x, y] of [[0, 0], [region.width - 1, region.height - 1], [Math.floor(region.width / 2), Math.floor(region.height / 2)]] as const) {
      const from = ((region.y + y) * idle.width + region.x + x) * 4;
      const to = (y * crop.width + x) * 4;
      expect(Array.from(crop.data.slice(to, to + 4))).toEqual(Array.from(idle.data.slice(from, from + 4)));
    }
    expect(customCharacterPart({ ...SPEC }, part)).toBe(crop);
  });

  it('shows what changed: a different hair style changes the hair crop', () => {
    const bob = customCharacterPart({ ...SPEC, hair: { ...SPEC.hair, style: 'bob' } }, 'hair');
    const spiky = customCharacterPart({ ...SPEC, hair: { ...SPEC.hair, style: 'spiky' } }, 'hair');
    expect(Array.from(bob.data)).not.toEqual(Array.from(spiky.data));
  });
});
