/**
 * The live terrain of the server (#123 phase 2): the persisted blocks and the
 * `TerrainSnapshot` built from them, kept in memory. `OfficeRoom` checks every
 * `move` against `snapshot()`, so a move never queries Postgres; the snapshot
 * is rebuilt once at `load()` and once per accepted edit.
 *
 * Edits run one at a time, block and wall edits in the same queue. Each one
 * is checked against the terrain the previous one left and against
 * protections read at that moment, and the snapshot only changes after the
 * store saved it: a failed save leaves the office exactly as it was.
 *
 * The runtime owns the painted walls too: posts on grid vertices, one more
 * layer of the snapshot (`terrainSnapshot(layout, blocks, walls)`) that
 * blocks by its rectangles, so the room refuses moves into them and
 * relocates whoever a wall now overlaps exactly like after a block edit.
 *
 * And the office decor layer (#208, `officeDecor.ts`): every chair, desk
 * table, plant and room table, one item per anchor tile and layer (#121: the
 * floor, and the top of the desk tables and room tables), in the same queue.
 * What stands on top goes with its surface: off when the surface goes or
 * turns from under it (`fallenTopItems`), along when a desk or room carries
 * it.
 * It is not part of the snapshot (it never changes walkability; its pieces'
 * rectangles collide through the collision runtime), but every tile of every
 * item is protected like a static seat: no water, void or wall may land on
 * one.
 *
 * Doors (#223) are decor items too, but they do change the snapshot: each
 * one opens the wall it stands in (`doorOpenings`), so every snapshot this
 * runtime builds passes the doors of the layer it holds, and a decor edit
 * that changes the doors rebuilds it. The walls a door or window needs
 * (`doorPosts`) may not be removed while it stands; a door or window placed
 * over another replaces it (S6), and the wall under one that goes stays.
 *
 * Blocks of a colorable material may carry a color (#222). It is part of the
 * block edit: saved in the same `saveBlocks` as the material, published with
 * it, and cleared whenever the block is painted without one.
 *
 * A wood block may instead carry an uploaded floor piece (`terrainFloors.ts`),
 * handled exactly like a color: part of the block edit, saved with it,
 * published with it, and cleared whenever the block is painted without one.
 * The piece must be an approved, not retired floor of the art catalog today.
 */

import {
  blockCount,
  blockIndexAt,
  blockTileRect,
  encodeTerrainBlocks,
  isColorableTerrainMaterial,
  newlyUnwalkableTiles,
  terrainSnapshot,
  wallPostTiles,
  withBlock,
  withTerrainColors,
  withWallOrder,
  withWalls,
  type LayoutMaterial,
  type OfficeLayout,
  type TerrainColors,
  type TerrainSnapshot,
  type WallEdit,
  type WallPieceId,
} from '../../../src/game/officeLayout.ts';
import { BASE_MAP_SEATS, type MapSeat } from '../../../src/game/seating.ts';
import { TERRAIN_FLOOR_BASE, isTerrainFloorPieceId, withTerrainFloors, type TerrainFloors } from '../../../src/game/terrainFloors.ts';
import {
  decorEditKey,
  decorFootprint,
  decorInfoFromPieceId,
  decorItemKey,
  decorLayerOf,
  decorPieceInfo,
  decorTiles,
  decorRotationsOf,
  diffDecor,
  fallenTopItems,
  isOnTopKind,
  fitsInsideDesk,
  withDecor,
  type DecorEdit,
  type DecorItem,
  type DecorPieceInfo,
  type DecorTileRect,
} from '../../../src/game/officeDecor.ts';
import { deskOverChairLimit, displacedDeskTables } from '../../../src/game/deskDecorRules.ts';
import { doorOpenings, doorPostSet, doorsReplacedBy, isDoorPiece } from '../../../src/game/officeDoors.ts';
import { carriedDecor, onAreaOutline, replacedDecor } from '../../../src/game/areaCarry.ts';
import { PLAYER_SPAWN_TX, PLAYER_SPAWN_TY } from '../../../src/game/mapData.ts';
import type { TerrainStore } from './terrainPort.ts';
import {
  InvalidTerrainEditError,
  TerrainProtectedError,
  TerrainStaleError,
  parseTerrainBatch,
  parseDecorBatch,
  parseWallBatch,
  findDecorConflict,
  findUnwalkableConflict,
  findWallConflict,
  staticProtectedTiles,
  type TerrainEdit,
  type TerrainProtections,
} from './terrainRules.ts';

