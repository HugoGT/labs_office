/**
 * Rejilla logica del mapa (suelo + colisiones) que usa el cliente: la
 * colision de Arcade, la auto-caminata y el teletransporte de e2e. Sin
 * dependencias de Phaser.
 *
 * Art migration, step 8: the grid is no longer built here. It is a 2D view of
 * a `TerrainSnapshot` of the Tiled layout (`officeLayout.ts`) and of the
 * pieces' collision rectangles (`pieceCollisions.ts`), the two rules the
 * server checks a `move` against.
 */

import { BASE_COLLISION_RECTS } from './officeCollisions';
import { BASE_LAYOUT, BASE_TERRAIN, type LayoutMaterial, type OfficeLayout, type TerrainSnapshot } from './officeLayout';
import { coveredTiles, type CollisionRect } from './pieceCollisions';

export interface TerrainGrid {
  /** Effective terrain material of each tile, `[ty][tx]`. */
  terrain: LayoutMaterial[][];
  /** Walls and hedges: tiles a space's floor never covers. */
  walled: boolean[][];
  /** Not walkable as terrain (`terrainSnapshot`): water, walls, hedges. The Arcade tile colliders. */
  terrainSolid: boolean[][];
  /**
   * Blocked for the tile helpers (auto-walk, free tile next to someone, the
   * e2e teleport): the terrain, plus any tile a piece's collision rectangle
   * touches at all, even a corner of it (`coveredTiles`).
   */
  solid: boolean[][];
}

/**
 * The grid of a terrain snapshot and the collision rectangles of the pieces.
 * Persisted blocks (#123 phase 2) pass their own snapshot; the layout
 * supplies the walls and hedges, which blocks never change.
 */
export function buildTerrainGrid(
  terrain: TerrainSnapshot = BASE_TERRAIN,
  layout: OfficeLayout = BASE_LAYOUT,
  rects: readonly CollisionRect[] = BASE_COLLISION_RECTS,
): TerrainGrid {
  const grid: TerrainGrid = { terrain: [], walled: [], terrainSolid: [], solid: [] };
  const covered = coveredTiles(rects, terrain.width, terrain.height);
  for (let ty = 0; ty < terrain.height; ty++) {
    const row = ty * terrain.width;
    grid.terrain.push(terrain.materials.slice(row, row + terrain.width));
    const terrainSolid = terrain.walkable.slice(row, row + terrain.width).map((walkable) => !walkable);
    grid.terrainSolid.push(terrainSolid);
    grid.solid.push(terrainSolid.map((blocked, tx) => blocked || covered[row + tx]!));
    grid.walled.push(
      Array.from({ length: terrain.width }, (_, tx) => layout.walls[row + tx] !== null || layout.hedges[row + tx] !== null),
    );
  }
  return grid;
}

/**
 * Une los dos predicados de bloqueo que el prototipo duplicaba (wander en
 * `app.js:378`, teletransporte en `app.js:480`). The world's border is a
 * solid hedge, and anything outside the map is blocked too.
 */
export function isBlocked(grid: TerrainGrid, tx: number, ty: number): boolean {
  const row = grid.solid[ty];
  if (row === undefined || tx < 0 || tx >= row.length) return true;
  return row[tx]!;
}

/**
 * Orden en que se prueban los vecinos al buscar una tile libre junto a otra.
 * Vivia dentro de `OfficeScene` como `TELEPORT_OFFSETS` (app.js:477). Vive
 * aqui, junto al predicado de bloqueo que consulta, porque lo usa la
 * auto-caminata hacia un companero que acepta una llamada.
 */
export const ADJACENT_OFFSETS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
];

export interface TileCoord {
  tx: number;
  ty: number;
}

/**
 * Primera tile libre adyacente a `(tx, ty)` siguiendo `ADJACENT_OFFSETS`, o
 * `null` si todas estan bloqueadas. Ningun offset es `[0,0]`, asi que nunca
 * devuelve la propia tile objetivo: el destino siempre es *junto a*, no
 * *encima de*.
 */
export function findFreeAdjacentTile(
  grid: TerrainGrid,
  tx: number,
  ty: number,
): TileCoord | null {
  for (const [dx, dy] of ADJACENT_OFFSETS) {
    const nx = tx + dx;
    const ny = ty + dy;
    if (!isBlocked(grid, nx, ny)) return { tx: nx, ty: ny };
  }
  return null;
}

/** Rectangulo de tiles inclusivo (`x0..x1`, `y0..y1`), como lo devuelve un `SpaceArea` convertido de pixeles a tiles. */
export interface TileRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function insideRect(rect: TileRect, tx: number, ty: number): boolean {
  return tx >= rect.x0 && tx <= rect.x1 && ty >= rect.y0 && ty <= rect.y1;
}

