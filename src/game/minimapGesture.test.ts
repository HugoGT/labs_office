import { describe, expect, it } from 'vitest';
import { PAN_THRESHOLD_PX } from './cameraPan';
import { reduceMinimapGesture, type MinimapGestureEvent, type MinimapGestureState } from './minimapGesture';

function run(events: MinimapGestureEvent[], state: MinimapGestureState = { kind: 'idle' }) {
  const effects = [];
  for (const event of events) {
    const step = reduceMinimapGesture(state, event);
    state = step.state;
    effects.push(step.effect);
  }
  return { state, effects };
}

describe('reduceMinimapGesture', () => {
  it('a press and release without crossing the threshold is a click where it was pressed', () => {
    const { state, effects } = run([
      { kind: 'down', x: 10, y: 20 },
      { kind: 'move', x: 12, y: 21 },
      { kind: 'up' },
    ]);

    expect(effects).toEqual([{ kind: 'none' }, { kind: 'none' }, { kind: 'click', x: 10, y: 20 }]);
    expect(state).toEqual({ kind: 'idle' });
  });

  it('crossing the threshold drags: the first scroll is the whole delta, then each move', () => {
    const { effects } = run([
      { kind: 'down', x: 10, y: 20 },
      { kind: 'move', x: 10, y: 20 + PAN_THRESHOLD_PX + 1 },
      { kind: 'move', x: 13, y: 40 },
    ]);

    expect(effects.slice(1)).toEqual([
      { kind: 'scroll', dx: 0, dy: PAN_THRESHOLD_PX + 1 },
      { kind: 'scroll', dx: 3, dy: 40 - (20 + PAN_THRESHOLD_PX + 1) },
    ]);
  });

  it('releasing a drag is not a click, even back over its origin', () => {
    const { state, effects } = run([
      { kind: 'down', x: 10, y: 20 },
      { kind: 'move', x: 10, y: 60 },
      { kind: 'move', x: 10, y: 20 },
      { kind: 'up' },
    ]);

    expect(effects.at(-1)).toEqual({ kind: 'none' });
    expect(state).toEqual({ kind: 'idle' });
  });

  it('a release outside the canvas cancels a press without clicking', () => {
    const { state, effects } = run([{ kind: 'down', x: 10, y: 20 }, { kind: 'cancel' }]);

    expect(effects).toEqual([{ kind: 'none' }, { kind: 'none' }]);
    expect(state).toEqual({ kind: 'idle' });
  });

  it('moves and releases with no press on the minimap do nothing', () => {
    const { effects } = run([{ kind: 'move', x: 100, y: 100 }, { kind: 'up' }, { kind: 'cancel' }]);

    expect(effects).toEqual([{ kind: 'none' }, { kind: 'none' }, { kind: 'none' }]);
  });

  it('a second press mid-gesture keeps the first origin', () => {
    const { effects } = run([
      { kind: 'down', x: 10, y: 20 },
      { kind: 'down', x: 50, y: 50 },
      { kind: 'up' },
    ]);

    expect(effects.at(-1)).toEqual({ kind: 'click', x: 10, y: 20 });
  });
});
