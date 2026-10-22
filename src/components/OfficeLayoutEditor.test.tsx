import { act, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminError } from '../dashboard/adminPort';
import type { AdminDesk, DeskAdminPort } from '../dashboard/deskAdminPort';
import type { AdminSpace, SpacesAdminPort } from '../dashboard/spacesAdminPort';
import type { LayoutEditCommand } from '../game/layoutEditor';
import { createOfficeBridge } from '../game/officeBridge';
import OfficeLayoutEditor, { type OfficeLayoutEditorProps } from './OfficeLayoutEditor';

const MESA: AdminDesk = { id: 'id-mesa', label: 'Mesa 4', x: 10, y: 10, w: 3, h: 3, occupant: null };
const SALA: AdminSpace = { id: 'id-sala', name: 'Sala grande', x: 0, y: 0, w: 4, h: 4, capacity: null, kind: 'room' };

describe('OfficeLayoutEditor: selected submenu lifecycle (#147)', () => {
  it.each(['decor', 'spaces', 'terrain', 'collision'] as const)('unmounting %s clears editing and its bridge mode', async (section) => {
    const bridge = createOfficeBridge();
    const command = section === 'decor' ? 'decoredit' : section === 'terrain' ? 'terrainedit' : section === 'collision' ? 'collisionedit' : 'layoutedit';
    const commands: unknown[] = [];
    bridge.onCommand(command, (value) => commands.push(value));
    const onEditingChange = vi.fn();
    const props: OfficeLayoutEditorProps = {
      bridge, desks: fakeDesks(), spaces: fakeSpaces(), refreshDesks: vi.fn(), refreshSpaces: vi.fn(),
      terrain: { setBlock: vi.fn(), setBlocks: vi.fn(), setWalls: vi.fn() }, collisions: { saveRects: vi.fn(), reset: vi.fn() },
      decor: { setDecor: vi.fn() }, section, onEditingChange,
    };
    const { unmount } = render(<OfficeLayoutEditor {...props} />);
    await screen.findByRole('button', { name: 'Salir' });
    expect(onEditingChange).toHaveBeenLastCalledWith(true);
    expect(commands.at(-1)).not.toBeNull();
    unmount();
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
    expect(commands.at(-1)).toBeNull();
  });

  it('"Editar espacios" opens on the room form with desks and rooms each behind one button, with one exit for both', async () => {
    const bridge = createOfficeBridge();
    const onExit = vi.fn();
    const onEditingChange = vi.fn();
    const props = { bridge, desks: fakeDesks(), spaces: fakeSpaces(), refreshDesks: vi.fn(), refreshSpaces: vi.fn(), onEditingChange, onExit };
    render(<OfficeLayoutEditor {...props} section="spaces" />);
    await waitFor(() => expect(props.spaces.listSpaces).toHaveBeenCalled());
    await act(async () => {});

    expect(screen.getByRole('heading', { name: 'Editar espacios' })).toBeInTheDocument();
    const headings = screen.getAllByRole('heading').map((heading) => heading.textContent);
    expect(headings.indexOf('Escritorios')).toBeLessThan(headings.indexOf('Salas'));
    expect(screen.getByRole('button', { name: 'Editar escritorios' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Colocar nueva sala' })).toBeInTheDocument();
    // "Crear escritorio" sits beside the submenu, at the level of "Salas"; neither list is shown.
    expect(screen.getByRole('button', { name: 'Crear escritorio' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar salas' })).toBeInTheDocument();
    expect(screen.queryByText('Mesa 4')).not.toBeInTheDocument();
    expect(screen.queryByText('Sala grande')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Salir' })).toHaveLength(1);
    expect(onEditingChange).toHaveBeenLastCalledWith(true);

    await userEvent.click(screen.getByRole('button', { name: 'Salir' }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('inside "Editar espacios", "Editar escritorios" swaps the rooms for the desk view, and "Volver" swaps them back', async () => {
    const bridge = createOfficeBridge();
    const commands: (LayoutEditCommand | null)[] = [];
    bridge.onCommand('layoutedit', (value) => commands.push(value));
    const onEditingChange = vi.fn();
    const props = { bridge, desks: fakeDesks(), spaces: fakeSpaces(), refreshDesks: vi.fn(), refreshSpaces: vi.fn(), onEditingChange };
    render(<OfficeLayoutEditor {...props} section="spaces" />);
    await waitFor(() => expect(commands.at(-1)).toMatchObject({ pickable: [{ id: 'id-sala' }] }));
    commands.length = 0;
    onEditingChange.mockClear();

    await userEvent.click(screen.getByRole('button', { name: 'Editar escritorios' }));

    expect(await screen.findByText('Mesa 4')).toBeInTheDocument();
    // Only the list in here: creating a desk is not part of the submenu.
    expect(screen.queryByRole('button', { name: 'Crear escritorio' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Volver' })).toBeInTheDocument();
    // The rooms are gone altogether, not folded behind their entry button.
    expect(screen.queryByRole('heading', { name: 'Salas' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar salas' })).not.toBeInTheDocument();
    expect(screen.queryByText('Sala grande')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Colocar nueva sala' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Salir' })).toHaveLength(1);
    // The rooms overlay leaves with its owner: the desk command replaces it and nothing nulls it afterwards.
    await waitFor(() => expect(commands.at(-1)).toMatchObject({ pickable: [{ id: 'id-mesa' }] }));
    expect(commands).not.toContain(null);
    expect(onEditingChange).not.toHaveBeenCalledWith(false);

    await userEvent.click(screen.getByRole('button', { name: 'Volver' }));

    expect(await screen.findByRole('button', { name: 'Colocar nueva sala' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar salas' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar escritorios' })).toBeInTheDocument();
    expect(screen.queryByText('Mesa 4')).not.toBeInTheDocument();
    await waitFor(() => expect(commands.at(-1)).toMatchObject({ pickable: [{ id: 'id-sala' }] }));
    await waitFor(() => expect(onEditingChange).toHaveBeenLastCalledWith(true));
  });

  it('inside "Editar espacios", "Editar salas" swaps the desks and the form for the room list, and "Volver" swaps them back', async () => {
    const bridge = createOfficeBridge();
    const commands: (LayoutEditCommand | null)[] = [];
    bridge.onCommand('layoutedit', (value) => commands.push(value));
    const onEditingChange = vi.fn();
    const props = { bridge, desks: fakeDesks(), spaces: fakeSpaces(), refreshDesks: vi.fn(), refreshSpaces: vi.fn(), onEditingChange };
    render(<OfficeLayoutEditor {...props} section="spaces" />);
    await waitFor(() => expect(commands.at(-1)).toMatchObject({ pickable: [{ id: 'id-sala' }] }));
    commands.length = 0;
    onEditingChange.mockClear();

    await userEvent.click(screen.getByRole('button', { name: 'Editar salas' }));

    expect(await screen.findByText('Sala grande')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mover Sala grande' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Volver' })).toBeInTheDocument();
    // The desks are gone altogether, like the rooms in the desk view.
    expect(screen.queryByRole('heading', { name: 'Escritorios' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar escritorios' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Crear escritorio' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Colocar nueva sala' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Salir' })).toHaveLength(1);
    // The rooms keep the map: nothing nulls their overlay.
    expect(commands).not.toContain(null);
    expect(onEditingChange).not.toHaveBeenCalledWith(false);

    await userEvent.click(screen.getByRole('button', { name: 'Volver' }));

    expect(screen.getByRole('button', { name: 'Editar escritorios' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crear escritorio' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Colocar nueva sala' })).toBeInTheDocument();
    expect(screen.queryByText('Sala grande')).not.toBeInTheDocument();
    // Whatever the rooms re-emit is still theirs: the desks never take the overlay.
    expect(commands.every((command) => command?.pickable.some((rect) => rect.id === 'id-sala'))).toBe(true);
  });

  describe('"Crear escritorio" from the default view', () => {
    function renderSpaces(overrides: Partial<OfficeLayoutEditorProps> = {}) {
      const bridge = overrides.bridge ?? createOfficeBridge();
      const commands: (LayoutEditCommand | null)[] = [];
      bridge.onCommand('layoutedit', (value) => commands.push(value));
      const desks = fakeDesks();
      const onEditingChange = vi.fn();
      const props = { bridge, desks, spaces: fakeSpaces(), refreshDesks: vi.fn(), refreshSpaces: vi.fn(), onEditingChange, ...overrides };
      render(<OfficeLayoutEditor {...props} section="spaces" />);
      return { bridge, commands, desks: props.desks, onEditingChange };
    }

    it('starts the placement at once and hides the rooms while the desk editor holds the panel', async () => {
      const { commands, onEditingChange } = renderSpaces();
      await roomsLoaded();

      await userEvent.click(screen.getByRole('button', { name: 'Crear escritorio' }));

      expect(screen.getByText(/Toca el nuevo sitio en el mapa para confirmarlo/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Salas' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Colocar nueva sala' })).not.toBeInTheDocument();
      await waitFor(() => expect(commands.at(-1)).toMatchObject({ placing: { w: 3, h: 3 } }));
      expect(onEditingChange).toHaveBeenLastCalledWith(true);
    });

    it('a map click creates the desk and the rooms come back expanded', async () => {
      const { bridge, desks, commands, onEditingChange } = renderSpaces();
      await roomsLoaded();
      await userEvent.click(screen.getByRole('button', { name: 'Crear escritorio' }));

      act(() => bridge.emit('layoutplace', { tx: 20, ty: 30, valid: true }));

      await waitFor(() => expect(desks.createDesk).toHaveBeenCalledWith({ x: 20, y: 30 }));
      expect(await screen.findByRole('button', { name: 'Colocar nueva sala' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Editar escritorios' })).toBeInTheDocument();
      expect(screen.queryByText(/Toca el nuevo sitio/)).not.toBeInTheDocument();
      expect(screen.queryByText('Mesa 4')).not.toBeInTheDocument();
      await waitFor(() => expect(commands.at(-1)).toMatchObject({ pickable: [{ id: 'id-sala' }] }));
      await waitFor(() => expect(onEditingChange).toHaveBeenLastCalledWith(true));
    });

    it('"Cancelar" brings the rooms back, still without creating anything', async () => {
      const { desks } = renderSpaces();
      await roomsLoaded();
      await userEvent.click(screen.getByRole('button', { name: 'Crear escritorio' }));

      await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

      expect(await screen.findByRole('button', { name: 'Colocar nueva sala' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Editar escritorios' })).toBeInTheDocument();
      expect(desks.createDesk).not.toHaveBeenCalled();
    });

    it('a refused desk leaves its reason visible next to the rooms', async () => {
      const bridge = createOfficeBridge();
      const desks = { ...fakeDesks(), createDesk: vi.fn(async () => Promise.reject(new AdminError('desk-on-wall'))) } as unknown as DeskAdminPort;
      renderSpaces({ bridge, desks });
      await roomsLoaded();
      await userEvent.click(screen.getByRole('button', { name: 'Crear escritorio' }));

      act(() => bridge.emit('layoutplace', { tx: 1, ty: 2, valid: true }));

      expect(await screen.findByRole('alert')).toHaveTextContent('Hay una pared en ese lugar');
      expect(await screen.findByRole('button', { name: 'Colocar nueva sala' })).toBeInTheDocument();
    });
  });

  describe('Escape, one level per press', () => {
    function renderSpacesWithExit() {
      const onExit = vi.fn();
      const props = { bridge: createOfficeBridge(), desks: fakeDesks(), spaces: fakeSpaces(), refreshDesks: vi.fn(), refreshSpaces: vi.fn(), onExit };
      render(<OfficeLayoutEditor {...props} section="spaces" />);
      return { onExit };
    }

    it('the default view exits the editor like "Salir"', async () => {
      const { onExit } = renderSpacesWithExit();
      await roomsLoaded();

      await userEvent.keyboard('{Escape}');

      expect(onExit).toHaveBeenCalledTimes(1);
    });

    it('the desk list goes back to the default view first, and only the next press exits', async () => {
      const { onExit } = renderSpacesWithExit();
      await roomsLoaded();
      await userEvent.click(screen.getByRole('button', { name: 'Editar escritorios' }));
      await screen.findByText('Mesa 4');

      await userEvent.keyboard('{Escape}');
      expect(await screen.findByRole('button', { name: 'Colocar nueva sala' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Editar escritorios' })).toBeInTheDocument();
      expect(onExit).not.toHaveBeenCalled();

      await userEvent.keyboard('{Escape}');
      expect(onExit).toHaveBeenCalledTimes(1);
    });

    it('the room list goes back to the default view first, and only the next press exits', async () => {
      const { onExit } = renderSpacesWithExit();
      await userEvent.click(screen.getByRole('button', { name: 'Editar salas' }));
      await screen.findByText('Sala grande');

      await userEvent.keyboard('{Escape}');
      expect(screen.queryByText('Sala grande')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Editar escritorios' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Editar salas' })).toBeInTheDocument();
      expect(onExit).not.toHaveBeenCalled();

      await userEvent.keyboard('{Escape}');
      expect(onExit).toHaveBeenCalledTimes(1);
    });

    it('a placement is cancelled first, from either part', async () => {
      const { onExit } = renderSpacesWithExit();
      await roomsLoaded();
      await userEvent.click(screen.getByRole('button', { name: 'Crear escritorio' }));

      await userEvent.keyboard('{Escape}');

      expect(await screen.findByRole('button', { name: 'Colocar nueva sala' })).toBeInTheDocument();
      expect(screen.queryByText(/Toca el nuevo sitio/)).not.toBeInTheDocument();
      expect(onExit).not.toHaveBeenCalled();
    });
  });

  it('a room being placed does not leave a ghost behind when the desk view opens', async () => {
    const bridge = createOfficeBridge();
    const commands: (LayoutEditCommand | null)[] = [];
    bridge.onCommand('layoutedit', (value) => commands.push(value));
    const props = { bridge, desks: fakeDesks(), spaces: fakeSpaces(), refreshDesks: vi.fn(), refreshSpaces: vi.fn() };
    render(<OfficeLayoutEditor {...props} section="spaces" />);
    await waitFor(() => expect(commands.at(-1)).toMatchObject({ pickable: [{ id: 'id-sala' }] }));
    await userEvent.type(screen.getByLabelText('Nombre de la nueva sala'), 'Office');
    await userEvent.click(screen.getByRole('button', { name: 'Colocar nueva sala' }));
    await waitFor(() => expect(commands.at(-1)).toMatchObject({ placing: expect.anything() }));

    await userEvent.click(screen.getByRole('button', { name: 'Editar escritorios' }));

    await screen.findByText('Mesa 4');
    await waitFor(() => expect(commands.at(-1)).toMatchObject({ pickable: [{ id: 'id-mesa' }], placing: null }));
  });

  it.each(['terrain', 'collision'] as const)('removing the selected %s port unmounts its editing owner', async (section) => {
    const bridge = createOfficeBridge();
    const command = section === 'terrain' ? 'terrainedit' : 'collisionedit';
    const emit = vi.fn();
    bridge.onCommand(command, emit);
    const props = {
      bridge, desks: fakeDesks(), spaces: fakeSpaces(), refreshDesks: vi.fn(), refreshSpaces: vi.fn(),
      terrain: { setBlock: vi.fn(), setBlocks: vi.fn(), setWalls: vi.fn() }, collisions: { saveRects: vi.fn(), reset: vi.fn() }, onEditingChange: vi.fn(), section,
    };
    const { rerender } = render(<OfficeLayoutEditor {...props} />);
    await screen.findByRole('button', { name: 'Salir' });
    expect(props.onEditingChange).toHaveBeenLastCalledWith(true);
    rerender(<OfficeLayoutEditor {...props} {...{ [section === 'terrain' ? 'terrain' : 'collisions']: null }} />);
    expect(props.onEditingChange).toHaveBeenLastCalledWith(false);
    expect(emit).toHaveBeenLastCalledWith(null);
  });
});

/** The embedded default view lists no rooms: wait for the room editor's first read to settle. */
async function roomsLoaded(): Promise<void> {
  // The form shows only once the room editor is on, unlike the heading of its off view.
  await screen.findByRole('button', { name: 'Colocar nueva sala' });
  await act(async () => {});
}

function fakeDesks(): DeskAdminPort {
  return {
    listDesks: vi.fn(async () => [MESA]),
    createDesk: vi.fn(),
    updateDesk: vi.fn(),
    deleteDesk: vi.fn(),
  } as unknown as DeskAdminPort;
}

function fakeSpaces(): SpacesAdminPort {
  return {
    listSpaces: vi.fn(async () => [SALA]),
    createSpace: vi.fn(),
    updateSpace: vi.fn(),
    deleteSpace: vi.fn(),
  } as unknown as SpacesAdminPort;
}

function renderEditor(onEditingChange = vi.fn(), forceExit = false) {
  const bridge = createOfficeBridge();
  render(
    <OfficeLayoutEditor
      bridge={bridge}
      desks={fakeDesks()}
      spaces={fakeSpaces()}
      refreshDesks={vi.fn()}
      refreshSpaces={vi.fn()}
      onEditingChange={onEditingChange}
      forceExit={forceExit}
    />,
  );
  return { bridge, onEditingChange };
}

describe('OfficeLayoutEditor (#74, PR4): monta ambas secciones', () => {
  it('monta la seccion de escritorios y la de salas juntas, no una en lugar de la otra', () => {
    renderEditor();

    expect(screen.getByRole('button', { name: /Editar escritorios/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Editar salas/ })).toBeInTheDocument();
  });

  it('entrar en la seccion de escritorios reporta editando=true', async () => {
    const { onEditingChange } = renderEditor();

    await userEvent.click(screen.getByRole('button', { name: /Editar escritorios/ }));

    expect(onEditingChange).toHaveBeenLastCalledWith(true);
  });

  it('entrar en la seccion de salas TAMBIEN reporta editando=true (no solo escritorios)', async () => {
    const { onEditingChange } = renderEditor();

    await userEvent.click(screen.getByRole('button', { name: /Editar salas/ }));

    expect(onEditingChange).toHaveBeenLastCalledWith(true);
  });

  it('salir de la unica seccion activa reporta editando=false', async () => {
    const { onEditingChange } = renderEditor();

    await userEvent.click(screen.getByRole('button', { name: /Editar salas/ }));
    expect(onEditingChange).toHaveBeenLastCalledWith(true);
    await userEvent.click(screen.getByRole('button', { name: /Salir/ }));

    expect(onEditingChange).toHaveBeenLastCalledWith(false);
  });

  it('forceExit se reenvia a las dos secciones', async () => {
    const bridge = createOfficeBridge();
    const onEditingChange = vi.fn();
    const { rerender } = render(
      <OfficeLayoutEditor
        bridge={bridge}
        desks={fakeDesks()}
        spaces={fakeSpaces()}
        refreshDesks={vi.fn()}
        refreshSpaces={vi.fn()}
        onEditingChange={onEditingChange}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Editar escritorios/ }));

    rerender(
      <OfficeLayoutEditor
        bridge={bridge}
        desks={fakeDesks()}
        spaces={fakeSpaces()}
        refreshDesks={vi.fn()}
        refreshSpaces={vi.fn()}
        onEditingChange={onEditingChange}
        forceExit
      />,
    );

    expect(screen.queryByRole('button', { name: /Salir/ })).not.toBeInTheDocument();
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
  });
});

/**
 * Exclusividad entre las dos secciones (#74, PR4 correction): las dos son
 * reductores separados sobre el MISMO overlay (`LayoutEditLayer`), asi que a
 * lo sumo una puede estar activa. Ver la nota de cabecera de este archivo.
 */
describe('OfficeLayoutEditor (#74, PR4 correction): exclusividad escritorios<->salas', () => {
  it('entrar en salas mientras escritorios esta activo saca a escritorios: solo queda un boton "Salir"', async () => {
    renderEditor();

    await userEvent.click(screen.getByRole('button', { name: /Editar escritorios/ }));
    expect(await screen.findByText('Mesa 4')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Editar salas/ }));

    expect(screen.getAllByRole('button', { name: /Salir/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Editar escritorios/ })).toBeInTheDocument();
  });

  it('entrar en escritorios mientras salas esta activo saca a salas: solo queda un boton "Salir"', async () => {
    renderEditor();

    await userEvent.click(screen.getByRole('button', { name: /Editar salas/ }));
    expect(await screen.findByText('Sala grande')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Editar escritorios/ }));

    expect(screen.getAllByRole('button', { name: /Salir/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Editar salas/ })).toBeInTheDocument();
  });

  it('entrar en salas mientras escritorios esta activo: el bridge recibe null (sale escritorios) y LUEGO el comando de salas, en ese orden', async () => {
    const bridge = createOfficeBridge();
    const commands: (LayoutEditCommand | null)[] = [];
    bridge.onCommand('layoutedit', (command) => commands.push(command));
    render(
      <OfficeLayoutEditor
        bridge={bridge}
        desks={fakeDesks()}
        spaces={fakeSpaces()}
        refreshDesks={vi.fn()}
        refreshSpaces={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /Editar escritorios/ }));
    await screen.findByText('Mesa 4');
    const before = commands.length;

    await userEvent.click(screen.getByRole('button', { name: /Editar salas/ }));

    // Las salas todavia no han terminado de cargar en este instante sincrono
    // (`listSpaces()` es async): el comando real de salas todavia pinta
    // `pickable: []`, pero YA es un comando de salas, no el `null` de
    // escritorios saliendo -- eso es justo lo que ordena esta asercion.
    expect(commands.slice(before, before + 2)).toEqual([
      null,
      { pickable: [], selectedId: null, placing: null, outlines: [] },
    ]);
  });

  it('un layoutpick lo atiende solo la seccion activa: seleccionar una sala no reactiva ni "selecciona" nada en escritorios', async () => {
    const bridge = createOfficeBridge();
    render(
      <OfficeLayoutEditor
        bridge={bridge}
        desks={fakeDesks()}
        spaces={fakeSpaces()}
        refreshDesks={vi.fn()}
        refreshSpaces={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /Editar escritorios/ }));
    await screen.findByText('Mesa 4');
    await userEvent.click(screen.getByRole('button', { name: /Editar salas/ }));
    await screen.findByText('Sala grande');

    act(() => bridge.emit('layoutpick', { id: 'id-sala' }));

    // La seccion activa (salas) SI reacciona: la sala pasa a seleccionada.
    expect(await screen.findByRole('button', { name: /^Mover/ })).toBeInTheDocument();
    // Escritorios sigue fuera de edicion -- el hook, ya en `off`, ignora el
    // mismo evento en vez de "seleccionar" el id de una sala como si fuese un
    // escritorio.
    expect(screen.getByRole('button', { name: /Editar escritorios/ })).toBeInTheDocument();
  });
});

/**
 * The terrain editor (#123 phase 2) is a third section on the same map: at
 * most one of the three holds it, and it only mounts with its port.
 */
describe('OfficeLayoutEditor: terrain section', () => {
  function renderWithTerrain(onEditingChange = vi.fn()) {
    const bridge = createOfficeBridge();
    const terrainCommands: unknown[] = [];
    bridge.onCommand('terrainedit', (command) => terrainCommands.push(command));
    render(
      <OfficeLayoutEditor
        bridge={bridge}
        desks={fakeDesks()}
        spaces={fakeSpaces()}
        terrain={{ setBlock: vi.fn(async () => undefined), setBlocks: vi.fn(), setWalls: vi.fn() }}
        refreshDesks={vi.fn()}
        refreshSpaces={vi.fn()}
        onEditingChange={onEditingChange}
      />,
    );
    return { bridge, terrainCommands, onEditingChange };
  }

  it('is not offered without a terrain port', () => {
    renderEditor();

    expect(screen.queryByRole('button', { name: 'Editar terreno' })).not.toBeInTheDocument();
  });

  it('opening it reports editing and closes the desk editor, and the other way round', async () => {
    const { terrainCommands, onEditingChange } = renderWithTerrain();

    await userEvent.click(screen.getByRole('button', { name: /Editar escritorios/ }));
    await screen.findByText('Mesa 4');
    await userEvent.click(screen.getByRole('button', { name: 'Editar terreno' }));

    expect(onEditingChange).toHaveBeenLastCalledWith(true);
    expect(screen.getAllByRole('button', { name: /Salir/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Editar escritorios/ })).toBeInTheDocument();
    expect(terrainCommands.at(-1)).toEqual({ brush: null });

    await userEvent.click(screen.getByRole('button', { name: /Editar salas/ }));
    expect(terrainCommands.at(-1)).toBeNull();
    expect(screen.getByRole('button', { name: 'Editar terreno' })).toBeInTheDocument();
  });

  it('leaving it reports editing=false', async () => {
    const { onEditingChange } = renderWithTerrain();

    await userEvent.click(screen.getByRole('button', { name: 'Editar terreno' }));
    await userEvent.click(screen.getByRole('button', { name: /Salir/ }));

    expect(onEditingChange).toHaveBeenLastCalledWith(false);
  });
});

/**
 * The collision editor is a fourth section on the same map, under the same
 * exclusivity, and it only mounts with its port.
 */
describe('OfficeLayoutEditor: collision section', () => {
  function renderWithCollisions(onEditingChange = vi.fn()) {
    const bridge = createOfficeBridge();
    const collisionCommands: unknown[] = [];
    const terrainCommands: unknown[] = [];
    bridge.onCommand('collisionedit', (command) => collisionCommands.push(command));
    bridge.onCommand('terrainedit', (command) => terrainCommands.push(command));
    render(
      <OfficeLayoutEditor
        bridge={bridge}
        desks={fakeDesks()}
        spaces={fakeSpaces()}
        terrain={{ setBlock: vi.fn(async () => undefined), setBlocks: vi.fn(), setWalls: vi.fn() }}
        collisions={{ saveRects: vi.fn(async () => undefined), reset: vi.fn(async () => undefined) }}
        refreshDesks={vi.fn()}
        refreshSpaces={vi.fn()}
        onEditingChange={onEditingChange}
      />,
    );
    return { bridge, collisionCommands, terrainCommands, onEditingChange };
  }

  it('is not offered without a collision port', () => {
    renderEditor();

    expect(screen.queryByRole('button', { name: 'Editar colisiones' })).not.toBeInTheDocument();
  });

  it('opening it closes the terrain editor, and the other way round', async () => {
    const { collisionCommands, terrainCommands, onEditingChange } = renderWithCollisions();

    await userEvent.click(screen.getByRole('button', { name: 'Editar terreno' }));
    await userEvent.click(screen.getByRole('button', { name: 'Editar colisiones' }));

    expect(onEditingChange).toHaveBeenLastCalledWith(true);
    expect(screen.getAllByRole('button', { name: /Salir/ })).toHaveLength(1);
    expect(terrainCommands.at(-1)).toBeNull();
    expect(collisionCommands.at(-1)).toEqual({ pieceId: null, draft: [], selectedRect: null, snap: 1 });

    await userEvent.click(screen.getByRole('button', { name: 'Editar terreno' }));
    expect(collisionCommands.at(-1)).toBeNull();
    expect(screen.getByRole('button', { name: 'Editar colisiones' })).toBeInTheDocument();
  });

  it('leaving it reports editing=false', async () => {
    const { onEditingChange } = renderWithCollisions();

    await userEvent.click(screen.getByRole('button', { name: 'Editar colisiones' }));
    await userEvent.click(screen.getByRole('button', { name: /Salir/ }));

    expect(onEditingChange).toHaveBeenLastCalledWith(false);
  });
});
