/**
 * Puerto del catalogo de decoracion visto por el panel (#7, slice 5). Solo
 * tipos: aqui no hay ni `fetch` ni React, misma regla que `adminPort.ts`. El
 * unico adaptador es `assetAdminClient.ts`.
 *
 * ## El catalogo es CURADO: aqui no se sube ninguna imagen
 *
 * Dar de alta una pieza es registrar un `textureKey` que el bundle del cliente
 * YA trae. No hay carga de ficheros en ninguna parte de esta superficie, y no
 * porque falte cablearla: el servidor no tiene ruta que la reciba, y un
 * formulario de subida seria una promesa que nadie puede cumplir.
 *
 * ## Retirar NO es borrar (D1b)
 *
 * `archiveAsset` marca la fecha y no borra la fila. Las tres mitades de esa
 * regla tienen que ser ciertas a la vez, y el servidor las cumple:
 *
 *   - quien ya la tenia puesta la SIGUE VIENDO (`getDeskConfig` no filtra
 *     archivados y resuelve el `textureKey` de la pieza retirada);
 *   - su dueno puede QUITARLA de su escritorio cuando quiera;
 *   - nadie puede volver a ANADIRLA (`assertNotReAddingArchived`).
 *
 * Por eso el metodo no se llama `deleteAsset` ni devuelve `void`: devuelve la
 * fila con su `archivedAt`, que es el dato que prueba que sigue ahi.
 *
 * ## No hay lectura del historico por HTTP
 *
 * `DecorCatalog.listAssets` del servidor acepta `includeArchived`, pero
 * `handleListAssets` NO lo lee de ningun sitio: no hay parametro de consulta
 * ni cuerpo que lo active, asi que por HTTP solo se puede pedir el catalogo
 * vivo. De ahi que este puerto no tenga la opcion: declararla aqui invitaria a
 * construir una vista de retiradas que el servidor no puede llenar.
 */

/** Los mismos tres del `CHECK (kind IN (...))` del esquema. */
export const ASSET_KINDS = ['furniture', 'decor', 'plant'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export interface CatalogAsset {
  id: string;
  /** Lo DERIVA el servidor del nombre; viaja para poder reconocer la fila. */
  slug: string;
  name: string;
  kind: AssetKind;
  /** Clave del sprite que el bundle del cliente ya trae. Ver la cabecera. */
  textureKey: string;
  /** Tamano en TILES, no en pixeles. Misma unidad que un escritorio. */
  w: number;
  h: number;
  placeableOnDesk: boolean;
  /**
   * Special asset (#71): drawn above every avatar instead of below it. An
   * older server that does not send the field reads as `false`.
   */
  aboveAvatars: boolean;
  /**
   * ISO 8601 tal cual lo manda el servidor, `null` mientras siga en el
   * catalogo. El cliente no reinterpreta fechas (mismo criterio que
   * `Invitation.expiresAt`).
   *
   * En la lista siempre es `null` -- el servidor filtra las retiradas -- y
   * solo llega con valor en la respuesta de `archiveAsset`.
   */
  archivedAt: string | null;
}

/** Lo que el servidor lee al dar de alta. Ni `slug` ni `archivedAt`: los decide el. */
export interface CreateAssetInput {
  name: string;
  kind: AssetKind;
  textureKey: string;
  w: number;
  h: number;
  placeableOnDesk: boolean;
  aboveAvatars: boolean;
}

/** Editable fields of an existing asset. Today only the render layer (#71). */
export interface UpdateAssetInput {
  aboveAvatars: boolean;
}

export interface AssetAdminPort {
  /** Solo las vivas: el servidor filtra las retiradas y no sabe hacer otra cosa. */
  listAssets(): Promise<CatalogAsset[]>;
  createAsset(input: CreateAssetInput): Promise<CatalogAsset>;
  /** Retira del catalogo. NO borra y NO toca ninguna colocacion: ver la cabecera. */
  archiveAsset(id: string): Promise<CatalogAsset>;
  /** Marks or unmarks an asset as drawn above avatars (#71). */
  updateAsset(id: string, input: UpdateAssetInput): Promise<CatalogAsset>;
}
