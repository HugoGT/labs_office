/**
 * Las rutas de administracion (#24), probadas como funciones puras y sin montar
 * Express, igual que `handleLivekitToken`. Lo que se prueba aqui es el CONTRATO
 * -- codigo, cuerpo y, sobre todo, el ORDEN de las guardas -- porque ese orden
 * es la defensa real de #24 punto 5: el panel esconde su interfaz a quien no
 * administra, pero eso no protege nada; cualquiera con un ID token valido puede
 * llamar a estos endpoints a mano con curl.
 *
 * Todo contra `memoryDirectory`, nunca contra Postgres: una suite que necesita
 * infraestructura acaba sin correrse (ver la cabecera de `memoryDirectory.ts`).
 */

import { describe, expect, it, vi } from 'vitest';
import type { DirectoryUser } from '../directory/directoryPort.ts';
import { createMemoryDirectory, type MemoryDirectory } from '../directory/memoryDirectory.ts';
import type { IdTokenVerifier } from '../verifyIdToken.ts';
import {
  handleAdminSession,
  handleCreateInvitation,
  handleCreateUser,
  handleListInvitations,
  handleListUsers,
  handleRevokeInvitation,
  handleRevokeUser,
  handleSendPasswordReset,
  type AdminDeps,
} from './adminRoutes.ts';
import { PASSWORD_LENGTH } from './generatePassword.ts';
import { IdentityAdminError, type IdentityAdmin } from './identityAdminPort.ts';

const NOW = new Date('2026-01-15T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function at(offsetMs: number): Date {
  return new Date(NOW.getTime() + offsetMs);
}

function user(overrides: Partial<DirectoryUser> & Pick<DirectoryUser, 'id' | 'uid'>): DirectoryUser {
  return {
    email: `${overrides.id}@example.com`,
    displayName: null,
    role: 'employee',
    status: 'active',
    expiresAt: null,
    invitedBy: null,
    createdAt: at(-30 * DAY),
    ...overrides,
  };
}

const ADMIN = user({ id: 'id-admin', uid: 'uid-admin', role: 'admin', displayName: 'Admin Ana' });
const SUPERADMIN = user({ id: 'id-super', uid: 'uid-super', role: 'superadmin' });
const EMPLEADO = user({ id: 'id-empleado', uid: 'uid-empleado', role: 'employee' });
const CADUCADO = user({
  id: 'id-caducado',
  uid: 'uid-caducado',
  role: 'admin',
  expiresAt: at(-DAY),
  invitedBy: ADMIN.id,
});
const REVOCADO = user({
  id: 'id-revocado',
  uid: 'uid-revocado',
  role: 'admin',
  status: 'revoked',
  invitedBy: ADMIN.id,
});

/** Doble indexado por token; las firmas de verdad ya las prueba `verifyIdToken.test.ts`. */
const verifier: IdTokenVerifier = {
  async verify(token: unknown) {
    const uid = typeof token === 'string' ? token.replace(/^valido-/, '') : null;
    if (uid === null || uid === token) return null;
    return { uid, email: `${uid}@example.com`, name: null };
  },
};

const TOKEN_ADMIN = 'valido-uid-admin';
const TOKEN_SUPER = 'valido-uid-super';
const TOKEN_EMPLEADO = 'valido-uid-empleado';
const TOKEN_CADUCADO = 'valido-uid-caducado';
const TOKEN_REVOCADO = 'valido-uid-revocado';
const TOKEN_FANTASMA = 'valido-uid-que-no-esta-en-el-directorio';

function bearer(token: string): string {
  return `Bearer ${token}`;
}

interface Harness {
  deps: AdminDeps;
  directory: MemoryDirectory;
  identityAdmin: IdentityAdmin;
  logged: string[];
  created: { email: string; password: string }[];
  disabled: string[];
  /** Emails a password-reset link was requested for (#94), in order. */
  resets: string[];
}

function harness(
  options: {
    seed?: DirectoryUser[];
    identityAdmin?: IdentityAdmin | null;
    auth?: IdTokenVerifier;
    createAccount?: (email: string, password: string) => Promise<string>;
    disableAccount?: (uid: string) => Promise<void>;
    sendPasswordReset?: (email: string) => Promise<void>;
  } = {},
): Harness {
  const directory = createMemoryDirectory({
    now: () => NOW,
    seed: options.seed ?? [ADMIN, SUPERADMIN, EMPLEADO, CADUCADO, REVOCADO],
  });
  const logged: string[] = [];
  const created: { email: string; password: string }[] = [];
  const disabled: string[] = [];
  const resets: string[] = [];

  const identityAdmin: IdentityAdmin = {
    async createAccount(email, password) {
      created.push({ email, password });
      if (options.createAccount) return options.createAccount(email, password);
      return `uid-nuevo-${created.length}`;
    },
    async disableAccount(uid) {
      disabled.push(uid);
      if (options.disableAccount) await options.disableAccount(uid);
    },
    async sendPasswordReset(email) {
      resets.push(email);
      if (options.sendPasswordReset) await options.sendPasswordReset(email);
    },
  };

  return {
    directory,
    identityAdmin,
    logged,
    created,
    disabled,
    resets,
    deps: {
      directory,
      auth: 'auth' in options ? options.auth : verifier,
      identityAdmin: options.identityAdmin === undefined ? identityAdmin : options.identityAdmin,
      now: () => NOW,
      log: (message) => logged.push(message),
    },
  };
}

/**
 * Las cinco rutas comparten el mismo principio de las guardas. Se recorren en
 * bucle para que anadir una sexta ruta sin su guarda salte aqui, en vez de
 * quedarse como un endpoint abierto que nadie mira.
 */
const rutas: { nombre: string; llamar: (auth: unknown, deps: AdminDeps) => Promise<unknown> }[] = [
  { nombre: 'GET /admin/session', llamar: (auth, deps) => handleAdminSession(auth, deps) },
  { nombre: 'GET /admin/invitations', llamar: (auth, deps) => handleListInvitations(auth, deps) },
  {
    nombre: 'POST /admin/invitations',
    llamar: (auth, deps) => handleCreateInvitation(auth, { email: 'x@example.com', days: 7 }, deps),
  },
  {
    nombre: 'POST /admin/invitations/:id/revoke',
    llamar: (auth, deps) => handleRevokeInvitation(auth, CADUCADO.id, deps),
  },
  {
    nombre: 'POST /admin/users',
    llamar: (auth, deps) =>
      handleCreateUser(auth, { email: 'x@example.com', role: 'employee' }, deps),
  },
  {
    nombre: 'POST /admin/users/:id/password-reset',
    llamar: (auth, deps) => handleSendPasswordReset(auth, EMPLEADO.id, deps),
  },
];

