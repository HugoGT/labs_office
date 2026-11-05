import { test } from 'vitest';
import assert from 'node:assert/strict';
import { PACK_FACINGS } from '../../src/game/artContract.ts';
import { recolorPixels } from '../../src/game/artColor.ts';
import { chairSprite, DEFAULT_GAMER_ACCENT, DEFAULT_POUF_COLOR } from './domain/chairs.ts';
import { DEFAULT_FABRIC_COLOR } from './domain/upholstery.ts';
import { SOFA_SEATS, sofaSprite } from './domain/sofas.ts';
import { FACINGS } from '../../src/art/seating.ts';
import { DEFAULT_GAMER_LIGHT, DEFAULT_TABLE_COLOR, tableSprite } from './domain/tables.ts';
import { carpetTile, DEFAULT_CARPET_COLOR, DEFAULT_PLAIN_COLOR, plainTile } from './domain/tiles.ts';
import { DEFAULT_TREE_COLOR, treeSprite } from './domain/props.ts';
import { DEFAULT_PLASTER_COLOR, wallFrame } from './domain/wallColumns.ts';
import { WALL_FRAMES, WALL_TOP_COLOR, type WallFrame } from '../../src/game/artContract.ts';

/**
 * The office never runs the generators: it recolors the exported default-color
 * sheet at runtime (`recolorPixels`). These tests hold that runtime recolor to
 * what the exporter itself paints for the same color, so a change in the color
 * model that breaks one of the two shows up here.
 */

const COLORS = ['#c0392b', '#2c3e50', '#f1c40f', '#8e44ad', '#ffffff', '#101010'];

interface Drift {
  readonly mean: number;
  readonly offShare: number;
}

/** Mean of the worst channel error per visible pixel, and the share of pixels off by more than 8. */
function drift(actual: Uint8ClampedArray, expected: Uint8ClampedArray): Drift {
  let sum = 0;
  let off = 0;
  let count = 0;
  for (let i = 0; i < expected.length; i += 4) {
    if ((actual[i + 3] ?? 0) === 0 && (expected[i + 3] ?? 0) === 0) continue;
    let worst = 0;
    for (let channel = 0; channel < 4; channel += 1) {
      worst = Math.max(worst, Math.abs((actual[i + channel] ?? 0) - (expected[i + channel] ?? 0)));
    }
    sum += worst;
    if (worst > 8) off += 1;
    count += 1;
  }
  return { mean: sum / count, offShare: off / count };
}

test('recoloring the exported plain floor matches the exporter painting it in that color', () => {
  const exported = plainTile().data;
  for (const color of COLORS) {
    const result = drift(recolorPixels(exported, DEFAULT_PLAIN_COLOR, color), plainTile(color).data);
    assert.ok(result.mean < 0.5, `${color}: mean drift ${result.mean}`);
    assert.equal(result.offShare, 0, `${color}: ${result.offShare} of the pixels drift`);
  }
});

test('recoloring the exported carpet matches the exporter painting it in that color (#222)', () => {
  const exported = carpetTile().data;
  for (const color of COLORS) {
    const result = drift(recolorPixels(exported, DEFAULT_CARPET_COLOR, color), carpetTile(color).data);
    assert.ok(result.mean < 0.5, `${color}: mean drift ${result.mean}`);
    assert.equal(result.offShare, 0, `${color}: ${result.offShare} of the pixels drift`);
  }
});

test('recoloring the exported painted desk stays within a few levels of the exporter', () => {
  for (const facing of PACK_FACINGS) {
    const exported = tableSprite('painted', facing, DEFAULT_TABLE_COLOR).image.data;
    for (const color of COLORS) {
      const result = drift(recolorPixels(exported, DEFAULT_TABLE_COLOR, color), tableSprite('painted', facing, color).image.data);
      assert.ok(result.mean < 2, `${facing} ${color}: mean drift ${result.mean}`);
      assert.ok(result.offShare < 0.04, `${facing} ${color}: ${result.offShare} of the pixels drift`);
    }
  }
});

