/**
 * Contrasena inicial de una invitacion (#24, punto 3). Modulo puro y diminuto a
 * proposito: es el unico sitio donde se decide cuanta entropia tiene la
 * credencial con la que entra un invitado, y eso merece poder leerse entero de
 * una sentada.
 *
 * ## El ciclo de vida completo de este valor
 *
 * Se devuelve UNA sola vez, en el cuerpo del `201` de `POST /admin/invitations`.
 * No se guarda en el directorio (`schema.sql` no tiene columna para ella), no
 * se escribe en el rastro de auditoria, y no aparece en ningun log: quien la
 * necesite la copia de la pantalla en ese momento o no la tiene. Si se pierde,
 * el camino es revocar la invitacion y crear otra, no "recuperarla" -- porque
 * no hay nada que recuperar. `adminRoutes.test.ts` tiene una regresion
 * explicita que afirma que el logger inyectado no la recibe nunca.
 *
 * Que no se almacene no es solo higiene: Identity Platform guarda el hash y es
 * la unica fuente de verdad de la credencial. Una segunda copia en nuestra base
 * de datos seria una copia que hay que proteger, rotar y borrar, y que nadie
 * necesita.
 *
 * ## Por que `node:crypto` y no `Math.random()`
 *
 * `Math.random()` es un PRNG no criptografico: en V8 es xorshift128+, cuyo
 * estado interno se reconstruye observando unas pocas salidas. Quien vea una
 * contrasena generada puede predecir las siguientes. `randomInt` va al CSPRNG
 * del sistema, que es justo lo que hace falta para una credencial.
 *
 * ## Por que `randomInt` y no `randomBytes(n)[i] % alfabeto.length`
 *
 * El modulo introduce sesgo salvo que el tamano del alfabeto divida a 256: con
 * 56 caracteres, los 8 primeros saldrian mas a menudo que el resto (256 = 4*56
 * + 32). `randomInt` hace muestreo con rechazo internamente y devuelve una
 * distribucion uniforme sobre el rango pedido, que es exactamente el trabajo
 * que no conviene reescribir a mano aqui.
 */

import { randomInt } from 'node:crypto';

/**
 * Sin `0`/`O`/`o`, sin `1`/`l`/`I`. La contrasena la transcribe una persona una
 * sola vez -- se dicta por telefono, se copia de una pantalla a otra, se pega
 * en un chat y se vuelve a teclear -- y un caracter ambiguo convierte un alta
 * en un "no me deja entrar" que nadie sabe diagnosticar, porque el sintoma es
 * identico al de una contrasena mal escrita a secas.
 *
 * Se excluyen tambien los simbolos: no anaden entropia util frente a subir la
 * longitud (cada caracter extra del alfabeto vale log2(57/56) bits, cada
 * caracter extra de longitud vale log2(56) ~ 5.8) y si anaden problemas reales
 * al copiar y pegar entre terminal, gestor de contrasenas y formulario web.
 */
export const PASSWORD_ALPHABET =
  'ABCDEFGHJKLMNPQRSTUVWXYZ' + 'abcdefghijkmnpqrstuvwxyz' + '23456789';

/**
 * 20 caracteres sobre un alfabeto de 56 son ~116 bits de entropia. Identity
 * Platform exige 6; ese minimo describe lo que el proveedor tolera, no lo que
 * una credencial de hasta 90 dias que nadie va a rotar deberia valer.
 */
export const PASSWORD_LENGTH = 20;

export function generatePassword(): string {
  let password = '';
  for (let i = 0; i < PASSWORD_LENGTH; i++) {
    password += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  }
  return password;
}
