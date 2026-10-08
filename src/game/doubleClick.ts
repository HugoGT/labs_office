/**
 * Pure double-click detector for click-to-walk (#2). `OfficeScene` feeds it
 * every eligible map click with the game clock and SCREEN coordinates, so the
 * rule neither depends on Phaser nor drifts when the camera glides or zooms
 * between the two clicks. Touch follows the same rule.
 */

/** Longest gap between the two clicks of a pair, inclusive. */
export const DOUBLE_CLICK_MS = 300;
/** Longest distance in screen px between the two clicks of a pair, inclusive. */
export const DOUBLE_CLICK_PX = 8;

export interface ClickSample {
  /** Game clock in ms (`scene.time.now`), injected so tests drive it. */
  time: number;
  /** Screen coordinates, never world ones. */
  x: number;
  y: number;
}

export interface ClickRegistration {
  /** True when `click` completed a pair. */
  fired: boolean;
  /** The click waiting for a partner; `null` right after a pair fired. */
  pending: ClickSample | null;
}

/**
 * A pair fires when the second click lands 0..`DOUBLE_CLICK_MS` after the first
 * and within `DOUBLE_CLICK_PX` of it. The record clears once it fires, so a
 * third click starts a new pair instead of chaining; any other click becomes
 * the new first click. Comparisons are written so NaN never fires.
 */
export function registerClick(pending: ClickSample | null, click: ClickSample): ClickRegistration {
  if (pending) {
    const elapsed = click.time - pending.time;
    const distance = Math.hypot(click.x - pending.x, click.y - pending.y);
    if (elapsed >= 0 && elapsed <= DOUBLE_CLICK_MS && distance <= DOUBLE_CLICK_PX) {
      return { fired: true, pending: null };
    }
  }
  return { fired: false, pending: click };
}
