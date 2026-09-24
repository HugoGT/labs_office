/**
 * Reglas puras de `Space` (#7): validacion de rectangulo, pre-chequeo de
 * solape, normalizacion de slug/nombre, y el hash canonico que es `version`
 * (D4 en el diseno). Viven aparte del adaptador por el mismo motivo que
 * `invitationRules.ts`/`userRules.ts`: cualquier consumidor futuro (las rutas
 * HTTP de la slice 3) las necesita sin levantar Postgres, y una sola copia
 * evita que la validacion del adaptador y la de la ruta diverjan en silencio.
 *
 * Unidades: TILES, no pixeles. Ver el comentario de `schema.sql`.
 */

import { createHash } from 'node:crypto';
import { boundsOverlap, type SpaceBounds } from '../../../src/game/layoutGeometry.ts';

// Reexportados tal cual (#74, PR3a): `boundsOverlap` se mudo a
// `src/game/layoutGeometry.ts` porque el editor de layout en oficina (PR3b)
// necesita el MISMO pre-chequeo del lado del cliente, que no puede importar
// este modulo entero (arrastra `node:crypto` via `hashSpaces`). Reexportar en
// vez de duplicar es lo que garantiza que las dos copias nunca diverjan; ver
// la cabecera de `layoutGeometry.ts` para la nota completa.
export { boundsOverlap, type SpaceBounds };

/**
 * Errores propios y no `Error` pelado, misma razon que `InvalidInvitationError`
 * en `invitationRules.ts`: la ruta de la slice 3 tiene que distinguir "el
 * admin escribio un rectangulo invalido" (400) de "el rectangulo choca con
 * otro que ya existe" (409) de "la base de datos se cayo" (500), y hacerlo
 * por el TEXTO del mensaje es una atadura que se rompe en cuanto alguien
 * reescribe la frase. `instanceof` no.
 */
export class InvalidSpaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSpaceError';
  }
}

/** Un rectangulo pedido choca con uno que ya existe (D1: EXCLUDE USING gist). */
export class SpaceOverlapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpaceOverlapError';
  }
}

/**
 * Ese nombre ya es de otro espacio: lo que saltan `spaces_name_unique` y
 * `spaces_slug_unique`, los dos sobre `lower(...)` en `schema.sql`.
 *
 * Es un tipo propio y no un `SpaceOverlapError` aunque los dos acaben en 409,
 * misma razon que separa `DeskOverlapError` de `DeskTakenError`: se arreglan de
 * formas distintas. El solape se corrige moviendo el rectangulo; esto se
 * corrige eligiendo otro nombre. Colapsarlos mandaria al administrador a mover
 * una sala que estaba perfectamente colocada.
 *
 * Los DOS indices dan el mismo error porque el admin solo escribe una cosa: el
 * slug se DERIVA del nombre (`deriveSlug`), asi que no hay un segundo campo que
 * pudiera corregir por separado.
 */
export class SpaceNameTakenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpaceNameTakenError';
  }
}

/**
 * El tercer 409 de los espacios (#10 + #12): quien llama intento crear,
 * renombrar, mover/redimensionar o borrar un espacio que en realidad es el
 * cubiculo de un escritorio (`desk_id` no nulo). Esos espacios NO se
 * administran por esta ruta -- solo como efecto secundario del CRUD de
 * escritorios (`pgDesks`, S1b) -- asi que ni moviendo el rectangulo ni
 * eligiendo otro nombre se arregla: hay que ir a `DesksPanel`. Tipo propio y
 * no `SpaceOverlapError`/`SpaceNameTakenError` reciclados, misma razon que
 * separa esos dos entre si.
 */
export class SpaceOwnedByDeskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpaceOwnedByDeskError';
  }
}

/**
 * Recibe `unknown`-shaped numbers a proposito, igual que
 * `assertValidInvitationDays`: el cuerpo de una peticion HTTP es JSON sin
 * tipar y `"10.5"` pasaria un `x > 0` de TypeScript en tiempo de compilacion
 * pero no debe pasar en tiempo de ejecucion.
 */
export function assertValidBounds(bounds: SpaceBounds): void {
  const { x, y, w, h } = bounds;
  for (const [name, value] of [
    ['x', x],
    ['y', y],
    ['w', w],
    ['h', h],
  ] as const) {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new InvalidSpaceError(`${name} debe ser un numero entero`);
    }
  }
  if (x < 0) throw new InvalidSpaceError('x debe ser mayor o igual que 0');
  if (y < 0) throw new InvalidSpaceError('y debe ser mayor o igual que 0');
  if (w <= 0) throw new InvalidSpaceError('w debe ser mayor que 0');
  if (h <= 0) throw new InvalidSpaceError('h debe ser mayor que 0');
}

