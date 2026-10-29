import { describe, expect, it } from 'vitest';
import { HOLD_TO_MOVE_MS, PressHold } from './pressHold';

describe('PressHold: a press held long enough, or dragged, becomes a move', () => {
  it('is due after 50ms: a click held at all grabs the item', () => {
    expect(HOLD_TO_MOVE_MS).toBe(50);
  });

  it('is due once the press has been held for HOLD_TO_MOVE_MS, and only once', () => {
    const hold = new PressHold<string>();
    hold.start('desk-1', 1000);

    expect(hold.due(1000 + HOLD_TO_MOVE_MS - 1)).toBeNull();
    expect(hold.due(1000 + HOLD_TO_MOVE_MS)).toBe('desk-1');
    expect(hold.due(1000 + HOLD_TO_MOVE_MS + 500)).toBeNull();
  });

  it('a cancelled press never comes due', () => {
    const hold = new PressHold<number>();
    hold.start(7, 0);
    hold.cancel();

    expect(hold.due(HOLD_TO_MOVE_MS * 2)).toBeNull();
  });

  it('a drag takes the press at once, before it is due, and only once', () => {
    const hold = new PressHold<string>();
    expect(hold.take()).toBeNull();
    hold.start('desk-1', 0);

    expect(hold.take()).toBe('desk-1');
    expect(hold.take()).toBeNull();
    expect(hold.due(HOLD_TO_MOVE_MS)).toBeNull();
  });

  it('a new press starts the count again, for its own target', () => {
    const hold = new PressHold<string>();
    hold.start('a', 0);
    hold.start('b', 30);

    expect(hold.due(HOLD_TO_MOVE_MS)).toBeNull();
    expect(hold.due(30 + HOLD_TO_MOVE_MS)).toBe('b');
  });
});
