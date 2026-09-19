/**
 * Reglas puras del catalogo de decoracion (#7, slice 4): rango de slot,
 * rotaciones, el filtro de `placeable_on_desk` y la normalizacion de
 * slug/nombre de un asset. Viven aparte del adaptador por el mismo motivo que
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
 * Son DOS y no uno porque separan dos superficies distintas: quien da de alta
 * un asset es un administrador, y quien monta su escritorio es cualquiera. Que
 * el tipo diga cual de las dos fallo se lee mejor en el log que un texto.
 */
export class InvalidAssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAssetError';
  }
}

export class InvalidDeskConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDeskConfigError';
  }
}

/** Los mismos tres del `CHECK (kind IN (...))` de `schema.sql`. */
export const ASSET_KINDS = ['furniture', 'decor', 'plant'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** Las mismas cuatro del `CHECK (rotation IN (...))` de `schema.sql`. */
export const DESK_ROTATIONS = [0, 90, 180, 270] as const;
export type DeskRotation = (typeof DESK_ROTATIONS)[number];

/** El mismo `CHECK (slot BETWEEN 0 AND 5)` de `schema.sql`. Seis huecos, ni uno mas. */
export const DESK_SLOT_MIN = 0;
export const DESK_SLOT_MAX = 5;

/**
 * Recibe numeros sin tipar a proposito, igual que `assertValidBounds`: el
 * cuerpo de una peticion HTTP es JSON sin tipar y `"3"` o `2.5` pasarian un
 * `slot <= 5` de TypeScript en compilacion pero no deben pasar en ejecucion.
 */
export function assertValidSlot(slot: number): void {
  if (typeof slot !== 'number' || !Number.isInteger(slot)) {
    throw new InvalidDeskConfigError('slot debe ser un numero entero');
  }
  if (slot < DESK_SLOT_MIN || slot > DESK_SLOT_MAX) {
    throw new InvalidDeskConfigError(
      `slot debe estar entre ${DESK_SLOT_MIN} y ${DESK_SLOT_MAX} inclusive`,
    );
  }
}

export function assertValidRotation(rotation: number): void {
  if (typeof rotation !== 'number' || !(DESK_ROTATIONS as readonly number[]).includes(rotation)) {
    throw new InvalidDeskConfigError(`rotation debe ser una de ${DESK_ROTATIONS.join(', ')}`);
  }
}

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
}

export interface NormalizedCreateAssetInput {
  slug: string;
  name: string;
  kind: AssetKind;
  textureKey: string;
  w: number;
  h: number;
  placeableOnDesk: boolean;
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

  return {
    slug,
    name,
    kind: input.kind,
    textureKey: input.textureKey.trim(),
    w: input.w,
    h: input.h,
    placeableOnDesk: input.placeableOnDesk,
  };
}

/** Lo minimo que hace falta saber de un asset para decidir si cabe en un escritorio. */
export interface PlaceableAsset {
  id: string;
  placeableOnDesk: boolean;
}

export function assertPlaceableOnDesk(asset: PlaceableAsset): void {
  if (!asset.placeableOnDesk) {
    throw new InvalidDeskConfigError(`el asset ${asset.id} no se puede colocar en un escritorio`);
  }
}

export interface DeskItemInput {
  assetId: string;
  slot: number;
  rotation: number;
}

export interface NormalizedDeskItem {
  assetId: string;
  slot: number;
  rotation: DeskRotation;
}

/**
 * La mitad de la validacion que NO necesita el catalogo: forma del `assetId`,
 * rango de slot, rotacion y slots repetidos.
 *
 * Esta separada a proposito. El adaptador la corre ANTES de pedir conexion, de
 * modo que un slot repetido o una rotacion de 45 grados se rechazan sin
 * gastar una consulta; lo unico que de verdad obliga a mirar el almacen es
 * saber si cada asset existe y es colocable.
 *
 * Es "completa" y no incremental porque `replaceDeskConfig` borra e inserta:
 * lo que llega aqui es el escritorio entero, asi que los slots repetidos se
 * ven de una sola pasada sin consultar lo que ya habia.
 */
export function assertValidDeskShape(items: readonly DeskItemInput[]): void {
  const seenSlots = new Set<number>();

  for (const item of items) {
    if (typeof item?.assetId !== 'string' || item.assetId.length === 0) {
      throw new InvalidDeskConfigError('assetId debe ser una cadena no vacia');
    }
    assertValidSlot(item.slot);
    assertValidRotation(item.rotation);

    if (seenSlots.has(item.slot)) {
      // El indice unico `(user_id, slot)` de `schema.sql` es la garantia real.
      throw new InvalidDeskConfigError(`el slot ${item.slot} aparece dos veces`);
    }
    seenSlots.add(item.slot);
  }
}

/**
 * Valida una configuracion de escritorio completa contra el catalogo: la forma
 * de arriba, mas que cada asset exista y admita ir en un escritorio.
 *
 * El orden de llegada se conserva. Ordenar aqui esconderia que el orden no
 * significa nada -- quien lo lee es `getDeskConfig`, que ordena por slot.
 *
 * El catalogo se pasa como argumento en vez de consultarse: este modulo no
 * habla con ningun almacen, igual que `spaceRules.ts` recibe los rectangulos
 * con los que comparar.
 */
export function normalizeDeskConfig(
  items: readonly DeskItemInput[],
  catalog: readonly PlaceableAsset[],
): NormalizedDeskItem[] {
  assertValidDeskShape(items);
  const byId = new Map(catalog.map((asset) => [asset.id, asset]));

  return items.map((item) => {
    const asset = byId.get(item.assetId);
    if (asset === undefined) {
      // La FK tambien lo atraparia, pero como un 23503 indistinguible de una
      // averia. Aqui es un 400 que dice lo que pasa.
      throw new InvalidDeskConfigError(`el asset ${item.assetId} no existe en el catalogo`);
    }
    assertPlaceableOnDesk(asset);

    return { assetId: item.assetId, slot: item.slot, rotation: item.rotation as DeskRotation };
  });
}
