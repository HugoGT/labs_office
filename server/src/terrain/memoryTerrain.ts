/**
 * In-memory `TerrainStore` (#123 phase 2), for tests and injection. Same
 * contract as `pgTerrain.ts`, asked the same questions by its tests.
 */

import type { LayoutMaterial } from '../../../src/game/officeLayout.ts';
import type { TerrainStore } from './terrainPort.ts';

export interface MemoryTerrain extends TerrainStore {
  /** Who set each block last, for tests that check the actor is recorded. */
  actorOf(index: number): string | null | undefined;
}

export function createMemoryTerrain(seed: Iterable<readonly [number, LayoutMaterial]> = []): MemoryTerrain {
  const blocks = new Map<number, { material: LayoutMaterial; actorId: string | null }>();
  for (const [index, material] of seed) blocks.set(index, { material, actorId: null });

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
  };
}
