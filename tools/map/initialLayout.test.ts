import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseOfficeLayout, terrainSnapshot, isTileWalkable } from '../../src/game/officeLayout.ts';
import { parseBaseMapSeats } from '../../src/game/seating.ts';
import { decodePng, encodePng } from '../../server/src/assets/pngCodec.ts';
import { LAYOUT_PALETTE, buildInitialLayout, renderLayoutPalette, serializeLayout } from './initialLayout.ts';

const PACK_ROOT = new URL('../../public/assets/pack/', import.meta.url);
const readPack = (path: string): Uint8Array => readFileSync(new URL(path, PACK_ROOT));

describe('buildInitialLayout', () => {
  it('is deterministic, so regenerating it is a no-op until the code that describes it changes', () => {
    expect(serializeLayout(buildInitialLayout())).toBe(serializeLayout(buildInitialLayout()));
  });

  it('is a Tiled map that the office parser and the seat parser accept, 14x10 blocks of 9x9 tiles', () => {
    const map = JSON.parse(serializeLayout(buildInitialLayout())) as Record<string, unknown>;
    const layout = parseOfficeLayout(map);

    expect(layout.width).toBe(126);
    expect(layout.height).toBe(90);
    expect(layout.blocks).toHaveLength(140);
    expect(parseBaseMapSeats(map).length).toBeGreaterThan(0);
  });

  it('never stands a new tree on water once the block borders wobble', () => {
    const layout = parseOfficeLayout(JSON.parse(serializeLayout(buildInitialLayout())));
    const bare = terrainSnapshot({ ...layout, props: layout.props.filter((prop) => prop.kind !== 'tree') });

    for (const tree of layout.props.filter((prop) => prop.kind === 'tree')) {
      expect(isTileWalkable(bare, tree.tx, tree.ty), `tree at (${tree.tx}, ${tree.ty})`).toBe(true);
    }
  });
});

describe('renderLayoutPalette', () => {
  it('draws one 32px tile per palette entry, cut from the pack, in palette order', () => {
    const palette = renderLayoutPalette(readPack);

    expect(palette.width).toBe(32 * LAYOUT_PALETTE.length);
    expect(palette.height).toBe(32);
    // Terrain and wall tiles are opaque; a decal is a small detail on transparency.
    const alphaAt = (index: number, x: number, y: number): number => palette.data[(y * palette.width + index * 32 + x) * 4 + 3] ?? 0;
    expect(alphaAt(LAYOUT_PALETTE.indexOf('grass'), 16, 16)).toBe(255);
    expect(alphaAt(LAYOUT_PALETTE.indexOf('wall-brick'), 16, 16)).toBe(255);
    expect(alphaAt(LAYOUT_PALETTE.indexOf('lily-pad'), 0, 0)).toBe(0);
  });

  it('round-trips through PNG, as Tiled reads it', () => {
    const palette = renderLayoutPalette(readPack);
    const decoded = decodePng(encodePng(palette));

    expect(decoded.width).toBe(palette.width);
    expect(Buffer.from(decoded.data).equals(Buffer.from(palette.data))).toBe(true);
  });
});
