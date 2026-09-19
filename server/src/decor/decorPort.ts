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

export type AssetKind = 'furniture' | 'decor' | 'plant';

/** Las mismas cuatro del `CHECK (rotation IN (...))` de `schema.sql`. */
export type DeskRotation = 0 | 90 | 180 | 270;

export interface Asset {
  id: string;
  slug: string;
  name: string;
  kind: AssetKind;
  /** Clave del sprite que el bundle del cliente YA trae. El catalogo es curado: aqui no se sube ninguna imagen. */
  textureKey: string;
  /** Tamano en TILES, no en pixeles. Misma unidad que `Space`. */
  w: number;
  h: number;
  placeableOnDesk: boolean;
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

export interface DecorCatalog {
  /** Orden deterministico (kind, slug, id). Filtra los archivados salvo que se pida lo contrario. */
  listAssets(options?: ListAssetsOptions): Promise<Asset[]>;
  createAsset(input: CreateAssetInput): Promise<Asset>;
  /** Marca `archivedAt` y devuelve la fila; `null` si ese id no existe. NO borra, y NO toca ninguna colocacion (D1b). */
  archiveAsset(id: string): Promise<Asset | null>;
  /** Ordenado por slot. SIN filtro de archivados: ver la cabecera. */
  getDeskConfig(userId: string): Promise<DeskItem[]>;
  /** Borra la configuracion existente e inserta la nueva en UNA transaccion. */
  replaceDeskConfig(userId: string, items: readonly DeskItemInput[]): Promise<DeskItem[]>;
}
