/**
 * Fusion de tiles solidos contiguos en rectangulos, portada de
 * `buildColliders` (`prototype/js/app.js:392-408`). Solo fusiona por fila
 * (run-length horizontal); nunca fusiona verticalmente.
 *
 * Devuelve unidades de tile, no pixeles: este modulo no conoce `TILE`.
 * `OfficeScene` convierte a rectangulos centrados en pixeles en el punto de
 * uso (D6).
 */

export interface TileRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function mergeColliderRects(solid: readonly (readonly boolean[])[]): TileRect[] {
  const rects: TileRect[] = [];

  for (let y = 0; y < solid.length; y++) {
    const row = solid[y];
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      const x0 = x;
      while (x < row.length && row[x]) x++;
      rects.push({ x: x0, y, w: x - x0, h: 1 });
    }
  }

  return rects;
}
