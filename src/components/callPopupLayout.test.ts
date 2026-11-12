import { describe, expect, it } from 'vitest';
import {
  CHROME_GAP,
  CONTROLS_HEIGHT,
  GRID_MIN_TILES,
  GRID_MIN_WIDTH,
  MAX_CAMERA_TILES,
  MAX_CAMERA_TILES_WITH_SHARE,
  MAX_TILE_WIDTH,
  MIN_TILE_WIDTH,
  MIN_WINDOW_HEIGHT,
  OVERFLOW_HEIGHT,
  PILL_HEIGHT,
  POPUP_DEFAULT_WIDTH,
  POPUP_PADDING,
  SCREEN_TILE_ID,
  STAGE_DEFAULT_WIDTH,
  STAGE_SIDE_MIN_WIDTH,
  TILE_GAP,
  desiredPopupSize,
  layoutCallPopup,
  tileHeightFor,
  type CallPopupLayoutInput,
} from './callPopupLayout';

function people(count: number, speaking: readonly string[] = []) {
  return Array.from({ length: count }, (_, index) => ({ sessionId: `p${index + 1}`, speaking: speaking.includes(`p${index + 1}`) }));
}

/** An unconstrained window (height 0 = not known) of the default width, unless told otherwise. */
function layout(overrides: Partial<CallPopupLayoutInput> & { count?: number } = {}) {
  const { count = 2, ...rest } = overrides;
  return layoutCallPopup({ width: POPUP_DEFAULT_WIDTH, height: 0, people: people(count), hasShare: false, hasPill: true, focusedId: null, ...rest });
}

describe('layoutCallPopup: a column that grows with the people (1)', () => {
  it('two people: both tiles, one under the other, no hidden', () => {
    const result = layout({ count: 2 });

    expect(result.mode).toBe('column');
    expect(result.foreground).toBeNull();
    expect(result.tiles).toEqual(['p1', 'p2']);
    expect(result.hiddenCount).toBe(0);
    expect(result.columns).toBe(1);
  });

  it('each tile takes the window width minus the padding, 16:9', () => {
    const { tileSize } = layout({ width: POPUP_DEFAULT_WIDTH });

    expect(tileSize.width).toBe(POPUP_DEFAULT_WIDTH - 2 * POPUP_PADDING);
    expect(tileSize.height).toBe(tileHeightFor(tileSize.width));
  });

  it('grows in height with every extra person, up to five cameras', () => {
    const heights = [1, 2, 3, 4, 5].map((count) => layout({ count }).contentHeight);

    expect(heights).toEqual([...heights].sort((a, b) => a - b));
    expect(new Set(heights).size).toBe(5);
    const { tileSize } = layout({ count: 2 });
    expect(layout({ count: 3 }).contentHeight - layout({ count: 2 }).contentHeight).toBe(tileSize.height + TILE_GAP);
  });

  it('shows at most five cameras and counts the rest', () => {
    const result = layout({ count: 8 });

    expect(result.tiles).toHaveLength(MAX_CAMERA_TILES);
    expect(result.hiddenCount).toBe(3);
  });

  it('adds the height of the "+N personas" line when someone is hidden', () => {
    const five = layout({ count: 5 });
    const six = layout({ count: 6 });

    expect(six.contentHeight - five.contentHeight).toBe(TILE_GAP + OVERFLOW_HEIGHT);
  });

  it('hides the people who are not speaking first', () => {
    const result = layout({ count: 7, people: people(7, ['p7', 'p6']) });

    expect(result.tiles.slice(0, 2)).toEqual(['p6', 'p7']);
    expect(result.tiles).toHaveLength(5);
    expect(result.hiddenCount).toBe(2);
  });

  it('puts the speakers first and keeps the order of everyone else', () => {
    const result = layout({ count: 4, people: people(4, ['p3']) });

    expect(result.tiles).toEqual(['p3', 'p1', 'p2', 'p4']);
  });
});

