/**
 * Reglas puras de `Space` (#7): validacion de rectangulo, pre-chequeo de
 * solape, normalizacion de slug/nombre, y el hash canonico que es `version`
 * (D4). Viven aparte del adaptador por el mismo motivo que
 * `invitationRules.ts`/`userRules.ts`: cualquier consumidor futuro (rutas
 * HTTP en la slice 3) las necesita sin levantar Postgres.
 */

import { describe, expect, it } from 'vitest';
import {
  InvalidSpaceError,
  SpaceNameTakenError,
  SpaceOverlapError,
  assertValidBounds,
  assertValidCapacity,
  boundsOverlap,
  deriveSlug,
  hashSpaces,
  normalizeCreateSpaceInput,
  normalizeSpaceName,
  normalizeUpdateSpaceInput,
} from './spaceRules.ts';

describe('assertValidBounds', () => {
  it('acepta un rectangulo valido', () => {
    expect(() => assertValidBounds({ x: 0, y: 0, w: 10, h: 10 })).not.toThrow();
  });

  it('rechaza x negativo', () => {
    expect(() => assertValidBounds({ x: -1, y: 0, w: 10, h: 10 })).toThrow(InvalidSpaceError);
  });

  it('rechaza y negativo', () => {
    expect(() => assertValidBounds({ x: 0, y: -1, w: 10, h: 10 })).toThrow(InvalidSpaceError);
  });

  it('rechaza ancho cero o negativo', () => {
    expect(() => assertValidBounds({ x: 0, y: 0, w: 0, h: 10 })).toThrow(InvalidSpaceError);
    expect(() => assertValidBounds({ x: 0, y: 0, w: -5, h: 10 })).toThrow(InvalidSpaceError);
  });

  it('rechaza alto cero o negativo', () => {
    expect(() => assertValidBounds({ x: 0, y: 0, w: 10, h: 0 })).toThrow(InvalidSpaceError);
  });

  it('rechaza valores no enteros: un body HTTP sin tipar puede mandar "10.5"', () => {
    expect(() => assertValidBounds({ x: 0.5, y: 0, w: 10, h: 10 })).toThrow(InvalidSpaceError);
  });
});

describe('assertValidCapacity', () => {
  it('acepta null: sin limite', () => {
    expect(() => assertValidCapacity(null)).not.toThrow();
  });

  it('acepta un entero positivo', () => {
    expect(() => assertValidCapacity(8)).not.toThrow();
  });

  it('rechaza cero y negativos', () => {
    expect(() => assertValidCapacity(0)).toThrow(InvalidSpaceError);
    expect(() => assertValidCapacity(-3)).toThrow(InvalidSpaceError);
  });

  it('rechaza no enteros', () => {
    expect(() => assertValidCapacity(2.5)).toThrow(InvalidSpaceError);
  });
});

describe('boundsOverlap', () => {
  it('detecta solape real (dos rectangulos que comparten area)', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    const b = { x: 5, y: 5, w: 10, h: 10 };
    expect(boundsOverlap(a, b)).toBe(true);
  });

  it('NO detecta solape en rectangulos separados por un hueco', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    const b = { x: 11, y: 0, w: 10, h: 10 };
    expect(boundsOverlap(a, b)).toBe(false);
  });

  it('trata el contacto exacto de borde como solape (verificado contra Postgres real en el spike de #7)', () => {
    // `box && box` de Postgres rechazo un rectangulo que solo tocaba el borde
    // (x=10 contra un rectangulo que termina en x=10) en el spike de la tarea
    // 2.1. El pre-chequeo debe coincidir con eso: si no coincidiera, esta
    // regla dejaria pasar algo que la base de datos rechazaria de todas
    // formas con un 500 en vez de un 400.
    const a = { x: 0, y: 0, w: 10, h: 10 };
    const b = { x: 10, y: 0, w: 10, h: 10 };
    expect(boundsOverlap(a, b)).toBe(true);
  });

  it('es simetrico: da el mismo resultado en cualquier orden de los argumentos', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    const b = { x: 5, y: 5, w: 10, h: 10 };
    expect(boundsOverlap(a, b)).toBe(boundsOverlap(b, a));
  });
});

describe('deriveSlug', () => {
  it('pasa a minusculas y sustituye espacios por guiones', () => {
    expect(deriveSlug('Sala de Juntas')).toBe('sala-de-juntas');
  });

  it('quita acentos y caracteres no alfanumericos', () => {
    expect(deriveSlug('Cafetería')).toBe('cafeteria');
  });

  it('colapsa guiones repetidos y recorta los de los extremos', () => {
    expect(deriveSlug('  Sala -- Vacía!!  ')).toBe('sala-vacia');
  });
});

describe('normalizeSpaceName', () => {
  it('recorta espacios sin tocar mayusculas: el nombre se muestra tal cual', () => {
    expect(normalizeSpaceName('  Sala de Juntas  ')).toBe('Sala de Juntas');
  });
});

