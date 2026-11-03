import { describe, expect, it } from 'vitest';
import { BASE_CHARACTERS, type CharacterSpec, type ShoeStyle } from './characters.ts';
import { rampsFor } from './rig.ts';
import { buildCharacterSprites, frameRect } from './spriteSheet.ts';
import type { Direction } from './directions.ts';

/** The lowest rows of a standing frame: the feet and nothing above the ankles. */
const FEET_ROWS = 8;

/** A skirt keeps trousers off the feet, so every shoe pixel is the shoe's own. */
function wearing(shoes: ShoeStyle): CharacterSpec {
  const base = BASE_CHARACTERS[0]!;
  return { ...base, bottom: 'skirt', shoes, palette: { ...base.palette, shoes: '#2c4cc9' } };
}

/** The shoe pixels of a standing frame, x by row, from the top of the feet rows down. */
function shoeRows(spec: CharacterSpec, direction: Direction): number[][] {
  const ramp = Object.values(rampsFor(spec).shoes);
  const { idle } = buildCharacterSprites(spec);
  const rect = frameRect(direction, 0);
  const rows: number[][] = [];
  for (let y = rect.height - FEET_ROWS; y < rect.height; y += 1) {
    const row: number[] = [];
    for (let x = 0; x < rect.width; x += 1) {
      const c = idle.getPixel(rect.x + x, rect.y + y);
      if (c.a === 255 && ramp.some((r) => r.r === c.r && r.g === c.g && r.b === c.b)) row.push(x);
    }
    if (row.length > 0) rows.push(row);
  }
  return rows;
}

describe('shoes', () => {
  it('draws dress shoes square: a toe that drops straight to a sole as wide as the shoe', () => {
    // In profile the toe is the front edge: the sole reaches as far forward as the row above it.
    const east = shoeRows(wearing('dress'), 'E');
    expect(Math.max(...east.at(-1)!)).toBe(Math.max(...east.at(-2)!));
    const west = shoeRows(wearing('dress'), 'W');
    expect(Math.min(...west.at(-1)!)).toBe(Math.min(...west.at(-2)!));
    // From the front the sole is as wide as the shoe, never a rounded tip.
    const front = shoeRows(wearing('dress'), 'S');
    expect(front.at(-1)!.length).toBe(front.at(-2)!.length);
  });

  it('keeps dress shoes and heels apart', () => {
    for (const direction of ['E', 'SE'] as const) {
      expect(shoeRows(wearing('dress'), direction), direction).not.toEqual(shoeRows(wearing('heels'), direction));
    }
  });
});
