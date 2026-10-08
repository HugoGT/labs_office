import { describe, expect, it } from 'vitest';
import {
  ARRIVE_EPSILON_PX,
  STALL_TIMEOUT_MS,
  beginAutoWalk,
  isAutoWalkArrived,
  stepAutoWalk,
} from './autoWalk';

const NO_INPUT = { vx: 0, vy: 0 };
const SPEED = 200;

describe('beginAutoWalk', () => {
  it('arranca con la distancia inicial como mejor distancia y sin estancamiento', () => {
    const state = beginAutoWalk({ x: 100, y: 0 }, { x: 0, y: 0 });

    expect(state).toEqual({ goal: { x: 100, y: 0 }, bestDistance: 100, stalledMs: 0 });
  });
});

describe('stepAutoWalk', () => {
  it('llega (arrived) cuando la distancia esta dentro del epsilon (D10)', () => {
    const state = beginAutoWalk({ x: 10, y: 0 }, { x: 0, y: 0 });

    const step = stepAutoWalk({
      state,
      position: { x: 10 - ARRIVE_EPSILON_PX, y: 0 },
      keyboard: NO_INPUT,
      deltaMs: 16,
      speed: SPEED,
    });

    expect(step).toEqual({ kind: 'arrived' });
  });

  it('no llega todavia justo por fuera del epsilon', () => {
    const state = beginAutoWalk({ x: 10, y: 0 }, { x: 0, y: 0 });

    const step = stepAutoWalk({
      state,
      position: { x: 10 - ARRIVE_EPSILON_PX - 0.1, y: 0 },
      keyboard: NO_INPUT,
      deltaMs: 16,
      speed: SPEED,
    });

    expect(step.kind).toBe('walking');
  });

  it('no se pasa del objetivo con un delta grande (D10: sin overshoot)', () => {
    // Distancia restante 5px, delta de 100ms: sin el tope, 200px/s cubriria 20px.
    const state = beginAutoWalk({ x: 5, y: 0 }, { x: 0, y: 0 });

    const step = stepAutoWalk({
      state,
      position: { x: 0, y: 0 },
      keyboard: NO_INPUT,
      deltaMs: 100,
      speed: SPEED,
    });

    expect(step.kind).toBe('walking');
    if (step.kind !== 'walking') throw new Error('unreachable');
    // vx*dt debe aterrizar justo en el objetivo, nunca mas alla.
    const traveled = step.vx * (100 / 1000);
    expect(traveled).toBeCloseTo(5, 5);
  });

  it('deltaMs=0 usa velocidad completa (sin division por cero)', () => {
    const state = beginAutoWalk({ x: 100, y: 0 }, { x: 0, y: 0 });

    const step = stepAutoWalk({
      state,
      position: { x: 0, y: 0 },
      keyboard: NO_INPUT,
      deltaMs: 0,
      speed: SPEED,
    });

    expect(step.kind).toBe('walking');
    if (step.kind !== 'walking') throw new Error('unreachable');
    expect(step.vx).toBeCloseTo(SPEED, 5);
    expect(step.vy).toBeCloseTo(0, 5);
  });

  it('cualquier input de teclado no nulo cancela el auto-walk (D10)', () => {
    const state = beginAutoWalk({ x: 100, y: 0 }, { x: 0, y: 0 });

    const step = stepAutoWalk({
      state,
      position: { x: 50, y: 0 },
      keyboard: { vx: 1, vy: 0 },
      deltaMs: 16,
      speed: SPEED,
    });

    expect(step).toEqual({ kind: 'cancelled', reason: 'input' });
  });

  it('se cancela por bloqueo tras STALL_TIMEOUT_MS sin progreso (D10), sin mensaje/toast', () => {
    // Posicion fija: nunca mejora el acercamiento, simulando un colisionador.
    // `beginAutoWalk` arranca ya desde esa posicion estancada, para que el
    // primer paso no cuente como "mejora" solo por medir desde el spawn.
    const stuckPosition = { x: 50, y: 0 };
    let state = beginAutoWalk({ x: 100, y: 0 }, stuckPosition);

    let step = stepAutoWalk({
      state,
      position: stuckPosition,
      keyboard: NO_INPUT,
      deltaMs: 300,
      speed: SPEED,
    });
    expect(step.kind).toBe('walking');
    if (step.kind !== 'walking') throw new Error('unreachable');
    state = step.state;
    expect(state.stalledMs).toBe(300);

    step = stepAutoWalk({
      state,
      position: stuckPosition,
      keyboard: NO_INPUT,
      deltaMs: STALL_TIMEOUT_MS - 300,
      speed: SPEED,
    });

    expect(step).toEqual({ kind: 'cancelled', reason: 'blocked' });
    // D10: el bloqueo no lleva canal de mensaje/toast -- solo `reason`.
    expect(Object.keys(step)).toEqual(['kind', 'reason']);
  });

  it('el progreso real reinicia el contador de estancamiento', () => {
    let state = beginAutoWalk({ x: 100, y: 0 }, { x: 0, y: 0 });

    let step = stepAutoWalk({
      state,
      position: { x: 0, y: 0 },
      keyboard: NO_INPUT,
      deltaMs: 300,
      speed: SPEED,
    });
    if (step.kind !== 'walking') throw new Error('unreachable');
    state = step.state;
    expect(state.stalledMs).toBe(300);

    // Avanza de verdad: el estancamiento debe volver a cero.
    step = stepAutoWalk({
      state,
      position: { x: 20, y: 0 },
      keyboard: NO_INPUT,
      deltaMs: 300,
      speed: SPEED,
    });
    if (step.kind !== 'walking') throw new Error('unreachable');
    expect(step.state.stalledMs).toBe(0);
    expect(step.state.bestDistance).toBe(80);
  });

  it('reemplazar el objetivo (aceptar una segunda tarjeta) reinicia distancia y estancamiento', () => {
    const first = beginAutoWalk({ x: 100, y: 0 }, { x: 0, y: 0 });
    const stepped = stepAutoWalk({
      state: first,
      position: { x: 0, y: 0 },
      keyboard: NO_INPUT,
      deltaMs: 300,
      speed: SPEED,
    });
    if (stepped.kind !== 'walking') throw new Error('unreachable');

    const replaced = beginAutoWalk({ x: 5, y: 5 }, { x: 0, y: 0 });

    expect(replaced).toEqual({
      goal: { x: 5, y: 5 },
      bestDistance: Math.hypot(5, 5),
      stalledMs: 0,
    });
  });
});

