import { describe, expect, it } from 'vitest';
import { canModerate, microphonesToMute, parseMuteTarget } from './moderationRules.ts';

const MICS = [
  { identity: 'moderator', trackSid: 'TR_mod' },
  { identity: 'ana', trackSid: 'TR_ana' },
  { identity: 'bea', trackSid: 'TR_bea' },
];

describe('canModerate (#282)', () => {
  it('reuses the admin roles: only an admin or the superadmin moderates', () => {
    expect(canModerate('superadmin')).toBe(true);
    expect(canModerate('admin')).toBe(true);
    expect(canModerate('employee')).toBe(false);
    expect(canModerate('guest')).toBe(false);
  });
});

describe('parseMuteTarget (#282)', () => {
  it('reads one person or everyone', () => {
    expect(parseMuteTarget({ target: 'ana' })).toEqual({ kind: 'one', sessionId: 'ana' });
    expect(parseMuteTarget({ all: true })).toEqual({ kind: 'all' });
  });

  it('refuses a body that says neither, both, or something else: a missing field never mutes everyone', () => {
    expect(parseMuteTarget({})).toBeNull();
    expect(parseMuteTarget({ target: 'ana', all: true })).toBeNull();
    expect(parseMuteTarget({ target: '' })).toBeNull();
    expect(parseMuteTarget({ target: 7 })).toBeNull();
    expect(parseMuteTarget({ all: 'true' })).toBeNull();
    expect(parseMuteTarget(null)).toBeNull();
  });
});

describe('microphonesToMute (#282)', () => {
  it('one person: only their microphone', () => {
    expect(microphonesToMute(MICS, 'moderator', { kind: 'one', sessionId: 'ana' })).toEqual([MICS[1]]);
  });

  it('everyone: every microphone but the moderator own', () => {
    expect(microphonesToMute(MICS, 'moderator', { kind: 'all' })).toEqual([MICS[1], MICS[2]]);
  });

  it('nobody when the person publishes no microphone in the room', () => {
    expect(microphonesToMute(MICS, 'moderator', { kind: 'one', sessionId: 'carla' })).toEqual([]);
  });
});
