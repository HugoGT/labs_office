/**
 * HTTP adapter of `TerrainAdminPort` (#123 phase 2), on the shared
 * authenticated request of the other office admin clients.
 */

import type { LayoutMaterial } from '../game/officeLayout';
import { createOfficeAdminRequest, jsonBody } from './officeAdminRequest';
import type { TerrainAdminPort } from './terrainAdminPort';

export interface TerrainAdminClientOptions {
  /** The ROOT of the server (`resolveOfficeApiBaseUrl`), without `/admin`. */
  baseUrl: string;
  /** Called on EVERY request and never kept: see `officeAdminRequest.ts`. */
  getIdToken: () => Promise<string | null>;
}

export function createTerrainAdminClient(
  { baseUrl, getIdToken }: TerrainAdminClientOptions,
  fetchImpl: typeof fetch = fetch,
): TerrainAdminPort {
  const request = createOfficeAdminRequest(
    {
      baseUrl,
      getIdToken,
      notConfigured: 'terrain-not-configured',
      conflicts: ['terrain-under-placement', 'terrain-stale'],
    },
    fetchImpl,
  );

  return {
    async setBlock(index: number, material: LayoutMaterial): Promise<void> {
      await request(`/admin/terrain/blocks/${index}`, jsonBody({ material }));
    },
    async setBlocks(edits, expected) {
      await request('/admin/terrain/blocks', jsonBody({ edits, expected }));
    },
    async setWalls(edits) {
      await request('/admin/terrain/walls', jsonBody({ edits }));
    },
    async setChairs(edits) {
      await request('/admin/terrain/chairs', jsonBody({ edits }));
    },
  };
}
