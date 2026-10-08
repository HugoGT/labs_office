import { describe, expect, it } from 'vitest';
import { DOUBLE_CLICK_MS, DOUBLE_CLICK_PX, registerClick, type ClickSample } from './doubleClick';

const at = (time: number, x = 100, y = 100): ClickSample => ({ time, x, y });

describe('registerClick (double-click-pathfinding, R1)', () => {
  it('exposes the 300 ms window and the 8 screen px tolerance', () => {
    expect(DOUBLE_CLICK_MS).toBe(300);
    expect(DOUBLE_CLICK_PX).toBe(8);
  });

  it('stores the first click and does not fire', () => {
    expect(registerClick(null, at(1000))).toEqual({ fired: false, pending: at(1000) });
  });

  it('fires on a second click in the window and clears the pair', () => {
    const first = registerClick(null, at(1000));
    expect(registerClick(first.pending, at(1150))).toEqual({ fired: true, pending: null });
  });

  it.each([
    { gap: 0, fired: true },
    { gap: 299, fired: true },
    { gap: 300, fired: true },
    { gap: 301, fired: false },
    { gap: 1000, fired: false },
  ])('a second click $gap ms later fires: $fired', ({ gap, fired }) => {
    expect(registerClick(at(1000), at(1000 + gap)).fired).toBe(fired);
  });

  it.each([
    { dx: 0, dy: 0, fired: true },
    { dx: 8, dy: 0, fired: true },
    { dx: -8, dy: 0, fired: true },
    { dx: 0, dy: 8, fired: true },
    { dx: 5, dy: 6, fired: true },
    { dx: 9, dy: 0, fired: false },
    { dx: 0, dy: -9, fired: false },
    { dx: 6, dy: 6, fired: false },
  ])('a second click ($dx, $dy) px away fires: $fired', ({ dx, dy, fired }) => {
    expect(registerClick(at(1000, 100, 100), at(1100, 100 + dx, 100 + dy)).fired).toBe(fired);
  });

  it('a slow or distant second click becomes the new first click', () => {
    expect(registerClick(at(1000), at(1301))).toEqual({ fired: false, pending: at(1301) });
    expect(registerClick(at(1000, 100, 100), at(1100, 140, 100))).toEqual({
      fired: false,
      pending: at(1100, 140, 100),
    });
  });

  it('a third click right after a fired pair does not chain, and starts a new pair', () => {
    const first = registerClick(null, at(1000));
    const second = registerClick(first.pending, at(1100));
    expect(second.fired).toBe(true);
    const third = registerClick(second.pending, at(1200));
    expect(third).toEqual({ fired: false, pending: at(1200) });
    expect(registerClick(third.pending, at(1250)).fired).toBe(true);
  });

  it('never fires with a clock that went backwards', () => {
    expect(registerClick(at(1000), at(900))).toEqual({ fired: false, pending: at(900) });
  });

  it.each([
    { name: 'NaN x', click: { time: 1100, x: NaN, y: 100 } },
    { name: 'infinite y', click: { time: 1100, x: 100, y: Infinity } },
    { name: 'NaN time', click: { time: NaN, x: 100, y: 100 } },
  ])('never fires with $name', ({ click }) => {
    expect(registerClick(at(1000), click).fired).toBe(false);
  });
});
