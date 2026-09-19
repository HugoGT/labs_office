/**
 * Puerto de `Space`/`SpaceLayout` (#7). Solo tipos: aqui no hay ni SQL ni
 * `pg` ni Express ni Colyseus, misma regla que `directoryPort.ts`. El
 * adaptador de produccion es `pgSpaces.ts`.
 *
 * Dos entidades bajo un puerto, no cuatro puertos separados (D5): `SpaceLayout`
 * no tiene ningun consumidor que no sostenga ya un `Space`, asi que separarlo
 * empujaria la composicion de la transaccion de `replaceLayout` fuera del
 * adaptador, que es justo el trabajo que `pgDirectory.inTransaction` ya
 * demuestra que le corresponde al adaptador.
 */

export interface Space {
  id: string;
  slug: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  capacity: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export type LayoutRotation = 0 | 90 | 180 | 270;

export interface SpaceLayout {
  id: string;
  spaceId: string;
  assetId: string;
  /** Relativo al origen del espacio, no a la cuadricula del mapa entero. */
  x: number;
  y: number;
  rotation: LayoutRotation;
  zIndex: number;
  createdAt: Date;
}

export interface CreateSpaceInput {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  capacity: number | null;
}

/**
 * Todos los campos son opcionales: `updateSpace` acepta un cambio parcial
 * (renombrar sin tocar el rectangulo, mover sin renombrar). `capacity`
 * distingue "no lo toques" (`undefined`, campo ausente) de "quitale el
 * limite" (`null`, presente y nulo) -- por eso no es solo `number | null`.
 */
export interface UpdateSpaceInput {
  name?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  capacity?: number | null;
}

export interface LayoutItemInput {
  assetId: string;
  x: number;
  y: number;
  rotation: LayoutRotation;
  zIndex: number;
}

export interface SpacesDirectory {
  /** Orden deterministico (x, y, id): no importa para la correccion (la restriccion de exclusion ya lo garantiza), pero hace la lista predecible. */
  listSpaces(): Promise<Space[]>;
  getSpace(id: string): Promise<Space | null>;
  createSpace(input: CreateSpaceInput): Promise<Space>;
  /** Devuelve null si ese id no existe. */
  updateSpace(id: string, input: UpdateSpaceInput): Promise<Space | null>;
  /** Devuelve false si ese id no existia. Cascada real sobre `space_layouts` (D1b). */
  deleteSpace(id: string): Promise<boolean>;
  listLayout(spaceId: string): Promise<SpaceLayout[]>;
  /** Borra el layout existente e inserta el nuevo en UNA transaccion. */
  replaceLayout(spaceId: string, items: LayoutItemInput[]): Promise<SpaceLayout[]>;
  /** Hash canonico de la lista de espacios actual (D4). Ver `spaceRules.hashSpaces`. */
  version(): Promise<string>;
}
