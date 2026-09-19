/**
 * Reglas puras del escritorio (#7, slice 5): posicion en tiles, etiqueta y el
 * pre-chequeo de solape de un area de 3x3. Viven aparte del adaptador por el
 * mismo motivo que `spaceRules.ts`/`decorRules.ts`: las rutas HTTP las
 * necesitan sin levantar Postgres, y una sola copia evita que la validacion
 * del adaptador y la de la ruta diverjan en silencio.
 *
 * Unidades: TILES, no pixeles. Ver el comentario de `schema.sql`.
 */

import { boundsOverlap } from '../spaces/spaceRules.ts';

/**
 * El lado del escritorio, en tiles. Un `TILE` son 32px y el contenedor de un
 * jugador mide 32x44, asi que 3x3 son nueve cajas de mas o menos una persona
 * de ancho cada una -- las mismas nueve que cuenta el `slot` de
 * `user_desk_configs` (ver `decorRules.DESK_SLOT_MAX`).
 *
 * Es una constante con nombre y no un `3` repartido por el codigo. La UNICA
 * copia literal que queda es la de `desks_no_overlap` en `schema.sql`, porque
 * el SQL no puede importar nada; que el numero sea uno solo aqui es lo que
 * hace que esa copia sea facil de encontrar si algun dia cambia.
 */
export const DESK_SIDE = 3;

/**
 * Errores propios y no `Error` pelado, misma razon que `InvalidSpaceError` en
 * `spaceRules.ts`: la ruta tiene que distinguir "el admin escribio una
 * posicion invalida" (400) de "ese sitio choca con otro escritorio" (409) de
 * "la base de datos se cayo" (500), y hacerlo por el TEXTO del mensaje es una
 * atadura que se rompe en cuanto alguien reescribe la frase. `instanceof` no.
 */
export class InvalidDeskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDeskError';
  }
}

/** Un area pedida choca con un escritorio que ya existe (`desks_no_overlap`). */
export class DeskOverlapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeskOverlapError';
  }
}

/**
 * Alguien pidio un escritorio que ya tiene otra persona. Es un tipo aparte de
 * `DeskOverlapError` aunque los dos acaben en 409: los provocan dos personas
 * distintas haciendo dos cosas distintas, y el cuerpo de la respuesta los
 * separa porque uno se arregla eligiendo otro sitio y el otro corrigiendo unas
 * coordenadas.
 *
 * NO lo lanza un chequeo previo. Lo lanza el adaptador cuando su UPDATE
 * condicional no toca ninguna fila, que es la unica forma de saberlo sin
 * perder la carrera: ver `pgDesks.claimDesk`.
 */
export class DeskTakenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeskTakenError';
  }
}

export interface DeskPosition {
  x: number;
  y: number;
}

/**
 * Recibe numeros sin tipar a proposito, igual que `assertValidBounds`: el
 * cuerpo de una peticion HTTP es JSON sin tipar y `"10.5"` pasaria un `x >= 0`
 * de TypeScript en compilacion pero no debe pasar en ejecucion.
 */
export function assertValidDeskPosition(position: DeskPosition): void {
  for (const [name, value] of [
    ['x', position.x],
    ['y', position.y],
  ] as const) {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new InvalidDeskError(`${name} debe ser un numero entero`);
    }
    if (value < 0) {
      throw new InvalidDeskError(`${name} debe ser mayor o igual que 0`);
    }
  }
}

/**
 * La etiqueta se guarda tal cual la escribio el admin, solo recortada: se
 * pinta en el mapa. Vacia NO se admite -- `label text NOT NULL` dejaria pasar
 * la cadena vacia y el mapa mostraria un escritorio que no se puede nombrar al
 * moverlo o borrarlo.
 */
export function normalizeDeskLabel(raw: string): string {
  const label = typeof raw === 'string' ? raw.trim() : '';
  if (label.length === 0) {
    throw new InvalidDeskError('label debe ser una cadena no vacia');
  }
  return label;
}

/**
 * Pre-chequeo de solape en aplicacion, para devolver 409 en vez del 500 que
 * daria dejar que `desks_no_overlap` lo atrape primero. La restriccion de la
 * base de datos sigue siendo la garantia real -- esta funcion es la version
 * amable, igual que `boundsOverlap` lo es de `spaces_no_overlap`.
 *
 * Reutiliza `boundsOverlap` en vez de repetir la comparacion, por lo mismo que
 * `decorRules` reutiliza `deriveSlug`: dos copias acaban divergiendo, y el dia
 * que pase, un solape seria un 409 para los espacios y un 500 para los
 * escritorios sin que nadie hubiese cambiado nada a proposito. De ahi viene
 * ademas el `<=` -- el contacto exacto de un borde CUENTA como solape, porque
 * asi lo trata el `&&` de `box` (ver la nota del spike en `spaceRules.ts`).
 */
export function deskBoundsOverlap(a: DeskPosition, b: DeskPosition): boolean {
  return boundsOverlap(
    { x: a.x, y: a.y, w: DESK_SIDE, h: DESK_SIDE },
    { x: b.x, y: b.y, w: DESK_SIDE, h: DESK_SIDE },
  );
}

export interface CreateDeskInput {
  label: string;
  x: number;
  y: number;
}

/**
 * Valida y normaliza de una vez lo que entra por `DeskDirectory.createDesk`.
 *
 * Solo salen `label`, `x` e `y`. Un `occupantId` en el input se cae aqui sin
 * hacer ruido: quien se sienta en un escritorio lo decide esa persona con
 * `claimDesk`, no el administrador que lo crea.
 */
export function normalizeCreateDeskInput(input: CreateDeskInput): CreateDeskInput {
  assertValidDeskPosition(input);
  return { label: normalizeDeskLabel(input.label), x: input.x, y: input.y };
}

export interface UpdateDeskInput {
  label?: string;
  x?: number;
  y?: number;
}

/**
 * Valida y normaliza un cambio parcial. El escritorio se mueve entero o no se
 * mueve: aceptar solo `x` sin `y` dejaria una posicion a medio definir, y
 * `assertValidDeskPosition` no tiene forma de validar lo que falta. Mismo
 * criterio que el rectangulo de `normalizeUpdateSpaceInput`.
 */
export function normalizeUpdateDeskInput(input: UpdateDeskInput): UpdateDeskInput {
  const result: UpdateDeskInput = {};

  if (input.label !== undefined) {
    result.label = normalizeDeskLabel(input.label);
  }

  const moved = ['x', 'y'] as const;
  const provided = moved.filter((field) => input[field] !== undefined);
  if (provided.length > 0) {
    if (provided.length !== moved.length) {
      throw new InvalidDeskError('x e y deben actualizarse juntas: media coordenada no es una posicion');
    }
    const position = { x: input.x!, y: input.y! };
    assertValidDeskPosition(position);
    Object.assign(result, position);
  }

  return result;
}
