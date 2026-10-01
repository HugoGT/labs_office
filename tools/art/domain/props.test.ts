import { describe, expect, it } from 'vitest';
import { ART_TILE, BRIDGE, BRIDGE_ORIENTATIONS, HEDGE, PLANT, TABLE, TREE, countColors } from '../../../src/game/artContract.ts';
import type { PixelBuffer } from './pixelBuffer.ts';
import { bridgeSprite, hedgeSprite, plantSprite, PLANT_KINDS, treeSprite, TREE_KINDS } from './props.ts';
import { ROOM_TABLE_FOOTPRINTS, ROOM_TABLES, roomTableSprite, TABLE_HEIGHT } from './tables.ts';

function corners(image: PixelBuffer): number[] {
  const { width, height } = image;
  return [image.alphaAt(0, 0), image.alphaAt(width - 1, 0), image.alphaAt(0, height - 1), image.alphaAt(width - 1, height - 1)];
}

function opaqueBounds(image: PixelBuffer): { x0: number; y0: number; x1: number; y1: number } {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.alphaAt(x, y) !== 255) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return { x0, y0, x1, y1 };
}

function averageOpaque(image: PixelBuffer, rows: readonly [number, number]): { r: number; g: number; b: number } {
  let [r, g, b, n] = [0, 0, 0, 0];
  for (let y = rows[0]; y < rows[1]; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const p = image.getPixel(x, y);
      if (p.a !== 255) continue;
      r += p.r;
      g += p.g;
      b += p.b;
      n += 1;
    }
  }
  return { r: r / n, g: g / n, b: b / n };
}

function luma(p: { r: number; g: number; b: number }): number {
  return p.r * 0.3 + p.g * 0.59 + p.b * 0.11;
}

describe('trees', () => {
  it('stand their trunk on the anchor, with the crown above and a contact shadow on the ground', () => {
    for (const kind of TREE_KINDS) {
      const tree = treeSprite(kind);
      expect([tree.width, tree.height], kind).toEqual([TREE.frame.width, TREE.frame.height]);
      expect(corners(tree), kind).toEqual([0, 0, 0, 0]);
      expect(tree.alphaAt(TREE.anchor.x, TREE.anchor.y - 4), `${kind} trunk`).toBe(255);
      expect(tree.alphaAt(TREE.anchor.x, 36), `${kind} crown`).toBe(255);
      const shadow = tree.getPixel(TREE.anchor.x + 12, TREE.anchor.y - 1);
      expect(shadow.a > 0 && shadow.a < 255, `${kind} shadow`).toBe(true);
      const bounds = opaqueBounds(tree);
      // Taller than a character (48px) and wider than its tile.
      expect(bounds.y1 - bounds.y0, kind).toBeGreaterThan(60);
      expect(bounds.x1 - bounds.x0, kind).toBeGreaterThan(ART_TILE);
      expect(countColors(tree), kind).toBeLessThanOrEqual(40);
    }
  });

  it('read as a green oak and an autumn maple', () => {
    const oak = averageOpaque(treeSprite('oak'), [10, 50]);
    const maple = averageOpaque(treeSprite('maple'), [10, 50]);
    expect(oak.g > oak.r && oak.g > oak.b).toBe(true);
    expect(maple.r > maple.g && maple.g > maple.b).toBe(true);
  });
});

describe('plants', () => {
  it('sit a pot on the anchor tile with leaves above it', () => {
    for (const kind of PLANT_KINDS) {
      const plant = plantSprite(kind);
      expect([plant.width, plant.height]).toEqual([PLANT.frame.width, PLANT.frame.height]);
      expect(corners(plant)).toEqual([0, 0, 0, 0]);
      expect(plant.alphaAt(PLANT.anchor.x, PLANT.anchor.y - 4), 'pot').toBe(255);
      const leaves = averageOpaque(plant, [4, 24]);
      expect(leaves.g > leaves.r && leaves.g > leaves.b).toBe(true);
      expect(opaqueBounds(plant).y0).toBeLessThan(PLANT.anchor.y - ART_TILE);
    }
  });
});

