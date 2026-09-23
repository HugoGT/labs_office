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
  // Sin nombrar la invitacion NI el alta: este codigo lo devuelven los dos
  // flujos de alta, pero tambien mover un escritorio a unas coordenadas
  // invalidas. Decir "invitación" al dar de alta a un empleado ya era falso
  // (ese correo no tiene una invitacion, tiene una cuenta); decir "del alta"
  // al mover algo que ya existe lo es igual.
  'invalid-request': 'El servidor no aceptó esos datos.',
  conflict: 'Ese correo ya tiene una cuenta.',
  // No dice "no se encontró": el dato que se mando estaba bien cuando se leyo
  // la lista. Lo que cambio fue el servidor, y decirlo asi evita que quien
  // administra revise unas coordenadas que no tenian nada de malo.
  'not-found': 'Eso ya no está en el servidor: alguien lo quitó mientras mirabas.',
  // Las coordenadas Y el tamano, porque sin los dos no se puede corregir: un
  // escritorio ocupa 3x3 casillas y el contacto exacto de un borde ya cuenta
  // como solape (`deskBoundsOverlap`), asi que "al lado" no siempre cabe.
  'desk-overlap':
    'Esas coordenadas chocan con otro escritorio: cada uno ocupa 3×3 casillas y ni los bordes pueden tocarse.',
  // El choque es contra una SALA, no contra otro escritorio: el cubiculo de
  // 3x3 que acompaña a cada escritorio no puede pisar el rectangulo de una
  // sala existente (issue #10, S2 3.5).
  'desk-space-overlap':
    'Esas coordenadas chocan con una sala: el cubiculo de 3×3 del escritorio no puede pisar su rectángulo.',
  // Dos salas pisandose (#10 + #12, S3a). Mismo criterio que `desk-overlap`:
  // se arregla escribiendo otras coordenadas, no cambiando de nombre.
  'space-overlap': 'Esas coordenadas chocan con otra sala existente.',
  // El nombre, no las coordenadas: cambiar de sitio una sala con nombre
  // repetido no arregla nada. Distinguirlo de `space-overlap` evita que quien
  // administra mueva un rectangulo que estaba bien colocado.
  'space-name-taken': 'Ya existe una sala con ese nombre.',
  // No es un fallo de quien administra: ese espacio es el cubiculo de un
  // escritorio, y se administra desde el panel de escritorios, no desde este.
  'space-owned-by-desk':
    'Ese espacio es el cubículo de un escritorio: se administra desde el panel de escritorios.',
  // No es un fallo de quien invita: el servidor no tiene credenciales de
  // administracion de Identity Platform (#24, seccion 3). Decir "inténtalo de
  // nuevo" le haria repetir el intento para siempre.
  'identity-admin-not-configured':
    'La creación de cuentas no está configurada en el servidor.',
  // Tampoco son fallos de quien administra, y ademas NO son averias: un
  // despliegue sin `DATABASE_URL` es un estado legitimo (la oficina funciona,
  // simplemente no hay escritorios ni catalogo que administrar). De ahi que la
  // frase no pida reintentar nada.
  'desks-not-configured': 'Los escritorios asignables no están configurados en este servidor.',
  'decor-not-configured': 'El catálogo de decoración no está configurado en este servidor.',
  // Cuarta pieza del mismo despliegue sin `DATABASE_URL`: tampoco hay tabla de
  // espacios que administrar.
  'spaces-not-configured': 'Las salas no están configuradas en este servidor.',
  network: 'No se pudo contactar con el servidor.',
  unknown: GENERIC_MESSAGE,
};

export function describeAdminError(error: unknown): string {
  return error instanceof AdminError ? MESSAGES[error.code] : GENERIC_MESSAGE;
}
