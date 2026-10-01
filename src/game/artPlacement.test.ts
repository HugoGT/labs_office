import { describe, expect, it } from 'vitest';
import { CHAIR, DESK, type ArtChairPiece, type ArtDeskPiece } from './artContract';
import {
  chairPlacement,
  deskAreaAnchor,
  deskPlacement,
  footprintAnchor,
  spaceFloorTiles,
} from './artPlacement';
import { TILE } from './mapData';
import { buildTerrainGrid } from './terrainGrid';

const DESK_PIECE: ArtDeskPiece = {
  id: 'desk-wood',
  kind: 'desk',
  name: 'Escritorio de madera',
  author: 'HugoGT',
  license: 'proprietary-internal',
  material: 'wood',
  colorable: false,
  defaultColor: null,
  anchor: { x: 32, y: 40 },
  facings: {
    up: { footprint: { w: 2, h: 1 }, ground: { x: 0, y: 6 }, chairGround: { x: 0, y: 10 } },
    down: { footprint: { w: 2, h: 1 }, ground: { x: 0, y: 6 }, chairGround: { x: 0, y: -10 } },
    left: { footprint: { w: 1, h: 2 }, ground: { x: 0, y: 15 }, chairGround: { x: 21, y: 0 } },
    right: { footprint: { w: 1, h: 2 }, ground: { x: 0, y: 15 }, chairGround: { x: -21, y: 0 } },
  },
  files: [],
};

const CHAIR_PIECE: ArtChairPiece = {
  id: 'chair-wood',
  kind: 'chair',
  name: 'Silla de madera',
  author: 'HugoGT',
  license: 'proprietary-internal',
  material: 'wood',
  facings: ['up', 'down', 'left', 'right'],
  layers: ['back', 'front'],
  anchors: { seat: { x: 18, y: 22 }, ground: { x: 18, y: 31 } },
  footprint: { w: 1, h: 1 },
  files: [],
};

describe('deskPlacement', () => {
  it('lands the desk anchor on the world point at native size, in the column of its facing', () => {
    const placement = deskPlacement(DESK_PIECE, 'down', { x: 200, y: 300 });

    expect(placement).toEqual({
      x: 200 - 32,
      y: 300 - 40,
      width: DESK.frame.width,
      height: DESK.frame.height,
      // Pack order is up, down, left, right: `down` is column 1, not the office's 0.
      frame: 1,
      depthY: 306,
      chairGround: { x: 200, y: 290 },
    });
  });

  it('picks the exported column of each facing instead of rotating one image', () => {
    expect(deskPlacement(DESK_PIECE, 'up', { x: 0, y: 0 }).frame).toBe(0);
    expect(deskPlacement(DESK_PIECE, 'left', { x: 0, y: 0 }).frame).toBe(2);
    expect(deskPlacement(DESK_PIECE, 'right', { x: 0, y: 0 })).toMatchObject({ frame: 3, depthY: 15, chairGround: { x: -21, y: 0 } });
  });
});

describe('anchors', () => {
  it('puts a piece in the middle of its footprint', () => {
    expect(footprintAnchor({ x: 3 * TILE, y: 5 * TILE, w: 2 * TILE, h: TILE })).toEqual({ x: 4 * TILE, y: 5.5 * TILE });
  });

  it('keeps a 64px desk at its own size in the middle of a 3x3 desk area instead of stretching it', () => {
    const area = { x: 10 * TILE, y: 10 * TILE, w: 3 * TILE, h: 3 * TILE };
    const anchor = deskAreaAnchor(area);
    const placement = deskPlacement(DESK_PIECE, 'down', anchor);

    expect(anchor).toEqual({ x: 11.5 * TILE, y: 11.5 * TILE });
    expect(placement.width).toBe(64);
    expect(placement.x).toBeGreaterThan(area.x);
    expect(placement.x + placement.width).toBeLessThan(area.x + area.w);
  });
});

describe('chairPlacement', () => {
  it('draws the back and front layers of one facing so that the chair ground lands on the point', () => {
    const { back, front } = chairPlacement(CHAIR_PIECE, 'left', { x: 100, y: 200 });

    expect(back).toEqual({ x: 82, y: 169, width: CHAIR.frame.width, height: CHAIR.frame.height, frame: 2, depthY: 200 });
    // Row 1 of the sheet holds the front layer: same column, one row down.
    expect(front).toEqual({ ...back, frame: CHAIR.columns + 2 });
  });
});

describe('spaceFloorTiles', () => {
  it('covers the tiles of a space except its walls and hedges', () => {
    const grid = buildTerrainGrid();
    // Built-in Sala de Juntas: 13x14 tiles at (50,2), walled with a two-tile door.
    const tiles = spaceFloorTiles({ x: 50 * TILE, y: 2 * TILE, w: 13 * TILE, h: 14 * TILE }, grid);

    expect(tiles).toHaveLength(11 * 12 + 2);
    expect(tiles).toContainEqual({ tx: 51, ty: 3 });
    expect(tiles).toContainEqual({ tx: 50, ty: 8 });
    expect(tiles).not.toContainEqual({ tx: 50, ty: 2 });
  });

  it('never paints a floor over water, which would hide that it blocks the way', () => {
    const grid = buildTerrainGrid();
    const tiles = spaceFloorTiles({ x: 12 * TILE, y: 18 * TILE, w: 5 * TILE, h: 5 * TILE }, grid);

    expect(tiles.some(({ tx, ty }) => grid.terrain[ty][tx] === 'water' && grid.solid[ty][tx])).toBe(false);
    // The bridge deck at x 13..15 is walkable over the water, so it does get the floor.
    expect(tiles).toContainEqual({ tx: 13, ty: 19 });
    expect(tiles).not.toContainEqual({ tx: 12, ty: 19 });
  });

  it('clips a space that reaches past the map', () => {
    const grid = buildTerrainGrid();
    const tiles = spaceFloorTiles({ x: -TILE, y: -TILE, w: 3 * TILE, h: 3 * TILE }, grid);

    // Row and column 0 are the hedge of the world's border.
    expect(tiles).toEqual([{ tx: 1, ty: 1 }]);
  });
});
