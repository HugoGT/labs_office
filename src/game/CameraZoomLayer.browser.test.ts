import Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForSceneRunning } from '../test/phaserScene';
import { CameraZoomLayer, type CameraZoomLayerOptions } from './CameraZoomLayer';
import { createOfficeBridge, type OfficeBridge } from './officeBridge';
import { zoomView, type ZoomView } from './mapZoom';

/**
 * `CameraZoomLayer` turns real wheel, key and bridge input into a zoom target
 * and eases the main camera to it: it needs a real `Phaser.Game`, hosted by a
 * minimal scene like `CameraPanLayer.browser.test.ts`.
 */

const games: Phaser.Game[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const game of games.splice(0)) {
    game.destroy(true);
    if (!game.loop.running) game.step(0, 0);
  }
  for (const host of hosts.splice(0)) host.remove();
});

const HOST_SCENE_KEY = 'camera-zoom-layer-host';

class HostScene extends Phaser.Scene {
  constructor() {
    super(HOST_SCENE_KEY);
  }
  create(): void {}
}

async function bootHostScene(): Promise<HostScene> {
  const host = document.createElement('div');
  host.style.width = '320px';
  host.style.height = '240px';
  document.body.append(host);
  hosts.push(host);

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: host,
    width: 320,
    height: 240,
    input: { touch: true },
    scene: [new HostScene()],
  });
  games.push(game);

  await waitForSceneRunning(game, HOST_SCENE_KEY);
  game.loop.stop();
  return game.scene.getScene(HOST_SCENE_KEY) as HostScene;
}

interface Fixture {
  scene: HostScene;
  bridge: OfficeBridge;
  minimap: Phaser.Cameras.Scene2D.Camera;
  layer: CameraZoomLayer;
  views: ZoomView[];
  clock: { now: number };
}

async function fixture(overrides: Partial<CameraZoomLayerOptions> = {}, startZoom = 1): Promise<Fixture> {
  const scene = await bootHostScene();
  const bridge = createOfficeBridge();
  const views: ZoomView[] = [];
  bridge.on('zoomchanged', (view) => views.push(view));
  scene.cameras.main.setZoom(startZoom);
  const minimap = scene.cameras.add(200, 0, 100, 100);
  const clock = { now: 1000 };
  const layer = new CameraZoomLayer({
    scene,
    camera: scene.cameras.main,
    minimap,
    bridge,
    now: () => clock.now,
    isEditableFocused: () => false,
    ...overrides,
  });
  return { scene, bridge, minimap, layer, views, clock };
}

function renderFrames(scene: Phaser.Scene, count = 60): void {
  for (let frame = 0; frame < count; frame++) scene.game.step(scene.time.now + 16, 16);
}

function wheel(
  scene: Phaser.Scene,
  deltaY: number,
  pointer: { camera?: Phaser.Cameras.Scene2D.Camera | null; x?: number; y?: number; ctrlKey?: boolean; deltaMode?: number } = {},
): void {
  const fake = {
    x: pointer.x ?? 50,
    y: pointer.y ?? 50,
    camera: pointer.camera === undefined ? scene.cameras.main : pointer.camera,
    event: { ctrlKey: pointer.ctrlKey ?? false, deltaMode: pointer.deltaMode ?? 0 },
  } as unknown as Phaser.Input.Pointer;
  scene.input.emit('wheel', fake, [], 0, deltaY, 0);
}

function key(scene: Phaser.Scene, keyName: string, extra: Partial<KeyboardEvent> = {}): void {
  const event = { key: keyName, code: '', ctrlKey: false, metaKey: false, altKey: false, repeat: false, ...extra };
  scene.input.keyboard!.emit('keydown', event);
}

