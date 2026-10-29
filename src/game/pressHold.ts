/**
 * A press held on a selectable thing grabs it: the desk and room editor's and
 * the decor editor's drag it until the release puts it down. Pure, on an
 * injected clock: the layers start it on the press, take it at once on a
 * drag, cancel it on an early release, and ask on each frame whether it is due.
 */

/** A press held this long grabs: a quick click still selects, a held one drags at once. */
export const HOLD_TO_MOVE_MS = 50;

export class PressHold<T> {
  private held: { target: T; since: number } | null = null;

  start(target: T, now: number): void {
    this.held = { target, since: now };
  }

  cancel(): void {
    this.held = null;
  }

  /** The target of the press now, held or not, then never again: a drag does not wait. */
  take(): T | null {
    const held = this.held;
    this.held = null;
    return held?.target ?? null;
  }

  /** The target of the press once it has been held for `HOLD_TO_MOVE_MS`, then never again. */
  due(now: number): T | null {
    const held = this.held;
    if (held === null || now - held.since < HOLD_TO_MOVE_MS) return null;
    this.held = null;
    return held.target;
  }
}
