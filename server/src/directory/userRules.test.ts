/**
 * Las reglas del alta de alguien de casa son puras y se prueban solas, sin base
 * de datos, por el mismo motivo que `invitationRules.test.ts`: los dos
 * adaptadores del directorio las comparten, y dos definiciones de "que roles se
 * pueden asignar" se separarian sin que ningun test lo notase.
 */

import { describe, expect, it } from 'vitest';
import type { CreateUserInput } from './directoryPort.ts';
import {
  ASSIGNABLE_ROLES,
  assertAssignableRole,
  InvalidUserError,
  normalizeUserInput,
} from './userRules.ts';

const INPUT: CreateUserInput = {
  email: 'ana@example.com',
  role: 'employee',
  uid: 'uid-ana',
  createdById: 'id-admin',
};

describe('assertAssignableRole', () => {
  it('acepta los dos roles de alguien de casa', () => {
    expect(() => assertAssignableRole('employee')).not.toThrow();
    expect(() => assertAssignableRole('admin')).not.toThrow();
    expect(ASSIGNABLE_ROLES).toEqual(['employee', 'admin']);
  });

  it('rechaza superadmin: lo protege un indice unico parcial de la base de datos', () => {
    // `users_single_superadmin` haria fallar el INSERT de todas formas, pero el
    // error llegaria como un 500 desde Postgres en vez de como un 400 que
    // explica que ese rol no se reparte desde el panel.
    expect(() => assertAssignableRole('superadmin')).toThrow(InvalidUserError);
  });

  it('rechaza guest: un invitado sin caducidad es justo lo que este flujo no hace', () => {
    // El alta de invitados tiene su propia ruta porque lleva caducidad. Dar de
    // alta un `guest` por aqui crearia un invitado eterno, que es exactamente
    // el agujero que `POST /admin/invitations` existe para cerrar.
    expect(() => assertAssignableRole('guest')).toThrow(InvalidUserError);
  });

  it('rechaza lo que ni siquiera es un rol', () => {
    // El cuerpo de una peticion HTTP es JSON sin tipar: el tipo
    // `AssignableRole` no existe en tiempo de ejecucion y aqui llega cualquier
    // cosa.
    for (const role of [undefined, null, 42, '', 'Admin', 'EMPLOYEE', {}, ['admin']]) {
      expect(() => assertAssignableRole(role)).toThrow(InvalidUserError);
    }
  });

  it('el error es de una clase propia, no un Error pelado', () => {
    // La ruta tiene que distinguir "el administrador pidio un rol que no
    // existe" (400) de "la base de datos se cayo" (500), y hacerlo por el TEXTO
    // del mensaje es una atadura que se rompe al reescribir la frase.
    try {
      assertAssignableRole('guest');
      expect.unreachable('assertAssignableRole tenia que lanzar');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidUserError);
      expect((error as Error).name).toBe('InvalidUserError');
    }
  });
});

describe('normalizeUserInput', () => {
  it('normaliza el email igual que una invitacion, sin una segunda copia de la regla', () => {
    // Si esto normalizase por su cuenta, `Ana@example.com` podria acabar siendo
    // una fila distinta de `ana@example.com` segun por que ruta se diera de
    // alta, y el indice unico sobre `lower(email)` no protegeria de nada.
    const normalized = normalizeUserInput({ ...INPUT, email: '  Ana@Example.COM  ' });

    expect(normalized.email).toBe('ana@example.com');
  });

  it('deja pasar el resto de los campos tal cual', () => {
    expect(normalizeUserInput(INPUT)).toEqual({
      email: 'ana@example.com',
      role: 'employee',
      uid: 'uid-ana',
      createdById: 'id-admin',
    });
  });

  it('valida el rol ANTES de devolver nada', () => {
    const invalido = { ...INPUT, role: 'superadmin' } as unknown as CreateUserInput;

    expect(() => normalizeUserInput(invalido)).toThrow(InvalidUserError);
  });
});
