import Phaser from 'phaser';
import { afterEach, describe, expect, it } from 'vitest';
import { waitForSceneRunning } from '../test/phaserScene';
import { TERRAIN_LAYER_ORIGIN } from './artContract';
import { TILE } from './mapData';
import { createOfficeBridge } from './officeBridge';
import { BASE_LAYOUT } from './officeLayout';
import { TerrainEditLayer } from './TerrainEditLayer';
import { TerrainGhost } from './TerrainGhost';
import { TERRAIN_GHOST_ALPHA } from './ghostTerrain';
import type { TerrainBrush } from './terrainEditor';

/** A real game on a bare host scene, like `TerrainEditLayer.browser.test.ts`: without art, so the flat fallback draws. */
const games: Phaser.Game[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const game of games.splice(0)) game.destroy(true);
  for (const host of hosts.splice(0)) host.remove();
});

const HOST_SCENE_KEY = 'terrain-ghost-host';

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

const BLOCK = 9 * TILE;
const floor = (material: 'grass' | 'carpet' | 'void', color?: string): TerrainBrush => ({ kind: 'floor', material, ...(color === undefined ? {} : { color }) });

function pointerAt(worldX: number, worldY: number): Phaser.Input.Pointer {
  return { worldX, worldY, button: 0 } as unknown as Phaser.Input.Pointer;
}

describe('TerrainGhost', () => {
  it('draws the floor over the block it is shown at, nearly opaque, and hides without leaving anything behind', async () => {
    const scene = await bootHostScene();
    const ghost = new TerrainGhost(scene, undefined, () => null);
    expect(ghost.layers()).toEqual([]);

    ghost.show({ material: 'grass' }, 2 * BLOCK, BLOCK);
    const layers = ghost.layers();
    expect(layers.length).toBeGreaterThan(0);
    for (const layer of layers) {
      expect(layer.visible).toBe(true);
      expect(layer.alpha).toBe(TERRAIN_GHOST_ALPHA);
      // Cut to the block itself: the drawing's own edges would spill half a tile outside it.
      expect(layer.mask).not.toBeNull();
    }
    expect(ghost.clip()).toEqual({ x: 2 * BLOCK, y: BLOCK, width: BLOCK, height: BLOCK });
    // The ghost map has a block of the same floor all around, so the block shown is its middle one.
    expect(layers.some((layer) => layer.x === 2 * BLOCK - BLOCK + TERRAIN_LAYER_ORIGIN)).toBe(true);

    ghost.show({ material: 'grass' }, 3 * BLOCK, BLOCK);
    expect(ghost.clip()).toEqual({ x: 3 * BLOCK, y: BLOCK, width: BLOCK, height: BLOCK });
    expect(ghost.layers().some((layer) => layer.x === 3 * BLOCK - BLOCK + TERRAIN_LAYER_ORIGIN)).toBe(true);
    expect(ghost.layers().length).toBe(layers.length);

    ghost.hide();
    expect(ghost.layers().every((layer) => !layer.visible)).toBe(true);
    ghost.show({ material: 'void' }, 0, 0);
    expect(ghost.layers().every((layer) => !layer.visible)).toBe(true);

    ghost.destroy();
    expect(ghost.layers()).toEqual([]);
  });
});

describe('TerrainEditLayer with a ghost', () => {
  it('shows the picked floor over the block under the pointer, and only while a floor is picked', async () => {
    const scene = await bootHostScene();
    const bridge = createOfficeBridge();
    const ghost = new TerrainGhost(scene, undefined, () => null);
    new TerrainEditLayer(scene, bridge, BASE_LAYOUT, ghost);
    const visible = (): boolean => ghost.layers().some((layer) => layer.visible);
    const atBlock = (col: number, row: number): boolean => ghost.layers().some((layer) => layer.visible) && ghost.clip()?.x === col * BLOCK && ghost.clip()?.y === row * BLOCK;

    scene.input.emit('pointermove', pointerAt(BLOCK + 10, 2 * BLOCK + 10));
    expect(visible()).toBe(false);

    bridge.emitCommand('terrainedit', { brush: floor('carpet', '#c0392b') });
    expect(atBlock(1, 2)).toBe(true);
    scene.input.emit('pointermove', pointerAt(3 * BLOCK + 10, BLOCK + 10));
    expect(atBlock(3, 1)).toBe(true);
    expect(atBlock(1, 2)).toBe(false);

    // Off the map, with a wall or the void eraser in hand, or nothing picked: no ghost.
    scene.input.emit('pointermove', pointerAt(-20, 10));
    expect(visible()).toBe(false);
    scene.input.emit('pointermove', pointerAt(BLOCK + 10, BLOCK + 10));
    bridge.emitCommand('terrainedit', { brush: floor('void') });
    expect(visible()).toBe(false);
    bridge.emitCommand('terrainedit', { brush: { kind: 'wall', piece: null } });
    expect(visible()).toBe(false);
    bridge.emitCommand('terrainedit', { brush: floor('grass') });
    expect(visible()).toBe(true);
    bridge.emitCommand('terrainedit', { brush: null });
    expect(visible()).toBe(false);
    bridge.emitCommand('terrainedit', { brush: floor('grass') });
    bridge.emitCommand('terrainedit', null);
    expect(visible()).toBe(false);
  });
});
