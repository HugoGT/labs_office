import { describe, expect, it } from 'vitest';
import { TILE } from './mapData';
import { LEGACY_SPACES as BUILT_IN_SPACES, LEGACY_COLLISIONS as BASE_COLLISION_RECTS, LEGACY_TERRAIN as BASE_TERRAIN, LEGACY_SEATS as BASE_MAP_SEATS } from '../test/legacyOffice';
import { buildLegacyTerrainGrid as buildTerrainGrid } from '../test/legacyTerrainGrid';
import { isTileWalkable } from './officeLayout';
import { isPositionBlocked } from './pieceCollisions';
import { audiblePeers, type AudibleInput, type AudioPeer } from './proximityAudio';
import {
  ADJACENT_OFFSETS,
  findFreeAdjacentTile,
  findWalkDestination,
  isBlocked,
  pickApproachTile,
  type TileRect,
} from './terrainGrid';

/** The legacy fixture keeps the 126x90 world it was drawn in. */
const MAP_W = BASE_TERRAIN.width;
const MAP_H = BASE_TERRAIN.height;

/**
 * The base map as it was built in code before the Tiled layout (art step 8):
 * these coordinates are what spaces, desks and seats were placed against, so
 * the layout keeps every one of them.
 */
describe('buildTerrainGrid: collision rectangles', () => {
  it('keeps the terrain tiles apart from the tiles a piece rectangle touches', () => {
    const lawn = { tx: 67, ty: 22 };
    const rect = { x: lawn.tx * TILE + 30, y: lawn.ty * TILE + 4, w: 8, h: 4 };
    const grid = buildTerrainGrid(BASE_TERRAIN, undefined, [rect]);

    // Arcade gets the terrain tiles and the rectangles apart; the tile helpers see both.
    expect(grid.terrainSolid[lawn.ty][lawn.tx]).toBe(false);
    expect(grid.solid[lawn.ty][lawn.tx]).toBe(true);
    expect(grid.solid[lawn.ty][lawn.tx + 1]).toBe(true);
    expect(grid.solid[lawn.ty + 1][lawn.tx]).toBe(false);
    expect(isBlocked(grid, lawn.tx, lawn.ty)).toBe(true);
  });

  it('blocks the layout props through their default rectangles, as the tiles did', () => {
    const grid = buildTerrainGrid();

    expect(grid.terrainSolid[2][2]).toBe(false);
    expect(grid.solid[2][2]).toBe(true);
  });
});

