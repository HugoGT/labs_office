/** Shared placement geometry, kept import-free for both client and server. */

export interface SpaceBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Positive-area overlap of valid tile bounds (#180). Touching edges and
 * corners are legal: these half-open intervals match the int4range GiST
 * exclusions for spaces (including desk cubicles) and desks in schema.sql.
 */
export function boundsOverlap(a: SpaceBounds, b: SpaceBounds): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
