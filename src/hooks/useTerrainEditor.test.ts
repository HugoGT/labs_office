/**
 * The terrain editor's lifecycle (#123 phase 2, floor palette): what it asks
 * the map to show through `terrainedit`, how a picked floor turns map clicks
 * into block paints, and what it tells the admin.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminError } from '../dashboard/adminPort';
import type { TerrainAdminPort } from '../dashboard/terrainAdminPort';
import { createOfficeBridge, type OfficeCommandMap } from '../game/officeBridge';
import { SPAWN_BLOCK_INDEX } from '../game/mapData';
import { BASE_LAYOUT, withBlock, withTerrainColors, type LayoutMaterial, type TerrainColors } from '../game/officeLayout';
import type { TerrainBrush } from '../game/terrainEditor';
import { useTerrainEditor } from './useTerrainEditor';

const floor = (material: LayoutMaterial): TerrainBrush => ({ kind: 'floor', material });

const LAWN = 35;
const NO_COLORS: TerrainColors = new Map();
const OTHER = 36;

function port(overrides: Partial<TerrainAdminPort> = {}): TerrainAdminPort {
  return {
    setBlock: vi.fn(async () => undefined),
    setBlocks: vi.fn(async () => undefined),
    setWalls: vi.fn(async () => undefined),
    ...overrides,
  };
}

function setup(terrain: TerrainAdminPort = port()) {
  const bridge = createOfficeBridge();
  const commands: OfficeCommandMap['terrainedit'][] = [];
  bridge.onCommand('terrainedit', (command) => commands.push(command));
  const view = renderHook(() => useTerrainEditor({ bridge, terrain }));
  return { bridge, terrain, commands, ...view };
}

/** A deferred `setBlock`, resolved or rejected by the test. */
function deferredPort() {
  const calls: { index: number; material: string; color?: string; resolve: () => void; reject: (error: unknown) => void }[] = [];
  const terrain = port({
    setBlock: vi.fn(
      (index, material, color?: string) =>
        new Promise<void>((resolve, reject) => calls.push({ index, material, ...(color === undefined ? {} : { color }), resolve, reject })),
    ),
  });
  return { terrain, calls };
}

