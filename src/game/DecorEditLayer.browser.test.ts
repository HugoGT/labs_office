import Phaser from 'phaser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForSceneRunning } from '../test/phaserScene';
import { PAN_THRESHOLD_PX } from './cameraPan';
import {
  DECOR_BUTTON_PX,
  DECOR_DELETE_BUTTON_NAME,
  DECOR_DELETE_COLOR,
  DECOR_GHOST_ALPHA,
  DECOR_GHOST_NAME,
  DECOR_HOVER_NAME,
  DECOR_INVALID_COLOR,
  DECOR_MOVE_BUTTON_NAME,
  DECOR_SELECTION_COLOR,
  DECOR_SELECTION_NAME,
  DECOR_VALID_COLOR,
  DecorEditLayer,
  type DecorEditLayerDeps,
} from './DecorEditLayer';
import type { DecorBrush, DecorGround } from './decorEditor';
import { LAYOUT_GHOST_DEPTH } from './depthLayers';
import { TILE } from './mapData';
import { createOfficeBridge } from './officeBridge';
import type { DecorItem, DecorPieceInfo } from './officeDecor';

/**
 * `DecorEditLayer` (#208) draws a real Phaser ghost and turns real pointer
 * and key input into `decorpick` and `decorrotate`, so it runs in a real
 * game, on a bare host scene like `TerrainEditLayer.browser.test.ts`.
 */

const games: Phaser.Game[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const game of games.splice(0)) game.destroy(true);
  for (const host of hosts.splice(0)) host.remove();
});

const HOST_SCENE_KEY = 'decor-edit-layer-host';

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

function pointerAt(worldX: number, worldY: number, button = 0, distance = 0): Phaser.Input.Pointer {
  return { worldX, worldY, button, getDistance: () => distance } as unknown as Phaser.Input.Pointer;
}

/** A whole click as the scene's input reports it: the press, then the release on the same spot. */
function clickAt(scene: Phaser.Scene, worldX: number, worldY: number, button = 0, distance = 0): void {
  scene.input.emit('pointerdown', pointerAt(worldX, worldY, button));
  scene.input.emit('pointerup', pointerAt(worldX, worldY, button, distance));
}

/** The middle of tile (tx, ty) in world pixels. */
const mid = (t: number): number => t * TILE + TILE / 2;

const WIDTH = 20;
const HEIGHT = 15;
const at = (tx: number, ty: number): number => ty * WIDTH + tx;
const CHAIR: DecorPieceInfo = { kind: 'chair', footprint: { w: 1, h: 1 } };
const DESK: DecorPieceInfo = { kind: 'desk', footprint: { w: 3, h: 1 } };
const PLANT: DecorPieceInfo = { kind: 'plant', footprint: { w: 1, h: 1 } };
const chair: DecorBrush = { kind: 'piece', piece: 'chair-wood', info: CHAIR, rotation: 0 };
const desk: DecorBrush = { kind: 'piece', piece: 'desk-wood', info: DESK, rotation: 0 };
const plant: DecorBrush = { kind: 'piece', piece: 'plant-ficus', info: PLANT, rotation: 0 };
const MEETING: DecorPieceInfo = { kind: 'table', footprint: { w: 7, h: 5 } };
const OVAL: DecorPieceInfo = { kind: 'table', footprint: { w: 2, h: 1 } };
const meeting: DecorBrush = { kind: 'piece', piece: 'table-meeting', info: MEETING, rotation: 0 };
const oval: DecorBrush = { kind: 'piece', piece: 'table-oval', info: OVAL, rotation: 0 };

/** A lawn everywhere but column 0, water. */
const GROUND: DecorGround = {
  width: WIDTH,
  height: HEIGHT,
  walkable: Array.from({ length: WIDTH * HEIGHT }, (_, index) => index % WIDTH !== 0),
  wallTiles: Array.from({ length: WIDTH * HEIGHT }, () => false),
};

