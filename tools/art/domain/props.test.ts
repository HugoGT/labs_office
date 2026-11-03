import { describe, expect, it } from 'vitest';
import { ART_TILE, BRIDGE, BRIDGE_ORIENTATIONS, HEDGE, PLANT, TABLE, TABLE_FACINGS, TREE, countColors } from '../../../src/game/artContract.ts';
import type { PixelBuffer } from '../../../src/art/pixelBuffer.ts';
import { bridgeSprite, DEFAULT_TREE_COLOR, hedgeSprite, plantSprite, PLANT_KINDS, treeSprite, TREE_KINDS } from './props.ts';
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

  it('outline the trunk down to the ground, over the contact shadow, so its base is never hollow', () => {
    for (const kind of TREE_KINDS) {
      const tree = treeSprite(kind);
      for (let y = TREE.anchor.y - 4; y < TREE.anchor.y; y += 1) {
        let left = TREE.anchor.x;
        while (tree.alphaAt(left - 1, y) === 255) left -= 1;
        let right = TREE.anchor.x;
        while (tree.alphaAt(right + 1, y) === 255) right += 1;
        expect(luma(tree.getPixel(left, y)), `${kind} left edge at ${y}`).toBeLessThan(60);
        expect(luma(tree.getPixel(right, y)), `${kind} right edge at ${y}`).toBeLessThan(60);
      }
    }
  });

  it('keep the large tree\'s bark grooves off the trunk\'s edges, so no groove doubles the outline', () => {
    const tree = treeSprite('large');
    const luma = (x: number, y: number): number => {
      const p = tree.getPixel(x, y);
      return p.r * 0.3 + p.g * 0.59 + p.b * 0.11;
    };
    for (let y = TREE.anchor.y - 28; y < TREE.anchor.y - 6; y += 1) {
      let left = TREE.anchor.x;
      while (tree.alphaAt(left - 1, y) === 255) left -= 1;
      let right = TREE.anchor.x;
      while (tree.alphaAt(right + 1, y) === 255) right += 1;
      // The darkest bark between the edges is a groove; the columns next to the outline never are.
      let groove = Infinity;
      for (let x = left + 2; x <= right - 2; x += 1) groove = Math.min(groove, luma(x, y));
      for (const x of [left + 1, right - 1]) expect(luma(x, y), `row ${y}, column ${x}`).toBeGreaterThan(groove + 4);
    }
  });

  it('draw the large tree about 3 tiles tall, a wide trunk inside its 1x1 base, the crown hanging down to about a tile above the ground', () => {
    const tree = treeSprite('large');
    const large = opaqueBounds(tree);
    const oak = opaqueBounds(treeSprite('oak'));
    // About 3 tiles from the ground to the top of the crown.
    expect(TREE.anchor.y - large.y0).toBeGreaterThanOrEqual(3 * ART_TILE - 10);
    expect(large.x1 - large.x0).toBeGreaterThan(oak.x1 - oak.x0 + 6);
    // The leaves hang low: only about a tile of trunk shows under them.
    const green = (y: number): boolean => tree.getPixel(TREE.anchor.x, y).g > tree.getPixel(TREE.anchor.x, y).r;
    let crownBottom = TREE.anchor.y - 4;
    while (crownBottom > 0 && !green(crownBottom)) crownBottom -= 1;
    const trunk = TREE.anchor.y - crownBottom;
    expect(trunk).toBeGreaterThanOrEqual(0.8 * ART_TILE);
    expect(trunk).toBeLessThanOrEqual(1.25 * ART_TILE);
    // Wide, yet inside its tile.
    const row = (y: number): number => {
      let n = 0;
      for (let x = 0; x < tree.width; x += 1) if (tree.alphaAt(x, y) === 255) n += 1;
      return n;
    };
    for (const y of [TREE.anchor.y - 8, TREE.anchor.y - ART_TILE]) {
      expect(row(y), `trunk at ${y}`).toBeGreaterThanOrEqual(ART_TILE / 2);
      expect(row(y), `trunk at ${y}`).toBeLessThanOrEqual(ART_TILE);
    }
  });

  it('draw one tree, green by default, whose leaves take any color while its trunk and silhouette stay', () => {
    expect([...TREE_KINDS]).toEqual(['oak', 'large']);
    const green = averageOpaque(treeSprite('oak'), [10, 50]);
    expect(green.g > green.r && green.g > green.b).toBe(true);
    expect(treeSprite('oak', DEFAULT_TREE_COLOR)).toBe(treeSprite('oak'));
    const autumn = treeSprite('oak', '#d9822b');
    const orange = averageOpaque(autumn, [10, 50]);
    expect(orange.r > orange.g && orange.g > orange.b).toBe(true);
    const alpha = (image: PixelBuffer): number[] => Array.from(image.data).filter((_, index) => index % 4 === 3);
    expect(alpha(autumn)).toEqual(alpha(treeSprite('oak')));
    expect(autumn.getPixel(TREE.anchor.x, TREE.anchor.y - 10)).toEqual(treeSprite('oak').getPixel(TREE.anchor.x, TREE.anchor.y - 10));
  });
});

