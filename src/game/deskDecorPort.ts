/**
 * Puerto del editor de decoracion del lado del cliente (#7, slice 6). Solo
 * tipos: aqui no hay ni `fetch` ni React ni Phaser, misma regla que
 * `desksPort.ts`. El unico adaptador es `deskDecorClient.ts`.
 *
 * ## Por que no reutiliza `desksPort.DeskDecorItem`
 *
 * Aquel tipo es lo justo para PINTAR la decoracion ajena: id, slot, rotacion y
 * textura. Al editor le falta lo unico con lo que se puede volver a guardar,
 * que es el `assetId` -- `POST /me/desk` habla de assets, no de colocaciones
 * -- y el nombre, que es como se llama a una pieza en una lista. Son dos
 * lecturas distintas de dos rutas distintas (`/desks` y `/me/desk`), asi que
 * son dos tipos.
 *
 * ## El catalogo que se ofrece ya viene filtrado
 *
 * `fetchDeskCatalog` deja fuera lo que no admite escritorio y el servidor deja
 * fuera lo retirado (D1b). Por eso `DeskDecorAsset` no tiene ni
 * `placeableOnDesk` ni `archivedAt`: si viajasen, cada pantalla que muestre el
 * selector tendria que volver a filtrar, y ese es justo el filtro que un dia
 * se olvida.
 *
 * ## Una pieza retirada no desaparece del escritorio
 *
 * Es la otra mitad de D1b y la razon de que el escritorio y el selector sean
 * DOS listas: lo puesto se lee de `/me/desk`, que no filtra archivados, y lo
 * ofrecible de `/assets`, que si. Cruzarlas para pintar el escritorio haria
 * que una pieza retirada se borrase de la pantalla de su dueno, y el primer
 * guardado se la quitaria de verdad.
 */

/** Los mismos tres del `CHECK (kind IN (...))` del esquema. */
export type DeskAssetKind = 'furniture' | 'decor' | 'plant';

/** Las mismas cuatro del `CHECK (rotation IN (...))`, y las unicas que ofrece el editor. */
export const DESK_ROTATIONS = [0, 90, 180, 270] as const;
export type DeskRotation = (typeof DESK_ROTATIONS)[number];

/** Una pieza que el selector puede ofrecer. Ver la cabecera: ya viene filtrada. */
export interface DeskDecorAsset {
  id: string;
  name: string;
  kind: DeskAssetKind;
  /** Clave del sprite que el bundle ya trae. El catalogo es curado. */
  textureKey: string;
}

/**
 * Una pieza YA colocada en el escritorio propio, tal como la sirve
 * `GET /me/desk`.
 *
 * `id` identifica la COLOCACION y `assetId` la pieza del catalogo. Los dos
 * hacen falta y ninguno sirve por el otro: el primero es la clave con la que
 * el editor distingue dos plantas iguales en dos cajas, y el segundo es lo
 * unico que `POST /me/desk` lee.
 */
export interface PlacedDeskItem {
  id: string;
  assetId: string;
  /** 0..8 inclusive, una por caja del area de 3x3. Ver `deskLayout.deskSlotRect`. */
  slot: number;
  rotation: DeskRotation;
  textureKey: string;
  /** Como se llama la pieza. Viaja resuelto aunque el asset este retirado (D1b). */
  name: string;
}

/** Lo que `POST /me/desk` lee de cada pieza, y nada mas. El ocupante sale del token. */
export interface DeskItemPlacement {
  assetId: string;
  slot: number;
  rotation: DeskRotation;
}

/**
 * El catalogo vacio, que es el estado degradado Y el de una oficina que aun no
 * ha dado de alta ninguna pieza. Constante compartida para poder compararla
 * por identidad, igual que `NO_DESKS`.
 */
export const NO_DESK_ASSETS: readonly DeskDecorAsset[] = [];

/**
 * Las tres salidas de guardar, y ninguna ambigua.
 *
 * `rejected` esta separada de `failed` porque es la unica que quien guarda
 * puede arreglar: una pieza retirada que se intento anadir, un slot repetido.
 * Contarla como averia le diria que lo intente otra vez cuando lo que hay que
 * hacer es cambiar algo.
 */
export type SaveDeskOutcome = 'saved' | 'rejected' | 'failed';
