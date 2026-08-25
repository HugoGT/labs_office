/**
 * Rejilla logica del mapa (suelo + colisiones), portada de `buildGrid`
 * (`prototype/js/app.js:215-253`). Sin dependencias de Phaser.
 */

import { GROUND, MAP_H, MAP_W, ROOMS, TILE, type GroundCode } from './mapData';

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

export function buildTerrainGrid(): TerrainGrid {
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
  ROOMS.forEach((room, ri) => {
    const x0 = room.x / TILE;
    const y0 = room.y / TILE;
    const x1 = x0 + room.w / TILE - 1;
    const y1 = y0 + room.h / TILE - 1;
    const doorY = ri === 0 ? [8, 9] : [24, 25];
    const floorCode = ri === 0 ? GROUND.FLOOR : GROUND.WOODF;

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
 * Vivia dentro de `OfficeScene` como `TELEPORT_OFFSETS` (app.js:477), pero el
 * mismo recorrido lo necesitan ahora las dos direcciones: el jugador yendo al
 * escritorio de un NPC y el NPC acudiendo a una llamada. Vive aqui, junto al
 * predicado de bloqueo que consulta.
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
