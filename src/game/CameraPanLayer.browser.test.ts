import Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForSceneRunning } from '../test/phaserScene';
import { CameraPanLayer, type CameraPanLayerOptions } from './CameraPanLayer';
import { regionBounds } from './cameraBounds';

/**
 * `CameraPanLayer` traduce input real de puntero a `reduceCameraPan` y aplica
 * el efecto sobre `cameras.main`, asi que necesita un `Phaser.Game` real --
 * misma escena anfitriona minima que `LayoutEditLayer.browser.test.ts`, la
 * capa no depende de nada de `OfficeScene`.
 */

const games: Phaser.Game[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const game of games.splice(0)) {
    game.destroy(true);
    // destroy() is deferred; these fixtures no longer rely on a scheduled RAF.
    if (!game.loop.running) game.step(0, 0);
  }
  for (const host of hosts.splice(0)) host.remove();
});

const HOST_SCENE_KEY = 'camera-pan-layer-host';
const WORLD = { x: 0, y: 0, width: 2000, height: 2000 } as const;

class HostScene extends Phaser.Scene {
  target!: Phaser.GameObjects.Rectangle;
  constructor() {
    super(HOST_SCENE_KEY);
  }
  create(): void {
    this.target = this.add.rectangle(400, 300, 4, 4);
    this.cameras.main.setBounds(WORLD.x, WORLD.y, WORLD.width, WORLD.height);
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
  // CI can deliver too few RAFs during a wall-clock poll. Own the frame
  // scheduler after boot, but keep the real SceneManager and renderer.
  game.loop.stop();

  return game.scene.getScene(HOST_SCENE_KEY) as HostScene;
}

function layerOptions(
  scene: HostScene,
  overrides: Partial<CameraPanLayerOptions> = {},
): CameraPanLayerOptions {
  return {
    scene,
    camera: scene.cameras.main,
    target: scene.target,
    lerp: 0.12,
    region: WORLD,
    isSuspended: () => false,
    ...overrides,
  };
}

/** 128 frames exceed the 0.12-lerp convergence bound for this 2000px world and 0.5px arrival. */
function renderFrames(scene: Phaser.Scene, count = 128): void {
  for (let frame = 0; frame < count; frame++) scene.game.step(scene.time.now + 16, 16);
}

/** Observe a complete real update + render, including Phaser's camera clamp/matrix. */
function nextFrame(scene: Phaser.Scene): Promise<void> {
  return new Promise((resolve) => {
    scene.game.events.once(Phaser.Core.Events.POST_RENDER, () => resolve());
    renderFrames(scene, 1);
  });
}

function fakePointer(
  overrides: Partial<{
    x: number;
    y: number;
    button: number;
    camera: Phaser.Cameras.Scene2D.Camera;
  }> = {},
): Phaser.Input.Pointer {
  return { x: 0, y: 0, button: 0, camera: undefined, ...overrides } as unknown as Phaser.Input.Pointer;
}

describe('CameraPanLayer: click por debajo del umbral deja el seguimiento intacto', () => {
  it('un down+up sin cruzar el umbral no toca stopFollow ni el scroll', async () => {
    const scene = await bootHostScene();
    const cam = scene.cameras.main;
    const stopFollow = vi.spyOn(cam, 'stopFollow');
    new CameraPanLayer(layerOptions(scene));

    scene.input.emit('pointerdown', fakePointer({ x: 100, y: 100, camera: cam }), []);
    scene.input.emit('pointermove', fakePointer({ x: 102, y: 101, camera: cam }));
    scene.input.emit('pointerup', fakePointer({ x: 102, y: 101, camera: cam }));

    expect(stopFollow).not.toHaveBeenCalled();
  });
});

describe('CameraPanLayer: drag por encima del umbral desplaza la camara', () => {
  it('el scroll se mueve por -delta/zoom desde el ULTIMO move, no por el delta crudo desde el origen', async () => {
    const scene = await bootHostScene();
    const cam = scene.cameras.main;
    cam.setZoom(2);
    const startScrollX = cam.scrollX;
    const startScrollY = cam.scrollY;
    new CameraPanLayer(layerOptions(scene));

    scene.input.emit('pointerdown', fakePointer({ x: 100, y: 100, camera: cam }), []);
    scene.input.emit('pointermove', fakePointer({ x: 120, y: 90, camera: cam }));
    // dx=20, dy=-10, zoom=2 -> scrollX -= 10, scrollY -= -5.
    expect(cam.scrollX).toBeCloseTo(startScrollX - 10);
    expect(cam.scrollY).toBeCloseTo(startScrollY + 5);

    scene.input.emit('pointermove', fakePointer({ x: 130, y: 90, camera: cam }));
    // Segundo tramo: solo 10px mas (130-120)/zoom=2 -> 5, no (130-100)/2=15.
    expect(cam.scrollX).toBeCloseTo(startScrollX - 15);
  });
});

describe('CameraPanLayer: releasing a drag keeps focus until the player moves (#146)', () => {
  it.each(['pointerup', 'pointerupoutside'])('%s keeps the dragged scroll and resumes smoothly only after movement', async (release) => {
    const scene = await bootHostScene();
    const cam = scene.cameras.main;
    cam.startFollow(scene.target);
    await nextFrame(scene);
    const startFollow = vi.spyOn(cam, 'startFollow');
    new CameraPanLayer(layerOptions(scene));

    scene.input.emit('pointerdown', fakePointer({ x: 100, y: 100, camera: cam }), []);
    scene.input.emit('pointermove', fakePointer({ x: 300, y: 100, camera: cam }));
    await nextFrame(scene);
    const scrollAtRelease = { x: cam.scrollX, y: cam.scrollY };
    scene.input.emit(release, fakePointer({ x: 300, y: 100, camera: cam }));

    // Hovering and a plain click must not reclaim the camera either.
    scene.input.emit('pointermove', fakePointer({ x: 310, y: 110, camera: cam }));
    scene.input.emit('pointerdown', fakePointer({ x: 100, y: 100, camera: cam }), []);
    scene.input.emit('pointerup', fakePointer({ x: 100, y: 100, camera: cam }));
    for (let frame = 0; frame < 5; frame++) await nextFrame(scene);
    expect(cam.scrollX).toBeCloseTo(scrollAtRelease.x);
    expect(cam.scrollY).toBeCloseTo(scrollAtRelease.y);
    expect(startFollow).not.toHaveBeenCalled();
    expect(cam.getBounds()).toMatchObject(regionBounds(WORLD, cam, cam.zoom));

    scene.target.x += 32;
    expect(cam.scrollX).toBeCloseTo(scrollAtRelease.x);
    await nextFrame(scene);
    expect(cam.scrollX).toBeGreaterThan(scrollAtRelease.x);
    expect(cam.midPoint.x).toBeLessThan(scene.target.x);
    expect(startFollow).not.toHaveBeenCalled();

    renderFrames(scene);
    expect(startFollow).toHaveBeenCalledTimes(1);
    expect(startFollow).toHaveBeenCalledWith(scene.target, true, 0.12, 0.12);
    expect(cam.getBounds()).toMatchObject(WORLD);
    expect(cam.midPoint.x).toBeCloseTo(scene.target.x, 0);
  });

  it('native touchcancel ends the gesture without reclaiming focus or allowing later hover to pan', async () => {
    const scene = await bootHostScene();
    const cam = scene.cameras.main;
    const canvas = scene.game.canvas;
    const rect = canvas.getBoundingClientRect();
    new CameraPanLayer(layerOptions(scene));
    const sendTouch = (type: string, x: number, y: number): void => {
      const touch = new Touch({
        identifier: 1,
        target: canvas,
        clientX: rect.left + x,
        clientY: rect.top + y,
        pageX: rect.left + x + window.scrollX,
        pageY: rect.top + y + window.scrollY,
      });
      canvas.dispatchEvent(new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        changedTouches: [touch],
        touches: type === 'touchcancel' ? [] : [touch],
        targetTouches: type === 'touchcancel' ? [] : [touch],
      }));
    };

    const originalScroll = cam.scrollX;
    // Toward increasing scroll: the camera starts at the region's top-left edge.
    sendTouch('touchstart', 160, 130);
    sendTouch('touchmove', 100, 100);
    await nextFrame(scene);
    const dragged = { x: cam.scrollX, y: cam.scrollY };
    expect(dragged.x).not.toBeCloseTo(originalScroll);
    sendTouch('touchcancel', 100, 100);
    scene.input.emit('pointermove', fakePointer({ x: 180, y: 150, camera: cam }));
    for (let frame = 0; frame < 5; frame++) await nextFrame(scene);
    expect(cam.scrollX).toBeCloseTo(dragged.x);
    expect(cam.scrollY).toBeCloseTo(dragged.y);

    scene.target.x += 32;
    renderFrames(scene);
    expect(cam.midPoint.x).toBeCloseTo(scene.target.x, 0);
  });
});

