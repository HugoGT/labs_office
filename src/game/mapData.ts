/**
 * Datos estaticos del mapa, portados de `prototype/js/app.js:6-35,56-64`.
 * Sin dependencias de Phaser: se prueba en jsdom.
 */

export const TILE = 32;
export const MAP_W = 64;
export const MAP_H = 44;
export const WORLD_W = MAP_W * TILE;
export const WORLD_H = MAP_H * TILE;
export const PROX_RADIUS = 170;

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

export const GROUND_TEX: readonly string[] = [
  'grassA',
  'grassDark',
  'water',
  'bridge',
  'floor',
  'woodf',
  'wall',
  'corridor',
];

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

/** Salas (app.js:56-59). Coordenadas y tamano en pixeles, como el prototipo original. */
export interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
}

export const ROOMS: readonly Room[] = [
  { x: 50 * TILE, y: 2 * TILE, w: 13 * TILE, h: 14 * TILE, name: 'Sala de Juntas' },
  { x: 50 * TILE, y: 18 * TILE, w: 13 * TILE, h: 14 * TILE, name: 'Cafetería' },
];

export const SKINS: readonly number[] = [0xf2c49b, 0xd9a066, 0x8d5524];
export const HAIRS: readonly number[] = [0x2b2b2b, 0x5a3825, 0xd8b23c, 0x8a2f2f, 0x394a8a];
export const SHIRTS: readonly number[] = [
  0x3b82f6, 0xef4444, 0x10b981, 0xf59e0b, 0x8b5cf6, 0x374151, 0xec4899,
];
export const PANTS: readonly number[] = [0x1f2937, 0x334155, 0x5a3825];
