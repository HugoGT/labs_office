/**
 * In-memory `TerrainStore` (#123 phase 2), for tests and injection. Same
 * contract as `pgTerrain.ts`, asked the same questions by its tests.
 */

import type { LayoutMaterial, WallPieceId } from '../../../src/game/officeLayout.ts';
import type { TerrainStore } from './terrainPort.ts';

export interface MemoryTerrain extends TerrainStore {
  /** Who set each block last, for tests that check the actor is recorded. */
  actorOf(index: number): string | null | undefined;
  /** Who placed the wall on a tile, `undefined` where none stands. */
  wallActorOf(index: number): string | null | undefined;
}

export function createMemoryTerrain(
  seed: Iterable<readonly [number, LayoutMaterial]> = [],
  wallSeed: Iterable<readonly [number, WallPieceId]> = [],
): MemoryTerrain {
  const blocks = new Map<number, { material: LayoutMaterial; actorId: string | null }>();
  for (const [index, material] of seed) blocks.set(index, { material, actorId: null });
  const walls = new Map<number, { piece: WallPieceId; actorId: string | null }>();
  for (const [index, piece] of wallSeed) walls.set(index, { piece, actorId: null });

  return {
    async loadBlocks() {
      return new Map([...blocks].map(([index, { material }]) => [index, material]));
    },
    async saveBlock(index, material, actorId) {
      blocks.set(index, { material, actorId });
    },
    async saveBlocks(edits, actorId) {
      for (const { index, material } of edits) blocks.set(index, { material, actorId });
    },
    actorOf(index) {
      return blocks.get(index)?.actorId;
    },
    async loadWalls() {
      return new Map([...walls].map(([index, { piece }]) => [index, piece]));
    },
    async saveWalls(edits, actorId) {
      // Synchronous between the read and the writes, like one Postgres statement.
      for (const { index, piece } of edits) {
        if (piece === null) walls.delete(index);
        else walls.set(index, { piece, actorId });
      }
    },
    wallActorOf(index) {
      return walls.get(index)?.actorId;
    },
  };
}
