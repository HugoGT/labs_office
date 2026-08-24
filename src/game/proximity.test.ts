import { describe, expect, it } from 'vitest';
import { PROX_RADIUS, ROOMS } from './mapData';
import { detectRoom, isSpeaking, nearbyIndices, nearbyKey } from './proximity';

describe('nearbyIndices', () => {
  it('reporta solo los NPCs estrictamente dentro del radio (app.js:450-451)', () => {
    const player = { x: 0, y: 0 };
    const inside = { x: 100, y: 0 };
    const exactlyOnRadius = { x: PROX_RADIUS, y: 0 };
    const outside = { x: 200, y: 0 };

    const indices = nearbyIndices(player, [inside, exactlyOnRadius, outside], PROX_RADIUS);

    expect(indices).toEqual([0]);
  });
});

describe('isSpeaking', () => {
  it('es verdadero solo durante la primera parte del ciclo de 4000ms (app.js:452)', () => {
    expect(isSpeaking(0, 0)).toBe(true);
    expect(isSpeaking(1799, 0)).toBe(true);
    expect(isSpeaking(1800, 0)).toBe(false);
    expect(isSpeaking(3999, 0)).toBe(false);
  });

  it('el desfase de fase corre el ciclo', () => {
    expect(isSpeaking(0, 2000)).toBe(false);
    expect(isSpeaking(2000, 2000)).toBe(true);
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

describe('detectRoom', () => {
  it('reporta el nombre de la sala cuando el jugador esta dentro de sus limites', () => {
    const room = ROOMS[0];
    const insidePlayer = { x: room.x + 1, y: room.y + 1 };

    expect(detectRoom(insidePlayer, ROOMS)).toBe(room.name);
  });

  it('reporta null fuera de toda sala', () => {
    expect(detectRoom({ x: 0, y: 0 }, ROOMS)).toBeNull();
  });

  it('el limite superior es exclusivo (app.js:465)', () => {
    const room = ROOMS[0];
    const onFarEdge = { x: room.x + room.w, y: room.y };

    expect(detectRoom(onFarEdge, ROOMS)).toBeNull();
  });
});
