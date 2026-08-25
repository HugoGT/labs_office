import { describe, expect, it } from 'vitest';
import {
  ASSET_SCALE,
  GROUND_CODE_COUNT,
  GROUND_FRAMES,
  INDOOR,
  KENNEY_TILE,
  TERRAIN,
} from './assets';
import { GROUND, TILE } from './mapData';

describe('assets: escala', () => {
  it('un tile de Kenney escalado cubre exactamente un tile del mundo', () => {
    // Si esto deja de cuadrar, el suelo aparece con juntas o solapado, que es
    // el tipo de fallo que se ve raro sin que nadie sepa por que.
    expect(KENNEY_TILE * ASSET_SCALE).toBe(TILE);
  });
});

describe('assets: mapeo de suelo', () => {
  it('cubre todos los codigos de GROUND, ni uno mas ni uno menos', () => {
    expect(GROUND_FRAMES).toHaveLength(GROUND_CODE_COUNT);
  });

  it('cada codigo de GROUND indexa su propio material', () => {
    // Ancla contra reordenaciones: `GROUND` y `GROUND_FRAMES` son dos listas
    // paralelas, y desalinearlas pintaria agua donde va cesped sin fallar nada.
    expect(GROUND_FRAMES[GROUND.G]).toBe(TERRAIN.grass);
    expect(GROUND_FRAMES[GROUND.GD]).toBe(TERRAIN.grassDark);
    expect(GROUND_FRAMES[GROUND.WATER]).toBe(TERRAIN.water);
    expect(GROUND_FRAMES[GROUND.BRIDGE]).toBe(TERRAIN.bridge);
    expect(GROUND_FRAMES[GROUND.FLOOR]).toBe(TERRAIN.floor);
    expect(GROUND_FRAMES[GROUND.WOODF]).toBe(TERRAIN.woodFloor);
    expect(GROUND_FRAMES[GROUND.WALL]).toBe(TERRAIN.wall);
    expect(GROUND_FRAMES[GROUND.CORR]).toBe(TERRAIN.corridor);
  });

  it('ningun material de suelo se repite: cada codigo se distingue en pantalla', () => {
    expect(new Set(GROUND_FRAMES).size).toBe(GROUND_FRAMES.length);
  });

  it('todos los frames son indices no negativos', () => {
    for (const frame of [...Object.values(TERRAIN), ...Object.values(INDOOR)]) {
      expect(Number.isInteger(frame)).toBe(true);
      expect(frame).toBeGreaterThanOrEqual(0);
    }
  });
});
