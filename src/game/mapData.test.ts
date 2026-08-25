import { describe, expect, it } from 'vitest';
import { GROUND, MAP_H, MAP_W, PROX_RADIUS, ROOMS, TILE } from './mapData';

describe('mapData', () => {
  it('define las dimensiones y el radio de proximidad del prototipo (app.js:6-8)', () => {
    expect(TILE).toBe(32);
    expect(MAP_W).toBe(64);
    expect(MAP_H).toBe(44);
    expect(PROX_RADIUS).toBe(170);
  });

  it('los codigos de suelo son consecutivos desde 0, para indexar GROUND_FRAMES', () => {
    // El mapeo a material vive ahora en `assets.ts` (frames de la hoja Kenney)
    // y se indexa por estos codigos; que sean 0..n-1 es lo que lo hace valido.
    expect(Object.values(GROUND).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('ubica la Sala de Juntas en tile (50,2) de 13x14 (app.js:56-59)', () => {
    const room = ROOMS[0];
    expect(room.name).toBe('Sala de Juntas');
    expect(room.x / TILE).toBe(50);
    expect(room.y / TILE).toBe(2);
    expect(room.w / TILE).toBe(13);
    expect(room.h / TILE).toBe(14);
  });

  it('ubica la Cafeteria en tile (50,18) de 13x14 (app.js:56-59)', () => {
    const room = ROOMS[1];
    expect(room.name).toBe('Cafetería');
    expect(room.x / TILE).toBe(50);
    expect(room.y / TILE).toBe(18);
    expect(room.w / TILE).toBe(13);
    expect(room.h / TILE).toBe(14);
  });
});
