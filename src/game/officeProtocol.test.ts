import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FACING,
  DEFAULT_STATUS,
  DO_NOT_DISTURB,
  FACINGS,
  PRESENCE_STATUSES,
  facingFrom,
  isPresenceStatus,
} from './officeProtocol';

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

describe('vocabulario de presencia', () => {
  it('declara los tres estados del PRD, con "En linea" como valor por defecto', () => {
    expect(PRESENCE_STATUSES).toEqual(['g', 'y', 'r']);
    expect(DEFAULT_STATUS).toBe('g');
  });

  it('nombra "No molestar" en vez de repetir el literal "r" por el codigo', () => {
    // Es el unico estado con efecto sobre el audio: cada sitio que decide
    // cortar audio compara contra esta constante, no contra una letra suelta.
    expect(DO_NOT_DISTURB).toBe('r');
    expect(PRESENCE_STATUSES).toContain(DO_NOT_DISTURB);
  });

  it('isPresenceStatus acepta los tres codigos y rechaza cualquier otra cosa', () => {
    for (const status of PRESENCE_STATUSES) expect(isPresenceStatus(status)).toBe(true);

    // Lo que llega por el cable no es de fiar: el servidor lo usa para decidir
    // si escribe el estado, y el cliente para elegir un color.
    expect(isPresenceStatus('G')).toBe(false);
    expect(isPresenceStatus('ocupado')).toBe(false);
    expect(isPresenceStatus('')).toBe(false);
    expect(isPresenceStatus(null)).toBe(false);
    expect(isPresenceStatus(undefined)).toBe(false);
    expect(isPresenceStatus(0)).toBe(false);
    expect(isPresenceStatus({ status: 'g' })).toBe(false);
  });
});
