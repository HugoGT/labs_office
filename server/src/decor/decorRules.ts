/**
 * Reglas puras del catalogo de decoracion (#7, slice 4): la normalizacion de
 * slug/nombre de un asset y el resto de sus reglas. Viven aparte del adaptador por el mismo motivo que
 * `spaceRules.ts`/`invitationRules.ts`: las rutas HTTP las necesitan sin
 * levantar Postgres, y una sola copia evita que la validacion del adaptador y
 * la de la ruta diverjan en silencio.
 *
 * Casi todo lo de aqui duplica un CHECK que `schema.sql` ya tiene. No sobra:
 * la restriccion de la base de datos sigue siendo la garantia real, pero salta
 * como un error de `pg` que el adaptador no sabe distinguir de una averia, y
 * el administrador acabaria leyendo un 500 donde lo unico que pasa es que
 * escribio 45 grados. Este modulo es la version amable, igual que
 * `boundsOverlap` lo es de `spaces_no_overlap`.
 */

import { deriveSlug } from '../spaces/spaceRules.ts';

/**
 * Errores propios y no `Error` pelado, misma razon que `InvalidSpaceError`: la
 * ruta tiene que distinguir "el cuerpo venia mal" (400) de "la base de datos
 * se cayo" (500), y hacerlo por el TEXTO del mensaje es una atadura que se
 * rompe en cuanto alguien reescribe la frase. `instanceof` no.
 *
 */
export class InvalidAssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAssetError';
  }
}

/**
 * Ese nombre ya es de otra pieza del catalogo: lo que salta
 * `assets_slug_unique`, sobre `lower(slug)` en `schema.sql`.
 *
 * No es un `InvalidAssetError` aunque las dos las provoque el mismo
 * administrador escribiendo el alta, misma razon que separa
 * `SpaceOverlapError` de `SpaceNameTakenError`: un cuerpo mal escrito es un 400
 * y ni siquiera llega a la base de datos, y esto es un 409 que solo puede
 * decidir quien conoce las filas que ya hay. El tipo es lo que mantiene los dos
 * codigos HTTP separados.
 *
 * El nombre y no el slug es lo que se nombra en el error porque es lo unico que
 * el admin escribio: el slug se DERIVA (`deriveAssetSlug`), asi que no hay un
 * segundo campo que pudiera corregir por separado.
 */
export class AssetNameTakenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssetNameTakenError';
  }
}

/** Los mismos tres del `CHECK (kind IN (...))` de `schema.sql`. */
export const ASSET_KINDS = ['furniture', 'decor', 'plant'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export function assertValidAssetKind(kind: unknown): void {
  if (typeof kind !== 'string' || !(ASSET_KINDS as readonly string[]).includes(kind)) {
    throw new InvalidAssetError(`kind debe ser uno de ${ASSET_KINDS.join(', ')}`);
  }
}

export function assertValidAssetSize(size: { w: number; h: number }): void {
  for (const [name, value] of [
    ['w', size.w],
    ['h', size.h],
  ] as const) {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new InvalidAssetError(`${name} debe ser un numero entero`);
    }
    if (value <= 0) {
      throw new InvalidAssetError(`${name} debe ser mayor que 0`);
    }
  }
}

/**
 * `texture_key` es lo UNICO que ata la fila con el sprite que el bundle del
 * cliente ya trae (el catalogo es curado: aqui no se sube ninguna imagen). Una
 * clave vacia deja un asset que nadie puede pintar y que el panel ofreceria
 * igual.
 */
export function assertValidTextureKey(textureKey: unknown): void {
  if (typeof textureKey !== 'string' || textureKey.trim().length === 0) {
    throw new InvalidAssetError('textureKey debe ser una cadena no vacia');
  }
}

/**
 * El slug sale de `spaceRules.deriveSlug` en vez de una copia identica. Dos
 * derivaciones separadas terminan divergiendo -- una aprende a quitar un
 * diacritico que la otra no -- y el dia que pase, el mismo nombre daria dos
 * slugs distintos segun quien lo escribiese, sin un solo error de por medio.
 */
export const deriveAssetSlug = deriveSlug;

/** El nombre se guarda tal cual lo escribio el admin, solo recortado: se muestra en el panel. */
export function normalizeAssetName(raw: string): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

export interface CreateAssetInput {
  name: string;
  kind: AssetKind;
  textureKey: string;
  w: number;
  h: number;
  placeableOnDesk: boolean;
  /** Optional so older callers keep working: absent means a normal asset (#71). */
  aboveAvatars?: boolean;
}

export interface NormalizedCreateAssetInput {
  slug: string;
  name: string;
  kind: AssetKind;
  textureKey: string;
  w: number;
  h: number;
  placeableOnDesk: boolean;
  aboveAvatars: boolean;
}

/** The only editable field of a catalog asset today (#71). */
export interface UpdateAssetInput {
  aboveAvatars?: boolean;
}

function assertOptionalAboveAvatars(value: unknown): void {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new InvalidAssetError('aboveAvatars debe ser un booleano');
  }
}

/** Valida y normaliza de una vez lo que entra por `DecorCatalog.createAsset`. */
export function normalizeCreateAssetInput(input: CreateAssetInput): NormalizedCreateAssetInput {
  const name = normalizeAssetName(input.name);
  const slug = deriveAssetSlug(name);
  if (slug.length === 0) {
    // Sin esto la fila entraria con `slug = ''` y el indice unico sobre
    // `lower(slug)` dejaria pasar exactamente uno, al azar del orden de alta.
    throw new InvalidAssetError('name debe dejar al menos un caracter alfanumerico');
  }

  assertValidAssetKind(input.kind);
  assertValidTextureKey(input.textureKey);
  assertValidAssetSize(input);
  if (typeof input.placeableOnDesk !== 'boolean') {
    throw new InvalidAssetError('placeableOnDesk debe ser un booleano');
  }
  assertOptionalAboveAvatars(input.aboveAvatars);

  return {
    slug,
    name,
    kind: input.kind,
    textureKey: input.textureKey.trim(),
    w: input.w,
    h: input.h,
    placeableOnDesk: input.placeableOnDesk,
    aboveAvatars: input.aboveAvatars ?? false,
  };
}

/**
 * Validates a partial asset update (#71). Only `aboveAvatars` comes out: name,
 * slug, size and archiving are not editable through this path, so any other
 * field in the input is dropped instead of silently persisted. An update with
 * nothing to change is rejected: a 200 that did nothing reads as "saved".
 */
export function normalizeUpdateAssetInput(input: UpdateAssetInput): Required<UpdateAssetInput> {
  if (input.aboveAvatars === undefined) {
    throw new InvalidAssetError('no hay ningun campo que actualizar');
  }
  assertOptionalAboveAvatars(input.aboveAvatars);
  return { aboveAvatars: input.aboveAvatars };
}
