/**
 * The GCS adapter without GCS. Signing a V4 URL with a service account key is
 * a local computation, so the real SDK is pinned here with a throwaway key:
 * expiry, bucket, object and download disposition. `exists` does hit the
 * network in production and is covered with a fake bucket; the real bucket is
 * left to the manual smoke test (`infra/livekit/test-recording.sh`).
 */

import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  gcsRecordingStorage,
  recordingStorageFromEnv,
  signedReadOptions,
  type RecordingBucket,
} from './recordingStorage.ts';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const CREDENTIALS = {
  client_email: 'recorder@labs-test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
};

describe('signedReadOptions', () => {
  it('a V4 read URL that expires after the requested seconds', () => {
    expect(signedReadOptions({ expiresInSeconds: 600 }, 1_000)).toEqual({
      version: 'v4',
      action: 'read',
      expires: 601_000,
    });
  });

  it('a download is served as an attachment with that filename', () => {
    expect(
      signedReadOptions({ expiresInSeconds: 600, downloadFilename: 'grabacion-sala-2026-09-23.mp4' }, 0),
    ).toMatchObject({ responseDisposition: 'attachment; filename="grabacion-sala-2026-09-23.mp4"' });
  });
});

describe('gcsRecordingStorage', () => {
  function fakeBucket(existing: Set<string>, signed: unknown[]): RecordingBucket {
    return {
      file(key) {
        return {
          async exists() {
            return [existing.has(key)];
          },
          async getSignedUrl(options) {
            signed.push({ key, options });
            return [`https://storage.googleapis.com/b/${key}?signed`];
          },
        };
      },
    };
  }

  it('exists asks the bucket for that object', async () => {
    const storage = gcsRecordingStorage(fakeBucket(new Set(['recordings/a.mp4']), []));

    expect(await storage.exists('recordings/a.mp4')).toBe(true);
    expect(await storage.exists('recordings/b.mp4')).toBe(false);
  });

  it('presign signs that object with the read options', async () => {
    const signed: unknown[] = [];
    const storage = gcsRecordingStorage(fakeBucket(new Set(), signed), () => 1_000);

    const url = await storage.presign('recordings/a.mp4', { expiresInSeconds: 600 });

    expect(url).toBe('https://storage.googleapis.com/b/recordings/a.mp4?signed');
    expect(signed).toEqual([
      { key: 'recordings/a.mp4', options: { version: 'v4', action: 'read', expires: 601_000 } },
    ]);
  });
});

describe('recordingStorageFromEnv', () => {
  it('returns null without RECORDING_GCS_BUCKET', () => {
    expect(recordingStorageFromEnv({})).toBeNull();
    expect(recordingStorageFromEnv({ RECORDING_GCS_BUCKET: '' })).toBeNull();
  });

  it('signs a V4 URL for the object in that bucket with the requested expiry, offline', async () => {
    const storage = recordingStorageFromEnv(
      { RECORDING_GCS_BUCKET: 'labs-office-test-recordings' },
      { credentials: CREDENTIALS, projectId: 'labs-test' },
    )!;

    const url = new URL(await storage.presign('recordings/sala/1-abc.mp4', { expiresInSeconds: 600 }));

    expect(url.origin).toBe('https://storage.googleapis.com');
    expect(url.pathname).toBe('/labs-office-test-recordings/recordings/sala/1-abc.mp4');
    expect(url.searchParams.get('X-Goog-Algorithm')).toBe('GOOG4-RSA-SHA256');
    expect(url.searchParams.get('X-Goog-Expires')).toBe('600');
    expect(url.searchParams.get('X-Goog-Credential')).toContain(CREDENTIALS.client_email);
    expect(url.searchParams.has('response-content-disposition')).toBe(false);
  });

  it('a download URL asks GCS to serve the object as an attachment with that filename', async () => {
    const storage = recordingStorageFromEnv(
      { RECORDING_GCS_BUCKET: 'labs-office-test-recordings' },
      { credentials: CREDENTIALS, projectId: 'labs-test' },
    )!;

    const url = new URL(
      await storage.presign('k.mp4', { expiresInSeconds: 600, downloadFilename: 'grabacion-sala-2026-09-23.mp4' }),
    );

    expect(url.searchParams.get('response-content-disposition')).toBe(
      'attachment; filename="grabacion-sala-2026-09-23.mp4"',
    );
  });
});
