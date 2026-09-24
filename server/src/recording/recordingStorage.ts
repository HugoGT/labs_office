/**
 * Port over the bucket Egress uploads recordings to (#58): is the file there
 * yet, and a short-lived URL a browser can fetch it from. Behind a port so
 * the routes and the readiness poll are testable with a fake.
 *
 * Google Cloud Storage. Credentials are Application Default Credentials, never
 * an environment variable of their own:
 *
 *   - On the GCE VM, the VM service account through the metadata server. That
 *     identity has no private key, so V4 signing goes through the IAM
 *     Credentials `signBlob` API, which needs `iam.serviceAccounts.signBlob`
 *     on ITSELF (`roles/iam.serviceAccountTokenCreator` granted on the service
 *     account, see infra/gcp/terraform/main.tf). Without it `exists` works and
 *     every URL answers 500.
 *   - In local development, the ADC file of
 *     `gcloud auth application-default login --impersonate-service-account`,
 *     which also signs through `signBlob` (the project forbids key files).
 *     Plain user credentials cannot sign at all (infra/livekit/README.md).
 */

import { Storage, type GetSignedUrlConfig, type StorageOptions } from '@google-cloud/storage';

export interface PresignOptions {
  expiresInSeconds: number;
  /** Set to serve the object as an attachment with this filename. */
  downloadFilename?: string;
}

export interface RecordingStoragePort {
  exists(key: string): Promise<boolean>;
  presign(key: string, options: PresignOptions): Promise<string>;
}

export interface RecordingStorageEnv {
  /** Bucket name, without `gs://`. Unset: recording is not configured (503). */
  RECORDING_GCS_BUCKET?: string;
}

/** The two calls of `@google-cloud/storage`'s `Bucket` this adapter makes. */
export interface RecordingBucket {
  file(key: string): {
    exists(): Promise<[boolean]>;
    getSignedUrl(options: GetSignedUrlConfig): Promise<[string]>;
  };
}

/** Options of a V4 signed read URL, valid `expiresInSeconds` from `now`. */
export function signedReadOptions(
  { expiresInSeconds, downloadFilename }: PresignOptions,
  now: number,
): GetSignedUrlConfig {
  const options: GetSignedUrlConfig = { version: 'v4', action: 'read', expires: now + expiresInSeconds * 1000 };
  if (downloadFilename) options.responseDisposition = `attachment; filename="${downloadFilename}"`;
  return options;
}

export function gcsRecordingStorage(bucket: RecordingBucket, now: () => number = Date.now): RecordingStoragePort {
  return {
    async exists(key) {
      const [found] = await bucket.file(key).exists();
      return found;
    },
    async presign(key, options) {
      const [url] = await bucket.file(key).getSignedUrl(signedReadOptions(options, now()));
      return url;
    },
  };
}

/**
 * Adapter from the environment, or `null` without a bucket (the route answers
 * 503 `recording-not-configured`). `options` is for tests: production relies
 * on Application Default Credentials.
 */
export function recordingStorageFromEnv(
  env: RecordingStorageEnv,
  options?: StorageOptions,
): RecordingStoragePort | null {
  const bucket = env.RECORDING_GCS_BUCKET;
  if (!bucket) return null;
  return gcsRecordingStorage(new Storage(options).bucket(bucket));
}
