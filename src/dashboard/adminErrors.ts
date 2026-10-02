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
  // Art migration, step 7. Each says what to pick instead, because the form
  // that sent it is still on screen with the choice that failed.
  'appearance-unknown-piece': 'Ese material no está en el catálogo de arte. Elige otro.',
  'appearance-retired-piece': 'Ese material ya no se puede elegir. Elige otro.',
  'appearance-color-not-allowed': 'Ese material conserva su propio aspecto y no admite color.',
  'appearance-invalid-color': 'El color no es válido: elige uno con la forma #rrggbb.',
  'appearance-immutable': 'El material y el color se eligen al crear y no se pueden cambiar después.',
  // Terrain editor (#123 phase 2). One says pick another block, the other wait.
  'terrain-under-placement':
    'El agua taparía una sala, un escritorio, una silla o la entrada de la oficina. Elige otro bloque o material.',
  'terrain-under-player': 'Hay alguien de pie en ese bloque: el agua podrá ir cuando se aparte.',
  'terrain-not-configured': 'La edición del terreno no está configurada en este servidor.',
  // Collision editor: the only refusal passes once that person moves.
  'collision-under-player': 'Hay alguien dentro de esa zona: la colisión podrá guardarse cuando se aparte.',
  'collisions-not-configured': 'La edición de colisiones no está configurada en este servidor.',
  // Art upload (#121). Each says what to change in the file, because the
  // form is still on screen with it; the panel adds which file it was.
  'not-png': 'El archivo no es un PNG.',
  'invalid-png': 'El PNG está dañado o incompleto y no se puede leer.',
  'unsupported-png': 'El PNG tiene que ser de 8 bits por canal y sin entrelazado. Vuelve a exportarlo así.',
  'invalid-dimensions': 'La imagen no mide exactamente lo que pide ese tipo de pieza.',
  'too-many-colors': 'La imagen tiene más de 128 colores distintos. Reduce la paleta.',
  'not-opaque': 'Un suelo no puede tener píxeles transparentes ni translúcidos.',
  'background-present': 'Las cuatro esquinas de cada cuadro tienen que ser transparentes. Quita el fondo.',
  'too-large': 'El archivo pesa más de 128 KB.',
  'invalid-metadata': 'Falta un dato de la pieza o no tiene el formato correcto.',
  'missing-file': 'Falta uno de los archivos que pide ese tipo de pieza.',
  'asset-upload-not-configured': 'La subida de arte no está configurada en este servidor.',
  'asset-already-uploaded': 'Esa imagen ya se subió: la pieza ya está en el catálogo.',
  'asset-name-taken': 'Ya hay una pieza de decoración con ese nombre. Elige otro.',
  // Art contributions (#122). The limits say what to wait for, since
  // retrying right away would only meet the same refusal.
  'rights-not-accepted': 'Tienes que confirmar la cesión de derechos para subir la pieza.',
  'too-many-pending': 'Ya tienes 5 piezas pendientes de revisión. Espera a que se revisen antes de subir otra.',
  'hourly-limit': 'Ya subiste 10 piezas en la última hora. Vuelve a intentarlo más tarde.',
  'already-reviewed': 'Otra persona ya revisó esta pieza. Recarga la lista.',
  'invalid-review-note': 'Escribe el motivo del rechazo: quien subió la pieza lo verá.',
  'not-retirable': 'Solo se pueden retirar personajes y plantas de decoración.',
  'not-approved': 'Solo se puede retirar una pieza aprobada.',
  network: 'No se pudo contactar con el servidor.',
  unknown: GENERIC_MESSAGE,
};

export function describeAdminError(error: unknown): string {
  return error instanceof AdminError ? MESSAGES[error.code] : GENERIC_MESSAGE;
}