export function assertValidCapacity(capacity: number | null): void {
  if (capacity === null) return;
  if (typeof capacity !== 'number' || !Number.isInteger(capacity)) {
    throw new InvalidSpaceError('capacity debe ser un numero entero o null');
  }
  if (capacity <= 0) {
    throw new InvalidSpaceError('capacity debe ser mayor que 0');
  }
}

/**
 * Slug determinista a partir del nombre: minusculas, sin acentos, solo
 * alfanumericos y guiones, sin guiones repetidos ni en los extremos. No se
 * pide como campo aparte en el alta (la especificacion solo habla de "bounds
 * y un nombre") -- se deriva aqui para que la ruta HTTP de la slice 3 no
 * tenga que inventar uno.
 */
export function deriveSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita los diacriticos ya separados por NFD
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** El nombre se guarda tal cual lo escribio el admin, solo recortado: se muestra en el HUD. */
export function normalizeSpaceName(raw: string): string {
  return raw.trim();
}

export interface CreateSpaceInput {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  capacity: number | null;
}

export interface NormalizedCreateSpaceInput {
  slug: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  capacity: number | null;
}

/** Valida y normaliza de una vez lo que entra por `SpacesDirectory.createSpace`. */
export function normalizeCreateSpaceInput(input: CreateSpaceInput): NormalizedCreateSpaceInput {
  assertValidBounds(input);
  assertValidCapacity(input.capacity);
  const name = normalizeSpaceName(input.name);
  return {
    slug: deriveSlug(name),
    name,
    x: input.x,
    y: input.y,
    w: input.w,
    h: input.h,
    capacity: input.capacity,
  };
}

export interface UpdateSpaceInput {
  name?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  capacity?: number | null;
}

export interface NormalizedUpdateSpaceInput {
  slug?: string;
  name?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  capacity?: number | null;
}

/**
 * Valida y normaliza un cambio parcial. El rectangulo se mueve entero o no se
 * mueve: aceptar solo `x` sin `y`/`w`/`h` dejaria un rectangulo a medio
 * definir, y `assertValidBounds` no tiene forma de validar lo que falta.
 */
export function normalizeUpdateSpaceInput(input: UpdateSpaceInput): NormalizedUpdateSpaceInput {
  const result: NormalizedUpdateSpaceInput = {};

  if (input.name !== undefined) {
    const name = normalizeSpaceName(input.name);
    result.name = name;
    result.slug = deriveSlug(name);
  }

  const boundsFields = ['x', 'y', 'w', 'h'] as const;
  const providedBounds = boundsFields.filter((field) => input[field] !== undefined);
  if (providedBounds.length > 0) {
    if (providedBounds.length !== boundsFields.length) {
      throw new InvalidSpaceError(
        'x, y, w y h deben actualizarse juntos: un rectangulo a medias no es valido',
      );
    }
    const bounds = { x: input.x!, y: input.y!, w: input.w!, h: input.h! };
    assertValidBounds(bounds);
    Object.assign(result, bounds);
  }

  if (input.capacity !== undefined) {
    assertValidCapacity(input.capacity);
    result.capacity = input.capacity;
  }

  return result;
}

/**
 * Lo que entra en el hash de `version` (D4): ids, slugs, nombres,
 * rectangulos, capacidad -- NUNCA `createdAt`/`updatedAt`. El hash es una
 * funcion pura de lo unico de lo que depende la pertenencia de un peer a un
 * espacio.
 */
export interface CanonicalSpace {
  id: string;
  slug: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  capacity: number | null;
}

/** Orden estable por id: el hash no puede depender del orden en que llegaron las filas. */
export function canonicalizeSpaces(spaces: readonly CanonicalSpace[]): CanonicalSpace[] {
  return [...spaces]
    .map(({ id, slug, name, x, y, w, h, capacity }) => ({ id, slug, name, x, y, w, h, capacity }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * `version` = primeros 16 caracteres hex de un sha256 sobre la lista
 * canonicamente ordenada. Server-only: el cliente nunca hashea nada (D4) --
 * este es el UNICO sitio donde se calcula.
 */
export function hashSpaces(spaces: readonly CanonicalSpace[]): string {
  const canonical = canonicalizeSpaces(spaces);
  const json = JSON.stringify(canonical);
  return createHash('sha256').update(json).digest('hex').slice(0, 16);
}
