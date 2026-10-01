/**
 * In-memory `AssetStoragePort` (#121): the second adapter of the port, for
 * tests and for a server injected without a bucket. Same no-overwrite rule as
 * the GCS adapter's precondition.
 */

import { assetObjectKey, type AssetStoragePort } from './assetStoragePort.ts';

export function createMemoryAssetStorage(): AssetStoragePort {
  const objects = new Map<string, Uint8Array>();
  return {
    async put(sha256, png) {
      const key = assetObjectKey(sha256);
      if (!objects.has(key)) objects.set(key, Uint8Array.from(png));
    },
    async get(sha256) {
      const found = objects.get(assetObjectKey(sha256));
      return found === undefined ? null : Uint8Array.from(found);
    },
  };
}
