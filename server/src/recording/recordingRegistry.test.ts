/**
 * In-memory registry of active recordings (#5): one per space, owned by the
 * server so every occupant sees the same answer.
 */

import { describe, expect, it } from 'vitest';
import { createRecordingRegistry, type ActiveRecording } from './recordingRegistry.ts';

function recording(overrides: Partial<ActiveRecording> = {}): ActiveRecording {
  return {
    spaceId: 'sala',
    egressId: 'EG_1',
    startedBy: 'ses-ana',
    startedAt: 1000,
    key: 'recordings/sala/1000-abc.mp4',
    participants: ['ses-ana'],
    ...overrides,
  };
}

describe('createRecordingRegistry', () => {
  it('stores one recording per space and forgets it on delete', () => {
    const registry = createRecordingRegistry();

    registry.set(recording());
    expect(registry.get('sala')).toEqual(recording());

    registry.delete('sala');
    expect(registry.get('sala')).toBeUndefined();
  });

  it('bySession lists only the recordings that session started', () => {
    const registry = createRecordingRegistry();
    registry.set(recording({ spaceId: 'a', startedBy: 'ses-ana' }));
    registry.set(recording({ spaceId: 'b', startedBy: 'ses-bruno' }));

    expect(registry.bySession('ses-ana').map((r) => r.spaceId)).toEqual(['a']);
    expect(registry.bySession('ses-nadie')).toEqual([]);
  });

  it('a reservation blocks a second one for the same space until it is settled', () => {
    // Two occupants clicking at once must not both reach Egress: the check and
    // the write are split by the egress round trip.
    const registry = createRecordingRegistry();

    expect(registry.reserve('sala')).toBe(true);
    expect(registry.reserve('sala')).toBe(false);
    expect(registry.reserve('otra')).toBe(true);

    registry.unreserve('sala');
    expect(registry.reserve('sala')).toBe(true);
  });

  it('an active recording also blocks a reservation, and set() releases the reservation', () => {
    const registry = createRecordingRegistry();
    expect(registry.reserve('sala')).toBe(true);
    registry.set(recording());
    registry.delete('sala');

    expect(registry.reserve('sala')).toBe(true);
    registry.set(recording());
    expect(registry.reserve('sala')).toBe(false);
  });

  it('notifies subscribers of every set and delete, until they unsubscribe', () => {
    const registry = createRecordingRegistry();
    const seen: [string, ActiveRecording | undefined][] = [];
    const unsubscribe = registry.subscribe((spaceId, entry) => seen.push([spaceId, entry]));

    registry.set(recording());
    registry.delete('sala');
    registry.delete('sala'); // nothing to delete: no notification
    unsubscribe();
    registry.set(recording());

    expect(seen).toEqual([
      ['sala', recording()],
      ['sala', undefined],
    ]);
  });

  it('list returns every active recording', () => {
    const registry = createRecordingRegistry();
    registry.set(recording({ spaceId: 'a' }));
    registry.set(recording({ spaceId: 'b' }));

    expect(registry.list().map((r) => r.spaceId).sort()).toEqual(['a', 'b']);
  });
});
