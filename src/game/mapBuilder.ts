/**
 * Colocacion de suelo, mobiliario, naturaleza y etiquetas de zona, portada de
 * `renderGround`/`placeFurniture`/`placeNature`/`placeZoneLabels`
 * (`prototype/js/app.js:255-322`). Depende de Phaser en tiempo de ejecucion
 * (`scene.add.image`/`scene.add.text`): se prueba en la capa navegador.
 */

import type Phaser from 'phaser';
import { DESK_ROWS, GROUND, GROUND_TEX, MAP_H, MAP_W, TILE, TREES, ZONE_LABELS } from './mapData';
import { markSolid, type TerrainGrid } from './terrainGrid';

/** Pinta el suelo tile por tile; el cesped llano alterna grassA/grassB por fila (app.js:255-262). */
export function renderGround(scene: Phaser.Scene, grid: TerrainGrid): void {
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const code = grid.ground[y][x];
      const key = code === GROUND.G ? (y % 2 === 0 ? 'grassA' : 'grassB') : GROUND_TEX[code];
      scene.add.image(x * TILE, y * TILE, key).setOrigin(0).setDepth(0);
    }
  }
}

/**
 * Coloca escritorios, mesas, sillas, taburetes y barriles (app.js:264-297).
 * Marca solidas las tiles de escritorios, mesas y barriles vía `markSolid`
 * *antes* de que `OfficeScene` fusione colisiones (D6) — las sillas y
 * taburetes son puramente decorativos en el prototipo y nunca se marcan
 * solidos.
 */
export function placeFurniture(scene: Phaser.Scene, grid: TerrainGrid): void {
  for (const [x, y, n] of DESK_ROWS) {
    for (let i = 0; i < n; i++) {
      const tx = x + i * 2;
      scene.add.image(tx * TILE, y * TILE, 'desk').setOrigin(0).setDepth((y + 1) * TILE);
      markSolid(grid.solid, tx, y, 2, 1);
    }
  }

  // Sala de Juntas: mesa gris + sillas azules.
  scene.add.image(53 * TILE, 6 * TILE, 'tableGray').setOrigin(0).setDepth(11 * TILE);
  markSolid(grid.solid, 53, 6, 7, 5);
  for (let i = 0; i < 7; i++) {
    scene.add
      .image((53 + i) * TILE + 16, 5 * TILE + 16, 'chairB')
      .setScale(1.5)
      .setDepth(6 * TILE);
    scene.add
      .image((53 + i) * TILE + 16, 11 * TILE + 16, 'chairB')
      .setScale(1.5)
      .setDepth(12 * TILE);
  }
  for (let j = 0; j < 5; j++) {
    scene.add
      .image(52 * TILE + 16, (6 + j) * TILE + 16, 'chairB')
      .setScale(1.5)
      .setDepth((7 + j) * TILE);
    scene.add
      .image(60 * TILE + 16, (6 + j) * TILE + 16, 'chairB')
      .setScale(1.5)
      .setDepth((7 + j) * TILE);
  }

  // Cafeteria: mesa de madera + bancos + barriles.
  scene.add.image(53 * TILE, 23 * TILE, 'tableWood').setOrigin(0).setDepth(26 * TILE);
  markSolid(grid.solid, 53, 23, 5, 3);
  for (let i = 0; i < 5; i++) {
    scene.add
      .image((53 + i) * TILE + 16, 22 * TILE + 16, 'stool')
      .setScale(1.6)
      .setDepth(23 * TILE);
    scene.add
      .image((53 + i) * TILE + 16, 26 * TILE + 16, 'stool')
      .setScale(1.6)
      .setDepth(27 * TILE);
  }
  const barrels: readonly (readonly [number, number])[] = [
    [51, 19],
    [61, 19],
    [51, 30],
    [61, 30],
  ];
  for (const [bx, by] of barrels) {
    scene.add
      .image(bx * TILE + 16, (by + 1) * TILE, 'barrel')
      .setOrigin(0.5, 1)
      .setScale(1.4)
      .setDepth((by + 1) * TILE);
    markSolid(grid.solid, bx, by, 1, 1);
  }
}

/**
 * Coloca arboles (app.js:299-305, marcan su tile solida) y dispersa
 * arbustos/flores de forma deterministica evitando tiles solidas o de agua
 * (app.js:306-312).
 */
export function placeNature(scene: Phaser.Scene, grid: TerrainGrid): void {
  for (const [x, y] of TREES) {
    scene.add
      .image((x + 0.5) * TILE, (y + 1) * TILE + 4, 'tree')
      .setOrigin(0.5, 1)
      .setDepth((y + 1) * TILE);
    markSolid(grid.solid, x, y, 1, 1);
  }

  for (let i = 0; i < 90; i++) {
    const x = 1 + ((i * 13 + 5) % 46);
    const y = 1 + ((i * 29 + 11) % 41);
    if (grid.solid[y][x] || grid.ground[y][x] !== GROUND.G) continue;
    const key = i % 3 === 0 ? 'bush' : 'flower';
    scene.add.image(x * TILE + 16, y * TILE + 24, key).setDepth(1);
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