describe('CameraZoomLayer: wheel', () => {
  it('a notch over the main camera steps the target and eases the main camera only, landing exactly on it', async () => {
    const { scene, minimap, views } = await fixture();
    const minimapZoom = minimap.zoom;

    wheel(scene, -100);
    expect(views.at(-1)).toEqual(zoomView(1.5));
    expect(scene.cameras.main.zoom).toBe(1);

    renderFrames(scene, 1);
    const afterOne = scene.cameras.main.zoom;
    expect(afterOne).toBeGreaterThan(1);
    expect(afterOne).toBeLessThan(1.5);

    renderFrames(scene);
    expect(scene.cameras.main.zoom).toBe(1.5);
    expect(minimap.zoom).toBe(minimapZoom);
  });

  it('wheel down steps out', async () => {
    const { scene, views } = await fixture();

    wheel(scene, 100);

    expect(views.at(-1)).toEqual(zoomView(0.75));
  });

  it('ignores a wheel from the minimap camera and one inside the minimap rect, even if Phaser says main', async () => {
    const { scene, minimap, views } = await fixture();
    const initial = views.length;

    wheel(scene, -100, { camera: minimap, x: 250, y: 50 });
    wheel(scene, -100, { camera: scene.cameras.main, x: 250, y: 50 });

    expect(views).toHaveLength(initial);
  });

  it('tolerates a pointer with no camera yet', async () => {
    const { scene, views } = await fixture();

    expect(() => wheel(scene, -100, { camera: null })).not.toThrow();

    expect(views.at(-1)).toEqual(zoomView(1.5));
  });

  it('ctrl+wheel (pinch) zooms with small deltas that plain wheel would ignore', async () => {
    const { scene, views, clock } = await fixture();

    for (let i = 0; i < 3; i++) {
      clock.now += 16;
      wheel(scene, -10, { ctrlKey: true });
    }

    expect(views.at(-1)).toEqual(zoomView(1.5));
  });

  it('normalizes line-mode deltas: one Firefox notch is one step', async () => {
    const { scene, views } = await fixture();

    wheel(scene, -3, { deltaMode: 1 });

    expect(views.at(-1)).toEqual(zoomView(1.5));
  });
});

describe('CameraZoomLayer: keyboard', () => {
  it('+ and - step, 0 resets', async () => {
    const { scene, views } = await fixture();

    key(scene, '+');
    expect(views.at(-1)).toEqual(zoomView(1.5));
    key(scene, '+');
    expect(views.at(-1)).toEqual(zoomView(2));
    key(scene, '0');
    expect(views.at(-1)).toEqual(zoomView(1));
    key(scene, '-');
    expect(views.at(-1)).toEqual(zoomView(0.75));
  });

  it('is ignored while an editable element is focused, with ctrl held or on a held key', async () => {
    let editable = true;
    const { scene, views } = await fixture({ isEditableFocused: () => editable });
    const initial = views.length;

    key(scene, '+');
    editable = false;
    key(scene, '+', { ctrlKey: true });
    key(scene, '+', { repeat: true });

    expect(views).toHaveLength(initial);
    key(scene, '+');
    expect(views.at(-1)).toEqual(zoomView(1.5));
  });
});

describe('CameraZoomLayer: bridge command, event and store', () => {
  it('announces the starting stop once, taken from the camera zoom', async () => {
    const { views } = await fixture({}, 0.5);

    expect(views).toEqual([zoomView(0.5)]);
  });

  it('the zoom command steps from the target: in, out and reset', async () => {
    const { bridge, views } = await fixture();

    bridge.emitCommand('zoom', { action: 'in' });
    bridge.emitCommand('zoom', { action: 'in' });
    expect(views.at(-1)).toEqual(zoomView(2));
    bridge.emitCommand('zoom', { action: 'out' });
    expect(views.at(-1)).toEqual(zoomView(1.5));
    bridge.emitCommand('zoom', { action: 'reset' });
    expect(views.at(-1)).toEqual(zoomView(1));
  });

  it('saves every change to the store, and nothing when the target does not move', async () => {
    const store = { load: () => 1, save: vi.fn() };
    const { bridge, views } = await fixture({ store }, 2);
    const initial = views.length;

    bridge.emitCommand('zoom', { action: 'in' });
    expect(store.save).not.toHaveBeenCalled();
    expect(views).toHaveLength(initial);

    bridge.emitCommand('zoom', { action: 'out' });
    expect(store.save).toHaveBeenCalledExactlyOnceWith(1.5);
  });
});

describe('CameraZoomLayer: destroy', () => {
  it('releases wheel, keys, update and the bridge subscription, and is idempotent', async () => {
    const { scene, bridge, layer, views } = await fixture();
    layer.destroy();
    const initial = views.length;

    wheel(scene, -100);
    key(scene, '+');
    bridge.emitCommand('zoom', { action: 'in' });
    renderFrames(scene, 3);

    expect(views).toHaveLength(initial);
    expect(scene.cameras.main.zoom).toBe(1);
    expect(() => layer.destroy()).not.toThrow();
  });

  it('can be destroyed after the game is gone', async () => {
    const { scene, layer } = await fixture();

    scene.game.destroy(true);
    scene.game.step(0, 0);
    // Already torn down here: the shared afterEach must not destroy it twice.
    games.splice(games.indexOf(scene.game), 1);

    expect(() => layer.destroy()).not.toThrow();
  });
});