/**
 * Called after each accepted edit, block, wall or decor, with the whole block
 * list. `snapshot()`, `blockColors()` and `decor()` already answer with the
 * new terrain.
 */
export type TerrainListener = (blocks: readonly LayoutMaterial[]) => void;

/** A desk or room moved whole: its area in tiles before the move, and how far it goes. */
export interface AreaMove {
  readonly from: DecorTileRect;
  readonly dx: number;
  readonly dy: number;
}

/** The walls and decor as a carry leaves them, what its write checks the moved desk against. */
export interface CarriedLayer {
  readonly width: number;
  readonly walls: readonly (string | null)[];
  readonly decor: readonly DecorItem[];
}

export interface TerrainRuntime {
  /** Reads the persisted blocks. Called once, after the schema is applied. */
  load(): Promise<void>;
  blocks(): readonly LayoutMaterial[];
  /** The live block colors (#222): only colorable blocks painted in a color of their own. */
  blockColors(): TerrainColors;
  /** The live uploaded floors: only wood blocks painted with an approved floor piece. */
  blockFloors(): TerrainFloors;
  snapshot(): TerrainSnapshot;
  /** False without a store (no `DATABASE_URL`): the terrain is the layout's for good. */
  readonly editable: boolean;
  /**
   * Applies one edit, or throws `TerrainProtectedError` when water or void would land
   * under something `protections` (read only if the edit floods a tile) or
   * the static layout protects. The wall posts it leaves with void on every
   * side are removed in the same save (#217).
   */
  setBlock(edit: TerrainEdit & { actorId: string | null }, protections: () => Promise<TerrainProtections>): Promise<readonly LayoutMaterial[]>;
  setBlocks(edits: readonly TerrainEdit[], actorId: string | null, protections: () => Promise<TerrainProtections>, expected?: string): Promise<readonly LayoutMaterial[]>;
  /** The live wall post of every grid vertex, row major: the layout's, overridden by the stored ones. */
  walls(): readonly (string | null)[];
  /**
   * Places or removes wall posts atomically, or throws `TerrainProtectedError`
   * when one's footprint would touch a desk (`protections`, read only when
   * the edit places a post) or a tile the static layout protects.
   */
  setWalls(edits: readonly WallEdit[], actorId: string | null, protections: () => Promise<TerrainProtections>): Promise<readonly (string | null)[]>;
  /** The office decor layer (#208), sorted by anchor tile. */
  decor(): readonly DecorItem[];
  /**
   * What the decor rules know of a piece: from the catalog last read (at
   * load and on every decor edit, retired pieces included), else from its id
   * for chairs, desk tables and plants. `null` for a piece it cannot place.
   */
  decorInfo(piece: string): DecorPieceInfo | null;
  /**
   * Places, turns, replaces or removes decor items atomically. Throws
   * `InvalidTerrainEditError` for a malformed batch, a piece the catalog
   * does not offer (unknown, retired or of a kind the layer does not place),
   * a rotation the piece does not take (a plant any, a room table 180 or
   * 270) or a color on a piece that is not colorable; `DecorOutsideAreaError` when
   * `area` is given (a desk, `POST /me/decor`) and an item placed, replaced
   * or removed does not lie entirely inside it; `TerrainProtectedError` when
   * a placed item would stand off the map, on unwalkable ground, a wall, a
   * static tile or another item.
   *
   * `desks` (read inside the queue, the desk areas in tiles) brings the desk
   * rules of `deskDecorRules.ts`: a desk table placed on a desk removes the
   * other desk tables on it in the same save (in desk scope too, even one not
   * wholly inside the caller's desk: it is the rule's consequence), and
   * `DeskChairLimitError` refuses a batch that leaves a desk it placed a
   * chair on with more than three. Absent, no desk rule applies.
   */
  setDecor(
    edits: readonly DecorEdit[],
    actorId: string | null,
    area?: DecorTileRect,
    desks?: () => Promise<readonly DecorTileRect[]>,
  ): Promise<readonly DecorItem[]>;
  /**
   * Runs `task` in the edit queue with the snapshot every edit before it
   * left, and holds later edits until it settles. A desk write uses it so no
   * wall lands between its wall check and its save. Works without a store.
   */
  runExclusive<T>(task: (snapshot: TerrainSnapshot) => Promise<T>): Promise<T>;
  /**
   * Moves a desk or room with what stands in it, so reorganizing the office
   * loses no one's decor: the painted posts on or inside the outline of the
   * area `locate` names (a room's walls stand on it), the items wholly inside
   * it and the doors on those posts, all shifted by the move (`areaCarry.ts`).
   * The items that stood where it lands are erased: what it holds replaces
   * them. The terrain stays. In the edit queue: `locate` reads the area, the
   * contents are checked where they land (`TerrainProtectedError` when an
   * item would stand on unwalkable ground, a wall, a static tile, another
   * item or off the map, or a post on a desk, a static tile or an item that
   * stays), then
   * `write` saves the desk or room with the layer the move leaves, and only
   * if it returns something are the walls and decor saved, in one statement.
   * The desk or room lives in another store, so if that save fails `undo`
   * puts it back where it was, still in the queue, and the save's error is
   * thrown: the desk or room never stands apart from what it holds.
   * `locate` returning `null`, or nothing in the area, just runs `write`.
   */
  carry<T>(
    locate: () => Promise<AreaMove | null>,
    actorId: string | null,
    protections: () => Promise<TerrainProtections>,
    write: (layer: CarriedLayer) => Promise<T | null>,
    undo?: () => Promise<unknown>,
  ): Promise<T | null>;
  /** Called after each accepted edit; see `TerrainListener`. */
  subscribe(listener: TerrainListener): () => void;
}

