import { act, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminError } from '../dashboard/adminPort';
import type { DeskAdminPort } from '../dashboard/deskAdminPort';
import type { AdminSpace, SpacesAdminPort } from '../dashboard/spacesAdminPort';
import { createOfficeBridge } from '../game/officeBridge';
import { SpaceEditorSection } from './SpaceEditorSection';

const SALA: AdminSpace = { id: 'id-sala', name: 'Sala grande', x: 10, y: 10, w: 5, h: 5, capacity: 8, kind: 'room' };

function fakeSpaces(overrides: Partial<SpacesAdminPort> = {}): SpacesAdminPort {
  return {
    listSpaces: vi.fn(async () => [SALA]),
    createSpace: vi.fn(async () => SALA),
    updateSpace: vi.fn(async () => SALA),
    deleteSpace: vi.fn(async () => undefined),
    ...overrides,
  };
}

function fakeDesks(overrides: Partial<DeskAdminPort> = {}): DeskAdminPort {
  return {
    listDesks: vi.fn(async () => []),
    createDesk: vi.fn(),
    updateDesk: vi.fn(),
    deleteDesk: vi.fn(),
    ...overrides,
  } as DeskAdminPort;
}

function renderSection(overrides: Partial<Parameters<typeof SpaceEditorSection>[0]> = {}) {
  const bridge = overrides.bridge ?? createOfficeBridge();
  const props = {
    bridge,
    spaces: fakeSpaces(),
    desks: fakeDesks(),
    refreshDesks: vi.fn(),
    refreshSpaces: vi.fn(),
    ...overrides,
  };
  const view = render(<SpaceEditorSection {...props} />);
  return { ...props, ...view };
}

