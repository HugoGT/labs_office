/**
 * Reparto de las nueve cajas decorables de un escritorio asignable (#7, slice
 * 5). Pura geometria: sin Phaser, sin red y sin estado.
 *
 * Existe como funcion con nombre propio y no como tres lineas dentro del
 * renderizador porque es un CONTRATO entre dos lados. El servidor guarda un
 * `slot` entre 0 y 8 (`decorRules.DESK_SLOT_MAX`) y deliberadamente NO dice
 * donde cae esa caja; quien lo pinta y el editor de decoracion que vendra
 * despues tienen que derivar la misma posicion del mismo numero. Dos copias de
 * esta aritmetica acabarian discrepando, y el sintoma seria una decoracion que
 * se mueve sola al volver a entrar, sin que nada falle ni avise.
 *
 * El reparto es POR FILAS: 0,1,2 arriba; 3,4,5 en medio; 6,7,8 abajo. Por
 * columnas saldria todo transpuesto y seria igual de "valido" -- de ahi que la
 * prueba lo fije expresamente.
 */

/** Tres columnas, las mismas que tiles de lado tiene el escritorio (`deskRules.DESK_SIDE`). */
export const DESK_SLOT_COLUMNS = 3;
export const DESK_SLOT_ROWS = 3;
/** Nueve cajas, de la 0 a la 8. El mismo rango que valida el servidor. */
export const DESK_SLOT_COUNT = DESK_SLOT_COLUMNS * DESK_SLOT_ROWS;

/**
 * Nombre Phaser de la zona dibujada de un escritorio, y de cada pieza suya.
 *
 * Un nombre y no la geometria porque la geometria no identifica nada: dos
 * escritorios de 3x3 son dos rectangulos indistinguibles para cualquier filtro,
 * y la escena ya tiene rectangulos propios (los colisionadores fusionados). Es
 * el unico asidero estable para volver a encontrar lo dibujado.
 */
export function deskZoneName(deskId: string): string {
  return `desk:${deskId}`;
}

export function deskItemName(itemId: string): string {
  return `desk-item:${itemId}`;
}

/** Rectangulo en PIXELES del mundo, que es en lo que trabaja la escena. */
export interface DeskRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * La caja de un slot dentro de un escritorio, o `null` si ese slot no es una
 * de las nueve.
 *
 * `null` y no una caja de relleno: este dato viene de una respuesta de red, y
 * una caja inventada pintaria decoracion fuera del escritorio -- encima de
 * otro, o en mitad del pasillo. Quien dibuja se salta la pieza y el resto del
 * escritorio sigue viendose.
 *
 * El tamano de caja sale de DIVIDIR el escritorio recibido y no de `TILE`: el
 * tamano viaja en la respuesta, asi que dividirlo evita una segunda copia del
 * 3 que un dia discrepe de la del servidor.
 */
export function deskSlotRect(desk: DeskRect, slot: number): DeskRect | null {
  if (!Number.isInteger(slot) || slot < 0 || slot >= DESK_SLOT_COUNT) return null;

  const w = desk.w / DESK_SLOT_COLUMNS;
  const h = desk.h / DESK_SLOT_ROWS;

  return {
    x: desk.x + (slot % DESK_SLOT_COLUMNS) * w,
    y: desk.y + Math.floor(slot / DESK_SLOT_COLUMNS) * h,
    w,
    h,
  };
}
