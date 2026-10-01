import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminError } from '../dashboard/adminPort';
import type { AdminDesk, DeskAdminPort } from '../dashboard/deskAdminPort';
import type { SpacesAdminPort } from '../dashboard/spacesAdminPort';
import exportedManifest from '../../public/assets/pack/manifest.json?raw';
import { materialCatalogFrom } from '../game/artMaterials';
import type { ArtPreviewCache } from '../game/artPreview';
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

  it('crear: escribir una etiqueta y colocar en el mapa llama a createDesk', async () => {
    const desks = fakeDesks();
    const bridge = createOfficeBridge();
    render(<DeskEditorSection bridge={bridge} desks={desks} spaces={fakeSpaces()} refreshDesks={vi.fn()} refreshSpaces={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /Editar escritorios/ }));
    await screen.findByText('Mesa 4');

    await userEvent.type(screen.getByLabelText(/Etiqueta del nuevo escritorio/), 'Mesa 9');
    await userEvent.click(screen.getByRole('button', { name: /Colocar nuevo escritorio/ }));
    act(() => bridge.emit('layoutplace', { tx: 1, ty: 2, valid: true }));

    await waitFor(() => expect(desks.createDesk).toHaveBeenCalledWith({ label: 'Mesa 9', x: 1, y: 2 }));
  });

  it('un desk-overlap se muestra visible y no borra en silencio la etiqueta pendiente', async () => {
    const desks = fakeDesks({
      createDesk: vi.fn(async () => Promise.reject(new AdminError('desk-overlap'))),
    });
    const bridge = createOfficeBridge();
    render(<DeskEditorSection bridge={bridge} desks={desks} spaces={fakeSpaces()} refreshDesks={vi.fn()} refreshSpaces={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /Editar escritorios/ }));
    await screen.findByText('Mesa 4');

    const input = screen.getByLabelText(/Etiqueta del nuevo escritorio/);
    await userEvent.type(input, 'Mesa 9');
    await userEvent.click(screen.getByRole('button', { name: /Colocar nuevo escritorio/ }));
    act(() => bridge.emit('layoutplace', { tx: 1, ty: 2, valid: true }));

    expect(
      await screen.findByText(
        'Esas coordenadas chocan con otro escritorio: cada uno ocupa 3×3 casillas y ni los bordes pueden tocarse.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Etiqueta del nuevo escritorio/)).toHaveValue('Mesa 9');
  });

  it('#105: la etiqueta y su input viven en su propio contenedor, no sueltos en el form', async () => {
    const bridge = createOfficeBridge();
    render(<DeskEditorSection bridge={bridge} desks={fakeDesks()} spaces={fakeSpaces()} refreshDesks={vi.fn()} refreshSpaces={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /Editar escritorios/ }));
    await screen.findByText('Mesa 4');

    const form = screen.getByRole('button', { name: /Colocar nuevo escritorio/ }).closest('form');
    expect(form).not.toBeNull();

    const label = screen.getByText(/^Etiqueta del nuevo escritorio$/);
    const input = screen.getByLabelText(/Etiqueta del nuevo escritorio/);
    // El label y su input comparten un contenedor propio, distinto del <form>
    // -- antes de #105 eran hermanos sueltos directos de `.form`.
    expect(label.parentElement).toBe(input.parentElement);
    expect(label.parentElement).not.toBe(form);
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

describe('DeskEditorSection: appearance chosen at creation (art step 7)', () => {
  const catalog = materialCatalogFrom(JSON.parse(exportedManifest), 'assets/pack/manifest.json')!;
  const noPreview: ArtPreviewCache = { sheet: async () => null };

  async function enterWithCatalog(desks: DeskAdminPort, bridge = createOfficeBridge()) {
    render(
      <DeskEditorSection
        bridge={bridge}
        desks={desks}
        spaces={fakeSpaces()}
        refreshDesks={vi.fn()}
        refreshSpaces={vi.fn()}
        loadMaterials={async () => catalog}
        preview={noPreview}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Editar escritorios/ }));
    await screen.findByText('Mesa 4');
    return bridge;
  }

  it('the creation form offers the catalog materials, starting on the pack default', async () => {
    await enterWithCatalog(fakeDesks());

    expect(await screen.findByLabelText('Material')).toHaveValue('desk-wood');
    expect(screen.getByRole('group', { name: 'Aspecto del escritorio' })).toBeInTheDocument();
  });

  it('creating a painted desk sends its material and color', async () => {
    const desks = fakeDesks();
    const bridge = await enterWithCatalog(desks);

    await userEvent.type(screen.getByLabelText(/Etiqueta del nuevo escritorio/), 'Mesa 9');
    await userEvent.selectOptions(await screen.findByLabelText('Material'), 'desk-painted');
    fireEvent.input(screen.getByLabelText('Color'), { target: { value: '#c0392b' } });
    await userEvent.click(screen.getByRole('button', { name: /Colocar nuevo escritorio/ }));
    act(() => bridge.emit('layoutplace', { tx: 1, ty: 2, valid: true }));

    await waitFor(() =>
      expect(desks.createDesk).toHaveBeenCalledWith({
        label: 'Mesa 9',
        x: 1,
        y: 2,
        appearance: { materialId: 'desk-painted', color: '#c0392b' },
      }),
    );
  });

  it('the appearance is not offered when moving an existing desk, which keeps its own', async () => {
    const desks = fakeDesks();
    const bridge = await enterWithCatalog(desks);

    await userEvent.click(screen.getByRole('button', { name: /Seleccionar Mesa 4/ }));
    expect(screen.queryByLabelText('Material')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Mover$/ }));
    act(() => bridge.emit('layoutplace', { tx: 5, ty: 6, valid: true }));

    await waitFor(() => expect(desks.updateDesk).toHaveBeenCalledWith('id-mesa', { x: 5, y: 6 }));
  });

  it('a refused appearance is told in words and keeps the form as it was', async () => {
    const desks = fakeDesks({
      createDesk: vi.fn(async () => Promise.reject(new AdminError('appearance-retired-piece'))),
    });
    const bridge = await enterWithCatalog(desks);

    await userEvent.type(screen.getByLabelText(/Etiqueta del nuevo escritorio/), 'Mesa 9');
    await userEvent.selectOptions(await screen.findByLabelText('Material'), 'desk-metal');
    await userEvent.click(screen.getByRole('button', { name: /Colocar nuevo escritorio/ }));
    act(() => bridge.emit('layoutplace', { tx: 1, ty: 2, valid: true }));

    expect(await screen.findByText('Ese material ya no se puede elegir. Elige otro.')).toBeInTheDocument();
    expect(screen.getByLabelText('Material')).toHaveValue('desk-metal');
  });

  it('without a readable catalog the form still creates, with the pack default', async () => {
    const desks = fakeDesks();
    const bridge = createOfficeBridge();
    render(
      <DeskEditorSection
        bridge={bridge}
        desks={desks}
        spaces={fakeSpaces()}
        refreshDesks={vi.fn()}
        refreshSpaces={vi.fn()}
        loadMaterials={async () => null}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Editar escritorios/ }));
    await screen.findByText('Mesa 4');

    expect(screen.queryByLabelText('Material')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Etiqueta del nuevo escritorio/), 'Mesa 9');
    await userEvent.click(screen.getByRole('button', { name: /Colocar nuevo escritorio/ }));
    act(() => bridge.emit('layoutplace', { tx: 1, ty: 2, valid: true }));

    await waitFor(() => expect(desks.createDesk).toHaveBeenCalledWith({ label: 'Mesa 9', x: 1, y: 2 }));
  });
});
