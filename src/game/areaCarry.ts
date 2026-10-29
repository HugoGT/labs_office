/**
 * What a desk or room moved whole takes with it and what it replaces where
 * it lands. Shared by the server, which moves and erases them
 * (`terrainRuntime.ts`, `carry`), and the layout editor, which outlines in
 * red what the move would erase while it is dragged.
 *
 * Import-free like `officeDoors.ts`: explicit `.ts` imports of other pure modules only.
 */

import { decorFootprint, fitsInsideDesk, type DecorItem, type DecorPieceInfo, type DecorTileRect } from './officeDecor.ts';
import { doorPosts, isDoorPiece } from './officeDoors.ts';

/** Whether a grid vertex (row major, `ty * width + tx`) lies on or inside the outline of `area`: where a room's walls stand. */
export function onAreaOutline(area: DecorTileRect, width: number): (post: number) => boolean {
  return (post) => {
    const tx = post % width;
    const ty = Math.floor(post / width);
    return tx >= area.x && tx <= area.x + area.w && ty >= area.y && ty <= area.y + area.h;
  };
}

/** The items a move of `area` carries: those wholly inside it, and the doors whose every post is on or inside its outline. */
export function carriedDecor(
  items: readonly DecorItem[],
  area: DecorTileRect,
  infoOf: (piece: string) => DecorPieceInfo | null,
  width: number,
): DecorItem[] {
  const onOutline = onAreaOutline(area, width);
  return items.filter((item) =>
    isDoorPiece(item.piece) ? doorPosts(item, width).every(onOutline) : fitsInsideDesk(decorFootprint(item, infoOf(item.piece), width), area));
}

/**
 * The items a move erases: every one it does not carry that shares a tile
 * with the area where it lands (`to`). What the space holds replaces what
 * stood there, so an empty room lands empty.
 */
export function replacedDecor(
  items: readonly DecorItem[],
  carried: readonly DecorItem[],
  to: DecorTileRect,
  infoOf: (piece: string) => DecorPieceInfo | null,
  width: number,
): DecorItem[] {
  const own = new Set(carried.map(({ index }) => index));
  return items.filter((item) => {
    if (own.has(item.index)) return false;
    const { x, y, w, h } = decorFootprint(item, infoOf(item.piece), width);
    return x < to.x + to.w && to.x < x + w && y < to.y + to.h && to.y < y + h;
  });
}
