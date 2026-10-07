/**
 * Geometria del HUD compartida entre Phaser y React (#74). Extraida de
 * `OfficeScene.ts` para que la barra lateral derive su borde superior de la
 * MISMA fuente que el minimapa, en vez de un numero duplicado que podria
 * desalinearse en silencio si el minimapa cambia de tamano.
 */

/**
 * Franja derecha compartida por el minimapa, el toggle de "Personas
 * conectadas", el panel del buscador y los botones de salida (#86). Los
 * mismos numeros viven, por separado, en las variables `--hud-rail-right` y
 * `--hud-rail-width` de `src/index.css`: el DOM los toma de ahi porque CSS no
 * puede importar este modulo, y el minimapa (Phaser, sin DOM) los toma de
 * aqui. Si uno cambia, el otro debe seguirlo.
 */
export const RAIL_RIGHT = 23;
export const RAIL_WIDTH = 258;

export const MINIMAP_WIDTH = RAIL_WIDTH;
export const MINIMAP_HEIGHT = 140;
export const MINIMAP_MARGIN = 14;

/**
 * Borde superior de la barra lateral: justo debajo del minimapa, con el mismo
 * margen que separa al minimapa del borde de la pantalla (spec: "168px desde
 * el top").
 */
export const SIDEBAR_TOP = MINIMAP_MARGIN + MINIMAP_HEIGHT + MINIMAP_MARGIN;

/**
 * Map zoom control (map-zoom): a vertical card just left of the minimap, from
 * its top edge. It is shorter than the minimap, so it never reaches the
 * sidebar below, and it is placed from these numbers (inline style) because
 * the minimap itself is a Phaser camera with no DOM box to anchor to.
 */
export const ZOOM_CONTROLS_GAP = 8;
export const ZOOM_CONTROLS_TOP = MINIMAP_MARGIN;
export const ZOOM_CONTROLS_RIGHT = RAIL_RIGHT + MINIMAP_WIDTH + ZOOM_CONTROLS_GAP;
