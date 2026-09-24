/**
 * Reglas puras del escritorio (#7, slice 5), probadas sin almacen de ninguna
 * clase, igual que `spaceRules.test.ts`.
 *
 * La propiedad que este fichero existe para fijar es que el pre-chequeo de
 * solape diga EXACTAMENTE lo que dice `desks_no_overlap` en `schema.sql`. Un
 * pre-chequeo mas permisivo que la base de datos no sirve de nada: dejaria
 * pasar algo que luego revienta como un 500 en la cara del administrador, que
 * es justo lo que existe para evitar.
 */

import { describe, expect, it } from 'vitest';
import {
  DESK_SIDE,
  DeskOverlapError,
  DeskSpaceOverlapError,
  DeskTakenError,
  InvalidDeskError,
  assertValidDeskPosition,
  deskBoundsOverlap,
  normalizeCreateDeskInput,
  normalizeDeskLabel,
  normalizeUpdateDeskInput,
} from './deskRules.ts';

describe('DESK_SIDE', () => {
  it('es 3: un escritorio son nueve cajas de una persona de ancho', () => {
    // El 3 vive aqui y no repartido por el codigo. `schema.sql` tiene su propia
    // copia literal porque el SQL no puede importar una constante, y ese es el
    // unico sitio donde se duplica a proposito.
    expect(DESK_SIDE).toBe(3);
  });
});

describe('assertValidDeskPosition', () => {
  it('acepta un origen en tiles no negativos', () => {
    expect(() => assertValidDeskPosition({ x: 0, y: 0 })).not.toThrow();
    expect(() => assertValidDeskPosition({ x: 12, y: 40 })).not.toThrow();
  });

  it('rechaza coordenadas negativas, igual que el CHECK de schema.sql', () => {
    expect(() => assertValidDeskPosition({ x: -1, y: 0 })).toThrow(InvalidDeskError);
    expect(() => assertValidDeskPosition({ x: 0, y: -1 })).toThrow(InvalidDeskError);
  });

  it('rechaza coordenadas no enteras: un body HTTP sin tipar puede mandar 2.5', () => {
    expect(() => assertValidDeskPosition({ x: 2.5, y: 0 })).toThrow(InvalidDeskError);
    expect(() => assertValidDeskPosition({ y: 2.5, x: 0 })).toThrow(InvalidDeskError);
  });

  it('rechaza algo que ni siquiera es un numero', () => {
    expect(() => assertValidDeskPosition({ x: '3' as unknown as number, y: 0 })).toThrow(
      InvalidDeskError,
    );
  });
});

describe('normalizeDeskLabel', () => {
  it('recorta y conserva lo que escribio el admin: se muestra en el mapa', () => {
    expect(normalizeDeskLabel('  Mesa 4  ')).toBe('Mesa 4');
  });

  it('rechaza una etiqueta vacia', () => {
    // `label text NOT NULL` admitiria la cadena vacia, y el mapa pintaria un
    // escritorio sin nada que lo identifique al moverlo o borrarlo.
    expect(() => normalizeDeskLabel('   ')).toThrow(InvalidDeskError);
    expect(() => normalizeDeskLabel(undefined as unknown as string)).toThrow(InvalidDeskError);
  });
});

describe('deskBoundsOverlap', () => {
  it('dos escritorios en el mismo sitio se solapan', () => {
    expect(deskBoundsOverlap({ x: 4, y: 4 }, { x: 4, y: 4 })).toBe(true);
  });

  it('separados en diagonal por mas de un lado no se solapan', () => {
    expect(deskBoundsOverlap({ x: 0, y: 0 }, { x: 4, y: 4 })).toBe(false);
  });

  it('el contacto exacto de un borde CUENTA como solape, igual que box && box', () => {
    // El `&&` de `box` trata el contacto de una linea como solape: dos areas
    // pegadas, sin superficie en comun, chocan igual contra `desks_no_overlap`.
    // Un `<` estricto aqui dejaria pasar lo que la base de datos rechaza y el
    // administrador veria un 500 en vez de un 409. Mismo hallazgo que ya
    // documenta `spaceRules.boundsOverlap`.
    expect(deskBoundsOverlap({ x: 0, y: 0 }, { x: DESK_SIDE, y: 0 })).toBe(true);
    expect(deskBoundsOverlap({ x: 0, y: 0 }, { x: 0, y: DESK_SIDE })).toBe(true);
    expect(deskBoundsOverlap({ x: 0, y: 0 }, { x: DESK_SIDE + 1, y: 0 })).toBe(false);
  });
});