describe('layoutCallPopup: wider windows (2)', () => {
  it('lets the tiles grow with the width', () => {
    const narrow = layout({ width: 220 }).tileSize.width;
    const wider = layout({ width: 300 }).tileSize.width;

    expect(wider).toBeGreaterThan(narrow);
  });

  it('stops growing at the maximum tile width', () => {
    const result = layout({ width: 2000, count: 2 });

    expect(result.tileSize.width).toBe(MAX_TILE_WIDTH);
    expect(result.tileSize.height).toBe(tileHeightFor(MAX_TILE_WIDTH));
  });

  it('never goes under the minimum tile width, even in a window narrower than it', () => {
    expect(layout({ width: 40 }).tileSize.width).toBe(MIN_TILE_WIDTH);
  });

  it('lays out four cameras as a 2x2 grid from the width threshold', () => {
    const result = layout({ width: GRID_MIN_WIDTH, count: 4 });

    expect(result.mode).toBe('grid');
    expect(result.columns).toBe(2);
    expect(result.tiles).toHaveLength(4);
    const { tileSize } = result;
    expect(result.contentHeight).toBe(2 * tileSize.height + TILE_GAP);
    expect(2 * tileSize.width + TILE_GAP).toBeLessThanOrEqual(GRID_MIN_WIDTH - 2 * POPUP_PADDING);
  });

  it('keeps the column one pixel under the threshold', () => {
    expect(layout({ width: GRID_MIN_WIDTH - 1, count: 4 }).mode).toBe('column');
  });

  it('keeps few cameras in a column however wide the window is', () => {
    expect(layout({ width: 2000, count: GRID_MIN_TILES - 1 }).mode).toBe('column');
  });

  it('caps grid tiles at the maximum tile width too', () => {
    expect(layout({ width: 4000, count: 4 }).tileSize.width).toBe(MAX_TILE_WIDTH);
  });
});

describe('layoutCallPopup: a shared screen takes the foreground (3)', () => {
  it('puts the screen in the foreground and the cameras in a column on the left', () => {
    const result = layout({ width: STAGE_SIDE_MIN_WIDTH, count: 3, hasShare: true });

    expect(result.mode).toBe('stage');
    expect(result.foreground).toBe(SCREEN_TILE_ID);
    expect(result.tiles).toEqual(['p1', 'p2', 'p3']);
    expect(result.stripPlacement).toBe('left');
    expect(result.foregroundSize).not.toBeNull();
  });

  it('counts the screen as one of the five tiles: four cameras and the screen', () => {
    const result = layout({ width: STAGE_SIDE_MIN_WIDTH, count: 7, hasShare: true });

    expect(result.tiles).toHaveLength(MAX_CAMERA_TILES_WITH_SHARE);
    expect(MAX_CAMERA_TILES_WITH_SHARE + 1).toBe(MAX_CAMERA_TILES);
    expect(result.hiddenCount).toBe(3);
  });

  it('stacks the cameras under the screen when the window is too narrow for a side column', () => {
    const result = layout({ width: STAGE_SIDE_MIN_WIDTH - 1, count: 3, hasShare: true });

    expect(result.mode).toBe('stage');
    expect(result.stripPlacement).toBe('below');
  });

  it('makes the strip tiles narrower than the foreground, and the foreground taller than the strip needs', () => {
    const result = layout({ width: 600, count: 4, hasShare: true });
    const stripHeight = 4 * result.tileSize.height + 3 * TILE_GAP;

    expect(result.foregroundSize!.width).toBeGreaterThan(result.tileSize.width);
    expect(result.foregroundSize!.height).toBeGreaterThanOrEqual(stripHeight);
    expect(result.contentHeight).toBe(result.foregroundSize!.height);
  });

  it('has no strip when the sharer is alone', () => {
    const result = layout({ width: 600, count: 0, hasShare: true });

    expect(result.tiles).toEqual([]);
    expect(result.stripPlacement).toBeNull();
    expect(result.foregroundSize!.width).toBe(600 - 2 * POPUP_PADDING);
  });
});

describe('layoutCallPopup: a clicked face takes the foreground (3)', () => {
  it('brings the person to the foreground and the rest to the column on the left', () => {
    const result = layout({ width: 600, count: 3, focusedId: 'p2' });

    expect(result.mode).toBe('stage');
    expect(result.foreground).toBe('p2');
    expect(result.tiles).toEqual(['p1', 'p3']);
    expect(result.stripPlacement).toBe('left');
  });

  it('with a share going on, the face wins the foreground and the screen joins the column first', () => {
    const result = layout({ width: 600, count: 3, hasShare: true, focusedId: 'p2' });

    expect(result.foreground).toBe('p2');
    expect(result.tiles).toEqual([SCREEN_TILE_ID, 'p1', 'p3']);
  });

  it('without a focus the screen has the foreground again', () => {
    expect(layout({ width: 600, count: 3, hasShare: true, focusedId: null }).foreground).toBe(SCREEN_TILE_ID);
  });

  it('drops a focus whose person left', () => {
    const result = layout({ width: 600, count: 2, focusedId: 'gone' });

    expect(result.mode).toBe('column');
    expect(result.foreground).toBeNull();
    expect(result.focusedId).toBeNull();
  });

  it('keeps a focused person visible even beyond the camera cap', () => {
    const result = layout({ width: 600, count: 9, focusedId: 'p9' });

    expect(result.foreground).toBe('p9');
    expect(result.tiles).toHaveLength(MAX_CAMERA_TILES - 1);
    expect(result.tiles).not.toContain('p9');
    expect(result.hiddenCount).toBe(4);
  });

  it('keeps the cap at four cameras plus the screen when a face is foregrounded during a share', () => {
    const result = layout({ width: 600, count: 9, hasShare: true, focusedId: 'p9' });

    // The foreground face, the three other cameras and the screen: five tiles.
    expect(result.tiles).toHaveLength(MAX_CAMERA_TILES_WITH_SHARE);
    expect(result.tiles[0]).toBe(SCREEN_TILE_ID);
    expect(result.hiddenCount).toBe(5);
  });
});