function layer(scene: Phaser.Scene, items: DecorItem[] = [], clock = { now: 1000 }) {
  const bridge = createOfficeBridge();
  const drawn: DecorItem[] = [];
  const deps: DecorEditLayerDeps = {
    now: () => clock.now,
    width: WIDTH,
    height: HEIGHT,
    items: () => items,
    infoOf: (piece) => (piece.startsWith('desk-') ? DESK : piece.startsWith('chair-') ? CHAIR : piece === 'table-meeting' ? MEETING : PLANT),
    ground: () => GROUND,
    drawPiece: (item) => {
      drawn.push(item);
      return [scene.add.rectangle(0, 0, 10, 10, 0xffffff)];
    },
  };
  const decorLayer = new DecorEditLayer(scene, bridge, deps);
  return { bridge, drawn, decorLayer };
}

function hover(scene: Phaser.Scene): Phaser.GameObjects.Rectangle | null {
  return scene.children.getByName(DECOR_HOVER_NAME) as Phaser.GameObjects.Rectangle | null;
}

function named<T extends Phaser.GameObjects.GameObject>(scene: Phaser.Scene, name: string): T | null {
  return scene.children.getByName(name) as T | null;
}

function ghosts(scene: Phaser.Scene): Phaser.GameObjects.GameObject[] {
  return scene.children.list.filter((child) => child.name === DECOR_GHOST_NAME);
}

/** A wheel event the way Phaser's input plugin reports it, `deltaY` positive when turned down. */
function wheel(scene: Phaser.Scene, deltaY: number): void {
  const pointer = { worldX: 0, worldY: 0, event: { deltaMode: 0, ctrlKey: false } } as unknown as Phaser.Input.Pointer;
  scene.input.emit('wheel', pointer, [], 0, deltaY, 0);
}

function key(init: KeyboardEventInit): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

