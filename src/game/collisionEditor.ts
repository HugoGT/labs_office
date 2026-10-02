/**
 * Shapes and pure geometry of the collision editor, shared by React and the
 * scene and kept free of Phaser so the sidebar can import them. Everything
 * here works in piece space: art pixels from the piece's anchor, down-facing.
 */

import { COLLISION_COORD_LIMIT, type CollisionPoint, type CollisionRect } from './pieceCollisions';

/** Grid the editor snaps rectangles to, in art pixels. */
export type CollisionSnap = 1 | 2;
export const COLLISION_SNAPS: readonly CollisionSnap[] = [1, 2];

/**
 * What the collision editor asks the map to show while it is open. `null`
 * (the whole command) closes it. The draft is drawn for this admin only and
 * never changes collisions: the room decides once it is saved.
 */
export interface CollisionEditCommand {
  /** The piece being edited, or `null` before one is picked. */
  pieceId: string | null;
  /** Its rectangles as edited, drawn over every instance of the piece. */
  draft: readonly CollisionRect[];
  /** The rectangle the map offers handles for, or `null`. */
  selectedRect: number | null;
  snap: CollisionSnap;
}

/** The part of a rectangle a pointer grabbed. */
export type RectHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export function snapValue(value: number, snap: CollisionSnap): number {
  const snapped = Math.round(value / snap) * snap;
  return snapped === 0 ? 0 : snapped;
}

/**
 * The handle under `point`: an edge or a corner within `tolerance` of it, the
 * inside as a move, `null` outside.
 */
export function hitRect(rect: CollisionRect, point: CollisionPoint, tolerance: number): RectHandle | null {
  const left = rect.x;
  const right = rect.x + rect.w;
  const top = rect.y;
  const bottom = rect.y + rect.h;
  if (point.x < left - tolerance || point.x > right + tolerance || point.y < top - tolerance || point.y > bottom + tolerance) return null;
  const nearLeft = Math.abs(point.x - left) <= tolerance;
  const nearRight = !nearLeft && Math.abs(point.x - right) <= tolerance;
  const nearTop = Math.abs(point.y - top) <= tolerance;
  const nearBottom = !nearTop && Math.abs(point.y - bottom) <= tolerance;
  const vertical = nearTop ? 'n' : nearBottom ? 's' : '';
  const horizontal = nearLeft ? 'w' : nearRight ? 'e' : '';
  const handle = `${vertical}${horizontal}`;
  return handle === '' ? 'move' : (handle as RectHandle);
}

const MIN = -COLLISION_COORD_LIMIT;
const MAX = COLLISION_COORD_LIMIT;

function clampInterval(start: number, size: number): { start: number; size: number } {
  const length = Math.min(size, MAX - MIN);
  return { start: Math.min(MAX - length, Math.max(MIN, start)), size: length };
}

/** An interval from two edges in any order, at least one pixel long. */
function span(a: number, b: number): { start: number; size: number } {
  const start = Math.min(a, b);
  return { start, size: Math.max(1, Math.max(a, b) - start) };
}

/**
 * `rect` after dragging `handle` by (dx, dy) piece pixels, snapped. A resize
 * keeps the opposite side and flips past it rather than collapsing; the
 * result always stays within the bounds the server accepts.
 */
export function dragRect(rect: CollisionRect, handle: RectHandle, dx: number, dy: number, snap: CollisionSnap): CollisionRect {
  if (handle === 'move') {
    const h = clampInterval(snapValue(rect.x + dx, snap), rect.w);
    const v = clampInterval(snapValue(rect.y + dy, snap), rect.h);
    return { x: h.start, y: v.start, w: h.size, h: v.size };
  }
  let left = rect.x;
  let right = rect.x + rect.w;
  let top = rect.y;
  let bottom = rect.y + rect.h;
  if (handle.includes('w')) left = snapValue(left + dx, snap);
  if (handle.includes('e')) right = snapValue(right + dx, snap);
  if (handle.includes('n')) top = snapValue(top + dy, snap);
  if (handle.includes('s')) bottom = snapValue(bottom + dy, snap);
  const clamp = (value: number): number => Math.min(MAX, Math.max(MIN, value));
  const h = span(clamp(left), clamp(right));
  const v = span(clamp(top), clamp(bottom));
  return { x: h.start, y: v.start, w: h.size, h: v.size };
}

/** A new rectangle dragged from `from` to `to`, snapped; `null` when the drag was only a click. */
export function rectFromDrag(from: CollisionPoint, to: CollisionPoint, snap: CollisionSnap): CollisionRect | null {
  const clamp = (value: number): number => Math.min(MAX, Math.max(MIN, snapValue(value, snap)));
  const x0 = clamp(Math.min(from.x, to.x));
  const x1 = clamp(Math.max(from.x, to.x));
  const y0 = clamp(Math.min(from.y, to.y));
  const y1 = clamp(Math.max(from.y, to.y));
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The rectangle the "add" button puts down: 16x16 above the anchor, then next to the last one. */
export function newRectToward(rects: readonly CollisionRect[]): CollisionRect {
  const last = rects.at(-1);
  if (last === undefined) return { x: -8, y: -16, w: 16, h: 16 };
  return dragRect({ x: last.x, y: last.y, w: 16, h: 16 }, 'move', 8, 8, 1);
}
