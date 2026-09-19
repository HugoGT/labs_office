/**
 * El reparto de las nueve cajas de un escritorio asignable (#7, slice 5).
 *
 * Esto es un CONTRATO, no un detalle de dibujo: el servidor guarda un `slot`
 * entre 0 y 8 y no dice donde cae. Quien lo pinta y quien lo coloque algun dia
 * desde un editor tienen que estar de acuerdo en el mismo reparto, o la planta
 * que alguien puso arriba a la izquierda aparecera abajo a la derecha. Por eso
 * vive en una funcion pura con su propia prueba y no dentro del renderizador.
 */

import { describe, expect, it } from 'vitest';
import { DESK_SLOT_COLUMNS, DESK_SLOT_COUNT, deskSlotRect } from './deskLayout';
import { TILE } from './mapData';

/** Un escritorio de 3x3 tiles ya en pixeles, como lo entrega `desksClient`. */
const MESA = { x: 10 * TILE, y: 12 * TILE, w: 3 * TILE, h: 3 * TILE };

describe('deskSlotRect', () => {
  it('son nueve cajas, ni una mas', () => {
    // Las mismas nueve del `CHECK (slot BETWEEN 0 AND 8)` del servidor.
    expect(DESK_SLOT_COUNT).toBe(9);
  });

  it('el slot 0 es la caja de arriba a la izquierda', () => {
    expect(deskSlotRect(MESA, 0)).toEqual({ x: MESA.x, y: MESA.y, w: TILE, h: TILE });
  });

  it('el slot 2 cierra la primera fila por la derecha', () => {
    expect(deskSlotRect(MESA, 2)).toEqual({ x: MESA.x + 2 * TILE, y: MESA.y, w: TILE, h: TILE });
  });

  it('el slot 3 baja a la segunda fila: el reparto es por filas, no por columnas', () => {
    // La mitad que de verdad hay que fijar. Por columnas, el slot 3 seria la
    // caja de arriba de la segunda columna y toda la decoracion saldria
    // transpuesta sin que nada fallase.
    expect(deskSlotRect(MESA, 3)).toEqual({ x: MESA.x, y: MESA.y + TILE, w: TILE, h: TILE });
  });

  it('el slot 8 es la caja de abajo a la derecha', () => {
    expect(deskSlotRect(MESA, 8)).toEqual({
      x: MESA.x + 2 * TILE,
      y: MESA.y + 2 * TILE,
      w: TILE,
      h: TILE,
    });
  });

  it('las nueve cajas cubren el escritorio entero sin huecos ni solapes', () => {
    const rects = Array.from({ length: DESK_SLOT_COUNT }, (_unused, slot) =>
      deskSlotRect(MESA, slot),
    );

    expect(rects.every((rect) => rect !== null)).toBe(true);
    // Area total exacta: con un hueco sumaria menos y con un solape habria dos
    // esquinas repetidas, que la unicidad de abajo atrapa.
    const area = rects.reduce((sum, rect) => sum + (rect?.w ?? 0) * (rect?.h ?? 0), 0);
    expect(area).toBe(MESA.w * MESA.h);
    expect(new Set(rects.map((rect) => `${rect?.x},${rect?.y}`)).size).toBe(DESK_SLOT_COUNT);
  });

  it('ninguna caja se sale del escritorio', () => {
    for (let slot = 0; slot < DESK_SLOT_COUNT; slot++) {
      const rect = deskSlotRect(MESA, slot);
      expect(rect).not.toBeNull();
      expect(rect!.x).toBeGreaterThanOrEqual(MESA.x);
      expect(rect!.y).toBeGreaterThanOrEqual(MESA.y);
      expect(rect!.x + rect!.w).toBeLessThanOrEqual(MESA.x + MESA.w);
      expect(rect!.y + rect!.h).toBeLessThanOrEqual(MESA.y + MESA.h);
    }
  });

  it('las cajas salen del tamano del propio escritorio, no de una constante aparte', () => {
    // El tamano viaja en la respuesta (`w`/`h`). Dividir el rectangulo que
    // llega, en vez de asumir 32px, es lo que evita una segunda copia del 3
    // que un dia discrepe de la del servidor.
    const doble = { x: 0, y: 0, w: 6 * TILE, h: 6 * TILE };

    expect(deskSlotRect(doble, 4)).toEqual({ x: 2 * TILE, y: 2 * TILE, w: 2 * TILE, h: 2 * TILE });
  });

  it('un slot fuera de rango no es una caja', () => {
    // El servidor nunca lo manda, pero este renderizador lee una respuesta de
    // red: devolver una caja inventada pintaria decoracion fuera del
    // escritorio, encima de otro o en mitad del pasillo.
    expect(deskSlotRect(MESA, -1)).toBeNull();
    expect(deskSlotRect(MESA, DESK_SLOT_COUNT)).toBeNull();
  });

  it('un slot que no es un entero no es una caja', () => {
    expect(deskSlotRect(MESA, 2.5)).toBeNull();
    expect(deskSlotRect(MESA, Number.NaN)).toBeNull();
  });

  it('las columnas son tres, como los tiles de lado', () => {
    expect(DESK_SLOT_COLUMNS).toBe(3);
  });
});
