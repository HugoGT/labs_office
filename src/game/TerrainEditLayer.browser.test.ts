import Phaser from 'phaser';
import { afterEach, describe, expect, it } from 'vitest';
import { waitForSceneRunning } from '../test/phaserScene';
import { TILE } from './mapData';
import { createOfficeBridge } from './officeBridge';
import { BASE_LAYOUT } from './officeLayout';
import { TERRAIN_HOVER_NAME, TerrainEditLayer } from './TerrainEditLayer';

/**
 * `TerrainEditLayer` draws real Phaser outlines and turns real pointer input
 * into `terrainpick`, so it runs in a real game, on a bare host scene like
 * `LayoutEditLayer.browser.test.ts`.
 */

const games: Phaser.Game[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const game of games.splice(0)) game.destroy(true);
  for (const host of hosts.splice(0)) host.remove();
});

const HOST_SCENE_KEY = 'terrain-edit-layer-host';

class HostScene extends Phaser.Scene {
  constructor() {
    super(HOST_SCENE_KEY);
  }
}

async function bootHostScene(): Promise<Phaser.Scene> {
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  const game = new Phaser.Game({ type: Phaser.AUTO, parent: host, width: 320, height: 240, scene: [new HostScene()] });
  games.push(game);
  await waitForSceneRunning(game, HOST_SCENE_KEY);
  return game.scene.getScene(HOST_SCENE_KEY) as Phaser.Scene;
}

function pointerAt(worldX: number, worldY: number, button = 0): Phaser.Input.Pointer {
  return { worldX, worldY, button } as unknown as Phaser.Input.Pointer;
}

function outline(scene: Phaser.Scene, name: string): Phaser.GameObjects.Rectangle | null {
  return scene.children.getByName(name) as Phaser.GameObjects.Rectangle | null;
}