describe('normalizeCreateDeskInput', () => {
  it('valida y normaliza de una vez', () => {
    expect(normalizeCreateDeskInput({ label: '  Mesa 4 ', x: 2, y: 3 })).toEqual({
      label: 'Mesa 4',
      x: 2,
      y: 3,
    });
  });

  it('rechaza una posicion invalida', () => {
    expect(() => normalizeCreateDeskInput({ label: 'Mesa', x: -1, y: 0 })).toThrow(
      InvalidDeskError,
    );
  });

  it('rechaza una etiqueta vacia', () => {
    expect(() => normalizeCreateDeskInput({ label: '', x: 0, y: 0 })).toThrow(InvalidDeskError);
  });

  it('NO lee un occupantId del input: quien se sienta no lo decide el alta', () => {
    const creado = normalizeCreateDeskInput({
      label: 'Mesa',
      x: 0,
      y: 0,
      occupantId: 'id-ajeno',
    } as never);

    expect(creado).not.toHaveProperty('occupantId');
  });
});

describe('normalizeUpdateDeskInput', () => {
  it('renombrar sin mover', () => {
    expect(normalizeUpdateDeskInput({ label: ' Mesa 9 ' })).toEqual({ label: 'Mesa 9' });
  });

  it('mover sin renombrar', () => {
    expect(normalizeUpdateDeskInput({ x: 5, y: 6 })).toEqual({ x: 5, y: 6 });
  });

  it('un patch vacio no cambia nada', () => {
    expect(normalizeUpdateDeskInput({})).toEqual({});
  });

  it('x e y se mueven juntas: media coordenada no es una posicion', () => {
    // Igual que el rectangulo de `normalizeUpdateSpaceInput`: aceptar solo `x`
    // dejaria una posicion a medio definir y `assertValidDeskPosition` no
    // tiene forma de validar lo que falta.
    expect(() => normalizeUpdateDeskInput({ x: 5 })).toThrow(InvalidDeskError);
    expect(() => normalizeUpdateDeskInput({ y: 5 })).toThrow(InvalidDeskError);
  });

  it('rechaza una posicion invalida', () => {
    expect(() => normalizeUpdateDeskInput({ x: -1, y: 0 })).toThrow(InvalidDeskError);
  });

  it('NO lee un occupantId del patch: mover un escritorio no sienta a nadie', () => {
    const patch = normalizeUpdateDeskInput({ label: 'Mesa', occupantId: 'id-ajeno' } as never);

    expect(patch).not.toHaveProperty('occupantId');
  });
});

describe('los errores de dominio son tipos y no textos', () => {
  it('distinguen "lo escribio mal" de "ahi ya hay un escritorio" de "ese sitio ya es de alguien"', () => {
    // Misma razon que `InvalidSpaceError`/`SpaceOverlapError`: la ruta traduce
    // uno a 400 y los otros a 409, y hacerlo por el TEXTO del mensaje es una
    // atadura que se rompe en cuanto alguien reescribe la frase.
    //
    // `DeskOverlapError` y `DeskTakenError` son los DOS 409 de esta slice y no
    // uno solo: los provocan dos personas distintas haciendo dos cosas
    // distintas -- un administrador colocando mobiliario encima de otro, y
    // alguien llegando tarde a un sitio libre. El cuerpo de la respuesta los
    // separa, porque el segundo se arregla eligiendo otro escritorio y el
    // primero corrigiendo unas coordenadas.
    expect(new InvalidDeskError('x').name).toBe('InvalidDeskError');
    expect(new DeskOverlapError('x').name).toBe('DeskOverlapError');
    expect(new DeskTakenError('x').name).toBe('DeskTakenError');
    expect(new InvalidDeskError('x')).toBeInstanceOf(Error);
    expect(new DeskOverlapError('x')).toBeInstanceOf(Error);
    expect(new DeskTakenError('x')).toBeInstanceOf(Error);
  });

  it('"el cubiculo choca con una sala" (#10 + #12) es un tipo propio y no DeskOverlapError reciclado', () => {
    // Los dos acaban en 409 y los dos los dispara un solape, pero contra dos
    // tablas distintas: `DeskOverlapError` es `desks_no_overlap` (otro
    // escritorio), `DeskSpaceOverlapError` es `spaces_no_overlap` sobre el
    // cubiculo emparejado (una sala). Colapsarlos le diria al administrador
    // "elige otro escritorio" cuando el problema es que esa esquina de la
    // oficina ya es una sala.
    expect(new DeskSpaceOverlapError('x').name).toBe('DeskSpaceOverlapError');
    expect(new DeskSpaceOverlapError('x')).toBeInstanceOf(Error);
    expect(new DeskSpaceOverlapError('x')).not.toBeInstanceOf(DeskOverlapError);
  });
});
