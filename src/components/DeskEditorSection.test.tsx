import { act, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminError } from '../dashboard/adminPort';
import type { AdminDesk, DeskAdminPort } from '../dashboard/deskAdminPort';
import type { SpacesAdminPort } from '../dashboard/spacesAdminPort';
import { createOfficeBridge } from '../game/officeBridge';
import { DeskEditorSection } from './DeskEditorSection';

const MESA: AdminDesk = { id: 'id-mesa', label: 'Mesa 4', x: 10, y: 10, w: 3, h: 3, occupant: null };

function fakeDesks(overrides: Partial<DeskAdminPort> = {}): DeskAdminPort {
  return {
    listDesks: vi.fn(async () => [MESA]),
    createDesk: vi.fn(async () => MESA),
    updateDesk: vi.fn(async () => MESA),
    deleteDesk: vi.fn(async () => undefined),
    ...overrides,
  };
}

/** Sin salas en ninguno de estos tests: el cruce escritorio<->sala tiene su propia cobertura en `useLayoutEditor.test.ts`. */
function fakeSpaces(): SpacesAdminPort {
  return {
    listSpaces: vi.fn(async () => []),
    createSpace: vi.fn(),
    updateSpace: vi.fn(),
    deleteSpace: vi.fn(),
  } as unknown as SpacesAdminPort;
}