describe('autenticacion, comun a todas las rutas', () => {
  for (const { nombre, llamar } of rutas) {
    describe(nombre, () => {
      it('401 sin cabecera Authorization', async () => {
        const { deps } = harness();
        expect(await llamar(undefined, deps)).toEqual({
          status: 401,
          body: { error: 'unauthorized' },
        });
      });

      it('401 con una cabecera mal formada', async () => {
        const { deps } = harness();
        // Ninguna de estas es "el cuerpo esta mal" (400): el llamante solo
        // aprende "no autorizado", igual que en `handleLivekitToken`.
        for (const header of ['', 'Bearer', 'Bearer ', 'abc', 'Basic dXNlcjpwYXNz', 42, null]) {
          expect(await llamar(header, deps)).toEqual({
            status: 401,
            body: { error: 'unauthorized' },
          });
        }
      });

      it('401 con un token que no verifica', async () => {
        const { deps } = harness();
        expect(await llamar(bearer('token-forjado'), deps)).toEqual({
          status: 401,
          body: { error: 'unauthorized' },
        });
      });

      it('401 si el uid no esta en el directorio (not-provisioned)', async () => {
        const { deps } = harness();
        expect(await llamar(bearer(TOKEN_FANTASMA), deps)).toEqual({
          status: 401,
          body: { error: 'unauthorized' },
        });
      });

      it('401 si la cuenta caduco, aunque su rol administre', async () => {
        // La caducidad es el corazon de #24: un administrador invitado que
        // vencio ayer sigue teniendo un ID token valido durante una hora.
        const { deps } = harness();
        expect(await llamar(bearer(TOKEN_CADUCADO), deps)).toEqual({
          status: 401,
          body: { error: 'unauthorized' },
        });
      });

      it('401 si la cuenta esta revocada, aunque su rol administre', async () => {
        const { deps } = harness();
        expect(await llamar(bearer(TOKEN_REVOCADO), deps)).toEqual({
          status: 401,
          body: { error: 'unauthorized' },
        });
      });

      it('401 y falla cerrado si el servidor no tiene verificador', async () => {
        // Sin `FIREBASE_PROJECT_ID` no hay forma de saber quien llama. Abrir la
        // ruta "porque la auth esta desactivada" dejaria el panel de
        // administracion accesible a cualquiera que sepa la url.
        const { deps, logged } = harness({ auth: undefined });
        expect(await llamar(bearer(TOKEN_ADMIN), deps)).toEqual({
          status: 401,
          body: { error: 'unauthorized' },
        });
        // El llamante no se entera de por que; el operador si, o el sintoma
        // seria "el panel dice no autorizado a todo el mundo" sin una pista.
        expect(logged.join('\n')).toContain('sin verificador');
      });
    });
  }

  it('REGRESION: un token forjado y un uid sin fila responden EXACTAMENTE igual', async () => {
    // El orden de las guardas es la defensa. Si el directorio se consultase
    // antes de verificar la firma, o si "no provisionado" tuviese su propio
    // codigo, quien sondea distinguiria un uid que existe en el proyecto de uno
    // inventado, y eso es un oraculo para ir afinando. Mismo argumento que la
    // regresion de `handleLivekitToken`.
    const { deps } = harness();

    const forjado = await handleAdminSession(bearer('token-forjado'), deps);
    const fantasma = await handleAdminSession(bearer(TOKEN_FANTASMA), deps);
    const caducado = await handleAdminSession(bearer(TOKEN_CADUCADO), deps);
    const revocado = await handleAdminSession(bearer(TOKEN_REVOCADO), deps);

    expect(forjado).toEqual(fantasma);
    expect(forjado).toEqual(caducado);
    expect(forjado).toEqual(revocado);
  });

  it('acepta el esquema Bearer en cualquier caja (RFC 7235)', async () => {
    const { deps } = harness();
    for (const header of [`bearer ${TOKEN_ADMIN}`, `BEARER ${TOKEN_ADMIN}`]) {
      expect((await handleAdminSession(header, deps)).status).toBe(200);
    }
  });
});

describe('autorizacion: solo superadmin y admin administran', () => {
  const soloAdmin = rutas.filter((ruta) => ruta.nombre !== 'GET /admin/session');

  for (const { nombre, llamar } of soloAdmin) {
    it(`${nombre} responde 403 a un empleado autenticado`, async () => {
      // 403 y no 401 a proposito: quien llama ya ha probado quien es, y decirle
      // que no administra no le revela nada que no supiera. Es la misma
      // separacion que hace `handleLivekitToken` entre 401 y forbidden-session.
      const { deps } = harness();
      expect(await llamar(bearer(TOKEN_EMPLEADO), deps)).toEqual({
        status: 403,
        body: { error: 'forbidden' },
      });
    });
  }

  it('la guarda de rol corre ANTES de validar el cuerpo', async () => {
    // Si el 400 fuese primero, un empleado podria ir probando cuerpos hasta
    // aprender la forma exacta que espera el endpoint que no puede usar.
    const { deps } = harness();

    expect(await handleCreateInvitation(bearer(TOKEN_EMPLEADO), { basura: true }, deps)).toEqual({
      status: 403,
      body: { error: 'forbidden' },
    });
  });

  it('la guarda de rol corre ANTES de tocar el directorio', async () => {
    const { deps, directory } = harness();
    const spy = vi.spyOn(directory, 'revoke');

    await handleRevokeInvitation(bearer(TOKEN_EMPLEADO), CADUCADO.id, deps);

    expect(spy).not.toHaveBeenCalled();
  });

  it('un superadmin administra igual que un admin', async () => {
    const { deps } = harness();
    expect((await handleListInvitations(bearer(TOKEN_SUPER), deps)).status).toBe(200);
  });
});

describe('GET /admin/session', () => {
  it('responde a CUALQUIER usuario autenticado y permitido, no solo a quien administra', async () => {
    // Es la ruta con la que el panel decide si pinta el panel o la pantalla de
    // "no autorizado". Si exigiese rol de administrador, un empleado recibiria
    // 403, el cliente lo traduciria a un error y esa pantalla no se pintaria
    // jamas: el usuario veria un fallo donde deberia ver una explicacion.
    const { deps } = harness();

    const result = await handleAdminSession(bearer(TOKEN_EMPLEADO), deps);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      role: 'employee',
      email: EMPLEADO.email,
      displayName: null,
      expiresAt: null,
    });
  });

  it('devuelve el rol, el email y el nombre visible de quien administra', async () => {
    const { deps } = harness();

    expect(await handleAdminSession(bearer(TOKEN_ADMIN), deps)).toEqual({
      status: 200,
      body: {
        role: 'admin',
        email: ADMIN.email,
        displayName: 'Admin Ana',
        expiresAt: null,
      },
    });
  });

  it('serializa expiresAt como ISO 8601, o null si la cuenta no vence', async () => {
    const invitado = user({
      id: 'id-invitado',
      uid: 'uid-invitado',
      role: 'guest',
      expiresAt: at(3 * DAY),
      invitedBy: ADMIN.id,
    });
    const { deps } = harness({ seed: [ADMIN, invitado] });

    const result = await handleAdminSession(bearer('valido-uid-invitado'), deps);

    expect(result.body.expiresAt).toBe('2026-01-18T12:00:00.000Z');
  });

  it('no filtra el uid ni el id interno: el panel no los necesita', async () => {
    const { deps } = harness();

    const { body } = await handleAdminSession(bearer(TOKEN_ADMIN), deps);

    expect(body).not.toHaveProperty('uid');
    expect(body).not.toHaveProperty('id');
  });
});

describe('GET /admin/invitations', () => {
  const activa = user({
    id: 'id-activa',
    uid: 'uid-activa',
    email: 'activa@example.com',
    role: 'guest',
    expiresAt: at(3 * DAY),
    invitedBy: ADMIN.id,
    createdAt: at(-DAY),
  });
  const vencida = user({
    id: 'id-vencida',
    uid: 'uid-vencida',
    email: 'vencida@example.com',
    role: 'guest',
    expiresAt: at(-10 * DAY),
    invitedBy: ADMIN.id,
  });
  const sinCaducidad = user({
    id: 'id-sin-caducidad',
    uid: 'uid-sin-caducidad',
    email: 'eterna@example.com',
    role: 'guest',
    expiresAt: null,
    invitedBy: ADMIN.id,
  });
  const huerfana = user({
    id: 'id-huerfana',
    uid: 'uid-huerfana',
    email: 'huerfana@example.com',
    role: 'guest',
    expiresAt: at(DAY),
    invitedBy: 'id-que-ya-no-existe',
  });

  function listar(seed: DirectoryUser[]) {
    const { deps } = harness({ seed: [ADMIN, EMPLEADO, ...seed] });
    return handleListInvitations(bearer(TOKEN_ADMIN), deps);
  }

  it('envuelve la lista en un objeto, que es lo que desempaqueta el cliente', async () => {
    const { status, body } = await listar([activa]);

    expect(status).toBe(200);
    expect(Array.isArray(body.invitations)).toBe(true);
  });

  it('serializa las fechas como ISO 8601 y calcula daysLeft en el servidor', async () => {
    const { body } = await listar([activa]);

    expect((body.invitations as unknown[])[0]).toEqual({
      id: 'id-activa',
      email: 'activa@example.com',
      role: 'guest',
      status: 'active',
      createdAt: '2026-01-14T12:00:00.000Z',
      expiresAt: '2026-01-18T12:00:00.000Z',
      daysLeft: 3,
      invitedByEmail: ADMIN.email,
    });
  });

  it('daysLeft nunca es negativo: una invitacion vencida muestra 0', async () => {
    // Un numero negativo en la tabla no significa nada para quien la mira, y el
    // cliente pinta `daysLeft` tal cual. Cero es "ya no vale", que es la verdad.
    const { body } = await listar([vencida]);

    expect((body.invitations as { daysLeft: number }[])[0].daysLeft).toBe(0);
  });

  it('daysLeft es null cuando la invitacion no caduca', async () => {
    const { body } = await listar([sinCaducidad]);

    expect((body.invitations as { daysLeft: number | null }[])[0]).toMatchObject({
      expiresAt: null,
      daysLeft: null,
    });
  });

  it('redondea hacia arriba: recien creada con 7 dias muestra 7, no 6', async () => {
    // `expiresAt` se calcula como now + dias*24h, asi que en el instante del
    // alta faltan exactamente 7 dias. Truncar mostraria 7 solo durante el
    // primer milisegundo y 6 el resto del dia, y el administrador acabaria de
    // dar de alta la invitacion.
    const recien = user({
      id: 'id-recien',
      uid: 'uid-recien',
      role: 'guest',
      expiresAt: at(7 * DAY - 1),
      invitedBy: ADMIN.id,
    });

    const { body } = await listar([recien]);

    expect((body.invitations as { daysLeft: number }[])[0].daysLeft).toBe(7);
  });

  it('invitedByEmail es null si quien invito ya no se puede resolver', async () => {
    const { body } = await listar([huerfana]);

    expect((body.invitations as { invitedByEmail: string | null }[])[0].invitedByEmail).toBeNull();
  });

  it('no incluye a empleados ni administradores: solo invitaciones', async () => {
    const { body } = await listar([activa]);

    const emails = (body.invitations as { email: string }[]).map((row) => row.email);
    expect(emails).toEqual(['activa@example.com']);
  });

  it('nunca expone el uid de Identity Platform de un invitado', async () => {
    const { body } = await listar([activa]);

    expect(JSON.stringify(body)).not.toContain('uid-activa');
  });
});

