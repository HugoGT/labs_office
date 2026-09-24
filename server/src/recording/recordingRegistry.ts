/**
 * Active recordings, one per space (#5). `createOfficeServer.ts` builds a single
 * instance and injects it into both the HTTP routes and `OfficeRoom`, same as
 * `LiveSessionRegistry`: never a module singleton, so tests stay independent.
 *
 * The registry is the source of truth; `OfficeRoom` only mirrors it into the
 * synced state through `subscribe`, which is how every occupant (late joiners
 * included) learns that a room is being recorded.
 */

export interface ActiveRecording {
  spaceId: string;
  egressId: string;
  /** Colyseus sessionId of whoever started it. */
  startedBy: string;
  /** Epoch milliseconds. */
  startedAt: number;
  /** Object key the file is uploaded to (#58). */
  key: string;
  /** Who may watch it later (#58): `participantKeyOf` of everyone placed in the space. */
  participants: string[];
}

export type RecordingListener = (spaceId: string, entry: ActiveRecording | undefined) => void;

export interface RecordingRegistry {
  get(spaceId: string): ActiveRecording | undefined;
  set(entry: ActiveRecording): void;
  delete(spaceId: string): void;
  list(): ActiveRecording[];
  bySession(sessionId: string): ActiveRecording[];
  /**
   * Claims a space for a start that is still waiting on Egress. `false` when
   * the space is already recorded or claimed: the check and the write are
   * split by a network round trip, and without the claim two simultaneous
   * starts would both reach Egress. `set` releases it; `unreserve` gives it up.
   */
  reserve(spaceId: string): boolean;
  unreserve(spaceId: string): void;
  /** Called on every `set` and every effective `delete`. Returns the unsubscribe. */
  subscribe(listener: RecordingListener): () => void;
}

export function createRecordingRegistry(): RecordingRegistry {
  const active = new Map<string, ActiveRecording>();
  const reserved = new Set<string>();
  const listeners = new Set<RecordingListener>();

  function notify(spaceId: string, entry: ActiveRecording | undefined): void {
    for (const listener of listeners) listener(spaceId, entry);
  }

  return {
    get(spaceId) {
      return active.get(spaceId);
    },
    set(entry) {
      reserved.delete(entry.spaceId);
      active.set(entry.spaceId, entry);
      notify(entry.spaceId, entry);
    },
    delete(spaceId) {
      if (!active.delete(spaceId)) return;
      notify(spaceId, undefined);
    },
    list() {
      return [...active.values()];
    },
    bySession(sessionId) {
      return [...active.values()].filter((entry) => entry.startedBy === sessionId);
    },
    reserve(spaceId) {
      if (active.has(spaceId) || reserved.has(spaceId)) return false;
      reserved.add(spaceId);
      return true;
    },
    unreserve(spaceId) {
      reserved.delete(spaceId);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
