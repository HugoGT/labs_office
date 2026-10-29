/**
 * Cableado del reductor de `layoutEditor.ts` a un `SpacesAdminPort` real y al
 * bridge (#74, PR4). Mismo patron que `useLayoutEditor.test.ts` (PR3c): las
 * reglas puras del reductor ya las cubre `layoutEditor.test.ts`; aqui se
 * prueba el CICLO DE VIDA -- que el comando llega a la escena, que un
 * `layoutplace` valido llama al puerto correcto, y que las salas y los
 * escritorios se cruzan como obstaculo el uno del otro (#74, PR4 addition:
 * `useLayoutEditor.test.ts` cubre el sentido escritorio-ve-sala; este archivo
 * cubre el sentido sala-ve-escritorio).
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminError } from '../dashboard/adminPort';
import type { AdminDesk, DeskAdminPort } from '../dashboard/deskAdminPort';
import type { AdminSpace, SpacesAdminPort } from '../dashboard/spacesAdminPort';
import { createOfficeBridge, type OfficeCommandMap } from '../game/officeBridge';
import { useSpaceEditor } from './useSpaceEditor';

const SALA: AdminSpace = { id: 'id-sala', name: 'Sala de reuniones', x: 10, y: 10, w: 5, h: 5, capacity: 8, kind: 'room' };
const OTRA_SALA: AdminSpace = { id: 'id-otra-sala', name: 'Sala chica', x: 30, y: 30, w: 3, h: 3, capacity: null, kind: 'room' };
// Cubiculo de escritorio: MISMA lista que sirve `listSpaces`, pero NO es una sala -- no debe contarse como pickable ni duplicar al escritorio de `listDesks`.
const CUBICULO: AdminSpace = { id: 'id-cubiculo', name: 'Mesa 4', x: 2, y: 2, w: 3, h: 3, capacity: null, kind: 'desk' };
const MESA: AdminDesk = { id: 'id-mesa', label: 'Mesa 4', x: 2, y: 2, w: 3, h: 3, occupant: null };

function fakeSpaces(overrides: Partial<SpacesAdminPort> = {}): SpacesAdminPort {
  return {
    listSpaces: vi.fn(async () => [SALA, OTRA_SALA, CUBICULO]),
    createSpace: vi.fn(async () => SALA),
    updateSpace: vi.fn(async () => SALA),
    deleteSpace: vi.fn(async () => undefined),
    ...overrides,
  };
}

function fakeDesks(overrides: Partial<DeskAdminPort> = {}): DeskAdminPort {
  return {
    listDesks: vi.fn(async () => [MESA]),
    createDesk: vi.fn(async () => MESA),
    updateDesk: vi.fn(async () => MESA),
    deleteDesk: vi.fn(async () => undefined),
    ...overrides,
  };
}

function setup(spaces: SpacesAdminPort, desks: DeskAdminPort = fakeDesks()) {
  const bridge = createOfficeBridge();
  const refreshDesks = vi.fn();
  const refreshSpaces = vi.fn();
  const commands: (OfficeCommandMap['layoutedit'])[] = [];
  bridge.onCommand('layoutedit', (command) => commands.push(command));

  const view = renderHook(() => useSpaceEditor({ bridge, spaces, desks, refreshDesks, refreshSpaces }));

  return { bridge, spaces, desks, refreshDesks, refreshSpaces, commands, ...view };
}

describe('useSpaceEditor (#74, PR4)', () => {
  it('entrar carga solo las salas (kind room) como pickable, nunca los cubiculos', async () => {
    const { spaces, desks, commands, result } = setup(fakeSpaces());

    act(() => result.current.enter());

    await waitFor(() => expect(spaces.listSpaces).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(desks.listDesks).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      const last = commands.at(-1);
      expect(last?.pickable.map((rect) => rect.id).sort()).toEqual(['id-otra-sala', 'id-sala']);
    });
    expect(result.current.spaces.map((space) => space.id).sort()).toEqual(['id-otra-sala', 'id-sala']);
  });

  it('fuera de modo edicion no hay comando pickable: el ultimo publicado es null', () => {
    const { commands } = setup(fakeSpaces());

    expect(commands.at(-1)).toBeNull();
  });

  it('un layoutpick selecciona esa sala', async () => {
    const { bridge, result } = setup(fakeSpaces());
    act(() => result.current.enter());
    await waitFor(() => expect(result.current.spaces).toHaveLength(2));

    act(() => bridge.emit('layoutpick', { id: 'id-sala' }));

    expect(result.current.state).toEqual({ tag: 'selected', kind: 'room', id: 'id-sala' });
  });

  it('crear: un layoutplace valido llama a createSpace con nombre/tamano/aforo pedidos y la posicion encajada', async () => {
    const spaces = fakeSpaces();
    const { bridge, refreshDesks, refreshSpaces, result } = setup(spaces);
    act(() => result.current.enter());
    await waitFor(() => expect(result.current.spaces).toHaveLength(2));

    act(() => result.current.startCreate({ name: 'Sala nueva', w: 4, h: 3, capacity: 6 }));
    act(() => bridge.emit('layoutplace', { tx: 7, ty: 8, valid: true }));

    await waitFor(() =>
      expect(spaces.createSpace).toHaveBeenCalledWith({ name: 'Sala nueva', x: 7, y: 8, w: 4, h: 3, capacity: 6 }),
    );
    await waitFor(() => expect(refreshSpaces).toHaveBeenCalledTimes(1));
    expect(refreshDesks).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.state).toEqual({ tag: 'idle', kind: 'room' }));
  });

  it('creating sends only the area, never a floor: a room shows the terrain under it (#182)', async () => {
    const spaces = fakeSpaces();
    const { bridge, result } = setup(spaces);
    act(() => result.current.enter());
    await waitFor(() => expect(result.current.spaces).toHaveLength(2));

    // A caller still holding the old shape cannot smuggle a floor through.
    const legacy = { name: 'Sala nueva', w: 4, h: 3, capacity: null, floor: { materialId: 'floor-plain', color: '#2c3e50' } };
    act(() => result.current.startCreate(legacy as Parameters<typeof result.current.startCreate>[0]));
    act(() => bridge.emit('layoutplace', { tx: 7, ty: 8, valid: true }));

    await waitFor(() =>
      expect(spaces.createSpace).toHaveBeenCalledWith({ name: 'Sala nueva', x: 7, y: 8, w: 4, h: 3, capacity: null }),
    );
  });

  it('mover: un layoutplace valido manda el rectangulo entero, con el tamano de la sala', async () => {
    const spaces = fakeSpaces();
    const { bridge, refreshDesks, refreshSpaces, result } = setup(spaces);
    act(() => result.current.enter());
    await waitFor(() => expect(result.current.spaces).toHaveLength(2));
    act(() => bridge.emit('layoutpick', { id: 'id-sala' }));
    act(() => result.current.startMove());

    act(() => bridge.emit('layoutplace', { tx: 3, ty: 4, valid: true }));

    await waitFor(() => expect(spaces.updateSpace).toHaveBeenCalledWith('id-sala', { x: 3, y: 4, w: 5, h: 5 }));
    await waitFor(() => expect(refreshSpaces).toHaveBeenCalledTimes(1));
    expect(refreshDesks).toHaveBeenCalledTimes(1);
  });

  it('un layoutplace invalido no llama al puerto: el ghost sigue pendiente de intentarlo de nuevo', async () => {
    const spaces = fakeSpaces();
    const { bridge, refreshSpaces, result } = setup(spaces);
    act(() => result.current.enter());
    await waitFor(() => expect(result.current.spaces).toHaveLength(2));
    act(() => result.current.startCreate({ name: 'Sala nueva', w: 4, h: 3, capacity: null }));

    act(() => bridge.emit('layoutplace', { tx: 7, ty: 8, valid: false }));

    expect(spaces.createSpace).not.toHaveBeenCalled();
    expect(refreshSpaces).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ tag: 'placing', kind: 'room', mode: 'create' });
  });

  it('un fallo del servidor al crear se traduce con describeAdminError y no relee las listas', async () => {
    const spaces = fakeSpaces({ createSpace: vi.fn(async () => Promise.reject(new AdminError('space-name-taken'))) });
    const { bridge, refreshDesks, refreshSpaces, result } = setup(spaces);
    act(() => result.current.enter());
    await waitFor(() => expect(result.current.spaces).toHaveLength(2));
    act(() => result.current.startCreate({ name: 'Sala de reuniones', w: 4, h: 3, capacity: null }));

    act(() => bridge.emit('layoutplace', { tx: 7, ty: 8, valid: true }));

    await waitFor(() => expect(result.current.error).toBe('Ya existe una sala con ese nombre.'));
    expect(refreshDesks).not.toHaveBeenCalled();
    expect(refreshSpaces).not.toHaveBeenCalled();
    expect(spaces.listSpaces).toHaveBeenCalledTimes(1);
  });

  describe('the buttons under the selected room on the map (layoutaction)', () => {
    it('move starts moving the selected room, delete deletes it, and deselect lets it go', async () => {
      const spaces = fakeSpaces();
      const { bridge, result } = setup(spaces);
      act(() => result.current.enter());
      await waitFor(() => expect(result.current.spaces).toHaveLength(2));

      act(() => bridge.emit('layoutpick', { id: 'id-sala' }));
      act(() => bridge.emit('layoutaction', { action: 'move', id: 'id-sala' }));
      expect(result.current.state).toEqual({ tag: 'placing', kind: 'room', mode: 'move', id: 'id-sala' });
      act(() => result.current.cancelPlacing());

      act(() => bridge.emit('layoutaction', { action: 'deselect', id: 'id-sala' }));
      expect(result.current.state).toEqual({ tag: 'idle', kind: 'room' });

      act(() => bridge.emit('layoutpick', { id: 'id-sala' }));
      await act(async () => bridge.emit('layoutaction', { action: 'delete', id: 'id-sala' }));
      await waitFor(() => expect(spaces.deleteSpace).toHaveBeenCalledWith('id-sala'));
      await waitFor(() => expect(result.current.state).toEqual({ tag: 'idle', kind: 'room' }));
    });

    it('does nothing for a room that is not the selected one, or while the editor is closed', async () => {
      const spaces = fakeSpaces();
      const { bridge, result } = setup(spaces);
      act(() => bridge.emit('layoutaction', { action: 'delete', id: 'id-sala' }));
      act(() => result.current.enter());
      await waitFor(() => expect(result.current.spaces).toHaveLength(2));

      act(() => bridge.emit('layoutpick', { id: 'id-otra-sala' }));
      act(() => bridge.emit('layoutaction', { action: 'move', id: 'id-sala' }));
      act(() => bridge.emit('layoutaction', { action: 'deselect', id: 'id-sala' }));
      await act(async () => bridge.emit('layoutaction', { action: 'delete', id: 'id-sala' }));

      expect(spaces.deleteSpace).not.toHaveBeenCalled();
      expect(result.current.state).toEqual({ tag: 'selected', kind: 'room', id: 'id-otra-sala' });
    });
  });

  it('borrar: llama a deleteSpace con la seleccionada y relee ambas listas', async () => {
    const spaces = fakeSpaces();
    const { bridge, refreshDesks, refreshSpaces, result } = setup(spaces);
    act(() => result.current.enter());
    await waitFor(() => expect(result.current.spaces).toHaveLength(2));
    act(() => bridge.emit('layoutpick', { id: 'id-sala' }));

    await act(async () => result.current.remove());

    expect(spaces.deleteSpace).toHaveBeenCalledWith('id-sala');
    expect(refreshDesks).toHaveBeenCalledTimes(1);
    expect(refreshSpaces).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({ tag: 'idle', kind: 'room' });
  });

  it('un fallo al borrar se cuenta y no releva la seleccion', async () => {
    const spaces = fakeSpaces({ deleteSpace: vi.fn(async () => Promise.reject(new AdminError('unknown'))) });
    const { bridge, refreshDesks, result } = setup(spaces);
    act(() => result.current.enter());
    await waitFor(() => expect(result.current.spaces).toHaveLength(2));
    act(() => bridge.emit('layoutpick', { id: 'id-sala' }));

    await act(async () => result.current.remove());

    expect(result.current.error).toBe('No se pudo completar la operación.');
    expect(refreshDesks).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ tag: 'selected', kind: 'room', id: 'id-sala' });
  });

  describe('row actions: a room list row acts on its own room, no selection step (like desks)', () => {
    it('moving by id places that room, with its own size', async () => {
      const spaces = fakeSpaces();
      const { bridge, refreshSpaces, result } = setup(spaces);
      act(() => result.current.enter());
      await waitFor(() => expect(result.current.spaces).toHaveLength(2));

      act(() => result.current.startMove('id-otra-sala'));

      expect(result.current.state).toEqual({ tag: 'placing', kind: 'room', mode: 'move', id: 'id-otra-sala' });
      act(() => bridge.emit('layoutplace', { tx: 3, ty: 4, valid: true }));
      await waitFor(() => expect(spaces.updateSpace).toHaveBeenCalledWith('id-otra-sala', { x: 3, y: 4, w: 3, h: 3 }));
      await waitFor(() => expect(refreshSpaces).toHaveBeenCalledTimes(1));
    });

    it('moving by id moves that room even while another one is selected on the map', async () => {
      const { bridge, result } = setup(fakeSpaces());
      act(() => result.current.enter());
      await waitFor(() => expect(result.current.spaces).toHaveLength(2));
      act(() => bridge.emit('layoutpick', { id: 'id-sala' }));

      act(() => result.current.startMove('id-otra-sala'));

      expect(result.current.state).toEqual({ tag: 'placing', kind: 'room', mode: 'move', id: 'id-otra-sala' });
    });

    it('moving by id does nothing while something else is being placed', async () => {
      const { result } = setup(fakeSpaces());
      act(() => result.current.enter());
      await waitFor(() => expect(result.current.spaces).toHaveLength(2));
      act(() => result.current.startCreate({ name: 'Sala nueva', w: 6, h: 6, capacity: 7 }));

      act(() => result.current.startMove('id-otra-sala'));

      expect(result.current.state).toEqual({ tag: 'placing', kind: 'room', mode: 'create' });
    });

    it('removing by id deletes that room and keeps another one selected; removing the selected one drops it', async () => {
      const spaces = fakeSpaces();
      const { bridge, refreshDesks, refreshSpaces, result } = setup(spaces);
      act(() => result.current.enter());
      await waitFor(() => expect(result.current.spaces).toHaveLength(2));
      act(() => bridge.emit('layoutpick', { id: 'id-sala' }));

      await act(async () => result.current.remove('id-otra-sala'));
      expect(spaces.deleteSpace).toHaveBeenCalledWith('id-otra-sala');
      expect(refreshDesks).toHaveBeenCalledTimes(1);
      expect(refreshSpaces).toHaveBeenCalledTimes(1);
      expect(result.current.state).toEqual({ tag: 'selected', kind: 'room', id: 'id-sala' });

      await act(async () => result.current.remove('id-sala'));
      expect(spaces.deleteSpace).toHaveBeenLastCalledWith('id-sala');
      expect(result.current.state).toEqual({ tag: 'idle', kind: 'room' });
    });

    it('a failed remove by id shows why and reloads nothing', async () => {
      const spaces = fakeSpaces({ deleteSpace: vi.fn(async () => Promise.reject(new AdminError('unknown'))) });
      const { refreshSpaces, result } = setup(spaces);
      act(() => result.current.enter());
      await waitFor(() => expect(result.current.spaces).toHaveLength(2));

      await act(async () => result.current.remove('id-otra-sala'));

      expect(result.current.error).toBe('No se pudo completar la operación.');
      expect(refreshSpaces).not.toHaveBeenCalled();
      expect(result.current.state).toEqual({ tag: 'idle', kind: 'room' });
    });
  });

  it('exit vuelve a off y deja de publicar comando (null)', async () => {
    const { commands, result } = setup(fakeSpaces());
    act(() => result.current.enter());
    await waitFor(() => expect(result.current.spaces).toHaveLength(2));

    act(() => result.current.exit());

    expect(commands.at(-1)).toBeNull();
    expect(result.current.state).toEqual({ tag: 'off' });
  });

  describe('cruce sala<->escritorio (#74, PR4 addition)', () => {
    it('colocar una sala sobre un escritorio es invalido: el escritorio cuenta como obstaculo aunque no sea pickable', async () => {
      const { commands, result } = setup(fakeSpaces(), fakeDesks());
      act(() => result.current.enter());
      await waitFor(() => expect(result.current.spaces).toHaveLength(2));

      act(() => result.current.startCreate({ name: 'Sala nueva', w: 4, h: 4, capacity: null }));

      await waitFor(() => {
        const obstacles = commands.at(-1)?.placing?.obstacles ?? [];
        expect(obstacles).toContainEqual({ x0: 2, y0: 2, x1: 4, y1: 4 });
      });
      // El escritorio nunca es pickable en este modo: solo salas.
      expect(commands.at(-1)?.pickable.map((rect) => rect.id)).not.toContain('id-mesa');
    });

    it('mover una sala a su propio sitio anterior es valido: se excluye a si misma por id, no al escritorio', async () => {
      const { bridge, commands, result } = setup(fakeSpaces(), fakeDesks());
      act(() => result.current.enter());
      await waitFor(() => expect(result.current.spaces).toHaveLength(2));
      act(() => bridge.emit('layoutpick', { id: 'id-sala' }));
      act(() => result.current.startMove());

      await waitFor(() => {
        const obstacles = commands.at(-1)?.placing?.obstacles ?? [];
        // La sala propia (10,10,5,5) NO esta en los obstaculos...
        expect(obstacles).not.toContainEqual({ x0: 10, y0: 10, x1: 14, y1: 14 });
        // ...pero el escritorio SI sigue estando, porque no es lo que se mueve.
        expect(obstacles).toContainEqual({ x0: 2, y0: 2, x1: 4, y1: 4 });
      });
    });
  });
});

describe('useSpaceEditor: Escape frees the map one step at a time', () => {
  function escape(): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
    act(() => {
      window.dispatchEvent(event);
    });
    return event;
  }

  it('cancels a room being placed, then drops a selected one', async () => {
    const { bridge, result } = setup(fakeSpaces());
    act(() => result.current.enter());
    act(() => result.current.startCreate({ name: 'Sala nueva', w: 6, h: 6, capacity: 6 }));

    expect(escape().defaultPrevented).toBe(true);
    expect(result.current.state).toEqual({ tag: 'idle', kind: 'room' });

    act(() => bridge.emit('layoutpick', { id: 'id-sala' }));
    expect(escape().defaultPrevented).toBe(true);
    expect(result.current.state).toEqual({ tag: 'idle', kind: 'room' });
    expect(escape().defaultPrevented).toBe(false);
  });
});

describe('useSpaceEditor: desks picked from the default view of "Editar espacios"', () => {
  function setupPicking(desks: DeskAdminPort = fakeDesks()) {
    const bridge = createOfficeBridge();
    const spaces = fakeSpaces();
    const refreshDesks = vi.fn();
    const refreshSpaces = vi.fn();
    const commands: (OfficeCommandMap['layoutedit'])[] = [];
    bridge.onCommand('layoutedit', (command) => commands.push(command));
    const view = renderHook(
      ({ pickDesks }: { pickDesks: boolean }) => useSpaceEditor({ bridge, spaces, desks, refreshDesks, refreshSpaces, pickDesks }),
      { initialProps: { pickDesks: true } },
    );
    return { bridge, spaces, desks, refreshDesks, refreshSpaces, commands, ...view };
  }

  async function enterAndPickDesk(view: ReturnType<typeof setupPicking>): Promise<void> {
    act(() => view.result.current.enter());
    await waitFor(() => expect(view.commands.at(-1)?.pickable.map((rect) => rect.id)).toContain('id-mesa'));
    act(() => view.bridge.emit('layoutpick', { id: 'id-mesa' }));
  }

  it('makes the desks pickable with the rooms; without it they are only outlined', async () => {
    const picking = setupPicking();
    act(() => picking.result.current.enter());
    await waitFor(() =>
      expect(picking.commands.at(-1)?.pickable.map((rect) => rect.id).sort()).toEqual(['id-mesa', 'id-otra-sala', 'id-sala']),
    );
    expect(picking.commands.at(-1)?.outlines).toEqual([]);

    const plain = setup(fakeSpaces());
    act(() => plain.result.current.enter());
    await waitFor(() => expect(plain.commands.at(-1)?.outlines).toEqual([{ x0: 2, y0: 2, x1: 4, y1: 4 }]));
    expect(plain.commands.at(-1)?.pickable.map((rect) => rect.id)).not.toContain('id-mesa');
  });

  it('its move button places that desk with its own size, and a valid place moves it through the desk port', async () => {
    const view = setupPicking();
    await enterAndPickDesk(view);
    expect(view.commands.at(-1)?.selectedId).toBe('id-mesa');

    act(() => view.bridge.emit('layoutaction', { action: 'move', id: 'id-mesa' }));
    const placing = view.commands.at(-1)?.placing;
    expect(placing).toMatchObject({ w: 3, h: 3 });
    expect(placing?.snap).toBeUndefined();
    // The desk does not block its own move; the rooms still do.
    expect(placing?.obstacles).not.toContainEqual({ x0: 2, y0: 2, x1: 4, y1: 4 });
    expect(placing?.obstacles).toContainEqual({ x0: 10, y0: 10, x1: 14, y1: 14 });

    act(() => view.bridge.emit('layoutplace', { tx: 20, ty: 21, valid: true }));
    await waitFor(() => expect(view.desks.updateDesk).toHaveBeenCalledWith('id-mesa', { x: 20, y: 21 }));
    expect(view.spaces.updateSpace).not.toHaveBeenCalled();
    await waitFor(() => expect(view.result.current.state).toEqual({ tag: 'idle', kind: 'room' }));
    expect(view.refreshDesks).toHaveBeenCalledTimes(1);
    expect(view.refreshSpaces).toHaveBeenCalledTimes(1);
  });

  it('its trash deletes that desk through the desk port and drops the selection', async () => {
    const view = setupPicking();
    await enterAndPickDesk(view);

    await act(async () => view.bridge.emit('layoutaction', { action: 'delete', id: 'id-mesa' }));

    expect(view.desks.deleteDesk).toHaveBeenCalledWith('id-mesa');
    expect(view.spaces.deleteSpace).not.toHaveBeenCalled();
    expect(view.result.current.state).toEqual({ tag: 'idle', kind: 'room' });
    expect(view.refreshDesks).toHaveBeenCalledTimes(1);
  });

  it('a refused desk move shows why', async () => {
    const view = setupPicking(fakeDesks({ updateDesk: vi.fn(async () => Promise.reject(new AdminError('unknown'))) }));
    await enterAndPickDesk(view);

    act(() => view.bridge.emit('layoutaction', { action: 'move', id: 'id-mesa' }));
    act(() => view.bridge.emit('layoutplace', { tx: 20, ty: 21, valid: true }));

    await waitFor(() => expect(view.result.current.error).not.toBeNull());
    expect(view.result.current.state).toEqual({ tag: 'idle', kind: 'room' });
  });

  it('putdown ends the move of that desk or room with it selected, and moves nothing', async () => {
    const view = setupPicking();
    await enterAndPickDesk(view);
    act(() => view.bridge.emit('layoutaction', { action: 'move', id: 'id-mesa' }));

    act(() => view.bridge.emit('layoutaction', { action: 'putdown', id: 'id-mesa' }));
    expect(view.result.current.state).toEqual({ tag: 'selected', kind: 'room', id: 'id-mesa' });

    act(() => view.bridge.emit('layoutpick', { id: 'id-sala' }));
    act(() => view.bridge.emit('layoutaction', { action: 'move', id: 'id-sala' }));
    act(() => view.bridge.emit('layoutaction', { action: 'putdown', id: 'id-sala' }));
    expect(view.result.current.state).toEqual({ tag: 'selected', kind: 'room', id: 'id-sala' });
    expect(view.desks.updateDesk).not.toHaveBeenCalled();
    expect(view.spaces.updateSpace).not.toHaveBeenCalled();
  });

  it('a pick on a room with a desk selected switches to the room, no Escape in between', async () => {
    const view = setupPicking();
    await enterAndPickDesk(view);

    act(() => view.bridge.emit('layoutpick', { id: 'id-sala' }));

    expect(view.result.current.state).toEqual({ tag: 'selected', kind: 'room', id: 'id-sala' });
    expect(view.commands.at(-1)?.selectedId).toBe('id-sala');
  });

  it('turning it off drops a selected desk, and leaves a selected room alone', async () => {
    const view = setupPicking();
    await enterAndPickDesk(view);

    view.rerender({ pickDesks: false });
    expect(view.result.current.state).toEqual({ tag: 'idle', kind: 'room' });
    expect(view.commands.at(-1)?.pickable.map((rect) => rect.id)).not.toContain('id-mesa');

    act(() => view.bridge.emit('layoutpick', { id: 'id-sala' }));
    view.rerender({ pickDesks: true });
    view.rerender({ pickDesks: false });
    expect(view.result.current.state).toEqual({ tag: 'selected', kind: 'room', id: 'id-sala' });
  });
});
