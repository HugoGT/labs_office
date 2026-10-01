/**
 * The live terrain of the server (#123 phase 2): the persisted blocks and the
 * `TerrainSnapshot` built from them, kept in memory. `OfficeRoom` checks every
 * `move` against `snapshot()`, so a move never queries Postgres; the snapshot
 * is rebuilt once at `load()` and once per accepted edit.
 *
 * Edits run one at a time. Each one is checked against the terrain the
 * previous one left and against protections read at that moment, and the
 * snapshot only changes after the store saved it: a failed save leaves the
 * office exactly as it was.
 */

import {
  blockCount,
  newlyWateredTiles,
  terrainSnapshot,
  withBlock,
  type LayoutMaterial,
  type OfficeLayout,
  type TerrainSnapshot,
} from '../../../src/game/officeLayout.ts';
import { BASE_MAP_SEATS } from '../../../src/game/seating.ts';
import type { TerrainStore } from './terrainPort.ts';
import {
  TerrainProtectedError,
  findWaterConflict,
  staticProtectedTiles,
  type TerrainEdit,
  type TerrainProtections,
} from './terrainRules.ts';

export type TerrainListener = (blocks: readonly LayoutMaterial[]) => void;

export interface TerrainRuntime {
  /** Reads the persisted blocks. Called once, after the schema is applied. */
  load(): Promise<void>;
  blocks(): readonly LayoutMaterial[];
  snapshot(): TerrainSnapshot;
  /** False without a store (no `DATABASE_URL`): the terrain is the layout's for good. */
  readonly editable: boolean;
  /**
   * Applies one edit, or throws `TerrainProtectedError` when water would land
   * under something `protections` (read only if the edit floods a tile) or
   * the static layout protects.
   */
  setBlock(edit: TerrainEdit & { actorId: string | null }, protections: () => Promise<TerrainProtections>): Promise<readonly LayoutMaterial[]>;
  /** Called after each accepted edit with the whole new block list. */
  subscribe(listener: TerrainListener): () => void;
}

export function createTerrainRuntime({ layout, store }: { layout: OfficeLayout; store?: TerrainStore }): TerrainRuntime {
  const staticTiles = staticProtectedTiles(layout, BASE_MAP_SEATS);
  const listeners = new Set<TerrainListener>();
  let blocks: readonly LayoutMaterial[] = layout.blocks;
  let snapshot = terrainSnapshot(layout, blocks);
  let queue: Promise<unknown> = Promise.resolve();

  async function apply(
    { index, material, actorId }: TerrainEdit & { actorId: string | null },
    protections: () => Promise<TerrainProtections>,
  ): Promise<readonly LayoutMaterial[]> {
    if (!store) throw new Error('no terrain store: the terrain cannot be edited');
    if (blocks[index] === material) return blocks;
    const next = withBlock(blocks, index, material);
    const nextSnapshot = terrainSnapshot(layout, next);
    const watered = newlyWateredTiles(snapshot, nextSnapshot);
    if (watered.length > 0) {
      const conflict = findWaterConflict(watered, layout.width, staticTiles, await protections());
      if (conflict !== null) throw new TerrainProtectedError(conflict);
    }
    await store.saveBlock(index, material, actorId);
    blocks = next;
    snapshot = nextSnapshot;
    for (const listener of listeners) listener(blocks);
    return blocks;
  }

  return {
    async load() {
      if (!store) return;
      const saved = await store.loadBlocks();
      const count = blockCount(layout);
      let next = layout.blocks;
      for (const [index, material] of saved) {
        if (index >= 0 && index < count) next = withBlock(next, index, material);
      }
      blocks = next;
      snapshot = terrainSnapshot(layout, blocks);
    },
    blocks: () => blocks,
    snapshot: () => snapshot,
    editable: store !== undefined,
    setBlock(edit, protections) {
      const run = queue.then(() => apply(edit, protections));
      // The chain must survive a refused or failed edit; the caller still sees it.
      queue = run.catch(() => undefined);
      return run;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
