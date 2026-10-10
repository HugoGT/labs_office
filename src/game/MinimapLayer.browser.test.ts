import Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForSceneRunning } from '../test/phaserScene';
import { MINIMAP_MARKER_RADIUS_PX, MinimapLayer, type MinimapLayerOptions } from './MinimapLayer';

/**
 * `MinimapLayer` frames a real minimap camera on the terrain region, so it
 * needs a real `Phaser.Game`; the host scene is as small as the one of
 * `CameraPanLayer.browser.test.ts`.
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

const HOST_SCENE_KEY = 'minimap-layer-host';
/** A 100x50 minimap in the top-right corner of a 320x240 canvas. */
const MAP = { x: 200, y: 0, width: 100, height: 50 } as const;

class HostScene extends Phaser.Scene {
  minimap!: Phaser.Cameras.Scene2D.Camera;
  marker!: Phaser.GameObjects.Arc;
  constructor() {
    super(HOST_SCENE_KEY);
  }
  create(): void {
    this.minimap = this.cameras.add(MAP.x, MAP.y, MAP.width, MAP.height);
    this.marker = this.add.circle(0, 0, 42);
  }
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

function layerOptions(scene: HostScene, overrides: Partial<MinimapLayerOptions> = {}): MinimapLayerOptions {
  return {
    scene,
    camera: scene.minimap,
    region: { x: 0, y: 0, width: 2000, height: 2000 },
    center: { x: 0, y: 0 },
    marker: scene.marker,
    ...overrides,
  };
}

function fakePointer(
  overrides: Partial<{ x: number; y: number; button: number; camera: Phaser.Cameras.Scene2D.Camera }> = {},
): Phaser.Input.Pointer {
  return { x: 0, y: 0, button: 0, camera: undefined, ...overrides } as unknown as Phaser.Input.Pointer;
}

/** One real frame: the camera's `preRender` clamps the scroll and updates `worldView`. */
function renderFrame(scene: Phaser.Scene): void {
  scene.game.step(scene.time.now + 16, 16);
}

describe('MinimapLayer: framed on the terrain region', () => {
  it('fits the region width and centers a region shorter than the minimap', async () => {
    const scene = await bootHostScene();
    // 480 wide at zoom 100/480 shows 240 world px tall: the 200 tall region fits.
    const region = { x: 3000, y: 1500, width: 480, height: 200 };
    new MinimapLayer(layerOptions(scene, { region, center: { x: 3100, y: 1550 } }));
    renderFrame(scene);

    const view = scene.minimap.worldView;
    expect(scene.minimap.zoom).toBeCloseTo(MAP.width / region.width, 6);
    expect(view.x).toBeCloseTo(region.x, 0);
    expect(view.width).toBeCloseTo(region.width, 0);
    expect(view.centerY).toBeCloseTo(region.y + region.height / 2, 0);
  });

  it('keeps a region taller than the minimap inside it, around the given center', async () => {
    const scene = await bootHostScene();
    // Zoom 100/480 shows 240 world px of a 1200 tall region.
    const region = { x: 0, y: 0, width: 480, height: 1200 };
    new MinimapLayer(layerOptions(scene, { region, center: { x: 100, y: 600 } }));
    renderFrame(scene);
    expect(scene.minimap.worldView.centerY).toBeCloseTo(600, 0);

    new MinimapLayer(layerOptions(scene, { region, center: { x: 100, y: 0 } }));
    renderFrame(scene);
    expect(scene.minimap.worldView.y).toBeCloseTo(region.y, 0);
  });

  it('reframes on a new region, keeping the vertical position it had', async () => {
    const scene = await bootHostScene();
    const layer = new MinimapLayer(
      layerOptions(scene, { region: { x: 0, y: 0, width: 480, height: 1200 }, center: { x: 0, y: 600 } }),
    );
    renderFrame(scene);

    // A column of blocks painted to the right widens the region.
    const wider = { x: 0, y: 0, width: 960, height: 1200 };
    layer.setRegion(wider);
    renderFrame(scene);

    expect(scene.minimap.zoom).toBeCloseTo(MAP.width / wider.width, 6);
    expect(scene.minimap.worldView.x).toBeCloseTo(0, 0);
    expect(scene.minimap.worldView.centerY).toBeCloseTo(600, 0);
  });

  it('show() brings a point into view, still inside the region', async () => {
    const scene = await bootHostScene();
    const layer = new MinimapLayer(
      layerOptions(scene, { region: { x: 0, y: 0, width: 480, height: 1200 }, center: { x: 0, y: 0 } }),
    );

    // Where the room restored the player, far below the first band.
    layer.show({ x: 50, y: 900 });
    renderFrame(scene);
    expect(scene.minimap.worldView.centerY).toBeCloseTo(900, 0);

    layer.show({ x: 50, y: 5000 });
    renderFrame(scene);
    expect(scene.minimap.worldView.bottom).toBeCloseTo(1200, 0);
    expect(scene.minimap.worldView.x).toBeCloseTo(0, 0);
  });

  it('draws the player marker the same screen size whatever the zoom', async () => {
    const scene = await bootHostScene();
    const layer = new MinimapLayer(layerOptions(scene, { region: { x: 0, y: 0, width: 480, height: 200 } }));
    expect(scene.marker.radius * scene.minimap.zoom).toBeCloseTo(MINIMAP_MARKER_RADIUS_PX, 6);

    layer.setRegion({ x: 0, y: 0, width: 4800, height: 200 });
    expect(scene.marker.radius * scene.minimap.zoom).toBeCloseTo(MINIMAP_MARKER_RADIUS_PX, 6);
  });
});

describe('MinimapLayer: drag and click', () => {
  // Zoom 100/480: the minimap shows 240 of the 1200 world px tall region.
  const TALL = { x: 0, y: 0, width: 480, height: 1200 };

  it('a drag scrolls a region taller than the minimap, never past its edges, and is no click', async () => {
    const scene = await bootHostScene();
    const onFocus = vi.fn();
    new MinimapLayer(layerOptions(scene, { region: TALL, center: { x: 0, y: 600 }, onFocus }));
    renderFrame(scene);
    const map = scene.minimap;

    scene.input.emit('pointerdown', fakePointer({ x: 250, y: 25, camera: map }), []);
    // 20 screen px up is 96 world px down the region.
    scene.input.emit('pointermove', fakePointer({ x: 250, y: 5, camera: map }));
    renderFrame(scene);
    expect(map.worldView.centerY).toBeCloseTo(600 + 20 * (TALL.width / MAP.width), 0);

    scene.input.emit('pointermove', fakePointer({ x: 250, y: -500 }));
    renderFrame(scene);
    expect(map.worldView.bottom).toBeCloseTo(TALL.height, 0);

    scene.input.emit('pointerup', fakePointer({ x: 250, y: -500 }));
    expect(onFocus).not.toHaveBeenCalled();
  });

  it('a click focuses the world point under the pointer', async () => {
    const scene = await bootHostScene();
    const onFocus = vi.fn();
    new MinimapLayer(layerOptions(scene, { region: TALL, center: { x: 0, y: 600 }, onFocus }));
    renderFrame(scene);

    // The minimap's screen middle (250, 25) is the band's middle (240, 600).
    scene.input.emit('pointerdown', fakePointer({ x: 250, y: 25, camera: scene.minimap }), []);
    scene.input.emit('pointerup', fakePointer({ x: 251, y: 25 }));

    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onFocus.mock.calls[0]![0].x).toBeCloseTo(240, 0);
    expect(onFocus.mock.calls[0]![0].y).toBeCloseTo(600, 0);
  });

  it('ignores the secondary button, presses over the main camera and a release outside the canvas', async () => {
    const scene = await bootHostScene();
    const onFocus = vi.fn();
    new MinimapLayer(layerOptions(scene, { region: TALL, center: { x: 0, y: 600 }, onFocus }));
    renderFrame(scene);
    const before = scene.minimap.scrollY;

    scene.input.emit('pointerdown', fakePointer({ x: 250, y: 25, button: 2, camera: scene.minimap }), []);
    scene.input.emit('pointermove', fakePointer({ x: 250, y: 0 }));
    scene.input.emit('pointerup', fakePointer({ x: 250, y: 0 }));
    scene.input.emit('pointerdown', fakePointer({ x: 50, y: 50, camera: scene.cameras.main }), []);
    scene.input.emit('pointerup', fakePointer({ x: 50, y: 50 }));
    scene.input.emit('pointerdown', fakePointer({ x: 250, y: 25, camera: scene.minimap }), []);
    scene.input.emit('pointerupoutside', fakePointer({ x: 250, y: 25 }));

    expect(scene.minimap.scrollY).toBe(before);
    expect(onFocus).not.toHaveBeenCalled();
  });

  it('destroy() removes its listeners', async () => {
    const scene = await bootHostScene();
    const onFocus = vi.fn();
    const layer = new MinimapLayer(layerOptions(scene, { region: TALL, center: { x: 0, y: 600 }, onFocus }));
    layer.destroy();

    scene.input.emit('pointerdown', fakePointer({ x: 250, y: 25, camera: scene.minimap }), []);
    scene.input.emit('pointerup', fakePointer({ x: 250, y: 25 }));

    expect(onFocus).not.toHaveBeenCalled();
  });
});

