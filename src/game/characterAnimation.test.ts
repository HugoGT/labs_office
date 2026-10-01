import { describe, expect, it } from 'vitest';
import { CHARACTER_SEATED, CHARACTER_WALK, WALK_DIRECTIONS } from './artContract';
import {
  SEAT_TRANSITION_FRAME_MS,
  SEATED_IDLE_FRAME_MS,
  WALK_FRAME_MS,
  WALK_GRACE_MS,
  animationFrame,
  initialAnimation,
  seatedFrame,
  stepAnimation,
  walkDirectionFrom,
  walkFrame,
  type CharacterAnimation,
} from './characterAnimation';

const STILL = { dx: 0, dy: 0 };

function run(state: CharacterAnimation, steps: number, input: Partial<Parameters<typeof stepAnimation>[1]> = {}) {
  let next = state;
  for (let i = 0; i < steps; i++) {
    next = stepAnimation(next, { dx: 0, dy: 0, dtMs: 16, seatFacing: null, ...input });
  }
  return next;
}

describe('walkDirectionFrom: eight directions from movement', () => {
  it('maps each octant of screen space (y grows down) to its walk row', () => {
    expect(walkDirectionFrom(0, 1, 'N')).toBe('S');
    expect(walkDirectionFrom(1, 1, 'N')).toBe('SE');
    expect(walkDirectionFrom(1, 0, 'N')).toBe('E');
    expect(walkDirectionFrom(1, -1, 'S')).toBe('NE');
    expect(walkDirectionFrom(0, -1, 'S')).toBe('N');
    expect(walkDirectionFrom(-1, -1, 'S')).toBe('NW');
    expect(walkDirectionFrom(-1, 0, 'S')).toBe('W');
    expect(walkDirectionFrom(-1, 1, 'N')).toBe('SW');
  });

  it('uses the angle, not the signs, so a shallow diagonal stays on its axis', () => {
    expect(walkDirectionFrom(10, 2, 'S')).toBe('E');
    expect(walkDirectionFrom(2, -10, 'S')).toBe('N');
  });

  it('keeps the previous direction when there is no movement', () => {
    expect(walkDirectionFrom(0, 0, 'NW')).toBe('NW');
    expect(walkDirectionFrom(0.001, 0, 'NW')).toBe('NW');
  });
});

describe('frame indices: walk order and seated order are separate', () => {
  it('walk frames follow the 8-direction rows of the walk sheet', () => {
    expect(walkFrame('S', 0)).toBe(0);
    expect(walkFrame('S', 'idle')).toBe(CHARACTER_WALK.idleColumn);
    expect(walkFrame('N', 3)).toBe(WALK_DIRECTIONS.indexOf('N') * CHARACTER_WALK.columns + 3);
    expect(walkFrame('SW', 9)).toBe(7 * 11 + 9);
  });

  it('seated frames follow the pack facing order (up, down, left, right), not the office order', () => {
    expect(seatedFrame('up', 0)).toBe(0);
    expect(seatedFrame('down', 0)).toBe(CHARACTER_SEATED.columns);
    expect(seatedFrame('left', 6)).toBe(2 * 8 + 6);
    expect(seatedFrame('right', 7)).toBe(3 * 8 + 7);
  });
});

