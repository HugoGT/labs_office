/**
 * The first Tiled layout of the office (#4, #123): the 64x44 map that used to
 * be built in code (`terrainGrid.ts`, `mapData.ts`, `seating.ts` before the
 * art migration, step 8), at the same coordinates, inside a 126x90 world of
 * 14x10 blocks that grows to the right and down.
 *
 * This is a bootstrap, not the source of truth: once `src/game/maps/office.json`
 * is edited in Tiled, the file is. Running `pnpm map:init` again overwrites
 * those edits with what this module describes.
 *
 * No randomness: trees and decals of the new area come from an integer hash
 * of their tile, so the output is the same on every run.
 */
import {
  ART_TILE,
  TERRAIN_DECALS,
  TERRAIN_MATERIALS,
  type TerrainMaterial,
} from '../game/artContract.ts';

export const LAYOUT_PATH = 'src/game/maps/office.json';
export const PALETTE_PATH = 'src/game/maps/layout-palette.png';
/** Relative to the map, as Tiled resolves it. */
const PALETTE_IMAGE = 'layout-palette.png';

const W = 126;
const H = 90;
const BLOCK = 9;

const WALLS = ['wall-brick', 'wall-stone', 'wall-plaster', 'wall-glass'] as const;
const HEDGE = 'hedge-boxwood';

/** Tile types of the embedded tileset, in tile id order. */
export const LAYOUT_PALETTE: readonly string[] = [...TERRAIN_MATERIALS, ...WALLS, HEDGE, ...TERRAIN_DECALS];

const gid = (name: string): number => {
  const index = LAYOUT_PALETTE.indexOf(name);
  if (index < 0) throw new Error(`No palette tile ${name}`);
  return index + 1;
};

// --- The map that was code ------------------------------------------------------------------------

