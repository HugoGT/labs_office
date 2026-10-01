/**
 * Puerto del catalogo de decoracion (#7, slice 4). Solo tipos: aqui no hay ni
 * SQL ni `pg` ni Express ni Colyseus, misma regla que `directoryPort.ts` y
 * `spacesPort.ts`. Los adaptadores son `pgDecor.ts` (el de produccion) y
 * `memoryDecor.ts` (para probar las rutas sin base de datos).
 *
 * Dos entidades bajo un puerto -- el catalogo de `assets` y la configuracion
 * de escritorio de cada persona -- y no dos puertos, por la misma razon que
 * `SpaceLayout` cuelga de `SpacesDirectory`: no hay ningun consumidor de la
 * segunda que no necesite la primera. Validar una colocacion exige saber si su
 * asset es colocable, asi que separarlos empujaria esa consulta fuera del
 * adaptador, que es justo donde `pgSpaces.replaceLayout` demuestra que le toca
 * vivir.
 *
 * The art pack catalog (art migration, step 3) joins them here as a third
 * entity for the same reason: it is the catalog the decor will draw from, and
 * a second port would need the same pool and the same retire-not-delete rule.
 *
 * ## Retirar del catalogo NO es borrar (D1b)
 *
 * `archivedAt` no es un borrado suave por comodidad. Es la afirmacion de que
 * un asset ya no se puede colocar de NUEVO, y NO una edicion retroactiva de
 * los escritorios ajenos: quien ya lo tenia puesto lo sigue viendo. De ahi la
 * asimetria que recorre todo el puerto y que los dos adaptadores tienen que
 * respetar igual:
 *
 *   - `listAssets()` -- lectura de CATALOGO -- filtra los archivados.
 *   - `getDeskConfig()` -- lectura de COLOCACION -- no filtra nada, para que
 *     una pieza retirada siga resolviendo su `textureKey` y se siga pintando.
 */

import type { ArtPackManifest, ArtPiece, ArtPieceFile, ArtPieceKind } from '../../../src/game/artContract.ts';

export type AssetKind = 'furniture' | 'decor' | 'plant';

/** Las mismas cuatro del `CHECK (rotation IN (...))` de `schema.sql`. */
export type DeskRotation = 0 | 90 | 180 | 270;

export interface Asset {
  id: string;
  slug: string;
  name: string;
  kind: AssetKind;
  /**
   * Clave del sprite que el bundle del cliente YA trae, o la de una pieza de
   * arte (`art:<id>:<role>`, `artSheetKey`), que la escena carga bajo demanda:
   * es lo que pone la subida de una planta (#121). Esta ruta no sube imagenes.
   */
  textureKey: string;
  /** Tamano en TILES, no en pixeles. Misma unidad que `Space`. */
  w: number;
  h: number;
  placeableOnDesk: boolean;
  /**
   * Special asset (#71): drawn above every avatar instead of below it. It is
   * data, not a hardcoded list in the scene, and `false` for every asset
   * unless an admin marks it.
   */
  aboveAvatars: boolean;
  /** `null` mientras siga en el catalogo. Ver la cabecera: retirar no es borrar. */
  archivedAt: Date | null;
  createdAt: Date;
}

export interface CreateAssetInput {
  name: string;
  kind: AssetKind;
  textureKey: string;
  w: number;
  h: number;
  placeableOnDesk: boolean;
  /** Optional: absent means a normal asset (#71). */
  aboveAvatars?: boolean;
}

/** Partial update of a catalog asset. Today only the render layer is editable (#71). */
export interface UpdateAssetInput {
  aboveAvatars?: boolean;
}

/**
 * Una pieza colocada en el escritorio de alguien, con los campos del asset que
 * hacen falta para pintarla ya resueltos (D1b).
 *
 * Van aqui y no en una segunda consulta del cliente a proposito: es lo que
 * permite que `getDeskConfig` no filtre por `archived_at` y que una pieza
 * retirada del catalogo se siga viendo. Si el cliente tuviese que cruzarla
 * contra `listAssets()`, el filtro del catalogo volveria a aplicarse por la
 * puerta de atras y la pieza desapareceria del escritorio de quien ya la tenia
 * -- justo lo que archivar promete no hacer.
 */
export interface DeskItem {
  id: string;
  assetId: string;
  /** 0..8 inclusive, una por caja del area de 3x3. Ver `decorRules.DESK_SLOT_MAX`. */
  slot: number;
  rotation: DeskRotation;
  textureKey: string;
  w: number;
  h: number;
  name: string;
  /** Resolved from the asset like `textureKey`, so the scene knows its render layer (#71). */
  aboveAvatars: boolean;
  createdAt: Date;
}

