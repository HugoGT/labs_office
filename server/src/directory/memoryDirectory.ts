/**
 * Adaptador del directorio en memoria (#24). No es un mock de conveniencia: es
 * el segundo adaptador del puerto y existe por una razon concreta.
 *
 * La regla de bootstrap de superadmin es la mas peligrosa de todo el cambio --
 * si se invierte su condicion, cualquiera que entre se queda la oficina. En
 * `pgDirectory.ts` esa regla es un `WHERE ... NOT EXISTS` dentro de un INSERT,
 * y un test que afirme "el SQL contiene NOT EXISTS" pasaria igual con la
 * condicion al reves. Aqui la misma regla se prueba entrando dos veces y
 * mirando el rol, que es lo que de verdad importa. Las dos implementaciones
 * comparten `invitationRules.ts` para que no se separen en lo mecanico.
 *
 * Ademas permite que `OfficeRoom.test.ts` pruebe allow/expired/revoked/
 * not-provisioned sin levantar Postgres. La alternativa era exigir una base de
 * datos para correr la suite, y una suite que necesita infraestructura acaba
 * sin correrse.
 *
 * `auditLog` y `seed` NO son del puerto: son afordancias de este adaptador para
 * los tests. Estan aqui y no en `UserDirectory` porque el puerto describe lo que
 * la aplicacion necesita, no lo que a un test le viene bien.
 */

import type {
  AccountStatus,
  CreateInvitationInput,
  CreateUserInput,
  DirectoryUser,
  InvitationRow,
  Role,
  UserDirectory,
} from './directoryPort.ts';
import { expiresAtFrom, normalizeEmail, normalizeInvitationInput } from './invitationRules.ts';
import { normalizeUserInput } from './userRules.ts';

export interface AuditEntry {
  actorId: string;
  action: 'invite' | 'revoke' | 'create-user';
  subjectId: string;
}

export interface MemoryDirectory extends UserDirectory {
  /** Solo para tests: rastro de auditoria, que el puerto no expone para leer. */
  auditLog(): AuditEntry[];
}

export interface MemoryDirectoryOptions {
  bootstrapSuperadminEmail?: string | null;
  /** Reloj inyectado: sin el, las pruebas de caducidad dependerian de la hora. */
  now?: () => Date;
  /** Filas ya hechas, para montar casos (un invitado caducado, uno revocado). */
  seed?: DirectoryUser[];
}

/**
 * Ids sinteticos con forma de uuid. No hace falta que sean criptograficos: en
 * memoria nadie los adivina para nada, y que se parezcan a los de verdad evita
 * que un test pase aqui y falle contra Postgres por la forma del id.
 */
