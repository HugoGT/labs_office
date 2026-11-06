/**
 * Where a top piece of the decor (#121, the "Mi espacio" pieces of
 * `officeDecor.ts`) stands on screen: on the top of the desk tables or room
 * tables under it, not on the floor. Pure numbers, so the scene only copies
 * them into game objects and the geometry is tested under jsdom.
 *
 * Import-free like `deskTable.ts`: explicit `.ts` imports of other pure
 * modules only.
 */

import { tableAnchor, tableDrop, tableFloorRect, type TableRotation } from './deskTable.ts';
import type { DecorTileRect } from './officeDecor.ts';

/**
 * Screen pixels from the floor to the top of every desk table and room
 * table: `TABLE_HEIGHT` of tools/art/domain/tables.ts, restated because the
 * game never imports tools/.
 */
export const SURFACE_HEIGHT_PX = 15;

/** World pixels of a tile: `TILE` of `mapData.ts`, restated to stay import-free (the tests pin them equal). */
const TILE_PX = 32;

/**
 * The top of a surface in world pixels: `front`, the floor y under the front
 * edge of its top, `depthY`, the y the surface sorts by, and `drop`, how far
 * below its tile footprint it is drawn.
 */
export interface DecorSurface {
  readonly front: number;
  readonly depthY: number;
  readonly drop: number;
}

/**
 * A desk table anchored on `index`: its front edge on its art's ground point
 * (`ground`, the facing's floor point under the front edge, relative to its
 * anchor, `tableAnchor`, the y `deskPlacement` sorts it by),
 * or, while its sheet is not loaded, on the edge of the floor its top covers
 * (`tableFloorRect`), the y its placeholder sorts by.
 */
export function deskSurface(index: number, rotation: TableRotation, width: number, ground: { readonly y: number } | null): DecorSurface {
  const anchorY = tableAnchor(index % width, Math.floor(index / width), TILE_PX, rotation).y;
  const floor = tableFloorRect(rotation);
  const front = anchorY + (ground === null ? floor.y + floor.h : ground.y);
  return { front, depthY: front, drop: tableDrop(rotation) };
}

/** A room table on its footprint (`decorFootprint`, in tiles): its top covers it, so its front edge is the footprint's bottom, its depth too (`propPlacement`). */
export function tableSurface(rect: DecorTileRect): DecorSurface {
  const front = (rect.y + rect.h) * TILE_PX;
  return { front, depthY: front, drop: 0 };
}

/**
 * Where a top piece puts its ground point (its anchor, the bottom middle of
 * its footprint for a prop), `y`, and the y it sorts with, `depthY`, given the
 * bottom of its footprint and the surfaces under it. It stands on the front
 * edge of the surface top (the art draws its base a pixel above its anchor,
 * so the base sits just behind that edge), or on its own tile where that tile
 * ends first (the upper tiles of a desk table along a column), lowered with
 * the surface (`drop`) and lifted by the surface height. Over several surfaces the one further forward counts; with
 * none (a stored row with no surface left under it) it stands on the floor
 * of its footprint, drawn as before the layers.
 */
export function onTopGround(footprintBottom: number, surfaces: readonly DecorSurface[]): { y: number; depthY: number } {
  if (surfaces.length === 0) return { y: footprintBottom, depthY: footprintBottom };
  const front = Math.max(...surfaces.map((surface) => surface.front));
  const tileEnd = footprintBottom + Math.max(...surfaces.map((surface) => surface.drop));
  return { y: Math.min(tileEnd, front) - SURFACE_HEIGHT_PX, depthY: Math.max(...surfaces.map((surface) => surface.depthY)) };
}