/**
 * Destino de la auto-caminata al aceptar una llamada (issue #10, S2 3.1),
 * cuando quien llama esta dentro de un espacio (sala o cubiculo de
 * escritorio, ambos son `TileRect` para esta funcion -- no distingue tipo).
 *
 * `peerSpaceTiles: null` (piso abierto): delega enteramente en
 * `findFreeAdjacentTile`, comportamiento de hoy sin cambios (D-diseno).
 *
 * Con espacio: primero el primer `ADJACENT_OFFSETS` que cae DENTRO del
 * rectangulo y libre -- el caso comun, pegado a quien llama. Si ninguno
 * califica (bloqueados o fuera del rectangulo), escanea TODO el rectangulo
 * ordenado por distancia Chebyshev al peer (empate: `dy` luego `dx`,
 * ascendente), saltando la propia tile del peer, y toma la primera libre.
 * Si el rectangulo entero esta bloqueado, cae a `findFreeAdjacentTile` sin
 * restriccion de rectangulo -- ese fallback puede aterrizar fuera del
 * espacio, pero es mejor que no moverse.
 */
export function findWalkDestination(
  grid: TerrainGrid,
  peerTile: TileCoord,
  peerSpaceTiles: TileRect | null,
): TileCoord | null {
  if (!peerSpaceTiles) return findFreeAdjacentTile(grid, peerTile.tx, peerTile.ty);

  for (const [dx, dy] of ADJACENT_OFFSETS) {
    const nx = peerTile.tx + dx;
    const ny = peerTile.ty + dy;
    if (insideRect(peerSpaceTiles, nx, ny) && !isBlocked(grid, nx, ny)) return { tx: nx, ty: ny };
  }

  const candidates: TileCoord[] = [];
  for (let ty = peerSpaceTiles.y0; ty <= peerSpaceTiles.y1; ty++) {
    for (let tx = peerSpaceTiles.x0; tx <= peerSpaceTiles.x1; tx++) {
      if (tx === peerTile.tx && ty === peerTile.ty) continue;
      candidates.push({ tx, ty });
    }
  }
  candidates.sort((a, b) => {
    const distanceA = Math.max(Math.abs(a.tx - peerTile.tx), Math.abs(a.ty - peerTile.ty));
    const distanceB = Math.max(Math.abs(b.tx - peerTile.tx), Math.abs(b.ty - peerTile.ty));
    if (distanceA !== distanceB) return distanceA - distanceB;
    if (a.ty !== b.ty) return a.ty - b.ty;
    return a.tx - b.tx;
  });

  for (const candidate of candidates) {
    if (!isBlocked(grid, candidate.tx, candidate.ty)) return candidate;
  }

  return findFreeAdjacentTile(grid, peerTile.tx, peerTile.ty);
}

/**
 * Destino de la auto-caminata hacia un peer (#59): a diferencia de
 * `findWalkDestination`, que prueba `ADJACENT_OFFSETS` en un orden fijo sin
 * enterarse de por donde viene el jugador, esta funcion apunta a la tile del
 * lado del peer que el `walker` esta cruzando -- el eje de mayor distancia
 * manda, y un empate exacto lo rompe el eje vertical (decision de usuario
 * 2026-09-24: sin pathfinding, apuntar al lado lejano obligaria a atravesar
 * al peer).
 *
 * Si el walker ya esta en la tile del peer, o la tile elegida esta bloqueada
 * o cae fuera del rectangulo del espacio, cae intacto a
 * `findWalkDestination` -- el mismo camino que ya cubren sus pruebas y la
 * regresion de `OfficeScene.browser.test.ts`.
 */
export function pickApproachTile(
  grid: TerrainGrid,
  walker: TileCoord,
  peer: TileCoord,
  peerSpaceTiles: TileRect | null,
): TileCoord | null {
  const dx = walker.tx - peer.tx;
  const dy = walker.ty - peer.ty;

  if (dx === 0 && dy === 0) return findWalkDestination(grid, peer, peerSpaceTiles);

  const [ox, oy] = Math.abs(dy) >= Math.abs(dx) ? [0, Math.sign(dy)] : [Math.sign(dx), 0];
  const tile = { tx: peer.tx + ox, ty: peer.ty + oy };
  const withinSpace = !peerSpaceTiles || insideRect(peerSpaceTiles, tile.tx, tile.ty);

  if (withinSpace && !isBlocked(grid, tile.tx, tile.ty)) return tile;

  return findWalkDestination(grid, peer, peerSpaceTiles);
}