describe('useTerrainEditor', () => {
  it('starts closed and says nothing to the map', () => {
    const { result, commands } = setup();

    expect(result.current.active).toBe(false);
    expect(commands).toEqual([]);
  });

  it('opens with no floor picked, takes the live blocks the scene answers with, and closes the map overlay on exit', () => {
    const { bridge, result, commands } = setup();
    const watered = withBlock(BASE_LAYOUT.blocks, LAWN, 'water');
    bridge.onCommand('terrainedit', (command) => {
      if (command !== null) bridge.emit('terrain', { blocks: watered, walls: BASE_LAYOUT.walls, colors: NO_COLORS });
    });

    act(() => result.current.enter());

    expect(result.current.active).toBe(true);
    expect(result.current.brush).toBeNull();
    expect(commands.at(-1)).toEqual({ brush: null });
    expect(result.current.blocks[LAWN]).toBe('water');

    act(() => result.current.exit());
    expect(commands.at(-1)).toBeNull();
    expect(result.current.active).toBe(false);
  });

  it('picks a floor, unpicks it on a second pick or on demand, and tells the map', () => {
    const { result, commands } = setup();
    act(() => result.current.enter());

    act(() => result.current.pick('grass'));
    expect(result.current.brush).toEqual(floor('grass'));
    expect(commands.at(-1)).toEqual({ brush: floor('grass') });

    act(() => result.current.pick('sand'));
    expect(result.current.brush).toEqual(floor('sand'));
    act(() => result.current.pick('sand'));
    expect(result.current.brush).toBeNull();

    act(() => result.current.pick('void'));
    act(() => result.current.unpick());
    expect(result.current.brush).toBeNull();
    expect(commands.at(-1)).toEqual({ brush: null });
  });

  it('drops the picked floor on Escape', () => {
    const { result } = setup();
    act(() => result.current.enter());
    act(() => result.current.pick('grass'));

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(result.current.brush).toBeNull();
  });

  it('closes on Escape with nothing picked, so the admin can walk again, and says so through onExit', () => {
    const bridge = createOfficeBridge();
    const commands: OfficeCommandMap['terrainedit'][] = [];
    bridge.onCommand('terrainedit', (command) => commands.push(command));
    const onExit = vi.fn();
    const { result } = renderHook(() => useTerrainEditor({ bridge, terrain: port(), onExit }));
    act(() => result.current.enter());
    act(() => result.current.pick('grass'));

    const first = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    act(() => {
      window.dispatchEvent(first);
    });
    expect(result.current.active).toBe(true);
    expect(onExit).not.toHaveBeenCalled();

    const second = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    act(() => {
      window.dispatchEvent(second);
    });

    expect(result.current.active).toBe(false);
    expect(commands.at(-1)).toBeNull();
    expect(onExit).toHaveBeenCalledTimes(1);
    // Both presses are the editor's: the sidebar must not also close its panel on them.
    expect(first.defaultPrevented).toBe(true);
    expect(second.defaultPrevented).toBe(true);
  });

  it('leaves an Escape another control already handled alone', () => {
    const onExit = vi.fn();
    const { result } = renderHook(() => useTerrainEditor({ bridge: createOfficeBridge(), terrain: port(), onExit }));
    act(() => result.current.enter());
    const handled = (event: KeyboardEvent): void => event.preventDefault();
    window.addEventListener('keydown', handled, { capture: true });

    try {
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
      });
    } finally {
      window.removeEventListener('keydown', handled, { capture: true });
    }

    expect(result.current.active).toBe(true);
    expect(onExit).not.toHaveBeenCalled();
  });

  it('ignores map clicks while closed or with no floor picked', () => {
    const { bridge, result, terrain } = setup();

    act(() => bridge.emit('terrainpick', { index: LAWN }));
    act(() => result.current.enter());
    act(() => bridge.emit('terrainpick', { index: LAWN }));

    expect(terrain.setBlock).not.toHaveBeenCalled();
  });

  it('paints each clicked block with the picked floor, keeping it picked to paint many in a row', async () => {
    const { bridge, result, terrain } = setup();
    act(() => result.current.enter());
    act(() => result.current.pick('grass'));

    act(() => bridge.emit('terrainpick', { index: LAWN }));
    act(() => bridge.emit('terrainpick', { index: OTHER }));

    await waitFor(() => expect(terrain.setBlock).toHaveBeenCalledTimes(2));
    expect(vi.mocked(terrain.setBlock).mock.calls).toEqual([[LAWN, 'grass'], [OTHER, 'grass']]);
    expect(result.current.brush).toEqual(floor('grass'));
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.error).toBeNull();
  });

  it('sends one paint at a time, in click order, and draws the pending ones until the room shows them', async () => {
    const { terrain, calls } = deferredPort();
    const { bridge, result, commands } = setup(terrain);
    act(() => result.current.enter());
    act(() => result.current.pick('wood'));

    act(() => bridge.emit('terrainpick', { index: LAWN }));
    act(() => bridge.emit('terrainpick', { index: OTHER }));

    expect(calls.map((call) => call.index)).toEqual([LAWN]);
    expect(result.current.pending).toBe(true);
    expect(commands.at(-1)).toEqual({ brush: floor('wood'), previewBlocks: withBlock(withBlock(BASE_LAYOUT.blocks, LAWN, 'wood'), OTHER, 'wood') });

    await act(async () => calls[0]!.resolve());
    expect(calls.map((call) => call.index)).toEqual([LAWN, OTHER]);
    await act(async () => calls[1]!.resolve());
    await waitFor(() => expect(result.current.pending).toBe(false));
    // Saved but not shown yet by the room: still drawn.
    expect(commands.at(-1)?.previewBlocks).toBeDefined();

    act(() => bridge.emit('terrain', { blocks: withBlock(withBlock(BASE_LAYOUT.blocks, LAWN, 'wood'), OTHER, 'wood'), walls: BASE_LAYOUT.walls, colors: NO_COLORS }));
    expect(commands.at(-1)).toEqual({ brush: floor('wood') });
  });

  it('skips a click on a block that already has, or is about to have, the picked floor', async () => {
    const { terrain, calls } = deferredPort();
    const { bridge, result } = setup(terrain);
    act(() => result.current.enter());
    act(() => result.current.pick(BASE_LAYOUT.blocks[LAWN]!));
    act(() => bridge.emit('terrainpick', { index: LAWN }));
    expect(calls).toEqual([]);

    act(() => result.current.pick('sand'));
    act(() => bridge.emit('terrainpick', { index: LAWN }));
    act(() => bridge.emit('terrainpick', { index: LAWN }));
    expect(calls).toHaveLength(1);
  });

  it('keeps the central entrance block wood, saying why, without asking the server', () => {
    const { bridge, result, terrain } = setup();
    act(() => result.current.enter());
    act(() => result.current.pick('void'));

    act(() => bridge.emit('terrainpick', { index: SPAWN_BLOCK_INDEX }));

    expect(terrain.setBlock).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/entrada.*madera/);
  });

  it('shows why the server refused a paint, drops only that paint and goes on with the rest', async () => {
    const { terrain, calls } = deferredPort();
    const { bridge, result, commands } = setup(terrain);
    act(() => result.current.enter());
    act(() => result.current.pick('water'));
    act(() => bridge.emit('terrainpick', { index: LAWN }));
    act(() => bridge.emit('terrainpick', { index: OTHER }));

    await act(async () => calls[0]!.reject(new AdminError('terrain-under-placement')));

    expect(result.current.error).toMatch(/otro bloque/);
    expect(result.current.brush).toEqual(floor('water'));
    expect(calls.map((call) => call.index)).toEqual([LAWN, OTHER]);
    expect(commands.at(-1)).toEqual({ brush: floor('water'), previewBlocks: withBlock(BASE_LAYOUT.blocks, OTHER, 'water') });
    await act(async () => calls[1]!.resolve());
  });

  it('stops painting for good once authorization or configuration disappears', async () => {
    const { terrain, calls } = deferredPort();
    const { bridge, result, commands } = setup(terrain);
    act(() => result.current.enter());
    act(() => result.current.pick('grass'));
    act(() => bridge.emit('terrainpick', { index: LAWN }));
    act(() => bridge.emit('terrainpick', { index: OTHER }));

    await act(async () => calls[0]!.reject(new AdminError('forbidden')));
    act(() => bridge.emit('terrainpick', { index: 40 }));

    expect(result.current.blocked).toBe(true);
    expect(calls).toHaveLength(1);
    expect(commands.at(-1)).toEqual({ brush: floor('grass') });
    await waitFor(() => expect(result.current.pending).toBe(false));
  });

  it('closes the overlay when unmounted while open', () => {
    const { result, commands, unmount } = setup();
    act(() => result.current.enter());

    unmount();

    expect(commands.at(-1)).toBeNull();
  });

  describe('carpet color (#222)', () => {
    const RED = '#c0392b';
    const BLUE = '#3c6ac8';
    const carpet = (color?: string): TerrainBrush => ({ kind: 'floor', material: 'carpet', ...(color === undefined ? {} : { color }) });

    it('picks carpet in the color chosen so far, the default art until one is, and recolors the picked brush', () => {
      const { result, commands } = setup();
      act(() => result.current.enter());

      act(() => result.current.pick('carpet'));
      expect(result.current.brush).toEqual(carpet());

      act(() => result.current.setColor('carpet', RED));
      expect(result.current.colors).toEqual({ carpet: RED });
      expect(result.current.brush).toEqual(carpet(RED));
      expect(commands.at(-1)).toEqual({ brush: carpet(RED) });

      act(() => result.current.pick('grass'));
      act(() => result.current.setColor('carpet', BLUE));
      expect(result.current.brush).toEqual(floor('grass'));
      act(() => result.current.pick('carpet'));
      expect(result.current.brush).toEqual(carpet(BLUE));
      act(() => result.current.pick('carpet'));
      expect(result.current.brush).toBeNull();
    });

    it('sends the color with each carpet paint, skipping a block already that carpet but not one in another color', async () => {
      const { terrain, calls } = deferredPort();
      const { bridge, result } = setup(terrain);
      act(() => result.current.enter());
      const carpeted = withBlock(withBlock(BASE_LAYOUT.blocks, LAWN, 'carpet'), OTHER, 'carpet');
      act(() => bridge.emit('terrain', { blocks: carpeted, walls: BASE_LAYOUT.walls, colors: new Map([[LAWN, RED], [OTHER, BLUE]]) }));
      act(() => result.current.pick('carpet'));
      act(() => result.current.setColor('carpet', RED));

      act(() => bridge.emit('terrainpick', { index: LAWN }));
      act(() => bridge.emit('terrainpick', { index: OTHER }));
      act(() => bridge.emit('terrainpick', { index: OTHER }));

      expect(calls.map(({ index, material, color }) => ({ index, material, color }))).toEqual([{ index: OTHER, material: 'carpet', color: RED }]);
      await act(async () => calls[0]!.resolve());
    });

    it('repaints a colored carpet block in the default art, without a color', async () => {
      const { bridge, result, terrain } = setup();
      act(() => result.current.enter());
      act(() => bridge.emit('terrain', { blocks: withBlock(BASE_LAYOUT.blocks, LAWN, 'carpet'), walls: BASE_LAYOUT.walls, colors: new Map([[LAWN, RED]]) }));
      act(() => result.current.pick('carpet'));

      act(() => bridge.emit('terrainpick', { index: LAWN }));

      await waitFor(() => expect(terrain.setBlock).toHaveBeenCalledTimes(1));
      expect(vi.mocked(terrain.setBlock).mock.calls).toEqual([[LAWN, 'carpet']]);
    });

    it('draws the pending colors over the live ones, and another floor or the eraser clears a block color', async () => {
      const { terrain, calls } = deferredPort();
      const { bridge, result, commands } = setup(terrain);
      act(() => result.current.enter());
      const live = new Map([[OTHER, BLUE], [40, BLUE]]);
      const blocks = withBlock(withBlock(BASE_LAYOUT.blocks, OTHER, 'carpet'), 40, 'carpet');
      act(() => bridge.emit('terrain', { blocks, walls: BASE_LAYOUT.walls, colors: live }));
      act(() => result.current.pick('carpet'));
      act(() => result.current.setColor('carpet', RED));

      act(() => bridge.emit('terrainpick', { index: LAWN }));
      expect(commands.at(-1)).toEqual({ brush: carpet(RED), previewBlocks: withBlock(blocks, LAWN, 'carpet'), previewColors: new Map([...live, [LAWN, RED]]) });

      act(() => result.current.pick('grass'));
      act(() => bridge.emit('terrainpick', { index: OTHER }));
      act(() => result.current.pick('void'));
      act(() => bridge.emit('terrainpick', { index: 40 }));

      const painted = withBlock(withBlock(withBlock(blocks, LAWN, 'carpet'), OTHER, 'grass'), 40, 'void');
      expect(commands.at(-1)).toEqual({ brush: floor('void'), previewBlocks: painted, previewColors: new Map([[LAWN, RED]]) });
      expect(commands.at(-1)?.previewColors).toEqual(withTerrainColors(live, [{ index: LAWN, material: 'carpet', color: RED }, { index: OTHER, material: 'grass' }, { index: 40, material: 'void' }]));

      await act(async () => calls[0]!.resolve());
      await act(async () => calls[1]!.resolve());
      await act(async () => calls[2]!.resolve());
      expect(calls.map(({ index, material, color }) => ({ index, material, color }))).toEqual([
        { index: LAWN, material: 'carpet', color: RED },
        { index: OTHER, material: 'grass', color: undefined },
        { index: 40, material: 'void', color: undefined },
      ]);
    });

    it('leaves the other floors uncolored: a color choice never reaches their brush, paint or preview', async () => {
      const { bridge, result, terrain, commands } = setup();
      act(() => result.current.enter());
      act(() => result.current.setColor('carpet', RED));
      act(() => result.current.pick('tile'));

      act(() => bridge.emit('terrainpick', { index: LAWN }));

      await waitFor(() => expect(terrain.setBlock).toHaveBeenCalledTimes(1));
      expect(vi.mocked(terrain.setBlock).mock.calls).toEqual([[LAWN, 'tile']]);
      expect(result.current.brush).toEqual(floor('tile'));
      expect(commands.at(-1)).toEqual({ brush: floor('tile'), previewBlocks: withBlock(BASE_LAYOUT.blocks, LAWN, 'tile') });
    });
  });
});

