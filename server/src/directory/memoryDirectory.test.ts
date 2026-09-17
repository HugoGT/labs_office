/**
 * El directorio en memoria no es un mock de conveniencia: es el segundo
 * adaptador del puerto, y existe para que la regla de bootstrap de superadmin
 * se pruebe por COMPORTAMIENTO y no leyendo una cadena de SQL. Un test que
 * afirma "el SQL contiene NOT EXISTS" pasa aunque la condicion este invertida;
 * uno que entra dos veces y mira el rol, no.
 *
 * `OfficeRoom.test.ts` lo usa por la misma razon por la que la suite entera no
 * levanta Postgres: la decision de acceso tiene que poder probarse sin
 * infraestructura, o dejara de probarse.
 */

import { describe, expect, it } from 'vitest';
import { InvalidInvitationError } from './invitationRules.ts';
import { createMemoryDirectory } from './memoryDirectory.ts';

const HUGO = { uid: 'uid-hugo', email: 'Hugo@Example.com', name: 'Hugo' };
const ANA = { uid: 'uid-ana', email: 'ana@example.com', name: 'Ana' };

describe('memoryDirectory: resolveOnLogin', () => {
  it('crea la fila la primera vez, como empleado activo y sin caducidad', async () => {
    const directory = createMemoryDirectory();

    const user = await directory.resolveOnLogin(ANA);

    expect(user).toMatchObject({
      uid: 'uid-ana',
      email: 'ana@example.com',
      displayName: 'Ana',
      role: 'employee',
      status: 'active',
      expiresAt: null,
      invitedBy: null,
    });
  });

  it('normaliza el email a minusculas al crear', async () => {
    const directory = createMemoryDirectory();

    const user = await directory.resolveOnLogin(HUGO);

    expect(user?.email).toBe('hugo@example.com');
  });

  it('es idempotente por uid: el segundo login no crea otra fila', async () => {
    const directory = createMemoryDirectory();

    const first = await directory.resolveOnLogin(ANA);
    const second = await directory.resolveOnLogin(ANA);

    expect(second?.id).toBe(first?.id);
  });

  it('refresca el nombre visible en cada login, pero no el rol ni el estado', async () => {
    // El `name` del token es lo que la persona ve sobre su avatar y cambia
    // cuando cambia su perfil. El rol NO puede salir del token: lo decide esta
    // oficina, no Identity Platform, y sobrescribirlo en cada login borraria
    // cualquier promocion hecha desde el panel.
    const directory = createMemoryDirectory({ bootstrapSuperadminEmail: 'ana@example.com' });
    await directory.resolveOnLogin(ANA);

    const again = await directory.resolveOnLogin({ ...ANA, name: 'Ana Gomez' });

    expect(again?.displayName).toBe('Ana Gomez');
    expect(again?.role).toBe('superadmin');
  });

  it('devuelve null si el token no trae email: el directorio se indexa por email', async () => {
    // Una cuenta anonima o por telefono no tiene con que casar con una
    // invitacion ni con el email de bootstrap. Antes que inventar una fila sin
    // clave humana, se le niega la entrada.
    const directory = createMemoryDirectory();

    expect(await directory.resolveOnLogin({ uid: 'uid-anon', email: null, name: null })).toBeNull();
  });

  it('acepta un token sin name: el nombre visible queda vacio, no la fila', async () => {
    const directory = createMemoryDirectory();

    const user = await directory.resolveOnLogin({ uid: 'uid-x', email: 'x@example.com', name: null });

    expect(user?.displayName).toBeNull();
    expect(user?.role).toBe('employee');
  });
});