/** An edit of `POST /me/decor` reaches outside the caller's desk (403 `outside-desk`). */
export class DecorOutsideAreaError extends Error {
  constructor() {
    super('a decor item lies outside the desk');
    this.name = 'DecorOutsideAreaError';
  }
}

/** A batch would leave a desk it placed a chair on with more than `MAX_DESK_CHAIRS` (409 `desk-chair-limit`). */
export class DeskChairLimitError extends Error {
  constructor() {
    super('a desk would hold too many chairs');
    this.name = 'DeskChairLimitError';
  }
}

/** One catalog piece as the decor rules read it: `art_pieces`, retired ones included. */
export interface DecorCatalogPiece {
  readonly id: string;
  readonly kind: string;
  readonly footprint?: { readonly w: number; readonly h: number };
  /** Whether it takes a color of its own (a colorable desk table); absent is not. */
  readonly colorable?: boolean;
  readonly retired: boolean;
}

/** The edits that turn `before` into `after`, one per (anchor, layer) that differs: what a decor batch saves. */
const decorChanges = diffDecor;

/** The removal of an item, on its own layer. */
function removalOf(item: DecorItem): DecorEdit {
  return decorLayerOf(item.piece) === 'top' ? { index: item.index, item: null, layer: 'top' } : { index: item.index, item: null };
}

/** The floor items alone: the desk rules (`deskDecorRules.ts`) know one item per anchor, and only the floor counts for them. */
function floorOf(items: readonly DecorItem[]): DecorItem[] {
  return items.filter((item) => decorLayerOf(item.piece) === 'floor');
}

