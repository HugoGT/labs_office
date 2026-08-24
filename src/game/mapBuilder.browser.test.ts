import Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DESK_ROWS, MAP_H, MAP_W, TILE, TREES, ZONE_LABELS } from './mapData';
import { placeFurniture, placeNature, placeZoneLabels, renderGround } from './mapBuilder';
import { buildTerrainGrid } from './terrainGrid';
import { createOfficeTextures } from './textures';

/**
 * Capa navegador: `scene.add.image`/`scene.add.text` necesitan una escena
 * real dentro de un `Phaser.Game` (jsdom no implementa canvas/WebGL).
 */

const games: Phaser.Game[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const game of games.splice(0)) game.destroy(true);
  for (const host of hosts.splice(0)) host.remove();
});

async function withScene<T>(run: (scene: Phaser.Scene) => T): Promise<T> {
  const host = document.createElement('div');
  host.style.width = '320px';
  host.style.height = '240px';
  document.body.append(host);
  hosts.push(host);

  let result!: T;
  class ProbeScene extends Phaser.Scene {
    constructor() {
      super('probe');
    }
    create(): void {
      createOfficeTextures(this);
      result = run(this);
    }
  }

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: host,
    width: 320,
    height: 240,
    scene: [ProbeScene],
  });
  games.push(game);

  await vi.waitFor(() => {
    expect(game.scene.getScene('probe')?.scene.settings.status).toBe(Phaser.Scenes.RUNNING);
  });

  return result;
}

function images(scene: Phaser.Scene): Phaser.GameObjects.Image[] {
  return scene.children.list.filter(
    (child): child is Phaser.GameObjects.Image => child.type === 'Image',
  );
}

describe('renderGround', () => {
  it('pinta MAP_W*MAP_H imagenes, alternando grassA/grassB por paridad de fila', async () => {
    const list = await withScene((scene) => {
      renderGround(scene, buildTerrainGrid());
      return images(scene).map((img) => ({ x: img.x, y: img.y, key: img.texture.key }));
    });

    expect(list).toHaveLength(MAP_W * MAP_H);

    // (5,4): fila par, cesped por defecto -> grassA. (5,5): fila impar -> grassB.
    expect(list.find((i) => i.x === 5 * TILE && i.y === 4 * TILE)?.key).toBe('grassA');
    expect(list.find((i) => i.x === 5 * TILE && i.y === 5 * TILE)?.key).toBe('grassB');
  });

  it('usa la textura declarada en GROUND_TEX para tiles que no son cesped llano', async () => {
    const list = await withScene((scene) => {
      renderGround(scene, buildTerrainGrid());
      return images(scene).map((img) => ({ x: img.x, y: img.y, key: img.texture.key }));
    });

    // Borde de seto solido en (0,0) -> grassDark; rio en (1,19) fuera de los puentes -> water.
    expect(list.find((i) => i.x === 0 && i.y === 0)?.key).toBe('grassDark');
    expect(list.find((i) => i.x === 1 * TILE && i.y === 19 * TILE)?.key).toBe('water');
  });
});