describe('POST /admin/invitations', () => {
  function crear(body: unknown, options?: Parameters<typeof harness>[0]) {
    const h = harness(options);
    return { h, result: handleCreateInvitation(bearer(TOKEN_ADMIN), body, h.deps) };
  }

  /**
   * El sembrado por defecto ya trae dos invitaciones (la caducada y la
   * revocada), asi que "no se guardo nada" no es "la tabla esta vacia": es que
   * no aparecio una fila para ESTE correo.
   */
  async function sinFilaPara(h: Harness, email: string) {
    const emails = (await h.directory.listInvitations()).map((row) => row.email);
    expect(emails).not.toContain(email);
  }

  describe('validacion, antes de tocar nada', () => {
    it('400 si el email falta, no es texto o no tiene forma de email', async () => {
      for (const email of [undefined, null, 42, '', '   ', 'sin-arroba', 'a@b', 'a b@c.com']) {
        const { result } = crear({ email, days: 7 });
        expect(await result).toEqual({ status: 400, body: { error: 'invalid-request' } });
      }
    });

    it('400 si los dias estan fuera de 1..90, no son enteros o vienen como texto', async () => {
      // La regla vive en `assertValidInvitationDays`; aqui solo se comprueba que
      // la ruta la USA, sin volver a escribir el 1..90 en otro sitio.
      for (const days of [undefined, 0, 91, -1, 1.5, '30', NaN, Infinity]) {
        const { result } = crear({ email: 'ana@example.com', days });
        expect(await result).toEqual({ status: 400, body: { error: 'invalid-request' } });
      }
    });

    it('acepta los dos extremos del rango', async () => {
      for (const days of [1, 90]) {
        const { result } = crear({ email: 'ana@example.com', days });
        expect((await result).status).toBe(201);
      }
    });

    it('400 si el cuerpo no es ni un objeto', async () => {
      for (const body of [undefined, null, 'texto', 42, []]) {
        const { result } = crear(body);
        expect(await result).toEqual({ status: 400, body: { error: 'invalid-request' } });
      }
    });

    it('la validacion corre ANTES de mirar si hay adaptador de Identity', async () => {
      // Al reves, un administrador que escribe mal el correo recibiria
      // "identity-admin-not-configured" y se pondria a revisar el despliegue.
      const { result } = crear({ email: 'mal', days: 7 }, { identityAdmin: null });

      expect(await result).toEqual({ status: 400, body: { error: 'invalid-request' } });
    });

    it('no crea ninguna cuenta cuando la validacion falla', async () => {
      const { h, result } = crear({ email: 'mal', days: 7 });
      await result;

      expect(h.created).toEqual([]);
      await sinFilaPara(h, 'mal');
    });
  });

  it('503 identity-admin-not-configured cuando no hay credencial de servicio', async () => {
    // Es la degradacion que documenta `office-deploy.sh`: sin el secreto, el
    // resto del panel funciona y solo el alta responde 503.
    const { h, result } = crear({ email: 'ana@example.com', days: 7 }, { identityAdmin: null });

    expect(await result).toEqual({
      status: 503,
      body: { error: 'identity-admin-not-configured' },
    });
    await sinFilaPara(h, 'ana@example.com');
  });

  it('201 with id, email, expiry and emailSent, and never a password (#94)', async () => {
    const { result } = crear({ email: 'ana@example.com', days: 7 });
    const { status, body } = await result;

    expect(status).toBe(201);
    expect(body).toEqual({
      id: expect.any(String),
      email: 'ana@example.com',
      expiresAt: '2026-01-22T12:00:00.000Z',
      emailSent: true,
    });
  });

  it('creates the account with a strong random password that is never returned', async () => {
    const { h, result } = crear({ email: 'ana@example.com', days: 7 });
    const { body } = await result;

    expect(h.created).toHaveLength(1);
    expect(h.created[0].password).toHaveLength(PASSWORD_LENGTH);
    expect(JSON.stringify(body)).not.toContain(h.created[0].password);
  });

  it('emails a password-reset link to the invited address once the row exists', async () => {
    const { h, result } = crear({ email: '  Ana@Example.COM  ', days: 7 });
    await result;

    expect(h.resets).toEqual(['ana@example.com']);
  });

  it('sends the email AFTER saving the row: a failed save sends nothing', async () => {
    const h = harness();
    const order: string[] = [];
    vi.spyOn(h.directory, 'createInvitation').mockImplementation(async () => {
      order.push('row');
      throw new Error('la base de datos');
    });

    await handleCreateInvitation(bearer(TOKEN_ADMIN), { email: 'ana@example.com', days: 7 }, h.deps);

    expect(order).toEqual(['row']);
    expect(h.resets).toEqual([]);
  });

  describe('when the reset email cannot be sent', () => {
    function conFalloAlEnviar() {
      const h = harness({
        sendPasswordReset: async () => {
          throw new IdentityAdminError('unavailable');
        },
      });
      return {
        h,
        result: handleCreateInvitation(bearer(TOKEN_ADMIN), { email: 'ana@example.com', days: 7 }, h.deps),
      };
    }

    it('keeps the invitation and answers 201 with emailSent: false so the admin retries', async () => {
      const { h, result } = conFalloAlEnviar();
      const { status, body } = await result;

      expect(status).toBe(201);
      expect(body.emailSent).toBe(false);
      expect((await h.directory.listInvitations()).map((row) => row.email)).toContain(
        'ana@example.com',
      );
      // Rolling back would throw away a valid account over a transient email
      // failure; the admin can re-send instead.
      expect(h.disabled).toEqual([]);
    });

    it('logs the uid so the operator can find the account, without the password', async () => {
      const { h, result } = conFalloAlEnviar();
      await result;

      const log = h.logged.join('\n');
      expect(log).toContain('uid-nuevo-1');
      expect(log).not.toContain(h.created[0].password);
    });
  });

  it('does not email anyone when the account already exists (409)', async () => {
    const { h, result } = crear(
      { email: 'ana@example.com', days: 7 },
      {
        createAccount: async () => {
          throw new IdentityAdminError('email-exists');
        },
      },
    );
    await result;

    expect(h.resets).toEqual([]);
  });

  it('normaliza el email antes de crear la cuenta y la fila', async () => {
    // `Ana@Example.com` y `ana@example.com` tienen que ser la misma persona en
    // los dos lados, o el indice unico del directorio no protege de nada.
    const { h, result } = crear({ email: '  Ana@Example.COM  ', days: 7 });
    const { body } = await result;

    expect(body.email).toBe('ana@example.com');
    expect(h.created[0].email).toBe('ana@example.com');
    expect((await h.directory.listInvitations())[0].email).toBe('ana@example.com');
  });

  it('guarda la fila con el uid que devolvio Identity Platform y con quien invito', async () => {
    const { h, result } = crear({ email: 'ana@example.com', days: 7 });
    await result;

    const [fila] = await h.directory.listInvitations();
    expect(fila.uid).toBe('uid-nuevo-1');
    expect(fila.invitedBy).toBe(ADMIN.id);
    expect(fila.role).toBe('guest');
    expect(h.directory.auditLog()).toEqual([
      { actorId: ADMIN.id, action: 'invite', subjectId: fila.id },
    ]);
  });

  it('409 conflict cuando ese correo ya tiene cuenta', async () => {
    const { h, result } = crear(
      { email: 'ana@example.com', days: 7 },
      {
        createAccount: async () => {
          throw new IdentityAdminError('email-exists');
        },
      },
    );

    expect(await result).toEqual({ status: 409, body: { error: 'conflict' } });
    // Y NO queda una fila de invitacion sin cuenta detras.
    await sinFilaPara(h, 'ana@example.com');
  });

  it('503 cuando Identity Platform no responde', async () => {
    const { h, result } = crear(
      { email: 'ana@example.com', days: 7 },
      {
        createAccount: async () => {
          throw new IdentityAdminError('unavailable');
        },
      },
    );

    expect(await result).toEqual({
      status: 503,
      body: { error: 'identity-admin-not-configured' },
    });
    await sinFilaPara(h, 'ana@example.com');
  });

  describe('la cuenta huerfana', () => {
    /**
     * El hueco: `createAccount` funciona y `createInvitation` falla despues.
     * Queda una cuenta en Identity Platform que NO tiene fila en el directorio.
     * Esa cuenta puede autenticarse, asi que `OfficeRoom.onAuth` la vera como
     * `not-provisioned` y la echara... mientras el directorio siga configurado.
     * Pero la cuenta existe, tiene contrasena conocida por alguien, y nadie
     * puede verla ni revocarla desde el panel, porque el panel lista filas del
     * directorio y esa fila no existe. Es una credencial fuera de inventario.
     */
    function conFalloAlGuardar(disableAccount?: (uid: string) => Promise<void>) {
      const h = harness({ disableAccount });
      vi.spyOn(h.directory, 'createInvitation').mockRejectedValue(new Error('la base de datos'));
      return { h, result: handleCreateInvitation(bearer(TOKEN_ADMIN), { email: 'ana@example.com', days: 7 }, h.deps) };
    }

    it('compensa desactivando la cuenta que se acaba de crear', async () => {
      const { h, result } = conFalloAlGuardar();
      await result;

      expect(h.disabled).toEqual(['uid-nuevo-1']);
    });

    it('responde 500 y no finge que el alta salio bien', async () => {
      const { result } = conFalloAlGuardar();

      expect(await result).toEqual({ status: 500, body: { error: 'internal' } });
    });

    it('deja constancia en el log de las dos cosas que pasaron', async () => {
      const { h, result } = conFalloAlGuardar();
      await result;

      const log = h.logged.join('\n');
      expect(log).toContain('huerfana');
      expect(log).toContain('uid-nuevo-1');
    });

    it('si la compensacion tambien falla, lo grita en el log y sigue respondiendo 500', async () => {
      // Aqui si queda una credencial viva fuera de inventario y hace falta
      // borrarla a mano desde la consola de GCP. El log es la unica forma de
      // saber cual.
      const { h, result } = conFalloAlGuardar(async () => {
        throw new IdentityAdminError('unavailable');
      });

      expect(await result).toEqual({ status: 500, body: { error: 'internal' } });
      expect(h.logged.join('\n')).toContain('a mano');
    });
  });

  describe('la contrasena no sale de la respuesta', () => {
    it('REGRESION: no llega al logger inyectado', async () => {
      const { h, result } = crear({ email: 'ana@example.com', days: 7 });
      await result;

      expect(h.logged.join('\n')).not.toContain(h.created[0].password);
    });

    it('REGRESION: no llega a la consola por ningun canal', async () => {
      const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((level) =>
        vi.spyOn(console, level).mockImplementation(() => {}),
      );

      const { h, result } = crear({ email: 'ana@example.com', days: 7 });
      await result;

      const escrito = spies
        .flatMap((spy) => spy.mock.calls)
        .flat()
        .map(String)
        .join('\n');
      expect(escrito).not.toContain(h.created[0].password);
      for (const spy of spies) spy.mockRestore();
    });

    it('REGRESION: no se guarda en el directorio ni en el rastro de auditoria', async () => {
      const { h, result } = crear({ email: 'ana@example.com', days: 7 });
      await result;

      const almacen = JSON.stringify([
        await h.directory.listInvitations(),
        h.directory.auditLog(),
      ]);
      expect(almacen).not.toContain(h.created[0].password);
    });

    it('REGRESION: no vuelve en ninguna consulta posterior', async () => {
      const { h, result } = crear({ email: 'ana@example.com', days: 7 });
      await result;

      const lista = await handleListInvitations(bearer(TOKEN_ADMIN), h.deps);

      expect(JSON.stringify(lista.body)).not.toContain(h.created[0].password);
    });

    it('REGRESION: no aparece en el cuerpo de un 409 ni de un 503', async () => {
      for (const code of ['email-exists', 'unavailable'] as const) {
        const { h, result } = crear(
          { email: 'ana@example.com', days: 7 },
          {
            createAccount: async () => {
              throw new IdentityAdminError(code);
            },
          },
        );
        const { body } = await result;

        expect(JSON.stringify(body)).not.toContain(h.created[0].password);
      }
    });
  });
});

