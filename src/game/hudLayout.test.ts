import { describe, expect, it } from 'vitest';
import { MINIMAP_HEIGHT, MINIMAP_MARGIN, MINIMAP_WIDTH, SIDEBAR_TOP } from './hudLayout';

describe('hudLayout: geometria compartida del HUD (#74)', () => {
  it('SIDEBAR_TOP se deriva del margen y la altura del minimapa, no un numero suelto', () => {
    expect(SIDEBAR_TOP).toBe(MINIMAP_MARGIN + MINIMAP_HEIGHT + MINIMAP_MARGIN);
  });

  it('con la geometria actual del minimapa, SIDEBAR_TOP es 168', () => {
    expect(MINIMAP_WIDTH).toBe(200);
    expect(MINIMAP_HEIGHT).toBe(140);
    expect(MINIMAP_MARGIN).toBe(14);
    expect(SIDEBAR_TOP).toBe(168);
  });
});
