import Phaser from 'phaser';
import { afterEach, describe, expect, it } from 'vitest';
import { waitForSceneRunning } from '../test/phaserScene';
import { TILE } from './mapData';
import { createOfficeBridge } from './officeBridge';
import { BASE_LAYOUT } from './officeLayout';
import { TERRAIN_HOVER_NAME, TERRAIN_SELECTION_NAME, TerrainEditLayer } from './TerrainEditLayer';

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

function pointerAt(worldX: number, worldY: number): Phaser.Input.Pointer {
  return { worldX, worldY } as unknown as Phaser.Input.Pointer;
}

function outline(scene: Phaser.Scene, name: string): Phaser.GameObjects.Rectangle | null {
  return scene.children.getByName(name) as Phaser.GameObjects.Rectangle | null;
}

describe('TerrainEditLayer', () => {
  it('outlines the selected 9x9 block, and nothing once the editor closes', async () => {
    const scene = await bootHostScene();
    const bridge = createOfficeBridge();
    new TerrainEditLayer(scene, bridge, BASE_LAYOUT);

    bridge.emitCommand('terrainedit', { selected: 15, preview: null });

    const selected = outline(scene, TERRAIN_SELECTION_NAME);
    expect(selected).not.toBeNull();
    expect(selected!.width).toBe(9 * TILE);
    expect(selected!.x).toBe(9 * TILE + (9 * TILE) / 2);
    expect(selected!.y).toBe(9 * TILE + (9 * TILE) / 2);
    expect(selected!.isStroked).toBe(true);
    expect(selected!.isFilled).toBe(false);

    bridge.emitCommand('terrainedit', { selected: null, preview: null });
    expect(outline(scene, TERRAIN_SELECTION_NAME)).toBeNull();
    bridge.emitCommand('terrainedit', { selected: 3, preview: null });
    bridge.emitCommand('terrainedit', null);
    expect(outline(scene, TERRAIN_SELECTION_NAME)).toBeNull();
  });

  it('reports the block under a click while the editor is open, and only then', async () => {
    const scene = await bootHostScene();
    const bridge = createOfficeBridge();
    new TerrainEditLayer(scene, bridge, BASE_LAYOUT);
    const picks: unknown[] = [];
    bridge.on('terrainpick', (payload) => picks.push(payload));

    scene.input.emit('pointerdown', pointerAt(10, 10));
    bridge.emitCommand('terrainedit', { selected: null, preview: null });
    scene.input.emit('pointerdown', pointerAt(9 * TILE + 1, 9 * TILE + 1));
    scene.input.emit('pointerdown', pointerAt(-5, 10));
    bridge.emitCommand('terrainedit', null);
    scene.input.emit('pointerdown', pointerAt(10, 10));

    expect(picks).toEqual([{ index: 15 }]);
  });

  it('outlines the block under the pointer while open', async () => {
    const scene = await bootHostScene();
    const bridge = createOfficeBridge();
    new TerrainEditLayer(scene, bridge, BASE_LAYOUT);

    bridge.emitCommand('terrainedit', { selected: null, preview: null });
    scene.input.emit('pointermove', pointerAt(9 * TILE + 1, 1));

    const hover = outline(scene, TERRAIN_HOVER_NAME);
    expect(hover?.visible).toBe(true);
    expect(hover?.x).toBe(9 * TILE + (9 * TILE) / 2);
    scene.input.emit('pointermove', pointerAt(-5, 1));
    expect(outline(scene, TERRAIN_HOVER_NAME)?.visible).toBe(false);
  });

  it('stops listening once destroyed', async () => {
    const scene = await bootHostScene();
    const bridge = createOfficeBridge();
    const layer = new TerrainEditLayer(scene, bridge, BASE_LAYOUT);
    const picks: unknown[] = [];
    bridge.on('terrainpick', (payload) => picks.push(payload));
    bridge.emitCommand('terrainedit', { selected: 1, preview: null });

    layer.destroy();
    scene.input.emit('pointerdown', pointerAt(10, 10));

    expect(picks).toEqual([]);
    expect(outline(scene, TERRAIN_SELECTION_NAME)).toBeNull();
  });
});
