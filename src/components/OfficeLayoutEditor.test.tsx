import { act, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AdminDesk, DeskAdminPort } from '../dashboard/deskAdminPort';
import type { AdminSpace, SpacesAdminPort } from '../dashboard/spacesAdminPort';
import type { LayoutEditCommand } from '../game/layoutEditor';
import { createOfficeBridge } from '../game/officeBridge';
import OfficeLayoutEditor, { type OfficeLayoutEditorProps } from './OfficeLayoutEditor';

const MESA: AdminDesk = { id: 'id-mesa', label: 'Mesa 4', x: 10, y: 10, w: 3, h: 3, occupant: null };
const SALA: AdminSpace = { id: 'id-sala', name: 'Sala grande', x: 0, y: 0, w: 4, h: 4, capacity: null, kind: 'room' };

describe('OfficeLayoutEditor: selected submenu lifecycle (#147)', () => {
  it.each(['desk', 'room', 'terrain', 'collision'] as const)('unmounting %s clears editing and its bridge mode', async (section) => {
    const bridge = createOfficeBridge();
    const command = section === 'terrain' ? 'terrainedit' : section === 'collision' ? 'collisionedit' : 'layoutedit';
    const commands: unknown[] = [];
    bridge.onCommand(command, (value) => commands.push(value));
    const onEditingChange = vi.fn();
    const props: OfficeLayoutEditorProps = {
      bridge, desks: fakeDesks(), spaces: fakeSpaces(), refreshDesks: vi.fn(), refreshSpaces: vi.fn(),
      terrain: { setBlock: vi.fn(), setBlocks: vi.fn() }, collisions: { saveRects: vi.fn(), reset: vi.fn() },
      section, onEditingChange,
    };
    const { unmount } = render(<OfficeLayoutEditor {...props} />);
    await screen.findByRole('button', { name: 'Salir' });
    expect(onEditingChange).toHaveBeenLastCalledWith(true);
    expect(commands.at(-1)).not.toBeNull();
    unmount();
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
    expect(commands.at(-1)).toBeNull();
  });

  it('changing the selected section closes the old overlay before opening the new one', async () => {
    const bridge = createOfficeBridge();
    const commands: unknown[] = [];
    bridge.onCommand('layoutedit', (value) => commands.push(value));
    const props = { bridge, desks: fakeDesks(), spaces: fakeSpaces(), refreshDesks: vi.fn(), refreshSpaces: vi.fn(), onEditingChange: vi.fn() };
    const { rerender } = render(<OfficeLayoutEditor {...props} section="desk" />);
    await screen.findByText('Mesa 4');
    commands.length = 0;
    rerender(<OfficeLayoutEditor {...props} section="room" />);
    await screen.findByText('Sala grande');
    expect(commands[0]).toBeNull();
    await waitFor(() => expect(commands.at(-1)).toMatchObject({ pickable: [{ id: 'id-sala' }] }));
    expect(props.onEditingChange).toHaveBeenLastCalledWith(true);
    expect(screen.queryByText('Mesa 4')).not.toBeInTheDocument();
  });

  it.each(['terrain', 'collision'] as const)('removing the selected %s port unmounts its editing owner', async (section) => {
    const bridge = createOfficeBridge();
    const command = section === 'terrain' ? 'terrainedit' : 'collisionedit';
    const emit = vi.fn();
    bridge.onCommand(command, emit);
    const props = {
      bridge, desks: fakeDesks(), spaces: fakeSpaces(), refreshDesks: vi.fn(), refreshSpaces: vi.fn(),
      terrain: { setBlock: vi.fn(), setBlocks: vi.fn() }, collisions: { saveRects: vi.fn(), reset: vi.fn() }, onEditingChange: vi.fn(), section,
    };
    const { rerender } = render(<OfficeLayoutEditor {...props} />);
    await screen.findByRole('button', { name: 'Salir' });
    expect(props.onEditingChange).toHaveBeenLastCalledWith(true);
    rerender(<OfficeLayoutEditor {...props} {...{ [section === 'terrain' ? 'terrain' : 'collisions']: null }} />);
    expect(props.onEditingChange).toHaveBeenLastCalledWith(false);
    expect(emit).toHaveBeenLastCalledWith(null);
  });
});

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
      { pickable: [], selectedId: null, placing: null },
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
        terrain={{ setBlock: vi.fn(async () => undefined), setBlocks: vi.fn() }}
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
    expect(terrainCommands.at(-1)).toEqual({ selected: null, preview: null });

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
        terrain={{ setBlock: vi.fn(async () => undefined), setBlocks: vi.fn() }}
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