describe('TerrainEditLayer', () => {
  it('reports the block under a click while the editor is open, and only then', async () => {
    const scene = await bootHostScene();
    const bridge = createOfficeBridge();
    new TerrainEditLayer(scene, bridge, BASE_LAYOUT);
    const picks: unknown[] = [];
    bridge.on('terrainpick', (payload) => picks.push(payload));
    const columns = BASE_LAYOUT.width / 9;

    scene.input.emit('pointerdown', pointerAt(10, 10));
    bridge.emitCommand('terrainedit', { brush: 'grass' });
    scene.input.emit('pointerdown', pointerAt(9 * TILE + 1, 9 * TILE + 1));
    scene.input.emit('pointerdown', pointerAt(-5, 10));
    bridge.emitCommand('terrainedit', null);
    scene.input.emit('pointerdown', pointerAt(10, 10));

    expect(picks).toEqual([{ index: columns + 1 }]);
  });

  it('keeps painting the blocks a held drag crosses, each once, until the button is released', async () => {
    const scene = await bootHostScene();
    const bridge = createOfficeBridge();
    new TerrainEditLayer(scene, bridge, BASE_LAYOUT);
    const picks: number[] = [];
    bridge.on('terrainpick', ({ index }) => picks.push(index));
    const columns = BASE_LAYOUT.width / 9;
    const BLOCK = 9 * TILE;
    bridge.emitCommand('terrainedit', { brush: 'grass' });

    // Hovering paints nothing; a press paints its block, then the drag goes on.
    scene.input.emit('pointermove', pointerAt(BLOCK / 2, BLOCK / 2));
    scene.input.emit('pointerdown', pointerAt(BLOCK / 2, BLOCK / 2));
    scene.input.emit('pointermove', pointerAt(BLOCK / 2 + 10, BLOCK / 2));
    // The editor redraws its pending paints while the stroke goes on: same brush, same stroke.
    bridge.emitCommand('terrainedit', { brush: 'grass', previewBlocks: BASE_LAYOUT.blocks });
    // A fast flick jumps two blocks in one event: the one in between is painted too.
    scene.input.emit('pointermove', pointerAt(2 * BLOCK + BLOCK / 2, BLOCK / 2));
    scene.input.emit('pointermove', pointerAt(2 * BLOCK + BLOCK / 2, BLOCK + BLOCK / 2));
    scene.input.emit('pointerup', pointerAt(2 * BLOCK + BLOCK / 2, BLOCK + BLOCK / 2));
    scene.input.emit('pointermove', pointerAt(3 * BLOCK + BLOCK / 2, BLOCK + BLOCK / 2));

    expect(picks).toEqual([0, 1, 2, columns + 2]);
  });

  it('ends a drag released outside the game, and paints nothing for other buttons or with no floor picked', async () => {
    const scene = await bootHostScene();
    const bridge = createOfficeBridge();
    new TerrainEditLayer(scene, bridge, BASE_LAYOUT);
    const picks: number[] = [];
    bridge.on('terrainpick', ({ index }) => picks.push(index));
    const BLOCK = 9 * TILE;

    bridge.emitCommand('terrainedit', { brush: 'sand' });
    scene.input.emit('pointerdown', pointerAt(10, 10));
    scene.input.emit('pointerupoutside', pointerAt(10, 10));
    scene.input.emit('pointermove', pointerAt(BLOCK + 10, 10));
    scene.input.emit('pointerdown', pointerAt(10, 10, 2));
    scene.input.emit('pointermove', pointerAt(BLOCK + 10, 10));
    // Picking another floor mid-stroke ends the stroke.
    scene.input.emit('pointerdown', pointerAt(2 * BLOCK + 10, 10));
    bridge.emitCommand('terrainedit', { brush: 'water' });
    scene.input.emit('pointermove', pointerAt(3 * BLOCK + 10, 10));
    bridge.emitCommand('terrainedit', { brush: null });
    scene.input.emit('pointerdown', pointerAt(10, 10));
    scene.input.emit('pointermove', pointerAt(BLOCK + 10, 10));

    expect(picks).toEqual([0, 2]);
  });

  it('outlines the 9x9 block a click would paint, only while a floor is picked', async () => {
    const scene = await bootHostScene();
    const bridge = createOfficeBridge();
    new TerrainEditLayer(scene, bridge, BASE_LAYOUT);

    bridge.emitCommand('terrainedit', { brush: null });
    scene.input.emit('pointermove', pointerAt(9 * TILE + 1, 1));
    expect(outline(scene, TERRAIN_HOVER_NAME)?.visible ?? false).toBe(false);

    bridge.emitCommand('terrainedit', { brush: 'sand' });
    scene.input.emit('pointermove', pointerAt(9 * TILE + 1, 1));
    const hover = outline(scene, TERRAIN_HOVER_NAME);
    expect(hover?.visible).toBe(true);
    expect(hover!.width).toBe(9 * TILE);
    expect(hover!.x).toBe(9 * TILE + (9 * TILE) / 2);
    expect(hover!.y).toBe((9 * TILE) / 2);
    expect(hover!.isStroked).toBe(true);
    expect(hover!.isFilled).toBe(false);

    scene.input.emit('pointermove', pointerAt(-5, 1));
    expect(outline(scene, TERRAIN_HOVER_NAME)?.visible).toBe(false);

    scene.input.emit('pointermove', pointerAt(1, 1));
    bridge.emitCommand('terrainedit', { brush: null });
    expect(outline(scene, TERRAIN_HOVER_NAME)?.visible ?? false).toBe(false);
    bridge.emitCommand('terrainedit', null);
    expect(outline(scene, TERRAIN_HOVER_NAME)).toBeNull();
  });

  it('stops listening once destroyed', async () => {
    const scene = await bootHostScene();
    const bridge = createOfficeBridge();
    const layer = new TerrainEditLayer(scene, bridge, BASE_LAYOUT);
    const picks: unknown[] = [];
    bridge.on('terrainpick', (payload) => picks.push(payload));
    bridge.emitCommand('terrainedit', { brush: 'wood' });
    scene.input.emit('pointermove', pointerAt(10, 10));

    layer.destroy();
    scene.input.emit('pointerdown', pointerAt(10, 10));

    expect(picks).toEqual([]);
    expect(outline(scene, TERRAIN_HOVER_NAME)).toBeNull();
  });
});
