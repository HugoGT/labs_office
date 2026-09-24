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

  it('mover: un layoutplace valido llama a updateSpace con el id seleccionado', async () => {
    const spaces = fakeSpaces();
    const { bridge, refreshDesks, refreshSpaces, result } = setup(spaces);
    act(() => result.current.enter());
    await waitFor(() => expect(result.current.spaces).toHaveLength(2));
    act(() => bridge.emit('layoutpick', { id: 'id-sala' }));
    act(() => result.current.startMove());

    act(() => bridge.emit('layoutplace', { tx: 3, ty: 4, valid: true }));

    await waitFor(() => expect(spaces.updateSpace).toHaveBeenCalledWith('id-sala', { x: 3, y: 4 }));
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
