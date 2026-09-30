import type { Desk, DeskDirectory } from '../desks/desksPort.ts';
import type { Space, SpacesDirectory } from '../spaces/spacesPort.ts';

export interface RecordingGeometry {
  getSpace(id: string): Space | undefined;
  subscribe(listener: () => void): () => void;
}

/**
 * Recording-only geometry view. Existing reads warm it; committed room and
 * paired-desk writes update it without another query. It never replaces the
 * payload returned to HTTP callers, nor changes the geometry hash (F4/F6).
 */
export function createRecordingSpaceSnapshot(source: SpacesDirectory): {
  spaces: SpacesDirectory;
  geometry: RecordingGeometry;
  observeDesks(source: DeskDirectory): DeskDirectory;
} {
  let known = new Map<string, Space>();
  let revision = 0;
  let nextRead = 0;
  let appliedRead = 0;
  let writes = Promise.resolve();
  const listeners = new Set<() => void>();
  const copy = (space: Space): Space => Object.freeze({ ...space });
  const notify = () => { for (const listener of listeners) listener(); };

  // Observe geometry commits in order, including a desk's transactional space
  // update. Otherwise two responses from different connections could regress
  // the view. Claim/release/decor do not use this queue.
  function mutate<T>(run: () => Promise<T>, apply: (result: T) => boolean): Promise<T> {
    const done = writes.then(async () => {
      const result = await run();
      if (apply(result)) {
        revision++;
        notify();
      }
      return result;
    });
    writes = done.then(() => undefined, () => undefined);
    return done;
  }

  const spaces: SpacesDirectory = {
    getSpace: (id) => source.getSpace(id),
    listLayout: (id) => source.listLayout(id),
    replaceLayout: (id, items) => source.replaceLayout(id, items),
    version: () => source.version(),
    async listSpaces() {
      const before = revision;
      const read = ++nextRead;
      const rows = await source.listSpaces();
      // A slow list must not undo a newer commit or a newer completed read.
      if (before === revision && read >= appliedRead) {
        known = new Map(rows.map((space) => [space.id, copy(space)]));
        appliedRead = read;
        notify();
      }
      return rows;
    },
    createSpace(input) {
      return mutate(() => source.createSpace(input), (space) => {
        known.set(space.id, copy(space));
        return true;
      });
    },
    updateSpace(id, input) {
      return mutate(() => source.updateSpace(id, input), (space) => {
        if (!space) return false;
        known.set(space.id, copy(space));
        return true;
      });
    },
    deleteSpace(id) {
      return mutate(() => source.deleteSpace(id), (deleted) => {
        if (deleted) known.delete(id);
        return deleted;
      });
    },
  };

  function applyDesk(desk: Desk): boolean {
    for (const space of known.values()) {
      if (space.deskId === desk.id) {
        known.set(space.id, copy({ ...space, name: desk.label, x: desk.x, y: desk.y }));
      }
    }
    // A newly created cubicle's UUID is supplied by the next existing read.
    // Creation cannot overlap a recorded space, so it cannot change membership
    // of a currently tracked space, but still invalidates older list snapshots.
    return true;
  }

  return {
    spaces,
    geometry: {
      getSpace: (id) => known.get(id),
      subscribe(listener) {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      },
    },
    observeDesks(desks) {
      return {
        listDesks: () => desks.listDesks(),
        listOfficeDesks: () => desks.listOfficeDesks(),
        getDesk: (id) => desks.getDesk(id),
        claimDesk: (id, userId) => desks.claimDesk(id, userId),
        releaseDesk: (userId) => desks.releaseDesk(userId),
        createDesk: (input) => mutate(() => desks.createDesk(input), applyDesk),
        updateDesk: (id, input) => mutate(() => desks.updateDesk(id, input), (desk) => desk ? applyDesk(desk) : false),
        deleteDesk: (id) => mutate(() => desks.deleteDesk(id), (deleted) => {
          if (deleted) {
            for (const space of known.values()) {
              if (space.deskId === id) known.delete(space.id);
            }
          }
          return deleted;
        }),
      };
    },
  };
}
