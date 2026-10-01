/**
 * Datos estaticos del mapa, portados de `prototype/js/app.js:6-35,56-64`.
 *
 * Sin imports, y no por casualidad: lo carga tambien el servidor Colyseus, que
 * corre en Node borrando tipos y por tanto exigiria extension `.ts` explicita
 * en cualquier import que hubiera aqui. Mantenerlo sin dependencias evita esa
 * fricción y deja claro que es dato puro.
 */

export const TILE = 32;
/**
 * The world of the Tiled layout (`maps/office.json`, #123): 14x10 blocks of
 * 9x9 tiles. Restated here to keep this file import-free; `mapData.test.ts`
 * pins it to the layout.
 */
export const MAP_W = 126;
export const MAP_H = 90;
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
 * Lo minimo para decidir PERTENENCIA: identidad y rectangulo, en pixeles. Es
 * lo que consumen `detectSpace` y `OfficeScene`, y es exactamente lo que sabe
 * un espacio servido desde `GET /spaces` (slice 3). `id` es la clave de
 * pertenencia estable (#7, D2): el nombre puede cambiar sin afectar quien
 * esta dentro.
 *
 * Nothing here draws a room: walls, doors and floors of the built-in rooms
 * live in the Tiled layout (`maps/office.json`, art step 8), at these same
 * rectangles.
 */
export interface SpaceArea {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
  /**
   * Floor material and color served by `GET /spaces` (art migration, step 4),
   * an `ArtAppearance` spelled out to keep this file import-free. Drawing only:
   * membership never reads it. Absent in the built-in fallback, whose rooms
   * show the floor of the layout instead.
   */
  floor?: { readonly materialId: string; readonly color: string | null };
}

/**
 * Los mismos ids/slugs/nombres/rectangulos que `BUILT_IN_SEED_SPACES` en
 * `server/src/spaces/builtInSeed.ts` (#7, D4): un cliente en modo fallback y
 * un despliegue sin editar deben coincidir en id Y en hash de version. No se
 * importa ese modulo server-side aqui a proposito -- este fichero sigue sin
 * imports (ver cabecera) -- los valores se copian a mano y la igualdad se fija
 * con una prueba (`server/src/spaces/builtInSeed.test.ts`).
 */
export const BUILT_IN_SPACES: readonly SpaceArea[] = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    x: 50 * TILE,
    y: 2 * TILE,
    w: 13 * TILE,
    h: 14 * TILE,
    name: 'Sala de Juntas',
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    x: 50 * TILE,
    y: 18 * TILE,
    w: 13 * TILE,
    h: 14 * TILE,
    name: 'Cafetería',
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