describe('memoryDirectory: bootstrap de superadmin', () => {
  it('promociona al primero SOLO si su email es el de bootstrap', async () => {
    const directory = createMemoryDirectory({ bootstrapSuperadminEmail: 'hugo@example.com' });

    const user = await directory.resolveOnLogin(HUGO);

    expect(user?.role).toBe('superadmin');
  });

  it('compara el email sin distinguir mayusculas', async () => {
    const directory = createMemoryDirectory({ bootstrapSuperadminEmail: 'HUGO@example.COM' });

    expect((await directory.resolveOnLogin(HUGO))?.role).toBe('superadmin');
  });

  it('NO promociona al primero que entre si no es el email de bootstrap', async () => {
    // Esta es la regla entera: "el primero que entre manda" seria una carrera
    // por quedarse la oficina sobre una URL publica. Ana llega antes que nadie
    // y se queda de empleada.
    const directory = createMemoryDirectory({ bootstrapSuperadminEmail: 'hugo@example.com' });

    expect((await directory.resolveOnLogin(ANA))?.role).toBe('employee');
  });

  it('sin email de bootstrap no promociona a nadie', async () => {
    const directory = createMemoryDirectory();

    expect((await directory.resolveOnLogin(HUGO))?.role).toBe('employee');
  });

  it('no promociona si ya existe un superadmin, aunque el email case', async () => {
    // El "y no hay superadmin todavia" es lo que hace que la regla sea un
    // arranque y no una puerta trasera permanente: si el mando ya esta en manos
    // de alguien, volver a poner un email en el entorno no lo recupera. Sin
    // esta mitad de la condicion, quien controle las variables del despliegue
    // se promociona cuando quiera sobre una oficina en marcha.
    const directory = createMemoryDirectory({
      bootstrapSuperadminEmail: 'hugo@example.com',
      seed: [
        {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          uid: 'uid-jefa',
          email: 'jefa@example.com',
          displayName: 'Jefa',
          role: 'superadmin',
          status: 'active',
          expiresAt: null,
          invitedBy: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
    });

    expect((await directory.resolveOnLogin(HUGO))?.role).toBe('employee');
  });
});

describe('memoryDirectory: busquedas', () => {
  it('findByUid encuentra a quien ya entro y devuelve null para un uid desconocido', async () => {
    const directory = createMemoryDirectory();
    const created = await directory.resolveOnLogin(ANA);

    expect((await directory.findByUid('uid-ana'))?.id).toBe(created?.id);
    expect(await directory.findByUid('uid-de-nadie')).toBeNull();
  });

  it('findById encuentra por el id interno y devuelve null para uno inventado', async () => {
    const directory = createMemoryDirectory();
    const created = await directory.resolveOnLogin(ANA);

    expect((await directory.findById(created!.id))?.uid).toBe('uid-ana');
    expect(await directory.findById('00000000-0000-4000-8000-000000000000')).toBeNull();
  });
});

describe('memoryDirectory: invitaciones', () => {
  async function withAdmin() {
    const directory = createMemoryDirectory({ bootstrapSuperadminEmail: 'hugo@example.com' });
    const admin = await directory.resolveOnLogin(HUGO);
    return { directory, admin: admin! };
  }

  it('crea al invitado como guest activo, con caducidad y con quien lo invito', async () => {
    const now = new Date('2026-09-17T12:00:00.000Z');
    const directory = createMemoryDirectory({
      bootstrapSuperadminEmail: 'hugo@example.com',
      now: () => now,
    });
    const admin = (await directory.resolveOnLogin(HUGO))!;

    const guest = await directory.createInvitation({
      email: 'Externo@Example.com',
      days: 7,
      invitedById: admin.id,
      uid: 'uid-externo',
    });

    expect(guest).toMatchObject({
      uid: 'uid-externo',
      email: 'externo@example.com',
      role: 'guest',
      status: 'active',
      invitedBy: admin.id,
    });
    expect(guest.expiresAt).toEqual(new Date('2026-09-24T12:00:00.000Z'));
  });

  it('rechaza una duracion fuera del rango del issue', async () => {
    const { directory, admin } = await withAdmin();

    await expect(
      directory.createInvitation({
        email: 'externo@example.com',
        days: 91,
        invitedById: admin.id,
        uid: 'uid-externo',
      }),
    ).rejects.toBeInstanceOf(InvalidInvitationError);
  });

  it('deja rastro en la auditoria de quien invito a quien (PRD 10)', async () => {
    const { directory, admin } = await withAdmin();

    const guest = await directory.createInvitation({
      email: 'externo@example.com',
      days: 7,
      invitedById: admin.id,
      uid: 'uid-externo',
    });

    expect(directory.auditLog()).toEqual([
      { actorId: admin.id, action: 'invite', subjectId: guest.id },
    ]);
  });

  it('una duracion invalida no deja ni fila ni rastro de auditoria', async () => {
    // La validacion va ANTES de tocar nada: media invitacion es peor que
    // ninguna, porque el administrador ve un error y la fila existe igual.
    const { directory, admin } = await withAdmin();

    await expect(
      directory.createInvitation({
        email: 'externo@example.com',
        days: 0,
        invitedById: admin.id,
        uid: 'uid-externo',
      }),
    ).rejects.toBeInstanceOf(InvalidInvitationError);

    expect(await directory.findByUid('uid-externo')).toBeNull();
    expect(directory.auditLog()).toEqual([]);
  });

  it('lista solo a los invitados, no a los empleados, y resuelve el email de quien invito', async () => {
    const { directory, admin } = await withAdmin();
    await directory.resolveOnLogin(ANA);
    await directory.createInvitation({
      email: 'externo@example.com',
      days: 7,
      invitedById: admin.id,
      uid: 'uid-externo',
    });

    const rows = await directory.listInvitations();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: 'externo@example.com',
      role: 'guest',
      invitedByEmail: 'hugo@example.com',
    });
  });

  it('lista las mas recientes primero', async () => {
    const { directory, admin } = await withAdmin();
    await directory.createInvitation({
      email: 'primero@example.com',
      days: 7,
      invitedById: admin.id,
      uid: 'uid-1',
    });
    await directory.createInvitation({
      email: 'segundo@example.com',
      days: 7,
      invitedById: admin.id,
      uid: 'uid-2',
    });

    const rows = await directory.listInvitations();

    expect(rows.map((row) => row.email)).toEqual(['segundo@example.com', 'primero@example.com']);
  });

  it('un invitado revocado sigue apareciendo en la lista, con su estado', async () => {
    // Desaparecer de la tabla al revocar seria perder la unica prueba visible
    // de que la revocacion ocurrio.
    const { directory, admin } = await withAdmin();
    const guest = await directory.createInvitation({
      email: 'externo@example.com',
      days: 7,
      invitedById: admin.id,
      uid: 'uid-externo',
    });

    await directory.revoke(guest.id, admin.id);

    const rows = await directory.listInvitations();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('revoked');
  });
});

