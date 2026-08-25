/**
 * Colocacion de suelo, mobiliario, naturaleza y etiquetas de zona, portada de
 * `renderGround`/`placeFurniture`/`placeNature`/`placeZoneLabels`
 * (`prototype/js/app.js:255-322`). Depende de Phaser en tiempo de ejecucion
 * (`scene.add.image`/`scene.add.text`): se prueba en la capa navegador.
 *
 * Los materiales ya no son texturas generadas por codigo sino frames de las
 * hojas Kenney (CC0, ver `assets.ts`). El mobiliario que ocupa varias tiles se
 * dibuja con `tileSprite`, que REPITE el tile de 16px, en vez de estirar uno
 * solo: estirar un escritorio a 7 tiles de ancho lo deja borroso.
 */

import type Phaser from 'phaser';
import {
  ASSET_SCALE,
  GROUND_FRAMES,
  INDOOR,
  INDOOR_SHEET,
  TERRAIN,
  TERRAIN_SHEET,
} from './assets';
import { DESK_ROWS, GROUND, MAP_H, MAP_W, TILE, TREES, ZONE_LABELS } from './mapData';
import { markSolid, type TerrainGrid } from './terrainGrid';

/** Coloca un tile suelto de una hoja, alineado a la rejilla del mundo. */
function putTile(
  scene: Phaser.Scene,
  sheet: string,
  frame: number,
  tx: number,
  ty: number,
  depth: number,
): Phaser.GameObjects.Image {
  return scene.add
    .image(tx * TILE, ty * TILE, sheet, frame)
    .setOrigin(0)
    .setScale(ASSET_SCALE)
    .setDepth(depth);
}

/**
 * Cubre un rectangulo de tiles repitiendo un frame. `tileScale` va a
 * `ASSET_SCALE` para que el patron se repita cada 32px del mundo y no cada 16.
 */
function putTiledArea(
  scene: Phaser.Scene,
  sheet: string,
  frame: number,
  tx: number,
  ty: number,
  tilesWide: number,
  tilesHigh: number,
  depth: number,
): Phaser.GameObjects.TileSprite {
  const sprite = scene.add
    .tileSprite(tx * TILE, ty * TILE, tilesWide * TILE, tilesHigh * TILE, sheet, frame)
    .setOrigin(0)
    .setDepth(depth);
  sprite.tileScaleX = ASSET_SCALE;
  sprite.tileScaleY = ASSET_SCALE;
  return sprite;
}

/** Pinta el suelo tile por tile; el cesped llano alterna por fila (app.js:255-262). */
export function renderGround(scene: Phaser.Scene, grid: TerrainGrid): void {
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const code = grid.ground[y][x];
      const frame =
        code === GROUND.G
          ? y % 2 === 0
            ? TERRAIN.grass
            : TERRAIN.grassAlt
          : GROUND_FRAMES[code];
      putTile(scene, TERRAIN_SHEET, frame, x, y, 0);
    }
  }
}

/**
 * Coloca escritorios, mesas, sillas y plantas (app.js:264-297). Marca solidas
 * las tiles de escritorios y mesas vía `markSolid` *antes* de que
 * `OfficeScene` fusione colisiones (D6) — las sillas y plantas son
 * decorativas y nunca se marcan solidas, igual que en el prototipo.
 */
