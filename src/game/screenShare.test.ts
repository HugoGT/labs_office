import { describe, expect, it } from 'vitest';
import type { AttachableTrack } from './attachableTrack';
import {
  nextScreenShareClaim,
  screenShareClaimOf,
  screenShareTrackName,
  screenShareWinner,
  selectScreenShareStage,
  shouldYieldScreenShare,
} from './screenShare';

function fakeTrack(): AttachableTrack {
  return { kind: 'video', attach: () => document.createElement('video'), detach: () => [] };
}

describe('screen share claim in the track name (#20)', () => {
  it('round-trips a claim through the published track name', () => {
    expect(screenShareClaimOf(screenShareTrackName(7))).toBe(7);
  });

  it('a missing or foreign track name is claim 0: it never outranks a real claim', () => {
    expect(screenShareClaimOf(undefined)).toBe(0);
    expect(screenShareClaimOf('')).toBe(0);
    expect(screenShareClaimOf('screen')).toBe(0);
    expect(screenShareClaimOf('screen_share#abc')).toBe(0);
    expect(screenShareClaimOf('screen_share#-3')).toBe(0);
  });

  it('the next claim is one above every claim already in the space, 1 when nobody shares', () => {
    expect(nextScreenShareClaim([])).toBe(1);
    expect(
      nextScreenShareClaim([
        { identity: 'ana', claim: 3 },
        { identity: 'beto', claim: 5 },
      ]),
    ).toBe(6);
  });
});

describe('screenShareWinner: one sharer per space (#20)', () => {
  it('nobody sharing has no winner', () => {
    expect(screenShareWinner([])).toBeNull();
  });

  it('the later share (higher claim) wins: taking over displaces the current sharer', () => {
    expect(
      screenShareWinner([
        { identity: 'zoe', claim: 1 },
        { identity: 'ana', claim: 2 },
      ]),
    ).toBe('ana');
  });

  it('two shares with the same claim (started at the same time) break the tie by identity', () => {
    const claims = [
      { identity: 'ana', claim: 4 },
      { identity: 'beto', claim: 4 },
    ];

    expect(screenShareWinner(claims)).toBe('beto');
    // Order-independent: every client computes the same winner from the same set.
    expect(screenShareWinner([...claims].reverse())).toBe('beto');
  });
});

describe('shouldYieldScreenShare: exactly one of two racing sharers stops', () => {
  it('a sharer outranked by a later claim yields', () => {
    const claims = [
      { identity: 'ana', claim: 1 },
      { identity: 'beto', claim: 2 },
    ];

    expect(shouldYieldScreenShare('ana', claims)).toBe(true);
    expect(shouldYieldScreenShare('beto', claims)).toBe(false);
  });

  it('in a tie exactly one side yields, never both and never neither', () => {
    const claims = [
      { identity: 'ana', claim: 3 },
      { identity: 'beto', claim: 3 },
    ];

    const yields = ['ana', 'beto'].filter((identity) => shouldYieldScreenShare(identity, claims));

    expect(yields).toEqual(['ana']);
  });

  it('someone who is not sharing has nothing to yield', () => {
    expect(shouldYieldScreenShare('carla', [{ identity: 'ana', claim: 1 }])).toBe(false);
  });
});

describe('selectScreenShareStage: what goes on the big stage', () => {
  it('no active sharer means no stage: the tile row stays as it is', () => {
    expect(
      selectScreenShareStage({
        activeSharer: null,
        selfSessionId: 'yo',
        localTrack: null,
        remoteTracks: new Map(),
      }),
    ).toBeNull();
  });

  it('a peer sharing puts their subscribed screen on the stage', () => {
    const track = fakeTrack();

    expect(
      selectScreenShareStage({
        activeSharer: 'ana',
        selfSessionId: 'yo',
        localTrack: null,
        remoteTracks: new Map([['ana', track]]),
      }),
    ).toEqual({ sessionId: 'ana', track });
  });

  it('only the winner reaches the stage while a displaced share is still going away', () => {
    const winner = fakeTrack();

    expect(
      selectScreenShareStage({
        activeSharer: 'ana',
        selfSessionId: 'yo',
        localTrack: null,
        remoteTracks: new Map([
          ['beto', fakeTrack()],
          ['ana', winner],
        ]),
      }),
    ).toEqual({ sessionId: 'ana', track: winner });
  });

  it('the winner is known but its track is not subscribed yet: no empty stage', () => {
    expect(
      selectScreenShareStage({
        activeSharer: 'ana',
        selfSessionId: 'yo',
        localTrack: null,
        remoteTracks: new Map(),
      }),
    ).toBeNull();
  });

  it('the sharer sees their own screen on the stage, from the local track', () => {
    const local = fakeTrack();

    expect(
      selectScreenShareStage({
        activeSharer: 'yo',
        selfSessionId: 'yo',
        localTrack: local,
        remoteTracks: new Map(),
      }),
    ).toEqual({ sessionId: 'yo', track: local });
  });
});