describe('layoutCallPopup: a window of any height (5)', () => {
  const chrome = 2 * POPUP_PADDING + CHROME_GAP + CONTROLS_HEIGHT + CHROME_GAP + PILL_HEIGHT;

  it('keeps the natural size when the window is tall enough', () => {
    const natural = layout({ count: 4 });
    const tall = layout({ count: 4, height: natural.contentHeight + chrome + 200 });

    expect(tall.tileSize).toEqual(natural.tileSize);
  });

  it('shrinks the tiles, keeping 16:9, when the window is shorter than the content', () => {
    const natural = layout({ count: 4 });
    const short = layout({ count: 4, height: natural.contentHeight + chrome - 100 });

    expect(short.tileSize.width).toBeLessThan(natural.tileSize.width);
    expect(short.contentHeight).toBeLessThanOrEqual(natural.contentHeight - 100 + 4);
    expect(Math.abs(short.tileSize.width / short.tileSize.height - 16 / 9)).toBeLessThan(0.1);
  });

  it('stops shrinking at a floor and leaves the rest to scrolling', () => {
    const tiny = layout({ count: 5, height: chrome + 10 });

    expect(tiny.tileSize.width).toBeGreaterThan(0);
    expect(tiny.tileSize.width).toBeGreaterThanOrEqual(Math.floor(layout({ count: 5 }).tileSize.width * 0.5));
  });

  it('does not count the pill when the window has none', () => {
    const natural = layout({ count: 4, hasPill: false });
    const short = layout({ count: 4, hasPill: false, height: natural.contentHeight + 2 * POPUP_PADDING + CHROME_GAP + CONTROLS_HEIGHT });

    expect(short.tileSize).toEqual(natural.tileSize);
  });
});

describe('desiredPopupSize: the window the content asks for (1, 5)', () => {
  it('two people: just enough for two tiles, the pill and the controls', () => {
    const size = desiredPopupSize({ width: null, people: people(2), hasShare: false, hasPill: true, focusedId: null });
    const { tileSize } = layout({ count: 2 });

    expect(size.width).toBe(POPUP_DEFAULT_WIDTH);
    expect(size.height).toBe(
      2 * POPUP_PADDING + 2 * tileSize.height + TILE_GAP + CHROME_GAP + PILL_HEIGHT + CHROME_GAP + CONTROLS_HEIGHT,
    );
  });

  it('is shorter without the pill, by the pill and its gap', () => {
    const base = { width: null, people: people(2), hasShare: false, focusedId: null };

    expect(desiredPopupSize({ ...base, hasPill: true }).height - desiredPopupSize({ ...base, hasPill: false }).height).toBe(
      PILL_HEIGHT + CHROME_GAP,
    );
  });

  it('grows with the people', () => {
    const heightFor = (count: number) =>
      desiredPopupSize({ width: null, people: people(count), hasShare: false, hasPill: true, focusedId: null }).height;

    expect(heightFor(3)).toBeGreaterThan(heightFor(2));
    expect(heightFor(5)).toBeGreaterThan(heightFor(4));
    expect(heightFor(9)).toBeGreaterThan(heightFor(5));
  });

  it('asks for the wide default when a screen or a face is in the foreground', () => {
    const base = { width: null, people: people(3), hasPill: true };

    expect(desiredPopupSize({ ...base, hasShare: true, focusedId: null }).width).toBe(STAGE_DEFAULT_WIDTH);
    expect(desiredPopupSize({ ...base, hasShare: false, focusedId: 'p1' }).width).toBe(STAGE_DEFAULT_WIDTH);
  });

  it('keeps the width it is given and only changes the height', () => {
    const size = desiredPopupSize({ width: 333, people: people(3), hasShare: false, hasPill: true, focusedId: null });

    expect(size.width).toBe(333);
  });

  it('never goes under the room for the controls bar and one tile', () => {
    const size = desiredPopupSize({ width: null, people: [], hasShare: false, hasPill: false, focusedId: null });

    expect(size.height).toBe(MIN_WINDOW_HEIGHT);
    expect(MIN_WINDOW_HEIGHT).toBeGreaterThan(CONTROLS_HEIGHT + 2 * POPUP_PADDING);
  });
});