describe('plants', () => {
  it('keep the bonsai small: a shallow pot and a low crown, well under the ficus', () => {
    const bonsai = opaqueBounds(plantSprite('bonsai'));
    const ficus = opaqueBounds(plantSprite('ficus'));
    expect(bonsai.y1 - bonsai.y0).toBeLessThan(ficus.y1 - ficus.y0 - 10);
    expect(bonsai.y1 - bonsai.y0).toBeLessThan(ART_TILE);
    expect(bonsai.y1 - bonsai.y0).toBeGreaterThan(16);
  });

  it('sit a pot on the anchor tile with leaves above it', () => {
    for (const kind of PLANT_KINDS) {
      const plant = plantSprite(kind);
      expect([plant.width, plant.height]).toEqual([PLANT.frame.width, PLANT.frame.height]);
      expect(corners(plant)).toEqual([0, 0, 0, 0]);
      expect(plant.alphaAt(PLANT.anchor.x, PLANT.anchor.y - 4), 'pot').toBe(255);
      const leaves = averageOpaque(plant, [4, 24]);
      expect(leaves.g > leaves.r && leaves.g > leaves.b).toBe(true);
      // The bonsai is the small one: it stays under a tile tall (below).
      if (kind !== 'bonsai') expect(opaqueBounds(plant).y0).toBeLessThan(PLANT.anchor.y - ART_TILE);
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
  it('match the meeting room and cafeteria tables of the map, plus a small oval one and a 1x1 round one', () => {
    expect(ROOM_TABLES).toEqual(['meeting', 'cafeteria', 'oval', 'round']);
    expect(ROOM_TABLE_FOOTPRINTS).toEqual({ meeting: { w: 7, h: 5 }, cafeteria: { w: 5, h: 3 }, oval: { w: 2, h: 1 }, round: { w: 1, h: 1 } });
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
    // A square footprint (the round table) looks the same standing either way.
    for (const kind of ROOM_TABLES.filter((table) => ROOM_TABLE_FOOTPRINTS[table].w !== ROOM_TABLE_FOOTPRINTS[table].h)) {
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

  it('round the oval and the round tables: the corners of their footprint stay clear while the middle is covered', () => {
    for (const kind of ['oval', 'round'] as const) {
      for (const facing of TABLE_FACINGS) {
        const table = roomTableSprite(kind, facing);
        const stated = ROOM_TABLE_FOOTPRINTS[kind];
        const { w, h } = facing === 'vertical' ? { w: stated.h, h: stated.w } : stated;
        const left = TABLE.anchor.x - (w * ART_TILE) / 2;
        const top = TABLE.anchor.y - h * ART_TILE - TABLE_HEIGHT;
        // The top's corner pixels, lifted TABLE_HEIGHT over the footprint's corners: a round top leaves them empty.
        expect(table.alphaAt(left + 1, top + 1), `${kind} ${facing} top left`).toBe(0);
        expect(table.alphaAt(left + w * ART_TILE - 2, top + 1), `${kind} ${facing} top right`).toBe(0);
        expect(table.alphaAt(TABLE.anchor.x, top + (h * ART_TILE) / 2), `${kind} ${facing} middle`).toBe(255);
      }
    }
  });

  it('draw the round table\'s top as a circle on screen: as wide as it shows tall, edge included', () => {
    for (const facing of TABLE_FACINGS) {
      const table = roomTableSprite('round', facing);
      const widths: number[] = [];
      for (let y = 0; y < table.height; y += 1) {
        let n = 0;
        for (let x = 0; x < table.width; x += 1) if (table.alphaAt(x, y) === 255) n += 1;
        widths.push(n);
      }
      const widest = Math.max(...widths);
      // The top's rows, wider than the pedestal under it (8px with its outline).
      const topRows = widths.filter((n) => n >= 10).length;
      expect(widest - topRows, `round ${facing}: ${widest} wide, ${topRows} tall`).toBeGreaterThanOrEqual(0);
      expect(widest - topRows, `round ${facing}: ${widest} wide, ${topRows} tall`).toBeLessThanOrEqual(2);
    }
  });
});

