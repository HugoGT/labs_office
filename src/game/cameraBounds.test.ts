import { describe, expect, it } from 'vitest';
import { centeredScroll, followBounds, glideStep, navigationBounds, scrollRange } from './cameraBounds';

/**
 * Geometria pura de la camara principal (#53, #98), sin Phaser. Reproduce
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

describe('navigationBounds: bounds mientras la camara navega sin el jugador', () => {
  it('cualquier punto del mundo, incluidas las esquinas, puede quedar centrado aunque la vista sea mas grande que el mundo', () => {
    const view = { width: 2560, height: 1440 };
    const bounds = navigationBounds({ x: 0, y: 0, width: 2048, height: 1408 }, view, 1);
    const rangeX = scrollRange(bounds.x, bounds.width, view.width, 1);
    const rangeY = scrollRange(bounds.y, bounds.height, view.height, 1);

    for (const [px, py] of [
      [0, 0],
      [2048, 1408],
      [1024, 704],
    ]) {
      expect(centeredScroll(px, view.width)).toBeGreaterThanOrEqual(rangeX.min);
      expect(centeredScroll(px, view.width)).toBeLessThanOrEqual(rangeX.max);
      expect(centeredScroll(py, view.height)).toBeGreaterThanOrEqual(rangeY.min);
      expect(centeredScroll(py, view.height)).toBeLessThanOrEqual(rangeY.max);
    }
  });

  it('no deja alejarse mas alla de centrar el borde: el pan no se pierde en el vacio', () => {
    const view = { width: 1000, height: 800 };
    const bounds = navigationBounds({ x: 0, y: 0, width: 2048, height: 1408 }, view, 1);

    expect(scrollRange(bounds.x, bounds.width, view.width, 1)).toEqual({
      min: centeredScroll(0, view.width),
      max: centeredScroll(2048, view.width),
    });
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

describe('followBounds: bounds while the camera follows the player, zoom aware', () => {
  const WORLD = { x: 0, y: 0, width: 4032, height: 2880 };

  /** The one scroll Phaser's clamp allows on an axis whose display covers the world. */
  function pinnedScroll(
    bounds: { x: number; width: number },
    viewSize: number,
    zoom: number,
  ): number {
    const range = scrollRange(bounds.x, bounds.width, viewSize, zoom);
    expect(range.min).toBe(range.max);
    return range.min;
  }

  it('is the world itself while the visible area is smaller than it on both axes', () => {
    expect(followBounds(WORLD, { width: 1280, height: 720 }, 1)).toEqual(WORLD);
    expect(followBounds(WORLD, { width: 2560, height: 1440 }, 1)).toEqual(WORLD);
  });

  it('centers the world on x when only the width fits at 0.5 (2560x1440)', () => {
    const view = { width: 2560, height: 1440 };
    const bounds = followBounds(WORLD, view, 0.5);

    expect(bounds).toEqual({ x: -544, y: 0, width: 5120, height: 2880 });
    expect(pinnedScroll(bounds, view.width, 0.5)).toBe(centeredScroll(WORLD.width / 2, view.width));
  });

  it('centers the world on y only when just the height fits', () => {
    const view = { width: 1000, height: 1500 };
    const bounds = followBounds(WORLD, view, 0.5);

    expect(bounds).toEqual({ x: 0, y: -60, width: 4032, height: 3000 });
    expect(pinnedScroll({ x: bounds.y, width: bounds.height }, view.height, 0.5)).toBe(
      centeredScroll(WORLD.height / 2, view.height),
    );
  });

  it('centers the world on both axes when the whole world fits', () => {
    const view = { width: 3000, height: 1800 };
    const bounds = followBounds(WORLD, view, 0.5);

    expect(bounds).toEqual({ x: -984, y: -360, width: 6000, height: 3600 });
    expect(pinnedScroll(bounds, view.width, 0.5)).toBe(centeredScroll(WORLD.width / 2, view.width));
  });

  it('zooming in shrinks the visible area back below the world: the bounds are the world again', () => {
    expect(followBounds(WORLD, { width: 2560, height: 1440 }, 2)).toEqual(WORLD);
  });

  it('keeps the world origin: an offset world is centered around its own middle', () => {
    const offset = { x: 100, y: 50, width: 400, height: 300 };

    expect(followBounds(offset, { width: 1000, height: 800 }, 1)).toEqual({
      x: -200,
      y: -200,
      width: 1000,
      height: 800,
    });
  });
});
