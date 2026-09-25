import { describe, expect, it } from 'vitest';
import { PAN_THRESHOLD_PX, reduceCameraPan, type CameraPanState } from './cameraPan';

/**
 * Reductor puro de `cameraPan` (#53): `idle -> armed -> panning`, sin Phaser.
 * `CameraPanLayer` es la unica que llama a esto con eventos reales de
 * puntero; aqui se prueba cada transicion en aislamiento, igual que
 * `autoWalk.ts`/`layoutEditor.ts`.
 */

const IDLE: CameraPanState = { kind: 'idle' };

describe('reduceCameraPan: idle', () => {
  it('down elegible arma el pan, sin efecto todavia (no hay drag hasta cruzar el umbral)', () => {
    const { state, effect } = reduceCameraPan(IDLE, { kind: 'down', x: 10, y: 20, eligible: true });

    expect(state).toEqual({ kind: 'armed', originX: 10, originY: 20, detached: false });
    expect(effect).toEqual({ kind: 'none' });
  });

  it('down NO elegible (sobre un peer/escritorio/pick, o editando layout) se queda en idle', () => {
    const { state, effect } = reduceCameraPan(IDLE, { kind: 'down', x: 10, y: 20, eligible: false });

    expect(state).toEqual(IDLE);
    expect(effect).toEqual({ kind: 'none' });
  });

  it('move en idle es un no-op', () => {
    const { state, effect } = reduceCameraPan(IDLE, { kind: 'move', x: 5, y: 5 });

    expect(state).toEqual(IDLE);
    expect(effect).toEqual({ kind: 'none' });
  });

  it('up en idle es un no-op', () => {
    const { state, effect } = reduceCameraPan(IDLE, { kind: 'up' });

    expect(state).toEqual(IDLE);
    expect(effect).toEqual({ kind: 'none' });
  });
});

describe('reduceCameraPan: armed', () => {
  const armed: CameraPanState = { kind: 'armed', originX: 100, originY: 100, detached: false };

  it('un segundo down se ignora: se queda armado en el mismo origen', () => {
    const { state, effect } = reduceCameraPan(armed, {
      kind: 'down',
      x: 999,
      y: 999,
      eligible: true,
    });

    expect(state).toEqual(armed);
    expect(effect).toEqual({ kind: 'none' });
  });

  it('mover exactamente PAN_THRESHOLD_PX (6px) NO arma el pan todavia (limite inclusive del lado del click)', () => {
    const { state, effect } = reduceCameraPan(armed, {
      kind: 'move',
      x: 100 + PAN_THRESHOLD_PX,
      y: 100,
    });

    expect(PAN_THRESHOLD_PX).toBe(6);
    expect(state).toEqual(armed);
    expect(effect).toEqual({ kind: 'none' });
  });

  it('mover 6.01px SI arma el pan: beginPan lleva el delta completo desde el origen', () => {
    const { state, effect } = reduceCameraPan(armed, {
      kind: 'move',
      x: 100 + PAN_THRESHOLD_PX + 0.01,
      y: 100,
    });

    expect(state).toEqual({ kind: 'panning', lastX: 106.01, lastY: 100 });
    expect(effect.kind).toBe('beginPan');
    // `toBeCloseTo` en vez de `toEqual`: 106.01 - 100 no da 6.01 exacto en
    // coma flotante, y eso es un detalle de aritmetica, no del reductor.
    expect((effect as { dx: number }).dx).toBeCloseTo(6.01);
    expect((effect as { dy: number }).dy).toBe(0);
  });

  it('un desplazamiento diagonal cruza el umbral por hipotenusa, no por eje', () => {
    // dx=5, dy=5 -> hipotenusa ~7.07, por encima del umbral aunque cada eje
    // por separado (5px) este por debajo.
    const { state, effect } = reduceCameraPan(armed, { kind: 'move', x: 105, y: 105 });

    expect(state).toEqual({ kind: 'panning', lastX: 105, lastY: 105 });
    expect(effect).toEqual({ kind: 'beginPan', dx: 5, dy: 5 });
  });

  it('up antes de cruzar el umbral vuelve a idle sin efecto: el click sigue siendo un click', () => {
    const { state, effect } = reduceCameraPan(armed, { kind: 'up' });

    expect(state).toEqual(IDLE);
    expect(effect).toEqual({ kind: 'none' });
  });
});