describe('useTerrainEditor: uploaded floors (S13)', () => {
  const PIECE = 'floor-upload-0123456789abcdef';
  const OTHER_PIECE = 'floor-upload-fedcba9876543210';
  const uploaded = (floorId: string): TerrainBrush => ({ kind: 'floor', material: 'wood', floor: floorId });

  it('picks an uploaded floor as a wood brush carrying the piece, unpicks it on a second pick, and tells the map', () => {
    const { result, commands } = setup();
    act(() => result.current.enter());

    act(() => result.current.pickFloor(PIECE));
    expect(result.current.brush).toEqual(uploaded(PIECE));
    expect(commands.at(-1)).toEqual({ brush: uploaded(PIECE) });

    // The built-in wood and another upload are other brushes, not the same one toggled off.
    act(() => result.current.pick('wood'));
    expect(result.current.brush).toEqual(floor('wood'));
    act(() => result.current.pickFloor(PIECE));
    act(() => result.current.pickFloor(OTHER_PIECE));
    expect(result.current.brush).toEqual(uploaded(OTHER_PIECE));
    act(() => result.current.pickFloor(OTHER_PIECE));
    expect(result.current.brush).toBeNull();
  });

  it('sends the piece with each paint and previews the block as wood', async () => {
    const { bridge, result, terrain, commands } = setup();
    act(() => result.current.enter());
    act(() => result.current.pickFloor(PIECE));

    act(() => bridge.emit('terrainpick', { index: LAWN }));

    await waitFor(() => expect(terrain.setBlock).toHaveBeenCalledTimes(1));
    expect(vi.mocked(terrain.setBlock).mock.calls).toEqual([[LAWN, 'wood', undefined, PIECE]]);
    expect(commands.at(-1)).toEqual({ brush: uploaded(PIECE), previewBlocks: withBlock(BASE_LAYOUT.blocks, LAWN, 'wood') });
  });

  it('skips a block that already has the piece, but sends another piece and plain wood over it', async () => {
    const { bridge, result, terrain } = setup();
    act(() => result.current.enter());
    act(() => bridge.emit('terrain', { blocks: withBlock(BASE_LAYOUT.blocks, LAWN, 'wood'), walls: BASE_LAYOUT.walls, colors: NO_COLORS, floors: new Map([[LAWN, PIECE]]) }));

    act(() => result.current.pickFloor(PIECE));
    act(() => bridge.emit('terrainpick', { index: LAWN }));
    expect(terrain.setBlock).not.toHaveBeenCalled();

    act(() => result.current.pickFloor(OTHER_PIECE));
    act(() => bridge.emit('terrainpick', { index: LAWN }));
    act(() => result.current.pick('wood'));
    act(() => bridge.emit('terrainpick', { index: LAWN }));

    await waitFor(() => expect(terrain.setBlock).toHaveBeenCalledTimes(2));
    expect(vi.mocked(terrain.setBlock).mock.calls).toEqual([[LAWN, 'wood', undefined, OTHER_PIECE], [LAWN, 'wood']]);
  });

  it('does not skip an upload over the same wood without it, and paints over the central entrance block, which stays wood', async () => {
    const { bridge, result, terrain } = setup();
    act(() => result.current.enter());
    act(() => bridge.emit('terrain', { blocks: withBlock(BASE_LAYOUT.blocks, LAWN, 'wood'), walls: BASE_LAYOUT.walls, colors: NO_COLORS }));
    act(() => result.current.pickFloor(PIECE));

    act(() => bridge.emit('terrainpick', { index: LAWN }));
    act(() => bridge.emit('terrainpick', { index: SPAWN_BLOCK_INDEX }));

    await waitFor(() => expect(terrain.setBlock).toHaveBeenCalledTimes(2));
    expect(result.current.error).toBeNull();
    expect(vi.mocked(terrain.setBlock).mock.calls).toEqual([[LAWN, 'wood', undefined, PIECE], [SPAWN_BLOCK_INDEX, 'wood', undefined, PIECE]]);
  });
});

describe('useTerrainEditor: space outlines (#216)', () => {
  it('asks the map to outline every room and desk it was given while open, and to stop on exit', () => {
    const bridge = createOfficeBridge();
    const commands: OfficeCommandMap['terrainedit'][] = [];
    bridge.onCommand('terrainedit', (command) => commands.push(command));
    const outlines = [{ x0: 2, y0: 3, x1: 5, y1: 6 }, { x0: 20, y0: 5, x1: 28, y1: 13 }];
    const { result } = renderHook(() => useTerrainEditor({ bridge, terrain: port(), outlines }));

    act(() => result.current.enter());
    expect(commands.at(-1)).toEqual({ brush: null, outlines });

    act(() => result.current.pick('grass'));
    expect(commands.at(-1)).toMatchObject({ brush: floor('grass'), outlines });

    act(() => result.current.exit());
    expect(commands.at(-1)).toBeNull();
  });
});
