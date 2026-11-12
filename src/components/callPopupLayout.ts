/**
 * Pure layout of the call popup (#320): which tiles it shows, how they are
 * arranged and how big they are, for a window of a given size. React and CSS
 * only draw what this decides, so every rule can be tested without a browser.
 *
 * The window is a narrow column by default, as small as its content: two
 * people need two tiles, the status pill and the controls. It grows in height
 * with every extra person up to `MAX_CAMERA_TILES`, or one camera less and a
 * shared screen. Widened by the user, the tiles grow up to `MAX_TILE_WIDTH`,
 * and from `GRID_MIN_WIDTH` several cameras form a two column grid. A shared
 * screen, or a face the user clicked, takes the foreground like in a meeting
 * and the other tiles go in a strip on its left.
 */

/** Stands for the shared screen among the session ids of the cameras. */
export const SCREEN_TILE_ID = '@screen';

export const POPUP_PADDING = 8;
export const TILE_GAP = 8;
/** Between the tiles area, the status pill and the controls bar. */
export const CHROME_GAP = 8;
export const CONTROLS_HEIGHT = 36;
export const PILL_HEIGHT = 26;
/** The "+N personas" line under the tiles. */
export const OVERFLOW_HEIGHT = 28;

export const MIN_TILE_WIDTH = 160;
export const MAX_TILE_WIDTH = 320;
/** The window two people fit in, and the wider one a foreground asks for. */
export const POPUP_DEFAULT_WIDTH = 200;
export const STAGE_DEFAULT_WIDTH = 440;
/** From this width several cameras share a row, two by two. */
export const GRID_MIN_WIDTH = 440;
/** One or two cameras stay in a column: a grid of two would only be a wider window. */
export const GRID_MIN_TILES = 3;
/** Under this width the strip of a stage goes below the foreground, not beside it. */
export const STAGE_SIDE_MIN_WIDTH = 360;

/** Five tiles at most: five cameras, or four and the shared screen. */
export const MAX_CAMERA_TILES = 5;
export const MAX_CAMERA_TILES_WITH_SHARE = MAX_CAMERA_TILES - 1;

/** The strip of a stage takes this share of the width, within these bounds. */
const STRIP_RATIO = 0.3;
const MIN_STRIP_WIDTH = 88;
const MAX_STRIP_WIDTH = 160;
/** A window shorter than its content shrinks the tiles down to this fraction, then the content scrolls. */
const MIN_SCALE = 0.5;

export function tileHeightFor(width: number): number {
  return Math.round((width * 9) / 16);
}

/** Room for the controls bar and one tile, whatever the content asks. */
export const MIN_WINDOW_HEIGHT = 2 * POPUP_PADDING + CHROME_GAP + CONTROLS_HEIGHT + tileHeightFor(MIN_TILE_WIDTH);

export interface CallPopupPerson {
  sessionId: string;
  speaking: boolean;
}

export interface TileSize {
  width: number;
  height: number;
}

export interface CallPopupLayoutInput {
  /** Inner size of the popup window; a size not known yet (0) is not a limit. */
  width: number;
  height: number;
  /** Everyone in the space, in tile order. */
  people: readonly CallPopupPerson[];
  hasShare: boolean;
  /** Only the installed app's window has the status pill, which takes room. */
  hasPill: boolean;
  /** The face the user clicked, if still there. */
  focusedId: string | null;
}

