/**
 * `decideAccess` es pura y sin base de datos: estas pruebas son la red de
 * seguridad de la caducidad entera (#24). Si algo de aqui se rompe, un invitado
 * caducado vuelve a entrar a la oficina, asi que se cubren los bordes exactos
 * (el instante del vencimiento, el orden entre revocado y caducado) y no solo
 * el camino feliz.
 */

import { describe, expect, it } from 'vitest';
import { canAdminister, canAssignRole, canRemove, decideAccess } from './accessDecision.ts';
import type { DirectoryUser, Role } from './directoryPort.ts';

const NOW = new Date('2026-09-17T12:00:00.000Z');

function user(overrides: Partial<DirectoryUser> = {}): DirectoryUser {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    uid: 'uid-ana',
    email: 'ana@example.com',
    displayName: 'Ana',
    role: 'employee',
    status: 'active',
    expiresAt: null,
    invitedBy: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('decideAccess', () => {
  it('deja pasar a un empleado activo sin caducidad', () => {
    expect(decideAccess(user(), NOW)).toBe('allow');
  });

  it('deja pasar a un invitado cuya caducidad aun esta en el futuro', () => {
    const futuro = new Date(NOW.getTime() + 1);
    expect(decideAccess(user({ role: 'guest', expiresAt: futuro }), NOW)).toBe('allow');
  });

  it('no deja pasar a quien no esta en el directorio', () => {
    // Token valido de Identity Platform pero sin fila: o la cuenta se creo por
    // fuera, o el directorio no la reconoce. En ninguno de los dos casos se
    // puede afirmar nada sobre su rol ni su caducidad.
    expect(decideAccess(null, NOW)).toBe('not-provisioned');
  });

  it('no deja pasar a una cuenta revocada', () => {
    expect(decideAccess(user({ status: 'revoked' }), NOW)).toBe('revoked');
  });

  it('no deja pasar a un invitado cuya caducidad ya paso', () => {
    const pasado = new Date(NOW.getTime() - 1);
    expect(decideAccess(user({ role: 'guest', expiresAt: pasado }), NOW)).toBe('expired');
  });

  it('el instante exacto del vencimiento ya NO entra', () => {
    // `<=` y no `<`: la fecha se guarda como "hasta cuando vale", y un limite
    // inclusivo regala un margen que nadie ha decidido. Ademas hace la regla
    // determinista en el unico instante donde dos implementaciones podrian
    // discrepar sin que ningun test lo note.
    expect(decideAccess(user({ role: 'guest', expiresAt: new Date(NOW.getTime()) }), NOW)).toBe(
      'expired',
    );
  });

  it('revocado gana a caducado: una cuenta revocada lo esta pase lo que pase con las fechas', () => {
    // El orden importa para el log del servidor, que es quien lee el motivo. Si
    // se comprobase primero la fecha, una revocacion manual sobre un invitado ya
    // vencido se registraria como "caduco solo", y el operador no sabria si el
    // boton de revocar llego a hacer algo.
    const pasado = new Date(NOW.getTime() - 1000);
    expect(decideAccess(user({ status: 'revoked', expiresAt: pasado }), NOW)).toBe('revoked');
  });

  it('una cuenta revocada con caducidad futura sigue revocada', () => {
    const futuro = new Date(NOW.getTime() + 1000);
    expect(decideAccess(user({ status: 'revoked', expiresAt: futuro }), NOW)).toBe('revoked');
  });

  it('la caducidad se aplica por la fecha, no por el rol', () => {
    // Nada impide que un admin tenga `expires_at`; si lo tiene, caduca. La regla
    // vive en el dato para que no haya una segunda tabla de excepciones por rol.
    const pasado = new Date(NOW.getTime() - 1);
    expect(decideAccess(user({ role: 'admin', expiresAt: pasado }), NOW)).toBe('expired');
  });

  it('todos los roles activos sin caducidad entran', () => {
    const roles: Role[] = ['superadmin', 'admin', 'employee', 'guest'];
    for (const role of roles) {
      expect(decideAccess(user({ role }), NOW)).toBe('allow');
    }
  });
});

describe('canAdminister', () => {
  it('solo superadmin y admin administran', () => {
    expect(canAdminister('superadmin')).toBe(true);
    expect(canAdminister('admin')).toBe(true);
  });

  it('empleados e invitados no administran', () => {
    // Un empleado es alguien de casa, pero invitar a gente de fuera y revocar
    // accesos no es una capacidad que se reparta por estar dentro.
    expect(canAdminister('employee')).toBe(false);
    expect(canAdminister('guest')).toBe(false);
  });
});

describe('canAssignRole', () => {
  it('cualquiera que administre puede dar de alta a un empleado', () => {
    expect(canAssignRole('superadmin', 'employee')).toBe(true);
    expect(canAssignRole('admin', 'employee')).toBe(true);
  });

  it('SOLO un superadmin puede crear administradores', () => {
    // Si un admin pudiese crear admins, el rol se reproduciria solo: bastaria
    // con uno comprometido para llenar la oficina de administradores, y ninguno
    // de los nuevos tendria detras la decision de quien manda de verdad. Que el
    // rol solo lo reparta el superadmin mantiene un unico origen.
    expect(canAssignRole('superadmin', 'admin')).toBe(true);
    expect(canAssignRole('admin', 'admin')).toBe(false);
  });

  it('quien no administra no asigna ningun rol', () => {
    for (const actor of ['employee', 'guest'] as const) {
      expect(canAssignRole(actor, 'employee')).toBe(false);
      expect(canAssignRole(actor, 'admin')).toBe(false);
    }
  });
});

describe('canRemove (#93)', () => {
  const ROLES: readonly Role[] = ['superadmin', 'admin', 'employee', 'guest'];
  const ACTOR_ID = 'actor';
  const TARGET_ID = 'target';

  /**
   * The whole table, written out by hand instead of derived: a test that
   * recomputes the rule would pass with the rule inverted.
   */
  const ALLOWED: Record<Role, readonly Role[]> = {
    superadmin: ['admin', 'employee', 'guest'],
    admin: ['employee', 'guest'],
    employee: [],
    guest: [],
  };

  for (const actor of ROLES) {
    for (const target of ROLES) {
      const expected = ALLOWED[actor].includes(target);
      it(`${actor} ${expected ? 'can' : 'cannot'} remove ${target}`, () => {
        expect(canRemove({ id: ACTOR_ID, role: actor }, { id: TARGET_ID, role: target })).toBe(
          expected,
        );
      });
    }
  }

  it('nobody removes themself, whatever the role', () => {
    // Otherwise the last admin could lock the office out by accident, and a
    // superadmin could leave the office without one.
    for (const role of ROLES) {
      expect(canRemove({ id: ACTOR_ID, role }, { id: ACTOR_ID, role })).toBe(false);
    }
  });
});
