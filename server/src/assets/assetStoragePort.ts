/**
 * Port over the storage of uploaded art files (#121). Types and the key rule
 * only: the adapters are `gcsAssetStorage.ts` (deployed, `ASSET_GCS_BUCKET`)
 * and `memoryAssetStorage.ts` (tests and injection).
 *
 * Objects are content-addressed and immutable: `assets/<sha256>.png`, where
 * the hash is of the re-encoded bytes. Storing the same hash twice is a no-op,
 * never an overwrite, so a URL can be cached forever and a retry is harmless.
 * A bucket of its own and not the recordings one: those objects expire after
 * 30 days, and these must outlive every row that points at them.
 */

export interface AssetStoragePort {
  /** Stores `png` under its hash. If that hash is already stored, keeps what is there. */
  put(sha256: string, png: Uint8Array): Promise<void>;
  /** The stored bytes, or `null` when nothing has that hash. */
  get(sha256: string): Promise<Uint8Array | null>;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** A lowercase hex sha256 and nothing else: what keeps a key from naming any other object. */
export function isAssetHash(value: string): boolean {
  return SHA256_HEX.test(value);
}

export function assetObjectKey(sha256: string): string {
  if (!isAssetHash(sha256)) throw new Error('an asset key needs a sha256');
  return `assets/${sha256}.png`;
}
