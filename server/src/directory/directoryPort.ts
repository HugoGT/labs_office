/**
 * Puerto del directorio de usuarios (#24). Solo tipos: aqui no hay ni SQL ni
 * `pg` ni Express ni Colyseus, igual que `verifyIdToken.ts` no sabe nada de la
 * ruta que lo llama. Los adaptadores son `pgDirectory.ts` (Postgres, el de
 * produccion) y `memoryDirectory.ts` (en memoria, para los tests y para poder
 * probar la regla de bootstrap por comportamiento y no leyendo un SQL).
 *
 * Que sea un puerto no es ceremonia: `OfficeRoom` necesita decidir si alguien
 * entra, y esa decision no puede exigir una base de datos levantada para poder
 * probarse. Quien inyecta el adaptador es `createOfficeServer.ts`, nunca un
 * singleton de modulo -- la misma razon que documenta `liveSessions.ts`: dos
 * ficheros de test compartiendo estado global acaban acoplados al orden de
 * ejecucion de vitest.
 *
 * El directorio es OPCIONAL de punta a punta: sin `DATABASE_URL` el servidor
 * arranca igual y se comporta exactamente como antes de este cambio. Ver
 * `bootstrapConfig.ts` para por que eso NO es un default aceptable en un
 * despliegue.
 */

export type Role = 'superadmin' | 'admin' | 'employee' | 'guest';
export type AccountStatus = 'active' | 'revoked';

export interface DirectoryUser {
  id: string;
  uid: string | null;
  email: string;
  displayName: string | null;
  role: Role;
  status: AccountStatus;
  /** null = no caduca (empleados y admins). Date = invitado con caducidad. */
  expiresAt: Date | null;
  /** id del usuario que lo invito, o null para los que no vinieron por invitacion. */
  invitedBy: string | null;
  createdAt: Date;
}

export interface CreateInvitationInput {
  email: string;
  /** Entero entre 1 y 90 inclusive. */
  days: number;
  /** id (no uid) del administrador que invita. */
  invitedById: string;
  /** uid de Identity Platform de la cuenta ya creada por el adaptador de admin. */
  uid: string;
}

/**
 * Los roles que el panel puede repartir. `superadmin` no esta porque lo protege
 * el indice unico parcial de `schema.sql`, y `guest` porque un invitado sin
 * caducidad es justo lo que el flujo de invitaciones existe para impedir. Ver
 * `userRules.ts`.
 */
export type AssignableRole = 'employee' | 'admin';

export interface CreateUserInput {
  email: string;
  role: AssignableRole;
  /** uid de Identity Platform de la cuenta ya creada. */
  uid: string;
  /** id (no uid) del administrador que da de alta. */
  createdById: string;
}

export interface InvitationRow extends DirectoryUser {
  /** Email de quien invito, resuelto por JOIN. null si no se puede resolver. */
  invitedByEmail: string | null;
}

export interface UserDirectory {
  /**
   * Resuelve al usuario del ID token ya verificado: devuelve su fila por uid
   * (refrescando solo el nombre visible) o `null` si no la tiene, que
   * `decideAccess` deniega como `not-provisioned`. Falla cerrado (#72): la
   * UNICA fila que puede crear es la del superadmin de bootstrap (email igual a
   * `BOOTSTRAP_SUPERADMIN_EMAIL` y ningun superadmin todavia). Cualquier otra
   * cuenta se da de alta desde el panel. Idempotente por uid.
   */
  resolveOnLogin(identity: {
    uid: string;
    email: string | null;
    name: string | null;
  }): Promise<DirectoryUser | null>;
  findByUid(uid: string): Promise<DirectoryUser | null>;
  findById(id: string): Promise<DirectoryUser | null>;
  /** Solo los que vinieron por invitacion (invited_by no nulo), mas recientes primero. */
  listInvitations(): Promise<InvitationRow[]>;
  /**
   * Busca por email ya normalizado (`normalizeEmail`); el adaptador NO lo
   * normaliza el mismo, igual que `findByUid`/`findById` tampoco lo hacen con
   * su clave. Es lo que permite a `handleCreateInvitation` distinguir, ANTES
   * de pedirle una cuenta a Identity Platform, un reenvio (invitacion activa
   * con esa misma direccion) de un alta de verdad nueva. En Postgres se apoya
   * en el indice unico `users_email_unique` de `schema.sql`. `null` si nadie
   * usa ese correo.
   */
  findByEmail(email: string): Promise<DirectoryUser | null>;
  createInvitation(input: CreateInvitationInput): Promise<DirectoryUser>;
  /**
   * Renueva la caducidad de una invitacion existente, en el sitio: mismo
   * id/uid/invitedBy/createdAt, solo cambia `expiresAt`. Es el mecanismo de
   * "reenviar" del panel -- volver a invitar a quien ya tiene una invitacion
   * activa no le SUMA dias a los que le quedaban, se los REEMPLAZA por los que
   * se acaban de pedir. `days` es un entero entre 1 y 90, la misma regla que
   * `createInvitation` (`assertValidInvitationDays`). Devuelve `null` si `id`
   * no existe o no es una invitacion (`invitedBy` nulo).
   */
  renewInvitation(id: string, days: number): Promise<DirectoryUser | null>;
  /**
   * Alta de alguien de casa: sin caducidad y sin `invited_by`. Esos dos nulos
   * son lo que lo separa de `createInvitation`, y no son cosmeticos -- sin
   * `invited_by` la fila no aparece en `listInvitations` y `revoke` no la
   * toca, que es la garantia de que el panel de invitaciones no se convierte
   * en un boton de expulsion del personal.
   */
  createUser(input: CreateUserInput): Promise<DirectoryUser>;
  /** Devuelve null si ese id no existe o no es una invitacion. */
  revoke(id: string, actorId: string): Promise<DirectoryUser | null>;
  /**
   * Every user of the directory, invitations included, oldest first (#93). The
   * panel needs the staff too: without them there is nobody to take access
   * away from.
   */
  listUsers(): Promise<DirectoryUser[]>;
  /**
   * Takes access away from anyone but the superadmin (#93): `status =
   * 'revoked'` plus a `revoke-user` audit entry, atomically. Unlike `revoke`
   * it does not require an invitation; WHO may remove whom is `canRemove`, and
   * the route checks it first. Refusing the superadmin here too is the second
   * lock. Returns null for an unknown id or the superadmin; an already revoked
   * user comes back unchanged and is not audited again.
   */
  revokeUser(id: string, actorId: string): Promise<DirectoryUser | null>;
  /**
   * Reclama un nombre visible auto-elegido (#100). `name` llega YA
   * canonicalizado por quien llama (la ruta HTTP, via
   * `canonicalizeDisplayName`); el adaptador vuelve a aplicar la misma
   * canonicalizacion antes de escribir, para que ningun llamante pueda dejar
   * un valor no canonico en la columna (D10). Devuelve `null` si `id` no
   * existe. Lanza `DisplayNameTakenError` si el nombre, comparado por su clave
   * (`displayNameKey`), ya pertenece a OTRA cuenta -- la propia fila nunca es
   * un conflicto consigo misma (D4).
   */
  setDisplayName(id: string, name: string): Promise<DirectoryUser | null>;
  close(): Promise<void>;
}
