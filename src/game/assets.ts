/**
 * Assets open source del mapa (Kenney, CC0 - dominio publico).
 *
 * Sustituyen a las texturas que `textures.ts` generaba por codigo, que eran
 * rectangulos de color con ruido. Los avatares SIGUEN siendo procedurales a
 * proposito: ningun pack de Kenney trae personajes de cuerpo entero en vista
 * 3/4, y la alternativa con animacion de verdad (LPC) es CC-BY-SA, licencia
 * virica que no encaja en un producto comercial. Ver `public/assets/kenney/`
 * para las licencias originales.
 *
 * Los indices de frame estan verificados uno a uno contra la hoja: muchos
 * bloques del pack son autotiles 3x3, asi que el tile de relleno es el CENTRO
 * del bloque, no su esquina. Coger la esquina mete un borde de otro material
 * en mitad del suelo.
 */

import type Phaser from 'phaser';
import { GROUND, TILE } from './mapData';

/** Los packs de Kenney usan tiles de 16px con 1px de separacion entre ellos. */
export const KENNEY_TILE = 16;
export const KENNEY_SPACING = 1;

/** Factor para llevar un tile de 16px al tile de 32px del mundo. */
export const ASSET_SCALE = TILE / KENNEY_TILE;

/** Numero de codigos de suelo, para anclar `GROUND_FRAMES` contra `GROUND`. */
export const GROUND_CODE_COUNT = Object.keys(GROUND).length;

export const TERRAIN_SHEET = 'kenney-terrain';
export const INDOOR_SHEET = 'kenney-indoor';

const TERRAIN_URL = 'assets/kenney/roguelike-rpg.png';
const INDOOR_URL = 'assets/kenney/roguelike-indoors.png';

/** Frames de la hoja `roguelike-rpg` (57 columnas). */
export const TERRAIN = {
  grass: 5,
  grassAlt: 1492,
  grassDark: 980,
  water: 0,
  bridge: 1654,
  floor: 1486,
  woodFloor: 1483,
  wall: 120,
  corridor: 1489,
  treeGreen: 526,
  treeOrange: 527,
  // Parterres sin bordillo. Las columnas 0-1 de esas mismas filas son las
  // esquinas del autotile y arrastran un trozo de piedra gris en la esquina:
  // esparcidas por el cesped se ven como manchas blancas sueltas.
  flowersOrange: 402,
  flowersWhite: 573,
  flowersBlue: 744,
} as const;

/**
 * Frame de terreno para cada codigo de suelo. El indice del array ES el codigo
 * (`GROUND.G` es 0, `GROUND.GD` es 1...), y el test de abajo lo ancla: si
 * alguien reordena `GROUND` sin tocar esto, el mapa se pinta con el material
 * equivocado en silencio.
 */
export const GROUND_FRAMES: readonly number[] = [
  TERRAIN.grass,
  TERRAIN.grassDark,
  TERRAIN.water,
  TERRAIN.bridge,
  TERRAIN.floor,
  TERRAIN.woodFloor,
  TERRAIN.wall,
  TERRAIN.corridor,
];

/** Frames de la hoja `roguelike-indoors` (27 columnas). */
export const INDOOR = {
  desk: 352,
  deskAlt: 351,
  tableTop: 1,
  chair: 54,
  chairBack: 81,
  chairWhite: 216,
  plant: 16,
} as const;

/**
 * Registra las hojas en el cargador de la escena. Va en `preload()`: Phaser no
 * garantiza que una textura pedida en `create()` este disponible al dibujar.
 */
export function preloadOfficeAssets(scene: Phaser.Scene): void {
  const config = {
    frameWidth: KENNEY_TILE,
    frameHeight: KENNEY_TILE,
    spacing: KENNEY_SPACING,
  };
  scene.load.spritesheet(TERRAIN_SHEET, TERRAIN_URL, config);
  scene.load.spritesheet(INDOOR_SHEET, INDOOR_URL, config);
}