describe('DecorEditLayer', () => {
  it('draws the picked piece as a translucent ghost on the tile under the pointer, its footprint outlined', async () => {
    const scene = await bootHostScene();
    const { bridge, drawn } = layer(scene);
    bridge.emitCommand('decoredit', { brush: desk, area: null });

    scene.input.emit('pointermove', pointerAt(5 * TILE + 3, 4 * TILE + 30));

    expect(drawn.at(-1)).toEqual({ index: at(5, 4), piece: 'desk-wood', rotation: 0 });
    const ghost = ghosts(scene) as Phaser.GameObjects.Rectangle[];
    expect(ghost).toHaveLength(1);
    expect(ghost[0]!.alpha).toBe(DECOR_GHOST_ALPHA);
    expect(ghost[0]!.depth).toBeGreaterThanOrEqual(LAYOUT_GHOST_DEPTH);
    // A desk table along a row, its anchor the middle tile: tiles 4..6 of row 4.
    const outline = hover(scene)!;
    expect([outline.x, outline.y, outline.width, outline.height]).toEqual([5.5 * TILE, 4.5 * TILE, 3 * TILE, TILE]);
    expect(outline.strokeColor).toBe(DECOR_VALID_COLOR);

    // Moving within the same tile draws nothing new; the next tile moves the ghost.
    scene.input.emit('pointermove', pointerAt(5 * TILE + 20, 4 * TILE + 2));
    expect(drawn).toHaveLength(1);
    scene.input.emit('pointermove', pointerAt(8 * TILE + 1, 4 * TILE + 1));
    expect(drawn.at(-1)?.index).toBe(at(8, 4));
    expect(ghosts(scene)).toHaveLength(1);
  });

  it('turns the outline red where the room would refuse it: water, another item, outside the desk', async () => {
    const scene = await bootHostScene();
    const { bridge } = layer(scene, [{ index: at(10, 10), piece: 'chair-metal', rotation: 0 }]);
    bridge.emitCommand('decoredit', { brush: desk, area: null });

    scene.input.emit('pointermove', pointerAt(1 * TILE + 5, 3 * TILE + 5));
    expect(hover(scene)!.strokeColor).toBe(DECOR_INVALID_COLOR);
    scene.input.emit('pointermove', pointerAt(11 * TILE + 5, 10 * TILE + 5));
    expect(hover(scene)!.strokeColor).toBe(DECOR_INVALID_COLOR);

    bridge.emitCommand('decoredit', { brush: chair, area: { x: 2, y: 2, w: 3, h: 3 } });
    scene.input.emit('pointermove', pointerAt(3 * TILE + 5, 3 * TILE + 5));
    expect(hover(scene)!.strokeColor).toBe(DECOR_VALID_COLOR);
    scene.input.emit('pointermove', pointerAt(6 * TILE + 5, 3 * TILE + 5));
    expect(hover(scene)!.strokeColor).toBe(DECOR_INVALID_COLOR);
  });

  it('turns the outline red where a fourth chair would stand on a desk of the command', async () => {
    const scene = await bootHostScene();
    const chairs = [at(2, 2), at(3, 2), at(4, 2)].map((index): DecorItem => ({ index, piece: 'chair-wood', rotation: 0 }));
    const { bridge } = layer(scene, chairs);
    bridge.emitCommand('decoredit', { brush: chair, area: null, desks: [{ x: 2, y: 2, w: 3, h: 3 }] });

    scene.input.emit('pointermove', pointerAt(3 * TILE + 5, 4 * TILE + 5));
    expect(hover(scene)!.strokeColor).toBe(DECOR_INVALID_COLOR);
    scene.input.emit('pointermove', pointerAt(8 * TILE + 5, 4 * TILE + 5));
    expect(hover(scene)!.strokeColor).toBe(DECOR_VALID_COLOR);
  });

  it('draws the ghost of a painted piece in its color, and outlines a vertical room table on its swapped footprint', async () => {
    const scene = await bootHostScene();
    const { bridge, drawn } = layer(scene);
    bridge.emitCommand('decoredit', { brush: { ...desk, piece: 'desk-painted', info: { ...DESK, colorable: true }, color: '#c83c3c' }, area: null });
    scene.input.emit('pointermove', pointerAt(5 * TILE + 5, 5 * TILE + 5));
    expect(drawn.at(-1)).toEqual({ index: at(5, 5), piece: 'desk-painted', rotation: 0, color: '#c83c3c' });

    bridge.emitCommand('decoredit', { brush: { ...meeting, rotation: 90 }, area: null });
    scene.input.emit('pointermove', pointerAt(10 * TILE + 5, 7 * TILE + 5));
    const outline = hover(scene)!;
    // 5x7 centered on (10, 7): tiles 8..12 by 4..10.
    expect([outline.x, outline.y, outline.width, outline.height]).toEqual([10.5 * TILE, 7.5 * TILE, 5 * TILE, 7 * TILE]);
    expect(drawn.at(-1)).toEqual({ index: at(10, 7), piece: 'table-meeting', rotation: 90 });
  });

  it('reports the clicked tile with a primary click while something is picked, and only then', async () => {
    const scene = await bootHostScene();
    const { bridge } = layer(scene);
    const picks: number[] = [];
    bridge.on('decorpick', ({ index }) => picks.push(index));

    scene.input.emit('pointerdown', pointerAt(2 * TILE + 1, 2 * TILE + 1));
    bridge.emitCommand('decoredit', { brush: null, area: null });
    scene.input.emit('pointerdown', pointerAt(2 * TILE + 1, 2 * TILE + 1));
    bridge.emitCommand('decoredit', { brush: chair, area: null });
    scene.input.emit('pointerdown', pointerAt(3 * TILE + 1, 2 * TILE + 1, 2));
    scene.input.emit('pointerdown', pointerAt(3 * TILE + 1, 2 * TILE + 1));
    scene.input.emit('pointerdown', pointerAt(-5, 2 * TILE));
    scene.input.emit('pointerdown', pointerAt(WIDTH * TILE + 5, 2 * TILE));

    expect(picks).toEqual([at(3, 2)]);
  });

  it('turns a picked chair, desk table or room table with R, back with Shift+R, never a plant nor while typing', async () => {
    const scene = await bootHostScene();
    const { bridge } = layer(scene);
    const steps: number[] = [];
    bridge.on('decorrotate', ({ step }) => steps.push(step));

    key({ key: 'r' });
    bridge.emitCommand('decoredit', { brush: chair, area: null });
    key({ key: 'r' });
    key({ key: 'R', shiftKey: true });
    key({ key: 'r', ctrlKey: true });
    key({ key: 'r', repeat: true });
    bridge.emitCommand('decoredit', { brush: plant, area: null });
    key({ key: 'r' });
    bridge.emitCommand('decoredit', { brush: oval, area: null });
    key({ key: 'r' });
    bridge.emitCommand('decoredit', { brush: desk, area: null });
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    key({ key: 'r' });
    input.remove();

    expect(steps).toEqual([1, -1, 1]);
  });

  it('turns a picked chair or desk table with the wheel, one quarter turn per notch, down forward and up back (#207)', async () => {
    const scene = await bootHostScene();
    const clock = { now: 1000 };
    const { bridge, decorLayer } = layer(scene, [], clock);
    const steps: number[] = [];
    bridge.on('decorrotate', ({ step }) => steps.push(step));
    const notch = (deltaY: number): void => {
      clock.now += 400;
      wheel(scene, deltaY);
    };

    notch(100);
    expect(decorLayer.holdsWheel()).toBe(false);
    bridge.emitCommand('decoredit', { brush: chair, area: null });
    expect(decorLayer.holdsWheel()).toBe(true);
    notch(100);
    notch(100);
    notch(-100);
    bridge.emitCommand('decoredit', { brush: desk, area: null });
    notch(-100);

    expect(steps).toEqual([1, 1, -1, -1]);
  });

  it('turns a picked room table with the wheel too, instead of zooming (#207, #208)', async () => {
    const scene = await bootHostScene();
    const clock = { now: 1000 };
    const { bridge, decorLayer } = layer(scene, [], clock);
    const steps: number[] = [];
    bridge.on('decorrotate', ({ step }) => steps.push(step));
    const notch = (deltaY: number): void => {
      clock.now += 400;
      wheel(scene, deltaY);
    };

    for (const table of [meeting, oval]) {
      bridge.emitCommand('decoredit', { brush: table, area: null });
      expect(decorLayer.holdsWheel(), table.piece).toBe(true);
      notch(100);
      notch(100);
    }

    expect(steps).toEqual([1, 1, 1, 1]);
  });

  it('a trackpad gesture turns the piece once, and the wheel stays the zoom\'s for plants and nothing picked', async () => {
    const scene = await bootHostScene();
    const clock = { now: 1000 };
    const { bridge, decorLayer } = layer(scene, [], clock);
    const rotate = vi.fn();
    bridge.on('decorrotate', rotate);

    bridge.emitCommand('decoredit', { brush: chair, area: null });
    for (let t = 0; t < 800; t += 16) {
      clock.now += 16;
      wheel(scene, 10);
    }
    expect(rotate).toHaveBeenCalledTimes(1);

    for (const brush of [plant, null]) {
      bridge.emitCommand('decoredit', { brush, area: null });
      expect(decorLayer.holdsWheel()).toBe(false);
      clock.now += 1000;
      wheel(scene, 100);
    }
    bridge.emitCommand('decoredit', null);
    expect(decorLayer.holdsWheel()).toBe(false);
    expect(rotate).toHaveBeenCalledTimes(1);
  });

  it('removes the ghost and its listeners when the editor closes or the layer goes', async () => {
    const scene = await bootHostScene();
    const { bridge, decorLayer } = layer(scene);
    const rotate = vi.fn();
    bridge.on('decorrotate', rotate);
    bridge.emitCommand('decoredit', { brush: chair, area: null });
    scene.input.emit('pointermove', pointerAt(3 * TILE + 1, 2 * TILE + 1));
    expect(ghosts(scene)).toHaveLength(1);

    bridge.emitCommand('decoredit', { brush: null, area: null });
    expect(ghosts(scene)).toHaveLength(0);
    expect(hover(scene)?.visible ?? false).toBe(false);

    bridge.emitCommand('decoredit', { brush: chair, area: null });
    scene.input.emit('pointermove', pointerAt(3 * TILE + 1, 2 * TILE + 1));
    decorLayer.destroy();
    expect(ghosts(scene)).toHaveLength(0);
    expect(hover(scene)).toBeNull();
    key({ key: 'r' });
    wheel(scene, 100);
    expect(rotate).not.toHaveBeenCalled();
  });

  describe('selecting a placed item with nothing picked (#208)', () => {
    // A 7x5 room table centered on (10, 7), tiles 7..13 by 5..9, a chair on (10, 9) at it, a plant on (3, 3).
    const placed: DecorItem[] = [
      { index: at(10, 7), piece: 'table-meeting', rotation: 0 },
      { index: at(10, 9), piece: 'chair-wood', rotation: 0 },
      { index: at(3, 3), piece: 'plant-ficus', rotation: 0 },
    ];

    function selections(bridge: ReturnType<typeof createOfficeBridge>): (number | null)[] {
      const seen: (number | null)[] = [];
      bridge.on('decorselect', ({ index }) => seen.push(index));
      return seen;
    }

    it('reports the item under a primary click (the smallest where they stack), and null for bare ground or off the map', async () => {
      const scene = await bootHostScene();
      const { bridge } = layer(scene, placed);
      const seen = selections(bridge);

      // The editor closed: the map is the office's.
      clickAt(scene, mid(3), mid(3));
      bridge.emitCommand('decoredit', { brush: null, area: null });
      clickAt(scene, mid(3), mid(3));
      clickAt(scene, mid(10), mid(9));
      clickAt(scene, mid(8), mid(6));
      clickAt(scene, mid(16), mid(12));
      clickAt(scene, -5, mid(2));

      expect(seen).toEqual([at(3, 3), at(10, 9), at(10, 7), null, null]);
    });

    it('in a desk area reports only items wholly inside it', async () => {
      const scene = await bootHostScene();
      const { bridge } = layer(scene, placed);
      const seen = selections(bridge);
      bridge.emitCommand('decoredit', { brush: null, area: { x: 9, y: 8, w: 3, h: 3 } });

      // The chair is inside the desk; the table it stands at reaches out of it.
      clickAt(scene, mid(10), mid(9));
      clickAt(scene, mid(9), mid(8));

      expect(seen).toEqual([at(10, 9), null]);
    });

    it('never selects while a piece is picked, on a drag, with another button, or on the release of a click that placed', async () => {
      const scene = await bootHostScene();
      const { bridge } = layer(scene, placed);
      const seen = selections(bridge);
      const picks: number[] = [];
      bridge.on('decorpick', ({ index }) => picks.push(index));

      bridge.emitCommand('decoredit', { brush: chair, area: null });
      clickAt(scene, mid(3), mid(3));
      expect(picks).toEqual([at(3, 3)]);
      // The click placed: the brush goes before its release arrives, which still selects nothing.
      scene.input.emit('pointerdown', pointerAt(mid(5), mid(5)));
      bridge.emitCommand('decoredit', { brush: null, area: null });
      scene.input.emit('pointerup', pointerAt(mid(5), mid(5)));

      clickAt(scene, mid(3), mid(3), 0, PAN_THRESHOLD_PX + 1);
      clickAt(scene, mid(3), mid(3), 2);

      expect(seen).toEqual([]);
    });

    it('outlines the selected item and draws a move button and a red trash button under it, a screen size at any zoom', async () => {
      const scene = await bootHostScene();
      const { bridge } = layer(scene, placed);
      bridge.emitCommand('decoredit', { brush: null, area: null, selected: at(10, 7) });

      const outline = named<Phaser.GameObjects.Rectangle>(scene, DECOR_SELECTION_NAME)!;
      expect([outline.x, outline.y, outline.width, outline.height]).toEqual([10.5 * TILE, 7.5 * TILE, 7 * TILE, 5 * TILE]);
      expect(outline.strokeColor).toBe(DECOR_SELECTION_COLOR);
      expect(outline.visible).toBe(true);

      const move = named<Phaser.GameObjects.Rectangle>(scene, DECOR_MOVE_BUTTON_NAME)!;
      const trash = named<Phaser.GameObjects.Rectangle>(scene, DECOR_DELETE_BUTTON_NAME)!;
      expect(trash.fillColor).toBe(DECOR_DELETE_COLOR);
      // Side by side under the footprint, centered on it: move left, trash right.
      expect(move.x).toBeLessThan(10.5 * TILE);
      expect(trash.x).toBeGreaterThan(10.5 * TILE);
      expect((move.x + trash.x) / 2).toBeCloseTo(10.5 * TILE);
      expect(move.getBounds().top).toBeGreaterThanOrEqual(10 * TILE);
      expect(move.getBounds().width).toBeCloseTo(DECOR_BUTTON_PX);
      expect(move.depth).toBeGreaterThan(LAYOUT_GHOST_DEPTH);

      // At 2x the buttons keep their size on screen: half of it in world pixels.
      scene.cameras.main.setZoom(2);
      scene.events.emit(Phaser.Scenes.Events.POST_UPDATE);
      expect(named<Phaser.GameObjects.Rectangle>(scene, DECOR_MOVE_BUTTON_NAME)!.getBounds().width).toBeCloseTo(DECOR_BUTTON_PX / 2);
    });

    it('a click on the move button asks to move the item, on the trash to delete it, and selects nothing under them', async () => {
      const scene = await bootHostScene();
      const { bridge } = layer(scene, placed);
      const seen = selections(bridge);
      const moves: number[] = [];
      const deletes: number[] = [];
      bridge.on('decormove', ({ index }) => moves.push(index));
      bridge.on('decordelete', ({ index }) => deletes.push(index));
      bridge.emitCommand('decoredit', { brush: null, area: null, selected: at(3, 3) });

      const move = named<Phaser.GameObjects.Rectangle>(scene, DECOR_MOVE_BUTTON_NAME)!;
      const trash = named<Phaser.GameObjects.Rectangle>(scene, DECOR_DELETE_BUTTON_NAME)!;
      clickAt(scene, move.x, move.y);
      clickAt(scene, trash.x, trash.y);

      expect(moves).toEqual([at(3, 3)]);
      expect(deletes).toEqual([at(3, 3)]);
      expect(seen).toEqual([]);
    });

    it('drops the outline and buttons once nothing is selected, a piece is picked, the item is gone or the editor closes', async () => {
      const scene = await bootHostScene();
      const items = [...placed];
      const { bridge, decorLayer } = layer(scene, items);
      const shown = (): boolean => named<Phaser.GameObjects.Rectangle>(scene, DECOR_SELECTION_NAME)?.visible === true &&
        named<Phaser.GameObjects.Rectangle>(scene, DECOR_MOVE_BUTTON_NAME)?.visible === true;

      bridge.emitCommand('decoredit', { brush: null, area: null, selected: at(3, 3) });
      expect(shown()).toBe(true);
      bridge.emitCommand('decoredit', { brush: null, area: null });
      expect(shown()).toBe(false);

      bridge.emitCommand('decoredit', { brush: null, area: null, selected: at(3, 3) });
      bridge.emitCommand('decoredit', { brush: chair, area: null, selected: at(3, 3) });
      expect(shown()).toBe(false);

      bridge.emitCommand('decoredit', { brush: null, area: null, selected: at(3, 3) });
      expect(shown()).toBe(true);
      items.splice(2, 1);
      decorLayer.refresh();
      expect(shown()).toBe(false);

      items.push(placed[2]!);
      decorLayer.refresh();
      expect(shown()).toBe(true);
      bridge.emitCommand('decoredit', null);
      expect(shown()).toBe(false);
      decorLayer.destroy();
      expect(named(scene, DECOR_SELECTION_NAME)).toBeNull();
      expect(named(scene, DECOR_MOVE_BUTTON_NAME)).toBeNull();
      expect(named(scene, DECOR_DELETE_BUTTON_NAME)).toBeNull();
    });
  });
});