describe('reduceCameraPan: panning', () => {
  const panning: CameraPanState = { kind: 'panning', lastX: 106, lastY: 100 };

  it('un down durante el pan se ignora', () => {
    const { state, effect } = reduceCameraPan(panning, {
      kind: 'down',
      x: 1,
      y: 1,
      eligible: true,
    });

    expect(state).toEqual(panning);
    expect(effect).toEqual({ kind: 'none' });
  });

  it('move mientras se panea desplaza por el delta desde la ULTIMA posicion, no desde el origen', () => {
    const { state, effect } = reduceCameraPan(panning, { kind: 'move', x: 120, y: 90 });

    expect(state).toEqual({ kind: 'panning', lastX: 120, lastY: 90 });
    expect(effect).toEqual({ kind: 'scroll', dx: 14, dy: -10 });
  });

  it('up mientras se panea vuelve a idle y pide reanudar el seguimiento', () => {
    const { state, effect } = reduceCameraPan(panning, { kind: 'up' });

    expect(state).toEqual(IDLE);
    expect(effect).toEqual({ kind: 'resumeFollow' });
  });
});

describe('reduceCameraPan: click en el minimapa (#98)', () => {
  const FOCUSED: CameraPanState = { kind: 'focused' };

  it('desde idle enfoca la camara en el punto del mundo y la deja desacoplada del jugador', () => {
    const { state, effect } = reduceCameraPan(IDLE, { kind: 'minimap', x: 640, y: 320 });

    expect(state).toEqual(FOCUSED);
    expect(effect).toEqual({ kind: 'focus', x: 640, y: 320 });
  });

  it('un segundo click en el minimapa re-enfoca en el nuevo punto', () => {
    const { state, effect } = reduceCameraPan(FOCUSED, { kind: 'minimap', x: 10, y: 20 });

    expect(state).toEqual(FOCUSED);
    expect(effect).toEqual({ kind: 'focus', x: 10, y: 20 });
  });

  it('en medio de un gesto sobre el mapa (armed o panning) se ignora: el primer boton sigue decidiendo', () => {
    const armed: CameraPanState = { kind: 'armed', originX: 1, originY: 1, detached: false };
    const panning: CameraPanState = { kind: 'panning', lastX: 1, lastY: 1 };

    for (const state of [armed, panning]) {
      expect(reduceCameraPan(state, { kind: 'minimap', x: 5, y: 5 })).toEqual({
        state,
        effect: { kind: 'none' },
      });
    }
  });
});

describe('reduceCameraPan: focused (camara desacoplada tras el minimapa)', () => {
  const FOCUSED: CameraPanState = { kind: 'focused' };

  it('en cuanto el jugador se mueve, la camara vuelve a seguirlo', () => {
    const { state, effect } = reduceCameraPan(FOCUSED, { kind: 'playerMoved' });

    expect(state).toEqual(IDLE);
    expect(effect).toEqual({ kind: 'resumeFollow' });
  });

  it('playerMoved fuera de focused no hace nada: seguir o panear ya tienen su propio criterio', () => {
    const panning: CameraPanState = { kind: 'panning', lastX: 1, lastY: 1 };

    for (const state of [IDLE, panning]) {
      expect(reduceCameraPan(state, { kind: 'playerMoved' })).toEqual({ state, effect: { kind: 'none' } });
    }
  });

  it('un click plano sobre el mapa (down+up sin drag) no la saca de focused', () => {
    const down = reduceCameraPan(FOCUSED, { kind: 'down', x: 50, y: 50, eligible: true });
    expect(down.state).toEqual({ kind: 'armed', originX: 50, originY: 50, detached: true });

    const up = reduceCameraPan(down.state, { kind: 'up' });
    expect(up).toEqual({ state: FOCUSED, effect: { kind: 'none' } });
  });

  it('un drag desde focused es un pan normal: al soltar vuelve al jugador (criterio de #53)', () => {
    const armed: CameraPanState = { kind: 'armed', originX: 50, originY: 50, detached: true };
    const move = reduceCameraPan(armed, { kind: 'move', x: 80, y: 50 });
    expect(move.effect).toEqual({ kind: 'beginPan', dx: 30, dy: 0 });

    expect(reduceCameraPan(move.state, { kind: 'up' })).toEqual({
      state: IDLE,
      effect: { kind: 'resumeFollow' },
    });
  });

  it('un down no elegible en focused se queda en focused', () => {
    const result = reduceCameraPan(FOCUSED, { kind: 'down', x: 1, y: 1, eligible: false });

    expect(result).toEqual({ state: FOCUSED, effect: { kind: 'none' } });
  });
});