test('recoloring the exported gamer desk repaints only its lights, as the exporter paints them', () => {
  // Like the gamer chair, the black body's darkest outline may sit within the light ramp's tolerance: a few levels at most.
  const OUTLINE_BELOW = 64;
  for (const facing of PACK_FACINGS) {
    const source = tableSprite('gamer', facing).image.data;
    for (const color of COLORS) {
      const expected = tableSprite('gamer', facing, color).image.data;
      const actual = recolorPixels(source, DEFAULT_GAMER_LIGHT, color);
      for (let i = 0; i < expected.length; i += 4) {
        if ((source[i + 3] ?? 0) === 0 && (expected[i + 3] ?? 0) === 0) continue;
        let worst = 0;
        for (let channel = 0; channel < 4; channel += 1) worst = Math.max(worst, Math.abs((actual[i + channel] ?? 0) - (expected[i + channel] ?? 0)));
        const outline = Math.max(source[i] ?? 0, source[i + 1] ?? 0, source[i + 2] ?? 0) < OUTLINE_BELOW;
        assert.ok(worst <= (outline ? 24 : 8), `${facing} ${color} pixel ${i / 4}: off by ${worst}${outline ? ' (outline)' : ''}`);
      }
    }
  }
});

test('recoloring the exported gamer chair matches the exporter; only dark outline pixels may stray, by a few levels', () => {
  // The shell's near-black outline sits inside the red ramp's tolerance, so the recolor tints it slightly:
  // allowed for those pixels alone, never for the shell, base, chrome or the red parts themselves.
  const OUTLINE_BELOW = 64;
  for (const facing of FACINGS) {
    const exported = chairSprite('gamer', facing, DEFAULT_GAMER_ACCENT);
    for (const color of COLORS) {
      const painted = chairSprite('gamer', facing, color);
      for (const layer of ['back', 'front'] as const) {
        const source = exported[layer].data;
        const expected = painted[layer].data;
        const actual = recolorPixels(source, DEFAULT_GAMER_ACCENT, color);
        for (let i = 0; i < expected.length; i += 4) {
          if ((source[i + 3] ?? 0) === 0 && (expected[i + 3] ?? 0) === 0) continue;
          let worst = 0;
          for (let channel = 0; channel < 4; channel += 1) worst = Math.max(worst, Math.abs((actual[i + channel] ?? 0) - (expected[i + channel] ?? 0)));
          const outline = Math.max(source[i] ?? 0, source[i + 1] ?? 0, source[i + 2] ?? 0) < OUTLINE_BELOW;
          assert.ok(worst <= (outline ? 24 : 8), `${facing} ${layer} ${color} pixel ${i / 4}: off by ${worst}${outline ? ' (outline)' : ''}`);
        }
      }
    }
  }
});

test('recoloring the exported fabric armchair matches the exporter within a few levels; dark feet and outline pixels a little more', () => {
  // Right edges are shaded as a mix of two tones, which the recolor places on the target ramp up to
  // 19 levels off for a bright yellow; the outline ink, mixed from the fabric, a little more.
  const DARK_BELOW = 64;
  for (const facing of FACINGS) {
    const exported = chairSprite('fabric', facing);
    for (const color of COLORS) {
      const painted = chairSprite('fabric', facing, color);
      for (const layer of ['back', 'front'] as const) {
        const source = exported[layer].data;
        const expected = painted[layer].data;
        const actual = recolorPixels(source, DEFAULT_FABRIC_COLOR, color);
        for (let i = 0; i < expected.length; i += 4) {
          if ((source[i + 3] ?? 0) === 0 && (expected[i + 3] ?? 0) === 0) continue;
          let worst = 0;
          for (let channel = 0; channel < 4; channel += 1) worst = Math.max(worst, Math.abs((actual[i + channel] ?? 0) - (expected[i + channel] ?? 0)));
          const dark = Math.max(source[i] ?? 0, source[i + 1] ?? 0, source[i + 2] ?? 0) < DARK_BELOW;
          assert.ok(worst <= (dark ? 24 : 20), `${facing} ${layer} ${color} pixel ${i / 4}: off by ${worst}${dark ? ' (dark)' : ''}`);
        }
      }
    }
  }
});

