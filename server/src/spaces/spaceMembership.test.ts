/**
 * `spaceIdAt` es la conversion de TILES (unidad de `Space`, ver la cabecera de
 * `spaceRules.ts`) a PIXELES (unidad de `player.x/y`, ver `OfficeRoom.ts`)
 * seguida de la deteccion compartida (`detectSpace`, D4). Puro: sin red, sin
 * base de datos, un array de `Space` de entrada.
 */

import { describe, expect, it } from 'vitest';
import { TILE } from '../../../src/game/mapData.ts';
import type { Space } from './spacesPort.ts';
import { spaceIdAt } from './spaceMembership.ts';

function space(overrides: Partial<Space> & Pick<Space, 'id' | 'x' | 'y' | 'w' | 'h'>): Space {
  const now = new Date('2026-01-15T12:00:00.000Z');
  return {
    slug: `space-${overrides.id}`,
    name: `Space ${overrides.id}`,
    capacity: null,
    deskId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('spaceIdAt', () => {
  it('devuelve el id del espacio cuyo rectangulo (en tiles) contiene la posicion (en pixeles)', () => {
    // Rectangulo en tiles (10,10)-(13,13); en pixeles: (320,320)-(416,416).
    const s1 = space({ id: 's1', x: 10, y: 10, w: 3, h: 3 });

    expect(spaceIdAt({ x: 330, y: 330 }, [s1])).toBe('s1');
  });

  it('devuelve null cuando la posicion no cae dentro de ningun espacio', () => {
    const s1 = space({ id: 's1', x: 10, y: 10, w: 3, h: 3 });

    expect(spaceIdAt({ x: 0, y: 0 }, [s1])).toBeNull();
  });

  it('respeta el limite semi-abierto: el borde superior/izquierdo cuenta, el opuesto no', () => {
    const s1 = space({ id: 's1', x: 10, y: 10, w: 3, h: 3 });
    const topLeftPx = { x: 10 * TILE, y: 10 * TILE };
    const bottomRightPx = { x: 13 * TILE, y: 13 * TILE };

    expect(spaceIdAt(topLeftPx, [s1])).toBe('s1');
    expect(spaceIdAt(bottomRightPx, [s1])).toBeNull();
  });

  it('elige el espacio correcto entre varios, no solo el primero de la lista', () => {
    const s1 = space({ id: 's1', x: 0, y: 0, w: 3, h: 3 });
    const s2 = space({ id: 's2', x: 20, y: 20, w: 3, h: 3 });

    expect(spaceIdAt({ x: 21 * TILE, y: 21 * TILE }, [s1, s2])).toBe('s2');
  });

  it('una lista vacia de espacios nunca contiene a nadie', () => {
    expect(spaceIdAt({ x: 100, y: 100 }, [])).toBeNull();
  });
});
