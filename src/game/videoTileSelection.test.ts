import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_VIDEO_TILES,
  selectVideoTiles,
  videoTileCapacity,
  type VideoTileCandidate,
} from './videoTileSelection';

function peers(count: number, overrides: Record<string, Partial<VideoTileCandidate>> = {}): VideoTileCandidate[] {
  return Array.from({ length: count }, (_, index) => {
    const sessionId = `p${String(index).padStart(2, '0')}`;
    return { sessionId, hasVideo: false, speaking: false, ...overrides[sessionId] };
  });
}

describe('videoTileCapacity (#280)', () => {
  it('row: two rows of as many 264px tiles as fit the width, capped at 16', () => {
    // 1920 - 24 margin = 1896; (1896 + 8 gap) / 272 = 7 per row.
    expect(videoTileCapacity({ layout: 'row', viewportWidth: 1920, viewportHeight: 1080 })).toBe(14);
    expect(videoTileCapacity({ layout: 'row', viewportWidth: 1024, viewportHeight: 768 })).toBe(6);
    expect(videoTileCapacity({ layout: 'row', viewportWidth: 3840, viewportHeight: 2160 })).toBe(
      DEFAULT_MAX_VIDEO_TILES,
    );
  });

  it('column: as many 148.5px tiles as fit between the top margin and the bottom bar', () => {
    // 1080 - 12 top - 137 bottom = 931; (931 + 8) / 156.5 = 6.
    expect(videoTileCapacity({ layout: 'column', viewportWidth: 1920, viewportHeight: 1080 })).toBe(6);
    expect(videoTileCapacity({ layout: 'column', viewportWidth: 1920, viewportHeight: 4000 })).toBe(
      DEFAULT_MAX_VIDEO_TILES,
    );
  });

  it('never below one tile, even on a tiny screen', () => {
    expect(videoTileCapacity({ layout: 'row', viewportWidth: 200, viewportHeight: 200 })).toBe(1);
    expect(videoTileCapacity({ layout: 'column', viewportWidth: 200, viewportHeight: 200 })).toBe(1);
  });

  it('honours a lower explicit maximum', () => {
    expect(videoTileCapacity({ layout: 'row', viewportWidth: 1920, viewportHeight: 1080, max: 4 })).toBe(4);
  });
});

describe('selectVideoTiles (#280)', () => {
  it('everyone fits: every candidate in the given order, nobody hidden', () => {
    const result = selectVideoTiles(peers(3), 5, []);
    expect(result).toEqual({ visible: ['p00', 'p01', 'p02'], hiddenCount: 0 });
  });

  it('cameras at the end of the list still win the visible slots, one slot left for the counter', () => {
    const candidates = peers(50, { p47: { hasVideo: true }, p48: { hasVideo: true }, p49: { hasVideo: true } });
    const result = selectVideoTiles(candidates, 6, []);
    // 6 slots with overflow: 5 tiles + the "+N" counter.
    expect(result.visible).toHaveLength(5);
    expect(result.visible).toEqual(expect.arrayContaining(['p47', 'p48', 'p49']));
    expect(result.hiddenCount).toBe(45);
  });

  it('a pinned candidate (the own tile) is always first and visible', () => {
    const candidates: VideoTileCandidate[] = [
      { sessionId: 'yo', hasVideo: false, speaking: false, pinned: true },
      ...peers(10, { p09: { hasVideo: true } }),
    ];
    const result = selectVideoTiles(candidates, 3, []);
    expect(result.visible[0]).toBe('yo');
    expect(result.visible).toContain('p09');
    expect(result.visible).toHaveLength(2);
  });

  it('a speaker without camera takes the slot of a silent one without camera', () => {
    const first = selectVideoTiles(peers(10), 4, []);
    expect(first.visible).toEqual(['p00', 'p01', 'p02']);

    const second = selectVideoTiles(peers(10, { p07: { speaking: true } }), 4, first.visible);
    expect(second.visible).toHaveLength(3);
    expect(second.visible).toContain('p07');
  });

  it('a replacement keeps everyone else in their slot (no full reorder)', () => {
    const first = selectVideoTiles(peers(10), 5, []);
    const second = selectVideoTiles(peers(10, { p08: { speaking: true } }), 5, first.visible);
    const replaced = first.visible.findIndex((id) => !second.visible.includes(id));
    expect(second.visible[replaced]).toBe('p08');
    second.visible.forEach((id, index) => {
      if (index !== replaced) expect(id).toBe(first.visible[index]);
    });
  });

  it('a speaker who goes quiet stays visible until someone with more priority needs the slot', () => {
    const speaking = selectVideoTiles(peers(10, { p07: { speaking: true } }), 4, ['p00', 'p01', 'p02']);
    const quiet = selectVideoTiles(peers(10), 4, speaking.visible);
    expect(quiet.visible).toEqual(speaking.visible);
  });

  it('a speaker never displaces a camera', () => {
    const cameras = { p00: { hasVideo: true }, p01: { hasVideo: true }, p02: { hasVideo: true } };
    const result = selectVideoTiles(peers(10, { ...cameras, p09: { speaking: true } }), 4, []);
    expect(result.visible).toEqual(['p00', 'p01', 'p02']);
  });

  it('a camera displaces a visible speaker without camera', () => {
    const previous = ['p00', 'p01', 'p02'];
    const result = selectVideoTiles(
      peers(10, { p00: { hasVideo: true }, p01: { speaking: true }, p02: { hasVideo: true }, p09: { hasVideo: true } }),
      4,
      previous,
    );
    expect(result.visible).toEqual(['p00', 'p09', 'p02']);
  });

  it('drops visible candidates that left and refills from the hidden ones', () => {
    const result = selectVideoTiles(peers(10).filter((peer) => peer.sessionId !== 'p01'), 4, ['p00', 'p01', 'p02']);
    expect(result.visible).toEqual(['p00', 'p02', 'p03']);
    expect(result.hiddenCount).toBe(6);
  });

  it('when the capacity shrinks, the lowest priority leave first', () => {
    const result = selectVideoTiles(
      peers(10, { p00: { hasVideo: true }, p03: { hasVideo: true } }),
      3,
      ['p00', 'p01', 'p02', 'p03'],
    );
    expect(result.visible).toEqual(['p00', 'p03']);
  });

  it('applied to its own output it is a fixed point', () => {
    const candidates = peers(30, { p20: { hasVideo: true }, p25: { speaking: true } });
    const first = selectVideoTiles(candidates, 7, []);
    expect(selectVideoTiles(candidates, 7, first.visible)).toEqual(first);
  });
});
