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
 * table, plant and room table, one item per anchor tile, in the same queue.
 * It is not part of the snapshot (it never changes walkability; its pieces'
 * rectangles collide through the collision runtime), but every tile of every
 * item is protected like a static seat: no water, void or wall may land on
 * one.
 */

import {
  blockCount,
  blockIndexAt,
  encodeTerrainBlocks,
  newlyUnwalkableTiles,
  terrainSnapshot,
  wallPostTiles,
  withBlock,
  withWalls,
  type LayoutMaterial,
  type OfficeLayout,
  type TerrainSnapshot,
  type WallEdit,
} from '../../../src/game/officeLayout.ts';
import { BASE_MAP_SEATS, type MapSeat } from '../../../src/game/seating.ts';
import {
  decorFootprint,
  decorInfoFromPieceId,
  decorPieceInfo,
  decorTiles,
  decorRotationsOf,
  fitsInsideDesk,
  withDecor,
  type DecorEdit,
  type DecorItem,
  type DecorPieceInfo,
  type DecorTileRect,
} from '../../../src/game/officeDecor.ts';
import { deskOverChairLimit, displacedDeskTables } from '../../../src/game/deskDecorRules.ts';
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
 * list. `snapshot()` and `decor()` already answer with the new terrain.
 */
export type TerrainListener = (blocks: readonly LayoutMaterial[]) => void;

export interface TerrainRuntime {
  /** Reads the persisted blocks. Called once, after the schema is applied. */
  load(): Promise<void>;
  blocks(): readonly LayoutMaterial[];
  snapshot(): TerrainSnapshot;
  /** False without a store (no `DATABASE_URL`): the terrain is the layout's for good. */
  readonly editable: boolean;
  /**
   * Applies one edit, or throws `TerrainProtectedError` when water or void would land
   * under something `protections` (read only if the edit floods a tile) or
   * the static layout protects.
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

/** The edits that turn `before` into `after`, one per anchor that differs: what a decor batch saves. */
function decorChanges(before: readonly DecorItem[], after: readonly DecorItem[]): DecorEdit[] {
  const old = new Map(before.map((item) => [item.index, item]));
  const changes: DecorEdit[] = [];
  for (const item of after) {
    const current = old.get(item.index);
    old.delete(item.index);
    if (current !== undefined && current.piece === item.piece && current.rotation === item.rotation && current.color === item.color) continue;
    changes.push({ index: item.index, item: { piece: item.piece, rotation: item.rotation, ...(item.color === undefined ? {} : { color: item.color }) } });
  }
  for (const index of old.keys()) changes.push({ index, item: null });
  return changes;
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
  let walls: readonly (string | null)[] = layout.walls;
  let snapshot = terrainSnapshot(layout, blocks, walls);
  let decor: readonly DecorItem[] = [];
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
    const changed = edits.filter(({ index, material }) => blocks[index] !== material);
    if (changed.length === 0) return blocks;
    let next = [...blocks];
    for (const { index, material } of changed) next = withBlock(next, index, material);
    const nextSnapshot = terrainSnapshot(layout, next, walls);
    const watered = newlyUnwalkableTiles(snapshot, nextSnapshot);
    if (watered.length > 0) {
      const conflict = findUnwalkableConflict(watered, layout.width, protectedTiles(), await protections());
      if (conflict !== null) throw new TerrainProtectedError(conflict);
    }
    await store.saveBlocks(changed, actorId);
    blocks = next;
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
    if (placed.length > 0) {
      const conflict = findWallConflict(placed, layout, protectedTiles(), await protections());
      if (conflict !== null) throw new TerrainProtectedError(conflict);
    }
    const next = withWalls(walls, changed);
    const nextSnapshot = terrainSnapshot(layout, blocks, next);
    await store.saveWalls(changed, actorId);
    walls = next;
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
    const byTile = new Map(decor.map((item) => [item.index, item]));
    const changed = edits.filter(({ index, item }) => {
      const current = byTile.get(index);
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
      // A room table is symmetric: only its horizontal (0) and vertical (90) frames exist.
      if (!decorRotationsOf(info.kind).includes(item.rotation)) throw new InvalidTerrainEditError('this piece does not turn that way');
      // A colorable piece without a color draws in its manifest default; any other piece takes none.
      if (item.color !== undefined && info.colorable !== true) throw new InvalidTerrainEditError('this piece takes no color');
    }
    if (area !== undefined) {
      const inside = (item: Pick<DecorItem, 'index' | 'piece' | 'rotation'>): boolean =>
        fitsInsideDesk(decorFootprint(item, decorInfo(item.piece), layout.width), area);
      for (const { index, item } of changed) {
        const current = byTile.get(index);
        if (current !== undefined && !inside(current)) throw new DecorOutsideAreaError();
        if (item !== null && !inside({ index, ...item })) throw new DecorOutsideAreaError();
      }
    }
    const placedInOrder = changed.flatMap(({ index, item }) => (item === null ? [] : [index]));
    let next = withDecor(decor, changed);
    const deskAreas = desks === undefined ? [] : await desks();
    if (deskAreas.length > 0) {
      // One desk table per desk: the ones a placement displaces leave in the same save.
      const displaced = displacedDeskTables(next, placedInOrder, decorInfo, deskAreas, layout.width);
      next = withDecor(next, displaced.map((index) => ({ index, item: null })));
      if (deskOverChairLimit(decor, next, placedInOrder, decorInfo, deskAreas, layout.width) !== null) throw new DeskChairLimitError();
    }
    const nextAnchors = new Set(next.map(({ index }) => index));
    const placed = new Set(placedInOrder.filter((index) => nextAnchors.has(index)));
    const conflict = findDecorConflict(next, placed, decorInfo, snapshot, staticTiles);
    if (conflict !== null) throw new TerrainProtectedError(conflict);
    const saved = decorChanges(decor, next);
    if (saved.length === 0) return decor;
    await store.saveDecor(saved, actorId);
    decor = next;
    for (const listener of listeners) listener(blocks);
    return decor;
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
      const savedWalls = await store.loadWalls();
      const wallEdits: WallEdit[] = [];
      for (const [index, piece] of savedWalls) {
        // Same rule as the spawn block: a post whose footprint may not stand
        // there is ignored, never rewritten.
        if (index < 0 || index >= layout.walls.length) continue;
        if (!wallPostTiles(layout, index).some((tile) => staticTiles.has(tile))) wallEdits.push({ index, piece });
      }
      walls = withWalls(layout.walls, wallEdits);
      snapshot = terrainSnapshot(layout, blocks, walls);
      const tileCount = layout.width * layout.height;
      await readCatalog();
      // Unlike the walls, a stored item that breaks today's rules is kept and
      // drawn: it is someone's furniture, and only new edits are checked.
      // Only an anchor off the map is left out.
      decor = (await store.loadDecor()).filter(({ index }) => index >= 0 && index < tileCount);
    },
    blocks: () => blocks,
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
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
