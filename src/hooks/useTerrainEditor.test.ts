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
import { BASE_LAYOUT, withBlock } from '../game/officeLayout';
import { useTerrainEditor } from './useTerrainEditor';

const LAWN = 35;
const OTHER = 36;

function port(overrides: Partial<TerrainAdminPort> = {}): TerrainAdminPort {
  return { setBlock: vi.fn(async () => undefined), setBlocks: vi.fn(async () => undefined), ...overrides };
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
  const calls: { index: number; material: string; resolve: () => void; reject: (error: unknown) => void }[] = [];
  const terrain = port({
    setBlock: vi.fn((index, material) => new Promise<void>((resolve, reject) => calls.push({ index, material, resolve, reject }))),
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
      if (command !== null) bridge.emit('terrain', { blocks: watered });
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
    expect(result.current.brush).toBe('grass');
    expect(commands.at(-1)).toEqual({ brush: 'grass' });

    act(() => result.current.pick('sand'));
    expect(result.current.brush).toBe('sand');
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
    expect(result.current.brush).toBe('grass');
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
    expect(commands.at(-1)).toEqual({ brush: 'wood', previewBlocks: withBlock(withBlock(BASE_LAYOUT.blocks, LAWN, 'wood'), OTHER, 'wood') });

    await act(async () => calls[0]!.resolve());
    expect(calls.map((call) => call.index)).toEqual([LAWN, OTHER]);
    await act(async () => calls[1]!.resolve());
    await waitFor(() => expect(result.current.pending).toBe(false));
    // Saved but not shown yet by the room: still drawn.
    expect(commands.at(-1)?.previewBlocks).toBeDefined();

    act(() => bridge.emit('terrain', { blocks: withBlock(withBlock(BASE_LAYOUT.blocks, LAWN, 'wood'), OTHER, 'wood') }));
    expect(commands.at(-1)).toEqual({ brush: 'wood' });
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
    expect(result.current.brush).toBe('water');
    expect(calls.map((call) => call.index)).toEqual([LAWN, OTHER]);
    expect(commands.at(-1)).toEqual({ brush: 'water', previewBlocks: withBlock(BASE_LAYOUT.blocks, OTHER, 'water') });
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
    expect(commands.at(-1)).toEqual({ brush: 'grass' });
    await waitFor(() => expect(result.current.pending).toBe(false));
  });

  it('closes the overlay when unmounted while open', () => {
    const { result, commands, unmount } = setup();
    act(() => result.current.enter());

    unmount();

    expect(commands.at(-1)).toBeNull();
  });
});
