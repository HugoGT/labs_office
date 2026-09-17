/**
 * Traduccion de `AdminErrorCode` a texto para la persona (#24), en el mismo
 * espiritu que `auth/authErrors.ts`: pura, sin importar nada de HTTP, y el
 * unico sitio donde vive la copia del panel sobre fallos.
 *
 * Cada codigo tiene su frase porque cada uno se arregla distinto: un 403 lo
 * arregla quien administra el proyecto, un 503 lo arregla quien despliega, y
 * un fallo de red no lo arregla nadie desde esta pantalla. Un "algo salio
 * mal" unico obligaria a abrir la consola para distinguirlos.
 */

import { AdminError, type AdminErrorCode } from './adminPort';

const GENERIC_MESSAGE = 'No se pudo completar la operación.';

const MESSAGES: Readonly<Record<AdminErrorCode, string>> = {
  unauthorized: 'Tu sesión caducó. Vuelve a entrar.',
  forbidden: 'No tienes permiso para esta acción.',
  // Sin nombrar la invitacion: estos dos codigos los devuelven los DOS flujos
  // de alta, y decir "invitación" al dar de alta a un empleado seria una
  // explicacion falsa (ese correo no tiene una invitacion, tiene una cuenta).
  'invalid-request': 'El servidor no aceptó los datos del alta.',
  conflict: 'Ese correo ya tiene una cuenta.',
  // No es un fallo de quien invita: el servidor no tiene credenciales de
  // administracion de Identity Platform (#24, seccion 3). Decir "inténtalo de
  // nuevo" le haria repetir el intento para siempre.
  'identity-admin-not-configured':
    'La creación de cuentas no está configurada en el servidor.',
  network: 'No se pudo contactar con el servidor.',
  unknown: GENERIC_MESSAGE,
};

export function describeAdminError(error: unknown): string {
  return error instanceof AdminError ? MESSAGES[error.code] : GENERIC_MESSAGE;
}