describe('CameraPanLayer: guardas que impiden armar el pan', () => {
  it('editor de layout activo, clic sobre algo interactivo, o boton distinto del izquierdo: ninguno arma pan', async () => {
    const guards: Array<{
      isSuspended: () => boolean;
      currentlyOver: Phaser.GameObjects.GameObject[];
      button: number;
    }> = [
      // isSuspended (editor de layout activo).
      { isSuspended: () => true, currentlyOver: [], button: 0 },
      // currentlyOver no vacio (clic sobre un peer/escritorio/pick).
      { isSuspended: () => false, currentlyOver: [{} as Phaser.GameObjects.GameObject], button: 0 },
      // Boton distinto del izquierdo.
      { isSuspended: () => false, currentlyOver: [], button: 2 },
    ];

    for (const guard of guards) {
      const scene = await bootHostScene();
      const cam = scene.cameras.main;
      const startScrollX = cam.scrollX;
      new CameraPanLayer(layerOptions(scene, { isSuspended: guard.isSuspended }));

      scene.input.emit(
        'pointerdown',
        fakePointer({ x: 100, y: 100, button: guard.button, camera: cam }),
        guard.currentlyOver,
      );
      scene.input.emit('pointermove', fakePointer({ x: 200, y: 100, camera: cam }));

      expect(cam.scrollX).toBe(startScrollX);
    }
  });

  it('un down sobre la camara del minimapa no arma pan en la camara principal, y el minimapa nunca se toca', async () => {
    const scene = await bootHostScene();
    const cam = scene.cameras.main;
    const minimap = scene.cameras.add(200, 0, 100, 100);
    const startScrollX = cam.scrollX;
    const minimapScrollX = minimap.scrollX;
    new CameraPanLayer(layerOptions(scene));

    scene.input.emit('pointerdown', fakePointer({ x: 250, y: 50, camera: minimap }), []);
    scene.input.emit('pointermove', fakePointer({ x: 280, y: 50, camera: minimap }));

    expect(cam.scrollX).toBe(startScrollX);
    expect(minimap.scrollX).toBe(minimapScrollX);
  });
});