describe('DeskEditorSection (#74, PR3c)', () => {
  it('fuera de modo edicion solo ofrece el boton de entrar', () => {
    const bridge = createOfficeBridge();
    render(<DeskEditorSection bridge={bridge} desks={fakeDesks()} spaces={fakeSpaces()} refreshDesks={vi.fn()} refreshSpaces={vi.fn()} />);

    expect(screen.getByRole('button', { name: /Editar escritorios/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Salir/ })).not.toBeInTheDocument();
  });

  it('entrar lista los escritorios existentes y avisa del cambio de modo', async () => {
    const onEditingChange = vi.fn();
    const bridge = createOfficeBridge();
    render(
      <DeskEditorSection
        bridge={bridge}
        desks={fakeDesks()}
        spaces={fakeSpaces()}
        refreshDesks={vi.fn()}
        refreshSpaces={vi.fn()}
        onEditingChange={onEditingChange}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /Editar escritorios/ }));

    expect(await screen.findByText('Mesa 4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Salir/ })).toBeInTheDocument();
    expect(onEditingChange).toHaveBeenCalledWith(true);
  });

  it('salir avisa del cambio de modo de vuelta a false', async () => {
    const onEditingChange = vi.fn();
    const bridge = createOfficeBridge();
    render(
      <DeskEditorSection
        bridge={bridge}
        desks={fakeDesks()}
        spaces={fakeSpaces()}
        refreshDesks={vi.fn()}
        refreshSpaces={vi.fn()}
        onEditingChange={onEditingChange}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Editar escritorios/ }));
    await screen.findByText('Mesa 4');

    await userEvent.click(screen.getByRole('button', { name: /Salir/ }));

    expect(onEditingChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole('button', { name: /Salir/ })).not.toBeInTheDocument();
  });

  it('seleccionar un escritorio de la lista ofrece moverlo y eliminarlo', async () => {
    const bridge = createOfficeBridge();
    render(<DeskEditorSection bridge={bridge} desks={fakeDesks()} spaces={fakeSpaces()} refreshDesks={vi.fn()} refreshSpaces={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /Editar escritorios/ }));
    await screen.findByText('Mesa 4');

    await userEvent.click(screen.getByRole('button', { name: /Seleccionar Mesa 4/ }));

    expect(screen.getByRole('button', { name: /^Mover/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Eliminar/ })).toBeInTheDocument();
  });

  it('mover pide colocar en el mapa y un clic valido llama a updateDesk', async () => {
    const desks = fakeDesks();
    const bridge = createOfficeBridge();
    render(<DeskEditorSection bridge={bridge} desks={desks} spaces={fakeSpaces()} refreshDesks={vi.fn()} refreshSpaces={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /Editar escritorios/ }));
    await screen.findByText('Mesa 4');
    await userEvent.click(screen.getByRole('button', { name: /Seleccionar Mesa 4/ }));

    await userEvent.click(screen.getByRole('button', { name: /^Mover/ }));
    expect(screen.getByText(/Toca el nuevo sitio en el mapa/)).toBeInTheDocument();

    act(() => bridge.emit('layoutplace', { tx: 5, ty: 6, valid: true }));

    await waitFor(() => expect(desks.updateDesk).toHaveBeenCalledWith('id-mesa', { x: 5, y: 6 }));
  });

  it('eliminar llama a deleteDesk con el id seleccionado', async () => {
    const desks = fakeDesks();
    const bridge = createOfficeBridge();
    render(<DeskEditorSection bridge={bridge} desks={desks} spaces={fakeSpaces()} refreshDesks={vi.fn()} refreshSpaces={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /Editar escritorios/ }));
    await screen.findByText('Mesa 4');
    await userEvent.click(screen.getByRole('button', { name: /Seleccionar Mesa 4/ }));

    await userEvent.click(screen.getByRole('button', { name: /^Eliminar/ }));

    await waitFor(() => expect(desks.deleteDesk).toHaveBeenCalledWith('id-mesa'));
  });

  it('crear: "Crear escritorio" asks nothing and a map click creates an empty desk there', async () => {
    const desks = fakeDesks();
    const bridge = createOfficeBridge();
    render(<DeskEditorSection bridge={bridge} desks={desks} spaces={fakeSpaces()} refreshDesks={vi.fn()} refreshSpaces={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /Editar escritorios/ }));
    await screen.findByText('Mesa 4');

    // No label and no material: a desk is an empty 3x3 area (Editar espacios).
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /Aspecto/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Crear escritorio' }));
    expect(screen.getByText(/Toca el nuevo sitio en el mapa/)).toBeInTheDocument();
    act(() => bridge.emit('layoutplace', { tx: 1, ty: 2, valid: true }));

    await waitFor(() => expect(desks.createDesk).toHaveBeenCalledWith({ x: 1, y: 2 }));
  });

  it('un desk-overlap se muestra visible', async () => {
    const desks = fakeDesks({
      createDesk: vi.fn(async () => Promise.reject(new AdminError('desk-overlap'))),
    });
    const bridge = createOfficeBridge();
    render(<DeskEditorSection bridge={bridge} desks={desks} spaces={fakeSpaces()} refreshDesks={vi.fn()} refreshSpaces={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /Editar escritorios/ }));
    await screen.findByText('Mesa 4');

    await userEvent.click(screen.getByRole('button', { name: 'Crear escritorio' }));
    act(() => bridge.emit('layoutplace', { tx: 1, ty: 2, valid: true }));

    expect(
      await screen.findByText(
        'Esas coordenadas chocan con otro escritorio: cada uno ocupa 3×3 casillas y ni los bordes pueden tocarse.',
      ),
    ).toBeInTheDocument();
  });

  it('a desk placed over a painted wall shows why it was refused', async () => {
    const desks = fakeDesks({
      createDesk: vi.fn(async () => Promise.reject(new AdminError('desk-on-wall'))),
    });
    const bridge = createOfficeBridge();
    render(<DeskEditorSection bridge={bridge} desks={desks} spaces={fakeSpaces()} refreshDesks={vi.fn()} refreshSpaces={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /Editar escritorios/ }));
    await screen.findByText('Mesa 4');

    await userEvent.click(screen.getByRole('button', { name: 'Crear escritorio' }));
    act(() => bridge.emit('layoutplace', { tx: 1, ty: 2, valid: true }));

    expect(
      await screen.findByText('Hay una pared en ese lugar: quítala o elige otro sitio para el escritorio.'),
    ).toBeInTheDocument();
  });

  it('names an empty desk by where it is, and by who claimed it', async () => {
    const vacio: AdminDesk = { id: 'id-vacio', label: '', x: 4, y: 7, w: 3, h: 3, occupant: null };
    const deAna: AdminDesk = { id: 'id-ana', label: '', x: 9, y: 7, w: 3, h: 3, occupant: { id: 'u-ana', displayName: 'Ana' } };
    const bridge = createOfficeBridge();
    render(
      <DeskEditorSection
        bridge={bridge}
        desks={fakeDesks({ listDesks: vi.fn(async () => [vacio, deAna]) })}
        spaces={fakeSpaces()}
        refreshDesks={vi.fn()}
        refreshSpaces={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Editar escritorios/ }));

    expect(await screen.findByRole('button', { name: 'Seleccionar Escritorio libre (4, 7)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Seleccionar Escritorio de Ana (9, 7)' })).toBeInTheDocument();
  });

  it('embedded in "Editar espacios" it leaves the exit to the section around it', async () => {
    const bridge = createOfficeBridge();
    render(
      <DeskEditorSection bridge={bridge} desks={fakeDesks()} spaces={fakeSpaces()} refreshDesks={vi.fn()} refreshSpaces={vi.fn()} embedded initiallyActive />,
    );

    expect(await screen.findByText('Mesa 4')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Escritorios' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Salir/ })).not.toBeInTheDocument();
  });

  it('forceExit saca del modo edicion aunque estuviese activo', async () => {
    const onEditingChange = vi.fn();
    const bridge = createOfficeBridge();
    const { rerender } = render(
      <DeskEditorSection
        bridge={bridge}
        desks={fakeDesks()}
        spaces={fakeSpaces()}
        refreshDesks={vi.fn()}
        refreshSpaces={vi.fn()}
        onEditingChange={onEditingChange}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Editar escritorios/ }));
    await screen.findByText('Mesa 4');

    rerender(
      <DeskEditorSection
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

