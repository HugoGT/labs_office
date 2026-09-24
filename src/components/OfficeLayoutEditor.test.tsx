import { act, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AdminDesk, DeskAdminPort } from '../dashboard/deskAdminPort';
import type { AdminSpace, SpacesAdminPort } from '../dashboard/spacesAdminPort';
import type { LayoutEditCommand } from '../game/layoutEditor';
import { createOfficeBridge } from '../game/officeBridge';
import OfficeLayoutEditor from './OfficeLayoutEditor';

const MESA: AdminDesk = { id: 'id-mesa', label: 'Mesa 4', x: 10, y: 10, w: 3, h: 3, occupant: null };
const SALA: AdminSpace = { id: 'id-sala', name: 'Sala grande', x: 0, y: 0, w: 4, h: 4, capacity: null, kind: 'room' };

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