describe('CameraPanLayer: destroy', () => {
  it('destroy() retira los listeners: eventos posteriores no hacen nada', async () => {
    const scene = await bootHostScene();
    const cam = scene.cameras.main;
    const startScrollX = cam.scrollX;
    const layer = new CameraPanLayer(layerOptions(scene));
    layer.destroy();

    scene.input.emit('pointerdown', fakePointer({ x: 100, y: 100, camera: cam }), []);
    scene.input.emit('pointermove', fakePointer({ x: 200, y: 100, camera: cam }));

    expect(cam.scrollX).toBe(startScrollX);
  });
});

describe('CameraPanLayer: a visible area larger than the region (#53, #179)', () => {
  it('centers a region smaller than the canvas and a drag cannot move it off center', async () => {
    const scene = await bootHostScene();
    const cam = scene.cameras.main;
    // 200x150 region in a 320x240 canvas: the visible area covers both axes.
    const region = { x: 0, y: 0, width: 200, height: 150 };
    new CameraPanLayer(layerOptions(scene, { region }));
    await nextFrame(scene);

    scene.input.emit('pointerdown', fakePointer({ x: 100, y: 100, camera: cam }), []);
    scene.input.emit('pointermove', fakePointer({ x: 160, y: 140, camera: cam }));
    await nextFrame(scene);

    expect(cam.midPoint.x).toBeCloseTo(region.width / 2, 0);
    expect(cam.midPoint.y).toBeCloseTo(region.height / 2, 0);

    scene.input.emit('pointerup', fakePointer({ x: 160, y: 140, camera: cam }));
  });

  it('keeps the same region bounds through drag, release and the return to follow', async () => {
    const scene = await bootHostScene();
    const cam = scene.cameras.main;
    const startFollow = vi.spyOn(cam, 'startFollow');
    new CameraPanLayer(layerOptions(scene));

    scene.input.emit('pointerdown', fakePointer({ x: 100, y: 100, camera: cam }), []);
    scene.input.emit('pointermove', fakePointer({ x: 300, y: 250, camera: cam }));
    await nextFrame(scene);
    expect(cam.getBounds()).toMatchObject(regionBounds(WORLD, cam, cam.zoom));
    scene.input.emit('pointerup', fakePointer({ x: 300, y: 250, camera: cam }));

    await nextFrame(scene);
    expect(cam.getBounds()).toMatchObject(regionBounds(WORLD, cam, cam.zoom));
    expect(startFollow).not.toHaveBeenCalled();
    scene.target.y += 32;
    renderFrames(scene);
    expect(startFollow).toHaveBeenCalledTimes(1);
    expect(cam.getBounds()).toMatchObject(regionBounds(WORLD, cam, cam.zoom));
    // Aterriza donde el seguimiento la habria dejado: el target centrado.
    expect(cam.midPoint.x).toBeCloseTo(scene.target.x, 0);
    expect(cam.midPoint.y).toBeCloseTo(scene.target.y, 0);
  });
});