describe('normalizeCreateSpaceInput', () => {
  it('valida y normaliza de una vez, derivando el slug del nombre', () => {
    const result = normalizeCreateSpaceInput({
      name: '  Sala de Juntas  ',
      x: 50,
      y: 2,
      w: 13,
      h: 14,
      capacity: null,
    });

    expect(result).toEqual({
      slug: 'sala-de-juntas',
      name: 'Sala de Juntas',
      x: 50,
      y: 2,
      w: 13,
      h: 14,
      capacity: null,
    });
  });

  it('propaga el error de bounds invalidos: no normaliza silenciosamente', () => {
    expect(() =>
      normalizeCreateSpaceInput({ name: 'X', x: -1, y: 0, w: 10, h: 10, capacity: null }),
    ).toThrow(InvalidSpaceError);
  });
});

describe('normalizeUpdateSpaceInput', () => {
  it('renombrar deriva un slug nuevo y no toca el rectangulo', () => {
    expect(normalizeUpdateSpaceInput({ name: '  War Room  ' })).toEqual({
      name: 'War Room',
      slug: 'war-room',
    });
  });

  it('un rectangulo completo se valida y se pasa igual', () => {
    expect(normalizeUpdateSpaceInput({ x: 1, y: 2, w: 3, h: 4 })).toEqual({
      x: 1,
      y: 2,
      w: 3,
      h: 4,
    });
  });

  it('rechaza un rectangulo parcial: mover exige las cuatro coordenadas juntas', () => {
    expect(() => normalizeUpdateSpaceInput({ x: 1, y: 2 })).toThrow(InvalidSpaceError);
    expect(() => normalizeUpdateSpaceInput({ w: 3 })).toThrow(InvalidSpaceError);
  });

  it('un rectangulo completo invalido se rechaza igual que en el alta', () => {
    expect(() => normalizeUpdateSpaceInput({ x: -1, y: 0, w: 10, h: 10 })).toThrow(
      InvalidSpaceError,
    );
  });

  it('capacity: null limpia el limite explicitamente, distinto de no tocarlo', () => {
    expect(normalizeUpdateSpaceInput({ capacity: null })).toEqual({ capacity: null });
  });

  it('capacity invalida se rechaza', () => {
    expect(() => normalizeUpdateSpaceInput({ capacity: 0 })).toThrow(InvalidSpaceError);
  });

  it('un patch vacio da un objeto vacio: no reinventa campos que no llegaron', () => {
    expect(normalizeUpdateSpaceInput({})).toEqual({});
  });
});

describe('hashSpaces: la version servida (D4)', () => {
  const A = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    slug: 'sala-de-juntas',
    name: 'Sala de Juntas',
    x: 50,
    y: 2,
    w: 13,
    h: 14,
    capacity: null,
  };
  const B = {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    slug: 'cafeteria',
    name: 'Cafetería',
    x: 50,
    y: 18,
    w: 13,
    h: 14,
    capacity: null,
  };

  it('es determinista: la misma lista produce siempre el mismo hash', () => {
    expect(hashSpaces([A, B])).toBe(hashSpaces([A, B]));
  });

  it('es independiente del orden de insercion: el canonico ordena por id', () => {
    expect(hashSpaces([A, B])).toBe(hashSpaces([B, A]));
  });

  it('cambia si se borra un espacio de la lista', () => {
    expect(hashSpaces([A, B])).not.toBe(hashSpaces([A]));
  });

  it('cambia si cambian los datos que importan (nombre, rect, slug, capacidad)', () => {
    const renamed = { ...A, name: 'War Room' };
    expect(hashSpaces([A, B])).not.toBe(hashSpaces([renamed, B]));
  });

  it('ignora createdAt/updatedAt: no son parte del canonico', () => {
    const withTimestamps = { ...A, createdAt: new Date('2020-01-01'), updatedAt: new Date('2020-01-01') };
    const withOtherTimestamps = { ...A, createdAt: new Date('2099-01-01'), updatedAt: new Date('2099-01-01') };
    expect(hashSpaces([withTimestamps, B])).toBe(hashSpaces([withOtherTimestamps, B]));
  });

  it('produce 16 caracteres hexadecimales', () => {
    expect(hashSpaces([A, B])).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('SpaceOverlapError', () => {
  it('es distinguible por instanceof, no por el texto del mensaje', () => {
    const error = new SpaceOverlapError('x');
    expect(error).toBeInstanceOf(SpaceOverlapError);
    expect(error.name).toBe('SpaceOverlapError');
  });
});

describe('SpaceNameTakenError', () => {
  it('es distinguible por instanceof, no por el texto del mensaje', () => {
    const error = new SpaceNameTakenError('x');
    expect(error).toBeInstanceOf(SpaceNameTakenError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('SpaceNameTakenError');
  });

  it('NO es un SpaceOverlapError: son los dos 409 de los espacios y se arreglan distinto', () => {
    // Misma separacion que `DeskOverlapError`/`DeskTakenError`: los dos acaban
    // en 409, pero uno se arregla moviendo el rectangulo y el otro eligiendo
    // otro nombre. Colapsarlos le diria al administrador que corrija lo que no
    // esta mal.
    expect(new SpaceNameTakenError('x')).not.toBeInstanceOf(SpaceOverlapError);
    expect(new SpaceOverlapError('x')).not.toBeInstanceOf(SpaceNameTakenError);
  });
});
