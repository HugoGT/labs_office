import { describe, expect, it } from 'vitest';
import { BUILT_IN_SPACES, GROUND, MAP_H, MAP_W, TILE } from './mapData';
import { audiblePeers, type AudibleInput, type AudioPeer } from './proximityAudio';
import {
  ADJACENT_OFFSETS,
  buildTerrainGrid,
  findFreeAdjacentTile,
  findWalkDestination,
  isBlocked,
  markSolid,
  type TileRect,
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

    BUILT_IN_SPACES.forEach((room, ri) => {
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

/**
 * `findWalkDestination` (issue #10, S2 3.1): el destino de la auto-caminata al
 * aceptar una llamada cuando quien llama esta dentro de un espacio (sala o
 * cubiculo). `peerSpaceTiles: null` (piso abierto) delega enteramente en
 * `findFreeAdjacentTile` -- comportamiento de hoy, sin cambios.
 */
describe('findWalkDestination', () => {
  it('con peerSpaceTiles null, es exactamente findFreeAdjacentTile (piso abierto, sin cambios)', () => {
    const grid = buildTerrainGrid();

    expect(findWalkDestination(grid, { tx: 6, ty: 26 }, null)).toEqual(
      findFreeAdjacentTile(grid, 6, 26),
    );
    expect(findWalkDestination(grid, { tx: 6, ty: 26 }, null)).toEqual({ tx: 7, ty: 26 });
  });

  it('dentro de un espacio, prefiere el primer ADJACENT_OFFSETS que cae DENTRO del rectangulo', () => {
    const grid = buildTerrainGrid();
    // Rectangulo 3x3 en cesped abierto, lejos de cualquier colisionador del
    // mapa base. El peer esta en el centro: [1,0] -> (12,27) cae dentro.
    const rect: TileRect = { x0: 10, y0: 26, x1: 12, y1: 28 };

    expect(findWalkDestination(grid, { tx: 11, ty: 27 }, rect)).toEqual({ tx: 12, ty: 27 });
    expect(ADJACENT_OFFSETS[0]).toEqual([1, 0]);
  });

  it('con el peer en el borde del rectangulo, salta el primer offset que cae fuera y toma el siguiente que cae dentro', () => {
    const grid = buildTerrainGrid();
    const rect: TileRect = { x0: 10, y0: 26, x1: 12, y1: 28 };
    // Borde derecho del rectangulo, no el centro: [1,0] -> (13,27) cae FUERA
    // (x1=12), asi que la fase adyacente debe seguir probando offsets en vez
    // de rendirse o saltar directamente al escaneo del rectangulo.
    const peer = { tx: 12, ty: 27 };

    // El rectangulo esta libre entero: si el resultado fuese el del escaneo
    // (distancia Chebyshev) o el del fallback fuera del rectangulo, esta
    // asercion lo distinguiria de (11,27).
    expect(findWalkDestination(grid, peer, rect)).toEqual({ tx: 11, ty: 27 });
    expect(ADJACENT_OFFSETS[0]).toEqual([1, 0]);
    expect(ADJACENT_OFFSETS[1]).toEqual([-1, 0]);
  });

  it('si los ADJACENT_OFFSETS del peer estan todos bloqueados, escanea el rectangulo por distancia Chebyshev (empate: dy, luego dx)', () => {
    const grid = buildTerrainGrid();
    const rect: TileRect = { x0: 10, y0: 26, x1: 12, y1: 28 };
    const peer = { tx: 11, ty: 27 };

    // Bloquea los 6 vecinos de ADJACENT_OFFSETS (todos caen dentro del
    // rectangulo porque el peer esta en su centro). Quedan libres las dos
    // esquinas que ADJACENT_OFFSETS nunca prueba: (10,26) y (12,26).
    for (const [dx, dy] of ADJACENT_OFFSETS) grid.solid[peer.ty + dy][peer.tx + dx] = true;

    // Ambas esquinas estan a distancia Chebyshev 1 del peer; el empate lo
    // rompe primero dy (ambas dy=-1, igual) y luego dx ascendente: -1 antes
    // que 1, asi que (10,26) gana sobre (12,26).
    expect(findWalkDestination(grid, peer, rect)).toEqual({ tx: 10, ty: 26 });
  });

  it('con el rectangulo entero bloqueado, cae a findFreeAdjacentTile FUERA del rectangulo', () => {
    const grid = buildTerrainGrid();
    const rect: TileRect = { x0: 10, y0: 26, x1: 12, y1: 28 };
    const peer = { tx: 12, ty: 27 }; // borde derecho del rectangulo.

    // Bloquea las 9 tiles del rectangulo (incluidas las dos esquinas que la
    // prueba anterior dejaba libres): ni la fase adyacente ni el escaneo
    // encuentran nada dentro.
    for (let ty = rect.y0; ty <= rect.y1; ty++) {
      for (let tx = rect.x0; tx <= rect.x1; tx++) grid.solid[ty][tx] = true;
    }

    // (13,27) esta FUERA del rectangulo (x1=12) y libre: la fase adyacente
    // restringida al rectangulo la descarta, pero el fallback incondicional
    // a `findFreeAdjacentTile` (que ignora el rectangulo) la encuentra.
    expect(findWalkDestination(grid, peer, rect)).toEqual({ tx: 13, ty: 27 });
    expect(findFreeAdjacentTile(grid, peer.tx, peer.ty)).toEqual({ tx: 13, ty: 27 });
  });

  /**
   * S6 (remediacion), escenario call-invitation "A third participant can join
   * an occupied cubicle": la spec pide que un tercero pueda entrar a un
   * cubiculo ya ocupado por dos, sin tope de participantes.
   *
   * Honestidad de nivel: `findWalkDestination` no tiene ningun concepto de
   * ocupacion -- los avatares NO son colisionadores (D-diseno de esta
   * funcion), asi que "tile libre" significa "no bloqueada por el mapa"
   * (pared/agua), nunca "no ocupada por otro jugador". Esta prueba NO afirma
   * una garantia general de no-solape que la funcion no promete; fija el
   * resultado DETERMINISTA de este algoritmo para esta geometria concreta
   * (identica al caso "prefiere el primer ADJACENT_OFFSETS" de arriba) y deja
   * constancia explicita, via el aserto de "distinto de B", de que la ausencia
   * de tope viene precisamente de que el algoritmo ignora a los demas
   * ocupantes -- no de que los evite a proposito.
   */
  it('un tercer participante puede unirse a un cubiculo ya ocupado por dos: aterriza en una tile distinta a la de A y B, y los tres quedan mutuamente audibles sin tope', () => {
    const grid = buildTerrainGrid();
    const rect: TileRect = { x0: 10, y0: 26, x1: 12, y1: 28 }; // mismo cubiculo 3x3 de los casos de arriba.
    const aTile = { tx: 11, ty: 27 }; // centro del cubiculo, donde esta A.
    const bTile = { tx: 10, ty: 28 }; // otra tile del mismo cubiculo, ya ocupada por B.

    // C acepta la invitacion de A: mismo resultado que "prefiere el primer
    // ADJACENT_OFFSETS que cae DENTRO del rectangulo" (arriba), porque la
    // funcion no sabe que B existe.
    const destinoDeC = findWalkDestination(grid, aTile, rect);

    expect(destinoDeC).toEqual({ tx: 12, ty: 27 });
    expect(destinoDeC).not.toEqual(aTile);
    expect(destinoDeC).not.toEqual(bTile);

    // Sin tope de participantes: los tres, compartiendo spaceId, quedan
    // MUTUAMENTE audibles -- se afirma desde las tres perspectivas, no solo
    // un par, porque `audiblePeers` en general ya esta probado por pares en
    // proximityAudio.test.ts.
    const V1 = 'v1';
    const a: AudioPeer = { sessionId: 'a', x: 0, y: 0, spaceId: 'd1', spacesVersion: V1, status: 'g' };
    const b: AudioPeer = { sessionId: 'b', x: 0, y: 0, spaceId: 'd1', spacesVersion: V1, status: 'g' };
    const c: AudioPeer = { sessionId: 'c', x: 0, y: 0, spaceId: 'd1', spacesVersion: V1, status: 'g' };
    const asSelf = (peer: AudioPeer): AudibleInput['self'] => ({
      sessionId: peer.sessionId,
      x: peer.x,
      y: peer.y,
      spaceId: peer.spaceId,
      spacesVersion: peer.spacesVersion,
      status: peer.status,
    });

    expect(audiblePeers({ self: asSelf(a), peers: [b, c], radius: 1 })).toEqual(['b', 'c']);
    expect(audiblePeers({ self: asSelf(b), peers: [a, c], radius: 1 })).toEqual(['a', 'c']);
    expect(audiblePeers({ self: asSelf(c), peers: [a, b], radius: 1 })).toEqual(['a', 'b']);
  });
});
