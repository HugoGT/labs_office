import { describe, expect, it } from 'vitest';
import { ART_TILE, BRIDGE, BRIDGE_ORIENTATIONS, HEDGE, PLANT, TABLE, TABLE_FACINGS, TREE, countColors } from '../../../src/game/artContract.ts';
import type { PixelBuffer } from '../../../src/art/pixelBuffer.ts';
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
  it('match the meeting room and cafeteria tables of the map, plus a small oval one', () => {
    expect(ROOM_TABLES).toEqual(['meeting', 'cafeteria', 'oval']);
    expect(ROOM_TABLE_FOOTPRINTS).toEqual({ meeting: { w: 7, h: 5 }, cafeteria: { w: 5, h: 3 }, oval: { w: 2, h: 1 } });
  });

  it('cover their footprint in both facings, the vertical one swapped, lift their top TABLE_HEIGHT over it and fit the table frame', () => {
    for (const kind of ROOM_TABLES) {
      for (const facing of TABLE_FACINGS) {
        const name = `${kind} ${facing}`;
        const table = roomTableSprite(kind, facing);
        const stated = ROOM_TABLE_FOOTPRINTS[kind];
        const { w, h } = facing === 'vertical' ? { w: stated.h, h: stated.w } : stated;
        expect([table.width, table.height]).toEqual([TABLE.frame.width, TABLE.frame.height]);
        expect(corners(table), name).toEqual([0, 0, 0, 0]);
        const bounds = opaqueBounds(table);
        const halfWidth = (w * ART_TILE) / 2;
        expect(bounds.x0, name).toBeGreaterThanOrEqual(TABLE.anchor.x - halfWidth - 2);
        expect(bounds.x1, name).toBeLessThanOrEqual(TABLE.anchor.x + halfWidth + 1);
        expect(bounds.y1, name).toBeLessThanOrEqual(TABLE.anchor.y + 1);
        expect(bounds.y0, name).toBeGreaterThanOrEqual(TABLE.anchor.y - h * ART_TILE - TABLE_HEIGHT - 2);
        // Most of the footprint is under the table: it is drawn at its size, not shrunk into the frame.
        expect(bounds.x1 - bounds.x0, name).toBeGreaterThanOrEqual(w * ART_TILE - 8);
        expect(table.alphaAt(TABLE.anchor.x, TABLE.anchor.y - (h * ART_TILE) / 2), `${name} top`).toBe(255);
        expect(countColors(table), name).toBeLessThanOrEqual(64);
      }
    }
  });

  it('draw the vertical facing as its own top-down drawing, not the horizontal one turned', () => {
    for (const kind of ROOM_TABLES) {
      const horizontal = opaqueBounds(roomTableSprite(kind, 'horizontal'));
      const vertical = opaqueBounds(roomTableSprite(kind, 'vertical'));
      const { w, h } = ROOM_TABLE_FOOTPRINTS[kind];
      // Width on screen follows the footprint across, height its floor depth plus the same lift.
      expect(vertical.x1 - vertical.x0, kind).toBeLessThan(horizontal.x1 - horizontal.x0);
      // (the oval's pedestal shows a little more under its rounded front edge).
      const taller = vertical.y1 - vertical.y0 - (horizontal.y1 - horizontal.y0);
      expect(taller, kind).toBeGreaterThanOrEqual((w - h) * ART_TILE);
      expect(taller, kind).toBeLessThanOrEqual((w - h) * ART_TILE + 8);
    }
  });

  it('round the oval table: the corners of its footprint stay clear while its middle is covered', () => {
    for (const facing of TABLE_FACINGS) {
      const table = roomTableSprite('oval', facing);
      const stated = ROOM_TABLE_FOOTPRINTS.oval;
      const { w, h } = facing === 'vertical' ? { w: stated.h, h: stated.w } : stated;
      const left = TABLE.anchor.x - (w * ART_TILE) / 2;
      const top = TABLE.anchor.y - h * ART_TILE - TABLE_HEIGHT;
      // The top's corner pixels, lifted TABLE_HEIGHT over the footprint's corners: an oval leaves them empty.
      expect(table.alphaAt(left + 1, top + 1), `oval ${facing} top left`).toBe(0);
      expect(table.alphaAt(left + w * ART_TILE - 2, top + 1), `oval ${facing} top right`).toBe(0);
      expect(table.alphaAt(TABLE.anchor.x, top + (h * ART_TILE) / 2), `oval ${facing} middle`).toBe(255);
    }
  });
});

