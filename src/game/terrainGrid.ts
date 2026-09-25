/**
 * Rejilla logica del mapa (suelo + colisiones), portada de `buildGrid`
 * (`prototype/js/app.js:215-253`). Sin dependencias de Phaser.
 */

import { BUILT_IN_SPACES, GROUND, MAP_H, MAP_W, TILE, type GroundCode, type Room } from './mapData';

export interface TerrainGrid {
  ground: GroundCode[][];
  solid: boolean[][];
}

/**
 * Marca solido un rectangulo de tiles. En el prototipo era `this.setSolid`,
 * asignado dentro de `buildGrid` (`app.js:224`) y usado luego por la
 * colocacion de mobiliario/arboles antes de fusionar colisiones. Aqui se
 * expone como parametro explicito: la coupling temporal deja de ser oculta.
 */
export function markSolid(
  solid: boolean[][],
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  for (let j = y; j < y + h; j++) {
    for (let i = x; i < x + w; i++) {
      solid[j][i] = true;
    }
  }
}

function set(grid: TerrainGrid, x: number, y: number, code: GroundCode, isSolid = false): void {
  grid.ground[y][x] = code;
  grid.solid[y][x] = isSolid;
}

/**
 * `spaces` tiene valor por defecto `BUILT_IN_SPACES` (D3): esta funcion sigue
 * dibujando SOLO el mapa base -- muros, puertas, suelo -- nunca la config
 * servida (slice 3). El parametro existe para que un futuro llamador con
 * espacios propios (tests) no tenga que reimportar la constante, pero ninguna
 * llamada existente sin argumento cambia de comportamiento.
 */
export function buildTerrainGrid(spaces: readonly Room[] = BUILT_IN_SPACES): TerrainGrid {
  const ground: GroundCode[][] = [];
  const solid: boolean[][] = [];
  for (let y = 0; y < MAP_H; y++) {
    ground[y] = new Array(MAP_W).fill(GROUND.G) as GroundCode[];
    solid[y] = new Array(MAP_W).fill(false) as boolean[];
  }
  const grid: TerrainGrid = { ground, solid };

  // Borde de seto (oscuro, solido).
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (x === 0 || y === 0 || x === MAP_W - 1 || y === MAP_H - 1) {
        set(grid, x, y, GROUND.GD, true);
      }
    }
  }

  // Pasillo que conecta el cesped con las salas.
  for (let y = 1; y < MAP_H - 1; y++) {
    set(grid, 48, y, GROUND.CORR);
    set(grid, 49, y, GROUND.CORR);
  }

  // Rio con dos puentes.
  for (let y = 19; y <= 21; y++) {
    for (let x = 1; x <= 47; x++) {
      const onBridge = (x >= 13 && x <= 15) || (x >= 32 && x <= 34);
      set(grid, x, y, onBridge ? GROUND.BRIDGE : GROUND.WATER, !onBridge);
    }
  }

  // Salas a la derecha (paredes con puerta al pasillo).
  spaces.forEach((room) => {
    const x0 = room.x / TILE;
    const y0 = room.y / TILE;
    const x1 = x0 + room.w / TILE - 1;
    const y1 = y0 + room.h / TILE - 1;
    const doorY = room.doorTiles;
    const floorCode = room.floorStyle;

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const isWall = x === x0 || x === x1 || y === y0 || y === y1;
        if (isWall && x === x0 && doorY.includes(y)) {
          set(grid, x, y, floorCode, false);
        } else if (isWall) {
          set(grid, x, y, GROUND.WALL, true);
        } else {
          set(grid, x, y, floorCode, false);
        }
      }
    }
  });

  // Jardin trasero de las salas.
  for (let y = 33; y <= 42; y++) {
    for (let x = 50; x <= 62; x++) {
      set(grid, x, y, GROUND.GD, false);
    }
  }

  return grid;
}

/**
 * Une los dos predicados de bloqueo que el prototipo duplicaba (wander en
 * `app.js:378`, teletransporte en `app.js:480`): solido o agua, dentro del
 * rango interior `1..MAP-2`.
 */
export function isBlocked(grid: TerrainGrid, tx: number, ty: number): boolean {
  if (tx < 1 || ty < 1 || tx > MAP_W - 2 || ty > MAP_H - 2) return true;
  return grid.solid[ty][tx] || grid.ground[ty][tx] === GROUND.WATER;
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
