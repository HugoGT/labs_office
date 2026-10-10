/**
 * Puerto de administracion de espacios (#10 + #12, S3a). Solo tipos: aqui no
 * hay ni `fetch` ni React, misma regla que `deskAdminPort.ts` y que
 * `server/src/spaces/spacesPort.ts`. El unico adaptador es
 * `spacesAdminClient.ts`.
 *
 * ## Salas y cubiculos comparten fila, pero no comparten CRUD
 *
 * `GET /spaces` sirve las dos clases de fila con el mismo campo `kind`
 * (`'room' | 'desk'`, derivado en el servidor de `desk_id`), pero solo las de
 * `kind: 'room'` se crean, mueven o borran desde este puerto: un cubiculo
 * (`kind: 'desk'`) es un efecto secundario del CRUD de escritorios
 * (`deskAdminPort.ts`) y el servidor rechaza con 409 `space-owned-by-desk`
 * cualquier intento de tocarlo por aqui (spacesRoutes.ts). Este puerto no
 * separa los metodos por `kind` -- lo hace el panel (S3b) al decidir que fila
 * muestra controles -- porque `list` SIGUE necesitando devolver las dos: sin
 * los cubiculos la tabla no podria explicar por que unas coordenadas ya estan
 * ocupadas.
 *
 * ## TILES, no pixeles
 *
 * Igual que `deskAdminPort.ts`: la unidad es la que escribe quien administra
 * en el formulario y la que guarda el servidor.
 */

/** Deriva de `desk_id` en el servidor: `'desk'` si un escritorio es dueno del cubiculo, `'room'` si no. */
export type AdminSpaceKind = 'room' | 'desk';

export interface AdminSpace {
  id: string;
  /** Como se llama la sala ("Sala de reuniones") o el escritorio duenio del cubiculo. */
  name: string;
  /** Origen en TILES. Ver la cabecera. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** `null` es "sin limite", no un hueco: el servidor lo sirve siempre explicito. */
  capacity: number | null;
  kind: AdminSpaceKind;
}

export interface CreateSpaceInput {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Ausente equivale a "sin limite": el adaptador manda `null` de todas formas, ver `spacesAdminClient.ts`. */
  capacity?: number | null;
}

/**
 * Cambio PARCIAL: renombrar sin mover y mover sin renombrar son dos
 * peticiones distintas, igual que `UpdateDeskInput`. `capacity` distingue
 * "no lo toques" (ausente) de "quitale el limite" (`null` presente), igual
 * que `UpdateSpaceInput` del servidor (`server/src/spaces/spacesPort.ts`) --
 * por eso no es solo `number | null`.
 */
export interface UpdateSpaceInput {
  name?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  capacity?: number | null;
}

export interface SpacesAdminPort {
  /**
   * La misma lectura publica que usa la escena (`GET /spaces`, sin
   * autenticar en el servidor -- ver la cabecera de `spacesRoutes.ts`): una
   * segunda ruta bajo `/admin` seria una segunda consulta que mantener en
   * paralelo para decir exactamente lo mismo. Trae salas Y cubiculos, con
   * `kind` para distinguirlos.
   */
  listSpaces(): Promise<AdminSpace[]>;
  /** Crea una sala (`kind: 'room'` en la respuesta). El servidor no acepta crear un cubiculo por aqui. */
  createSpace(input: CreateSpaceInput): Promise<AdminSpace>;
  /** Rechazada con 409 `space-owned-by-desk` si `id` es un cubiculo. */
  updateSpace(id: string, input: UpdateSpaceInput): Promise<AdminSpace>;
  /** Rechazada con 409 `space-owned-by-desk` si `id` es un cubiculo. */
  deleteSpace(id: string): Promise<void>;
}