export function createTerrainRuntime({
  layout,
  store,
  seats = BASE_MAP_SEATS,
  decorPieces,
}: {
  layout: OfficeLayout;
  store?: TerrainStore;
  seats?: readonly MapSeat[];
  /** Reads the art catalog, retired pieces included. Absent: pieces resolve by id and only chairs, desk tables and plants place. */
  decorPieces?: () => Promise<readonly DecorCatalogPiece[]>;
}): TerrainRuntime {
  const spawn = blockIndexAt(layout.width, PLAYER_SPAWN_TX, PLAYER_SPAWN_TY);
  const staticTiles = staticProtectedTiles(layout, seats);
  const listeners = new Set<TerrainListener>();
  let blocks: readonly LayoutMaterial[] = layout.blocks;
  let colors: TerrainColors = new Map();
  let floors: TerrainFloors = new Map();
  let walls: readonly (string | null)[] = layout.walls;
  /** The painted posts in placement order, oldest first (#223); the layout's own posts are not listed. */
  let wallOrder: readonly number[] = [];
  let decor: readonly DecorItem[] = [];
  /** The one way the runtime builds a snapshot: the doors of `items` open the walls they stand in. */
  const snapshotOf = (
    nextBlocks: readonly LayoutMaterial[],
    nextWalls: readonly (string | null)[],
    items: readonly DecorItem[] = decor,
    nextOrder: readonly number[] = wallOrder,
  ): TerrainSnapshot => terrainSnapshot(layout, nextBlocks, nextWalls, doorOpenings(items, { width: layout.width, height: layout.height, walls: nextWalls }), nextOrder);
  let snapshot = snapshotOf(blocks, walls);
  let catalog = new Map<string, DecorCatalogPiece>();
  let queue: Promise<unknown> = Promise.resolve();

  function decorInfo(piece: string): DecorPieceInfo | null {
    const known = catalog.get(piece);
    return known === undefined ? decorInfoFromPieceId(piece) : decorPieceInfo(known);
  }

  async function readCatalog(): Promise<void> {
    if (!decorPieces) return;
    catalog = new Map((await decorPieces()).map((piece) => [piece.id, piece]));
  }

  /** The static tiles plus every tile of every decor item: what water, void and walls must not reach. */
  function protectedTiles(): ReadonlySet<number> {
    if (decor.length === 0) return staticTiles;
    return new Set([...staticTiles, ...decor.flatMap((item) => decorTiles(item, decorInfo(item.piece), layout.width))]);
  }

  /**
   * The walls around the `voided` blocks that `next` leaves with void on
   * every tile they cover (#217): nothing to stand on. A wall on the border
   * of what remains keeps ground under one of its tiles and stays.
   */
  function floatingPosts(voided: readonly number[], next: TerrainSnapshot): number[] {
    const { width, height } = layout;
    const posts = new Set<number>();
    for (const block of voided) {
      const { tx, ty, w, h } = blockTileRect(width, block);
      // Every wall that covers a tile of the block: its columns, from the row above it to the row below it.
      for (let y = Math.max(ty - 1, 0); y <= Math.min(ty + h, height - 1); y += 1) {
        for (let x = tx; x <= Math.min(tx + w - 1, width - 1); x += 1) {
          const post = y * width + x;
          if (walls[post] == null || posts.has(post)) continue;
          if (wallPostTiles(layout, post).every((tile) => next.materials[tile] === 'void')) posts.add(post);
        }
      }
    }
    return [...posts];
  }

  /** Runs `edit` after every edit queued before it; the chain survives a refused or failed one. */
  function enqueue<T>(edit: () => Promise<T>): Promise<T> {
    const run = queue.then(edit);
    queue = run.catch(() => undefined);
    return run;
  }

  async function apply(
    edits: readonly TerrainEdit[], actorId: string | null,
    protections: () => Promise<TerrainProtections>,
    expected?: string,
  ): Promise<readonly LayoutMaterial[]> {
    if (!store) throw new Error('no terrain store: the terrain cannot be edited');
    parseTerrainBatch({ edits, expected: expected ?? encodeTerrainBlocks(blocks) }, blocks.length);
    if (expected !== undefined && expected !== encodeTerrainBlocks(blocks)) throw new TerrainStaleError('terrain changed since preview');
    if (edits.some(({ index, material }) => index === spawn && material !== 'wood')) throw new TerrainProtectedError('placement');
    // A color or floor change alone is a change too; parsing already refused a color on a material that takes none, and a floor off wood.
    const changed = edits.filter(({ index, material, color, floor }) => blocks[index] !== material || colors.get(index) !== color || floors.get(index) !== floor);
    if (changed.length === 0) return blocks;
    // A new floor needs a piece the catalog offers today; one already painted keeps drawing after it is retired.
    // Without a catalog nothing can vouch for the piece, so no floor is accepted.
    if (changed.some(({ floor }) => floor !== undefined)) {
      await readCatalog();
      for (const { floor } of changed) {
        if (floor === undefined) continue;
        const known = catalog.get(floor);
        if (known === undefined || known.kind !== 'floor' || known.retired) throw new InvalidTerrainEditError('unknown floor piece');
      }
    }
    let next = [...blocks];
    for (const { index, material } of changed) next = withBlock(next, index, material);
    let nextSnapshot = snapshotOf(next, walls);
    const watered = newlyUnwalkableTiles(snapshot, nextSnapshot);
    if (watered.length > 0) {
      const conflict = findUnwalkableConflict(watered, layout.width, protectedTiles(), await protections());
      if (conflict !== null) throw new TerrainProtectedError(conflict);
    }
    const nextColors = withTerrainColors(colors, changed);
    const nextFloors = withTerrainFloors(floors, changed);
    // Erasing ground erases the walls left floating over it, in the same save.
    // Posts already floating elsewhere are left for the wall eraser.
    const floating = floatingPosts(changed.flatMap(({ index, material }) => (material === 'void' ? [index] : [])), nextSnapshot);
    let nextWalls = walls;
    let nextOrder = wallOrder;
    if (floating.length === 0) {
      await store.saveBlocks(changed, actorId);
    } else {
      const removals = floating.map((index) => ({ index, piece: null }));
      nextWalls = withWalls(walls, removals);
      nextOrder = withWallOrder(wallOrder, walls, removals);
      nextSnapshot = snapshotOf(next, nextWalls, decor, nextOrder);
      await store.saveBlocksClearingWalls(changed, floating, actorId);
    }
    blocks = next;
    colors = nextColors;
    floors = nextFloors;
    walls = nextWalls;
    wallOrder = nextOrder;
    snapshot = nextSnapshot;
    for (const listener of listeners) listener(blocks);
    return blocks;
  }

  async function applyWalls(
    edits: readonly WallEdit[], actorId: string | null,
    protections: () => Promise<TerrainProtections>,
  ): Promise<readonly (string | null)[]> {
    if (!store) throw new Error('no terrain store: the walls cannot be edited');
    parseWallBatch({ edits }, walls.length);
    const changed = edits.filter(({ index, piece }) => walls[index] !== piece);
    if (changed.length === 0) return walls;
    const placed = changed.flatMap(({ index, piece }) => (piece === null ? [] : [index]));
    const removed = changed.flatMap(({ index, piece }) => (piece === null ? [index] : []));
    // A wall a door or window needs may be repainted (the door stays on it) but not removed.
    const doorPosts = doorPostSet(decor, layout.width);
    // Repainting a wall that already stands covers nothing new, yet its footprint touches the tiles of the
    // door standing in it, which a new wall could not: standing walls are checked without the doors' own tiles.
    const standing = placed.filter((index) => walls[index] != null);
    const fresh = placed.filter((index) => walls[index] == null);
    const guards = placed.length > 0 ? await protections() : { placements: [], players: [] };
    const doorTiles = new Set(decor.flatMap((item) => (isDoorPiece(item.piece) ? decorTiles(item, decorInfo(item.piece), layout.width) : [])));
    const guarded = protectedTiles();
    const withoutDoors = new Set([...guarded].filter((tile) => !doorTiles.has(tile)));
    // A new wall may not touch a door's tiles: it would stand in the doorway, its swing or on the wall it cuts.
    let conflict = findWallConflict(fresh, layout, guarded, guards, removed, doorPosts);
    conflict ??= findWallConflict(standing, layout, withoutDoors, guards);
    if (conflict !== null) throw new TerrainProtectedError(conflict);
    const next = withWalls(walls, changed);
    // A placed or repainted post becomes the latest, the order the store keeps by `updated_at`.
    const nextOrder = withWallOrder(wallOrder, walls, changed);
    const nextSnapshot = snapshotOf(blocks, next, decor, nextOrder);
    await store.saveWalls(changed, actorId);
    walls = next;
    wallOrder = nextOrder;
    snapshot = nextSnapshot;
    for (const listener of listeners) listener(blocks);
    return walls;
  }

  async function applyDecor(
    edits: readonly DecorEdit[], actorId: string | null, area?: DecorTileRect,
    desks?: () => Promise<readonly DecorTileRect[]>,
  ): Promise<readonly DecorItem[]> {
    if (!store) throw new Error('no terrain store: the decor cannot be edited');
    parseDecorBatch({ edits }, layout.width * layout.height);
    await readCatalog();
    const byKey = new Map(decor.map((item) => [decorItemKey(item), item]));
    const changed = edits.filter((edit) => {
      const { item } = edit;
      const current = byKey.get(decorEditKey(edit));
      if (item === null) return current !== undefined;
      return current === undefined || current.piece !== item.piece || current.rotation !== item.rotation || current.color !== item.color;
    });
    if (changed.length === 0) return decor;
    for (const { item } of changed) {
      if (item === null) continue;
      // A new placement needs a piece the catalog offers today; one already
      // placed keeps drawing even after it was retired.
      const known = catalog.get(item.piece);
      const info = decorPieces ? (known === undefined || known.retired ? null : decorPieceInfo(known)) : decorInfoFromPieceId(item.piece);
      if (info === null) throw new InvalidTerrainEditError('unknown decor piece');
      // The layer is the id's (`decorLayerOf`): a catalog kind that stands on top under a floor id would land on the floor.
      if (isOnTopKind(info.kind) !== (decorLayerOf(item.piece) === 'top')) throw new InvalidTerrainEditError('this piece stands on another layer');
      // A room table is symmetric: only its horizontal (0) and vertical (90) frames exist.
      if (!decorRotationsOf(info.kind).includes(item.rotation)) throw new InvalidTerrainEditError('this piece does not turn that way');
      // A colorable piece without a color draws in its manifest default; any other piece takes none.
      if (item.color !== undefined && info.colorable !== true) throw new InvalidTerrainEditError('this piece takes no color');
      // A door opens a wall, which only an admin edits: the desk scope never places one.
      if (area !== undefined && info.kind === 'door') throw new InvalidTerrainEditError('a door is not for a desk');
      // A sofa furnishes the office: the desk scope never places one either (`fitsDeskArea` does not offer it).
      if (area !== undefined && info.kind === 'sofa') throw new InvalidTerrainEditError('a sofa is not for a desk');
      // A tree's crown covers the office around it: the desk scope never places one (`fitsDeskArea` does not offer it).
      if (area !== undefined && info.kind === 'tree') throw new InvalidTerrainEditError('a tree is not for a desk');
    }
    if (area !== undefined) {
      const inside = (item: Pick<DecorItem, 'index' | 'piece' | 'rotation'>): boolean =>
        fitsInsideDesk(decorFootprint(item, decorInfo(item.piece), layout.width), area);
      for (const edit of changed) {
        const current = byKey.get(decorEditKey(edit));
        if (current !== undefined && !inside(current)) throw new DecorOutsideAreaError();
        if (edit.item !== null && !inside({ index: edit.index, ...edit.item })) throw new DecorOutsideAreaError();
      }
    }
    const placedInOrder = changed.flatMap((edit) => (edit.item === null ? [] : [decorEditKey(edit)]));
    let next = withDecor(decor, changed);
    // A door or window placed over another replaces it in the same save (S6); the wall under it stays.
    const placedItems = next.filter((item) => placedInOrder.includes(decorItemKey(item)));
    next = withDecor(next, doorsReplacedBy(next, placedItems, layout.width).map((index) => ({ index, item: null })));
    const deskAreas = desks === undefined ? [] : await desks();
    if (deskAreas.length > 0) {
      // One desk table per desk: the ones a placement displaces leave in the same save. A floor key is its anchor.
      const floorPlaced = placedInOrder.filter((key) => key >= 0);
      const displaced = displacedDeskTables(floorOf(next), floorPlaced, decorInfo, deskAreas, layout.width);
      next = withDecor(next, displaced.map((index) => ({ index, item: null })));
      if (deskOverChairLimit(floorOf(decor), floorOf(next), floorPlaced, decorInfo, deskAreas, layout.width) !== null) throw new DeskChairLimitError();
    }
    const nextKeys = new Set(next.map(decorItemKey));
    const placed = new Set(placedInOrder.filter((key) => nextKeys.has(key)));
    // What stood on a desk table or room table the batch took off, turned or displaced leaves with it (#121).
    next = withDecor(next, fallenTopItems(decor, next, decorInfo, layout.width, placed).map(removalOf));
    const conflict = findDecorConflict(next, placed, decorInfo, snapshot, staticTiles);
    if (conflict !== null) throw new TerrainProtectedError(conflict);
    const saved = decorChanges(decor, next);
    if (saved.length === 0) return decor;
    // A door that goes leaves its wall whole: the wall it stood in was never taken away (tile walls).
    const openings = (items: readonly DecorItem[]): string => JSON.stringify(doorOpenings(items, { width: layout.width, height: layout.height, walls }));
    const nextSnapshot = openings(next) === openings(decor) ? snapshot : snapshotOf(blocks, walls, next);
    await store.saveDecor(saved, actorId);
    decor = next;
    snapshot = nextSnapshot;
    for (const listener of listeners) listener(blocks);
    return decor;
  }

  async function applyCarry<T>(
    locate: () => Promise<AreaMove | null>, actorId: string | null,
    protections: () => Promise<TerrainProtections>,
    write: (layer: CarriedLayer) => Promise<T | null>,
    undo?: () => Promise<unknown>,
  ): Promise<T | null> {
    const { width, height } = layout;
    const move = await locate();
    if (move === null) return write({ width, walls, decor });
    const { from, dx, dy } = move;
    const onOutline = onAreaOutline(from, width);
    // Only painted posts: the store cannot remove one the layout itself draws, so it would come back at load.
    const posts = walls.flatMap((piece, post) => (piece != null && layout.walls[post] == null && onOutline(post) ? [post] : []));
    const items = carriedDecor(decor, from, decorInfo, width);
    // What stood where the area lands goes: what it holds replaces it. Told apart by key, not anchor: a top
    // item shares its anchor with the floor item under it (#121).
    const carriedKeys = new Set(items.map(decorItemKey));
    const replaced = replacedDecor(decor.filter((item) => !carriedKeys.has(decorItemKey(item))), [], { ...from, x: from.x + dx, y: from.y + dy }, decorInfo, width);
    if (posts.length === 0 && items.length === 0 && replaced.length === 0) return write({ width, walls, decor });
    if (!store) throw new Error('no terrain store: the walls and decor cannot be moved');
    // Posts and anchors share the grid's row-major indexing, so one shift serves both.
    const shift = (index: number): number => {
      const tx = (index % width) + dx;
      const ty = Math.floor(index / width) + dy;
      return tx < 0 || ty < 0 || tx >= width || ty >= height ? -1 : ty * width + tx;
    };
    const placedPosts = posts.map(shift);
    const placed = items.map((item) => ({ ...item, index: shift(item.index) }));
    if (placedPosts.includes(-1) || placed.some(({ index }) => index === -1)) throw new TerrainProtectedError('placement');

    const lifted = [...walls];
    for (const post of posts) lifted[post] = null;
    posts.forEach((post, at) => { lifted[placedPosts[at]!] = walls[post]!; });
    const moved = withDecor(
      withDecor(decor, [...items, ...replaced].map(removalOf)),
      placed.map(({ index, ...item }) => ({ index, item })),
    );
    // A carried top item that stood across onto a surface left behind falls instead of stopping the move,
    // like one left behind whose surface went (#121).
    const nextDecor = withDecor(moved, fallenTopItems(decor, moved, decorInfo, width).map(removalOf));
    const wallEdits = lifted.flatMap((piece, index): WallEdit[] => (piece === walls[index] ? [] : [{ index, piece: piece as WallPieceId | null }]));
    const nextWalls = withWalls(walls, wallEdits);
    const nextOrder = withWallOrder(wallOrder, walls, wallEdits);
    const nextSnapshot = snapshotOf(blocks, nextWalls, nextDecor, nextOrder);
    const kept = new Set(nextDecor.map(decorItemKey));
    const anchors = new Set(placed.map(decorItemKey).filter((key) => kept.has(key)));
    // What moves keeps its place against what moves with it; only what stays can be in the way.
    const stays = nextDecor.filter((item) => !anchors.has(decorItemKey(item)));
    const guarded = new Set([...staticTiles, ...stays.flatMap((item) => decorTiles(item, decorInfo(item.piece), width))]);
    const removed = wallEdits.flatMap(({ index, piece }) => (piece === null ? [index] : []));
    const guards = placedPosts.length > 0 ? await protections() : { placements: [], players: [] };
    const conflict =
      findDecorConflict(nextDecor, anchors, decorInfo, nextSnapshot, staticTiles) ??
      findWallConflict(placedPosts, layout, guarded, guards, removed, doorPostSet(stays, width));
    if (conflict !== null) throw new TerrainProtectedError(conflict);

    const result = await write({ width, walls: nextWalls, decor: nextDecor });
    if (result === null) return null;
    try {
      await store.saveWallsAndDecor(wallEdits, decorChanges(decor, nextDecor), actorId);
    } catch (error) {
      // Best effort: if putting it back fails too, the save's error is still the one to answer.
      await undo?.().catch(() => console.error('[terrain] a moved desk or room could not be put back after its contents failed to save'));
      throw error;
    }
    walls = nextWalls;
    wallOrder = nextOrder;
    decor = nextDecor;
    snapshot = nextSnapshot;
    for (const listener of listeners) listener(blocks);
    return result;
  }

  return {
    async load() {
      if (!store) return;
      const saved = await store.loadBlocks();
      const count = blockCount(layout);
      let next = layout.blocks;
      for (const [index, material] of saved) {
        // Keep the default spawn safe without rewriting incompatible saved rows.
        if (index === spawn && material !== 'wood') continue;
        if (index >= 0 && index < count) next = withBlock(next, index, material);
      }
      blocks = next;
      // Rows stored before #222 have no color and draw as before. A color the
      // block cannot take (its material, or the spawn rule above, says
      // otherwise) is ignored, never rewritten, like the spawn block.
      const savedColors = new Map<number, string>();
      for (const [index, color] of await store.loadBlockColors()) {
        if (index >= 0 && index < count && saved.get(index) === blocks[index] && isColorableTerrainMaterial(blocks[index]!)) savedColors.set(index, color);
      }
      colors = savedColors;
      // Floors load like colors: a row on any material but wood, or whose id is
      // not an uploaded floor, is ignored, never rewritten. A piece retired
      // since keeps drawing; only a new paint is checked against the catalog.
      const savedFloors = new Map<number, string>();
      for (const [index, piece] of await store.loadBlockFloors()) {
        if (index >= 0 && index < count && saved.get(index) === blocks[index] && blocks[index] === TERRAIN_FLOOR_BASE && isTerrainFloorPieceId(piece)) savedFloors.set(index, piece);
      }
      floors = savedFloors;
      const savedWalls = await store.loadWalls();
      const wallEdits: WallEdit[] = [];
      for (const [index, piece] of savedWalls) {
        // Same rule as the spawn block: a post whose footprint may not stand
        // there is ignored, never rewritten.
        if (index < 0 || index >= layout.walls.length) continue;
        if (!wallPostTiles(layout, index).some((tile) => staticTiles.has(tile))) wallEdits.push({ index, piece });
      }
      walls = withWalls(layout.walls, wallEdits);
      // The store lists the walls oldest first; the layout's own posts stay unlisted.
      wallOrder = wallEdits.map(({ index }) => index);
      const tileCount = layout.width * layout.height;
      await readCatalog();
      // Unlike the walls, a stored item that breaks today's rules is kept and
      // drawn: it is someone's furniture, and only new edits are checked.
      // Only an anchor off the map is left out. A stored door off its wall
      // opens nothing (`terrainSnapshot` needs joined posts under it).
      decor = (await store.loadDecor()).filter(({ index }) => index >= 0 && index < tileCount);
      snapshot = snapshotOf(blocks, walls);
    },
    blocks: () => blocks,
    blockColors: () => colors,
    blockFloors: () => floors,
    walls: () => walls,
    decor: () => decor,
    decorInfo,
    snapshot: () => snapshot,
    editable: store !== undefined,
    setBlock(edit, protections) {
      return enqueue(() => apply([edit], edit.actorId, protections));
    },
    setBlocks(edits, actorId, protections, expected) {
      return enqueue(() => apply(edits, actorId, protections, expected));
    },
    setWalls(edits, actorId, protections) {
      return enqueue(() => applyWalls(edits, actorId, protections));
    },
    setDecor(edits, actorId, area, desks) {
      return enqueue(() => applyDecor(edits, actorId, area, desks));
    },
    runExclusive(task) {
      return enqueue(() => task(snapshot));
    },
    carry(locate, actorId, protections, write, undo) {
      return enqueue(() => applyCarry(locate, actorId, protections, write, undo));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
