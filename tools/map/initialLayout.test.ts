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

  it('is a Tiled map that the office parser and the seat parser accept, 21x15 blocks of 9x9 tiles', () => {
    const map = JSON.parse(serializeLayout(buildInitialLayout())) as Record<string, unknown>;
    const layout = parseOfficeLayout(map);

    expect(layout.width).toBe(189);
    expect(layout.height).toBe(135);
    expect(layout.blocks).toHaveLength(315);
    expect(parseBaseMapSeats(map)).toEqual([]);
  });

  it('exactly reproduces the checked-in empty map: void around one full central wood block', () => {
    const layout = parseOfficeLayout(JSON.parse(serializeLayout(buildInitialLayout())));
    const bare = terrainSnapshot({ ...layout, props: layout.props.filter((prop) => prop.kind !== 'tree') });

    expect(layout.props).toEqual([]);
    expect(isTileWalkable(bare, 94, 67)).toBe(true);
    expect(bare.walkable.filter(Boolean)).toHaveLength(81);
    expect(layout.blocks.filter((material) => material === 'void')).toHaveLength(314);
    expect(serializeLayout(buildInitialLayout())).toBe(readFileSync(new URL('../../src/game/maps/office.json', import.meta.url), 'utf8'));
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
    // The void tile is opaque black, the color the office draws behind its terrain.
    const voidAt = (LAYOUT_PALETTE.indexOf('void') * 32 + 16 + 16 * palette.width) * 4;
    expect([...palette.data.slice(voidAt, voidAt + 4)]).toEqual([0, 0, 0, 255]);
    expect(LAYOUT_PALETTE.at(-1)).toBe('void');
  });

  it('round-trips through PNG, as Tiled reads it', () => {
    const palette = renderLayoutPalette(readPack);
    const decoded = decodePng(encodePng(palette));

    expect(decoded.width).toBe(palette.width);
    expect(Buffer.from(decoded.data).equals(Buffer.from(palette.data))).toBe(true);
  });
});
