/**
 * The decor editor's lifecycle (#208): what it asks the map to show through
 * `decoredit`, how a picked piece or the eraser turns map clicks into decor
 * edits, how "Mi espacio" keeps them inside the desk, and what it says.
 */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminError } from '../dashboard/adminPort';
import { createOfficeBridge, type OfficeCommandMap } from '../game/officeBridge';
import { MAX_DECOR_EDITS, type DecorEdit, type DecorItem, type DecorPieceInfo, type DecorTileRect } from '../game/officeDecor';
import type { OfficeDecorPort } from '../game/officeDecorPort';
import { DECOR_AREA_MESSAGE, DECOR_UNDER_PLACEMENT_MESSAGE, useDecorEditor, type DecorPick } from './useDecorEditor';

const WIDTH = 189;
const at = (tx: number, ty: number): number => ty * WIDTH + tx;

const CHAIR: DecorPick = { id: 'chair-gamer', info: { kind: 'chair', footprint: { w: 1, h: 1 } } };
const DESK: DecorPick = { id: 'desk-wood', info: { kind: 'desk', footprint: { w: 3, h: 1 } } };
const PLANT: DecorPick = { id: 'plant-ficus', info: { kind: 'plant', footprint: { w: 1, h: 1 } } };
const TABLE: DecorPick = { id: 'table-meeting', info: { kind: 'table', footprint: { w: 7, h: 5 } } };
const PICKS = [CHAIR, DESK, PLANT, TABLE];
const infoOf = (piece: string): DecorPieceInfo | null => PICKS.find((pick) => pick.id === piece)?.info ?? null;

/** A deferred `setDecor`, resolved or rejected by the test. */
function deferredPort() {
  const calls: { edits: DecorEdit[]; resolve: () => void; reject: (error: unknown) => void }[] = [];
  const decor: OfficeDecorPort = {
    setDecor: vi.fn((edits: readonly DecorEdit[]) => new Promise<void>((resolve, reject) => calls.push({ edits: [...edits], resolve, reject }))),
  };
  return { decor, calls };
}

function setup({ decor = deferredPort().decor, area = null, onExit }: { decor?: OfficeDecorPort; area?: DecorTileRect | null; onExit?: () => void } = {}) {
  const bridge = createOfficeBridge();
  const commands: OfficeCommandMap['decoredit'][] = [];
  bridge.onCommand('decoredit', (command) => commands.push(command));
  const view = renderHook((props: { area: DecorTileRect | null }) => useDecorEditor({ bridge, decor, area: props.area, infoOf, onExit }), {
    initialProps: { area },
  });
  return { bridge, decor, commands, ...view };
}

function escape(): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true });
  act(() => {
    document.body.dispatchEvent(event);
  });
  return event;
}

