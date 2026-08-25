import { describe, expect, it } from 'vitest';
import { GROUND, MAP_H, MAP_W, ROOMS, TILE } from './mapData';
import {
  ADJACENT_OFFSETS,
  buildTerrainGrid,
  findFreeAdjacentTile,
  isBlocked,
  markSolid,
} from './terrainGrid';

describe('buildTerrainGrid', () => {
  it('tiene las dimensiones declaradas y todo el borde exterior es seto solido (app.js:217-231)', () => {
    const grid = buildTerrainGrid();

    expect(grid.ground).toHaveLength(MAP_H);
    expect(grid.ground[0]).toHaveLength(MAP_W);

    for (let x = 0; x < MAP_W; x++) {
      expect(grid.ground[0][x]).toBe(GROUND.GD);
      expect(grid.solid[0][x]).toBe(true);
      expect(grid.ground[MAP_H - 1][x]).toBe(GROUND.GD);
      expect(grid.solid[MAP_H - 1][x]).toBe(true);
    }
    for (let y = 0; y < MAP_H; y++) {
      expect(grid.ground[y][0]).toBe(GROUND.GD);
      expect(grid.solid[y][0]).toBe(true);
      expect(grid.ground[y][MAP_W - 1]).toBe(GROUND.GD);
      expect(grid.solid[y][MAP_W - 1]).toBe(true);
    }
  });

  it('el rio deja pasar exactamente dos puentes de 3 tiles por fila (app.js:235-237)', () => {
    const grid = buildTerrainGrid();

    for (const y of [19, 20, 21]) {
      const bridgeSpans: number[][] = [];
      let current: number[] = [];
      for (let x = 1; x <= 47; x++) {
        const isBridgeTile = grid.ground[y][x] === GROUND.BRIDGE;
        if (isBridgeTile) {
          expect(grid.solid[y][x]).toBe(false);
          current.push(x);
        } else {
          expect(grid.ground[y][x]).toBe(GROUND.WATER);
          expect(grid.solid[y][x]).toBe(true);
          if (current.length > 0) {
            bridgeSpans.push(current);
            current = [];
          }
        }
      }
      if (current.length > 0) bridgeSpans.push(current);

      expect(bridgeSpans).toHaveLength(2);
      expect(bridgeSpans[0]).toEqual([13, 14, 15]);
      expect(bridgeSpans[1]).toEqual([32, 33, 34]);
    }
  });

  it('cada sala tiene su puerta de dos tiles solo en la pared izquierda (app.js:240-249)', () => {
    const grid = buildTerrainGrid();
    const doorPlan = [
      { doorY: [8, 9], floorCode: GROUND.FLOOR },
      { doorY: [24, 25], floorCode: GROUND.WOODF },
    ];

    ROOMS.forEach((room, ri) => {
      const x0 = room.x / TILE;
      const y0 = room.y / TILE;
      const x1 = x0 + room.w / TILE - 1;
      const y1 = y0 + room.h / TILE - 1;
      const { doorY, floorCode } = doorPlan[ri];

      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const isWall = x === x0 || x === x1 || y === y0 || y === y1;
          if (!isWall) continue;

          const isDoor = x === x0 && doorY.includes(y);
          if (isDoor) {
            expect(grid.ground[y][x]).toBe(floorCode);
            expect(grid.solid[y][x]).toBe(false);
          } else {
            expect(grid.ground[y][x]).toBe(GROUND.WALL);
            expect(grid.solid[y][x]).toBe(true);
          }
        }
      }

      for (const y of doorY) {
        expect(grid.ground[y][48]).toBe(GROUND.CORR);
        expect(grid.ground[y][49]).toBe(GROUND.CORR);
        expect(grid.solid[y][48]).toBe(false);
        expect(grid.solid[y][49]).toBe(false);
      }
    });
  });

  it('el pasillo entre el cesped y las salas es transitable (app.js:233)', () => {
    const grid = buildTerrainGrid();

    for (let y = 1; y < MAP_H - 1; y++) {
      expect(grid.ground[y][48]).toBe(GROUND.CORR);
      expect(grid.ground[y][49]).toBe(GROUND.CORR);
      expect(grid.solid[y][48]).toBe(false);
      expect(grid.solid[y][49]).toBe(false);
    }
  });

  it('el jardin trasero de las salas es transitable (app.js:251-252)', () => {
    const grid = buildTerrainGrid();

    for (let y = 33; y <= 42; y++) {
      for (let x = 50; x <= 62; x++) {
        expect(grid.ground[y][x]).toBe(GROUND.GD);
        expect(grid.solid[y][x]).toBe(false);
      }
    }
  });
});

describe('markSolid', () => {
  it('marca solido un rectangulo explicito (app.js:224-226, expuesto en vez de oculto)', () => {
    const solid = Array.from({ length: 5 }, () => Array<boolean>(5).fill(false));

    markSolid(solid, 1, 1, 2, 3);

    expect(solid[1][1]).toBe(true);
    expect(solid[2][2]).toBe(true);
    expect(solid[3][1]).toBe(true);
    expect(solid[0][0]).toBe(false);
    expect(solid[4][4]).toBe(false);
  });
});

describe('isBlocked', () => {
  it('bloquea tiles solidos o de agua dentro de los limites (app.js:378,480)', () => {
    const grid = buildTerrainGrid();

    // (14,19) esta en el rio, fuera de los dos puentes -> bloqueado.
    expect(isBlocked(grid, 20, 19)).toBe(true);
    // (13,19) es puente -> libre.
    expect(isBlocked(grid, 13, 19)).toBe(false);
  });

  it('bloquea cualquier tile fuera del rango 1..MAP-2 aunque no sea solido (app.js:377,480)', () => {
    const grid = buildTerrainGrid();

    expect(isBlocked(grid, 0, 20)).toBe(true);
    expect(isBlocked(grid, MAP_W - 1, 20)).toBe(true);
    expect(isBlocked(grid, 20, 0)).toBe(true);
    expect(isBlocked(grid, 20, MAP_H - 1)).toBe(true);
  });
});

describe('findFreeAdjacentTile', () => {
  it('devuelve la primera tile libre siguiendo ADJACENT_OFFSETS en orden', () => {
    const grid = buildTerrainGrid();

    // (6,26) es cesped libre; su primer offset [1,0] apunta a (7,26), tambien libre.
    expect(findFreeAdjacentTile(grid, 6, 26)).toEqual({ tx: 7, ty: 26 });
    expect(ADJACENT_OFFSETS[0]).toEqual([1, 0]);
  });

  it('salta los offsets bloqueados en vez de rendirse en el primero', () => {
    const grid = buildTerrainGrid();
    // Bloquea a mano el vecino [1,0] de (6,26): debe caer al siguiente offset [-1,0].
    grid.solid[26][7] = true;

    expect(findFreeAdjacentTile(grid, 6, 26)).toEqual({ tx: 5, ty: 26 });
  });

  it('devuelve null cuando ningun vecino esta libre', () => {
    const grid = buildTerrainGrid();
    for (const [dx, dy] of ADJACENT_OFFSETS) {
      grid.solid[26 + dy][6 + dx] = true;
    }

    expect(findFreeAdjacentTile(grid, 6, 26)).toBeNull();
  });

  it('nunca devuelve la propia tile objetivo', () => {
    const grid = buildTerrainGrid();

    const found = findFreeAdjacentTile(grid, 6, 26);
    expect(found).not.toEqual({ tx: 6, ty: 26 });
  });
});