describe('buildTerrainGrid', () => {
  it('covers its 126x90 world and fences it with a solid hedge', () => {
    const grid = buildTerrainGrid();

    expect(grid.solid).toHaveLength(MAP_H);
    expect(grid.solid[0]).toHaveLength(MAP_W);
    expect(MAP_W).toBe(126);
    expect(MAP_H).toBe(90);
    for (let x = 0; x < MAP_W; x++) {
      for (const y of [0, MAP_H - 1]) {
        expect(grid.walled[y][x]).toBe(true);
        expect(grid.solid[y][x]).toBe(true);
      }
    }
    for (let y = 0; y < MAP_H; y++) {
      for (const x of [0, MAP_W - 1]) {
        expect(grid.walled[y][x]).toBe(true);
        expect(grid.solid[y][x]).toBe(true);
      }
    }
  });

  it('lets the river through only at its two 3-tile bridges, water on both sides (app.js:235-237)', () => {
    const grid = buildTerrainGrid();

    for (const y of [19, 20, 21]) {
      const open: number[] = [];
      for (let x = 1; x <= 47; x++) {
        expect(grid.terrain[y][x]).toBe('water');
        if (!grid.solid[y][x]) open.push(x);
      }
      expect(open).toEqual([13, 14, 15, 32, 33, 34]);
    }
  });

  it('gives each room its two-tile door on the left wall only, onto the corridor (app.js:240-249)', () => {
    const grid = buildTerrainGrid();
    const doorPlan = [
      { doorY: [8, 9], floor: 'carpet' },
      { doorY: [24, 25], floor: 'wood' },
    ];

    BUILT_IN_SPACES.forEach((room, ri) => {
      const x0 = room.x / TILE;
      const y0 = room.y / TILE;
      const x1 = x0 + room.w / TILE - 1;
      const y1 = y0 + room.h / TILE - 1;
      const { doorY, floor } = doorPlan[ri];

      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const isWall = x === x0 || x === x1 || y === y0 || y === y1;
          expect(grid.terrain[y][x]).toBe(floor);
          if (!isWall) continue;
          const isDoor = x === x0 && doorY.includes(y);
          expect(grid.walled[y][x]).toBe(!isDoor);
          expect(grid.solid[y][x]).toBe(!isDoor);
        }
      }

      for (const y of doorY) {
        expect(grid.solid[y][48]).toBe(false);
        expect(grid.solid[y][49]).toBe(false);
      }
    });
  });

  it('keeps the corridor between the lawn and the rooms walkable, and runs it on south (app.js:233)', () => {
    const grid = buildTerrainGrid();

    for (let y = 1; y < 63; y++) {
      expect(grid.terrain[y][48]).toBe(y <= 42 ? 'tile' : 'cobblestone');
      expect(grid.solid[y][48]).toBe(false);
      expect(grid.solid[y][49]).toBe(false);
    }
  });

  it('keeps the garden behind the rooms walkable grass, closed by the hedge of the old border (app.js:251-252)', () => {
    const grid = buildTerrainGrid();
    const trees = new Set(['52,34', '56,36', '60,34']);

    for (let y = 33; y <= 42; y++) {
      for (let x = 50; x <= 62; x++) {
        expect(grid.terrain[y][x]).toBe('grass');
        expect(grid.solid[y][x]).toBe(trees.has(`${x},${y}`));
      }
      expect(grid.walled[y][63]).toBe(true);
    }
    for (let x = 50; x <= 63; x++) expect(grid.walled[43][x]).toBe(true);
  });

  it('opens the rest of the old border onto the new area', () => {
    const grid = buildTerrainGrid();

    expect(grid.solid[10][63]).toBe(false);
    expect(grid.solid[43][20]).toBe(false);
    expect(grid.solid[43][48]).toBe(false);
  });

  it('blocks the base desks, tables, plants and trees, but not the chairs (app.js:264-305)', () => {
    const grid = buildTerrainGrid();
    const solidTiles = [
      [3, 5],
      [8, 5],
      [33, 36],
      [53, 6],
      [59, 10],
      [57, 25],
      [51, 19],
      [61, 30],
      [2, 2],
      [44, 41],
    ];

    for (const [x, y] of solidTiles) expect(grid.solid[y][x], `(${x}, ${y})`).toBe(true);
    for (const seat of BASE_MAP_SEATS) expect(grid.solid[seat.ty][seat.tx]).toBe(false);
  });
});

