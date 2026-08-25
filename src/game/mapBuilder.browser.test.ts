import Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TERRAIN, TERRAIN_SHEET, preloadOfficeAssets } from './assets';
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
    // Las hojas Kenney son ficheros: hay que cargarlas antes de `create()`, o
    // cada `add.image` pediria una textura que aun no existe.
    preload(): void {
      preloadOfficeAssets(this);
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

function tileSprites(scene: Phaser.Scene): Phaser.GameObjects.TileSprite[] {
  return scene.children.list.filter(
    (child): child is Phaser.GameObjects.TileSprite => child.type === 'TileSprite',
  );
}

/** Frame concreto de la hoja que un objeto esta mostrando. */
function frameOf(obj: { frame: Phaser.Textures.Frame }): number {
  return Number(obj.frame.name);
}

describe('renderGround', () => {
  it('pinta MAP_W*MAP_H tiles de la hoja de terreno, alternando cesped por paridad de fila', async () => {
    const list = await withScene((scene) => {
      renderGround(scene, buildTerrainGrid());
      return images(scene).map((img) => ({
        x: img.x,
        y: img.y,
        key: img.texture.key,
        frame: frameOf(img),
        scale: img.scaleX,
      }));
    });

    expect(list).toHaveLength(MAP_W * MAP_H);
    expect(new Set(list.map((i) => i.key))).toEqual(new Set([TERRAIN_SHEET]));
    // Escala 2: el tile de 16px del pack tiene que cubrir el de 32px del mundo.
    expect(new Set(list.map((i) => i.scale))).toEqual(new Set([2]));

    // (5,4): fila par, cesped por defecto. (5,5): fila impar -> variante.
    expect(list.find((i) => i.x === 5 * TILE && i.y === 4 * TILE)?.frame).toBe(TERRAIN.grass);
    expect(list.find((i) => i.x === 5 * TILE && i.y === 5 * TILE)?.frame).toBe(TERRAIN.grassAlt);
  });

  it('usa el frame declarado en GROUND_FRAMES para tiles que no son cesped llano', async () => {
    const list = await withScene((scene) => {
      renderGround(scene, buildTerrainGrid());
      return images(scene).map((img) => ({ x: img.x, y: img.y, frame: frameOf(img) }));
    });

    // Borde de seto solido en (0,0) -> cesped oscuro; rio en (1,19) fuera de los puentes -> agua.
    expect(list.find((i) => i.x === 0 && i.y === 0)?.frame).toBe(TERRAIN.grassDark);
    expect(list.find((i) => i.x === 1 * TILE && i.y === 19 * TILE)?.frame).toBe(TERRAIN.water);
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

    // Planta de esquina en (51,19), que ocupaba el barril del prototipo.
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

  it('coloca un escritorio de 2x1 tiles en cada posicion declarada por DESK_ROWS', async () => {
    const desks = await withScene((scene) => {
      placeFurniture(scene, buildTerrainGrid());
      // El `texture.key` de un TileSprite NO es la hoja de origen: Phaser
      // renderiza el frame en un lienzo interno con nombre generado para poder
      // repetirlo. Por eso aqui se comprueba geometria, no la clave.
      return tileSprites(scene)
        .filter((sprite) => sprite.width === 2 * TILE && sprite.height === 1 * TILE)
        .map((sprite) => ({
          x: sprite.x,
          y: sprite.y,
          tileScale: sprite.tileScaleX,
        }));
    });

    const expectedDesks = DESK_ROWS.flatMap(([x, y, n]) =>
      Array.from({ length: n }, (_, i) => ({
        x: (x + i * 2) * TILE,
        y: y * TILE,
        tileScale: 2,
      })),
    );
    expect(desks).toHaveLength(expectedDesks.length);
    expect(desks).toEqual(expect.arrayContaining(expectedDesks));
  });

  it('las mesas de sala repiten el tile en vez de estirar uno solo', async () => {
    const tables = await withScene((scene) => {
      placeFurniture(scene, buildTerrainGrid());
      return tileSprites(scene)
        .filter((sprite) => sprite.width > 2 * TILE)
        .map((sprite) => ({ w: sprite.width, h: sprite.height, tileScale: sprite.tileScaleX }));
    });

    // Estirar un tile de 16px a 7 tiles de ancho lo dejaria borroso; repetirlo
    // mantiene el pixel art nitido. `tileScale` 2 hace que repita cada 32px.
    expect(tables).toEqual(
      expect.arrayContaining([
        { w: 7 * TILE, h: 5 * TILE, tileScale: 2 },
        { w: 5 * TILE, h: 3 * TILE, tileScale: 2 },
      ]),
    );
  });
});

describe('placeNature', () => {
  it('coloca un arbol por cada entrada de TREES y marca su tile solida', async () => {
    const result = await withScene((scene) => {
      const grid = buildTerrainGrid();
      placeFurniture(scene, grid);
      placeNature(scene, grid);
      const trees = images(scene).filter((img) => {
        const frame = frameOf(img);
        return frame === TERRAIN.treeGreen || frame === TERRAIN.treeOrange;
      });
      return { treeCount: trees.length, solid: grid.solid };
    });

    expect(result.treeCount).toBe(TREES.length);
    for (const [tx, ty] of TREES) {
      expect(result.solid[ty][tx]).toBe(true);
    }
  });

  it('dispersa parcelas de flores de forma deterministica sin salir del mapa', async () => {
    const flowerFrames = [TERRAIN.flowersOrange, TERRAIN.flowersWhite, TERRAIN.flowersBlue];
    const scattered = await withScene((scene) => {
      const grid = buildTerrainGrid();
      placeFurniture(scene, grid);
      placeNature(scene, grid);
      return images(scene)
        .filter((img) => flowerFrames.includes(frameOf(img) as never))
        .map((img) => ({ x: img.x, y: img.y, frame: frameOf(img) }));
    });

    expect(scattered.length).toBeGreaterThan(0);
    expect(scattered.length).toBeLessThanOrEqual(90);
    for (const item of scattered) {
      expect(item.x).toBeGreaterThanOrEqual(TILE);
      expect(item.x).toBeLessThanOrEqual((MAP_W - 2) * TILE);
      expect(item.y).toBeGreaterThanOrEqual(TILE);
      expect(item.y).toBeLessThanOrEqual((MAP_H - 2) * TILE);
    }

    // i=0 -> tile (6,12), cesped libre; i=1 -> tile (19,41), tambien libre. Las
    // flores del pack son tiles de suelo completos, asi que van alineadas a la
    // rejilla, no centradas dentro de la tile como las calcomanias anteriores.
    expect(scattered.find((s) => s.x === 6 * TILE && s.y === 12 * TILE)?.frame).toBe(
      TERRAIN.flowersOrange,
    );
    expect(scattered.find((s) => s.x === 19 * TILE && s.y === 41 * TILE)?.frame).toBe(
      TERRAIN.flowersWhite,
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
