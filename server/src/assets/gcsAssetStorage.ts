/**
 * Google Cloud Storage adapter of `AssetStoragePort` (#121), on the same
 * Application Default Credentials as the recordings bucket
 * (`recording/recordingStorage.ts`): the VM service account on GCE, an
 * impersonated ADC file locally. Unlike recordings nothing is signed: the
 * server reads the object and serves it itself (`GET /assets/files/:file`),
 * so the bucket stays private and needs no signing permission.
 */

import { Storage, type SaveOptions, type StorageOptions } from '@google-cloud/storage';
import { assetObjectKey, type AssetStoragePort } from './assetStoragePort.ts';

export interface AssetStorageEnv {
  /** Bucket name, without `gs://`. Unset: uploads answer 503 `asset-upload-not-configured`. */
  ASSET_GCS_BUCKET?: string;
}

/** The three calls of `@google-cloud/storage`'s `Bucket` this adapter makes. */
export interface AssetBucket {
  file(key: string): {
    exists(): Promise<[boolean]>;
    save(data: Buffer, options: SaveOptions): Promise<void>;
    download(): Promise<[Buffer]>;
  };
}

/** GCS's own answer to a failed precondition and to a missing object. */
const PRECONDITION_FAILED = 412;
const NOT_FOUND = 404;

function statusOf(error: unknown): unknown {
  return (error as { code?: unknown } | null)?.code;
}

export function gcsAssetStorage(bucket: AssetBucket): AssetStoragePort {
  return {
    async put(sha256, png) {
      const file = bucket.file(assetObjectKey(sha256));
      // The common case (a re-upload) costs a HEAD and no write.
      const [exists] = await file.exists();
      if (exists) return;
      try {
        await file.save(Buffer.from(png), {
          resumable: false,
          contentType: 'image/png',
          metadata: { cacheControl: 'public, max-age=31536000, immutable' },
          // Create only: an object under this name already holds these bytes.
          preconditionOpts: { ifGenerationMatch: 0 },
        });
      } catch (error) {
        // Another upload of the same file got there between the HEAD and the write.
        if (statusOf(error) === PRECONDITION_FAILED) return;
        throw error;
      }
    },
    async get(sha256) {
      try {
        const [bytes] = await bucket.file(assetObjectKey(sha256)).download();
        return new Uint8Array(bytes);
      } catch (error) {
        if (statusOf(error) === NOT_FOUND) return null;
        throw error;
      }
    },
  };
}

/**
 * Adapter from the environment, or `null` without a bucket. Built once by the
 * server for the same reason as the recordings one: the client caches its
 * access token. `options` is for tests.
 */
export function assetStorageFromEnv(env: AssetStorageEnv, options?: StorageOptions): AssetStoragePort | null {
  const bucket = env.ASSET_GCS_BUCKET;
  if (!bucket) return null;
  return gcsAssetStorage(new Storage(options).bucket(bucket) as unknown as AssetBucket);
}
