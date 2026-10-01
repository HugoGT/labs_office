/**
 * The terrain editor's lifecycle (#123 phase 2): what it asks the map to show
 * through `terrainedit`, how it follows the live blocks and map clicks, and
 * what it tells the admin after applying.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminError } from '../dashboard/adminPort';
import type { TerrainAdminPort } from '../dashboard/terrainAdminPort';
import { createOfficeBridge, type OfficeCommandMap } from '../game/officeBridge';
import { BASE_LAYOUT, withBlock } from '../game/officeLayout';
import { useTerrainEditor } from './useTerrainEditor';

const LAWN = 35;

function setup(terrain: TerrainAdminPort = { setBlock: vi.fn(async () => undefined) }) {
  const bridge = createOfficeBridge();
  const commands: OfficeCommandMap['terrainedit'][] = [];
  bridge.onCommand('terrainedit', (command) => commands.push(command));
  const view = renderHook(() => useTerrainEditor({ bridge, terrain }));
  return { bridge, terrain, commands, ...view };
}

describe('useTerrainEditor', () => {
  it('starts closed and says nothing to the map', () => {
    const { result, commands } = setup();

    expect(result.current.active).toBe(false);
    expect(commands).toEqual([]);
  });

  it('opens with nothing selected, takes the live blocks the scene answers with, and closes the map overlay on exit', () => {
    const { bridge, result, commands } = setup();
    const watered = withBlock(BASE_LAYOUT.blocks, LAWN, 'water');
    bridge.onCommand('terrainedit', (command) => {
      if (command !== null) bridge.emit('terrain', { blocks: watered });
    });

    act(() => result.current.enter());

    expect(result.current.active).toBe(true);
    expect(commands.at(-1)).toEqual({ selected: null, preview: null });
    expect(result.current.blocks[LAWN]).toBe('water');

    act(() => result.current.exit());
    expect(commands.at(-1)).toBeNull();
    expect(result.current.active).toBe(false);
  });

  it('selects the block clicked on the map or typed by column and row, only while open', () => {
    const { bridge, result, commands } = setup();

    act(() => bridge.emit('terrainpick', { index: 3 }));
    expect(result.current.selected).toBeNull();

    act(() => result.current.enter());
    act(() => bridge.emit('terrainpick', { index: LAWN }));
    expect(result.current.selected).toBe(LAWN);
    expect(commands.at(-1)).toEqual({ selected: LAWN, preview: null });

    act(() => result.current.selectAt(2, 1));
    expect(result.current.selected).toBe(1);
    act(() => result.current.selectAt(15, 1));
    expect(result.current.selected).toBe(1);
  });

  it('previews the chosen material on the selected block, and not when it is what the block already has', () => {
    const { bridge, result, commands } = setup();
    act(() => result.current.enter());
    act(() => bridge.emit('terrainpick', { index: LAWN }));

    act(() => result.current.choose('water'));
    expect(commands.at(-1)).toEqual({ selected: LAWN, preview: { index: LAWN, material: 'water' } });

    act(() => result.current.choose('grass'));
    expect(commands.at(-1)).toEqual({ selected: LAWN, preview: null });

    act(() => result.current.choose('sand'));
    act(() => bridge.emit('terrainpick', { index: 0 }));
    expect(commands.at(-1)).toEqual({ selected: 0, preview: { index: 0, material: 'sand' } });
    act(() => result.current.discard());
    expect(commands.at(-1)).toEqual({ selected: 0, preview: null });
  });

  it('applies through the port and lets the preview go once the room shows the edit', async () => {
    const { bridge, terrain, result, commands } = setup();
    act(() => result.current.enter());
    act(() => bridge.emit('terrainpick', { index: LAWN }));
    act(() => result.current.choose('water'));

    await act(() => result.current.apply());

    expect(terrain.setBlock).toHaveBeenCalledWith(LAWN, 'water');
    expect(result.current.notice).toBe('Bloque actualizado.');
    expect(result.current.error).toBeNull();

    act(() => bridge.emit('terrain', { blocks: withBlock(BASE_LAYOUT.blocks, LAWN, 'water') }));
    expect(commands.at(-1)).toEqual({ selected: LAWN, preview: null });
  });

  it('shows why the server refused, keeping the choice on screen', async () => {
    const setBlock = vi.fn(async () => {
      throw new AdminError('terrain-under-player');
    });
    const { bridge, result } = setup({ setBlock });
    act(() => result.current.enter());
    act(() => bridge.emit('terrainpick', { index: LAWN }));
    act(() => result.current.choose('water'));

    await act(() => result.current.apply());

    expect(result.current.error).toMatch(/alguien/);
    expect(result.current.notice).toBeNull();
    expect(result.current.material).toBe('water');
  });

  it('reports busy while applying and ignores a second apply meanwhile', async () => {
    let finish!: () => void;
    const setBlock = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const { bridge, result } = setup({ setBlock });
    act(() => result.current.enter());
    act(() => bridge.emit('terrainpick', { index: LAWN }));
    act(() => result.current.choose('sand'));

    let first!: Promise<void>;
    act(() => {
      first = result.current.apply();
    });
    expect(result.current.pending).toBe(true);
    await act(() => result.current.apply());
    expect(setBlock).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish();
      await first;
    });
    await waitFor(() => expect(result.current.pending).toBe(false));
  });

  it('closes the overlay when unmounted while open', () => {
    const { result, commands, unmount } = setup();
    act(() => result.current.enter());

    unmount();

    expect(commands.at(-1)).toBeNull();
  });
});
