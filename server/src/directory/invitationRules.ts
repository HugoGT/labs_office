/**
 * Reglas puras de una invitacion (#24): cuantos dias son admisibles, cuando
 * caduca y como se normaliza un email. Viven aparte de los adaptadores porque
 * los dos las necesitan -- el de Postgres y el de memoria -- y dos copias de
 * "entre 1 y 90" se separan sin que ningun test lo note.
 *
 * El rango sale del issue #24 tal cual: de 1 a 90 dias, inclusive los dos
 * extremos. No es una constante negociable en tiempo de ejecucion a proposito:
 * si fuese configurable, un despliegue podria emitir invitaciones de 10 anos
 * sin que nadie revisase esa decision.
 */

import type { CreateInvitationInput } from './directoryPort.ts';

export const MIN_INVITATION_DAYS = 1;
export const MAX_INVITATION_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Error propio y no un `Error` pelado: la ruta de slice 2 tiene que distinguir
 * "el administrador escribio mal los dias" (400) de "la base de datos se cayo"
 * (500), y hacerlo por el TEXTO del mensaje es una atadura que se rompe en
 * cuanto alguien reescribe la frase. `instanceof` no.
 */
export class InvalidInvitationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInvitationError';
  }
}

/**
 * El tipo `number` de TypeScript no existe en tiempo de ejecucion y el cuerpo
 * de una peticion HTTP es JSON sin tipar: `days: "30"` llega como texto y
 * `"30" <= 90` seria `true` por coercion. De ahi que la guarda compruebe el
 * tipo, la finitud y que sea entero, no solo el rango.
 */
export function assertValidInvitationDays(days: number): void {
  if (typeof days !== 'number' || !Number.isInteger(days)) {
    throw new InvalidInvitationError('days debe ser un numero entero');
  }
  if (days < MIN_INVITATION_DAYS || days > MAX_INVITATION_DAYS) {
    throw new InvalidInvitationError(
      `days debe estar entre ${MIN_INVITATION_DAYS} y ${MAX_INVITATION_DAYS}`,
    );
  }
}

/**
 * Caducidad a partir de un instante de referencia inyectado. Devuelve una fecha
 * NUEVA: `Date` es mutable y un `setDate` sobre el argumento corromperia el
 * reloj del llamante en silencio.
 *
 * Suma milisegundos y no meses/dias de calendario porque "90 dias" aqui
 * significa 90 x 24 h, no "el mismo dia tres meses despues": asi la duracion no
 * depende de en que mes se firmo la invitacion ni de un cambio de horario.
 */
export function expiresAtFrom(now: Date, days: number): Date {
  return new Date(now.getTime() + days * MS_PER_DAY);
}

/**
 * El email es la clave humana del directorio y se guarda SIEMPRE normalizado.
 * Sin esto, `Ana@example.com` y `ana@example.com` serian dos filas distintas y
 * el indice unico no protegeria de nada. Ver `schema.sql`: el indice esta sobre
 * `lower(email)` justo por este motivo.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Valida y normaliza de una vez lo que entra por `createInvitation`. */
export function normalizeInvitationInput(input: CreateInvitationInput): {
  email: string;
  days: number;
  invitedById: string;
  uid: string;
} {
  assertValidInvitationDays(input.days);
  return {
    email: normalizeEmail(input.email),
    days: input.days,
    invitedById: input.invitedById,
    uid: input.uid,
  };
}
