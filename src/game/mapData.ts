/**
 * Datos estaticos del mapa, portados de `prototype/js/app.js:6-35,56-64`.
 *
 * Sin imports, y no por casualidad: lo carga tambien el servidor Colyseus, que
 * corre en Node borrando tipos y por tanto exigiria extension `.ts` explicita
 * en cualquier import que hubiera aqui. Mantenerlo sin dependencias evita esa
 * fricción y deja claro que es dato puro.
 */

export const TILE = 32;
export const MAP_W = 64;
export const MAP_H = 44;
export const WORLD_W = MAP_W * TILE;
export const WORLD_H = MAP_H * TILE;
export const PROX_RADIUS = 170;

/**
 * Tile de aparicion del jugador. Vive aqui, y no en `characters.ts`, porque el
 * servidor Colyseus tambien la necesita para situar a los avatares remotos y
 * `characters.ts` importa Phaser, que en Node no se puede ni cargar.
 */
export const PLAYER_SPAWN_TX = 22;
export const PLAYER_SPAWN_TY = 28;

/** Codigos de suelo (app.js:11). */
export const GROUND = {
  G: 0,
  GD: 1,
  WATER: 2,
  BRIDGE: 3,
  FLOOR: 4,
  WOODF: 5,
  WALL: 6,
  CORR: 7,
} as const;

export type GroundCode = (typeof GROUND)[keyof typeof GROUND];

/** Filas de escritorios: [tileX, tileY, cantidad] (app.js:16-21). Cada escritorio ocupa 2x1 tiles. */
export const DESK_ROWS: readonly (readonly [number, number, number])[] = [
  [3, 5, 3],
  [13, 4, 2],
  [20, 4, 3],
  [27, 4, 2],
  [3, 14, 3],
  [12, 15, 3],
  [25, 15, 3],
  [33, 14, 3],
  [4, 24, 2],
  [16, 24, 3],
  [27, 24, 3],
  [4, 36, 3],
  [16, 36, 3],
  [28, 36, 3],
];

export const TREES: readonly (readonly [number, number])[] = [
  [2, 2],
  [9, 2],
  [18, 2],
  [30, 2],
  [40, 2],
  [46, 4],
  [2, 9],
  [46, 12],
  [2, 26],
  [46, 26],
  [2, 34],
  [44, 34],
  [12, 41],
  [24, 41],
  [36, 41],
  [44, 41],
  [52, 34],
  [56, 36],
  [60, 34],
];

export interface ZoneLabel {
  t: string;
  x: number;
  y: number;
}

export const ZONE_LABELS: readonly ZoneLabel[] = [
  { t: 'C R E A T I V I T Y', x: 9, y: 1.4 },
  { t: 'B U S I N E S S', x: 2.5, y: 11.2 },
  { t: 'P R O D U C T', x: 30, y: 11.2 },
  { t: 'T E C H N O L O G Y', x: 12, y: 32.2 },
];

/**
 * Salas/espacios (app.js:56-59). Coordenadas y tamano en pixeles, como el
 * prototipo original. `id` es la clave de pertenencia estable (#7, D2): el
 * nombre puede cambiar sin afectar quien esta dentro. `doorTiles`/
 * `floorStyle` son puramente de dibujo del mapa base (D3) -- `terrainGrid.ts`
 * los usa para trazar la puerta y el suelo de cada sala; un espacio servido
 * desde config (slice 3) no los trae porque no redibuja paredes.
 */
/**
 * Lo minimo para decidir PERTENENCIA: identidad y rectangulo, en pixeles. Es
 * lo que consumen `detectSpace` y `OfficeScene`, y es exactamente lo que sabe
 * un espacio servido desde `GET /spaces` (slice 3) -- la tabla `spaces` no
 * tiene columnas de dibujo, asi que un espacio creado por un Admin no puede
 * traerlas.
 *
 * Existe separado de `Room` para que esa carencia sea un hecho del sistema de
 * tipos y no un campo inventado. Un `doorTiles` de relleno en una config
 * servida trazaria una puerta donde no hay ninguna.
 */
export interface SpaceArea {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
}

/** Un `SpaceArea` que ADEMAS sabe dibujarse: solo los incorporados (D3). */
export interface Room extends SpaceArea {
  /** Filas de la pared izquierda que son puerta, no muro (`terrainGrid.ts`). */
  doorTiles: readonly [number, number];
  /** Codigo de suelo interior de esta sala (`terrainGrid.ts`). */
  floorStyle: GroundCode;
}

/**
 * Los mismos ids/slugs/nombres/rectangulos que `BUILT_IN_SEED_SPACES` en
 * `server/src/spaces/builtInSeed.ts` (#7, D4): un cliente en modo fallback y
 * un despliegue sin editar deben coincidir en id Y en hash de version. No se
 * importa ese modulo server-side aqui a proposito -- este fichero sigue sin
 * imports (ver cabecera) -- los valores se copian a mano y la igualdad se fija
 * con una prueba (`server/src/spaces/builtInSeed.test.ts`).
 */
export const BUILT_IN_SPACES: readonly Room[] = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    x: 50 * TILE,
    y: 2 * TILE,
    w: 13 * TILE,
    h: 14 * TILE,
    name: 'Sala de Juntas',
    doorTiles: [8, 9],
    floorStyle: GROUND.FLOOR,
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    x: 50 * TILE,
    y: 18 * TILE,
    w: 13 * TILE,
    h: 14 * TILE,
    name: 'Cafetería',
    doorTiles: [24, 25],
    floorStyle: GROUND.WOODF,
  },
];

/**
 * Version (D4) que un cliente en modo fallback publica: primeros 16 hex de
 * sha256 sobre la lista canonica de `BUILT_IN_SPACES` (mismo algoritmo que
 * `spaceRules.hashSpaces`, server-only). Literal, NO calculado aqui: el
 * cliente nunca hashea nada -- `crypto.subtle.digest` es asincrono y
 * `proximityTick` es sincrono (D4). Su igualdad con
 * `server/src/spaces/builtInSeed.ts`'s `BUILT_IN_SEED_VERSION` esta fijada
 * por una prueba, no dejada a la suerte.
 */
export const BUILT_IN_SPACES_VERSION = 'a489c5da5efd7c68';

export const SKINS: readonly number[] = [0xf2c49b, 0xd9a066, 0x8d5524];
export const HAIRS: readonly number[] = [0x2b2b2b, 0x5a3825, 0xd8b23c, 0x8a2f2f, 0x394a8a];
export const SHIRTS: readonly number[] = [
  0x3b82f6, 0xef4444, 0x10b981, 0xf59e0b, 0x8b5cf6, 0x374151, 0xec4899,
];
export const PANTS: readonly number[] = [0x1f2937, 0x334155, 0x5a3825];