describe('CameraPanLayer: the view never leaves the terrain region (#179)', () => {
  // Three 288 px blocks a side inside the 2000x2000 world, around the target (400, 300).
  const REGION = { x: 200, y: 100, width: 864, height: 864 };

  function expectViewInside(cam: Phaser.Cameras.Scene2D.Camera, region: typeof REGION): void {
    const view = cam.worldView;
    expect(view.x).toBeGreaterThanOrEqual(region.x - 0.5);
    expect(view.y).toBeGreaterThanOrEqual(region.y - 0.5);
    expect(view.right).toBeLessThanOrEqual(region.x + region.width + 0.5);
    expect(view.bottom).toBeLessThanOrEqual(region.y + region.height + 0.5);
  }

  it.each([
    { name: 'up-left', to: { x: 3000, y: 3000 }, edge: { x: REGION.x, y: REGION.y } },
    { name: 'down-right', to: { x: -3000, y: -3000 }, edge: { x: REGION.x + REGION.width - 320, y: REGION.y + REGION.height - 240 } },
  ])('a long drag $name stops at the region edge', async ({ to, edge }) => {
    const scene = await bootHostScene();
    const cam = scene.cameras.main;
    cam.startFollow(scene.target);
    new CameraPanLayer(layerOptions(scene, { region: REGION }));
    await nextFrame(scene);

    scene.input.emit('pointerdown', fakePointer({ x: 100, y: 100, camera: cam }), []);
    scene.input.emit('pointermove', fakePointer({ ...to, camera: cam }));
    await nextFrame(scene);

    expectViewInside(cam, REGION);
    expect(cam.worldView.x).toBeCloseTo(edge.x, 0);
    expect(cam.worldView.y).toBeCloseTo(edge.y, 0);
    scene.input.emit('pointerup', fakePointer({ ...to, camera: cam }));
  });

  it('a minimap click far in the void eases into the nearest region corner', async () => {
    const scene = await bootHostScene();
    const cam = scene.cameras.main;
    cam.startFollow(scene.target);
    const layer = new CameraPanLayer(layerOptions(scene, { region: REGION }));

    // A minimap point far past the region.
    layer.focus({ x: 1800, y: 1800 });
    const scrolls: number[] = [];
    for (let frame = 0; frame < 128; frame++) {
      await nextFrame(scene);
      expectViewInside(cam, REGION);
      scrolls.push(cam.scrollX);
    }

    expect(cam.worldView.right).toBeCloseTo(REGION.x + REGION.width, 0);
    expect(cam.worldView.bottom).toBeCloseTo(REGION.y + REGION.height, 0);
    // The glide aims at a reachable scroll: its last moving frame is a small
    // eased step, not a full-speed stop against the clamp.
    const steps = scrolls.slice(1).map((value, index) => value - scrolls[index]!).filter((step) => step !== 0);
    expect(Math.abs(steps.at(-1)!)).toBeLessThanOrEqual(1);
  });

  it('following a player near the region edge shows no more than the margin', async () => {
    const scene = await bootHostScene();
    const cam = scene.cameras.main;
    scene.target.setPosition(REGION.x + 10, REGION.y + 10);
    cam.startFollow(scene.target);
    new CameraPanLayer(layerOptions(scene, { region: REGION }));

    renderFrames(scene, 4);

    expect(cam.worldView.x).toBeCloseTo(REGION.x, 0);
    expect(cam.worldView.y).toBeCloseTo(REGION.y, 0);
  });

  it('setRegion with more terrain lets the same drag go further', async () => {
    const scene = await bootHostScene();
    const cam = scene.cameras.main;
    cam.startFollow(scene.target);
    const layer = new CameraPanLayer(layerOptions(scene, { region: REGION }));
    await nextFrame(scene);
    const drag = async (): Promise<void> => {
      scene.input.emit('pointerdown', fakePointer({ x: 100, y: 100, camera: cam }), []);
      scene.input.emit('pointermove', fakePointer({ x: 3000, y: 100, camera: cam }));
      await nextFrame(scene);
      scene.input.emit('pointerup', fakePointer({ x: 3000, y: 100, camera: cam }));
    };

    await drag();
    expect(cam.worldView.x).toBeCloseTo(REGION.x, 0);

    // A block painted in the left margin grows the region one block that way.
    layer.setRegion({ ...REGION, x: REGION.x - 288, width: REGION.width + 288 });
    await drag();
    expect(cam.worldView.x).toBeCloseTo(REGION.x - 288, 0);
  });
});

