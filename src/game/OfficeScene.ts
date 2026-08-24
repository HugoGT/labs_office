import Phaser from 'phaser';
import { placeFurniture, placeNature, placeZoneLabels, renderGround } from './mapBuilder';
import type { OfficeBridge } from './officeBridge';
import { buildTerrainGrid, type TerrainGrid } from './terrainGrid';
import { createOfficeTextures } from './textures';

/** Clave de la escena (D5): reemplaza `BootScene`, que se retira en este mismo cambio. */
export const OFFICE_SCENE_KEY = 'office';

/**
 * Escena principal de la oficina virtual, portada de `OfficeScene`
 * (`prototype/js/app.js:67-96`). En este slice orquesta solo texturas y
 * colocacion del mapa (esqueleto); NPCs, jugador, input, camaras y
 * colisiones se agregan en los slices 6-7.
 *
 * El puente se inyecta por constructor (D2), no por `registry`: es
 * deterministico y evita depender de que una escritura llegue antes de que
 * `create()` arranque de forma asincrona.
 */
export class OfficeScene extends Phaser.Scene {
  // El puente aun no se usa en este esqueleto (llega en los slices 6-7:
  // spawns emiten por el, input/proximidad escuchan comandos). Se acepta ya
  // por constructor per D2 para fijar el contrato de una vez.
  constructor(_bridge: OfficeBridge) {
    super(OFFICE_SCENE_KEY);
  }

  create(): void {
    createOfficeTextures(this);

    const grid: TerrainGrid = buildTerrainGrid();
    renderGround(this, grid);
    placeFurniture(this, grid);
    placeNature(this, grid);
    placeZoneLabels(this);
  }
}
