/**
 * Puerto de administracion de invitaciones (#24). Misma regla dura que
 * `auth/authPort.ts`: describe lo que el panel necesita, no como se consigue.
 * Este archivo NO importa `fetch` ni tipos de HTTP, asi que el panel entero se
 * prueba contra un puerto falso y sin red. El unico que habla HTTP es
 * `adminClient.ts`.
 */

/**
 * Los roles que el servidor puede devolver (#7). El panel solo distingue
 * "administra" de "no administra", pero el tipo lleva los cuatro porque la
 * tabla ensena el rol de cada invitacion.
 */
export type Role = 'superadmin' | 'admin' | 'employee' | 'guest';

export interface AdminSession {
  role: Role;
  email: string;
  displayName: string | null;
  /** Caducidad de quien consulta, `null` si su cuenta no vence (#24, punto 2). */
  expiresAt: string | null;
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  status: 'active' | 'revoked';
  /** ISO 8601, tal cual lo manda el servidor: el cliente no reinterpreta fechas. */
  createdAt: string;
  expiresAt: string | null;
  /**
   * Lo calcula el SERVIDOR y no el navegador: el reloj del cliente se puede
   * mover, y "te quedan 3 dias" no puede depender de eso.
   */
  daysLeft: number | null;
  /** Auditoria (#24, punto 7): quien invito. `null` en altas anteriores al panel. */
  invitedByEmail: string | null;
}

/**
 * What creating an invitation returns. There is no password (#94): the server
 * emails the person a link to set their own, and only says whether that email
 * went out. `emailSent: false` means the account exists but the admin has to
 * re-send the email (`sendPasswordReset`).
 */
export interface CreatedInvitation {
  id: string;
  email: string;
  expiresAt: string;
  emailSent: boolean;
}

/**
 * Los roles que el panel puede repartir al dar de alta a alguien de casa. Ni
 * `superadmin` (lo protege un indice unico en la base de datos, y la unica
 * promocion es la del bootstrap) ni `guest` (un invitado sin caducidad es lo
 * que el flujo de invitaciones existe para impedir).
 */
export type AssignableRole = 'employee' | 'admin';

/**
 * What creating a user returns. Same rule as `CreatedInvitation`: no password,
 * only whether the set-your-password email went out (#94). No `expiresAt`
 * because this account does not expire.
 */
export interface CreatedUser {
  id: string;
  email: string;
  role: AssignableRole;
  emailSent: boolean;
}

/** Result of re-sending the password email (#94). */
export interface PasswordResetResult {
  id: string;
  email: string;
  /** `false` when Identity Platform did not send it: the admin can retry. */
  emailSent: boolean;
}

export interface AdminPort {
  /** Quien consulta, segun el servidor. Es la unica fuente del rol. */
  session(): Promise<AdminSession>;
  listInvitations(): Promise<Invitation[]>;
  /** `days` entre 1 y 90 (#24); el servidor vuelve a validarlo. */
  createInvitation(email: string, days: number): Promise<CreatedInvitation>;
  /**
   * Alta de alguien de casa: sin caducidad. Solo un superadmin puede pedir
   * `'admin'`; el servidor responde 403 a cualquier otro, y esconder la opcion
   * en la pantalla no es la guarda.
   */
  createUser(email: string, role: AssignableRole): Promise<CreatedUser>;
  revoke(id: string): Promise<void>;
  /**
   * Re-sends the set-your-password email to the account with this directory
   * id (#94), invitation or not. Resolves with `emailSent: false` when the
   * server could not send it; rejects only when the request itself failed.
   */
  sendPasswordReset(id: string): Promise<PasswordResetResult>;
}

/**
 * Motivos que el panel sabe contar. Son estados de producto, no codigos HTTP:
 * traducirlos en el adaptador deja a la pantalla sin saber que hay HTTP detras
 * y hace que cada rama tenga su mensaje en vez de un "algo fallo".
 */
export type AdminErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'invalid-request'
  | 'conflict'
  /** El id ya no esta: otra persona lo quito entre la lectura y el clic. */
  | 'not-found'
  /**
   * Dos escritorios de 3x3 pisandose. Es un 409 propio y no `conflict` porque
   * se arregla escribiendo otras coordenadas, no cambiando de correo.
   */
  | 'desk-overlap'
  /**
   * El cubiculo de 3x3 de un escritorio pisa una SALA existente, no otro
   * escritorio (issue #10, S2 3.5). Es su propio codigo y no `desk-overlap`
   * porque el rectangulo con el que choca es de otra naturaleza -- confundir
   * los dos mensajes haria buscar el choque contra el escritorio equivocado.
   */
  | 'desk-space-overlap'
  /**
   * Dos salas pisandose (#10 + #12, S3a). Es su propio codigo y no
   * `desk-overlap` reciclado porque las dos filas con las que puede chocar
   * una sala son de otra naturaleza -- ver `spacesRoutes.ts`.
   */
  | 'space-overlap'
  /**
   * El nombre de una sala ya lo usa otra (spacesRoutes.ts). No es
   * `space-overlap`: el solape se arregla moviendo el rectangulo, el nombre
   * repetido escribiendo otro. Un solo codigo mandaria a mover una sala que
   * estaba bien colocada.
   */
  | 'space-name-taken'
  /**
   * El espacio pedido es en realidad el cubiculo de un escritorio, no una
   * sala: se administra como escritorio, no como espacio (barra lateral de la
   * oficina, #74). Mismo codigo que ya usa `pgSpaces.updateSpace`/`deleteSpace`
   * en el servidor (#10 + #12, tarea 1.4) para el intento directo por la API.
   */
  | 'space-owned-by-desk'
  /**
   * Los TRES "no configurado" viajan separados porque son tres piezas
   * distintas del despliegue: credenciales de Identity Platform la primera y
   * `DATABASE_URL` las otras dos. Un codigo comun obligaria a quien despliega
   * a probarlas todas para saber cual falta.
   */
  | 'identity-admin-not-configured'
  | 'desks-not-configured'
  | 'decor-not-configured'
  /** Mismas tres piezas de arriba, cuarta superficie: sin `DATABASE_URL` tampoco hay tabla de espacios que administrar. */
  | 'spaces-not-configured'
  | 'network'
  | 'unknown';

export class AdminError extends Error {
  constructor(public readonly code: AdminErrorCode) {
    super(`Fallo de administracion (${code})`);
    // Sin esto, `error.name` seria 'Error' en cualquier traza y en cualquier
    // log, que es justo donde hace falta reconocerlo.
    this.name = 'AdminError';
  }
}
