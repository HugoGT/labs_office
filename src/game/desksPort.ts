/**
 * Puerto de los escritorios asignables del lado del cliente (#7, slice 5).
 * Solo tipos: aqui no hay ni `fetch` ni Phaser ni React, misma regla que
 * `server/src/desks/desksPort.ts` y mismo espiritu que `adminPort.ts`. El
 * unico adaptador es `desksClient.ts`.
 *
 * ## Que es un escritorio asignable y que NO es
 *
 * Es un area de 3x3 tiles que el administrador coloca y que cada persona coge
 * y suelta cuando quiere, tipicamente para sentarse cerca de su grupo. NO son
 * los 39 escritorios de `DESK_ROWS`: aquellos son mobiliario del mapa base,
 * miden 2x1, van pegados de dos en dos y no se pueden ocupar. Un escritorio
 * asignable se dibuja ENCIMA, igual que un `SpaceArea` es algo aparte de un
 * `Room`.
 *
 * ## Pixeles, no tiles
 *
 * El servidor guarda y sirve TILES; la escena trabaja en PIXELES. La
 * conversion pasa una sola vez, al leer la respuesta (`desksClient.ts`), misma
 * frontera donde `spacesConfig.toSpaceArea` convierte los espacios. Hacerla
 * mas tarde la repartiria entre el renderizador y quien calcule las cajas.
 *
 * ## La decoracion no cuelga de aqui
 *
 * Furniture is the office decor layer's (#208, `officeDecor.ts`), replicated
 * with the room state: a desk is only a zone, and keeps what stands on it.
 */


/**
 * Quien ocupa un escritorio.
 *
 * `displayName` es para ETIQUETAR, nunca para decidir de quien es el sitio:
 * eso lo contesta `OfficeDesk.mine`. Dos personas del directorio pueden
 * llamarse igual, y un Admin puede renombrar a cualquiera en cualquier
 * momento.
 */
export interface DeskOccupant {
  id: string;
  displayName: string | null;
}

/** Un escritorio asignable con su ocupante resuelto. Coordenadas en PIXELES. */
export interface OfficeDesk {
  id: string;
  /** Como lo llama la oficina ("Mesa 4"); `''` for a desk created empty. Drawn only when not empty. */
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** `null` mientras este libre. */
  occupant: DeskOccupant | null;
  /**
   * Si este es el escritorio de quien esta mirando. Lo calcula el SERVIDOR,
   * que es el unico que sabe quien pregunta, y llega ya contestado.
   *
   * No se deduce aqui, y no por comodidad: `occupantId` no viaja -- ver la
   * cabecera de `server/src/desks/desksPort.ts` -- asi que el unico cruce que
   * le quedaria al cliente seria comparar `occupant.displayName` con el nombre
   * del jugador local. Comparar nombres visibles es exactamente lo que la
   * slice 1 de esta issue retiro de `proximityAudio.ts`, donde decidia quien
   * oye a quien y renombrar un espacio lo cambiaba en silencio. Aqui
   * renombrar a una persona cambiaria de manos un escritorio en pantalla, y
   * dos homonimos verian los dos el mismo resaltado.
   */
  mine: boolean;
}

/**
 * La oficina sin escritorios asignables, que es el estado degradado Y el de un
 * despliegue que todavia no ha colocado ninguno. Es una sola constante
 * compartida para que quien la reciba pueda compararla por identidad.
 */
export const NO_DESKS: readonly OfficeDesk[] = [];

/**
 * Las tres salidas de pedir un sitio, y ninguna ambigua. `taken` esta separada
 * del resto porque es la unica que no es una averia: alguien se adelanto, la
 * vista de quien pide ya no vale y hay que volver a leerla.
 */
export type DeskClaimOutcome = 'claimed' | 'taken' | 'failed';

/** Soltar es idempotente en el servidor, asi que solo hay exito o averia. */
export type DeskReleaseOutcome = 'released' | 'failed';
