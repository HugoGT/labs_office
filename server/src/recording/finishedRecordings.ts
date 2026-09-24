/**
 * Recordings that already stopped (#58): where the file is, who may watch it,
 * and whether it is uploaded yet. In memory and injected like
 * `RecordingRegistry`; it is lost on restart until persistent storage lands
 * with #3.
 */

import type { LiveSessionRegistry } from '../liveSessions.ts';

export interface FinishedRecording {
  recordingId: string;
  spaceId: string;
  /** Object key in the recordings bucket. */
  key: string;
  startedAt: number;
  stoppedAt: number;
  /** `participantKeyOf` of everyone the server placed in the space. */
  participants: string[];
  /** The object exists in the bucket. */
  ready: boolean;
}

export type ReadyListener = (recording: FinishedRecording) => void;

export interface FinishedRecordingStore {
  add(recording: FinishedRecording): void;
  get(recordingId: string): FinishedRecording | undefined;
  /** No-op for an unknown or already ready recording, so listeners hear it once. */
  markReady(recordingId: string): void;
  onReady(listener: ReadyListener): () => void;
}

/**
 * Who a session is, for recording access: the verified uid, which survives a
 * reload, or the sessionId in the open mode without auth, where there is no
 * identity beyond the connection.
 */
export function participantKeyOf(sessions: LiveSessionRegistry, sessionId: string): string {
  return sessions.uidOf(sessionId) ?? sessionId;
}

export function createFinishedRecordingStore(): FinishedRecordingStore {
  const recordings = new Map<string, FinishedRecording>();
  const listeners = new Set<ReadyListener>();

  return {
    add(recording) {
      recordings.set(recording.recordingId, recording);
    },
    get(recordingId) {
      return recordings.get(recordingId);
    },
    markReady(recordingId) {
      const recording = recordings.get(recordingId);
      if (!recording || recording.ready) return;
      recording.ready = true;
      for (const listener of listeners) listener(recording);
    },
    onReady(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