function fakeUuid(counter: number): string {
  const hex = counter.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

export function createMemoryDirectory(options: MemoryDirectoryOptions = {}): MemoryDirectory {
  const bootstrapEmail = options.bootstrapSuperadminEmail
    ? normalizeEmail(options.bootstrapSuperadminEmail)
    : null;
  const now = options.now ?? (() => new Date());

  // Insercion ordenada: `listInvitations` devuelve las mas recientes primero y
  // en memoria dos filas creadas en el mismo milisegundo tendrian el mismo
  // `createdAt`. El orden de insercion desempata de forma determinista, que es
  // lo que en Postgres hace el `created_at` con resolucion de microsegundos.
  const rows: DirectoryUser[] = [];
  const audit: AuditEntry[] = [];
  let counter = 0;

  for (const seeded of options.seed ?? []) {
    rows.push({ ...seeded });
    counter++;
  }

  /** Copia defensiva: quien recibe la fila no debe poder mutar el almacen. */
  function snapshot(row: DirectoryUser): DirectoryUser {
    return { ...row };
  }

  function byUid(uid: string): DirectoryUser | undefined {
    return rows.find((row) => row.uid === uid);
  }

  function byId(id: string): DirectoryUser | undefined {
    return rows.find((row) => row.id === id);
  }

  function hasSuperadmin(): boolean {
    return rows.some((row) => row.role === 'superadmin');
  }

  function insert(fields: {
    uid: string;
    email: string;
    displayName: string | null;
    role: Role;
    status: AccountStatus;
    expiresAt: Date | null;
    invitedBy: string | null;
  }): DirectoryUser {
    counter++;
    const row: DirectoryUser = { id: fakeUuid(counter), createdAt: now(), ...fields };
    rows.push(row);
    return row;
  }

  return {
    async resolveOnLogin(identity) {
      // Sin email no hay clave humana con la que casar una invitacion ni el
      // email de bootstrap. Ver la cabecera de `pgDirectory.ts`.
      if (identity.email === null) return null;
      const email = normalizeEmail(identity.email);

      const existing = byUid(identity.uid);
      if (existing) {
        // Solo el nombre visible se refresca. El rol y el estado los decide
        // esta oficina, no el token: sobrescribirlos en cada login borraria
        // cualquier promocion o revocacion hecha desde el panel.
        existing.displayName = identity.name;
        return snapshot(existing);
      }

      // Falla cerrado (#72): la unica fila que el login puede crear es la del
      // superadmin de bootstrap. Cualquier otra cuenta tiene que existir ya,
      // dada de alta desde el panel; si no, `null` y `decideAccess` la deniega
      // como `not-provisioned`. La comprobacion del email repetido es la del
      // indice unico de `users.email` en Postgres: sin ella, este adaptador
      // crearia una fila que `pgDirectory` rechazaria.
      const isBootstrap = bootstrapEmail !== null && email === bootstrapEmail;
      if (!isBootstrap || hasSuperadmin() || rows.some((row) => row.email === email)) {
        return null;
      }

      return snapshot(
        insert({
          uid: identity.uid,
          email,
          displayName: identity.name,
          role: 'superadmin',
          status: 'active',
          expiresAt: null,
          invitedBy: null,
        }),
      );
    },

    async findByUid(uid) {
      const row = byUid(uid);
      return row ? snapshot(row) : null;
    },

    async findById(id) {
      const row = byId(id);
      return row ? snapshot(row) : null;
    },

    async listInvitations() {
      const invitations: InvitationRow[] = [];
      for (const row of rows) {
        if (row.invitedBy === null) continue;
        const inviter = byId(row.invitedBy);
        invitations.push({ ...row, invitedByEmail: inviter?.email ?? null });
      }
      // Mas recientes primero, del ultimo insertado al primero.
      return invitations.reverse();
    },

    async createInvitation(input: CreateInvitationInput) {
      // Validar ANTES de tocar nada: media invitacion es peor que ninguna,
      // porque el administrador ve un error y la fila existe igual. En
      // `pgDirectory.ts` esto mismo lo garantiza la transaccion.
      const { email, days, invitedById, uid } = normalizeInvitationInput(input);

      const created = insert({
        uid,
        email,
        displayName: null,
        role: 'guest',
        status: 'active',
        expiresAt: expiresAtFrom(now(), days),
        invitedBy: invitedById,
      });
      audit.push({ actorId: invitedById, action: 'invite', subjectId: created.id });

      return snapshot(created);
    },

    async createUser(input: CreateUserInput) {
      // Validar ANTES de tocar nada, mismo motivo que en `createInvitation`:
      // medio alta es peor que ninguna, porque quien administra ve un error y
      // la fila existe igual.
      const { email, role, uid, createdById } = normalizeUserInput(input);

      const created = insert({
        uid,
        email,
        // El nombre visible lo trae el token en el primer login
        // (`resolveOnLogin`); inventarlo aqui a partir del correo pintaria en
        // la oficina un nombre que esa persona no eligio.
        displayName: null,
        role,
        status: 'active',
        // Los dos nulos son el alta entera: no caduca, y sin `invitedBy` la
        // fila no sale en `listInvitations` ni la toca `revoke`.
        expiresAt: null,
        invitedBy: null,
      });
      audit.push({ actorId: createdById, action: 'create-user', subjectId: created.id });

      return snapshot(created);
    },

    async revoke(id, actorId) {
      const row = byId(id);
      // `invitedBy === null` es lo que separa a un invitado de un empleado.
      // Revocar por este camino a alguien de casa convertiria el panel de
      // invitaciones en un boton de expulsion del personal, que es otra
      // decision y no esta tomada.
      if (!row || row.invitedBy === null) return null;

      // Revocar dos veces es inofensivo, pero solo se audita el cambio real:
      // un rastro con diez revocaciones identicas no dice nada mas que una.
      if (row.status !== 'revoked') {
        row.status = 'revoked';
        audit.push({ actorId, action: 'revoke', subjectId: row.id });
      }

      return snapshot(row);
    },

    async close() {
      // Nada que cerrar. Existe porque el puerto lo exige y porque el llamante
      // no tiene por que saber que adaptador le toco.
    },

    auditLog() {
      return audit.map((entry) => ({ ...entry }));
    },
  };
}
