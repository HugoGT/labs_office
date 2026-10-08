/** Shared import-free world constants. Runtime placements belong to the database. */

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
export const PLAYER_SPAWN_TX = 67;
export const PLAYER_SPAWN_TY = 49;

/** Side of a terrain block, in tiles (#123). `officeLayout.ts` reads it from here. */
export const MAP_BLOCK_TILES = 9;
export const MAP_BLOCK_COLUMNS = MAP_W / MAP_BLOCK_TILES;
export const MAP_BLOCK_ROWS = MAP_H / MAP_BLOCK_TILES;
/** The protected central block of the spawn tile: it stays wood whatever is painted. */
export const SPAWN_BLOCK_INDEX =
  Math.floor(PLAYER_SPAWN_TY / MAP_BLOCK_TILES) * MAP_BLOCK_COLUMNS + Math.floor(PLAYER_SPAWN_TX / MAP_BLOCK_TILES);

export interface ZoneLabel {
  t: string;
  x: number;
  y: number;
}

export const ZONE_LABELS: readonly ZoneLabel[] = [];

/**
 * Lo minimo para decidir PERTENENCIA: identidad y rectangulo, en pixeles. Es
 * lo que consumen `detectSpace` y `OfficeScene`, y es exactamente lo que sabe
 * un espacio servido desde `GET /spaces` (slice 3). `id` es la clave de
 * pertenencia estable (#7, D2): el nombre puede cambiar sin afectar quien
 * esta dentro.
 *
 * Nothing here draws a room: its geometry is served independently of terrain.
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
 * membership never reads it.
   */
  floor?: { readonly materialId: string; readonly color: string | null };
}

/** Empty fallback and new-database topology, pinned to the server bootstrap. */
export const BUILT_IN_SPACES: readonly SpaceArea[] = [];

/**
 * Version (D4) que un cliente en modo fallback publica: primeros 16 hex de
 * sha256 sobre la lista canonica de `BUILT_IN_SPACES` (mismo algoritmo que
 * `spaceRules.hashSpaces`, server-only). Literal, NO calculado aqui: el
 * cliente nunca hashea nada -- `crypto.subtle.digest` es asincrono y
 * `proximityTick` es sincrono (D4). Su igualdad con
 * `server/src/spaces/builtInSeed.ts`'s `BUILT_IN_SEED_VERSION` esta fijada
 * por una prueba, no dejada a la suerte.
 */
export const BUILT_IN_SPACES_VERSION = '4f53cda18c2baa0c';

export const SKINS: readonly number[] = [0xf2c49b, 0xd9a066, 0x8d5524];
export const HAIRS: readonly number[] = [0x2b2b2b, 0x5a3825, 0xd8b23c, 0x8a2f2f, 0x394a8a];
export const SHIRTS: readonly number[] = [
  0x3b82f6, 0xef4444, 0x10b981, 0xf59e0b, 0x8b5cf6, 0x374151, 0xec4899,
];
export const PANTS: readonly number[] = [0x1f2937, 0x334155, 0x5a3825];
