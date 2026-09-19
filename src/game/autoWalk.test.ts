import { describe, expect, it } from 'vitest';
import {
  ARRIVE_EPSILON_PX,
  STALL_TIMEOUT_MS,
  beginAutoWalk,
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