describe('placeFurniture', () => {
  it('marca solidas las tiles de escritorio, mesa y barril antes de fusionar colisiones', async () => {
    const solidAfter = await withScene((scene) => {
      const grid = buildTerrainGrid();
      placeFurniture(scene, grid);
      return grid.solid;
    });

    // Primer escritorio de DESK_ROWS: [3,5,3] -> 3 escritorios de 2x1 en (3,5),(5,5),(7,5).
    const [dx, dy] = DESK_ROWS[0];
    expect(solidAfter[dy][dx]).toBe(true);
    expect(solidAfter[dy][dx + 1]).toBe(true);
    expect(solidAfter[dy][dx + 2]).toBe(true);

    // Mesa gris de la Sala de Juntas: setSolid(53,6,7,5).
    expect(solidAfter[6][53]).toBe(true);
    expect(solidAfter[10][59]).toBe(true);

    // Barril en (51,19).
    expect(solidAfter[19][51]).toBe(true);
  });

  it('no marca solidas las sillas ni los taburetes: se puede caminar entre asientos (app.js:264-297)', async () => {
    const solidAfter = await withScene((scene) => {
      const grid = buildTerrainGrid();
      placeFurniture(scene, grid);
      return grid.solid;
    });

    // El prototipo solo llama a setSolid para escritorios, las dos mesas y los
    // barriles. Las sillas y los taburetes se dibujan encima sin bloquear el paso,
    // asi que marcarlos solidos encerraria a los NPCs de la Sala de Juntas.
    // Sillas de la Sala de Juntas: filas y=5 y y=11, fuera de setSolid(53,6,7,5).
    expect(solidAfter[5][53]).toBe(false);
    expect(solidAfter[11][59]).toBe(false);
    // Sillas laterales en las columnas x=52 y x=60, tambien fuera de la mesa.
    expect(solidAfter[7][52]).toBe(false);
    expect(solidAfter[7][60]).toBe(false);
    // Taburetes de la Cafeteria: filas y=22 y y=26, fuera de setSolid(53,23,5,3).
    expect(solidAfter[22][53]).toBe(false);
    expect(solidAfter[26][53]).toBe(false);
  });

  it('coloca la textura de escritorio en cada tile declarada por DESK_ROWS', async () => {
    const deskImages = await withScene((scene) => {
      placeFurniture(scene, buildTerrainGrid());
      return images(scene)
        .filter((img) => img.texture.key === 'desk')
        .map((img) => ({ x: img.x, y: img.y }));
    });

    const expectedDesks = DESK_ROWS.flatMap(([x, y, n]) =>
      Array.from({ length: n }, (_, i) => ({ x: (x + i * 2) * TILE, y: y * TILE })),
    );
    expect(deskImages).toHaveLength(expectedDesks.length);
    expect(deskImages).toEqual(expect.arrayContaining(expectedDesks));
  });
});

describe('placeNature', () => {
  it('coloca un arbol por cada entrada de TREES y marca su tile solida', async () => {
    const result = await withScene((scene) => {
      const grid = buildTerrainGrid();
      placeFurniture(scene, grid);
      placeNature(scene, grid);
      const treeImages = images(scene).filter((img) => img.texture.key === 'tree');
      return { treeCount: treeImages.length, solid: grid.solid };
    });

    expect(result.treeCount).toBe(TREES.length);
    for (const [tx, ty] of TREES) {
      expect(result.solid[ty][tx]).toBe(true);
    }
  });

  it('dispersa arbustos y flores de forma deterministica sin salir del mapa', async () => {
    const scattered = await withScene((scene) => {
      const grid = buildTerrainGrid();
      placeFurniture(scene, grid);
      placeNature(scene, grid);
      return images(scene)
        .filter((img) => img.texture.key === 'bush' || img.texture.key === 'flower')
        .map((img) => ({ x: img.x, y: img.y, key: img.texture.key }));
    });

    expect(scattered.length).toBeGreaterThan(0);
    expect(scattered.length).toBeLessThanOrEqual(90);
    for (const item of scattered) {
      expect(item.x).toBeGreaterThanOrEqual(TILE);
      expect(item.x).toBeLessThanOrEqual((MAP_W - 2) * TILE + TILE);
      expect(item.y).toBeGreaterThanOrEqual(TILE);
      expect(item.y).toBeLessThanOrEqual((MAP_H - 2) * TILE + TILE);
    }

    // i=0 -> tile (6,12), G y libre -> primer bush; i=1 -> tile (19,41), G y libre -> primer flower.
    expect(scattered.find((s) => s.x === 6 * TILE + 16 && s.y === 12 * TILE + 24)?.key).toBe(
      'bush',
    );
    expect(scattered.find((s) => s.x === 19 * TILE + 16 && s.y === 41 * TILE + 24)?.key).toBe(
      'flower',
    );
  });
});

describe('placeZoneLabels', () => {
  it('renderiza un texto por cada ZONE_LABELS con su contenido y posicion', async () => {
    const texts = await withScene((scene) => {
      placeZoneLabels(scene);
      return scene.children.list
        .filter((child): child is Phaser.GameObjects.Text => child.type === 'Text')
        .map((child) => ({ x: child.x, y: child.y, text: child.text }));
    });

    expect(texts).toHaveLength(ZONE_LABELS.length);
    expect(texts).toEqual(
      expect.arrayContaining(
        ZONE_LABELS.map((z) => ({ x: z.x * TILE, y: z.y * TILE, text: z.t })),
      ),
    );
  });
});