/**
 * Reenviar es renovar: volver a invitar a un correo que YA tiene una
 * invitacion activa no es un error, es el mecanismo de reenvio que sustituye
 * al boton "Reenviar correo" de la tabla que se quito del panel. La cuenta de
 * Identity Platform ya existe y esta bien -- no hace falta (ni se puede)
 * crear otra --, asi que solo se renueva `expiresAt` con el `days` que se
 * acaba de pedir (REEMPLAZA, no suma) y se reenvia el correo de contrasena.
 *
 * Revivir una invitacion revocada, o "invitar" a alguien de casa
 * (`createUser`), queda deliberadamente FUERA de alcance: las dos siguen
 * respondiendo el mismo 409 de siempre.
 */
describe('POST /admin/invitations: reenviar es renovar', () => {
  it('un correo con invitacion activa no crea otra cuenta: renueva la que ya tiene', async () => {
    const h = harness();
    const primera = await handleCreateInvitation(
      bearer(TOKEN_ADMIN),
      { email: 'externo@example.com', days: 90 },
      h.deps,
    );
    expect(primera.status).toBe(201);

    const segunda = await handleCreateInvitation(
      bearer(TOKEN_ADMIN),
      { email: 'externo@example.com', days: 7 },
      h.deps,
    );

    // Ni una segunda cuenta en Identity Platform...
    expect(h.created).toHaveLength(1);
    // ...ni una segunda fila: el mismo id, con la caducidad renovada.
    expect(segunda).toEqual({
      status: 201,
      body: {
        id: (primera.body as { id: string }).id,
        email: 'externo@example.com',
        // 7 dias desde AHORA (el reloj del harness), no 90 + 7.
        expiresAt: '2026-01-22T12:00:00.000Z',
        emailSent: true,
      },
    });
  });

  it('la renovacion REEMPLAZA los dias, no los suma', async () => {
    const h = harness();
    await handleCreateInvitation(bearer(TOKEN_ADMIN), { email: 'externo@example.com', days: 90 }, h.deps);

    const renovada = await handleCreateInvitation(
      bearer(TOKEN_ADMIN),
      { email: 'externo@example.com', days: 7 },
      h.deps,
    );

    // Si sumase, serian 97 dias desde el alta original; el contrato es 7 dias
    // desde AHORA, un total menor al que tenia.
    expect(renovada.body.expiresAt).toBe('2026-01-22T12:00:00.000Z');
  });

  it('conserva id, uid, invitedBy y createdAt: solo expiresAt cambia', async () => {
    const h = harness();
    await handleCreateInvitation(bearer(TOKEN_ADMIN), { email: 'externo@example.com', days: 90 }, h.deps);
    const [antes] = await h.directory.listInvitations();

    await handleCreateInvitation(bearer(TOKEN_ADMIN), { email: 'externo@example.com', days: 7 }, h.deps);
    const [despues] = await h.directory.listInvitations();

    expect(despues.id).toBe(antes.id);
    expect(despues.uid).toBe(antes.uid);
    expect(despues.invitedBy).toBe(antes.invitedBy);
    expect(despues.createdAt).toEqual(antes.createdAt);
    expect(despues.expiresAt).not.toEqual(antes.expiresAt);
  });

  it('reenvia el correo de contrasena con el uid ya existente', async () => {
    const h = harness();
    await handleCreateInvitation(bearer(TOKEN_ADMIN), { email: 'externo@example.com', days: 90 }, h.deps);

    await handleCreateInvitation(bearer(TOKEN_ADMIN), { email: 'externo@example.com', days: 7 }, h.deps);

    // Una vez al invitar y otra al reenviar: las dos veces a la MISMA persona.
    expect(h.resets).toEqual(['externo@example.com', 'externo@example.com']);
  });

  it('una invitacion revocada con ese correo sigue respondiendo 409: revivirla no esta en este cambio', async () => {
    const revocada = user({
      id: 'id-revocada-otra',
      uid: 'uid-revocada-otra',
      email: 'revocada@example.com',
      role: 'guest',
      status: 'revoked',
      invitedBy: ADMIN.id,
    });
    const h = harness({
      seed: [ADMIN, revocada],
      createAccount: async () => {
        throw new IdentityAdminError('email-exists');
      },
    });

    const result = await handleCreateInvitation(
      bearer(TOKEN_ADMIN),
      { email: 'revocada@example.com', days: 7 },
      h.deps,
    );

    expect(result).toEqual({ status: 409, body: { error: 'conflict' } });
    // A diferencia del reenvio activo, aqui SI se intento crear la cuenta: es
    // el mismo camino de siempre, sin el atajo del reenvio.
    expect(h.created).toHaveLength(1);
  });

  it('el correo de alguien de casa (alta permanente) sigue respondiendo 409', async () => {
    const h = harness({
      // El seed por defecto ya trae a EMPLEADO (invitedBy null, alta con
      // `createUser`); aqui solo hace falta que la cuenta ya exista en
      // Identity Platform, como en la realidad.
      createAccount: async () => {
        throw new IdentityAdminError('email-exists');
      },
    });

    const result = await handleCreateInvitation(
      bearer(TOKEN_ADMIN),
      { email: EMPLEADO.email, days: 7 },
      h.deps,
    );

    expect(result).toEqual({ status: 409, body: { error: 'conflict' } });
    expect(h.created).toHaveLength(1);
  });

  it('un correo de verdad nuevo sigue creando la cuenta en Identity Platform, sin cambios', async () => {
    const h = harness();

    const result = await handleCreateInvitation(
      bearer(TOKEN_ADMIN),
      { email: 'nuevisimo@example.com', days: 7 },
      h.deps,
    );

    expect(result.status).toBe(201);
    expect(h.created).toHaveLength(1);
    expect(h.created[0].email).toBe('nuevisimo@example.com');
  });
});

