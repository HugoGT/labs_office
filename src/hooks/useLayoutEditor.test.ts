/**
 * Cableado del reductor de `layoutEditor.ts` a un `DeskAdminPort` real y al
 * bridge (#74, PR3c). Las reglas puras del reductor ya las cubre
 * `layoutEditor.test.ts`; aqui se prueba el CICLO DE VIDA -- que el comando
 * llega a la escena, que un `layoutplace` valido llama al puerto correcto, y
 * que un fallo se cuenta sin tocar la lista local.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminError } from '../dashboard/adminPort';
import type { AdminDesk, DeskAdminPort } from '../dashboard/deskAdminPort';
import type { AdminSpace, SpacesAdminPort } from '../dashboard/spacesAdminPort';
import { createOfficeBridge, type OfficeCommandMap } from '../game/officeBridge';
import { useLayoutEditor } from './useLayoutEditor';

const MESA: AdminDesk = { id: 'id-mesa', label: 'Mesa 4', x: 10, y: 10, w: 3, h: 3, occupant: null };
const OTRA: AdminDesk = { id: 'id-otra', label: 'Mesa 5', x: 20, y: 20, w: 3, h: 3, occupant: null };
// Cubiculo de MESA en /spaces: mismo x/y, id DISTINTO -- no debe duplicar a MESA en los obstaculos (#74, PR4 addition).
const CUBICULO_MESA: AdminSpace = { id: 'id-space-mesa', name: 'Mesa 4', x: 10, y: 10, w: 3, h: 3, capacity: null, kind: 'desk' };
const SALA: AdminSpace = { id: 'id-sala', name: 'Sala grande', x: 0, y: 0, w: 4, h: 4, capacity: null, kind: 'room' };

function fakeDesks(overrides: Partial<DeskAdminPort> = {}): DeskAdminPort {
  return {
    listDesks: vi.fn(async () => [MESA, OTRA]),
    createDesk: vi.fn(async () => MESA),
    updateDesk: vi.fn(async () => MESA),
    deleteDesk: vi.fn(async () => undefined),
    ...overrides,
  };
}

function fakeSpaces(overrides: Partial<SpacesAdminPort> = {}): SpacesAdminPort {
  return {
    listSpaces: vi.fn(async () => [CUBICULO_MESA, SALA]),
    createSpace: vi.fn(),
    updateSpace: vi.fn(),
    deleteSpace: vi.fn(),
    ...overrides,
  } as SpacesAdminPort;
}

function setup(desks: DeskAdminPort, spaces: SpacesAdminPort = fakeSpaces()) {
  const bridge = createOfficeBridge();
  const refreshDesks = vi.fn();
  const refreshSpaces = vi.fn();
  const commands: (OfficeCommandMap['layoutedit'])[] = [];
  bridge.onCommand('layoutedit', (command) => commands.push(command));

  const view = renderHook(() => useLayoutEditor({ bridge, desks, spaces, refreshDesks, refreshSpaces }));

  return { bridge, desks, spaces, refreshDesks, refreshSpaces, commands, ...view };
}

describe('useLayoutEditor (#74, PR3c)', () => {
  it('entrar carga la lista de escritorios y publica un comando pickable con ellos', async () => {
    const { desks, commands, result } = setup(fakeDesks());

    act(() => result.current.enter());

    await waitFor(() => expect(desks.listDesks).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      const last = commands.at(-1);
      expect(last?.pickable.map((rect) => rect.id)).toEqual(['id-mesa', 'id-otra']);
    });
  });

  it('fuera de modo edicion no hay comando pickable: el ultimo publicado es null', () => {
    const { commands } = setup(fakeDesks());

    expect(commands.at(-1)).toBeNull();
  });

  it('un layoutpick selecciona ese escritorio', async () => {
    const { bridge, result } = setup(fakeDesks());
    act(() => result.current.enter());
    await waitFor(() => expect(result.current.desks).toHaveLength(2));

    act(() => bridge.emit('layoutpick', { id: 'id-mesa' }));

    expect(result.current.state).toEqual({ tag: 'selected', kind: 'desk', id: 'id-mesa' });
  });

  it('select() elige el mismo escritorio que un layoutpick, sin pasar por el bridge', async () => {
    const { result } = setup(fakeDesks());
    act(() => result.current.enter());
    await waitFor(() => expect(result.current.desks).toHaveLength(2));

    act(() => result.current.select('id-otra'));

    expect(result.current.state).toEqual({ tag: 'selected', kind: 'desk', id: 'id-otra' });
  });

  it('crear: un layoutplace valido llama a createDesk con la etiqueta pedida y la posicion encajada', async () => {
    const desks = fakeDesks();
    const { bridge, refreshDesks, refreshSpaces, result } = setup(desks);
    act(() => result.current.enter());
    await waitFor(() => expect(result.current.desks).toHaveLength(2));

    act(() => result.current.startCreate('Mesa 6'));
    act(() => bridge.emit('layoutplace', { tx: 7, ty: 8, valid: true }));

    await waitFor(() => expect(desks.createDesk).toHaveBeenCalledWith({ label: 'Mesa 6', x: 7, y: 8 }));
    await waitFor(() => expect(refreshDesks).toHaveBeenCalledTimes(1));
    expect(refreshSpaces).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.state).toEqual({ tag: 'idle', kind: 'desk' }));
  });

  it('mover: un layoutplace valido llama a updateDesk con el id seleccionado', async () => {
    const desks = fakeDesks();
    const { bridge, refreshDesks, refreshSpaces, result } = setup(desks);
    act(() => result.current.enter());
    await waitFor(() => expect(result.current.desks).toHaveLength(2));
    act(() => bridge.emit('layoutpick', { id: 'id-mesa' }));
    act(() => result.current.startMove());

    act(() => bridge.emit('layoutplace', { tx: 3, ty: 4, valid: true }));

    await waitFor(() => expect(desks.updateDesk).toHaveBeenCalledWith('id-mesa', { x: 3, y: 4 }));
    await waitFor(() => expect(refreshDesks).toHaveBeenCalledTimes(1));
    expect(refreshSpaces).toHaveBeenCalledTimes(1);
  });

  it('un layoutplace invalido no llama al puerto: el ghost sigue pendiente de intentarlo de nuevo', async () => {
    const desks = fakeDesks();
    const { bridge, refreshDesks, result } = setup(desks);
    act(() => result.current.enter());
    await waitFor(() => expect(result.current.desks).toHaveLength(2));
    act(() => result.current.startCreate('Mesa 6'));

    act(() => bridge.emit('layoutplace', { tx: 7, ty: 8, valid: false }));

    expect(desks.createDesk).not.toHaveBeenCalled();
    expect(refreshDesks).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ tag: 'placing', kind: 'desk', mode: 'create' });
  });

  it('un fallo del servidor al crear se traduce con describeAdminError y no relee la lista', async () => {
    const desks = fakeDesks({ createDesk: vi.fn(async () => Promise.reject(new AdminError('desk-overlap'))) });
    const { bridge, refreshDesks, refreshSpaces, result } = setup(desks);
    act(() => result.current.enter());
    await waitFor(() => expect(result.current.desks).toHaveLength(2));
    act(() => result.current.startCreate('Mesa 6'));

    act(() => bridge.emit('layoutplace', { tx: 7, ty: 8, valid: true }));

    await waitFor(() =>
      expect(result.current.error).toBe(
        'Esas coordenadas chocan con otro escritorio: cada uno ocupa 3×3 casillas y ni los bordes pueden tocarse.',
      ),
    );
    expect(refreshDesks).not.toHaveBeenCalled();
    expect(refreshSpaces).not.toHaveBeenCalled();
    // `listDesks` solo se llamo UNA vez, al entrar: un fallo no vuelve a leer.
    expect(desks.listDesks).toHaveBeenCalledTimes(1);
  });

  it('borrar: llama a deleteDesk con el seleccionado y relee ambas listas', async () => {
    const desks = fakeDesks();
    const { bridge, refreshDesks, refreshSpaces, result } = setup(desks);
    act(() => result.current.enter());
    await waitFor(() => expect(result.current.desks).toHaveLength(2));
    act(() => bridge.emit('layoutpick', { id: 'id-mesa' }));

    await act(async () => result.current.remove());

    expect(desks.deleteDesk).toHaveBeenCalledWith('id-mesa');
    expect(refreshDesks).toHaveBeenCalledTimes(1);
    expect(refreshSpaces).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({ tag: 'idle', kind: 'desk' });
  });

  it('un fallo al borrar se cuenta y no releva la seleccion', async () => {
    const desks = fakeDesks({ deleteDesk: vi.fn(async () => Promise.reject(new AdminError('unknown'))) });
    const { bridge, refreshDesks, result } = setup(desks);
    act(() => result.current.enter());
    await waitFor(() => expect(result.current.desks).toHaveLength(2));
    act(() => bridge.emit('layoutpick', { id: 'id-mesa' }));

    await act(async () => result.current.remove());

    expect(result.current.error).toBe('No se pudo completar la operación.');
    expect(refreshDesks).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ tag: 'selected', kind: 'desk', id: 'id-mesa' });
  });

  describe('cruce escritorio<->sala (#74, PR4 addition)', () => {
    it('crear un escritorio incluye las salas como obstaculo, sin ofrecerlas como pickable', async () => {
      const { commands, result } = setup(fakeDesks(), fakeSpaces());
      act(() => result.current.enter());
      await waitFor(() => expect(result.current.desks).toHaveLength(2));

      act(() => result.current.startCreate('Mesa 6'));

      await waitFor(() => {
        const obstacles = commands.at(-1)?.placing?.obstacles ?? [];
        expect(obstacles).toContainEqual({ x0: 0, y0: 0, x1: 3, y1: 3 });
      });
      expect(commands.at(-1)?.pickable.map((rect) => rect.id)).not.toContain('id-sala');
    });

    it('el cubiculo de un escritorio en /spaces no duplica el obstaculo de ese mismo escritorio', async () => {
      const { commands, result } = setup(fakeDesks(), fakeSpaces());
      act(() => result.current.enter());
      await waitFor(() => expect(result.current.desks).toHaveLength(2));

      act(() => result.current.startCreate('Mesa 6'));

      await waitFor(() => {
        const obstacles = commands.at(-1)?.placing?.obstacles ?? [];
        // MESA (10,10,3,3) aparece una sola vez, no dos (una por desks, otra por el cubiculo de /spaces).
        expect(obstacles.filter((rect) => rect.x0 === 10 && rect.y0 === 10)).toHaveLength(1);
      });
    });

    it('mover un escritorio a su propio sitio anterior es valido: se excluye a si mismo, la sala sigue siendo obstaculo', async () => {
      const { bridge, commands, result } = setup(fakeDesks(), fakeSpaces());
      act(() => result.current.enter());
      await waitFor(() => expect(result.current.desks).toHaveLength(2));
      act(() => bridge.emit('layoutpick', { id: 'id-mesa' }));
      act(() => result.current.startMove());

      await waitFor(() => {
        const obstacles = commands.at(-1)?.placing?.obstacles ?? [];
        expect(obstacles).not.toContainEqual({ x0: 10, y0: 10, x1: 12, y1: 12 });
        expect(obstacles).toContainEqual({ x0: 0, y0: 0, x1: 3, y1: 3 });
      });
    });

    it('una mutacion con exito relee tambien las salas, no solo los escritorios', async () => {
      const desks = fakeDesks();
      const spaces = fakeSpaces();
      const { bridge, result } = setup(desks, spaces);
      act(() => result.current.enter());
      await waitFor(() => expect(result.current.desks).toHaveLength(2));
      act(() => result.current.startCreate('Mesa 6'));

      act(() => bridge.emit('layoutplace', { tx: 7, ty: 8, valid: true }));

      await waitFor(() => expect(spaces.listSpaces).toHaveBeenCalledTimes(2));
    });
  });

  it('exit vuelve a off y deja de publicar comando (null)', async () => {
    const { commands, result } = setup(fakeDesks());
    act(() => result.current.enter());
    await waitFor(() => expect(result.current.desks).toHaveLength(2));

    act(() => result.current.exit());

    expect(commands.at(-1)).toBeNull();
    expect(result.current.state).toEqual({ tag: 'off' });
  });
});