describe('isBlocked', () => {
  it('bloquea tiles solidos o de agua dentro de los limites (app.js:378,480)', () => {
    const grid = buildTerrainGrid();

    // (20,19) esta en el rio, fuera de los dos puentes -> bloqueado.
    expect(isBlocked(grid, 20, 19)).toBe(true);
    // (13,19) es puente -> libre.
    expect(isBlocked(grid, 13, 19)).toBe(false);
  });

  it('bloquea el borde del mundo y todo lo que queda fuera de el (app.js:377,480)', () => {
    const grid = buildTerrainGrid();

    expect(isBlocked(grid, 0, 20)).toBe(true);
    expect(isBlocked(grid, MAP_W - 1, 20)).toBe(true);
    expect(isBlocked(grid, 20, 0)).toBe(true);
    expect(isBlocked(grid, 20, MAP_H - 1)).toBe(true);
    expect(isBlocked(grid, -1, 20)).toBe(true);
    expect(isBlocked(grid, 20, MAP_H)).toBe(true);
  });

  it('agrees tile by tile with the shared rule the server enforces while every piece keeps its default', () => {
    const grid = buildTerrainGrid();

    for (let ty = 0; ty < MAP_H; ty++) {
      for (let tx = 0; tx < MAP_W; tx++) {
        // A body centered on the tile, as the room judges a move.
        const position = { x: tx * TILE + 16, y: ty * TILE + 5 };
        const walkable = isTileWalkable(BASE_TERRAIN, tx, ty) && !isPositionBlocked(BASE_COLLISION_RECTS, position.x, position.y);
        if (isBlocked(grid, tx, ty) === walkable) {
          throw new Error(`tile (${tx}, ${ty}) disagrees with isTileWalkable`);
        }
      }
    }
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

/**
 * `pickApproachTile` (#59, near-side destination): a diferencia de
 * `findWalkDestination`, que ignora la direccion, esta funcion elige la tile
 * junto al peer en el lado por el que el jugador (`walker`) se acerca --
 * cuanto mayor la distancia en un eje, ese eje manda; en empate gana el eje
 * vertical (decision de usuario 2026-09-24, ver design.md).
 */
describe('pickApproachTile', () => {
  const rect: TileRect = { x0: 10, y0: 26, x1: 12, y1: 28 };
  const peer = { tx: 11, ty: 27 }; // centro del cubiculo 3x3.

  it('walker al norte -> tile norte del peer', () => {
    const grid = buildTerrainGrid();
    const walker = { tx: 11, ty: 20 };

    expect(pickApproachTile(grid, walker, peer, rect)).toEqual({ tx: 11, ty: 26 });
  });

  it('walker al sur -> tile sur del peer', () => {
    const grid = buildTerrainGrid();
    const walker = { tx: 11, ty: 34 };

    expect(pickApproachTile(grid, walker, peer, rect)).toEqual({ tx: 11, ty: 28 });
  });

  it('walker al este -> tile este del peer', () => {
    const grid = buildTerrainGrid();
    const walker = { tx: 20, ty: 27 };

    expect(pickApproachTile(grid, walker, peer, rect)).toEqual({ tx: 12, ty: 27 });
  });

  it('walker al oeste -> tile oeste del peer', () => {
    const grid = buildTerrainGrid();
    const walker = { tx: 2, ty: 27 };

    expect(pickApproachTile(grid, walker, peer, rect)).toEqual({ tx: 10, ty: 27 });
  });

  it('empate diagonal (|dx| === |dy|) -> gana el eje vertical', () => {
    const grid = buildTerrainGrid();
    // dx = 16-11 = 5, dy = 22-27 = -5: mismo modulo, el eje vertical gana.
    const walker = { tx: 16, ty: 22 };

    expect(pickApproachTile(grid, walker, peer, rect)).toEqual({ tx: 11, ty: 26 });
  });

  it('walker en la misma tile que el peer -> cae a findWalkDestination', () => {
    const grid = buildTerrainGrid();
    const walker = { tx: 11, ty: 27 };

    expect(pickApproachTile(grid, walker, peer, rect)).toEqual(
      findWalkDestination(grid, peer, rect),
    );
  });

  it('la tile del lado elegido esta bloqueada -> cae a findWalkDestination', () => {
    const grid = buildTerrainGrid();
    const walker = { tx: 11, ty: 20 }; // norte -> (11,26)
    grid.solid[26][11] = true;

    expect(pickApproachTile(grid, walker, peer, rect)).toEqual(
      findWalkDestination(grid, peer, rect),
    );
    expect(pickApproachTile(grid, walker, peer, rect)).not.toEqual({ tx: 11, ty: 26 });
  });

  it('la tile del lado elegido cae fuera del rectangulo del espacio -> cae a findWalkDestination', () => {
    const grid = buildTerrainGrid();
    // Peer en el borde este del cubiculo: la tile este calculada (13,27) cae
    // FUERA del rectangulo (x1=12), asi que debe usar el fallback restringido
    // al rectangulo en vez de aterrizar fuera del espacio.
    const edgePeer = { tx: 12, ty: 27 };
    const walker = { tx: 20, ty: 27 }; // este

    expect(pickApproachTile(grid, walker, edgePeer, rect)).toEqual(
      findWalkDestination(grid, edgePeer, rect),
    );
    expect(pickApproachTile(grid, walker, edgePeer, rect)).not.toEqual({ tx: 13, ty: 27 });
  });

  it('sin rectangulo de espacio (piso abierto), la tile del lado elegido no se restringe a ningun rect', () => {
    const grid = buildTerrainGrid();
    const openPeer = { tx: 6, ty: 26 };
    const walker = { tx: 6, ty: 10 }; // norte, cesped abierto.

    expect(pickApproachTile(grid, walker, openPeer, null)).toEqual({ tx: 6, ty: 25 });
  });
});
