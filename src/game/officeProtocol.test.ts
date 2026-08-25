import { describe, expect, it } from 'vitest';
import { DEFAULT_FACING, FACINGS, facingFrom } from './officeProtocol';

describe('facingFrom', () => {
  it('deriva la orientacion del eje dominante del movimiento', () => {
    expect(facingFrom(-1, 0, DEFAULT_FACING)).toBe('left');
    expect(facingFrom(1, 0, DEFAULT_FACING)).toBe('right');
    expect(facingFrom(0, -1, DEFAULT_FACING)).toBe('up');
    expect(facingFrom(0, 1, DEFAULT_FACING)).toBe('down');
  });

  it('en diagonal manda el eje horizontal', () => {
    // Elegir uno es arbitrario, pero tiene que ser estable: alternar entre los
    // dos ejes haria parpadear el sprite en cada diagonal.
    expect(facingFrom(1, 1, DEFAULT_FACING)).toBe('right');
    expect(facingFrom(-1, -1, DEFAULT_FACING)).toBe('left');
  });

  it('quieto conserva la orientacion previa en vez de volver al valor por defecto', () => {
    // Soltar la tecla no puede girar al personaje de golpe hacia el sur.
    expect(facingFrom(0, 0, 'left')).toBe('left');
    expect(facingFrom(0, 0, 'up')).toBe('up');
  });

  it('todo resultado posible esta dentro del enumerado que el servidor acepta', () => {
    const results = [
      facingFrom(-1, 0, DEFAULT_FACING),
      facingFrom(1, 0, DEFAULT_FACING),
      facingFrom(0, -1, DEFAULT_FACING),
      facingFrom(0, 1, DEFAULT_FACING),
      facingFrom(0, 0, DEFAULT_FACING),
    ];

    for (const result of results) expect(FACINGS).toContain(result);
  });
});
