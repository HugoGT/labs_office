import { describe, expect, it } from 'vitest';
import { BASE_CHARACTERS, type CharacterSpec, type Glasses } from './characters.ts';
import type { PixelBuffer } from './pixelBuffer.ts';
import { rampsFor, type MaterialKey } from './rig.ts';
import { buildCharacterSprites, frameRect, sitFrameRect, type FrameRect } from './spriteSheet.ts';
import type { Direction } from './directions.ts';

const ANDRE = BASE_CHARACTERS.find((character) => character.id === 'p05-charcoal-suit')!;
const MATEO = BASE_CHARACTERS[0]!;

function wearing(base: CharacterSpec, glasses: Glasses): CharacterSpec {
  return { ...base, glasses };
}

/** Every pixel of a frame painted with one material, by its ramp colors. */
function pixelsOf(spec: CharacterSpec, sheet: PixelBuffer, rect: FrameRect, key: MaterialKey): { x: number; y: number }[] {
  const ramp = Object.values(rampsFor(spec)[key]);
  const found: { x: number; y: number }[] = [];
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) {
      const c = sheet.getPixel(rect.x + x, rect.y + y);
      if (c.a === 255 && ramp.some((r) => r.r === c.r && r.g === c.g && r.b === c.b)) found.push({ x, y });
    }
  }
  return found;
}

const FACE_DIRECTIONS: readonly Direction[] = ['S', 'SE', 'E', 'W', 'SW'];

describe('glasses', () => {
  it('base characters keep their regular glasses, and nobody else wears any', () => {
    expect(ANDRE.glasses).toBe('glasses');
    for (const base of BASE_CHARACTERS) if (base !== ANDRE) expect(base.glasses).toBe('none');
  });

  it('draws a frame around each lens, under the eyes as well as over them, so it never reads as a brow', () => {
    const spec = wearing(MATEO, 'glasses');
    const { idle } = buildCharacterSprites(spec);
    const front = frameRect('S', 0);
    const lens = pixelsOf(spec, idle, front, 'lens');
    const frame = pixelsOf(spec, idle, front, 'frame');

    expect(lens.length).toBeGreaterThanOrEqual(2);
    const lensTop = Math.min(...lens.map((p) => p.y));
    const lensBottom = Math.max(...lens.map((p) => p.y));
    expect(frame.some((p) => p.y < lensTop)).toBe(true);
    expect(frame.some((p) => p.y > lensBottom)).toBe(true);
    // Two lenses, one each side of a bridge between them.
    const lensXs = [...new Set(lens.map((p) => p.x))].sort((a, b) => a - b);
    expect(lensXs.at(-1)! - lensXs[0]!).toBeGreaterThanOrEqual(3);
  });

  it('sunglasses have dark lenses instead of clear ones', () => {
    const spec = wearing(MATEO, 'sunglasses');
    const { idle } = buildCharacterSprites(spec);
    const front = frameRect('S', 0);

    expect(pixelsOf(spec, idle, front, 'shade').length).toBeGreaterThanOrEqual(4);
    expect(pixelsOf(spec, idle, front, 'frame').length).toBeGreaterThan(0);
  });

  it.each(['glasses', 'sunglasses'] as const)('%s show in every walk direction and seated facing that shows the face', (glasses) => {
    const spec = wearing(MATEO, glasses);
    const sprites = buildCharacterSprites(spec);
    for (const direction of FACE_DIRECTIONS) {
      expect(pixelsOf(spec, sprites.idle, frameRect(direction, 0), 'frame').length, direction).toBeGreaterThan(0);
      expect(pixelsOf(spec, sprites.walk, frameRect(direction, 3), 'frame').length, `${direction} walking`).toBeGreaterThan(0);
    }
    for (const facing of ['down', 'left', 'right'] as const) {
      expect(pixelsOf(spec, sprites.sit, sitFrameRect(facing, 6), 'frame').length, facing).toBeGreaterThan(0);
    }
    expect(pixelsOf(spec, sprites.idle, frameRect('N', 0), 'frame')).toEqual([]);
  });

  it('none draws neither frame nor lens', () => {
    const spec = wearing(MATEO, 'none');
    const { idle } = buildCharacterSprites(spec);
    expect(pixelsOf(spec, idle, frameRect('S', 0), 'frame')).toEqual([]);
    expect(pixelsOf(spec, idle, frameRect('S', 0), 'shade')).toEqual([]);
  });
});