export interface DeskItemInput {
  assetId: string;
  slot: number;
  rotation: DeskRotation;
}

export interface ListAssetsOptions {
  /**
   * Incluye los retirados. Por defecto NO: la lectura normal del catalogo es
   * "que se puede colocar hoy". Existe para que un panel pueda mostrar el
   * historico sin que eso obligue a quitar el filtro de la lectura normal.
   */
  includeArchived?: boolean;
}

/**
 * One piece of the art pack as the catalog stores it (art migration, step 3).
 * The id is the manifest's and never changes meaning: users, desks and spaces
 * store it as their choice. `spec` is the whole manifest entry; the fields
 * next to it are the ones the choice rules (`artCatalogRules.ts`) read.
 *
 * Same asymmetry as `archivedAt` on assets: `retiredAt` says the piece cannot
 * be chosen again, not that the rows that chose it stop resolving it.
 */
/** Where a catalog piece comes from (#121): the registered pack or an Admin upload. */
export type ArtPieceSource = 'pack' | 'upload';

export interface ArtCatalogPiece {
  id: string;
  kind: ArtPieceKind;
  name: string;
  /** `null` for characters, the only kind without one. */
  material: string | null;
  colorable: boolean;
  defaultColor: string | null;
  author: string;
  license: string;
  files: readonly ArtPieceFile[];
  spec: ArtPiece;
  contractVersion: number;
  /** Set when a registered pack stopped shipping it; cleared if one ships it again. */
  retiredAt: Date | null;
  registeredAt: Date;
  updatedAt: Date;
  /** A pack registration only retires `pack` pieces: an upload is not the pack's to retire. */
  source: ArtPieceSource;
  /** Directory id of the Admin who uploaded it; `null` for pack pieces. */
  uploadedBy: string | null;
}

export interface UploadedArtPieceInput {
  /** The manifest entry `prepareAssetUpload` built, its files already stored. */
  piece: ArtPiece;
  uploadedBy: string;
  /**
   * The desk decor asset that draws it (a plant), created in the same
   * transaction: either both exist afterwards or neither does.
   */
  decorAsset?: CreateAssetInput;
}

export interface UploadedArtPiece {
  piece: ArtCatalogPiece;
  asset: Asset | null;
}

export interface ListArtPiecesOptions {
  /** Includes retired pieces. Off by default: the normal read is "what can be chosen today". */
  includeRetired?: boolean;
}

export interface ArtPackRegistration {
  /** Pieces of the pack, all of them now active. */
  registered: number;
  /** Ids this registration retired; already retired pieces are not repeated. */
  retired: string[];
}

export interface DecorCatalog {
  /** Orden deterministico (kind, slug, id). Filtra los archivados salvo que se pida lo contrario. */
  listAssets(options?: ListAssetsOptions): Promise<Asset[]>;
  createAsset(input: CreateAssetInput): Promise<Asset>;
  /** Marca `archivedAt` y devuelve la fila; `null` si ese id no existe. NO borra, y NO toca ninguna colocacion (D1b). */
  archiveAsset(id: string): Promise<Asset | null>;
  /** Applies a partial update and returns the row; `null` if that id does not exist (#71). */
  updateAsset(id: string, input: UpdateAssetInput): Promise<Asset | null>;
  /** Ordenado por slot. SIN filtro de archivados: ver la cabecera. */
  getDeskConfig(userId: string): Promise<DeskItem[]>;
  /** Borra la configuracion existente e inserta la nueva en UNA transaccion. */
  replaceDeskConfig(userId: string, items: readonly DeskItemInput[]): Promise<DeskItem[]>;
  /**
   * Registers the art pack: upserts each piece by id and retires the active
   * ones it no longer ships, atomically. Never deletes, so every stored
   * choice keeps resolving. Idempotent: the same pack twice changes nothing.
   * Throws `InvalidArtPackError` before touching anything.
   */
  registerArtPack(pack: ArtPackManifest): Promise<ArtPackRegistration>;
  /** Deterministic order (kind, id). Leaves out retired pieces unless asked. */
  listArtPieces(options?: ListArtPiecesOptions): Promise<ArtCatalogPiece[]>;
  /**
   * Adds one Admin upload (#121), active at once, with its optional decor
   * asset. Never overwrites: an id already in the catalog, retired or not,
   * throws `ArtPieceExistsError`, and a taken decor name throws
   * `AssetNameTakenError` with nothing written. Throws `InvalidArtPackError`
   * for an id outside the upload id space.
   */
  registerUploadedArtPiece(input: UploadedArtPieceInput): Promise<UploadedArtPiece>;
}
