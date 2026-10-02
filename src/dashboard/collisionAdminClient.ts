/**
 * HTTP adapter of `CollisionAdminPort`, on the shared authenticated request
 * of the other office admin clients.
 */

import type { CollisionAdminPort } from './collisionAdminPort';
import { createOfficeAdminRequest, jsonBody } from './officeAdminRequest';

export interface CollisionAdminClientOptions {
  /** The ROOT of the server (`resolveOfficeApiBaseUrl`), without `/admin`. */
  baseUrl: string;
  /** Called on EVERY request and never kept: see `officeAdminRequest.ts`. */
  getIdToken: () => Promise<string | null>;
}

export function createCollisionAdminClient(
  { baseUrl, getIdToken }: CollisionAdminClientOptions,
  fetchImpl: typeof fetch = fetch,
): CollisionAdminPort {
  const request = createOfficeAdminRequest(
    { baseUrl, getIdToken, notConfigured: 'collisions-not-configured', conflicts: ['collision-under-player'] },
    fetchImpl,
  );

  return {
    async saveRects(pieceId, rects) {
      await request(`/admin/collisions/${encodeURIComponent(pieceId)}`, jsonBody({ rects: rects.map(({ x, y, w, h }) => ({ x, y, w, h })) }));
    },
    async reset(pieceId) {
      await request(`/admin/collisions/${encodeURIComponent(pieceId)}/reset`, jsonBody({}));
    },
  };
}
