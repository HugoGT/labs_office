/**
 * Port over LiveKit Egress (#5): start and stop a room composite recording.
 * The routes only see this interface, so their branches are testable without
 * a LiveKit stack; the adapter below is deliberately thin and untested
 * against a real server (see `infra/livekit/test-recording.sh` for that).
 */

import { EgressClient, EncodedFileOutput, GCPUpload } from 'livekit-server-sdk';
import type { RecordingStorageEnv } from './recordingStorage.ts';

export interface EgressPort {
  /** `filepath` is the object key: chosen by the server so it can find the file later (#58). */
  start(roomName: string, filepath: string): Promise<{ egressId: string }>;
  stop(egressId: string): Promise<void>;
}

export interface RecordingEnv extends RecordingStorageEnv {
  LIVEKIT_API_KEY?: string;
  LIVEKIT_API_SECRET?: string;
  LIVEKIT_API_URL?: string;
  LIVEKIT_URL?: string;
}

/**
 * HTTP URL of the LiveKit API. `LIVEKIT_URL` is the WebSocket URL handed to
 * browsers, so it is only a fallback: behind a proxy the server may need to
 * reach LiveKit on a different address, and `LIVEKIT_API_URL` says so.
 */
export function livekitApiUrlFrom(env: RecordingEnv): string {
  if (env.LIVEKIT_API_URL) return env.LIVEKIT_API_URL;
  return (env.LIVEKIT_URL ?? 'ws://localhost:7880')
    .replace(/^wss:\/\//, 'https://')
    .replace(/^ws:\/\//, 'http://');
}

/**
 * Where Egress writes the MP4: `key` in the GCS `bucket`. The upload block
 * travels in EVERY request: the storage section of the Egress config is not
 * applied as a default, and without it Egress attempts a local upload and
 * dies (`infra/livekit/README.md`).
 *
 * `credentials` stays empty on purpose. With it empty, Egress (livekit/storage
 * `NewGCP`) uses Application Default Credentials of ITS container: the VM
 * service account through the metadata server on GCE, or the ADC file mounted
 * by infra/livekit/docker-compose.yml in local development. No credential ever
 * travels through the LiveKit API or this server's environment.
 */
export function gcsFileOutput(bucket: string, key: string): EncodedFileOutput {
  return new EncodedFileOutput({
    filepath: key,
    output: { case: 'gcp', value: new GCPUpload({ bucket }) },
  });
}

/**
 * Adapter from the environment, or `null` when anything required is missing
 * (the route answers 503 `recording-not-configured`). Read per request, like
 * the LiveKit credentials of `/livekit/token`.
 */
export function egressFromEnv(env: RecordingEnv): EgressPort | null {
  const { LIVEKIT_API_KEY: apiKey, LIVEKIT_API_SECRET: apiSecret, RECORDING_GCS_BUCKET: bucket } = env;
  if (!apiKey || !apiSecret || !bucket) return null;

  const client = new EgressClient(livekitApiUrlFrom(env), apiKey, apiSecret);

  return {
    async start(roomName, filepath) {
      const file = gcsFileOutput(bucket, filepath);
      const info = await client.startRoomCompositeEgress(roomName, { file }, { layout: 'grid' });
      return { egressId: info.egressId };
    },
    async stop(egressId) {
      await client.stopEgress(egressId);
    },
  };
}
