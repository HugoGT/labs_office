/**
 * Where a top piece (#121) stands on screen: lifted onto the surface of the
 * desk tables or room tables under it, its ground point on the front edge of
 * that surface's top.
 */

import { describe, expect, it } from 'vitest';
import { SURFACE_HEIGHT_PX, deskSurface, onTopGround, tableSurface } from './decorTop';
import { TILE } from './mapData';

const WIDTH = 20;
const at = (tx: number, ty: number): number => ty * WIDTH + tx;

describe('decorTop', () => {
  it('lifts the top of every desk table and room table 15 px over the floor, like the art pack draws them, on tiles of TILE', () => {
    expect(SURFACE_HEIGHT_PX).toBe(15);
    expect(tableSurface({ x: 0, y: 0, w: 1, h: 1 }).front).toBe(TILE);
  });

  it('puts the front edge of a desk table top on its art ground point, else on the edge of its 16 floor rows', () => {
    // The anchor stands below the middle of its tile by its facing (`tableDrop`).
    const middle = 5 * TILE + TILE / 2;
    expect(deskSurface(at(4, 5), 180, WIDTH, { y: 7 })).toEqual({ front: middle + 13 + 7, depthY: middle + 13 + 7, drop: 13 });
    expect(deskSurface(at(4, 5), 0, WIDTH, null)).toEqual({ front: middle + 16 + 8, depthY: middle + 16 + 8, drop: 16 });
    // Along a column it is 84 rows long: its front edge is near the bottom of its lowest tile.
    expect(deskSurface(at(4, 5), 90, WIDTH, null)).toEqual({ front: middle + 13 + 42, depthY: middle + 13 + 42, drop: 13 });
  });

  it('puts the front edge of a room table top on the bottom of its footprint', () => {
    expect(tableSurface({ x: 3, y: 4, w: 7, h: 5 })).toEqual({ front: 9 * TILE, depthY: 9 * TILE, drop: 0 });
  });

  it('stands a piece on the front edge of the surface under it, lifted by the surface height, and sorts it with that surface', () => {
    const desk = { front: 5 * TILE + 23, depthY: 5 * TILE + 23, drop: 0 };
    // A 1x1 piece on the desk row: its tile reaches past the top's front edge, so it stands on that edge.
    expect(onTopGround(6 * TILE, [desk])).toEqual({ y: 5 * TILE + 23 - 15, depthY: 5 * TILE + 23 });
    // On the upper tile of a desk table along a column it stands on its own tile, lifted.
    const vertical = { front: 6 * TILE + 26, depthY: 6 * TILE + 26, drop: 0 };
    expect(onTopGround(5 * TILE, [vertical])).toEqual({ y: 5 * TILE - 15, depthY: 6 * TILE + 26 });
    // Across two surfaces it takes the one further forward.
    expect(onTopGround(6 * TILE, [desk, { front: 5 * TILE + 26, depthY: 5 * TILE + 26, drop: 0 }])).toEqual({ y: 5 * TILE + 26 - 15, depthY: 5 * TILE + 26 });
  });

  it('carries a piece along with a desk table drawn below its tiles, on its row and on the upper tiles of a column', () => {
    // On the row: the front edge is past the bottom of the piece's tile, and the piece still reaches it.
    const row = deskSurface(at(4, 5), 180, WIDTH, { y: 7 });
    expect(onTopGround(6 * TILE, [row])).toEqual({ y: 5 * TILE + 16 + 13 + 7 - 15, depthY: 5 * TILE + 16 + 13 + 7 });
    // On the upper tile of a column: its own tile, lowered as far as the table.
    const column = deskSurface(at(4, 5), 90, WIDTH, null);
    expect(onTopGround(5 * TILE, [column])).toEqual({ y: 5 * TILE + 13 - 15, depthY: column.depthY });
  });

  it('stands a piece with no surface under it (a stored row) on the floor of its own footprint, as before the layers', () => {
    expect(onTopGround(6 * TILE, [])).toEqual({ y: 6 * TILE, depthY: 6 * TILE });
  });
});
