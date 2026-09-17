/**
 * Reglas puras del alta de alguien de casa: que roles se pueden repartir desde
 * el panel y como se normaliza lo que llega. Viven aparte de los adaptadores
 * por el mismo motivo que `invitationRules.ts`: las necesitan los dos -- el de
 * Postgres y el de memoria -- y dos listas de roles asignables se separan sin
 * que ningun test lo note.
 *
 * ## Por que la lista deja fuera a `superadmin` y a `guest`
 *
 * `superadmin` lo protege el indice unico parcial `users_single_superadmin` de
 * `schema.sql`: crear un segundo fallaria contra la base de datos de todas
 * formas, pero el fallo llegaria como un 23505 convertido en 500, cuando lo
 * cierto es que quien lo pidio escribio algo que este panel no reparte. La
 * unica promocion a superadmin es la del bootstrap, que la decide quien
 * configura el entorno y no quien administra desde una pantalla.
 *
 * `guest` queda fuera porque esta ruta no pone caducidad: un invitado eterno es
 * exactamente el agujero que `POST /admin/invitations` existe para cerrar. Si
 * se pudiese pedir `guest` por aqui, el rango de 1 a 90 dias seria opcional, y
 * una regla que se puede rodear no es una regla.
 */

import type { AssignableRole, CreateUserInput } from './directoryPort.ts';
import { normalizeEmail } from './invitationRules.ts';

export const ASSIGNABLE_ROLES = ['employee', 'admin'] as const satisfies readonly AssignableRole[];

/**
 * Error propio y no un `Error` pelado, misma razon que `InvalidInvitationError`:
 * la ruta tiene que distinguir "el administrador pidio un rol que no se
 * reparte" (400) de "la base de datos se cayo" (500), y hacerlo por el TEXTO
 * del mensaje es una atadura que se rompe en cuanto alguien reescribe la frase.
 * `instanceof` no.
 */
export class InvalidUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidUserError';
  }
}

/**
 * Recibe `unknown` y no `AssignableRole` a proposito: el tipo no existe en
 * tiempo de ejecucion y el cuerpo de una peticion HTTP es JSON sin tipar, asi
 * que aqui llega literalmente cualquier cosa. Lista blanca y no "todo lo que no
 * sea superadmin": al anadir un rol nuevo, el default seguro es que NO se pueda
 * repartir desde el panel.
 */
export function assertAssignableRole(role: unknown): asserts role is AssignableRole {
  if (!ASSIGNABLE_ROLES.includes(role as AssignableRole)) {
    throw new InvalidUserError(`role debe ser uno de: ${ASSIGNABLE_ROLES.join(', ')}`);
  }
}

/** Valida y normaliza de una vez lo que entra por `createUser`. */
export function normalizeUserInput(input: CreateUserInput): {
  email: string;
  role: AssignableRole;
  uid: string;
  createdById: string;
} {
  assertAssignableRole(input.role);
  return {
    // `normalizeEmail` se reutiliza en vez de repetirse: si esta ruta
    // normalizase por su cuenta, el mismo correo podria acabar siendo dos filas
    // distintas segun por donde se diera de alta.
    email: normalizeEmail(input.email),
    role: input.role,
    uid: input.uid,
    createdById: input.createdById,
  };
}
