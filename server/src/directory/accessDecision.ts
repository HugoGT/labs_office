/**
 * La regla de acceso del directorio (#24), pura y sin base de datos. Es el
 * corazon de la caducidad: lo unico que separa a un invitado de un dia de un
 * invitado para siempre.
 *
 * Esta separada del adaptador de Postgres a proposito. Si viviese dentro de un
 * `WHERE expires_at > now()`, probarla exigiria una base de datos levantada, y
 * lo que hay que poder probar exhaustivamente es justamente esto: los bordes.
 * El adaptador trae la fila; quien decide es esta funcion, con el `now` tambien
 * inyectado para que ningun test dependa del reloj de la maquina.
 *
 * ## Por que devuelve un motivo y no un booleano
 *
 * Al cliente no se le dice nunca cual de los cuatro casos es: `OfficeRoom`
 * colapsa todo en el mismo 401 mudo, por la misma razon que
 * `verifyIdToken.verify` devuelve `null` y no una causa (un oraculo para ir
 * afinando el ataque). Pero el LOG del servidor si necesita la distincion:
 * "todo el mundo cae en not-provisioned" (las migraciones no corrieron, o el
 * bootstrap apunta al proyecto equivocado) y "un invitado caduco" son la misma
 * respuesta HTTP y dos incidencias completamente distintas a las tres de la
 * manana.
 *
 * ## Por que revocado se comprueba ANTES que caducado
 *
 * Una cuenta revocada lo esta pase lo que pase con sus fechas. Si se mirase
 * primero la caducidad, revocar a un invitado ya vencido se registraria como
 * "caduco solo", y el operador no sabria si el boton de revocar hizo algo.
 */

import type { AssignableRole, DirectoryUser, Role } from './directoryPort.ts';

export type AccessDecision = 'allow' | 'expired' | 'revoked' | 'not-provisioned';

export function decideAccess(user: DirectoryUser | null, now: Date): AccessDecision {
  // Sin fila no se puede afirmar nada: el token esta firmado por Google, pero
  // esta oficina no reconoce a esa cuenta. No es lo mismo que "revocada".
  if (user === null) return 'not-provisioned';

  if (user.status === 'revoked') return 'revoked';

  // `<=` y no `<`: `expires_at` es "hasta cuando vale". Un limite inclusivo
  // regalaria un margen que nadie ha decidido, y dejaria el instante exacto del
  // vencimiento como el unico punto donde dos implementaciones pueden discrepar
  // sin que se note.
  if (user.expiresAt !== null && user.expiresAt.getTime() <= now.getTime()) return 'expired';

  return 'allow';
}

/**
 * Quien puede invitar y revocar. Lista blanca y no "todo el que no sea guest":
 * al anadir un rol nuevo, el default seguro es que NO administre. Lo consume el
 * guard de las rutas de administracion; vive aqui y no en el adaptador HTTP
 * porque la autorizacion es una regla de dominio, no un detalle de Express.
 */
export function canAdminister(role: Role): boolean {
  return role === 'superadmin' || role === 'admin';
}

/**
 * Quien puede dar de alta a alguien de casa, y con que rol. Vive aqui y no en
 * la ruta por el mismo motivo que `canAdminister`: quien puede repartir que rol
 * es una regla de dominio, no un detalle de Express, y probarla no puede exigir
 * montar un servidor.
 *
 * Un `admin` NO puede crear otros `admin`. Si pudiera, el rol se reproduciria
 * solo: una sola cuenta de administrador comprometida bastaria para llenar la
 * oficina de administradores, y ninguno de los nuevos tendria detras la
 * decision de quien manda de verdad. Dejarlo en manos del superadmin mantiene
 * un unico origen para ese rol, que es el mismo criterio con el que el
 * bootstrap deja la promocion a superadmin en manos de quien configura el
 * entorno y no de quien mira una pantalla.
 *
 * Lista blanca otra vez: el rol objetivo llega ya acotado a `AssignableRole`
 * por `assertAssignableRole`, asi que aqui no hay que decidir nada sobre
 * `superadmin` ni sobre `guest`.
 */
export function canAssignRole(actor: Role, target: AssignableRole): boolean {
  if (target === 'admin') return actor === 'superadmin';
  return canAdminister(actor);
}

/**
 * Who can take access away from whom (#93). Same home and same reason as
 * `canAssignRole`: it is a domain rule, and testing it cannot require a
 * server.
 *
 * It mirrors `canAssignRole` on purpose: an admin removes exactly the roles an
 * admin could have handed out, and only the superadmin removes an admin, since
 * otherwise one compromised admin account could empty the office of every
 * other admin. The superadmin is removable by nobody: it is guarded by the
 * bootstrap and the partial unique index of `schema.sql`, not by a screen.
 *
 * Nobody removes themself. The button would let the last admin lock the office
 * out by a misclick, and the superadmin leave it without one.
 *
 * Whitelist again: a new role starts out able to remove nobody and removable
 * only by the superadmin.
 */
export function canRemove(
  actor: { id: string; role: Role },
  target: { id: string; role: Role },
): boolean {
  if (actor.id === target.id) return false;
  if (target.role === 'superadmin') return false;
  if (actor.role === 'superadmin') return true;
  if (actor.role === 'admin') return target.role === 'employee' || target.role === 'guest';
  return false;
}
