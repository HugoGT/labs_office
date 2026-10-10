/**
 * Geometria pura de la camara principal (#53, #98, #179), sin Phaser -- mismo
 * motivo que `cameraPan.ts`: probarla con `pnpm test`.
 *
 * #53: `setBounds` a un rectangulo mas chico que la vista visible clampa el
 * scroll a su borde, asi que `regionBounds` centra ese eje en vez de fijarlo
 * arriba a la izquierda. #179: el rectangulo ya no es el mundo (casi todo
 * `void` negro) sino `terrainRegion`, el terreno pintado mas un margen de
 * `CAMERA_MARGIN_TILES` tiles; seguir, arrastrar y el minimapa comparten esos mismos bounds, asi
 * que soltar o empezar un drag nunca hace saltar la camara.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScrollRange {
  min: number;
  max: number;
}

/** A menos de esto del destino el planeo aterriza exacto (medio pixel no se ve). */
export const GLIDE_ARRIVE_PX = 0.5;

/**
 * Rango de scroll que deja `Camera.clampX/clampY` de Phaser 3.90 para un eje:
 * `viewSize` es `camera.width` (o `height`) y la vista visible real es
 * `viewSize / zoom`.
 */
export function scrollRange(
  boundsStart: number,
  boundsSize: number,
  viewSize: number,
  zoom: number,
): ScrollRange {
  const displaySize = viewSize / zoom;
  const min = boundsStart + (displaySize - viewSize) / 2;
  return { min, max: Math.max(min, min + boundsSize - displaySize) };
}

/** Scroll que centra `point` en la vista, igual que `Camera.centerOn` (no depende del zoom). */
export function centeredScroll(point: number, viewSize: number): number {
  return point - viewSize / 2;
}

/**
 * Tiles of void the camera may show past the painted terrain (#179). A whole
 * 9x9 block was tried first and read as too much black around the office.
 */
export const CAMERA_MARGIN_TILES = 3;

/**
 * The pixel box the main camera may show (#179): the blocks that are not
 * `void` (water counts, it is drawn), expanded by `marginPx` on every side so
 * the edge of the terrain never sits on the screen edge. The margin may pass
 * the world edges on purpose: it is black like the void either way. With
 * every block void there is no terrain to frame, so the whole grid is the box.
 */
export function terrainRegion(
  blocks: readonly string[],
  columns: number,
  blockPx: number,
  marginPx: number,
): Rect {
  let minColumn = Infinity;
  let minRow = Infinity;
  let maxColumn = -Infinity;
  let maxRow = -Infinity;
  blocks.forEach((material, index) => {
    if (material === 'void') return;
    const column = index % columns;
    const row = Math.floor(index / columns);
    minColumn = Math.min(minColumn, column);
    maxColumn = Math.max(maxColumn, column);
    minRow = Math.min(minRow, row);
    maxRow = Math.max(maxRow, row);
  });
  if (minColumn === Infinity) {
    return { x: 0, y: 0, width: columns * blockPx, height: Math.ceil(blocks.length / columns) * blockPx };
  }
  return {
    x: minColumn * blockPx - marginPx,
    y: minRow * blockPx - marginPx,
    width: (maxColumn - minColumn + 1) * blockPx + 2 * marginPx,
    height: (maxRow - minRow + 1) * blockPx + 2 * marginPx,
  };
}

/**
 * The main camera bounds for `region`, aware of zoom, whether it follows the
 * player, is dragged or glides to a minimap point. Phaser's clamp collapses to
 * the bounds start when the visible area (view / zoom) covers the bounds, which
 * would pin the region to the top-left; on such an axis the bounds are widened
 * to exactly the visible area, centered on the region, so the clamp pins it
 * centered instead and that axis cannot be dragged. Otherwise the axis is the
 * region's own span.
 */
export function regionBounds(
  region: Rect,
  view: { width: number; height: number },
  zoom: number,
): Rect {
  const displayWidth = view.width / zoom;
  const displayHeight = view.height / zoom;
  const centeredX = displayWidth >= region.width;
  const centeredY = displayHeight >= region.height;
  return {
    x: centeredX ? region.x - (displayWidth - region.width) / 2 : region.x,
    y: centeredY ? region.y - (displayHeight - region.height) / 2 : region.y,
    width: centeredX ? displayWidth : region.width,
    height: centeredY ? displayHeight : region.height,
  };
}

/**
 * Un cuadro de planeo: la misma interpolacion por cuadro que `startFollow`
 * con lerp, para que volver al jugador o ir a un punto del minimapa se sienta
 * igual que el seguimiento de siempre.
 */
export function glideStep(
  current: number,
  target: number,
  lerp: number,
): { value: number; arrived: boolean } {
  const next = current + (target - current) * lerp;
  if (Math.abs(target - next) < GLIDE_ARRIVE_PX) return { value: target, arrived: true };
  return { value: next, arrived: false };
}