export interface CallPopupLayout {
  mode: 'column' | 'grid' | 'stage';
  /** The big one: `SCREEN_TILE_ID` or a session id. `null` outside the stage. */
  foreground: string | null;
  /** The face in the foreground, or `null` when the screen (or nothing) is. A dropped focus is `null` too. */
  focusedId: string | null;
  /** Everything else, in order: the column, the grid or the strip. */
  tiles: string[];
  /** People who did not fit: the "+N personas" line. */
  hiddenCount: number;
  tileSize: TileSize;
  foregroundSize: TileSize | null;
  columns: number;
  stripPlacement: 'left' | 'below' | null;
  /** Height of the tiles area at these sizes. */
  contentHeight: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function scaled(width: number, scale: number): TileSize {
  const scaledWidth = Math.max(1, Math.floor(width * scale));
  return { width: scaledWidth, height: tileHeightFor(scaledWidth) };
}

/** Everyone who speaks goes before everyone who does not; each group keeps its order. */
function speakersFirst(people: readonly CallPopupPerson[]): CallPopupPerson[] {
  return [...people.filter((person) => person.speaking), ...people.filter((person) => !person.speaking)];
}

interface Plan {
  mode: CallPopupLayout['mode'];
  foreground: string | null;
  focusedId: string | null;
  tiles: string[];
  hiddenCount: number;
}

function plan(input: CallPopupLayoutInput, width: number): Plan {
  const { people, hasShare } = input;
  const focusedId = input.focusedId !== null && people.some((person) => person.sessionId === input.focusedId) ? input.focusedId : null;
  const cap = hasShare ? MAX_CAMERA_TILES_WITH_SHARE : MAX_CAMERA_TILES;

  // The cap is exact: unlike `selectVideoTiles`, whose "+N" counter takes one of its slots, here
  // the counter is a line of its own, so five cameras are five cameras and the sixth is "+1".
  // Whoever the user brought to the foreground is always among the shown, even past the cap.
  const ordered = speakersFirst(people).map((person) => person.sessionId);
  const shown = ordered.slice(0, cap);
  if (focusedId !== null && !shown.includes(focusedId)) shown[shown.length - 1] = focusedId;
  const cameras = ordered.filter((id) => shown.includes(id));

  const foreground = focusedId ?? (hasShare ? SCREEN_TILE_ID : null);
  const tiles = [...(hasShare && foreground !== SCREEN_TILE_ID ? [SCREEN_TILE_ID] : []), ...cameras.filter((id) => id !== focusedId)];
  const mode = foreground !== null ? 'stage' : width >= GRID_MIN_WIDTH && cameras.length >= GRID_MIN_TILES ? 'grid' : 'column';
  return { mode, foreground, focusedId, tiles, hiddenCount: people.length - cameras.length };
}

interface Geometry {
  tileSize: TileSize;
  foregroundSize: TileSize | null;
  columns: number;
  stripPlacement: CallPopupLayout['stripPlacement'];
  contentHeight: number;
}

function geometry(chosen: Plan, width: number, scale: number): Geometry {
  const available = width - 2 * POPUP_PADDING;
  const count = chosen.tiles.length;
  const overflow = chosen.hiddenCount > 0 ? TILE_GAP + OVERFLOW_HEIGHT : 0;
  const stacked = (rows: number, tile: TileSize) => (rows > 0 ? rows * tile.height + (rows - 1) * TILE_GAP : 0);

  if (chosen.mode === 'stage') {
    if (count === 0) {
      const foregroundSize = scaled(available, scale);
      return { tileSize: foregroundSize, foregroundSize, columns: 1, stripPlacement: null, contentHeight: foregroundSize.height + overflow };
    }
    if (width >= STAGE_SIDE_MIN_WIDTH) {
      const tileSize = scaled(clamp(Math.round(available * STRIP_RATIO), MIN_STRIP_WIDTH, MAX_STRIP_WIDTH), scale);
      const stripHeight = stacked(count, tileSize) + overflow;
      const foregroundWidth = Math.max(1, Math.floor(available * scale) - tileSize.width - TILE_GAP);
      const foregroundHeight = Math.max(tileHeightFor(foregroundWidth), stripHeight);
      return {
        tileSize,
        foregroundSize: { width: foregroundWidth, height: foregroundHeight },
        columns: 1,
        stripPlacement: 'left',
        contentHeight: foregroundHeight,
      };
    }
    const foregroundSize = scaled(available, scale);
    const tileSize = scaled(Math.floor((available - TILE_GAP) / 2), scale);
    const rows = Math.ceil(count / 2);
    return {
      tileSize,
      foregroundSize,
      columns: 2,
      stripPlacement: 'below',
      contentHeight: foregroundSize.height + TILE_GAP + stacked(rows, tileSize) + overflow,
    };
  }

  if (chosen.mode === 'grid') {
    const tileSize = scaled(clamp(Math.floor((available - TILE_GAP) / 2), MIN_TILE_WIDTH, MAX_TILE_WIDTH), scale);
    return { tileSize, foregroundSize: null, columns: 2, stripPlacement: null, contentHeight: stacked(Math.ceil(count / 2), tileSize) + overflow };
  }

  const tileSize = scaled(clamp(available, MIN_TILE_WIDTH, MAX_TILE_WIDTH), scale);
  return { tileSize, foregroundSize: null, columns: 1, stripPlacement: null, contentHeight: stacked(count, tileSize) + overflow };
}

/** Room taken by everything that is not tiles: padding, the pill and the controls. */
function chromeHeight(hasPill: boolean): number {
  return 2 * POPUP_PADDING + CHROME_GAP + CONTROLS_HEIGHT + (hasPill ? CHROME_GAP + PILL_HEIGHT : 0);
}

export function layoutCallPopup(input: CallPopupLayoutInput): CallPopupLayout {
  const width = input.width > 0 ? input.width : POPUP_DEFAULT_WIDTH;
  const chosen = plan(input, width);
  let scale = 1;
  const room = input.height - chromeHeight(input.hasPill);
  if (input.height > 0 && geometry(chosen, width, 1).contentHeight > room) {
    // Largest scale that fits, found by bisection: gaps do not scale, so it is not a plain ratio.
    let low = MIN_SCALE;
    let high = 1;
    for (let step = 0; step < 12; step += 1) {
      const middle = (low + high) / 2;
      if (geometry(chosen, width, middle).contentHeight <= room) low = middle;
      else high = middle;
    }
    scale = geometry(chosen, width, low).contentHeight <= room ? low : MIN_SCALE;
  }
  return { ...chosen, ...geometry(chosen, width, scale) };
}

export interface DesiredPopupSizeInput extends Omit<CallPopupLayoutInput, 'width' | 'height'> {
  /** The width the window has, or `null` for the default its content asks for. */
  width: number | null;
}

/**
 * The window size that holds the content with no scrolling and no empty
 * space: the width it has (or the default of its mode), the height of its
 * tiles, the pill and the controls. Never under `MIN_WINDOW_HEIGHT`.
 */
export function desiredPopupSize(input: DesiredPopupSizeInput): TileSize {
  const probe = { ...input, width: input.width ?? POPUP_DEFAULT_WIDTH, height: 0 };
  const stage = plan(probe, probe.width).mode === 'stage';
  const width = input.width ?? (stage ? STAGE_DEFAULT_WIDTH : POPUP_DEFAULT_WIDTH);
  const { contentHeight } = layoutCallPopup({ ...probe, width });
  return { width, height: Math.max(MIN_WINDOW_HEIGHT, chromeHeight(input.hasPill) + contentHeight) };
}
