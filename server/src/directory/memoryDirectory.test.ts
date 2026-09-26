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
import type { DirectoryUser } from './directoryPort.ts';
import { DisplayNameTakenError } from './displayNameRules.ts';
import { InvalidInvitationError } from './invitationRules.ts';
import { createMemoryDirectory } from './memoryDirectory.ts';
import { InvalidUserError } from './userRules.ts';

const HUGO = { uid: 'uid-hugo', email: 'Hugo@Example.com', name: 'Hugo' };
const ANA = { uid: 'uid-ana', email: 'ana@example.com', name: 'Ana' };

/** Fila ya dada de alta, como la dejaria el panel (`createUser`/`createInvitation`). */
function provisioned(overrides: Partial<DirectoryUser> = {}): DirectoryUser {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
    uid: 'uid-ana',
    email: 'ana@example.com',
    displayName: null,
    role: 'employee',
    status: 'active',
    expiresAt: null,
    invitedBy: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('memoryDirectory: resolveOnLogin (falla cerrado, #72)', () => {
  it('una cuenta de Identity Platform sin fila NO se da de alta sola: devuelve null', async () => {
    // El nucleo de #72: tras perder la base de datos, un invitado volvio a
    // entrar y el login lo recreo como empleado permanente, invisible en el
    // panel de invitaciones e irrevocable. Un token valido de Google no dice
    // que esta oficina conozca a esa persona; eso solo lo dice una fila.
    const directory = createMemoryDirectory();

    expect(await directory.resolveOnLogin(ANA)).toBeNull();
    expect(await directory.findByUid('uid-ana')).toBeNull();
  });

  it('devuelve la fila existente por uid, tal cual la dejo el alta', async () => {
    const directory = createMemoryDirectory({
      seed: [provisioned({ role: 'guest', expiresAt: new Date('2099-01-01T00:00:00.000Z') })],
    });

    const user = await directory.resolveOnLogin(ANA);

    expect(user).toMatchObject({
      uid: 'uid-ana',
      email: 'ana@example.com',
      role: 'guest',
      status: 'active',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    });
  });

  it('es idempotente por uid: el segundo login no crea otra fila', async () => {
    const directory = createMemoryDirectory({ seed: [provisioned()] });

    const first = await directory.resolveOnLogin(ANA);
    const second = await directory.resolveOnLogin(ANA);

    expect(second?.id).toBe(first?.id);
  });

  it('NO refresca el nombre visible en el login (#100, D4), ni el rol ni el estado', async () => {
    // El unico camino que escribe `displayName` es la ruta explicita
    // `/me/display-name`. El `name` del token de Identity Platform ya no toca
    // esa columna en ningun login. El rol tampoco puede salir del token: lo
    // decide esta oficina, y sobrescribirlo en cada login borraria cualquier
    // promocion o revocacion hecha desde el panel.
    const directory = createMemoryDirectory({
      seed: [provisioned({ displayName: 'Ana Original', role: 'admin', status: 'revoked' })],
    });

    const again = await directory.resolveOnLogin({ ...ANA, name: 'Ana Gomez' });

    expect(again?.displayName).toBe('Ana Original');
    expect(again?.role).toBe('admin');
    expect(again?.status).toBe('revoked');
  });

  it('devuelve null si el token no trae email: el directorio se indexa por email', async () => {
    // Una cuenta anonima o por telefono no tiene con que casar con una
    // invitacion ni con el email de bootstrap. Antes que inventar una fila sin
    // clave humana, se le niega la entrada.
    const directory = createMemoryDirectory();

    expect(await directory.resolveOnLogin({ uid: 'uid-anon', email: null, name: null })).toBeNull();
  });

  it('un token sin name no vacia el nombre ya guardado (#100, D4): el login no lo toca', async () => {
    const directory = createMemoryDirectory({ seed: [provisioned({ displayName: 'Ana' })] });

    const user = await directory.resolveOnLogin({ ...ANA, name: null });

    expect(user?.displayName).toBe('Ana');
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
    // y no se queda con nada: ni el mando ni, desde #72, una fila de empleada.
    const directory = createMemoryDirectory({ bootstrapSuperadminEmail: 'hugo@example.com' });

    expect(await directory.resolveOnLogin(ANA)).toBeNull();
    expect(await directory.findByUid('uid-ana')).toBeNull();
  });

  it('sin email de bootstrap no promociona ni da de alta a nadie', async () => {
    const directory = createMemoryDirectory();

    expect(await directory.resolveOnLogin(HUGO)).toBeNull();
    expect(await directory.findByUid('uid-hugo')).toBeNull();
  });

  it('normaliza el email a minusculas al crear al superadmin', async () => {
    const directory = createMemoryDirectory({ bootstrapSuperadminEmail: 'hugo@example.com' });

    const user = await directory.resolveOnLogin(HUGO);

    expect(user).toMatchObject({
      uid: 'uid-hugo',
      email: 'hugo@example.com',
      // #100, D4: el bootstrap nace sin nombre elegido, nunca con el del token.
      displayName: null,
      role: 'superadmin',
      status: 'active',
      expiresAt: null,
      invitedBy: null,
    });
  });

  it('el superadmin ya creado vuelve a entrar con su misma fila', async () => {
    const directory = createMemoryDirectory({ bootstrapSuperadminEmail: 'hugo@example.com' });

    const first = await directory.resolveOnLogin(HUGO);
    const second = await directory.resolveOnLogin(HUGO);

    expect(second?.id).toBe(first?.id);
    expect(second?.role).toBe('superadmin');
  });

  it('no crea al superadmin si su email ya esta en otra fila con otro uid', async () => {
    // El email es unico en `users`. En Postgres esto es un 23505 que acaba en
    // "no aprovisionado"; aqui tiene que acabar igual, o los dos adaptadores
    // dejarian de ser intercambiables justo en el camino que da el mando.
    const directory = createMemoryDirectory({
      bootstrapSuperadminEmail: 'hugo@example.com',
      seed: [provisioned({ uid: 'uid-otro', email: 'hugo@example.com' })],
    });

    expect(await directory.resolveOnLogin(HUGO)).toBeNull();
    expect(await directory.findByUid('uid-hugo')).toBeNull();
  });

  it('no promociona si ya existe un superadmin, aunque el email case', async () => {
    // El "y no hay superadmin todavia" es lo que hace que la regla sea un
    // arranque y no una puerta trasera permanente: si el mando ya esta en manos
    // de alguien, volver a poner un email en el entorno no lo recupera. Sin
    // esta mitad de la condicion, quien controle las variables del despliegue
    // se promociona cuando quiera sobre una oficina en marcha. Y desde #72 ni
    // siquiera entra: no tiene fila y ya no hay nada que crearle.
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

    expect(await directory.resolveOnLogin(HUGO)).toBeNull();
    expect(await directory.findByUid('uid-hugo')).toBeNull();
  });
});

describe('memoryDirectory: busquedas', () => {
  it('findByUid encuentra a quien ya entro y devuelve null para un uid desconocido', async () => {
    const directory = createMemoryDirectory({ seed: [provisioned()] });
    const created = await directory.resolveOnLogin(ANA);

    expect((await directory.findByUid('uid-ana'))?.id).toBe(created?.id);
    expect(await directory.findByUid('uid-de-nadie')).toBeNull();
  });

  it('findById encuentra por el id interno y devuelve null para uno inventado', async () => {
    const directory = createMemoryDirectory({ seed: [provisioned()] });
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
    await directory.createUser({
      email: 'ana@example.com',
      role: 'employee',
      uid: 'uid-ana',
      createdById: admin.id,
    });
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

describe('memoryDirectory: findByEmail', () => {
  async function withInvitado() {
    const directory = createMemoryDirectory({ bootstrapSuperadminEmail: 'hugo@example.com' });
    const admin = (await directory.resolveOnLogin(HUGO))!;
    const guest = await directory.createInvitation({
      email: 'Externo@Example.com',
      days: 7,
      invitedById: admin.id,
      uid: 'uid-externo',
    });
    return { directory, admin, guest };
  }

  it('encuentra la fila por su email, sin importar la caja con la que se guardo', async () => {
    const { directory } = await withInvitado();

    // `email` ya llega normalizado (`normalizeEmail`), igual que a
    // `findByUid`/`findById` con su propia clave: el adaptador no repite la
    // normalizacion.
    expect((await directory.findByEmail('externo@example.com'))?.uid).toBe('uid-externo');
  });

  it('devuelve null si nadie usa ese correo', async () => {
    const { directory } = await withInvitado();

    expect(await directory.findByEmail('nadie@example.com')).toBeNull();
  });
});

describe('memoryDirectory: renewInvitation', () => {
  async function withGuest(options: { now?: () => Date } = {}) {
    const directory = createMemoryDirectory({
      bootstrapSuperadminEmail: 'hugo@example.com',
      now: options.now,
    });
    const admin = (await directory.resolveOnLogin(HUGO))!;
    const guest = await directory.createInvitation({
      email: 'externo@example.com',
      days: 90,
      invitedById: admin.id,
      uid: 'uid-externo',
    });
    return { directory, admin, guest };
  }

  it('reemplaza expiresAt por el nuevo `days` a partir de AHORA, sin sumar', async () => {
    const now = new Date('2026-09-17T12:00:00.000Z');
    const { directory, guest } = await withGuest({ now: () => now });
    expect(guest.expiresAt).toEqual(new Date('2026-12-16T12:00:00.000Z'));

    const renewed = await directory.renewInvitation(guest.id, 7);

    // 7 dias desde AHORA, no 90 + 7: reenviar la invitacion no acumula, la
    // fecha vieja se olvida por completo.
    expect(renewed?.expiresAt).toEqual(new Date('2026-09-24T12:00:00.000Z'));
  });

  it('no toca id, uid, invitedBy ni createdAt: solo expiresAt cambia', async () => {
    const { directory, admin, guest } = await withGuest();

    const renewed = await directory.renewInvitation(guest.id, 30);

    expect(renewed).toMatchObject({
      id: guest.id,
      uid: guest.uid,
      invitedBy: admin.id,
      createdAt: guest.createdAt,
    });
  });

  it('devuelve null para un id que no existe', async () => {
    const { directory } = await withGuest();

    expect(
      await directory.renewInvitation('00000000-0000-4000-8000-000000000000', 7),
    ).toBeNull();
  });

  it('rechaza una duracion fuera de 1..90, la misma regla que al crear', async () => {
    const { directory, guest } = await withGuest();

    await expect(directory.renewInvitation(guest.id, 91)).rejects.toBeInstanceOf(
      InvalidInvitationError,
    );
    // Y no deja la fila a medio cambiar.
    expect((await directory.findById(guest.id))?.expiresAt).toEqual(guest.expiresAt);
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

describe('memoryDirectory: alta de alguien de casa', () => {
  async function withAdmin() {
    const directory = createMemoryDirectory({ bootstrapSuperadminEmail: 'hugo@example.com' });
    const admin = await directory.resolveOnLogin(HUGO);
    return { directory, admin: admin! };
  }

  it('crea la fila sin caducidad y sin quien la invito', async () => {
    // Los dos nulos son el alta entera: `expiresAt` null es "no caduca" para
    // `decideAccess`, e `invitedBy` null es lo que la separa de un invitado.
    const { directory, admin } = await withAdmin();

    const created = await directory.createUser({
      email: 'Nueva@Example.COM',
      role: 'employee',
      uid: 'uid-nueva',
      createdById: admin.id,
    });

    expect(created).toMatchObject({
      uid: 'uid-nueva',
      email: 'nueva@example.com',
      displayName: null,
      role: 'employee',
      status: 'active',
      expiresAt: null,
      invitedBy: null,
    });
  });

  it('da de alta tambien administradores', async () => {
    const { directory, admin } = await withAdmin();

    const created = await directory.createUser({
      email: 'jefa@example.com',
      role: 'admin',
      uid: 'uid-jefa',
      createdById: admin.id,
    });

    expect(created.role).toBe('admin');
  });

  it('deja rastro en la auditoria de quien dio de alta a quien (PRD 10)', async () => {
    const { directory, admin } = await withAdmin();

    const created = await directory.createUser({
      email: 'nueva@example.com',
      role: 'employee',
      uid: 'uid-nueva',
      createdById: admin.id,
    });

    expect(directory.auditLog()).toEqual([
      { actorId: admin.id, action: 'create-user', subjectId: created.id },
    ]);
  });

  it('rechaza un rol que el panel no reparte', async () => {
    const { directory, admin } = await withAdmin();

    await expect(
      directory.createUser({
        email: 'nueva@example.com',
        role: 'superadmin' as never,
        uid: 'uid-nueva',
        createdById: admin.id,
      }),
    ).rejects.toBeInstanceOf(InvalidUserError);
  });

  it('un rol invalido no deja ni fila ni rastro de auditoria', async () => {
    // La validacion va ANTES de tocar nada: medio alta es peor que ninguna,
    // porque quien administra ve un error y la fila existe igual.
    const { directory, admin } = await withAdmin();

    await expect(
      directory.createUser({
        email: 'nueva@example.com',
        role: 'guest' as never,
        uid: 'uid-nueva',
        createdById: admin.id,
      }),
    ).rejects.toBeInstanceOf(InvalidUserError);

    expect(await directory.findByUid('uid-nueva')).toBeNull();
    expect(directory.auditLog()).toEqual([]);
  });

  it('la fila NO aparece en la lista de invitaciones', async () => {
    // Es la primera de las dos garantias del `invitedBy` nulo: quien entra por
    // aqui no es un invitado y el panel de invitaciones no tiene que ensenarlo
    // como si lo fuera, con una caducidad que no existe.
    const { directory, admin } = await withAdmin();
    await directory.createUser({
      email: 'nueva@example.com',
      role: 'employee',
      uid: 'uid-nueva',
      createdById: admin.id,
    });
    await directory.createInvitation({
      email: 'externo@example.com',
      days: 7,
      invitedById: admin.id,
      uid: 'uid-externo',
    });

    const emails = (await directory.listInvitations()).map((row) => row.email);

    expect(emails).toEqual(['externo@example.com']);
  });

  it('y NO se puede revocar desde el panel de invitaciones', async () => {
    // La segunda garantia, y la que de verdad importa: `revoke` devuelve `null`
    // para una fila sin `invitedBy`, asi que el panel de invitaciones no se
    // convierte en un boton de expulsion del personal.
    const { directory, admin } = await withAdmin();
    const created = await directory.createUser({
      email: 'nueva@example.com',
      role: 'employee',
      uid: 'uid-nueva',
      createdById: admin.id,
    });

    expect(await directory.revoke(created.id, admin.id)).toBeNull();
    expect((await directory.findById(created.id))?.status).toBe('active');
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

describe('memoryDirectory: setDisplayName (#100)', () => {
  it('escribe el valor YA canonicalizado por quien llama', async () => {
    const directory = createMemoryDirectory({ seed: [provisioned()] });

    const user = await directory.setDisplayName(
      'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
      'Ana Lopez',
    );

    expect(user?.displayName).toBe('Ana Lopez');
    expect((await directory.findById('aaaaaaaa-aaaa-4aaa-8aaa-000000000001'))?.displayName).toBe(
      'Ana Lopez',
    );
  });

  it('rechaza un nombre ya tomado por OTRA cuenta, comparado sin distinguir mayusculas/espacios', async () => {
    const directory = createMemoryDirectory({
      seed: [
        provisioned({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', displayName: 'Ana Lopez' }),
        provisioned({
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002',
          uid: 'uid-bea',
          email: 'bea@example.com',
        }),
      ],
    });

    await expect(
      directory.setDisplayName('aaaaaaaa-aaaa-4aaa-8aaa-000000000002', 'ana   lopez'),
    ).rejects.toBeInstanceOf(DisplayNameTakenError);
  });

  it('re-someter el propio nombre actual no es un conflicto (D4)', async () => {
    const directory = createMemoryDirectory({
      seed: [provisioned({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', displayName: 'Ana Lopez' })],
    });

    await expect(
      directory.setDisplayName('aaaaaaaa-aaaa-4aaa-8aaa-000000000001', 'Ana Lopez'),
    ).resolves.toMatchObject({ displayName: 'Ana Lopez' });
  });

  it('un id que no existe devuelve null', async () => {
    const directory = createMemoryDirectory();

    expect(
      await directory.setDisplayName('00000000-0000-4000-8000-000000000000', 'Ana'),
    ).toBeNull();
  });

  // Los nombres derivados ("Invitado", la parte local del correo) se calculan al
  // entrar y nunca se guardan: no reservan nada, solo compite lo que otra cuenta
  // eligio y quedo en `display_name`.
  it('los nombres de respaldo no estan reservados: "Invitado" y la parte local del correo de otra cuenta se aceptan', async () => {
    const directory = createMemoryDirectory({
      seed: [
        provisioned({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001' }),
        provisioned({
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002',
          uid: 'uid-bea',
          email: 'bea@example.com',
        }),
      ],
    });

    await expect(
      directory.setDisplayName('aaaaaaaa-aaaa-4aaa-8aaa-000000000001', 'Invitado'),
    ).resolves.toMatchObject({ displayName: 'Invitado' });
    await expect(
      directory.setDisplayName('aaaaaaaa-aaaa-4aaa-8aaa-000000000002', 'ana'),
    ).resolves.toMatchObject({ displayName: 'ana' });
  });
});

describe('memoryDirectory: listUsers (#93)', () => {
  it('lists every user, not only invitations, oldest first', async () => {
    const directory = createMemoryDirectory({ bootstrapSuperadminEmail: 'hugo@example.com' });
    const superadmin = (await directory.resolveOnLogin(HUGO))!;
    const employee = await directory.createUser({
      email: 'ana@example.com',
      role: 'employee',
      uid: 'uid-ana',
      createdById: superadmin.id,
    });
    const guest = await directory.createInvitation({
      email: 'externo@example.com',
      days: 7,
      invitedById: superadmin.id,
      uid: 'uid-externo',
    });

    const users = await directory.listUsers();

    expect(users.map((user) => user.id)).toEqual([superadmin.id, employee.id, guest.id]);
    expect(users[0]).toMatchObject({ role: 'superadmin', status: 'active', invitedBy: null });
    expect(users[2]).toMatchObject({ role: 'guest', invitedBy: superadmin.id });
    expect(users[2].expiresAt).toBeInstanceOf(Date);
  });

  it('returns copies: mutating the list does not touch the store', async () => {
    const directory = createMemoryDirectory({ seed: [provisioned()] });

    const [first] = await directory.listUsers();
    first.status = 'revoked';

    expect((await directory.listUsers())[0].status).toBe('active');
  });
});

describe('memoryDirectory: revokeUser (#93)', () => {
  const SUPERADMIN = provisioned({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000009',
    uid: 'uid-hugo',
    email: 'hugo@example.com',
    role: 'superadmin',
  });

  function withStaff() {
    const employee = provisioned();
    const directory = createMemoryDirectory({ seed: [SUPERADMIN, employee] });
    return { directory, employee };
  }

  it('revokes someone who did not come by invitation and returns the changed row', async () => {
    const { directory, employee } = withStaff();

    const revoked = await directory.revokeUser(employee.id, SUPERADMIN.id);

    expect(revoked?.status).toBe('revoked');
    expect((await directory.findById(employee.id))?.status).toBe('revoked');
  });

  it('writes its own audit action', async () => {
    const { directory, employee } = withStaff();

    await directory.revokeUser(employee.id, SUPERADMIN.id);

    expect(directory.auditLog()).toEqual([
      { actorId: SUPERADMIN.id, action: 'revoke-user', subjectId: employee.id },
    ]);
  });

  it('revokes an invitation too', async () => {
    const guest = provisioned({ role: 'guest', invitedBy: SUPERADMIN.id });
    const directory = createMemoryDirectory({ seed: [SUPERADMIN, guest] });

    expect((await directory.revokeUser(guest.id, SUPERADMIN.id))?.status).toBe('revoked');
  });

  it('returns null for an unknown id', async () => {
    const { directory } = withStaff();

    expect(await directory.revokeUser('00000000-0000-4000-8000-000000000000', SUPERADMIN.id)).toBeNull();
    expect(directory.auditLog()).toEqual([]);
  });

  it('never touches the superadmin, whoever asks', async () => {
    // The route already refuses with `canRemove`; this is the second lock, so
    // no caller of the port can lock the office out of its only superadmin.
    const { directory, employee } = withStaff();

    expect(await directory.revokeUser(SUPERADMIN.id, employee.id)).toBeNull();
    expect((await directory.findById(SUPERADMIN.id))?.status).toBe('active');
    expect(directory.auditLog()).toEqual([]);
  });

  it('revoking twice is harmless and audits only the real change', async () => {
    const { directory, employee } = withStaff();

    await directory.revokeUser(employee.id, SUPERADMIN.id);
    const second = await directory.revokeUser(employee.id, SUPERADMIN.id);

    expect(second?.status).toBe('revoked');
    expect(directory.auditLog()).toHaveLength(1);
  });
});