describe('MinimapLayer: double click walks there', () => {
  const TALL = { x: 0, y: 0, width: 480, height: 1200 };

  function click(scene: HostScene, x: number, y: number): void {
    scene.input.emit('pointerdown', fakePointer({ x, y, camera: scene.minimap }), []);
    scene.input.emit('pointerup', fakePointer({ x, y }));
  }

  it('two quick clicks on one spot walk to its world point, and each click still focuses', async () => {
    const scene = await bootHostScene();
    const onFocus = vi.fn();
    const onWalk = vi.fn();
    new MinimapLayer(layerOptions(scene, { region: TALL, center: { x: 0, y: 600 }, onFocus, onWalk }));
    renderFrame(scene);

    click(scene, 250, 25);
    expect(onWalk).not.toHaveBeenCalled();
    click(scene, 252, 26);

    expect(onFocus).toHaveBeenCalledTimes(2);
    expect(onWalk).toHaveBeenCalledTimes(1);
    expect(onWalk.mock.calls[0]![0].x).toBeCloseTo(240 + 2 * (TALL.width / MAP.width), 0);
    expect(onWalk.mock.calls[0]![0].y).toBeCloseTo(600 + 1 * (TALL.width / MAP.width), 0);

    // A third click starts a new pair instead of chaining.
    click(scene, 252, 26);
    expect(onWalk).toHaveBeenCalledTimes(1);
  });

  it('clicks too far apart in time or space, or a drag between them, do not walk', async () => {
    const scene = await bootHostScene();
    const onWalk = vi.fn();
    new MinimapLayer(layerOptions(scene, { region: TALL, center: { x: 0, y: 600 }, onWalk }));
    renderFrame(scene);

    click(scene, 250, 25);
    for (let frame = 0; frame < 25; frame++) renderFrame(scene);
    click(scene, 250, 25);
    click(scene, 270, 25);

    scene.input.emit('pointerdown', fakePointer({ x: 270, y: 25, camera: scene.minimap }), []);
    scene.input.emit('pointermove', fakePointer({ x: 270, y: 45 }));
    scene.input.emit('pointerup', fakePointer({ x: 270, y: 45 }));
    click(scene, 270, 25);

    expect(onWalk).not.toHaveBeenCalled();
  });
});