describe('POST /admin/invitations/:id/revoke', () => {
  const invitada = user({
    id: 'id-invitada',
    uid: 'uid-invitada',
    email: 'invitada@example.com',
    role: 'guest',
    expiresAt: at(30 * DAY),
    invitedBy: ADMIN.id,
  });

  function revocar(id: unknown, options?: Parameters<typeof harness>[0]) {
    const h = harness({ seed: [ADMIN, EMPLEADO, invitada], ...options });
    return { h, result: handleRevokeInvitation(bearer(TOKEN_ADMIN), id, h.deps) };
  }

  it('200 y marca la fila como revocada, con quien revoco en la auditoria', async () => {
    const { h, result } = revocar(invitada.id);

    expect(await result).toEqual({ status: 200, body: { id: invitada.id, status: 'revoked' } });
    expect((await h.directory.findById(invitada.id))?.status).toBe('revoked');
    expect(h.directory.auditLog()).toEqual([
      { actorId: ADMIN.id, action: 'revoke', subjectId: invitada.id },
    ]);
  });

  it('desactiva ADEMAS la cuenta en Identity Platform', async () => {
    // Las dos mitades hacen cosas distintas y las dos hacen falta:
    //
    // - La fila revocada corta la ENTRADA a la oficina: `OfficeRoom.onAuth`
    //   consulta el directorio en cada join, asi que el siguiente intento de
    //   entrar se rechaza aunque el token siga siendo valido.
    // - Desactivar la cuenta corta la CREDENCIAL: mientras no se haga, la
    //   persona conserva un ID token valido hasta una hora mas y, peor,
    //   Identity Platform se lo renueva indefinidamente con su refresh token.
    //
    // Sin la segunda, "revocar" significa "no puede volver a entrar a la sala",
    // no "ya no es nadie en este proyecto". Es la diferencia entre cerrar una
    // puerta y retirar la llave.
    const { h, result } = revocar(invitada.id);
    await result;

    expect(h.disabled).toEqual(['uid-invitada']);
  });

  it('404 si ese id no existe', async () => {
    const { result } = revocar('id-inventado');

    expect(await result).toEqual({ status: 404, body: { error: 'not-found' } });
  });

  it('404 si el id apunta a alguien que no vino por invitacion', async () => {
    // Revocar por aqui a un empleado convertiria el panel de invitaciones en un
    // boton de expulsion del personal. La guarda vive en el directorio; esto
    // afirma que la ruta no la rodea.
    const { result } = revocar(EMPLEADO.id);

    expect(await result).toEqual({ status: 404, body: { error: 'not-found' } });
  });

  it('404 si el id no es texto, sin distinguirlo de uno que no existe', async () => {
    for (const id of [undefined, null, 42, '']) {
      const { result } = revocar(id);
      expect(await result).toEqual({ status: 404, body: { error: 'not-found' } });
    }
  });

  it('no desactiva ninguna cuenta cuando el id no existe', async () => {
    const { h, result } = revocar('id-inventado');
    await result;

    expect(h.disabled).toEqual([]);
  });

  it('si desactivar la cuenta falla, la revocacion en la base de datos SIGUE en pie', async () => {
    // Deshacerla seria la direccion equivocada: una fila revocada que sobrevive
    // a un fallo al desactivar deja a la persona fuera de la oficina, que es lo
    // que el administrador pidio. Al reves -- devolver el acceso porque una
    // llamada a Google fallo -- seria un fallo abierto.
    const { h, result } = revocar(invitada.id, {
      disableAccount: async () => {
        throw new IdentityAdminError('unavailable');
      },
    });

    expect(await result).toEqual({ status: 200, body: { id: invitada.id, status: 'revoked' } });
    expect((await h.directory.findById(invitada.id))?.status).toBe('revoked');
  });

  it('y lo deja en el log con el uid, porque hay que desactivarla a mano', async () => {
    const { h, result } = revocar(invitada.id, {
      disableAccount: async () => {
        throw new IdentityAdminError('unavailable');
      },
    });
    await result;

    const log = h.logged.join('\n');
    expect(log).toContain('uid-invitada');
    expect(log).toContain('a mano');
  });

  it('sin adaptador de Identity revoca igual, y avisa de la mitad que falta', async () => {
    // El 503 seria peor: bloquearia la unica accion que si corta el acceso a la
    // oficina por una credencial que solo hace falta para la otra mitad.
    const { h, result } = revocar(invitada.id, { identityAdmin: null });

    expect(await result).toEqual({ status: 200, body: { id: invitada.id, status: 'revoked' } });
    expect((await h.directory.findById(invitada.id))?.status).toBe('revoked');
    expect(h.logged.join('\n')).toContain('a mano');
  });

  it('no llama a Identity Platform si la fila no tiene uid', async () => {
    // Altas anteriores al panel: la fila existe pero nunca hubo cuenta creada
    // por nosotros. Mandar `disableUser` con un uid vacio seria una peticion
    // sin sentido y un error en el log que no significa nada.
    const sinUid = { ...invitada, id: 'id-sin-uid', uid: null };
    const { h, result } = revocar('id-sin-uid', { seed: [ADMIN, sinUid] });

    expect((await result).status).toBe(200);
    expect(h.disabled).toEqual([]);
  });

  it('revocar dos veces es inofensivo y sigue respondiendo 200', async () => {
    const { h, result } = revocar(invitada.id);
    await result;

    const otra = await handleRevokeInvitation(bearer(TOKEN_ADMIN), invitada.id, h.deps);

    expect(otra).toEqual({ status: 200, body: { id: invitada.id, status: 'revoked' } });
    expect(h.directory.auditLog()).toHaveLength(1);
  });
});

