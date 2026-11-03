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
    const middle = 5 * TILE + TILE / 2;
    expect(deskSurface(at(4, 5), 180, WIDTH, { y: 7 })).toEqual({ front: middle + 7, depthY: middle + 7 });
    expect(deskSurface(at(4, 5), 0, WIDTH, null)).toEqual({ front: middle + 8, depthY: middle + 8 });
    // Along a column it is 84 rows long: its front edge is near the bottom of its lowest tile.
    expect(deskSurface(at(4, 5), 90, WIDTH, null)).toEqual({ front: middle + 42, depthY: middle + 42 });
  });

  it('puts the front edge of a room table top on the bottom of its footprint', () => {
    expect(tableSurface({ x: 3, y: 4, w: 7, h: 5 })).toEqual({ front: 9 * TILE, depthY: 9 * TILE });
  });

  it('stands a piece on the front edge of the surface under it, lifted by the surface height, and sorts it with that surface', () => {
    const desk = { front: 5 * TILE + 23, depthY: 5 * TILE + 23 };
    // A 1x1 piece on the desk row: its tile reaches past the top's front edge, so it stands on that edge.
    expect(onTopGround(6 * TILE, [desk])).toEqual({ y: 5 * TILE + 23 - 15, depthY: 5 * TILE + 23 });
    // On the upper tile of a desk table along a column it stands on its own tile, lifted.
    const vertical = { front: 6 * TILE + 26, depthY: 6 * TILE + 26 };
    expect(onTopGround(5 * TILE, [vertical])).toEqual({ y: 5 * TILE - 15, depthY: 6 * TILE + 26 });
    // Across two surfaces it takes the one further forward.
    expect(onTopGround(6 * TILE, [desk, { front: 5 * TILE + 26, depthY: 5 * TILE + 26 }])).toEqual({ y: 5 * TILE + 26 - 15, depthY: 5 * TILE + 26 });
  });

  it('stands a piece with no surface under it (a stored row) on the floor of its own footprint, as before the layers', () => {
    expect(onTopGround(6 * TILE, [])).toEqual({ y: 6 * TILE, depthY: 6 * TILE });
  });
});