describe('CameraPanLayer: click en el minimapa (#98)', () => {
  async function addMinimap(scene: HostScene): Promise<Phaser.Cameras.Scene2D.Camera> {
    // 100x100 arriba a la derecha, viendo el mundo entero: su centro de
    // pantalla (250, 50) es el centro del mundo (1000, 1000).
    const minimap = scene.cameras.add(200, 0, 100, 100);
    minimap.setZoom(100 / WORLD.width);
    minimap.centerOn(WORLD.width / 2, WORLD.height / 2);
    // `getWorldPoint` lee la matriz que calcula el `preRender` del minimapa:
    // en la oficina real siempre hubo un render antes del primer clic.
    await nextFrame(scene);
    return minimap;
  }

  it('planea la camara principal hasta centrar el punto clicado y la deja ahi mientras el jugador no se mueve', async () => {
    const scene = await bootHostScene();
    const cam = scene.cameras.main;
    cam.startFollow(scene.target);
    const minimap = await addMinimap(scene);
    const minimapScrollX = minimap.scrollX;
    const layer = new CameraPanLayer(layerOptions(scene));

    layer.focus({ x: 1000, y: 1000 });
    // Planeo, no salto: el cuadro siguiente todavia no llego.
    await nextFrame(scene);
    expect(cam.midPoint.x).not.toBeCloseTo(1000, 0);

    renderFrames(scene);
    expect(cam.midPoint.x).toBeCloseTo(1000, 0);
    expect(cam.midPoint.y).toBeCloseTo(1000, 0);
    // Sigue ahi unos cuadros despues: el seguimiento no la reclamo.
    await nextFrame(scene);
    await nextFrame(scene);
    expect(cam.midPoint.x).toBeCloseTo(1000, 0);
    expect(minimap.scrollX).toBe(minimapScrollX);
  });

  it('resumes follow only after movement even when automatic RAF delivery is withheld', async () => {
    const scene = await bootHostScene();
    const cam = scene.cameras.main;
    const minimap = await addMinimap(scene);
    const startFollow = vi.spyOn(cam, 'startFollow');
    const layer = new CameraPanLayer(layerOptions(scene));

    layer.focus({ x: 1000, y: 1000 });
    renderFrames(scene);
    expect(cam.midPoint.x).toBeCloseTo(1000, 0);
    expect(cam.midPoint.y).toBeCloseTo(1000, 0);

    expect(scene.game.loop.running).toBe(false);
    const updates = vi.fn();
    const renders = vi.fn();
    scene.events.on(Phaser.Scenes.Events.UPDATE, updates);
    scene.game.events.on(Phaser.Core.Events.POST_RENDER, renders);
    const minimapScroll = { x: minimap.scrollX, y: minimap.scrollY };
    renderFrames(scene, 5);
    expect(startFollow).not.toHaveBeenCalled();
    expect(cam.midPoint.x).toBeCloseTo(1000, 0);
    scene.target.x += 32;

    // No update means no follow; one real frame starts a glide, not a jump.
    expect(startFollow).not.toHaveBeenCalled();
    await nextFrame(scene);
    expect(cam.midPoint.x).toBeLessThan(1000);
    expect(cam.midPoint.x).toBeGreaterThan(scene.target.x);
    expect(startFollow).not.toHaveBeenCalled();
    renderFrames(scene);
    expect(updates).toHaveBeenCalledTimes(134);
    expect(renders).toHaveBeenCalledTimes(134);
    expect(startFollow).toHaveBeenCalledTimes(1);
    expect(startFollow).toHaveBeenCalledWith(scene.target, true, 0.12, 0.12);
    expect(cam.midPoint.x).toBeCloseTo(scene.target.x, 0);
    expect(cam.midPoint.y).toBeCloseTo(scene.target.y, 0);
    expect(cam.getBounds()).toMatchObject(WORLD);
    expect({ x: minimap.scrollX, y: minimap.scrollY }).toEqual(minimapScroll);
  });

  it('a drag interrupts minimap glide and keeps its new focus until movement after release', async () => {
    const scene = await bootHostScene();
    const cam = scene.cameras.main;
    const startFollow = vi.spyOn(cam, 'startFollow');
    const layer = new CameraPanLayer(layerOptions(scene));

    layer.focus({ x: 1000, y: 1000 });
    await nextFrame(scene);
    scene.input.emit('pointerdown', fakePointer({ x: 100, y: 100, camera: cam }), []);
    scene.input.emit('pointermove', fakePointer({ x: 120, y: 90, camera: cam }));
    // Movement during the gesture must not use the stale minimap baseline.
    scene.target.x += 16;
    await nextFrame(scene);
    const dragged = { x: cam.scrollX, y: cam.scrollY };
    scene.input.emit('pointerup', fakePointer({ x: 120, y: 90, camera: cam }));
    for (let frame = 0; frame < 5; frame++) await nextFrame(scene);
    expect(cam.scrollX).toBeCloseTo(dragged.x);
    expect(cam.scrollY).toBeCloseTo(dragged.y);
    expect(startFollow).not.toHaveBeenCalled();

    scene.target.y += 32;
    renderFrames(scene);
    expect(startFollow).toHaveBeenCalledTimes(1);
  });

  it('editor de layout activo: el foco del minimapa no mueve la camara', async () => {
    const scene = await bootHostScene();
    const cam = scene.cameras.main;
    await nextFrame(scene);
    const startScrollX = cam.scrollX;
    const layer = new CameraPanLayer(layerOptions(scene, { isSuspended: () => true }));

    layer.focus({ x: 1000, y: 1000 });
    await nextFrame(scene);
    await nextFrame(scene);

    expect(cam.scrollX).toBe(startScrollX);
  });
});