describe('POST /admin/users', () => {
  function crear(body: unknown, token = TOKEN_ADMIN, options?: Parameters<typeof harness>[0]) {
    const h = harness(options);
    return { h, result: handleCreateUser(bearer(token), body, h.deps) };
  }

  describe('validacion, antes de tocar nada', () => {
    it('400 si el email falta, no es texto o no tiene forma de email', async () => {
      for (const email of [undefined, null, 42, '', '   ', 'sin-arroba', 'a@b', 'a b@c.com']) {
        const { result } = crear({ email, role: 'employee' });
        expect(await result).toEqual({ status: 400, body: { error: 'invalid-request' } });
      }
    });

    it('400 si el rol falta o no es uno de los que se reparten', async () => {
      // La lista vive en `assertAssignableRole`; aqui solo se comprueba que la
      // ruta la USA, sin reescribirla en un segundo sitio. `superadmin` y
      // `guest` estan fuera a proposito: ver la cabecera de `userRules.ts`.
      for (const role of [undefined, null, 42, '', 'superadmin', 'guest', 'Admin', 'jefe']) {
        const { result } = crear({ email: 'ana@example.com', role });
        expect(await result).toEqual({ status: 400, body: { error: 'invalid-request' } });
      }
    });

    it('400 si el cuerpo no es ni un objeto', async () => {
      for (const body of [undefined, null, 'texto', 42, []]) {
        const { result } = crear(body);
        expect(await result).toEqual({ status: 400, body: { error: 'invalid-request' } });
      }
    });

    it('la validacion corre ANTES de mirar si hay adaptador de Identity', async () => {
      // Al reves, quien escribe mal el correo recibiria
      // "identity-admin-not-configured" y se pondria a revisar el despliegue por
      // una errata suya.
      const { result } = crear({ email: 'mal', role: 'employee' }, TOKEN_ADMIN, {
        identityAdmin: null,
      });

      expect(await result).toEqual({ status: 400, body: { error: 'invalid-request' } });
    });

    it('no crea ninguna cuenta cuando la validacion falla', async () => {
      const { h, result } = crear({ email: 'mal', role: 'employee' });
      await result;

      expect(h.created).toEqual([]);
    });
  });

  describe('quien puede repartir que rol', () => {
    it('un admin da de alta empleados', async () => {
      const { result } = crear({ email: 'nueva@example.com', role: 'employee' });

      expect((await result).status).toBe(201);
    });

    it('un admin NO puede crear otro admin: 403', async () => {
      // Si pudiera, el rol se reproduciria solo y una sola cuenta comprometida
      // bastaria para llenar la oficina de administradores. La guarda vive en
      // `canAssignRole`; esto afirma que la ruta no la rodea.
      const { result } = crear({ email: 'nueva@example.com', role: 'admin' });

      expect(await result).toEqual({ status: 403, body: { error: 'forbidden' } });
    });

    it('un superadmin SI puede crear admins', async () => {
      const { h, result } = crear({ email: 'nueva@example.com', role: 'admin' }, TOKEN_SUPER);

      expect((await result).status).toBe(201);
      expect((await h.directory.findByUid('uid-nuevo-1'))?.role).toBe('admin');
    });

    it('el 403 llega antes de crear ninguna cuenta en Identity Platform', async () => {
      // Un rechazo que ya ha dejado una credencial creada no es un rechazo.
      const { h, result } = crear({ email: 'nueva@example.com', role: 'admin' });
      await result;

      expect(h.created).toEqual([]);
      expect(await h.directory.findByUid('uid-nuevo-1')).toBeNull();
    });

    it('el cuerpo se valida antes que el rol de quien llama, y eso no abre nada', async () => {
      // Este 403 llega DESPUES del 400, al reves que en el resto de las rutas, y
      // es inevitable: no se puede saber que rol se esta pidiendo sin leer el
      // cuerpo. No es un canal lateral, porque quien llega hasta aqui ya ha
      // probado que administra; lo unico que aprende es que no reparte ese rol.
      const { result } = crear({ email: 'mal', role: 'admin' });

      expect(await result).toEqual({ status: 400, body: { error: 'invalid-request' } });
    });
  });

  it('503 identity-admin-not-configured cuando no hay credencial de servicio', async () => {
    const { h, result } = crear({ email: 'nueva@example.com', role: 'employee' }, TOKEN_ADMIN, {
      identityAdmin: null,
    });

    expect(await result).toEqual({
      status: 503,
      body: { error: 'identity-admin-not-configured' },
    });
    expect(await h.directory.findByUid('uid-nuevo-1')).toBeNull();
  });

  it('201 with id, email, role and emailSent, no expiry and never a password (#94)', async () => {
    // No se devuelve `expiresAt`: esta cuenta no vence, y mandar un `null` que
    // el panel tiene que interpretar es peor que no mandar nada.
    const { result } = crear({ email: 'nueva@example.com', role: 'employee' });
    const { status, body } = await result;

    expect(status).toBe(201);
    expect(body).toEqual({
      id: expect.any(String),
      email: 'nueva@example.com',
      role: 'employee',
      emailSent: true,
    });
  });

  it('creates the account with a strong random password that is never returned', async () => {
    const { h, result } = crear({ email: 'nueva@example.com', role: 'employee' });
    const { body } = await result;

    expect(h.created).toHaveLength(1);
    expect(h.created[0].password).toHaveLength(PASSWORD_LENGTH);
    expect(JSON.stringify(body)).not.toContain(h.created[0].password);
  });

  it('emails a password-reset link to the new address once the row exists', async () => {
    const { h, result } = crear({ email: '  Nueva@Example.COM  ', role: 'employee' });
    await result;

    expect(h.resets).toEqual(['nueva@example.com']);
  });

  it('a failed save sends no email', async () => {
    const h = harness();
    vi.spyOn(h.directory, 'createUser').mockRejectedValue(new Error('la base de datos'));

    await handleCreateUser(bearer(TOKEN_ADMIN), { email: 'nueva@example.com', role: 'employee' }, h.deps);

    expect(h.resets).toEqual([]);
  });

  it('when the email fails it keeps the user, answers 201 emailSent: false and logs the uid', async () => {
    const { h, result } = crear({ email: 'nueva@example.com', role: 'employee' }, TOKEN_ADMIN, {
      sendPasswordReset: async () => {
        throw new IdentityAdminError('unavailable');
      },
    });
    const { status, body } = await result;

    expect(status).toBe(201);
    expect(body.emailSent).toBe(false);
    expect(await h.directory.findByUid('uid-nuevo-1')).not.toBeNull();
    expect(h.disabled).toEqual([]);
    expect(h.logged.join('\n')).toContain('uid-nuevo-1');
  });

  it('normaliza el email antes de crear la cuenta y la fila', async () => {
    const { h, result } = crear({ email: '  Nueva@Example.COM  ', role: 'employee' });
    const { body } = await result;

    expect(body.email).toBe('nueva@example.com');
    expect(h.created[0].email).toBe('nueva@example.com');
    expect((await h.directory.findByUid('uid-nuevo-1'))?.email).toBe('nueva@example.com');
  });

  it('la fila nace sin caducidad y sin quien la invito, con su rastro de auditoria', async () => {
    const { h, result } = crear({ email: 'nueva@example.com', role: 'employee' });
    await result;

    const fila = (await h.directory.findByUid('uid-nuevo-1'))!;
    expect(fila).toMatchObject({ role: 'employee', status: 'active', expiresAt: null, invitedBy: null });
    expect(h.directory.auditLog()).toEqual([
      { actorId: ADMIN.id, action: 'create-user', subjectId: fila.id },
    ]);
  });

  it('quien entra por aqui NO aparece en la lista de invitaciones', async () => {
    // Es la consecuencia del `invitedBy` nulo, y la razon de que no haya un
    // boton para revocarlo: alguien de casa no se echa desde el panel de
    // invitaciones.
    const { h, result } = crear({ email: 'nueva@example.com', role: 'employee' });
    await result;

    const lista = await handleListInvitations(bearer(TOKEN_ADMIN), h.deps);

    expect(JSON.stringify(lista.body)).not.toContain('nueva@example.com');
  });

  it('409 conflict cuando ese correo ya tiene cuenta', async () => {
    const { h, result } = crear({ email: 'nueva@example.com', role: 'employee' }, TOKEN_ADMIN, {
      createAccount: async () => {
        throw new IdentityAdminError('email-exists');
      },
    });

    expect(await result).toEqual({ status: 409, body: { error: 'conflict' } });
    expect(await h.directory.findByUid('uid-nuevo-1')).toBeNull();
  });

  it('503 cuando Identity Platform no responde', async () => {
    const { h, result } = crear({ email: 'nueva@example.com', role: 'employee' }, TOKEN_ADMIN, {
      createAccount: async () => {
        throw new IdentityAdminError('unavailable');
      },
    });

    expect(await result).toEqual({
      status: 503,
      body: { error: 'identity-admin-not-configured' },
    });
    expect(await h.directory.findByUid('uid-nuevo-1')).toBeNull();
  });

  describe('la cuenta huerfana', () => {
    /**
     * Mismo hueco que en el alta de invitacion: `createAccount` funciona y
     * `createUser` falla despues, asi que queda una cuenta en Identity Platform
     * sin fila en el directorio. Puede autenticarse, su dueno puede darle
     * contrasena, y nadie la ve desde el panel. Es una credencial fuera de
     * inventario, que es el peor sitio donde puede estar una credencial.
     */
    function conFalloAlGuardar(disableAccount?: (uid: string) => Promise<void>) {
      const h = harness({ disableAccount });
      vi.spyOn(h.directory, 'createUser').mockRejectedValue(new Error('la base de datos'));
      return {
        h,
        result: handleCreateUser(
          bearer(TOKEN_ADMIN),
          { email: 'nueva@example.com', role: 'employee' },
          h.deps,
        ),
      };
    }

    it('compensa desactivando la cuenta que se acaba de crear', async () => {
      const { h, result } = conFalloAlGuardar();
      await result;

      expect(h.disabled).toEqual(['uid-nuevo-1']);
    });

    it('responde 500 y no finge que el alta salio bien', async () => {
      const { result } = conFalloAlGuardar();

      expect(await result).toEqual({ status: 500, body: { error: 'internal' } });
    });

    it('deja constancia en el log de las dos cosas que pasaron', async () => {
      const { h, result } = conFalloAlGuardar();
      await result;

      const log = h.logged.join('\n');
      expect(log).toContain('huerfana');
      expect(log).toContain('uid-nuevo-1');
    });

    it('si la compensacion tambien falla, lo grita en el log y sigue respondiendo 500', async () => {
      // Aqui si queda una credencial viva fuera de inventario y hace falta
      // desactivarla a mano desde la consola de GCP. El log es la unica forma
      // de saber cual.
      const { h, result } = conFalloAlGuardar(async () => {
        throw new IdentityAdminError('unavailable');
      });

      expect(await result).toEqual({ status: 500, body: { error: 'internal' } });
      expect(h.logged.join('\n')).toContain('a mano');
    });
  });

  it('REGRESION: la contrasena no llega al logger inyectado', async () => {
    // Misma regla que en el alta de invitacion: no sale de este proceso y no
    // existe en ningun otro sitio. Ver `generatePassword.ts`.
    const { h, result } = crear({ email: 'nueva@example.com', role: 'employee' });
    await result;

    expect(h.logged.join('\n')).not.toContain(h.created[0].password);
  });

  it('REGRESION: la contrasena no se guarda en el directorio ni en la auditoria', async () => {
    const { h, result } = crear({ email: 'nueva@example.com', role: 'employee' });
    await result;

    const almacen = JSON.stringify([
      await h.directory.findByUid('uid-nuevo-1'),
      h.directory.auditLog(),
    ]);
    expect(almacen).not.toContain(h.created[0].password);
  });
});

