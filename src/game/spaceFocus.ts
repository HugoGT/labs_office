/**
 * The shade over everything outside the space the local player stands in
 * (a room or a desk cubicle): the space reads as "where I am" and the rest
 * steps back a little. Pure geometry; `OfficeScene` draws it.
 */

export interface ShadeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Name of each shade rectangle in the scene, so tests and the minimap can find them. */
export const SPACE_SHADE_NAME = 'space-shade';

/** Black at this alpha: enough to notice, never enough to hide who walks out there. */
export const SPACE_SHADE_ALPHA = 0.28;

/**
 * Up to four rectangles that cover `bounds` except `space`: full-width bands
 * above and below, then the two sides of the space's own rows. Empty sides
 * are dropped; a space past the edge is clamped to it first.
 */
export function shadeAround(space: ShadeRect, bounds: ShadeRect): ShadeRect[] {
  const right = bounds.x + bounds.w;
  const bottom = bounds.y + bounds.h;
  const left = Math.min(Math.max(space.x, bounds.x), right);
  const top = Math.min(Math.max(space.y, bounds.y), bottom);
  const spaceRight = Math.min(Math.max(space.x + space.w, left), right);
  const spaceBottom = Math.min(Math.max(space.y + space.h, top), bottom);

  const rects: ShadeRect[] = [
    { x: bounds.x, y: bounds.y, w: bounds.w, h: top - bounds.y },
    { x: bounds.x, y: spaceBottom, w: bounds.w, h: bottom - spaceBottom },
    { x: bounds.x, y: top, w: left - bounds.x, h: spaceBottom - top },
    { x: spaceRight, y: top, w: right - spaceRight, h: spaceBottom - top },
  ];
  return rects.filter((rect) => rect.w > 0 && rect.h > 0);
}

/**
 * What the shade depends on, so the scene redraws it only when the space
 * changes (walking in or out, or an edit that moved it), not every frame.
 */
export function shadeKey(space: (ShadeRect & { id: string }) | null): string | null {
  return space === null ? null : `${space.id}:${space.x},${space.y},${space.w},${space.h}`;
}