describe('beginAutoWalk with waypoints', () => {
  it('keeps the two-argument shape: no waypoints key without waypoints', () => {
    expect('waypoints' in beginAutoWalk({ x: 100, y: 0 }, { x: 0, y: 0 })).toBe(false);
    expect('waypoints' in beginAutoWalk({ x: 100, y: 0 }, { x: 0, y: 0 }, [])).toBe(false);
  });

  it('measures the best distance to the first waypoint and keeps the goal final', () => {
    const state = beginAutoWalk({ x: 100, y: 0 }, { x: 0, y: 0 }, [{ x: 0, y: 30 }, { x: 60, y: 30 }]);

    expect(state).toEqual({
      goal: { x: 100, y: 0 },
      waypoints: [{ x: 0, y: 30 }, { x: 60, y: 30 }],
      bestDistance: 30,
      stalledMs: 0,
    });
  });
});

describe('stepAutoWalk with waypoints', () => {
  const route = () => beginAutoWalk({ x: 100, y: 100 }, { x: 0, y: 0 }, [{ x: 100, y: 0 }]);

  it('steers toward the first waypoint instead of the goal', () => {
    const step = stepAutoWalk({ state: route(), position: { x: 0, y: 0 }, keyboard: NO_INPUT, deltaMs: 16, speed: SPEED });

    expect(step.kind).toBe('walking');
    if (step.kind !== 'walking') throw new Error('unreachable');
    expect(step.vx).toBeCloseTo(SPEED, 5);
    expect(step.vy).toBeCloseTo(0, 5);
  });

  it('shifts a waypoint within the epsilon, steers on in the same step and resets the stall', () => {
    const stalled = { ...route(), bestDistance: 3, stalledMs: 500 };

    const step = stepAutoWalk({
      state: stalled,
      position: { x: 100 - ARRIVE_EPSILON_PX, y: 0 },
      keyboard: NO_INPUT,
      deltaMs: 16,
      speed: SPEED,
    });

    expect(step.kind).toBe('walking');
    if (step.kind !== 'walking') throw new Error('unreachable');
    // Standing 2 px short of the waypoint, the goal lies almost straight down.
    const toGoal = Math.hypot(2, 100);
    expect(step.vx).toBeCloseTo((SPEED * 2) / toGoal, 5);
    expect(step.vy).toBeCloseTo((SPEED * 100) / toGoal, 5);
    expect('waypoints' in step.state).toBe(false);
    expect(step.state.goal).toEqual({ x: 100, y: 100 });
    expect(step.state.bestDistance).toBeCloseTo(100 - 0, 0);
    expect(step.state.stalledMs).toBe(16);
  });

  it('does not arrive at an intermediate waypoint', () => {
    const step = stepAutoWalk({ state: route(), position: { x: 100, y: 0 }, keyboard: NO_INPUT, deltaMs: 16, speed: SPEED });

    expect(step.kind).toBe('walking');
  });

  it('skips every waypoint already within the epsilon in one step', () => {
    const state = beginAutoWalk({ x: 100, y: 100 }, { x: 0, y: 0 }, [{ x: 100, y: 0 }, { x: 100, y: 1 }, { x: 100, y: 50 }]);

    const step = stepAutoWalk({ state, position: { x: 100, y: 0 }, keyboard: NO_INPUT, deltaMs: 16, speed: SPEED });

    expect(step.kind).toBe('walking');
    if (step.kind !== 'walking') throw new Error('unreachable');
    expect(step.state.waypoints).toEqual([{ x: 100, y: 50 }]);
  });

  it('arrives only at the final goal once the waypoints are gone', () => {
    const state = beginAutoWalk({ x: 100, y: 100 }, { x: 0, y: 0 }, [{ x: 100, y: 0 }]);

    const step = stepAutoWalk({ state, position: { x: 100, y: 100 }, keyboard: NO_INPUT, deltaMs: 16, speed: SPEED });

    // Standing on the goal with a waypoint pending is not arrival: the route is walked in order.
    expect(step.kind).toBe('walking');
  });

  it('caps the speed so a waypoint is landed on exactly, never overshot', () => {
    const step = stepAutoWalk({
      state: route(),
      position: { x: 100 - 5, y: 0 },
      keyboard: NO_INPUT,
      deltaMs: 100,
      speed: SPEED,
    });

    if (step.kind !== 'walking') throw new Error('unreachable');
    expect(step.vx * (100 / 1000)).toBeCloseTo(5, 5);
  });

  it('restarts the stall measure from the next target after passing a waypoint', () => {
    let state = route();
    let step = stepAutoWalk({ state, position: { x: 0, y: 0 }, keyboard: NO_INPUT, deltaMs: 300, speed: SPEED });
    if (step.kind !== 'walking') throw new Error('unreachable');
    state = step.state;
    expect(state.stalledMs).toBe(300);

    step = stepAutoWalk({ state, position: { x: 100, y: 0 }, keyboard: NO_INPUT, deltaMs: 300, speed: SPEED });
    if (step.kind !== 'walking') throw new Error('unreachable');
    // The shift reset the counter; this step is a fresh target measured from the waypoint.
    expect(step.state.stalledMs).toBe(300);
    expect(step.state.bestDistance).toBe(100);
  });

  it('still cancels on a movement key and on a 600 ms stall mid-route', () => {
    const keyed = stepAutoWalk({ state: route(), position: { x: 30, y: 0 }, keyboard: { vx: 0, vy: -1 }, deltaMs: 16, speed: SPEED });
    expect(keyed).toEqual({ kind: 'cancelled', reason: 'input' });

    const at = { x: 30, y: 0 };
    const state = beginAutoWalk({ x: 100, y: 100 }, at, [{ x: 100, y: 0 }]);
    const blocked = stepAutoWalk({ state, position: at, keyboard: NO_INPUT, deltaMs: STALL_TIMEOUT_MS, speed: SPEED });
    expect(blocked).toEqual({ kind: 'cancelled', reason: 'blocked' });
  });
});

describe('isAutoWalkArrived', () => {
  it('is true within the epsilon of the final goal when no waypoints remain', () => {
    const state = beginAutoWalk({ x: 10, y: 0 }, { x: 0, y: 0 });

    expect(isAutoWalkArrived(state, { x: 10 - ARRIVE_EPSILON_PX, y: 0 })).toBe(true);
    expect(isAutoWalkArrived(state, { x: 10 - ARRIVE_EPSILON_PX - 0.1, y: 0 })).toBe(false);
  });

  it('is false while waypoints remain, even standing on the final goal', () => {
    const state = beginAutoWalk({ x: 10, y: 0 }, { x: 0, y: 0 }, [{ x: 0, y: 40 }]);

    expect(isAutoWalkArrived(state, { x: 10, y: 0 })).toBe(false);
  });
});
