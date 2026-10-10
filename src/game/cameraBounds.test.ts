import { describe, expect, it } from 'vitest';
import { CAMERA_MARGIN_TILES, centeredScroll, regionBounds, glideStep, scrollRange, terrainRegion } from './cameraBounds';

/**
 * Geometria pura de la camara principal (#53, #98, #179), sin Phaser. Reproduce
 * `Camera.clampX/clampY` de Phaser 3.90 para poder decidir hacia donde
 * planear sin depender del clamp que `preRender` aplica a destiempo.
 */

describe('scrollRange: mismo clamp que Phaser', () => {
  it('con zoom 1 el scroll va de bounds.x a bounds.x + bounds.width - vista', () => {
    expect(scrollRange(0, 2048, 1280, 1)).toEqual({ min: 0, max: 768 });
  });

  it('una vista MAS ancha que los bounds deja el scroll fijo en el borde (la causa de #53)', () => {
    expect(scrollRange(0, 2048, 2560, 1)).toEqual({ min: 0, max: 0 });
  });

  it('con zoom 2 la vista visible es la mitad y el rango se desplaza como en Phaser', () => {
    // displayWidth = 320 / 2 = 160; bx = 0 + (160 - 320) / 2 = -80.
    expect(scrollRange(0, 2000, 320, 2)).toEqual({ min: -80, max: -80 + 2000 - 160 });
  });
});

describe('terrainRegion: where the main camera may look (#179)', () => {
  const BLOCK = 288;
  /** Three 32 px tiles, what `OfficeScene` passes (`CAMERA_MARGIN_TILES`). */
  const MARGIN = 96;
  /** A row-major grid of `columns` x `rows` void blocks with `painted` overrides. */
  function grid(columns: number, rows: number, painted: Record<number, string>): string[] {
    return Array.from({ length: columns * rows }, (_, index) => painted[index] ?? 'void');
  }

  it('keeps the margin at three tiles, not a whole block', () => {
    expect(CAMERA_MARGIN_TILES).toBe(3);
  });

  it('is the one painted block plus the margin on every side', () => {
    // 21x15 grid, the central wood block 157 (column 10, row 7).
    expect(terrainRegion(grid(21, 15, { 157: 'wood' }), 21, BLOCK, MARGIN)).toEqual({
      x: 10 * BLOCK - MARGIN,
      y: 7 * BLOCK - MARGIN,
      width: BLOCK + 2 * MARGIN,
      height: BLOCK + 2 * MARGIN,
    });
  });

  it('bounds scattered blocks together: an L shape spans its whole bounding box', () => {
    // Column 2 rows 1..3, then row 3 columns 2..5.
    const blocks = grid(8, 6, { 10: 'grass', 18: 'grass', 26: 'grass', 27: 'sand', 28: 'sand', 29: 'tile' });

    expect(terrainRegion(blocks, 8, BLOCK, MARGIN)).toEqual({
      x: 2 * BLOCK - MARGIN,
      y: BLOCK - MARGIN,
      width: 4 * BLOCK + 2 * MARGIN,
      height: 3 * BLOCK + 2 * MARGIN,
    });
  });

  it('counts water as painted terrain: only void is outside it', () => {
    expect(terrainRegion(grid(5, 5, { 12: 'water', 13: 'wood' }), 5, BLOCK, MARGIN)).toEqual({
      x: 2 * BLOCK - MARGIN,
      y: 2 * BLOCK - MARGIN,
      width: 2 * BLOCK + 2 * MARGIN,
      height: BLOCK + 2 * MARGIN,
    });
  });

  it('a block on the grid edge keeps its margin past the world', () => {
    expect(terrainRegion(grid(4, 3, { 0: 'grass', 11: 'wood' }), 4, BLOCK, MARGIN)).toEqual({
      x: -MARGIN,
      y: -MARGIN,
      width: 4 * BLOCK + 2 * MARGIN,
      height: 3 * BLOCK + 2 * MARGIN,
    });
  });

  it('falls back to the whole block grid when every block is void', () => {
    expect(terrainRegion(grid(4, 3, {}), 4, BLOCK, MARGIN)).toEqual({ x: 0, y: 0, width: 4 * BLOCK, height: 3 * BLOCK });
  });
});

describe('centeredScroll', () => {
  it('es el scroll que deja el punto en el centro de la vista (Camera.centerOn)', () => {
    expect(centeredScroll(500, 200)).toBe(400);
  });
});

describe('glideStep: el planeo por cuadro', () => {
  it('avanza una fraccion lerp de la distancia restante', () => {
    expect(glideStep(0, 100, 0.25)).toEqual({ value: 25, arrived: false });
  });

  it('a menos de medio pixel aterriza exacto en el destino', () => {
    expect(glideStep(99.7, 100, 0.12)).toEqual({ value: 100, arrived: true });
  });
});

describe('regionBounds: the main camera bounds for a region, zoom aware', () => {
  const REGION = { x: 0, y: 0, width: 4032, height: 2880 };

  /** The one scroll Phaser's clamp allows on an axis whose display covers the region. */
  function pinnedScroll(
    bounds: { x: number; width: number },
    viewSize: number,
    zoom: number,
  ): number {
    const range = scrollRange(bounds.x, bounds.width, viewSize, zoom);
    expect(range.min).toBe(range.max);
    return range.min;
  }

  it('is the region itself while the visible area is smaller than it on both axes', () => {
    expect(regionBounds(REGION, { width: 1280, height: 720 }, 1)).toEqual(REGION);
    expect(regionBounds(REGION, { width: 2560, height: 1440 }, 1)).toEqual(REGION);
  });

  it('centers the region on x when only the width fits at 0.5 (2560x1440)', () => {
    const view = { width: 2560, height: 1440 };
    const bounds = regionBounds(REGION, view, 0.5);

    expect(bounds).toEqual({ x: -544, y: 0, width: 5120, height: 2880 });
    expect(pinnedScroll(bounds, view.width, 0.5)).toBe(centeredScroll(REGION.width / 2, view.width));
  });

  it('centers the region on y only when just the height fits', () => {
    const view = { width: 1000, height: 1500 };
    const bounds = regionBounds(REGION, view, 0.5);

    expect(bounds).toEqual({ x: 0, y: -60, width: 4032, height: 3000 });
    expect(pinnedScroll({ x: bounds.y, width: bounds.height }, view.height, 0.5)).toBe(
      centeredScroll(REGION.height / 2, view.height),
    );
  });

  it('centers the region on both axes when the whole region fits', () => {
    const view = { width: 3000, height: 1800 };
    const bounds = regionBounds(REGION, view, 0.5);

    expect(bounds).toEqual({ x: -984, y: -360, width: 6000, height: 3600 });
    expect(pinnedScroll(bounds, view.width, 0.5)).toBe(centeredScroll(REGION.width / 2, view.width));
  });

  it('zooming in shrinks the visible area back below the region: the bounds are the region again', () => {
    expect(regionBounds(REGION, { width: 2560, height: 1440 }, 2)).toEqual(REGION);
  });

  it('keeps the region origin: an offset region is centered around its own middle', () => {
    const offset = { x: 100, y: 50, width: 400, height: 300 };

    expect(regionBounds(offset, { width: 1000, height: 800 }, 1)).toEqual({
      x: -200,
      y: -200,
      width: 1000,
      height: 800,
    });
  });
});
