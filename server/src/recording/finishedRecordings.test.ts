import { describe, expect, it } from 'vitest';
import { createLiveSessionRegistry } from '../liveSessions.ts';
import { createFinishedRecordingStore, participantKeyOf, type FinishedRecording } from './finishedRecordings.ts';

function finished(overrides: Partial<FinishedRecording> = {}): FinishedRecording {
  return {
    recordingId: 'rec-1',
    spaceId: 'sala',
    key: 'recordings/sala/1-abc.mp4',
    startedAt: 1,
    stoppedAt: 2,
    participants: ['uid-ana'],
    ready: false,
    ...overrides,
  };
}

describe('createFinishedRecordingStore', () => {
  it('keeps finished recordings by id', () => {
    const store = createFinishedRecordingStore();
    store.add(finished());

    expect(store.get('rec-1')).toEqual(finished());
    expect(store.get('rec-x')).toBeUndefined();
  });

  it('markReady flips the flag once and notifies the ready listeners', () => {
    const store = createFinishedRecordingStore();
    const ready: string[] = [];
    store.onReady((recording) => ready.push(recording.recordingId));
    store.add(finished());

    store.markReady('rec-1');
    store.markReady('rec-1');
    store.markReady('rec-unknown');

    expect(store.get('rec-1')?.ready).toBe(true);
    expect(ready).toEqual(['rec-1']);
  });

  it('an unsubscribed listener hears nothing more', () => {
    const store = createFinishedRecordingStore();
    const ready: string[] = [];
    const unsubscribe = store.onReady((recording) => ready.push(recording.recordingId));
    unsubscribe();
    store.add(finished());

    store.markReady('rec-1');

    expect(ready).toEqual([]);
  });
});

describe('participantKeyOf', () => {
  it('is the verified uid when the session has one, the sessionId in the open mode', () => {
    const sessions = createLiveSessionRegistry();
    sessions.add('ses-auth', 'uid-ana');
    sessions.add('ses-open');

    expect(participantKeyOf(sessions, 'ses-auth')).toBe('uid-ana');
    expect(participantKeyOf(sessions, 'ses-open')).toBe('ses-open');
  });
});