describe('bridges', () => {
  const left = BRIDGE.anchor.x - (BRIDGE.footprint.w * ART_TILE) / 2;
  const top = BRIDGE.anchor.y - BRIDGE.footprint.h * ART_TILE;
  const size = BRIDGE.footprint.w * ART_TILE;

  it('cover their whole 3x3 deck so no water shows through where people walk', () => {
    for (const orientation of BRIDGE_ORIENTATIONS) {
      const bridge = bridgeSprite(orientation);
      expect([bridge.width, bridge.height]).toEqual([BRIDGE.frame.width, BRIDGE.frame.height]);
      expect(corners(bridge), orientation).toEqual([0, 0, 0, 0]);
      for (let y = top; y < top + size; y += 1) {
        for (let x = left; x < left + size; x += 1) expect(bridge.alphaAt(x, y), `${orientation} (${x}, ${y})`).toBe(255);
      }
    }
  });

  it('reach onto both banks along their crossing only', () => {
    const bridge = bridgeSprite('north-south');
    expect(bridge.alphaAt(BRIDGE.anchor.x, top - 8), 'north abutment').toBe(255);
    expect(bridge.alphaAt(BRIDGE.anchor.x, top + size + 8), 'south abutment').toBe(255);
    expect(bridge.alphaAt(left - 8, BRIDGE.anchor.y - size / 2), 'nothing west of the deck').toBe(0);
  });

  it('draw the east-west bridge as the north-south one turned', () => {
    const ns = bridgeSprite('north-south');
    const ew = bridgeSprite('east-west');
    for (let y = 0; y < ns.height; y += 3) {
      for (let x = 0; x < ns.width; x += 3) expect(ew.getPixel(y, x), `(${x}, ${y})`).toEqual(ns.getPixel(x, y));
    }
  });
});

describe('hedges', () => {
  const W = 8;
  const S = 4;
  const N = 1;
  const top = HEDGE.anchor.y - ART_TILE - HEDGE.height;

  it('grow to the frame side toward each connected neighbor and round off the others', () => {
    expect(hedgeSprite(W).alphaAt(0, top + 16)).toBe(255);
    expect(hedgeSprite(0).alphaAt(0, top + 16)).toBe(0);
    expect(hedgeSprite(N).alphaAt(16, 0)).toBe(255);
    expect(hedgeSprite(0).alphaAt(16, 0)).toBe(0);
  });

  it('show a darker front face only where no hedge continues south', () => {
    const open = hedgeSprite(0);
    const closed = hedgeSprite(S);
    const face: readonly [number, number] = [HEDGE.anchor.y - HEDGE.height + 2, HEDGE.anchor.y - 1];
    const crown: readonly [number, number] = [top + 6, top + 20];
    expect(luma(averageOpaque(open, face))).toBeLessThan(luma(averageOpaque(open, crown)) - 15);
    expect(Math.abs(luma(averageOpaque(closed, face)) - luma(averageOpaque(closed, crown)))).toBeLessThan(10);
  });

  it('tile seamlessly in a straight run', () => {
    const run = hedgeSprite(2 | 8);
    // The leaf pattern wraps at the tile width, so column 0 continues column 31.
    let differences = 0;
    for (let y = top; y < top + ART_TILE; y += 1) {
      const a = run.getPixel(ART_TILE - 1, y);
      const b = run.getPixel(0, y);
      if (a.r !== b.r || a.g !== b.g) differences += 1;
    }
    expect(differences).toBeLessThan(ART_TILE / 2);
  });
});

describe('room tables', () => {
  it('match the meeting room and cafeteria tables of the map', () => {
    expect(ROOM_TABLES).toEqual(['meeting', 'cafeteria']);
    expect(ROOM_TABLE_FOOTPRINTS).toEqual({ meeting: { w: 7, h: 5 }, cafeteria: { w: 5, h: 3 } });
  });

  it('cover their footprint, lift their top TABLE_HEIGHT over it and fit the table frame', () => {
    for (const kind of ROOM_TABLES) {
      const table = roomTableSprite(kind);
      const { w, h } = ROOM_TABLE_FOOTPRINTS[kind];
      expect([table.width, table.height]).toEqual([TABLE.frame.width, TABLE.frame.height]);
      expect(corners(table), kind).toEqual([0, 0, 0, 0]);
      const bounds = opaqueBounds(table);
      const halfWidth = (w * ART_TILE) / 2;
      expect(bounds.x0, kind).toBeGreaterThanOrEqual(TABLE.anchor.x - halfWidth - 2);
      expect(bounds.x1, kind).toBeLessThanOrEqual(TABLE.anchor.x + halfWidth + 1);
      expect(bounds.y1, kind).toBeLessThanOrEqual(TABLE.anchor.y + 1);
      expect(bounds.y0, kind).toBeGreaterThanOrEqual(TABLE.anchor.y - h * ART_TILE - TABLE_HEIGHT - 2);
      expect(table.alphaAt(TABLE.anchor.x, TABLE.anchor.y - (h * ART_TILE) / 2), `${kind} top`).toBe(255);
      expect(countColors(table), kind).toBeLessThanOrEqual(64);
    }
  });
});
