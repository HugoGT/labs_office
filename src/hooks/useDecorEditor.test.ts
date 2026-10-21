/**
 * The decor editor's lifecycle (#208): what it asks the map to show through
 * `decoredit`, how a picked piece turns map clicks into decor edits, turned
 * and painted, how "Mi espacio" keeps them inside the desk, and what it says.
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
const OVAL: DecorPick = { id: 'table-oval', info: { kind: 'table', footprint: { w: 2, h: 1 } } };
const PAINTED: DecorPick = { id: 'desk-painted', info: { kind: 'desk', footprint: { w: 3, h: 1 }, colorable: true } };
const PICKS = [CHAIR, DESK, PLANT, TABLE, OVAL, PAINTED];
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

  it('picks a piece, one at a time, unpicks on a second pick or on demand, and tells the map', () => {
    const { result, commands } = setup();
    act(() => result.current.enter());

    act(() => result.current.pick(CHAIR));
    expect(result.current.brush).toEqual({ kind: 'piece', piece: 'chair-gamer', info: CHAIR.info, rotation: 0 });
    expect(commands.at(-1)).toEqual({ brush: result.current.brush, area: null });
    act(() => result.current.pick(CHAIR));
    expect(result.current.brush).toBeNull();

    act(() => result.current.pick(CHAIR));
    act(() => result.current.pick(DESK));
    expect(result.current.brush).toMatchObject({ piece: 'desk-wood' });
    act(() => result.current.unpick());
    expect(result.current.brush).toBeNull();
    expect(commands.at(-1)).toEqual({ brush: null, area: null });
  });

  it('turns a picked chair down, left, up, right with the map (wheel or R), and keeps the turn for the next pick', () => {
    const { bridge, result } = setup();
    act(() => result.current.enter());
    act(() => result.current.pick(CHAIR));

    act(() => bridge.emit('decorrotate', { step: 1 }));
    expect(result.current.rotation).toBe(270);
    expect(result.current.brush).toMatchObject({ rotation: 270 });
    act(() => bridge.emit('decorrotate', { step: 1 }));
    expect(result.current.brush).toMatchObject({ rotation: 180 });
    act(() => bridge.emit('decorrotate', { step: -1 }));
    expect(result.current.brush).toMatchObject({ rotation: 270 });

    act(() => result.current.pick(DESK));
    expect(result.current.brush).toMatchObject({ piece: 'desk-wood', rotation: 270 });
  });

  it('never turns a plant, and with nothing picked the map turns nothing', () => {
    const { bridge, result } = setup();
    act(() => result.current.enter());
    act(() => bridge.emit('decorrotate', { step: 1 }));
    expect(result.current.rotation).toBe(0);

    act(() => result.current.pick(PLANT));
    act(() => bridge.emit('decorrotate', { step: 1 }));
    expect(result.current.brush).toMatchObject({ piece: 'plant-ficus', rotation: 0 });
    expect(result.current.rotation).toBe(0);
  });

  it('turns a picked room table between horizontal (0) and vertical (90) either way, and takes the symmetric half of a chair turn', () => {
    const { bridge, result } = setup();
    act(() => result.current.enter());
    act(() => result.current.pick(TABLE));
    expect(result.current.brush).toMatchObject({ rotation: 0 });

    act(() => bridge.emit('decorrotate', { step: 1 }));
    expect(result.current.brush).toMatchObject({ piece: 'table-meeting', rotation: 90 });
    act(() => bridge.emit('decorrotate', { step: 1 }));
    expect(result.current.brush).toMatchObject({ rotation: 0 });
    act(() => bridge.emit('decorrotate', { step: -1 }));
    expect(result.current.brush).toMatchObject({ rotation: 90 });

    // A chair turned left (270) hands a table its vertical frame; one turned up (180), the horizontal one.
    act(() => result.current.pick(CHAIR));
    act(() => bridge.emit('decorrotate', { step: 1 }));
    expect(result.current.brush).toMatchObject({ rotation: 0 });
    act(() => bridge.emit('decorrotate', { step: 1 }));
    act(() => result.current.pick(OVAL));
    expect(result.current.brush).toMatchObject({ piece: 'table-oval', rotation: 90 });
  });

  it('paints a colorable piece in the color chosen for it, the picked brush included; without one it takes the manifest default', async () => {
    const { decor, calls } = deferredPort();
    const { bridge, result, commands } = setup({ decor });
    act(() => result.current.enter());
    act(() => result.current.setMultiple(true));

    act(() => result.current.pick(PAINTED));
    expect(result.current.brush).not.toHaveProperty('color');
    act(() => bridge.emit('decorpick', { index: at(5, 5) }));
    expect(calls[0]!.edits).toEqual([{ index: at(5, 5), item: { piece: 'desk-painted', rotation: 0 } }]);

    act(() => result.current.setColor('desk-painted', '#c83c3c'));
    expect(result.current.colors).toEqual({ 'desk-painted': '#c83c3c' });
    expect(result.current.brush).toMatchObject({ color: '#c83c3c' });
    expect(commands.at(-1)?.brush).toMatchObject({ color: '#c83c3c' });
    act(() => bridge.emit('decorpick', { index: at(9, 5) }));
    await act(async () => calls[0]!.resolve());
    expect(calls[1]!.edits).toEqual([{ index: at(9, 5), item: { piece: 'desk-painted', rotation: 0, color: '#c83c3c' } }]);

    // Kept for the next pick; a piece that takes no color never carries one.
    act(() => result.current.unpick());
    act(() => result.current.pick(PAINTED));
    expect(result.current.brush).toMatchObject({ color: '#c83c3c' });
    act(() => result.current.setColor('desk-wood', '#3c5ac8'));
    act(() => result.current.pick(DESK));
    expect(result.current.brush).not.toHaveProperty('color');
    await act(async () => calls[1]!.resolve());
  });

  it('repaints a piece of another color on the same tile, but skips one already in that color', async () => {
    const { decor, calls } = deferredPort();
    const { bridge, result } = setup({ decor });
    act(() => bridge.emit('decor', { items: [{ index: at(5, 5), piece: 'desk-painted', rotation: 0, color: '#c83c3c' }] }));
    act(() => result.current.enter());
    act(() => result.current.setMultiple(true));
    act(() => result.current.setColor('desk-painted', '#c83c3c'));
    act(() => result.current.pick(PAINTED));
    act(() => bridge.emit('decorpick', { index: at(5, 5) }));
    expect(decor.setDecor).not.toHaveBeenCalled();

    act(() => result.current.setColor('desk-painted', '#3c5ac8'));
    act(() => bridge.emit('decorpick', { index: at(5, 5) }));
    expect(calls.map((call) => call.edits)).toEqual([[{ index: at(5, 5), item: { piece: 'desk-painted', rotation: 0, color: '#3c5ac8' } }]]);
    await act(async () => calls[0]!.resolve());
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
    await act(async () => calls[0]!.resolve());
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

    act(() => result.current.setMultiple(true));
    act(() => bridge.emit('decorrotate', { step: 1 }));
    act(() => bridge.emit('decorpick', { index: at(5, 5) }));
    act(() => bridge.emit('decorpick', { index: at(5, 5) }));
    expect(calls.map((call) => call.edits)).toEqual([[{ index: at(5, 5), item: { piece: 'chair-gamer', rotation: 270 } }]]);
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
    act(() => bridge.emit('decorrotate', { step: 1 }));
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
    expect(result.current.error).toBe(DECOR_AREA_MESSAGE);
    expect(decor.setDecor).not.toHaveBeenCalled();

    act(() => result.current.pick(CHAIR));
    expect(result.current.error).toBeNull();
    act(() => result.current.pick(DESK));
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

  it('leaves an Escape from inside a popover (the color picker) to the popover', () => {
    const onExit = vi.fn();
    const { result } = setup({ onExit });
    act(() => result.current.enter());
    const popover = document.createElement('div');
    popover.setAttribute('role', 'dialog');
    const swatch = document.createElement('button');
    popover.append(swatch);
    document.body.append(popover);

    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true });
    act(() => {
      swatch.dispatchEvent(event);
    });
    popover.remove();

    expect(event.defaultPrevented).toBe(false);
    expect(result.current.active).toBe(true);
    expect(onExit).not.toHaveBeenCalled();
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

  describe('selecting a placed item with nothing picked', () => {
    const DESK_AT = at(10, 10);
    const PLACED: DecorItem[] = [
      { index: DESK_AT, piece: 'desk-painted', rotation: 90, color: '#c83c3c' },
      { index: at(20, 20), piece: 'chair-gamer', rotation: 270 },
    ];

    function selecting(options: Parameters<typeof setup>[0] = {}) {
      const port = deferredPort();
      const view = setup({ decor: port.decor, ...options });
      act(() => view.bridge.emit('decor', { items: PLACED }));
      act(() => view.result.current.enter());
      return { ...view, calls: port.calls };
    }

    function key(init: KeyboardEventInit, target: EventTarget = document.body): KeyboardEvent {
      const event = new KeyboardEvent('keydown', { cancelable: true, bubbles: true, ...init });
      act(() => {
        target.dispatchEvent(event);
      });
      return event;
    }

    it('selects the item a map click is about and tells the map, and an empty click deselects', () => {
      const { bridge, result, commands } = selecting();

      act(() => bridge.emit('decorselect', { index: DESK_AT }));
      expect(result.current.selected).toBe(DESK_AT);
      expect(commands.at(-1)).toEqual({ brush: null, area: null, selected: DESK_AT });

      act(() => bridge.emit('decorselect', { index: null }));
      expect(result.current.selected).toBeNull();
      expect(commands.at(-1)).toEqual({ brush: null, area: null });

      // Nothing placed there: nothing to select.
      act(() => bridge.emit('decorselect', { index: at(30, 30) }));
      expect(result.current.selected).toBeNull();
    });

    it('never selects while a piece is picked, and picking a piece clears the selection', () => {
      const { bridge, result } = selecting();
      act(() => result.current.pick(CHAIR));
      act(() => bridge.emit('decorselect', { index: DESK_AT }));
      expect(result.current.selected).toBeNull();

      act(() => result.current.unpick());
      act(() => bridge.emit('decorselect', { index: DESK_AT }));
      act(() => result.current.pick(PLANT));
      expect(result.current.selected).toBeNull();
      expect(result.current.brush).toMatchObject({ piece: 'plant-ficus' });
    });

    it('moves the item: the move button turns it into a brush of the same piece, turn and color, and the next click moves it in one batch', async () => {
      const { bridge, result, calls, commands } = selecting();
      act(() => result.current.setMultiple(true));
      act(() => bridge.emit('decorselect', { index: DESK_AT }));

      act(() => bridge.emit('decormove', { index: DESK_AT }));
      expect(result.current.selected).toBeNull();
      expect(result.current.brush).toEqual({ kind: 'piece', piece: 'desk-painted', info: PAINTED.info, rotation: 90, color: '#c83c3c', from: DESK_AT });
      expect(commands.at(-1)).toMatchObject({ brush: { from: DESK_AT } });

      // It turns like any brush.
      act(() => bridge.emit('decorrotate', { step: 1 }));
      act(() => bridge.emit('decorpick', { index: at(14, 10) }));
      expect(calls.map((call) => call.edits)).toEqual([
        [
          { index: DESK_AT, item: null },
          { index: at(14, 10), item: { piece: 'desk-painted', rotation: 0, color: '#c83c3c' } },
        ],
      ]);
      // A move is one move, whatever «Múltiple» says.
      expect(result.current.brush).toBeNull();
      expect(commands.at(-1)?.preview).toEqual(calls[0]!.edits);
      await act(async () => calls[0]!.resolve());
    });

    it('turns an item in place when the move lands on its own tile, and does nothing when nothing changed', async () => {
      const { bridge, result, calls } = selecting();
      act(() => bridge.emit('decormove', { index: DESK_AT }));
      act(() => bridge.emit('decorpick', { index: DESK_AT }));
      expect(calls).toHaveLength(0);
      expect(result.current.brush).toBeNull();

      act(() => bridge.emit('decormove', { index: DESK_AT }));
      act(() => bridge.emit('decorrotate', { step: 1 }));
      act(() => bridge.emit('decorpick', { index: DESK_AT }));
      expect(calls.map((call) => call.edits)).toEqual([[{ index: DESK_AT, item: { piece: 'desk-painted', rotation: 0, color: '#c83c3c' } }]]);
      await act(async () => calls[0]!.resolve());
    });

    it('never moves onto another item\'s anchor, and a refused move leaves the item where it was with the reason', async () => {
      const { bridge, result, calls, commands } = selecting();
      act(() => bridge.emit('decormove', { index: DESK_AT }));
      act(() => bridge.emit('decorpick', { index: at(20, 20) }));
      expect(calls).toHaveLength(0);
      expect(result.current.error).toBe(DECOR_UNDER_PLACEMENT_MESSAGE);
      expect(result.current.brush).toBeNull();

      act(() => bridge.emit('decormove', { index: DESK_AT }));
      act(() => bridge.emit('decorpick', { index: at(30, 30) }));
      await act(async () => calls[0]!.reject(new AdminError('terrain-under-placement')));
      expect(result.current.error).toBe(DECOR_UNDER_PLACEMENT_MESSAGE);
      expect(commands.at(-1)?.preview).toBeUndefined();
      expect(result.current.items).toEqual(PLACED);
    });

    it('Escape cancels a move first, back to the item selected, then deselects, then leaves the editor', () => {
      const onExit = vi.fn();
      const { bridge, result, calls, commands } = selecting({ onExit });
      act(() => bridge.emit('decorselect', { index: DESK_AT }));
      act(() => bridge.emit('decormove', { index: DESK_AT }));

      expect(escape().defaultPrevented).toBe(true);
      expect(result.current.brush).toBeNull();
      expect(result.current.selected).toBe(DESK_AT);
      expect(commands.at(-1)).toEqual({ brush: null, area: null, selected: DESK_AT });
      expect(calls).toHaveLength(0);

      expect(escape().defaultPrevented).toBe(true);
      expect(result.current.selected).toBeNull();
      expect(result.current.active).toBe(true);

      escape();
      expect(result.current.active).toBe(false);
      expect(onExit).toHaveBeenCalledTimes(1);
    });

    it('deletes the selected item with the trash button, Supr or Backspace, never while typing', async () => {
      const { bridge, result, calls } = selecting();
      act(() => bridge.emit('decorselect', { index: DESK_AT }));
      act(() => bridge.emit('decordelete', { index: DESK_AT }));
      expect(calls.map((call) => call.edits)).toEqual([[{ index: DESK_AT, item: null }]]);
      expect(result.current.selected).toBeNull();
      await act(async () => calls[0]!.resolve());

      act(() => bridge.emit('decorselect', { index: at(20, 20) }));
      const input = document.createElement('input');
      document.body.append(input);
      input.focus();
      expect(key({ key: 'Delete' }, input).defaultPrevented).toBe(false);
      input.remove();
      expect(calls).toHaveLength(1);

      expect(key({ key: 'Delete' }).defaultPrevented).toBe(true);
      expect(calls[1]!.edits).toEqual([{ index: at(20, 20), item: null }]);
      await act(async () => calls[1]!.resolve());
      // Nothing selected: the keys do nothing.
      expect(key({ key: 'Backspace' }).defaultPrevented).toBe(false);

      act(() => bridge.emit('decor', { items: [{ index: at(20, 20), piece: 'chair-gamer', rotation: 270 }] }));
      act(() => bridge.emit('decorselect', { index: at(20, 20) }));
      key({ key: 'Backspace' });
      expect(calls[2]!.edits).toEqual([{ index: at(20, 20), item: null }]);
      await act(async () => calls[2]!.resolve());
    });

    it('«Deseleccionar» during a move puts the brush down and goes back to the item selected too', () => {
      const { bridge, result } = selecting();
      act(() => bridge.emit('decorselect', { index: DESK_AT }));
      act(() => bridge.emit('decormove', { index: DESK_AT }));
      act(() => result.current.unpick());
      expect(result.current.brush).toBeNull();
      expect(result.current.selected).toBe(DESK_AT);
    });

    it('drops the selection once the item is gone from the layer', () => {
      const { bridge, result } = selecting();
      act(() => bridge.emit('decorselect', { index: DESK_AT }));
      act(() => bridge.emit('decor', { items: PLACED.slice(1) }));
      expect(result.current.selected).toBeNull();
    });

    it('in a desk ("Mi espacio") selects only items wholly inside it, and moves them only within it', () => {
      const area = { x: 19, y: 19, w: 3, h: 3 };
      const { bridge, result, calls } = selecting({ area });
      act(() => bridge.emit('decorselect', { index: DESK_AT }));
      expect(result.current.selected).toBeNull();

      act(() => bridge.emit('decorselect', { index: at(20, 20) }));
      expect(result.current.selected).toBe(at(20, 20));
      act(() => bridge.emit('decormove', { index: at(20, 20) }));
      act(() => bridge.emit('decorpick', { index: at(25, 20) }));
      expect(result.current.error).toBe(DECOR_AREA_MESSAGE);
      expect(calls).toHaveLength(0);
      act(() => bridge.emit('decorpick', { index: at(21, 21) }));
      expect(calls.map((call) => call.edits)).toEqual([[{ index: at(20, 20), item: null }, { index: at(21, 21), item: { piece: 'chair-gamer', rotation: 270 } }]]);
    });

    it('never splits a move across two requests', async () => {
      const { bridge, result, calls } = selecting();
      act(() => result.current.setMultiple(true));
      act(() => result.current.pick(CHAIR));
      act(() => bridge.emit('decorpick', { index: at(40, 40) }));
      act(() => result.current.unpick());
      // While the first request is out, a move queues; it leaves whole in the next one.
      act(() => bridge.emit('decormove', { index: at(20, 20) }));
      act(() => bridge.emit('decorpick', { index: at(22, 20) }));
      await act(async () => calls[0]!.resolve());
      expect(calls[1]!.edits).toEqual([{ index: at(20, 20), item: null }, { index: at(22, 20), item: { piece: 'chair-gamer', rotation: 270 } }]);
      await act(async () => calls[1]!.resolve());
    });
  });
});
