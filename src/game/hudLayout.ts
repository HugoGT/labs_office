/**
 * Geometria del HUD compartida entre Phaser y React (#74). Extraida de
 * `OfficeScene.ts` para que la barra lateral derive su borde superior de la
 * MISMA fuente que el minimapa, en vez de un numero duplicado que podria
 * desalinearse en silencio si el minimapa cambia de tamano.
 */

export const MINIMAP_WIDTH = 200;
export const MINIMAP_HEIGHT = 140;
export const MINIMAP_MARGIN = 14;

/**
 * Borde superior de la barra lateral: justo debajo del minimapa, con el mismo
 * margen que separa al minimapa del borde de la pantalla (spec: "168px desde
 * el top").
 */
export const SIDEBAR_TOP = MINIMAP_MARGIN + MINIMAP_HEIGHT + MINIMAP_MARGIN;