describe('stepAnimation: walking', () => {
  it('starts idle, looking where it was told', () => {
    expect(animationFrame(initialAnimation('E'))).toEqual({ sheet: 'walk', frame: walkFrame('E', 'idle') });
  });

  it('steps through the ten walk columns while moving, in the direction of travel', () => {
    let state = initialAnimation('S');
    state = stepAnimation(state, { dx: 3, dy: 0, dtMs: 1, seatFacing: null });
    expect(animationFrame(state)).toEqual({ sheet: 'walk', frame: walkFrame('E', 0) });
    state = stepAnimation(state, { dx: 3, dy: 0, dtMs: WALK_FRAME_MS, seatFacing: null });
    expect(animationFrame(state).frame).toBe(walkFrame('E', 1));
    state = stepAnimation(state, { dx: 3, dy: 0, dtMs: WALK_FRAME_MS * 9, seatFacing: null });
    expect(animationFrame(state).frame).toBe(walkFrame('E', 0));
  });

  it('keeps stepping through a short gap between network updates, then goes idle', () => {
    let state = stepAnimation(initialAnimation('S'), { dx: 0, dy: -2, dtMs: 16, seatFacing: null });
    state = stepAnimation(state, { ...STILL, dtMs: WALK_GRACE_MS - 1, seatFacing: null });
    expect(animationFrame(state).frame).not.toBe(walkFrame('N', 'idle'));
    state = stepAnimation(state, { ...STILL, dtMs: 2, seatFacing: null });
    expect(animationFrame(state)).toEqual({ sheet: 'walk', frame: walkFrame('N', 'idle') });
  });

  it('turns to a facing without walking', () => {
    const state = stepAnimation(initialAnimation('S'), { ...STILL, dtMs: 16, seatFacing: null, turnTo: 'left' });
    expect(animationFrame(state)).toEqual({ sheet: 'walk', frame: walkFrame('W', 'idle') });
  });
});

describe('stepAnimation: sitting and standing', () => {
  it('plays the six sit-down columns, then loops the two seated idle columns', () => {
    let state = stepAnimation(initialAnimation('S'), { ...STILL, dtMs: 16, seatFacing: 'left' });
    expect(animationFrame(state)).toEqual({ sheet: 'seated', frame: seatedFrame('left', 0) });
    state = stepAnimation(state, { ...STILL, dtMs: SEAT_TRANSITION_FRAME_MS * 3, seatFacing: 'left' });
    expect(animationFrame(state).frame).toBe(seatedFrame('left', 3));
    state = stepAnimation(state, { ...STILL, dtMs: SEAT_TRANSITION_FRAME_MS * 3, seatFacing: 'left' });
    expect(animationFrame(state).frame).toBe(seatedFrame('left', 6));
    state = stepAnimation(state, { ...STILL, dtMs: SEATED_IDLE_FRAME_MS, seatFacing: 'left' });
    expect(animationFrame(state).frame).toBe(seatedFrame('left', 7));
    state = stepAnimation(state, { ...STILL, dtMs: SEATED_IDLE_FRAME_MS, seatFacing: 'left' });
    expect(animationFrame(state).frame).toBe(seatedFrame('left', 6));
  });

  it('ignores the jump onto the seat: movement while seated does not walk', () => {
    const state = stepAnimation(initialAnimation('S'), { dx: 40, dy: -12, dtMs: 16, seatFacing: 'up' });
    expect(animationFrame(state).sheet).toBe('seated');
  });

  it('plays the sit-down columns backwards to stand up, then idles looking the way the seat faced', () => {
    let state = run(initialAnimation('S'), 40, { seatFacing: 'right' });
    state = stepAnimation(state, { ...STILL, dtMs: 16, seatFacing: null });
    expect(animationFrame(state)).toEqual({ sheet: 'seated', frame: seatedFrame('right', 5) });
    state = stepAnimation(state, { ...STILL, dtMs: SEAT_TRANSITION_FRAME_MS * 5, seatFacing: null });
    expect(animationFrame(state).frame).toBe(seatedFrame('right', 0));
    state = stepAnimation(state, { ...STILL, dtMs: SEAT_TRANSITION_FRAME_MS, seatFacing: null });
    expect(animationFrame(state)).toEqual({ sheet: 'walk', frame: walkFrame('E', 'idle') });
  });

  it('walking away cuts the stand-up short', () => {
    let state = run(initialAnimation('S'), 40, { seatFacing: 'up' });
    state = stepAnimation(state, { dx: -4, dy: 0, dtMs: 16, seatFacing: null });
    expect(animationFrame(state)).toEqual({ sheet: 'walk', frame: walkFrame('W', 0) });
  });

  it('changing seats starts a new sit-down in the new facing', () => {
    let state = run(initialAnimation('S'), 40, { seatFacing: 'up' });
    state = stepAnimation(state, { ...STILL, dtMs: 16, seatFacing: 'down' });
    expect(animationFrame(state)).toEqual({ sheet: 'seated', frame: seatedFrame('down', 0) });
  });
});