describe('useDecorEditor', () => {
  it('starts closed, opens with nothing picked over the area it may act on, and closes the map overlay on exit', () => {
    const { result, commands } = setup({ area: { x: 3, y: 4, w: 3, h: 3 } });
    expect(result.current.active).toBe(false);
    expect(commands).toEqual([]);

    act(() => result.current.enter());
    expect(commands.at(-1)).toEqual({ brush: null, area: { x: 3, y: 4, w: 3, h: 3 } });

    act(() => result.current.exit());
    expect(commands.at(-1)).toBeNull();
  });

  it('takes the live layer from the scene', () => {
    const { bridge, result } = setup();
    const items: DecorItem[] = [{ index: 5, piece: 'chair-gamer', rotation: 90 }];
    act(() => bridge.emit('decor', { items }));
    expect(result.current.items).toEqual(items);
  });

  it('picks a piece or the eraser, one at a time, unpicks on a second pick or on demand, and tells the map', () => {
    const { result, commands } = setup();
    act(() => result.current.enter());

    act(() => result.current.pick(CHAIR));
    expect(result.current.brush).toEqual({ kind: 'piece', piece: 'chair-gamer', info: CHAIR.info, rotation: 0 });
    expect(commands.at(-1)).toEqual({ brush: result.current.brush, area: null });
    act(() => result.current.pick(CHAIR));
    expect(result.current.brush).toBeNull();

    act(() => result.current.pickEraser());
    expect(result.current.brush).toEqual({ kind: 'eraser' });
    act(() => result.current.pick(DESK));
    expect(result.current.brush).toMatchObject({ piece: 'desk-wood' });
    act(() => result.current.unpick());
    expect(result.current.brush).toBeNull();
    expect(commands.at(-1)).toEqual({ brush: null, area: null });
  });

  it('turns the rotation down, left, up, right with «Girar» or the map, keeps it for the next pick, and never turns a plant or a room table', () => {
    const { bridge, result } = setup();
    act(() => result.current.enter());
    act(() => result.current.pick(CHAIR));

    act(() => result.current.rotate());
    expect(result.current.rotation).toBe(270);
    expect(result.current.brush).toMatchObject({ rotation: 270 });
    act(() => bridge.emit('decorrotate', { step: 1 }));
    expect(result.current.brush).toMatchObject({ rotation: 180 });
    act(() => bridge.emit('decorrotate', { step: -1 }));
    expect(result.current.brush).toMatchObject({ rotation: 270 });

    act(() => result.current.pick(DESK));
    expect(result.current.brush).toMatchObject({ piece: 'desk-wood', rotation: 270 });

    act(() => result.current.pick(PLANT));
    expect(result.current.brush).toMatchObject({ piece: 'plant-ficus', rotation: 0 });
    act(() => result.current.rotate());
    expect(result.current.brush).toMatchObject({ rotation: 0 });
    act(() => result.current.pick(TABLE));
    expect(result.current.brush).toMatchObject({ rotation: 0 });
    // The rotation itself still turned, for the next chair or desk table.
    expect(result.current.rotation).toBe(180);
  });

  it('with «Múltiple» off (the default) one click places one piece and unpicks the brush, so the rail comes back (#207)', async () => {
    const { decor, calls } = deferredPort();
    const { bridge, result, commands } = setup({ decor });
    act(() => result.current.enter());
    expect(result.current.multiple).toBe(false);

    act(() => result.current.pick(CHAIR));
    act(() => bridge.emit('decorpick', { index: at(5, 5) }));
    expect(result.current.brush).toBeNull();
    expect(commands.at(-1)).toMatchObject({ brush: null });
    act(() => bridge.emit('decorpick', { index: at(6, 5) }));
    expect(calls.map((call) => call.edits)).toEqual([[{ index: at(5, 5), item: { piece: 'chair-gamer', rotation: 0 } }]]);

    // The eraser too; a click that removes nothing keeps it picked.
    act(() => bridge.emit('decor', { items: [{ index: at(9, 9), piece: 'plant-ficus', rotation: 0 }] }));
    act(() => result.current.pickEraser());
    act(() => bridge.emit('decorpick', { index: at(20, 20) }));
    expect(result.current.brush).toEqual({ kind: 'eraser' });
    act(() => bridge.emit('decorpick', { index: at(9, 9) }));
    expect(result.current.brush).toBeNull();
    await act(async () => calls[0]!.resolve());
    expect(calls[1]!.edits).toEqual([{ index: at(9, 9), item: null }]);
  });

  it('with «Múltiple» on the brush stays picked click after click, until Escape; turning it off again keeps the editor as it is', () => {
    const { bridge, result } = setup();
    act(() => result.current.enter());
    act(() => result.current.setMultiple(true));
    act(() => result.current.pick(CHAIR));

    act(() => bridge.emit('decorpick', { index: at(5, 5) }));
    act(() => bridge.emit('decorpick', { index: at(6, 5) }));
    expect(result.current.brush).toMatchObject({ piece: 'chair-gamer' });

    escape();
    expect(result.current.brush).toBeNull();
    expect(result.current.multiple).toBe(true);
    // A preference, not a tool: leaving and coming back keeps it.
    act(() => result.current.exit());
    act(() => result.current.enter());
    expect(result.current.multiple).toBe(true);
    act(() => result.current.setMultiple(false));
    expect(result.current.multiple).toBe(false);
  });

  it('places the picked piece on every clicked tile, sending the clicks queued meanwhile as one request, and draws them until the room shows them', async () => {
    const { decor, calls } = deferredPort();
    const { bridge, result, commands } = setup({ decor });
    act(() => result.current.enter());
    act(() => result.current.setMultiple(true));
    act(() => bridge.emit('decorpick', { index: at(5, 5) }));
    expect(decor.setDecor).not.toHaveBeenCalled();

    act(() => result.current.pick(CHAIR));
    act(() => bridge.emit('decorpick', { index: at(5, 5) }));
    act(() => bridge.emit('decorpick', { index: at(6, 5) }));
    act(() => bridge.emit('decorpick', { index: at(7, 5) }));
    expect(result.current.pending).toBe(true);
    expect(calls.map((call) => call.edits)).toEqual([[{ index: at(5, 5), item: { piece: 'chair-gamer', rotation: 0 } }]]);
    expect(commands.at(-1)?.preview).toHaveLength(3);

    await act(async () => calls[0]!.resolve());
    expect(calls[1]!.edits).toEqual([
      { index: at(6, 5), item: { piece: 'chair-gamer', rotation: 0 } },
      { index: at(7, 5), item: { piece: 'chair-gamer', rotation: 0 } },
    ]);
    await act(async () => calls[1]!.resolve());

    act(() => bridge.emit('decor', { items: [5, 6, 7].map((tx) => ({ index: at(tx, 5), piece: 'chair-gamer', rotation: 0 as const })) }));
    expect(commands.at(-1)).toEqual({ brush: result.current.brush, area: null });
    expect(result.current.pending).toBe(false);
  });

  it('skips a tile that already holds, or is about to hold, that piece turned that way, but turns or replaces what stands there', async () => {
    const { decor, calls } = deferredPort();
    const { bridge, result } = setup({ decor });
    act(() => bridge.emit('decor', { items: [{ index: at(5, 5), piece: 'chair-gamer', rotation: 0 }] }));
    act(() => result.current.enter());
    act(() => result.current.pick(CHAIR));
    act(() => bridge.emit('decorpick', { index: at(5, 5) }));
    expect(decor.setDecor).not.toHaveBeenCalled();

    act(() => result.current.rotate());
    act(() => bridge.emit('decorpick', { index: at(5, 5) }));
    act(() => bridge.emit('decorpick', { index: at(5, 5) }));
    expect(calls.map((call) => call.edits)).toEqual([[{ index: at(5, 5), item: { piece: 'chair-gamer', rotation: 270 } }]]);
    await act(async () => calls[0]!.resolve());
    expect(calls).toHaveLength(1);
  });

  it('erases the item whose footprint covers the clicked tile, by its anchor, and does nothing on a free tile', async () => {
    const { decor, calls } = deferredPort();
    const { bridge, result } = setup({ decor });
    act(() => bridge.emit('decor', { items: [{ index: at(10, 10), piece: 'desk-wood', rotation: 0 }] }));
    act(() => result.current.enter());
    act(() => result.current.pickEraser());

    act(() => bridge.emit('decorpick', { index: at(20, 20) }));
    expect(decor.setDecor).not.toHaveBeenCalled();
    act(() => bridge.emit('decorpick', { index: at(11, 10) }));
    expect(calls.map((call) => call.edits)).toEqual([[{ index: at(10, 10), item: null }]]);
    // Already on its way out: a second click on it sends nothing more.
    act(() => bridge.emit('decorpick', { index: at(9, 10) }));
    await act(async () => calls[0]!.resolve());
    expect(calls).toHaveLength(1);
  });

  it('never sends one tile twice in a request, and caps one request at MAX_DECOR_EDITS tiles', async () => {
    const { decor, calls } = deferredPort();
    const { bridge, result } = setup({ decor });
    act(() => result.current.enter());
    act(() => result.current.setMultiple(true));
    act(() => result.current.pick(CHAIR));
    act(() => {
      for (let index = 0; index <= MAX_DECOR_EDITS + 1; index += 1) bridge.emit('decorpick', { index });
    });
    act(() => result.current.rotate());
    act(() => bridge.emit('decorpick', { index: 5 }));

    await act(async () => calls[0]!.resolve());
    expect(calls[1]!.edits).toHaveLength(MAX_DECOR_EDITS);
    await act(async () => calls[1]!.resolve());
    expect(calls[2]!.edits).toEqual([
      { index: MAX_DECOR_EDITS + 1, item: { piece: 'chair-gamer', rotation: 0 } },
      { index: 5, item: { piece: 'chair-gamer', rotation: 270 } },
    ]);
    await act(async () => calls[2]!.resolve());
  });

  it('keeps a desk-scoped editor inside the desk, saying so without asking the server', () => {
    const { decor } = deferredPort();
    const area = { x: 10, y: 10, w: 3, h: 3 };
    const { bridge, result } = setup({ decor, area });
    act(() => bridge.emit('decor', { items: [{ index: at(13, 11), piece: 'chair-gamer', rotation: 0 }] }));
    act(() => result.current.enter());

    act(() => result.current.pick(CHAIR));
    act(() => bridge.emit('decorpick', { index: at(14, 11) }));
    expect(result.current.error).toBe(DECOR_AREA_MESSAGE);
    // The desk table's footprint would stick out of the left edge.
    act(() => result.current.pick(DESK));
    act(() => bridge.emit('decorpick', { index: at(10, 11) }));
    // Someone else's chair right outside the desk is not one's to remove.
    act(() => result.current.pickEraser());
    act(() => bridge.emit('decorpick', { index: at(13, 11) }));
    expect(result.current.error).toBe(DECOR_AREA_MESSAGE);
    expect(decor.setDecor).not.toHaveBeenCalled();

    act(() => result.current.pick(DESK));
    expect(result.current.error).toBeNull();
    act(() => bridge.emit('decorpick', { index: at(11, 12) }));
    expect(decor.setDecor).toHaveBeenCalledWith([{ index: at(11, 12), item: { piece: 'desk-wood', rotation: 0 } }]);
  });

  it('follows a new area, so a desk that moved is decorated where it is now', () => {
    const { result, commands, rerender } = setup({ area: { x: 1, y: 1, w: 3, h: 3 } });
    act(() => result.current.enter());
    rerender({ area: { x: 5, y: 1, w: 3, h: 3 } });
    expect(commands.at(-1)).toEqual({ brush: null, area: { x: 5, y: 1, w: 3, h: 3 } });
  });

  it('shows why the server refused, drops only that edit and goes on, «Múltiple» included; a lost permission or desk stops for good', async () => {
    const { decor, calls } = deferredPort();
    const { bridge, result, commands } = setup({ decor });
    act(() => result.current.enter());
    act(() => result.current.setMultiple(true));
    act(() => result.current.pick(CHAIR));
    act(() => bridge.emit('decorpick', { index: at(5, 5) }));
    act(() => bridge.emit('decorpick', { index: at(5, 5) + 1 }));

    await act(async () => calls[0]!.reject(new AdminError('terrain-under-placement')));
    expect(result.current.error).toBe(DECOR_UNDER_PLACEMENT_MESSAGE);
    expect(result.current.brush).not.toBeNull();
    expect(commands.at(-1)?.preview).toEqual([{ index: at(5, 5) + 1, item: { piece: 'chair-gamer', rotation: 0 } }]);

    act(() => bridge.emit('decorpick', { index: at(5, 5) + 2 }));
    await act(async () => calls[1]!.reject(new AdminError('no-desk')));
    expect(result.current.blocked).toBe(true);
    expect(result.current.error).toMatch(/reclama uno libre/);
    expect(commands.at(-1)?.preview).toBeUndefined();
    expect(calls).toHaveLength(2);
    act(() => bridge.emit('decorpick', { index: at(9, 9) }));
    expect(calls).toHaveLength(2);
  });

  it('steps out on Escape one level at a time: the brush first, then the editor when it may leave', () => {
    const onExit = vi.fn();
    const { result } = setup({ onExit });
    act(() => result.current.enter());
    act(() => result.current.pick(CHAIR));

    expect(escape().defaultPrevented).toBe(true);
    expect(result.current.brush).toBeNull();
    expect(result.current.active).toBe(true);

    expect(escape().defaultPrevented).toBe(true);
    expect(result.current.active).toBe(false);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('without a way to leave ("Mi espacio") an Escape with nothing picked is left for the sidebar', () => {
    const { result } = setup({ area: { x: 1, y: 1, w: 3, h: 3 } });
    act(() => result.current.enter());
    expect(escape().defaultPrevented).toBe(false);
    expect(result.current.active).toBe(true);
  });

  it('closes the overlay when unmounted while open', () => {
    const { result, commands, unmount } = setup();
    act(() => result.current.enter());
    unmount();
    expect(commands.at(-1)).toBeNull();
  });
});