describe('memoryDirectory: revocacion', () => {
  async function withGuest() {
    const directory = createMemoryDirectory({ bootstrapSuperadminEmail: 'hugo@example.com' });
    const admin = (await directory.resolveOnLogin(HUGO))!;
    const guest = await directory.createInvitation({
      email: 'externo@example.com',
      days: 7,
      invitedById: admin.id,
      uid: 'uid-externo',
    });
    return { directory, admin, guest };
  }

  it('deja al invitado en revoked y devuelve la fila ya cambiada', async () => {
    const { directory, admin, guest } = await withGuest();

    const revoked = await directory.revoke(guest.id, admin.id);

    expect(revoked?.status).toBe('revoked');
    expect((await directory.findById(guest.id))?.status).toBe('revoked');
  });

  it('escribe el rastro de auditoria de la revocacion', async () => {
    const { directory, admin, guest } = await withGuest();

    await directory.revoke(guest.id, admin.id);

    expect(directory.auditLog()).toContainEqual({
      actorId: admin.id,
      action: 'revoke',
      subjectId: guest.id,
    });
  });

  it('devuelve null para un id que no existe', async () => {
    const { directory, admin } = await withGuest();

    expect(await directory.revoke('00000000-0000-4000-8000-000000000000', admin.id)).toBeNull();
  });

  it('devuelve null al intentar revocar a alguien que no es una invitacion', async () => {
    // Revocar por este camino a un empleado o a un admin seria convertir el
    // panel de invitaciones en un boton de expulsion del personal, que es otra
    // decision y no esta tomada.
    const { directory, admin } = await withGuest();

    expect(await directory.revoke(admin.id, admin.id)).toBeNull();
  });

  it('revocar dos veces es inofensivo y no duplica el rastro', async () => {
    const { directory, admin, guest } = await withGuest();

    await directory.revoke(guest.id, admin.id);
    const second = await directory.revoke(guest.id, admin.id);

    expect(second?.status).toBe('revoked');
    expect(directory.auditLog().filter((entry) => entry.action === 'revoke')).toHaveLength(1);
  });
});

describe('memoryDirectory: semilla y cierre', () => {
  it('acepta filas ya hechas para que otros tests monten el caso que necesitan', async () => {
    const expiresAt = new Date('2020-01-01T00:00:00.000Z');
    const directory = createMemoryDirectory({
      seed: [
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          uid: 'uid-caducado',
          email: 'caducado@example.com',
          displayName: 'Caducado',
          role: 'guest',
          status: 'active',
          expiresAt,
          invitedBy: null,
          createdAt: new Date('2019-12-01T00:00:00.000Z'),
        },
      ],
    });

    expect((await directory.findByUid('uid-caducado'))?.expiresAt).toEqual(expiresAt);
  });

  it('close() no revienta: el puerto lo exige y aqui no hay nada que cerrar', async () => {
    const directory = createMemoryDirectory();

    await expect(directory.close()).resolves.toBeUndefined();
  });
});
