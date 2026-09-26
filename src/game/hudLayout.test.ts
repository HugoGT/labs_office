import { describe, expect, it } from 'vitest';
import { MINIMAP_HEIGHT, MINIMAP_MARGIN, MINIMAP_WIDTH, RAIL_RIGHT, RAIL_WIDTH, SIDEBAR_TOP } from './hudLayout';

describe('hudLayout: geometria compartida del HUD (#74)', () => {
  it('SIDEBAR_TOP se deriva del margen y la altura del minimapa, no un numero suelto', () => {
    expect(SIDEBAR_TOP).toBe(MINIMAP_MARGIN + MINIMAP_HEIGHT + MINIMAP_MARGIN);
  });

  it('con la geometria actual del minimapa, SIDEBAR_TOP es 168', () => {
    expect(MINIMAP_WIDTH).toBe(258);
    expect(MINIMAP_HEIGHT).toBe(140);
    expect(MINIMAP_MARGIN).toBe(14);
    expect(SIDEBAR_TOP).toBe(168);
  });

  it('el minimapa comparte el ancho del rail derecho, no un numero propio (#86)', () => {
    expect(MINIMAP_WIDTH).toBe(RAIL_WIDTH);
  });

  it('RAIL_RIGHT y RAIL_WIDTH coinciden con --hud-rail-right/--hud-rail-width de index.css', () => {
    // 12 (--hud-sidebar-right) + 11 (--hud-rail-inset: 1px border + 10px padding) = 23
    expect(RAIL_RIGHT).toBe(23);
    // 280 (--hud-sidebar-width) - 2*11 (--hud-rail-inset en ambos lados) = 258
    expect(RAIL_WIDTH).toBe(258);
  });
});
