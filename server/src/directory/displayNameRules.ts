/**
 * Reglas puras del nombre visible auto-elegido en login (#100, D10). Viven
 * aparte de los adaptadores por el mismo motivo que `invitationRules.ts` y
 * `userRules.ts`: la ruta HTTP, el adaptador de Postgres y el de memoria
 * necesitan la MISMA forma canonica, y dos copias se separan sin que ningun
 * test lo note.
 *
 * ## Por que esto fija la forma que `schema.sql` da por sentada
 *
 * El indice unico parcial de `users` compara
 * `lower(btrim(regexp_replace(display_name, '[[:space:]]+', ' ', 'g')))`. Si
 * los valores que llegan a la base ya estan canonicalizados por esta funcion,
 * esa expresion se reduce a `lower(stored)` para cualquier fila NUEVA: el
 * colapso de espacios y el recorte ya se hicieron aqui, en JavaScript, antes
 * de que el valor toque el disco. La clase `\s` de JavaScript cubre todo Zs
 * de Unicode mas los terminadores de linea, que es un superconjunto estricto
 * de `[[:space:]]` en la configuracion `C` de Postgres; y el rechazo de
 * `\p{Cc}` de aqui abajo quita justo los caracteres de control que
 * `[[:space:]]` podria anadir y que `\s` no cubre. Con eso, JS y SQL no
 * pueden discrepar sobre un valor ya guardado por esta funcion.
 *
 * ## Por que se rechaza en vez de recortar
 *
 * Un nombre de 30 caracteres truncado en silencio a 24 dejaria a la persona
 * pensando que eligio un nombre que en realidad no es el que ve todo el
 * mundo. El error se lo dice antes de guardar nada.
 */

import { MAX_NAME_LENGTH } from '../../../src/game/officeProtocol.ts';

export { MAX_NAME_LENGTH };

/**
 * Error propio y no un `Error` pelado, misma razon que `InvalidInvitationError`
 * e `InvalidUserError`: la ruta tiene que distinguir "el nombre no vale" (400)
 * de "la base de datos se cayo" (500) por `instanceof`, no por el texto del
 * mensaje.
 */
export class InvalidDisplayNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDisplayNameError';
  }
}

/**
 * El indice parcial `users_display_name_unique` de `schema.sql` es el arbitro
 * de verdad (D3): ni `pgDirectory` ni `memoryDirectory` deciden por su cuenta
 * si un nombre esta libre, solo traducen el 23505 -- o, en memoria, el mismo
 * resultado por comportamiento -- a este error propio para que la ruta HTTP lo
 * distinga por `instanceof` de cualquier otro fallo.
 */
export class DisplayNameTakenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DisplayNameTakenError';
  }
}

/** Caracteres de control Unicode que `\s` no colapsa (ni tabuladores ni saltos de linea, que ya son `\s`). */
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR = /\p{Cc}/u;

/**
 * Colapsa cualquier run de espacio en blanco (incluye tabuladores, saltos de
 * linea y NBSP, que `\s` de JavaScript cubre entero) a un unico espacio,
 * recorta los extremos, y rechaza lo que quede vacio, con caracteres de
 * control, o por encima de `MAX_NAME_LENGTH` medido DESPUES del colapso.
 */
export function canonicalizeDisplayName(raw: string): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();

  if (collapsed.length === 0) {
    throw new InvalidDisplayNameError('el nombre no puede estar vacio');
  }
  if (CONTROL_CHAR.test(collapsed)) {
    throw new InvalidDisplayNameError('el nombre contiene caracteres no permitidos');
  }
  if (collapsed.length > MAX_NAME_LENGTH) {
    throw new InvalidDisplayNameError(
      `el nombre no puede superar los ${MAX_NAME_LENGTH} caracteres`,
    );
  }

  return collapsed;
}

/**
 * Clave de comparacion de unicidad: solo minusculas. Se llama SIEMPRE sobre
 * la salida de `canonicalizeDisplayName`, nunca sobre texto crudo -- por eso
 * no vuelve a colapsar espacios.
 */
export function displayNameKey(canonical: string): string {
  return canonical.toLowerCase();
}
