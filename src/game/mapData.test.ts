import { describe, expect, it } from 'vitest';
import { GROUND, GROUND_TEX, MAP_H, MAP_W, PROX_RADIUS, ROOMS, TILE } from './mapData';

describe('mapData', () => {
  it('define las dimensiones y el radio de proximidad del prototipo (app.js:6-8)', () => {
    expect(TILE).toBe(32);
    expect(MAP_W).toBe(64);
    expect(MAP_H).toBe(44);
    expect(PROX_RADIUS).toBe(170);
  });

  it('mapea cada codigo de suelo a su textura (app.js:11-12)', () => {
    expect(GROUND_TEX[GROUND.WALL]).toBe('wall');
    expect(GROUND_TEX[GROUND.WATER]).toBe('water');
    expect(GROUND_TEX[GROUND.BRIDGE]).toBe('bridge');
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
