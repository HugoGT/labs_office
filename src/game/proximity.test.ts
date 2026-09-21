import { describe, expect, it } from 'vitest';
import { BUILT_IN_SPACES, PROX_RADIUS } from './mapData';
import { detectSpace, nearbyIndices, nearbyKey } from './proximity';

describe('nearbyIndices', () => {
  it('reporta solo los puntos estrictamente dentro del radio (app.js:450-451)', () => {
    const player = { x: 0, y: 0 };
    const inside = { x: 100, y: 0 };
    const exactlyOnRadius = { x: PROX_RADIUS, y: 0 };
    const outside = { x: 200, y: 0 };

    const indices = nearbyIndices(player, [inside, exactlyOnRadius, outside], PROX_RADIUS);

    expect(indices).toEqual([0]);
  });
});

describe('nearbyKey', () => {
  it('produce una clave estable a partir de los nombres unidos con "|" (app.js:456)', () => {
    expect(nearbyKey(['Ana', 'Beto'])).toBe('Ana|Beto');
    expect(nearbyKey([])).toBe('');
  });

  it('cambia cuando la pertenencia cambia y se mantiene igual cuando no', () => {
    const before = nearbyKey(['Ana', 'Beto']);
    const unchanged = nearbyKey(['Ana', 'Beto']);
    const changed = nearbyKey(['Ana']);

    expect(unchanged).toBe(before);
    expect(changed).not.toBe(before);
  });
});

describe('detectSpace', () => {
  it('reporta el espacio entero (id y nombre) cuando el jugador esta dentro de sus limites', () => {
    const space = BUILT_IN_SPACES[0];
    const insidePlayer = { x: space.x + 1, y: space.y + 1 };

    const result = detectSpace(insidePlayer, BUILT_IN_SPACES);

    expect(result?.id).toBe(space.id);
    expect(result?.name).toBe(space.name);
  });

  it('reporta null fuera de todo espacio', () => {
    expect(detectSpace({ x: 0, y: 0 }, BUILT_IN_SPACES)).toBeNull();
  });

  it('el limite superior es exclusivo (app.js:465)', () => {
    const space = BUILT_IN_SPACES[0];
    const onFarEdge = { x: space.x + space.w, y: space.y };

    expect(detectSpace(onFarEdge, BUILT_IN_SPACES)).toBeNull();
  });
});
