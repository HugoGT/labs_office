import Phaser from 'phaser';
import { afterEach, describe, expect, it } from 'vitest';
import { waitForSceneRunning } from '../test/phaserScene';
import { CollisionEditLayer } from './CollisionEditLayer';
import { createOfficeBridge, type OfficeEventMap } from './officeBridge';
import { deskInstances, layoutPropInstances, type CollisionInstance, type CollisionRect, type CollisionTable } from './pieceCollisions';

/**
 * `CollisionEditLayer` draws real Phaser graphics and turns real pointer
 * input into `collisionpick` and `collisiondraft`, so it runs in a real game,
 * on a bare host scene like `TerrainEditLayer.browser.test.ts`.
 */

const games: Phaser.Game[] = [];
const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const game of games.splice(0)) game.destroy(true);
  for (const host of hosts.splice(0)) host.remove();
});

const HOST_SCENE_KEY = 'collision-edit-layer-host';

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

function pointer(worldX: number, worldY: number, isDown = true): Phaser.Input.Pointer {
  return { worldX, worldY, isDown } as unknown as Phaser.Input.Pointer;
}

/** Two oak trees on tiles (2, 2) and (6, 2): anchors (80, 96) and (208, 96). A table elsewhere. */
const INSTANCES: CollisionInstance[] = [
  ...layoutPropInstances([
    { piece: 'tree-oak', kind: 'tree', tx: 2, ty: 2, w: 1, h: 1, collision: 'solid', facing: null },
    { piece: 'tree-oak', kind: 'tree', tx: 6, ty: 2, w: 1, h: 1, collision: 'solid', facing: null },
    { piece: 'table-meeting', kind: 'table', tx: 2, ty: 6, w: 3, h: 2, collision: 'solid', facing: null },
  ]),
  ...deskInstances([{ x: 320, y: 320, w: 96, h: 96, materialId: 'desk-oak', items: [] }]),
];

function boot(table: CollisionTable = new Map()) {
  return bootHostScene().then((scene) => {
    const bridge = createOfficeBridge();
    const live = { table };
    const layer = new CollisionEditLayer(scene, bridge, { instances: () => INSTANCES, table: () => live.table });
    const picks: OfficeEventMap['collisionpick'][] = [];
    const drafts: OfficeEventMap['collisiondraft'][] = [];
    bridge.on('collisionpick', (payload) => picks.push(payload));
    bridge.on('collisiondraft', (payload) => drafts.push(payload));
    return { scene, bridge, layer, picks, drafts, live };
  });
}

function editTree(bridge: ReturnType<typeof createOfficeBridge>, draft: CollisionRect[], selectedRect: number | null = null) {
  bridge.emitCommand('collisionedit', { pieceId: 'tree-oak', draft, selectedRect, snap: 1 });
}

describe('CollisionEditLayer', () => {
  it('draws nothing until the editor opens or the debug view is on', async () => {
    const { bridge, layer } = await boot();
    expect(layer.drawing.faint).toEqual([]);

    bridge.emitCommand('collisiondebug', { show: true });
    expect(layer.drawing.faint).toHaveLength(3);

    bridge.emitCommand('collisiondebug', { show: false });
    expect(layer.drawing.faint).toEqual([]);
  });

  it('picks the piece under a click and tells React its rectangles and defaults', async () => {
    const { scene, bridge, picks } = await boot();
    bridge.emitCommand('collisionedit', { pieceId: null, draft: [], selectedRect: null, snap: 1 });

    scene.input.emit('pointerdown', pointer(80, 80));
    scene.input.emit('pointerup', pointer(80, 80, false));

    expect(picks).toEqual([
      { pieceId: 'tree-oak', rects: [{ x: -16, y: -32, w: 32, h: 32 }], saved: false, defaults: [{ x: -16, y: -32, w: 32, h: 32 }] },
    ]);
  });

  it('draws the draft over every instance of the piece and the rest faintly', async () => {
    const { bridge, layer } = await boot();

    editTree(bridge, [{ x: -4, y: -8, w: 8, h: 8 }], 0);

    expect(layer.drawing.piece).toEqual([
      { x: 76, y: 88, w: 8, h: 8 },
      { x: 204, y: 88, w: 8, h: 8 },
    ]);
    expect(layer.drawing.faint).toEqual([{ x: 64, y: 192, w: 96, h: 64 }]);
    expect(layer.drawing.selected).toBeNull();
  });

  it('moves and resizes a rectangle of the picked instance, and reports the draft on release', async () => {
    const { scene, bridge, layer, drafts } = await boot();
    bridge.emitCommand('collisionedit', { pieceId: null, draft: [], selectedRect: null, snap: 1 });
    scene.input.emit('pointerdown', pointer(80, 80));
    scene.input.emit('pointerup', pointer(80, 80, false));
    editTree(bridge, [{ x: -4, y: -8, w: 8, h: 8 }], 0);
    expect(layer.drawing.selected).toEqual({ x: 76, y: 88, w: 8, h: 8 });

    // Drag the inside of the rectangle 3px right.
    scene.input.emit('pointerdown', pointer(80, 92));
    scene.input.emit('pointermove', pointer(83, 92));
    expect(layer.drawing.selected).toEqual({ x: 79, y: 88, w: 8, h: 8 });
    scene.input.emit('pointerup', pointer(83, 92, false));
    expect(drafts.at(-1)).toEqual({ rects: [{ x: -1, y: -8, w: 8, h: 8 }], selectedRect: 0 });

    // Then its bottom edge 4px down.
    editTree(bridge, drafts.at(-1)!.rects as CollisionRect[], 0);
    scene.input.emit('pointerdown', pointer(83, 96));
    scene.input.emit('pointermove', pointer(83, 100));
    scene.input.emit('pointerup', pointer(83, 100, false));
    expect(drafts.at(-1)).toEqual({ rects: [{ x: -1, y: -8, w: 8, h: 12 }], selectedRect: 0 });
  });

  it('draws a new rectangle by dragging outside the existing ones', async () => {
    const { scene, bridge, drafts } = await boot();
    bridge.emitCommand('collisionedit', { pieceId: null, draft: [], selectedRect: null, snap: 2 });
    scene.input.emit('pointerdown', pointer(80, 80));
    scene.input.emit('pointerup', pointer(80, 80, false));
    bridge.emitCommand('collisionedit', { pieceId: 'tree-oak', draft: [], selectedRect: null, snap: 2 });

    scene.input.emit('pointerdown', pointer(70, 70));
    scene.input.emit('pointermove', pointer(81, 90));
    scene.input.emit('pointerup', pointer(81, 90, false));

    // Anchor (80, 96): from (-10, -26) to (1, -6), snapped to 2px.
    expect(drafts.at(-1)).toEqual({ rects: [{ x: -10, y: -26, w: 12, h: 20 }], selectedRect: 0 });
  });

  it('ignores the map while closed', async () => {
    const { scene, picks, drafts } = await boot();

    scene.input.emit('pointerdown', pointer(80, 80));
    scene.input.emit('pointerup', pointer(80, 80, false));

    expect(picks).toEqual([]);
    expect(drafts).toEqual([]);
  });

  it('follows a live table change while open', async () => {
    const { bridge, layer, live } = await boot();
    bridge.emitCommand('collisionedit', { pieceId: null, draft: [], selectedRect: null, snap: 1 });
    expect(layer.drawing.faint).toHaveLength(3);

    live.table = new Map([['table-meeting', []]]);
    layer.refresh();

    expect(layer.drawing.faint).toHaveLength(2);
  });
});