export function placeFurniture(scene: Phaser.Scene, grid: TerrainGrid): void {
  for (const [x, y, n] of DESK_ROWS) {
    for (let i = 0; i < n; i++) {
      const tx = x + i * 2;
      // Alterna los dos frentes de escritorio del pack para que una fila de
      // seis no se vea como el mismo mueble clonado.
      const frame = i % 2 === 0 ? INDOOR.desk : INDOOR.deskAlt;
      putTiledArea(scene, INDOOR_SHEET, frame, tx, y, 2, 1, (y + 1) * TILE);
      markSolid(grid.solid, tx, y, 2, 1);
    }
  }

  // Sala de Juntas: mesa larga + sillas alrededor.
  putTiledArea(scene, INDOOR_SHEET, INDOOR.tableTop, 53, 6, 7, 5, 11 * TILE);
  markSolid(grid.solid, 53, 6, 7, 5);
  for (let i = 0; i < 7; i++) {
    putTile(scene, INDOOR_SHEET, INDOOR.chairBack, 53 + i, 5, 6 * TILE);
    putTile(scene, INDOOR_SHEET, INDOOR.chair, 53 + i, 11, 12 * TILE);
  }
  for (let j = 0; j < 5; j++) {
    putTile(scene, INDOOR_SHEET, INDOOR.chairWhite, 52, 6 + j, (7 + j) * TILE);
    putTile(scene, INDOOR_SHEET, INDOOR.chairWhite, 60, 6 + j, (7 + j) * TILE);
  }

  // Cafeteria: mesa de madera + asientos + plantas en las esquinas.
  putTiledArea(scene, INDOOR_SHEET, INDOOR.tableTop, 53, 23, 5, 3, 26 * TILE);
  markSolid(grid.solid, 53, 23, 5, 3);
  for (let i = 0; i < 5; i++) {
    putTile(scene, INDOOR_SHEET, INDOOR.chairBack, 53 + i, 22, 23 * TILE);
    putTile(scene, INDOOR_SHEET, INDOOR.chair, 53 + i, 26, 27 * TILE);
  }
  const plants: readonly (readonly [number, number])[] = [
    [51, 19],
    [61, 19],
    [51, 30],
    [61, 30],
  ];
  for (const [px, py] of plants) {
    putTile(scene, INDOOR_SHEET, INDOOR.plant, px, py, (py + 1) * TILE);
    markSolid(grid.solid, px, py, 1, 1);
  }
}

/**
 * Coloca arboles (app.js:299-305, marcan su tile solida) y esparce parcelas de
 * flores de forma deterministica evitando tiles solidas o que no sean cesped
 * llano (app.js:306-312).
 *
 * Las flores del pack son tiles de suelo completos, no calcomanias con
 * transparencia: se pintan encima del cesped, no junto a el.
 */
export function placeNature(scene: Phaser.Scene, grid: TerrainGrid): void {
  TREES.forEach(([x, y], i) => {
    const frame = i % 4 === 3 ? TERRAIN.treeOrange : TERRAIN.treeGreen;
    scene.add
      .image((x + 0.5) * TILE, (y + 1) * TILE, TERRAIN_SHEET, frame)
      .setOrigin(0.5, 1)
      // Los arboles van a 1.5x el tile: a escala 1:1 con el suelo se perderian
      // entre el cesped en vez de leerse como volumen.
      .setScale(ASSET_SCALE * 1.5)
      .setDepth((y + 1) * TILE);
    markSolid(grid.solid, x, y, 1, 1);
  });

  const flowerFrames = [TERRAIN.flowersOrange, TERRAIN.flowersWhite, TERRAIN.flowersBlue];
  for (let i = 0; i < 90; i++) {
    const x = 1 + ((i * 13 + 5) % 46);
    const y = 1 + ((i * 29 + 11) % 41);
    if (grid.solid[y][x] || grid.ground[y][x] !== GROUND.G) continue;
    putTile(scene, TERRAIN_SHEET, flowerFrames[i % flowerFrames.length], x, y, 1);
  }
}

/** Etiquetas translucidas de zona superpuestas al mapa (app.js:315-322). */
export function placeZoneLabels(scene: Phaser.Scene): void {
  for (const zone of ZONE_LABELS) {
    scene.add
      .text(zone.x * TILE, zone.y * TILE, zone.t, {
        fontFamily: 'Cantarell, Noto Sans, DejaVu Sans, Segoe UI, sans-serif',
        fontSize: '18px',
        fontStyle: 'bold',
        color: '#ffffff',
      })
      .setAlpha(0.4)
      .setDepth(2);
  }
}
