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

export interface InvitationRow extends DirectoryUser {
  /** Email de quien invito, resuelto por JOIN. null si no se puede resolver. */
  invitedByEmail: string | null;
}

export interface UserDirectory {
  /**
   * Resuelve al usuario del ID token ya verificado, creandolo la primera vez.
   * Aplica el bootstrap de superadmin. Idempotente por uid.
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
  createInvitation(input: CreateInvitationInput): Promise<DirectoryUser>;
  /** Devuelve null si ese id no existe o no es una invitacion. */
  revoke(id: string, actorId: string): Promise<DirectoryUser | null>;
  close(): Promise<void>;
}