test('recoloring an exported fabric sofa matches the exporter like the fabric armchair does', () => {
  const DARK_BELOW = 64;
  for (const seats of SOFA_SEATS) {
    for (const facing of FACINGS) {
      const exported = sofaSprite('fabric', seats, facing);
      for (const color of COLORS) {
        const painted = sofaSprite('fabric', seats, facing, color);
        for (const layer of ['back', 'front'] as const) {
          const source = exported[layer].data;
          const expected = painted[layer].data;
          const actual = recolorPixels(source, DEFAULT_FABRIC_COLOR, color);
          for (let i = 0; i < expected.length; i += 4) {
            if ((source[i + 3] ?? 0) === 0 && (expected[i + 3] ?? 0) === 0) continue;
            let worst = 0;
            for (let channel = 0; channel < 4; channel += 1) worst = Math.max(worst, Math.abs((actual[i + channel] ?? 0) - (expected[i + channel] ?? 0)));
            const dark = Math.max(source[i] ?? 0, source[i + 1] ?? 0, source[i + 2] ?? 0) < DARK_BELOW;
            assert.ok(worst <= (dark ? 24 : 20), `${seats} ${facing} ${layer} ${color} pixel ${i / 4}: off by ${worst}${dark ? ' (dark)' : ''}`);
          }
        }
      }
    }
  }
});

test('recoloring the exported tree repaints its leaves as the exporter paints them; trunk and shadow stay', () => {
  const OUTLINE_BELOW = 64;
  const source = treeSprite('oak').data;
  for (const color of COLORS) {
    const expected = treeSprite('oak', color).data;
    const actual = recolorPixels(source, DEFAULT_TREE_COLOR, color);
    for (let i = 0; i < expected.length; i += 4) {
      if ((source[i + 3] ?? 0) === 0 && (expected[i + 3] ?? 0) === 0) continue;
      let worst = 0;
      for (let channel = 0; channel < 4; channel += 1) worst = Math.max(worst, Math.abs((actual[i + channel] ?? 0) - (expected[i + channel] ?? 0)));
      const outline = Math.max(source[i] ?? 0, source[i + 1] ?? 0, source[i + 2] ?? 0) < OUTLINE_BELOW;
      assert.ok(worst <= (outline ? 24 : 8), `${color} pixel ${i / 4}: off by ${worst}${outline ? ' (outline)' : ''}`);
    }
  }
});

test('recoloring the exported pouf matches the exporter within a few levels, like the fabric armchair', () => {
  const DARK_BELOW = 64;
  for (const facing of FACINGS) {
    const source = chairSprite('pouf', facing).back.data;
    for (const color of COLORS) {
      const expected = chairSprite('pouf', facing, color).back.data;
      const actual = recolorPixels(source, DEFAULT_POUF_COLOR, color);
      for (let i = 0; i < expected.length; i += 4) {
        if ((source[i + 3] ?? 0) === 0 && (expected[i + 3] ?? 0) === 0) continue;
        let worst = 0;
        for (let channel = 0; channel < 4; channel += 1) worst = Math.max(worst, Math.abs((actual[i + channel] ?? 0) - (expected[i + channel] ?? 0)));
        const dark = Math.max(source[i] ?? 0, source[i + 1] ?? 0, source[i + 2] ?? 0) < DARK_BELOW;
        assert.ok(worst <= (dark ? 24 : 20), `${facing} ${color} pixel ${i / 4}: off by ${worst}${dark ? ' (dark)' : ''}`);
      }
    }
  }
});

test('recoloring the exported plaster wall matches the exporter painting it in that color, its dark top untouched', () => {
  for (const frame of Object.keys(WALL_FRAMES) as WallFrame[]) {
    const exported = wallFrame('plaster', frame).data;
    for (const color of COLORS) {
      const result = drift(recolorPixels(exported, DEFAULT_PLASTER_COLOR, color, [WALL_TOP_COLOR]), wallFrame('plaster', frame, 0, undefined, color).data);
      assert.ok(result.mean < 0.5, `${frame} ${color}: mean drift ${result.mean}`);
      assert.equal(result.offShare, 0, `${frame} ${color}: ${result.offShare} of the pixels drift`);
    }
  }
});