describe('CameraPanLayer: owns the region bounds at every zoom (map-zoom)', () => {
  // 200x150 world in a 320x240 canvas at 0.5: the visible area (640x480) covers it.
  const SMALL = { x: 0, y: 0, width: 200, height: 150 };

  it('while following, replaces raw bounds with the region bounds: the region sits centered', async () => {
    const scene = await bootHostScene();
    const cam = scene.cameras.main;
    cam.setZoom(0.5);
    cam.setBounds(SMALL.x, SMALL.y, SMALL.width, SMALL.height);
    cam.startFollow(scene.target);
    new CameraPanLayer(layerOptions(scene, { region: SMALL }));

    await nextFrame(scene);

    expect(cam.getBounds()).toMatchObject(regionBounds(SMALL, cam, 0.5));
    expect(cam.scrollX + cam.width / 2).toBeCloseTo(SMALL.width / 2);
    expect(cam.scrollY + cam.height / 2).toBeCloseTo(SMALL.height / 2);
  });

  it('follows the new region bounds when the zoom changes under it', async () => {
    const scene = await bootHostScene();
    const cam = scene.cameras.main;
    cam.startFollow(scene.target);
    new CameraPanLayer(layerOptions(scene, { region: SMALL }));
    await nextFrame(scene);
    expect(cam.getBounds()).toMatchObject(regionBounds(SMALL, cam, 1));

    cam.setZoom(2);
    await nextFrame(scene);

    expect(cam.getBounds()).toMatchObject(regionBounds(SMALL, cam, 2));
  });

  it('after a drag at 0.5 the covered region stays centered and reattaches without a jump', async () => {
    const scene = await bootHostScene();
    const cam = scene.cameras.main;
    cam.setZoom(0.5);
    cam.startFollow(scene.target);
    const startFollow = vi.spyOn(cam, 'startFollow');
    new CameraPanLayer(layerOptions(scene, { region: SMALL }));
    await nextFrame(scene);

    scene.input.emit('pointerdown', fakePointer({ x: 100, y: 100, camera: cam }), []);
    scene.input.emit('pointermove', fakePointer({ x: 160, y: 140, camera: cam }));
    scene.input.emit('pointerup', fakePointer({ x: 160, y: 140, camera: cam }));
    await nextFrame(scene);
    scene.target.x += 32;

    // The visible area covers the region on both axes: the drag had nothing to move.
    const scrolls: number[] = [cam.scrollX];
    let reattachFrame = -1;
    for (let frame = 0; frame < 160; frame++) {
      await nextFrame(scene);
      scrolls.push(cam.scrollX);
      if (reattachFrame < 0 && startFollow.mock.calls.length > 0) reattachFrame = frame;
    }

    expect(reattachFrame).toBeGreaterThanOrEqual(0);
    // The frame that reattaches moves the camera by a glide step at most, never a clamp.
    expect(Math.abs(scrolls[reattachFrame + 1]! - scrolls[reattachFrame]!)).toBeLessThan(1);
    expect(cam.getBounds()).toMatchObject(regionBounds(SMALL, cam, 0.5));
    expect(cam.scrollX + cam.width / 2).toBeCloseTo(SMALL.width / 2, 0);
    expect(cam.scrollY + cam.height / 2).toBeCloseTo(SMALL.height / 2, 0);
  });

  it.each([
    { zoom: 0.5, expected: 200 },
    { zoom: 2, expected: 50 },
  ])('a 100 screen px drag at zoom $zoom scrolls $expected world px', async ({ zoom, expected }) => {
    const scene = await bootHostScene();
    const cam = scene.cameras.main;
    cam.setZoom(zoom);
    const startScrollX = cam.scrollX;
    new CameraPanLayer(layerOptions(scene));

    scene.input.emit('pointerdown', fakePointer({ x: 100, y: 100, camera: cam }), []);
    scene.input.emit('pointermove', fakePointer({ x: 200, y: 100, camera: cam }));

    expect(startScrollX - cam.scrollX).toBeCloseTo(expected);
  });
});
