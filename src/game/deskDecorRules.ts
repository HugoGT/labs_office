/**
 * The rules a desk puts on the office decor layer and on the people around
 * it. A desk is the 3x3 tile area of a `desks` row; "on a desk" means an
 * item's footprint shares at least one tile with that area.
 *
 *   - At most `MAX_DESK_TABLES` desk table per desk: placing one on a desk
 *     removes the other desk tables on it in the same save
 *     (`displacedDeskTables`), and a desk cannot be created or moved between
 *     two of them (`deskBetweenTables`, 409 `desk-between-tables`).
 *   - At most `MAX_DESK_CHAIRS` chairs per desk (`deskOverChairLimit`, 409
 *     `desk-chair-limit`).
 *   - At most `MAX_DESK_OCCUPANCY` people inside a desk area: the next one
 *     cannot walk in (`deskEntryRefused`).
 *
 * Only new edits and new moves are judged: stored rows that already break a
 * rule are kept and drawn, like every other decor rule (#208).
 *
 * Shared by the server (terrain runtime, desk routes, the room) and the
 * client (the decor editor, the scene), so both judge the same way.
 */

import { decorFootprint, type DecorItem, type DecorPieceInfo, type DecorTileRect } from './officeDecor.ts';

export const MAX_DESK_TABLES = 1;
export const MAX_DESK_CHAIRS = 3;
export const MAX_DESK_OCCUPANCY = 6;

type InfoOf = (piece: string) => DecorPieceInfo | null;

function sharesTile(a: DecorTileRect, b: DecorTileRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function sameDesk(a: DecorTileRect, b: DecorTileRect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

/** Whether an item stands on a desk: its footprint shares at least one tile with the desk area. */
export function isOnDesk(item: Pick<DecorItem, 'index' | 'rotation'>, info: DecorPieceInfo | null, desk: DecorTileRect, width: number): boolean {
  return sharesTile(decorFootprint(item, info, width), desk);
}

function onDeskOfKind(kind: DecorPieceInfo['kind'], desk: DecorTileRect, items: readonly DecorItem[], infoOf: InfoOf, width: number): DecorItem[] {
  return items.filter((item) => {
    const info = infoOf(item.piece);
    return info !== null && info.kind === kind && isOnDesk(item, info, desk, width);
  });
}

/** Whether a desk at `desk` would touch two or more distinct desk tables: it may not be created or moved there. */
export function deskBetweenTables(desk: DecorTileRect, items: readonly DecorItem[], infoOf: InfoOf, width: number): boolean {
  return onDeskOfKind('desk', desk, items, infoOf, width).length > MAX_DESK_TABLES;
}

/**
 * The anchors of the desk tables a batch displaces: a desk table placed on a
 * desk removes every other desk table on that desk, and where one batch
 * places several on the same desk the last one placed wins (the anchors are
 * walked from the last). `items` is the layer after the batch's own edits;
 * the removals come on top of them.
 */
export function displacedDeskTables(
  items: readonly DecorItem[],
  placed: readonly number[],
  infoOf: InfoOf,
  desks: readonly DecorTileRect[],
  width: number,
): number[] {
  const layer = new Map(items.map((item) => [item.index, item]));
  const removed: number[] = [];
  for (const anchor of [...placed].reverse()) {
    const item = layer.get(anchor);
    const info = item === undefined ? null : infoOf(item.piece);
    if (item === undefined || info === null || info.kind !== 'desk') continue;
    for (const desk of desks) {
      if (!isOnDesk(item, info, desk, width)) continue;
      for (const other of onDeskOfKind('desk', desk, [...layer.values()], infoOf, width)) {
        if (other.index === anchor) continue;
        layer.delete(other.index);
        removed.push(other.index);
      }
    }
  }
  return removed;
}

/**
 * The first desk a placed chair stands on that ends the batch with more than
 * `MAX_DESK_CHAIRS` chairs and more than it had before, or `null`. Turning a
 * chair, moving one inside its desk or a desk that already held too many (a
 * stored excess) adds none, so none of them is refused.
 */
export function deskOverChairLimit(
  before: readonly DecorItem[],
  after: readonly DecorItem[],
  placed: readonly number[],
  infoOf: InfoOf,
  desks: readonly DecorTileRect[],
  width: number,
): DecorTileRect | null {
  const byAnchor = new Map(after.map((item) => [item.index, item]));
  for (const anchor of placed) {
    const item = byAnchor.get(anchor);
    const info = item === undefined ? null : infoOf(item.piece);
    if (item === undefined || info === null || info.kind !== 'chair') continue;
    for (const desk of desks) {
      if (!isOnDesk(item, info, desk, width)) continue;
      const count = onDeskOfKind('chair', desk, after, infoOf, width).length;
      if (count > MAX_DESK_CHAIRS && count > onDeskOfKind('chair', desk, before, infoOf, width).length) return desk;
    }
  }
  return null;
}

/** The desk whose area holds a point in pixels (half open, like a space), or `null`. */
export function deskAreaAt(point: { readonly x: number; readonly y: number }, desks: readonly DecorTileRect[], tileSize: number): DecorTileRect | null {
  for (const desk of desks) {
    const inside = point.x >= desk.x * tileSize && point.x < (desk.x + desk.w) * tileSize
      && point.y >= desk.y * tileSize && point.y < (desk.y + desk.h) * tileSize;
    if (inside) return desk;
  }
  return null;
}

/**
 * The desk a move from `from` to `to` (network positions, pixels) would walk
 * into while `MAX_DESK_OCCUPANCY` other people (`others`) are already inside
 * it, or `null`. A move inside the same desk or outside every desk is never
 * refused, so someone already in never gets stuck.
 */
export function deskEntryRefused(
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  desks: readonly DecorTileRect[],
  others: readonly { readonly x: number; readonly y: number }[],
  tileSize: number,
): DecorTileRect | null {
  const target = deskAreaAt(to, desks, tileSize);
  if (target === null) return null;
  const current = deskAreaAt(from, desks, tileSize);
  if (current !== null && sameDesk(current, target)) return null;
  const inside = others.filter((other) => {
    const desk = deskAreaAt(other, desks, tileSize);
    return desk !== null && sameDesk(desk, target);
  }).length;
  return inside >= MAX_DESK_OCCUPANCY ? target : null;
}