describe('POST /admin/users/:id/password-reset (#94)', () => {
  const invitada = user({
    id: 'id-invitada',
    uid: 'uid-invitada',
    role: 'guest',
    email: 'invitada@example.com',
    expiresAt: at(3 * DAY),
    invitedBy: ADMIN.id,
  });
  const otroAdmin = user({ id: 'id-otro-admin', uid: 'uid-otro-admin', role: 'admin' });

  function reenviar(id: unknown, options: Parameters<typeof harness>[0] = {}, token = TOKEN_ADMIN) {
    const h = harness({
      seed: [ADMIN, SUPERADMIN, EMPLEADO, CADUCADO, REVOCADO, invitada, otroAdmin],
      ...options,
    });
    return { h, result: handleSendPasswordReset(bearer(token), id, h.deps) };
  }

  it('re-sends the email to an active invitation and answers 200 emailSent: true', async () => {
    const { h, result } = reenviar(invitada.id);

    expect(await result).toEqual({
      status: 200,
      body: { id: invitada.id, email: 'invitada@example.com', emailSent: true },
    });
    expect(h.resets).toEqual(['invitada@example.com']);
  });

  it('re-sends it to an employee too: the admin could have created that account', async () => {
    const { h, result } = reenviar(EMPLEADO.id);

    expect((await result).status).toBe(200);
    expect(h.resets).toEqual([EMPLEADO.email]);
  });

  it('404 for an id that does not exist or is not text, without emailing anyone', async () => {
    for (const id of ['00000000-0000-4000-8000-000000000000', '', 42, undefined]) {
      const { h, result } = reenviar(id);
      expect(await result).toEqual({ status: 404, body: { error: 'not-found' } });
      expect(h.resets).toEqual([]);
    }
  });

  it('404 for a revoked or expired account: the office no longer admits them', async () => {
    for (const id of [REVOCADO.id, CADUCADO.id]) {
      const { h, result } = reenviar(id, {}, TOKEN_SUPER);
      expect(await result).toEqual({ status: 404, body: { error: 'not-found' } });
      expect(h.resets).toEqual([]);
    }
  });

  it('403 when the caller could not have created that role (admin -> admin, anyone -> superadmin)', async () => {
    for (const [token, id] of [
      [TOKEN_ADMIN, otroAdmin.id],
      [TOKEN_ADMIN, SUPERADMIN.id],
      [TOKEN_SUPER, SUPERADMIN.id],
    ] as const) {
      const { h, result } = reenviar(id, {}, token);
      expect(await result).toEqual({ status: 403, body: { error: 'forbidden' } });
      expect(h.resets).toEqual([]);
    }
  });

  it('a superadmin can re-send to an admin', async () => {
    const { result } = reenviar(otroAdmin.id, {}, TOKEN_SUPER);

    expect((await result).status).toBe(200);
  });

  it('503 identity-admin-not-configured without a service credential', async () => {
    const { result } = reenviar(invitada.id, { identityAdmin: null });

    expect(await result).toEqual({
      status: 503,
      body: { error: 'identity-admin-not-configured' },
    });
  });

  it('200 emailSent: false when the send fails, and logs the uid', async () => {
    const { h, result } = reenviar(invitada.id, {
      sendPasswordReset: async () => {
        throw new IdentityAdminError('unavailable');
      },
    });

    expect(await result).toEqual({
      status: 200,
      body: { id: invitada.id, email: 'invitada@example.com', emailSent: false },
    });
    expect(h.logged.join('\n')).toContain('uid-invitada');
  });

  it('never exposes the uid in the body', async () => {
    const { result } = reenviar(invitada.id);

    expect(JSON.stringify((await result).body)).not.toContain('uid-invitada');
  });
});

/**
 * Listing and removing anyone (#93). Own section and own guard loop, instead
 * of entries in `rutas`, so this feature stays in one place. Target ids are
 * uuid-shaped because the route refuses anything else before the directory
 * sees it (Postgres would reject a malformed uuid with a 500).
 */