/** `DESK_ROWS` of mapData.ts: [tileX, tileY, count], each desk 2x1 tiles. */
const DESK_ROWS: readonly (readonly [number, number, number])[] = [
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

/** `TREES` of mapData.ts. Every fourth one was the orange Kenney tree: a maple now. */
const TREES: readonly (readonly [number, number])[] = [
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

/** `BUILT_IN_SPACES` drawing data: the rectangle in tiles, the left wall's door rows, floor and walls. */
const ROOMS = [
  { x0: 50, y0: 2, w: 13, h: 14, doors: [8, 9], floor: 'carpet', wall: 'wall-plaster' },
  { x0: 50, y0: 18, w: 13, h: 14, doors: [24, 25], floor: 'wood', wall: 'wall-brick' },
] as const;

/** `BASE_MAP_SEATS` of seating.ts, same order: the index is the seat's identity on the wire. */
function baseSeats(): { tx: number; ty: number; facing: string }[] {
  const seats: { tx: number; ty: number; facing: string }[] = [];
  for (let i = 0; i < 7; i++) {
    seats.push({ tx: 53 + i, ty: 5, facing: 'down' });
    seats.push({ tx: 53 + i, ty: 11, facing: 'up' });
  }
  for (let j = 0; j < 5; j++) {
    seats.push({ tx: 52, ty: 6 + j, facing: 'right' });
    seats.push({ tx: 60, ty: 6 + j, facing: 'left' });
  }
  for (let i = 0; i < 5; i++) {
    seats.push({ tx: 53 + i, ty: 22, facing: 'down' });
    seats.push({ tx: 53 + i, ty: 26, facing: 'up' });
  }
  return seats;
}

const GARDEN = { x0: 50, y0: 33, x1: 62, y1: 42 };

// --- The new area ------------------------------------------------------------------------------------

/**
 * One material per 9x9 block: a lake with a beach to the south-east, a clearing and a plaza.
 * The lake keeps to block row 6: the shared spawn tile (94, 67), the middle of the
 * production 21x15 grid, falls on the beach of block (10, 7) so legacy tests still spawn on sand.
 */
function blockMaterial(bx: number, by: number): TerrainMaterial {
  if (bx >= 9 && bx <= 11 && by === 6) return 'water';
  if (bx >= 8 && bx <= 12 && by >= 5 && by <= 8) return 'sand';
  if (bx >= 1 && bx <= 2 && by >= 7 && by <= 8) return 'dirt';
  if (bx === 5 && by === 7) return 'cobblestone';
  return 'grass';
}

/** Tile precise terrain over the blocks: the corridor, the river, the rooms and the paths into the new area. */
function groundMaterial(tx: number, ty: number): TerrainMaterial | null {
  for (const room of ROOMS) {
    if (tx >= room.x0 && tx < room.x0 + room.w && ty >= room.y0 && ty < room.y0 + room.h) return room.floor;
  }
  if ((tx === 48 || tx === 49) && ty >= 1 && ty <= 42) return 'tile';
  if (ty >= 19 && ty <= 21 && tx >= 1 && tx <= 47) return 'water';
  // The corridor goes on south as a path to the plaza, and a branch heads east to the beach.
  if ((tx === 48 || tx === 49) && ty >= 43 && ty < 63) return 'cobblestone';
  if ((ty === 46 || ty === 47) && tx >= 50 && tx <= 74) return 'cobblestone';
  return null;
}

function wallAt(tx: number, ty: number): string | null {
  for (const room of ROOMS) {
    const x1 = room.x0 + room.w - 1;
    const y1 = room.y0 + room.h - 1;
    const inside = tx >= room.x0 && tx <= x1 && ty >= room.y0 && ty <= y1;
    const edge = tx === room.x0 || tx === x1 || ty === room.y0 || ty === y1;
    if (!inside || !edge) continue;
    if (tx === room.x0 && (room.doors as readonly number[]).includes(ty)) return null;
    return room.wall;
  }
  return null;
}

/**
 * The world's border, and the garden behind the rooms, which keeps the
 * stretch of the old border that closed it. The rest of the old border opens
 * onto the new area.
 */
function hedgeAt(tx: number, ty: number): boolean {
  if (tx === 0 || ty === 0 || tx === W - 1 || ty === H - 1) return true;
  if (tx === GARDEN.x1 + 1 && ty >= GARDEN.y0 && ty <= GARDEN.y1 + 1) return true;
  return ty === GARDEN.y1 + 1 && tx >= GARDEN.x0 && tx <= GARDEN.x1 + 1;
}

function hash(tx: number, ty: number, seed: number): number {
  let h = Math.imul(tx, 0x27d4eb2d) ^ Math.imul(ty, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

/** How far a block border can wander (`BORDER_JITTER_TILES` in officeLayout.ts), plus a tile of margin. */
const SAFE_RADIUS = 4;

/** Whether every block within `radius` of a tile is one of `materials`, so no wobbling border reaches it. */
function surelyOn(tx: number, ty: number, materials: readonly TerrainMaterial[], radius = SAFE_RADIUS): boolean {
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const x = Math.min(W - 1, Math.max(0, tx + dx));
      const y = Math.min(H - 1, Math.max(0, ty + dy));
      if (!materials.includes(blockMaterial(Math.floor(x / BLOCK), Math.floor(y / BLOCK)))) return false;
    }
  }
  return true;
}

interface Footprint {
  readonly tx: number;
  readonly ty: number;
  readonly w: number;
  readonly h: number;
}

function near(a: Footprint, tx: number, ty: number, gap: number): boolean {
  return tx >= a.tx - gap && tx < a.tx + a.w + gap && ty >= a.ty - gap && ty < a.ty + a.h + gap;
}

/** Nothing but open block terrain around a tile: no tile terrain, wall, hedge or seat within `gap`. */
function clearAround(tx: number, ty: number, gap: number, seats: readonly Footprint[]): boolean {
  for (let dy = -gap; dy <= gap; dy += 1) {
    for (let dx = -gap; dx <= gap; dx += 1) {
      const x = tx + dx;
      const y = ty + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) return false;
      if (groundMaterial(x, y) !== null || wallAt(x, y) !== null || hedgeAt(x, y)) return false;
    }
  }
  return !seats.some((seat) => near(seat, tx, ty, gap));
}

/** Old map content: the 64x44 the office was. New trees only go outside it. */
const inOldMap = (tx: number, ty: number): boolean => tx < 64 && ty < 44;

function newTrees(taken: readonly Footprint[], seats: readonly Footprint[]): { tx: number; ty: number; piece: string }[] {
  const trees: { tx: number; ty: number; piece: string }[] = [];
  for (let ty = 2; ty < H - 2; ty += 1) {
    for (let tx = 2; tx < W - 2; tx += 1) {
      if (inOldMap(tx, ty)) continue;
      // A wood to the south-west, scattered trees everywhere else.
      const density = tx < 45 && ty >= 50 ? 0.22 : 0.035;
      if (hash(tx, ty, 0x7ee5) >= density) continue;
      if (!surelyOn(tx, ty, ['grass', 'dirt']) || !clearAround(tx, ty, 1, seats)) continue;
      if (taken.some((prop) => near(prop, tx, ty, 2)) || trees.some((tree) => near({ ...tree, w: 1, h: 1 }, tx, ty, 2))) continue;
      trees.push({ tx, ty, piece: hash(tx, ty, 0x0a4) < 0.4 ? 'tree-maple' : 'tree-oak' });
    }
  }
  return trees;
}

function decalAt(tx: number, ty: number, solid: (tx: number, ty: number) => boolean): string | null {
  if (solid(tx, ty)) return null;
  const roll = hash(tx, ty, 0xdeca1);
  const pick = (choices: readonly string[]): string => choices[Math.floor(hash(tx, ty, 0x5e1) * choices.length)]!;
  const inGarden = tx >= GARDEN.x0 && tx <= GARDEN.x1 && ty >= GARDEN.y0 && ty <= GARDEN.y1;
  if (inGarden) return roll < 0.2 ? pick(['flowers-white', 'flowers-yellow', 'flowers-blue', 'clover']) : null;
  if (groundMaterial(tx, ty) !== null) return null;
  if (surelyOn(tx, ty, ['water'], 1)) return roll < 0.04 ? 'lily-pad' : null;
  if (surelyOn(tx, ty, ['dirt'])) return roll < 0.06 ? pick(['pebbles', 'leaves']) : null;
  if (surelyOn(tx, ty, ['grass'])) return roll < 0.03 ? pick(['flowers-white', 'flowers-yellow', 'flowers-blue', 'clover', 'mushrooms']) : null;
  return null;
}

// --- Tiled JSON --------------------------------------------------------------------------------------

export type TiledProperty = { name: string; type: 'string' | 'int'; value: string | number };
export interface TiledObject {
  id: number;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: 0;
  visible: true;
  properties?: TiledProperty[];
}

function tileLayer(id: number, name: string, cell: (tx: number, ty: number) => number) {
  const data: number[] = [];
  for (let ty = 0; ty < H; ty += 1) for (let tx = 0; tx < W; tx += 1) data.push(cell(tx, ty));
  return { data, height: H, id, name, opacity: 1, type: 'tilelayer', visible: true, width: W, x: 0, y: 0 };
}

function objectLayer(id: number, name: string, objects: TiledObject[]) {
  return { draworder: 'topdown', id, name, objects, opacity: 1, type: 'objectgroup', visible: true, x: 0, y: 0 };
}

export type TiledMap = ReturnType<typeof buildLegacyLayout>;

export function buildLegacyLayout() {
  let nextId = 1;
  const object = (type: string, f: Footprint, properties?: TiledProperty[]): TiledObject => ({
    id: nextId++,
    name: '',
    type,
    x: f.tx * ART_TILE,
    y: f.ty * ART_TILE,
    width: f.w * ART_TILE,
    height: f.h * ART_TILE,
    rotation: 0,
    visible: true,
    ...(properties === undefined ? {} : { properties }),
  });

  const props: TiledObject[] = [];
  const taken: Footprint[] = [];
  const add = (type: string, f: Footprint, properties?: TiledProperty[]): void => {
    props.push(object(type, f, properties));
    taken.push(f);
  };
  for (const [x, y, count] of DESK_ROWS) {
    for (let i = 0; i < count; i += 1) add('desk-wood', { tx: x + i * 2, ty: y, w: 2, h: 1 });
  }
  add('table-meeting', { tx: 53, ty: 6, w: 7, h: 5 });
  add('table-cafeteria', { tx: 53, ty: 23, w: 5, h: 3 });
  // The cafeteria's plants, and the meeting room gets its own in the corners.
  for (const [tx, ty] of [[51, 19], [61, 19], [51, 30], [61, 30], [51, 3], [61, 3], [51, 14], [61, 14]] as const) {
    add('plant-ficus', { tx, ty, w: 1, h: 1 });
  }
  for (const tx of [13, 32]) {
    add('bridge-wood', { tx, ty: 19, w: 3, h: 3 }, [{ name: 'orientation', type: 'string', value: 'north-south' }]);
  }
  TREES.forEach(([tx, ty], index) => add(index % 4 === 3 ? 'tree-maple' : 'tree-oak', { tx, ty, w: 1, h: 1 }));

  const seatList = baseSeats();
  const seatFootprints = seatList.map(({ tx, ty }) => ({ tx, ty, w: 1, h: 1 }));
  for (const tree of newTrees(taken, seatFootprints)) add(tree.piece, { tx: tree.tx, ty: tree.ty, w: 1, h: 1 });

  const seats = seatList.map((seat, index) =>
    object('seat', { tx: seat.tx, ty: seat.ty, w: 1, h: 1 }, [
      { name: 'facing', type: 'string', value: seat.facing },
      { name: 'seat', type: 'int', value: index },
    ]),
  );

  const solid = (tx: number, ty: number): boolean =>
    wallAt(tx, ty) !== null || hedgeAt(tx, ty) || taken.some((prop) => near(prop, tx, ty, 0)) || seatFootprints.some((s) => near(s, tx, ty, 0));

  return {
    compressionlevel: -1,
    height: H,
    infinite: false,
    layers: [
      tileLayer(1, 'blocks', (tx, ty) => gid(blockMaterial(Math.floor(tx / BLOCK), Math.floor(ty / BLOCK)))),
      tileLayer(2, 'ground', (tx, ty) => {
        const material = groundMaterial(tx, ty);
        return material === null ? 0 : gid(material);
      }),
      tileLayer(3, 'decals', (tx, ty) => {
        const decal = decalAt(tx, ty, solid);
        return decal === null ? 0 : gid(decal);
      }),
      tileLayer(4, 'walls', (tx, ty) => {
        const wall = wallAt(tx, ty);
        return wall === null ? 0 : gid(wall);
      }),
      tileLayer(5, 'hedges', (tx, ty) => (hedgeAt(tx, ty) ? gid(HEDGE) : 0)),
      objectLayer(6, 'props', props),
      objectLayer(7, 'seats', seats),
    ],
    nextlayerid: 8,
    nextobjectid: nextId,
    orientation: 'orthogonal',
    renderorder: 'right-down',
    tiledversion: '1.11.2',
    tileheight: ART_TILE,
    tilesets: [
      {
        columns: LAYOUT_PALETTE.length,
        firstgid: 1,
        image: PALETTE_IMAGE,
        imageheight: ART_TILE,
        imagewidth: ART_TILE * LAYOUT_PALETTE.length,
        margin: 0,
        name: 'layout-palette',
        spacing: 0,
        tilecount: LAYOUT_PALETTE.length,
        tileheight: ART_TILE,
        tiles: LAYOUT_PALETTE.map((type, id) => ({ id, type })),
        tilewidth: ART_TILE,
      },
    ],
    tilewidth: ART_TILE,
    type: 'map',
    version: '1.10',
    width: W,
  };
}

/**
 * JSON with one map row per line in each tile layer, so a diff of the layout
 * reads like the map. Tiled accepts it and writes its own style back.
 */
export function serializeLayout(map: TiledMap): string {
  const rows = new Map<string, string>();
  const layers = map.layers.map((layer) => {
    if (!('data' in layer)) return layer;
    const marker = `__rows_${layer.id}__`;
    const lines: string[] = [];
    for (let ty = 0; ty < H; ty += 1) lines.push(`    ${layer.data.slice(ty * W, (ty + 1) * W).join(',')}`);
    rows.set(`"${marker}"`, `[\n${lines.join(',\n')}\n   ]`);
    return { ...layer, data: marker };
  });
  let text = JSON.stringify({ ...map, layers }, null, 1);
  for (const [marker, value] of rows) text = text.replace(marker, value);
  return `${text}\n`;
}