describe('SpaceEditorSection (#74, PR4)', () => {
  it('fuera de modo edicion solo ofrece el boton de entrar', () => {
    renderSection();

    expect(screen.getByRole('button', { name: /Editar salas/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Salir/ })).not.toBeInTheDocument();
  });

  it('entrar lista las salas existentes y avisa del cambio de modo', async () => {
    const onEditingChange = vi.fn();
    renderSection({ onEditingChange });

    await userEvent.click(screen.getByRole('button', { name: /Editar salas/ }));

    expect(await screen.findByText('Sala grande')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Salir/ })).toBeInTheDocument();
    expect(onEditingChange).toHaveBeenCalledWith(true);
  });

  it('salir avisa del cambio de modo de vuelta a false', async () => {
    const onEditingChange = vi.fn();
    renderSection({ onEditingChange });
    await userEvent.click(screen.getByRole('button', { name: /Editar salas/ }));
    await screen.findByText('Sala grande');

    await userEvent.click(screen.getByRole('button', { name: /Salir/ }));

    expect(onEditingChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole('button', { name: /Salir/ })).not.toBeInTheDocument();
  });

  it('seleccionar una sala de la lista ofrece moverla y eliminarla', async () => {
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: /Editar salas/ }));
    await screen.findByText('Sala grande');

    await userEvent.click(screen.getByRole('button', { name: /Seleccionar Sala grande/ }));

    expect(screen.getByRole('button', { name: /^Mover/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Eliminar/ })).toBeInTheDocument();
  });

  it('mover pide colocar en el mapa y un clic valido llama a updateSpace', async () => {
    const spaces = fakeSpaces();
    const bridge = createOfficeBridge();
    renderSection({ spaces, bridge });
    await userEvent.click(screen.getByRole('button', { name: /Editar salas/ }));
    await screen.findByText('Sala grande');
    await userEvent.click(screen.getByRole('button', { name: /Seleccionar Sala grande/ }));

    await userEvent.click(screen.getByRole('button', { name: /^Mover/ }));
    expect(screen.getByText(/Toca el nuevo sitio en el mapa/)).toBeInTheDocument();

    act(() => bridge.emit('layoutplace', { tx: 5, ty: 6, valid: true }));

    await waitFor(() => expect(spaces.updateSpace).toHaveBeenCalledWith('id-sala', { x: 5, y: 6 }));
  });

  it('eliminar llama a deleteSpace con el id seleccionado', async () => {
    const spaces = fakeSpaces();
    renderSection({ spaces });
    await userEvent.click(screen.getByRole('button', { name: /Editar salas/ }));
    await screen.findByText('Sala grande');
    await userEvent.click(screen.getByRole('button', { name: /Seleccionar Sala grande/ }));

    await userEvent.click(screen.getByRole('button', { name: /^Eliminar/ }));

    await waitFor(() => expect(spaces.deleteSpace).toHaveBeenCalledWith('id-sala'));
  });

  it('crear: nombre + ancho + alto y colocar en el mapa llama a createSpace', async () => {
    const spaces = fakeSpaces();
    const bridge = createOfficeBridge();
    renderSection({ spaces, bridge });
    await userEvent.click(screen.getByRole('button', { name: /Editar salas/ }));
    await screen.findByText('Sala grande');

    await userEvent.type(screen.getByLabelText(/Nombre de la nueva sala/), 'Sala chica');
    await userEvent.clear(screen.getByLabelText(/^Ancho$/));
    await userEvent.type(screen.getByLabelText(/^Ancho$/), '4');
    await userEvent.clear(screen.getByLabelText(/^Alto$/));
    await userEvent.type(screen.getByLabelText(/^Alto$/), '3');
    await userEvent.click(screen.getByRole('button', { name: /Colocar nueva sala/ }));
    act(() => bridge.emit('layoutplace', { tx: 1, ty: 2, valid: true }));

    await waitFor(() =>
      expect(spaces.createSpace).toHaveBeenCalledWith({ name: 'Sala chica', x: 1, y: 2, w: 4, h: 3, capacity: null }),
    );
  });

  it('crear con aforo manda el aforo pedido', async () => {
    const spaces = fakeSpaces();
    const bridge = createOfficeBridge();
    renderSection({ spaces, bridge });
    await userEvent.click(screen.getByRole('button', { name: /Editar salas/ }));
    await screen.findByText('Sala grande');

    await userEvent.type(screen.getByLabelText(/Nombre de la nueva sala/), 'Sala chica');
    await userEvent.clear(screen.getByLabelText(/^Ancho$/));
    await userEvent.type(screen.getByLabelText(/^Ancho$/), '4');
    await userEvent.clear(screen.getByLabelText(/^Alto$/));
    await userEvent.type(screen.getByLabelText(/^Alto$/), '3');
    await userEvent.type(screen.getByLabelText(/Aforo/), '6');
    await userEvent.click(screen.getByRole('button', { name: /Colocar nueva sala/ }));
    act(() => bridge.emit('layoutplace', { tx: 1, ty: 2, valid: true }));

    await waitFor(() =>
      expect(spaces.createSpace).toHaveBeenCalledWith({ name: 'Sala chica', x: 1, y: 2, w: 4, h: 3, capacity: 6 }),
    );
  });

  it('sin nombre, ancho o alto no se puede colocar: el boton de crear esta deshabilitado', async () => {
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: /Editar salas/ }));
    await screen.findByText('Sala grande');

    expect(screen.getByRole('button', { name: /Colocar nueva sala/ })).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/Nombre de la nueva sala/), 'Sala chica');

    expect(screen.getByRole('button', { name: /Colocar nueva sala/ })).toBeDisabled();
  });

  it('un space-name-taken se muestra visible y no borra en silencio el formulario pendiente', async () => {
    const spaces = fakeSpaces({
      createSpace: vi.fn(async () => Promise.reject(new AdminError('space-name-taken'))),
    });
    const bridge = createOfficeBridge();
    renderSection({ spaces, bridge });
    await userEvent.click(screen.getByRole('button', { name: /Editar salas/ }));
    await screen.findByText('Sala grande');

    await userEvent.type(screen.getByLabelText(/Nombre de la nueva sala/), 'Sala grande');
    await userEvent.clear(screen.getByLabelText(/^Ancho$/));
    await userEvent.type(screen.getByLabelText(/^Ancho$/), '4');
    await userEvent.clear(screen.getByLabelText(/^Alto$/));
    await userEvent.type(screen.getByLabelText(/^Alto$/), '3');
    await userEvent.click(screen.getByRole('button', { name: /Colocar nueva sala/ }));
    act(() => bridge.emit('layoutplace', { tx: 1, ty: 2, valid: true }));

    expect(await screen.findByText('Ya existe una sala con ese nombre.')).toBeInTheDocument();
    expect(screen.getByLabelText(/Nombre de la nueva sala/)).toHaveValue('Sala grande');
  });

  it('un space-owned-by-desk se muestra visible', async () => {
    const spaces = fakeSpaces({
      createSpace: vi.fn(async () => Promise.reject(new AdminError('space-owned-by-desk'))),
    });
    const bridge = createOfficeBridge();
    renderSection({ spaces, bridge });
    await userEvent.click(screen.getByRole('button', { name: /Editar salas/ }));
    await screen.findByText('Sala grande');

    await userEvent.type(screen.getByLabelText(/Nombre de la nueva sala/), 'Sala chica');
    await userEvent.clear(screen.getByLabelText(/^Ancho$/));
    await userEvent.type(screen.getByLabelText(/^Ancho$/), '4');
    await userEvent.clear(screen.getByLabelText(/^Alto$/));
    await userEvent.type(screen.getByLabelText(/^Alto$/), '3');
    await userEvent.click(screen.getByRole('button', { name: /Colocar nueva sala/ }));
    act(() => bridge.emit('layoutplace', { tx: 1, ty: 2, valid: true }));

    expect(
      await screen.findByText('Ese espacio es el cubículo de un escritorio: se administra desde el panel de escritorios.'),
    ).toBeInTheDocument();
  });

  it('#105: cada etiqueta y su input viven en su propio contenedor, no sueltos en el form', async () => {
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: /Editar salas/ }));
    await screen.findByText('Sala grande');

    const form = screen.getByRole('button', { name: /Colocar nueva sala/ }).closest('form');
    expect(form).not.toBeNull();

    const pairs: Array<[RegExp, RegExp]> = [
      [/^Nombre de la nueva sala$/, /Nombre de la nueva sala/],
      [/^Ancho$/, /^Ancho$/],
      [/^Alto$/, /^Alto$/],
      [/^Aforo$/, /Aforo/],
    ];
    for (const [labelText, labelFor] of pairs) {
      const label = screen.getByText(labelText);
      const input = screen.getByLabelText(labelFor);
      // El label y su input comparten un contenedor propio, distinto del <form>
      // -- antes de #105 eran hermanos sueltos directos de `.form`.
      expect(label.parentElement).toBe(input.parentElement);
      expect(label.parentElement).not.toBe(form);
    }
  });

  it('forceExit saca del modo edicion aunque estuviese activo', async () => {
    const onEditingChange = vi.fn();
    const { bridge, spaces, desks, refreshDesks, refreshSpaces, rerender } = renderSection({ onEditingChange });
    await userEvent.click(screen.getByRole('button', { name: /Editar salas/ }));
    await screen.findByText('Sala grande');

    rerender(
      <SpaceEditorSection
        bridge={bridge}
        spaces={spaces}
        desks={desks}
        refreshDesks={refreshDesks}
        refreshSpaces={refreshSpaces}
        onEditingChange={onEditingChange}
        forceExit
      />,
    );

    expect(screen.queryByRole('button', { name: /Salir/ })).not.toBeInTheDocument();
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
  });
});