describe('users: list everyone and remove access (#93)', () => {
  const STAFF = user({
    id: '00000000-0000-4000-8000-00000000000e',
    uid: 'uid-staff',
    email: 'staff@example.com',
    role: 'employee',
  });
  const GUEST = user({
    id: '00000000-0000-4000-8000-00000000000a',
    uid: 'uid-guest',
    email: 'guest@example.com',
    role: 'guest',
    expiresAt: at(3 * DAY),
    invitedBy: ADMIN.id,
  });
  const OTHER_ADMIN = user({
    id: '00000000-0000-4000-8000-0000000000ad',
    uid: 'uid-other-admin',
    role: 'admin',
  });
  const THE_SUPERADMIN = user({
    id: '00000000-0000-4000-8000-0000000000ff',
    uid: 'uid-super',
    role: 'superadmin',
  });
  const ADMIN_ME = user({
    id: '00000000-0000-4000-8000-0000000000a1',
    uid: 'uid-admin',
    role: 'admin',
  });
  const EMPLOYEE_ME = user({
    id: '00000000-0000-4000-8000-0000000000e1',
    uid: 'uid-empleado',
    role: 'employee',
  });

  function setup(options: Parameters<typeof harness>[0] = {}) {
    const h = harness({
      seed: [THE_SUPERADMIN, ADMIN_ME, OTHER_ADMIN, EMPLOYEE_ME, STAFF, GUEST, REVOCADO],
      ...options,
    });
    const evicted: string[] = [];
    const deps: AdminDeps = { ...h.deps, evictor: { evictAccount: (uid) => evicted.push(uid) } };
    return { h, deps, evicted };
  }

  const guarded: { name: string; call: (auth: unknown, deps: AdminDeps) => Promise<unknown> }[] = [
    { name: 'GET /admin/users', call: (auth, deps) => handleListUsers(auth, deps) },
    {
      name: 'POST /admin/users/:id/revoke',
      call: (auth, deps) => handleRevokeUser(auth, STAFF.id, deps),
    },
  ];

  for (const { name, call } of guarded) {
    describe(`${name}: same guards as every admin route`, () => {
      it('401 without a credential, with a forged token, and for a revoked account', async () => {
        const { deps } = setup();
        for (const header of [undefined, bearer('token-forjado'), bearer(TOKEN_REVOCADO)]) {
          expect(await call(header, deps)).toEqual({ status: 401, body: { error: 'unauthorized' } });
        }
      });

      it('403 for an authenticated employee, before touching the directory', async () => {
        const { h, deps } = setup();
        const list = vi.spyOn(h.directory, 'listUsers');
        const revoke = vi.spyOn(h.directory, 'revokeUser');

        expect(await call(bearer(TOKEN_EMPLEADO), deps)).toEqual({
          status: 403,
          body: { error: 'forbidden' },
        });
        expect(list).not.toHaveBeenCalled();
        expect(revoke).not.toHaveBeenCalled();
      });
    });
  }

  describe('GET /admin/users', () => {
    it('lists everyone with role, status and expiry, not only invitations', async () => {
      const { deps } = setup();

      const result = await handleListUsers(bearer(TOKEN_ADMIN), deps);

      expect(result.status).toBe(200);
      const users = (result.body as { users: Record<string, unknown>[] }).users;
      expect(users.map((row) => row.id)).toEqual([
        THE_SUPERADMIN.id,
        ADMIN_ME.id,
        OTHER_ADMIN.id,
        EMPLOYEE_ME.id,
        STAFF.id,
        GUEST.id,
        REVOCADO.id,
      ]);
      expect(users.find((row) => row.id === GUEST.id)).toEqual({
        id: GUEST.id,
        email: 'guest@example.com',
        displayName: null,
        role: 'guest',
        status: 'active',
        createdAt: GUEST.createdAt.toISOString(),
        expiresAt: at(3 * DAY).toISOString(),
        daysLeft: 3,
        removable: true,
      });
    });

    it('never sends the Identity Platform uid or the internal inviter id', async () => {
      const { deps } = setup();

      const result = await handleListUsers(bearer(TOKEN_ADMIN), deps);

      const serialized = JSON.stringify(result.body);
      expect(serialized).not.toContain('uid-');
      expect(serialized).not.toContain('invitedBy');
    });

    it('marks as removable exactly what canRemove allows for the caller, and only active rows', async () => {
      const { deps } = setup();

      const removableFor = async (token: string) => {
        const result = await handleListUsers(bearer(token), deps);
        return (result.body as { users: { id: string; removable: boolean }[] }).users
          .filter((row) => row.removable)
          .map((row) => row.id);
      };

      // An admin: employees and guests, never itself, another admin, the
      // superadmin, or someone already revoked.
      expect(await removableFor(TOKEN_ADMIN)).toEqual([EMPLOYEE_ME.id, STAFF.id, GUEST.id]);
      // The superadmin: admins too, but still not itself.
      expect(await removableFor(TOKEN_SUPER)).toEqual([
        ADMIN_ME.id,
        OTHER_ADMIN.id,
        EMPLOYEE_ME.id,
        STAFF.id,
        GUEST.id,
      ]);
    });
  });

  describe('POST /admin/users/:id/revoke', () => {
    it('revokes, audits, disables the account and evicts its live sessions', async () => {
      const { h, deps, evicted } = setup();

      expect(await handleRevokeUser(bearer(TOKEN_ADMIN), STAFF.id, deps)).toEqual({
        status: 200,
        body: { id: STAFF.id, status: 'revoked' },
      });
      expect((await h.directory.findById(STAFF.id))?.status).toBe('revoked');
      expect(h.directory.auditLog()).toEqual([
        { actorId: ADMIN_ME.id, action: 'revoke-user', subjectId: STAFF.id },
      ]);
      expect(h.disabled).toEqual(['uid-staff']);
      expect(evicted).toEqual(['uid-staff']);
    });

    it('a revoked account gets no password-reset email afterwards (#94 route answers 404)', async () => {
      const { h, deps } = setup();

      expect((await handleRevokeUser(bearer(TOKEN_ADMIN), STAFF.id, deps)).status).toBe(200);

      expect(await handleSendPasswordReset(bearer(TOKEN_ADMIN), STAFF.id, deps)).toEqual({
        status: 404,
        body: { error: 'not-found' },
      });
      expect(h.resets).toEqual([]);
    });

    it('revokes an invited guest too', async () => {
      const { deps, evicted } = setup();

      expect((await handleRevokeUser(bearer(TOKEN_ADMIN), GUEST.id, deps)).status).toBe(200);
      expect(evicted).toEqual(['uid-guest']);
    });

    it('403 when the hierarchy says no, and nothing changes', async () => {
      const cases: [string, DirectoryUser][] = [
        [TOKEN_ADMIN, OTHER_ADMIN],
        [TOKEN_ADMIN, THE_SUPERADMIN],
        [TOKEN_ADMIN, ADMIN_ME],
        [TOKEN_SUPER, THE_SUPERADMIN],
      ];
      for (const [token, target] of cases) {
        const { h, deps, evicted } = setup();

        expect(await handleRevokeUser(bearer(token), target.id, deps)).toEqual({
          status: 403,
          body: { error: 'forbidden' },
        });
        expect((await h.directory.findById(target.id))?.status).toBe('active');
        expect(h.disabled).toEqual([]);
        expect(evicted).toEqual([]);
      }
    });

    it('the superadmin can remove an admin', async () => {
      const { deps, evicted } = setup();

      expect((await handleRevokeUser(bearer(TOKEN_SUPER), OTHER_ADMIN.id, deps)).status).toBe(200);
      expect(evicted).toEqual(['uid-other-admin']);
    });

    it('404 for an unknown, malformed or non-string id, without disabling anything', async () => {
      for (const id of ['00000000-0000-4000-8000-000000000999', 'id-inventado', '', undefined, null, 42]) {
        const { h, deps, evicted } = setup();
        const find = vi.spyOn(h.directory, 'findById');

        expect(await handleRevokeUser(bearer(TOKEN_ADMIN), id, deps)).toEqual({
          status: 404,
          body: { error: 'not-found' },
        });
        expect(h.disabled).toEqual([]);
        expect(evicted).toEqual([]);
        // A malformed id never reaches the directory: Postgres would throw
        // on it and turn a 404 into a 500.
        if (id !== '00000000-0000-4000-8000-000000000999') expect(find).not.toHaveBeenCalled();
      }
    });

    it('revoking twice is safe: 200 again and a single audit entry', async () => {
      const { h, deps } = setup();
      await handleRevokeUser(bearer(TOKEN_ADMIN), STAFF.id, deps);

      expect(await handleRevokeUser(bearer(TOKEN_ADMIN), STAFF.id, deps)).toEqual({
        status: 200,
        body: { id: STAFF.id, status: 'revoked' },
      });
      expect(h.directory.auditLog()).toHaveLength(1);
    });

    it('if disabling the account fails, the revocation and the eviction still stand, and it is logged', async () => {
      const { h, deps, evicted } = setup({
        disableAccount: async () => {
          throw new IdentityAdminError('unavailable');
        },
      });

      expect((await handleRevokeUser(bearer(TOKEN_ADMIN), STAFF.id, deps)).status).toBe(200);
      expect((await h.directory.findById(STAFF.id))?.status).toBe('revoked');
      expect(evicted).toEqual(['uid-staff']);
      const log = h.logged.join('\n');
      expect(log).toContain('uid-staff');
      expect(log).toContain('a mano');
    });

    it('without an Identity Platform credential it still revokes and evicts, and logs the missing half', async () => {
      const { h, deps, evicted } = setup({ identityAdmin: null });

      expect((await handleRevokeUser(bearer(TOKEN_ADMIN), STAFF.id, deps)).status).toBe(200);
      expect(evicted).toEqual(['uid-staff']);
      expect(h.logged.join('\n')).toContain('a mano');
    });

    it('a row without uid has nothing to disable or evict', async () => {
      const noUid = { ...STAFF, uid: null };
      const { h, deps, evicted } = setup({ seed: [ADMIN_ME, noUid] });

      expect((await handleRevokeUser(bearer(TOKEN_ADMIN), noUid.id, deps)).status).toBe(200);
      expect(h.disabled).toEqual([]);
      expect(evicted).toEqual([]);
    });

    it('a failing eviction does not undo the revocation', async () => {
      const { h } = setup();
      const deps: AdminDeps = {
        ...h.deps,
        evictor: {
          evictAccount() {
            throw new Error('room gone');
          },
        },
      };

      expect((await handleRevokeUser(bearer(TOKEN_ADMIN), STAFF.id, deps)).status).toBe(200);
      expect((await h.directory.findById(STAFF.id))?.status).toBe('revoked');
      expect(h.disabled).toEqual(['uid-staff']);
      expect(h.logged.join('\n')).toContain('uid-staff');
    });

    it('without an evictor (no room wired) it still revokes', async () => {
      const { h } = setup();

      expect((await handleRevokeUser(bearer(TOKEN_ADMIN), STAFF.id, h.deps)).status).toBe(200);
    });
  });
});
