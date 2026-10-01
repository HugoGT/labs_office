import { describe, expect, it } from 'vitest';
import { assetObjectKey, isAssetHash } from './assetStoragePort.ts';
import { assetStorageFromEnv, gcsAssetStorage, type AssetBucket } from './gcsAssetStorage.ts';
import { createMemoryAssetStorage } from './memoryAssetStorage.ts';

const HASH = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

describe('asset object keys', () => {
  it('are content-addressed and immutable by name: assets/<sha256>.png', () => {
    expect(assetObjectKey(HASH)).toBe(`assets/${HASH}.png`);
  });

  it('accept only a lowercase sha256, so a key can never climb out of assets/', () => {
    expect(isAssetHash(HASH)).toBe(true);
    for (const bad of ['', 'A'.repeat(64), 'a'.repeat(63), `../${'a'.repeat(61)}`, `${'a'.repeat(64)}.png`]) {
      expect(isAssetHash(bad)).toBe(false);
    }
    expect(() => assetObjectKey('../secrets')).toThrow();
  });
});

describe('memory asset storage', () => {
  it('stores bytes under their hash and answers null for an unknown one', async () => {
    const storage = createMemoryAssetStorage();
    await storage.put(HASH, new Uint8Array([1, 2, 3]));

    expect(Array.from((await storage.get(HASH)) ?? [])).toEqual([1, 2, 3]);
    expect(await storage.get(OTHER)).toBeNull();
  });

  it('never overwrites an object: the first bytes under a hash stay', async () => {
    const storage = createMemoryAssetStorage();
    await storage.put(HASH, new Uint8Array([1]));
    await storage.put(HASH, new Uint8Array([9]));

    expect(Array.from((await storage.get(HASH)) ?? [])).toEqual([1]);
  });
});

/** The calls of `@google-cloud/storage`'s `Bucket` the adapter makes, recorded. */
function fakeBucket(objects = new Map<string, Buffer>(), saveError?: { code: number }) {
  const saves: { key: string; options: unknown }[] = [];
  const bucket: AssetBucket = {
    file(key) {
      return {
        async exists() {
          return [objects.has(key)];
        },
        async save(data, options) {
          saves.push({ key, options });
          if (saveError) throw Object.assign(new Error('gcs'), saveError);
          objects.set(key, Buffer.from(data));
        },
        async download() {
          const found = objects.get(key);
          if (found === undefined) throw Object.assign(new Error('No such object'), { code: 404 });
          return [found];
        },
      };
    },
  };
  return { bucket, saves, objects };
}

describe('GCS asset storage', () => {
  it('creates the object only if it does not exist yet, as a cacheable PNG', async () => {
    const { bucket, saves, objects } = fakeBucket();
    await gcsAssetStorage(bucket).put(HASH, new Uint8Array([1, 2]));

    expect(saves).toEqual([
      {
        key: `assets/${HASH}.png`,
        options: {
          resumable: false,
          contentType: 'image/png',
          metadata: { cacheControl: 'public, max-age=31536000, immutable' },
          preconditionOpts: { ifGenerationMatch: 0 },
        },
      },
    ]);
    expect(objects.get(`assets/${HASH}.png`)).toEqual(Buffer.from([1, 2]));
  });

  it('treats an object that already exists as stored: the hash names the same bytes', async () => {
    const existing = new Map([[`assets/${HASH}.png`, Buffer.from([7])]]);
    const { bucket, saves } = fakeBucket(existing);
    await gcsAssetStorage(bucket).put(HASH, new Uint8Array([7]));
    expect(saves).toEqual([]);

    // A concurrent upload of the same file wins the race: the precondition fails with 412.
    const racing = fakeBucket(new Map(), { code: 412 });
    await expect(gcsAssetStorage(racing.bucket).put(HASH, new Uint8Array([7]))).resolves.toBeUndefined();
  });

  it('rethrows any other storage failure', async () => {
    const { bucket } = fakeBucket(new Map(), { code: 403 });
    await expect(gcsAssetStorage(bucket).put(HASH, new Uint8Array([7]))).rejects.toThrow('gcs');
  });

  it('reads the bytes back, and a missing object as null', async () => {
    const { bucket } = fakeBucket(new Map([[`assets/${HASH}.png`, Buffer.from([4, 5])]]));
    const storage = gcsAssetStorage(bucket);

    expect(Array.from((await storage.get(HASH)) ?? [])).toEqual([4, 5]);
    expect(await storage.get(OTHER)).toBeNull();
  });

  it('is not configured without ASSET_GCS_BUCKET', () => {
    expect(assetStorageFromEnv({})).toBeNull();
    expect(assetStorageFromEnv({ ASSET_GCS_BUCKET: '' })).toBeNull();
    expect(assetStorageFromEnv({ ASSET_GCS_BUCKET: 'labs-office-test-assets' }, { projectId: 'labs-test' })).not.toBeNull();
  });
});
