/**
 * The collision editor's lifecycle: what it asks the map to show through
 * `collisionedit`, how it follows map picks and drags, and what it saves.
 */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminError } from '../dashboard/adminPort';
import type { CollisionAdminPort } from '../dashboard/collisionAdminPort';
import { createOfficeBridge, type OfficeCommandMap } from '../game/officeBridge';
import { MAX_COLLISION_RECTS } from '../game/pieceCollisions';
import { useCollisionEditor } from './useCollisionEditor';

const FOOTPRINT = [{ x: -16, y: -32, w: 32, h: 32 }];

function port(): CollisionAdminPort {
  return { saveRects: vi.fn(async () => undefined), reset: vi.fn(async () => undefined) };
}

function setup(collisions: CollisionAdminPort = port()) {
  const bridge = createOfficeBridge();
  const commands: OfficeCommandMap['collisionedit'][] = [];
  const debug: OfficeCommandMap['collisiondebug'][] = [];
  bridge.onCommand('collisionedit', (command) => commands.push(command));
  bridge.onCommand('collisiondebug', (command) => debug.push(command));
  const view = renderHook(() => useCollisionEditor({ bridge, collisions }));
  return { bridge, collisions, commands, debug, ...view };
}

function pickTree(bridge: ReturnType<typeof createOfficeBridge>, saved = false) {
  act(() => bridge.emit('collisionpick', { pieceId: 'tree-oak', rects: FOOTPRINT, saved, defaults: FOOTPRINT }));
}

describe('useCollisionEditor', () => {
  it('starts closed and says nothing to the map', () => {
    const { result, commands } = setup();

    expect(result.current.active).toBe(false);
    expect(commands).toEqual([]);
  });

  it('opens with no piece, follows a pick only while open, and closes the overlay on exit', () => {
    const { bridge, result, commands } = setup();
    pickTree(bridge);
    expect(result.current.pieceId).toBeNull();

    act(() => result.current.enter());
    expect(commands.at(-1)).toEqual({ pieceId: null, draft: [], selectedRect: null, snap: 1 });
    pickTree(bridge);

    expect(result.current.pieceId).toBe('tree-oak');
    expect(result.current.rects).toEqual(FOOTPRINT);
    expect(result.current.saved).toBe(false);
    expect(result.current.dirty).toBe(false);
    expect(commands.at(-1)).toEqual({ pieceId: 'tree-oak', draft: FOOTPRINT, selectedRect: null, snap: 1 });

    act(() => result.current.exit());
    expect(commands.at(-1)).toBeNull();
    expect(result.current.pieceId).toBeNull();
  });

  it('takes the drafts the map reports and edits rectangles by hand', () => {
    const { bridge, result, commands } = setup();
    act(() => result.current.enter());
    pickTree(bridge);

    act(() => bridge.emit('collisiondraft', { rects: [{ x: -4, y: -8, w: 8, h: 8 }], selectedRect: 0 }));
    expect(result.current.rects).toEqual([{ x: -4, y: -8, w: 8, h: 8 }]);
    expect(result.current.selectedRect).toBe(0);
    expect(result.current.dirty).toBe(true);

    act(() => result.current.updateRect(0, 'w', 12));
    act(() => result.current.addRect());
    expect(result.current.rects).toEqual([
      { x: -4, y: -8, w: 12, h: 8 },
      { x: 4, y: 0, w: 16, h: 16 },
    ]);
    expect(result.current.selectedRect).toBe(1);

    act(() => result.current.deleteRect(0));
    expect(result.current.rects).toEqual([{ x: 4, y: 0, w: 16, h: 16 }]);
    expect(result.current.selectedRect).toBeNull();

    act(() => result.current.setSnap(2));
    expect(commands.at(-1)).toEqual({ pieceId: 'tree-oak', draft: [{ x: 4, y: 0, w: 16, h: 16 }], selectedRect: null, snap: 2 });
  });

  it('ignores a hand edit that the server would refuse, and stops adding at the cap', () => {
    const { bridge, result } = setup();
    act(() => result.current.enter());
    pickTree(bridge);

    act(() => result.current.updateRect(0, 'w', 0));
    act(() => result.current.updateRect(0, 'x', Number.NaN));
    expect(result.current.rects).toEqual(FOOTPRINT);

    for (let i = 0; i < MAX_COLLISION_RECTS + 2; i += 1) act(() => result.current.addRect());
    expect(result.current.rects).toHaveLength(MAX_COLLISION_RECTS);
  });

  it('saves the draft and keeps it as the new baseline', async () => {
    const { bridge, result, collisions } = setup();
    act(() => result.current.enter());
    pickTree(bridge);
    act(() => bridge.emit('collisiondraft', { rects: [], selectedRect: null }));

    await act(() => result.current.save());

    expect(collisions.saveRects).toHaveBeenCalledWith('tree-oak', []);
    expect(result.current.notice).toBe('Colisión guardada.');
    expect(result.current.saved).toBe(true);
    expect(result.current.dirty).toBe(false);
  });

  it('cancels back to the baseline, and restores the default through the server', async () => {
    const { bridge, result, collisions } = setup();
    act(() => result.current.enter());
    act(() => bridge.emit('collisionpick', { pieceId: 'tree-oak', rects: [], saved: true, defaults: FOOTPRINT }));
    act(() => bridge.emit('collisiondraft', { rects: [{ x: 0, y: 0, w: 4, h: 4 }], selectedRect: 0 }));

    act(() => result.current.cancel());
    expect(result.current.rects).toEqual([]);
    expect(result.current.selectedRect).toBeNull();

    await act(() => result.current.restoreDefault());
    expect(collisions.reset).toHaveBeenCalledWith('tree-oak');
    expect(result.current.rects).toEqual(FOOTPRINT);
    expect(result.current.saved).toBe(false);
    expect(result.current.notice).toBe('Colisión restablecida.');
  });

  it('shows why a save was refused and keeps the draft', async () => {
    const collisions = port();
    vi.mocked(collisions.saveRects).mockRejectedValueOnce(new AdminError('collision-under-player'));
    const { bridge, result } = setup(collisions);
    act(() => result.current.enter());
    pickTree(bridge);
    act(() => bridge.emit('collisiondraft', { rects: [], selectedRect: null }));

    await act(() => result.current.save());

    expect(result.current.error).toMatch(/alguien/);
    expect(result.current.rects).toEqual([]);
    expect(result.current.dirty).toBe(true);
  });

  it('turns the debug outlines on and off, open or not', () => {
    const { result, debug } = setup();

    act(() => result.current.setShowAll(true));
    expect(result.current.showAll).toBe(true);
    act(() => result.current.setShowAll(false));

    expect(debug).toEqual([{ show: true }, { show: false }]);
  });

  it('turns the debug outlines off when the section goes away', () => {
    const { result, debug, unmount } = setup();
    act(() => result.current.setShowAll(true));

    unmount();

    expect(debug).toEqual([{ show: true }, { show: false }]);
  });
});
