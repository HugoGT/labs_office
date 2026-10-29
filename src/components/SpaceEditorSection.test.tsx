import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminError } from '../dashboard/adminPort';
import type { DeskAdminPort } from '../dashboard/deskAdminPort';
import type { AdminSpace, SpacesAdminPort } from '../dashboard/spacesAdminPort';
import exportedManifest from '../../public/assets/pack/manifest.json?raw';
import { materialCatalogFrom } from '../game/artMaterials';
import { createOfficeBridge, type OfficeBridge } from '../game/officeBridge';
import { SpaceEditorSection } from './SpaceEditorSection';

// A loaded catalog everywhere: the form must still offer no floor (#182).
vi.mock('../hooks/useMaterialCatalog', () => ({
  useMaterialCatalog: () => materialCatalogFrom(JSON.parse(exportedManifest), 'assets/pack/manifest.json'),
}));

const SALA: AdminSpace = { id: 'id-sala', name: 'Sala grande', x: 10, y: 10, w: 5, h: 5, capacity: 8, kind: 'room' };

/** The room the map outlines, with its buttons under it, as the last `layoutedit` command says. */
function trackSelectionOnMap(bridge: OfficeBridge): () => string | null | undefined {
  let selectedId: string | null | undefined;
  bridge.onCommand('layoutedit', (command) => {
    selectedId = command?.selectedId;
  });
  return () => selectedId;
}

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
  it('starts at a whole office block and sends its aligned placement through the existing room tool (#184)', async () => {
    const { spaces, bridge } = renderSection();
    await userEvent.click(screen.getByRole('button', { name: /Editar salas/ }));
    await screen.findByText('Sala grande');
    expect(screen.getByLabelText('Ancho')).toHaveValue(9);
    expect(screen.getByLabelText('Alto')).toHaveValue(9);
    expect(screen.queryByRole('button', { name: /Usar un bloque de oficina/ })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Nombre de la nueva sala'), 'Office');
    await userEvent.click(screen.getByRole('button', { name: 'Colocar nueva sala' }));
    act(() => bridge.emit('layoutplace', { tx: 63, ty: 45, valid: true }));
    await waitFor(() => expect(spaces.createSpace).toHaveBeenCalledWith(expect.objectContaining({ x: 63, y: 45, w: 9, h: 9 })));
  });
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

  const SALA_B: AdminSpace = { ...SALA, id: 'id-sala-b', name: 'Sala chica de un nombre muy largo', x: 30, y: 30, w: 6, h: 7 };

  async function openListOfTwo() {
    const spaces = fakeSpaces({ listSpaces: vi.fn(async () => [SALA, SALA_B]) });
    const bridge = createOfficeBridge();
    renderSection({ spaces, bridge });
    await userEvent.click(screen.getByRole('button', { name: /Editar salas/ }));
    await screen.findByText(SALA_B.name);
    return { spaces, bridge };
  }

  it('each row is one line, like a desk row: the name, a "Mover" and a trash, with no "Seleccionar"', async () => {
    await openListOfTwo();

    expect(screen.queryByRole('button', { name: /Seleccionar/ })).not.toBeInTheDocument();
    for (const name of [SALA.name, SALA_B.name]) {
      expect(screen.getByRole('button', { name: `Mover ${name}` })).toHaveTextContent(/^Mover$/);
      const trash = screen.getByRole('button', { name: `Eliminar ${name}` });
      expect(trash).toHaveAttribute('title', 'Eliminar');
      expect(trash).toHaveTextContent('');
      expect(trash.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
    // A long name keeps its full text as a tooltip: the row cuts it with an ellipsis.
    expect(screen.getByText(SALA_B.name)).toHaveAttribute('title', SALA_B.name);
    const row = screen.getByText(SALA.name).closest('li');
    expect(within(row as HTMLElement).getAllByRole('button')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Deseleccionar' })).not.toBeInTheDocument();
  });

  it('"Mover" on a row moves that room, with its own size', async () => {
    const { spaces, bridge } = await openListOfTwo();

    await userEvent.click(screen.getByRole('button', { name: `Mover ${SALA_B.name}` }));
    expect(screen.getByText(/Toca el nuevo sitio en el mapa/)).toBeInTheDocument();
    act(() => bridge.emit('layoutplace', { tx: 5, ty: 6, valid: true }));

    await waitFor(() => expect(spaces.updateSpace).toHaveBeenCalledWith('id-sala-b', { x: 5, y: 6, w: 6, h: 7 }));
    expect(spaces.updateSpace).toHaveBeenCalledTimes(1);
  });

  it('the trash on a row deletes that room, not another one', async () => {
    const { spaces } = await openListOfTwo();

    await userEvent.click(screen.getByRole('button', { name: `Eliminar ${SALA_B.name}` }));

    await waitFor(() => expect(spaces.deleteSpace).toHaveBeenCalledWith('id-sala-b'));
    expect(spaces.deleteSpace).toHaveBeenCalledTimes(1);
  });

  it('a room picked on the map leaves the panel as it is: its move and trash are the buttons under it on the map', async () => {
    const spaces = fakeSpaces();
    const bridge = createOfficeBridge();
    renderSection({ spaces, bridge });
    await userEvent.click(screen.getByRole('button', { name: /Editar salas/ }));
    await screen.findByText('Sala grande');
    const selectedOnMap = trackSelectionOnMap(bridge);

    act(() => bridge.emit('layoutpick', { id: 'id-sala' }));

    expect(selectedOnMap()).toBe('id-sala');
    expect(screen.getByRole('button', { name: 'Mover Sala grande' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Colocar nueva sala' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deseleccionar' })).not.toBeInTheDocument();
    act(() => bridge.emit('layoutaction', { action: 'move', id: 'id-sala' }));
    act(() => bridge.emit('layoutplace', { tx: 5, ty: 6, valid: true }));
    await waitFor(() => expect(spaces.updateSpace).toHaveBeenCalledWith('id-sala', { x: 5, y: 6, w: 5, h: 5 }));
  });

  it('eliminar la sala elegida en el mapa llama a deleteSpace con su id', async () => {
    const spaces = fakeSpaces();
    const bridge = createOfficeBridge();
    renderSection({ spaces, bridge });
    await userEvent.click(screen.getByRole('button', { name: /Editar salas/ }));
    await screen.findByText('Sala grande');
    act(() => bridge.emit('layoutpick', { id: 'id-sala' }));

    act(() => bridge.emit('layoutaction', { action: 'delete', id: 'id-sala' }));

    await waitFor(() => expect(spaces.deleteSpace).toHaveBeenCalledWith('id-sala'));
  });

  it('crear: nombre + ancho + alto y colocar en el mapa llama a createSpace, con el aforo maximo por defecto', async () => {
    const spaces = fakeSpaces();
    const bridge = createOfficeBridge();
    renderSection({ spaces, bridge });
    await userEvent.click(screen.getByRole('button', { name: /Editar salas/ }));
    await screen.findByText('Sala grande');

    await userEvent.clear(screen.getByLabelText(/Nombre de la nueva sala/));
    await userEvent.type(screen.getByLabelText(/Nombre de la nueva sala/), 'Sala chica');
    await userEvent.clear(screen.getByLabelText(/^Ancho$/));
    await userEvent.type(screen.getByLabelText(/^Ancho$/), '7');
    await userEvent.clear(screen.getByLabelText(/^Alto$/));
    await userEvent.type(screen.getByLabelText(/^Alto$/), '6');
    await userEvent.click(screen.getByRole('button', { name: /Colocar nueva sala/ }));
    act(() => bridge.emit('layoutplace', { tx: 1, ty: 2, valid: true }));

    await waitFor(() =>
      expect(spaces.createSpace).toHaveBeenCalledWith({ name: 'Sala chica', x: 1, y: 2, w: 7, h: 6, capacity: 8 }),
    );
  });

  it('crear con aforo manda el aforo pedido', async () => {
    const spaces = fakeSpaces();
    const bridge = createOfficeBridge();
    renderSection({ spaces, bridge });
    await userEvent.click(screen.getByRole('button', { name: /Editar salas/ }));
    await screen.findByText('Sala grande');

    await userEvent.clear(screen.getByLabelText(/Nombre de la nueva sala/));
    await userEvent.type(screen.getByLabelText(/Nombre de la nueva sala/), 'Sala chica');
    await userEvent.clear(screen.getByLabelText(/^Ancho$/));
    await userEvent.type(screen.getByLabelText(/^Ancho$/), '7');
    await userEvent.clear(screen.getByLabelText(/^Alto$/));
    await userEvent.type(screen.getByLabelText(/^Alto$/), '6');
    await userEvent.clear(screen.getByLabelText(/Aforo/));
    await userEvent.type(screen.getByLabelText(/Aforo/), '6');
    await userEvent.click(screen.getByRole('button', { name: /Colocar nueva sala/ }));
    act(() => bridge.emit('layoutplace', { tx: 1, ty: 2, valid: true }));

    await waitFor(() =>
      expect(spaces.createSpace).toHaveBeenCalledWith({ name: 'Sala chica', x: 1, y: 2, w: 7, h: 6, capacity: 6 }),
    );
  });

  it('sin nombre, ancho o alto no se puede colocar: el boton de crear esta deshabilitado', async () => {
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: /Editar salas/ }));
    await screen.findByText('Sala grande');

    // The form starts complete: a free name and the largest capacity.
    expect(screen.getByRole('button', { name: /Colocar nueva sala/ })).toBeEnabled();

    await userEvent.clear(screen.getByLabelText(/Nombre de la nueva sala/));
    expect(screen.getByRole('button', { name: /Colocar nueva sala/ })).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/Nombre de la nueva sala/), 'Sala chica');
    expect(screen.getByRole('button', { name: /Colocar nueva sala/ })).toBeEnabled();

    await userEvent.clear(screen.getByLabelText(/^Ancho$/));
    expect(screen.getByRole('button', { name: /Colocar nueva sala/ })).toBeDisabled();
  });

  it('refuses a side under 6 tiles and accepts exactly 6 (#184)', async () => {
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: /Editar salas/ }));
    await screen.findByText('Sala grande');
    await userEvent.type(screen.getByLabelText(/Nombre de la nueva sala/), 'Sala chica');
    const place = screen.getByRole('button', { name: /Colocar nueva sala/ });

    expect(screen.getByLabelText(/^Ancho$/)).toHaveAttribute('min', '6');
    expect(screen.getByLabelText(/^Alto$/)).toHaveAttribute('min', '6');

    await userEvent.clear(screen.getByLabelText(/^Ancho$/));
    await userEvent.type(screen.getByLabelText(/^Ancho$/), '5');
    expect(place).toBeDisabled();

    await userEvent.clear(screen.getByLabelText(/^Ancho$/));
    await userEvent.type(screen.getByLabelText(/^Ancho$/), '6');
    await userEvent.clear(screen.getByLabelText(/^Alto$/));
    await userEvent.type(screen.getByLabelText(/^Alto$/), '5');
    expect(place).toBeDisabled();

    await userEvent.clear(screen.getByLabelText(/^Alto$/));
    await userEvent.type(screen.getByLabelText(/^Alto$/), '6');
    expect(place).toBeEnabled();
  });

  it('the form only states the minimum size, nothing else', async () => {
    renderSection();
    await userEvent.click(screen.getByRole('button', { name: /Editar salas/ }));
    await screen.findByRole('button', { name: /Colocar nueva sala/ });

    expect(screen.getByText('Mínimo 6 × 6')).toBeInTheDocument();
    expect(screen.queryByText(/Construye primero/)).toBeNull();
  });

  it('un space-name-taken se muestra visible y no borra en silencio el formulario pendiente', async () => {
    const spaces = fakeSpaces({
      createSpace: vi.fn(async () => Promise.reject(new AdminError('space-name-taken'))),
    });
    const bridge = createOfficeBridge();
    renderSection({ spaces, bridge });
    await userEvent.click(screen.getByRole('button', { name: /Editar salas/ }));
    await screen.findByText('Sala grande');

    await userEvent.clear(screen.getByLabelText(/Nombre de la nueva sala/));
    await userEvent.type(screen.getByLabelText(/Nombre de la nueva sala/), 'Sala grande');
    await userEvent.clear(screen.getByLabelText(/^Ancho$/));
    await userEvent.type(screen.getByLabelText(/^Ancho$/), '7');
    await userEvent.clear(screen.getByLabelText(/^Alto$/));
    await userEvent.type(screen.getByLabelText(/^Alto$/), '6');
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
    await userEvent.type(screen.getByLabelText(/^Ancho$/), '7');
    await userEvent.clear(screen.getByLabelText(/^Alto$/));
    await userEvent.type(screen.getByLabelText(/^Alto$/), '6');
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

describe('SpaceEditorSection: a room only asks for its area, the floor is the terrain (#182)', () => {
  it('shows no floor picker even with the material catalog loaded, and creates without a floor', async () => {
    const spaces = fakeSpaces();
    const bridge = createOfficeBridge();
    renderSection({ spaces, bridge });
    await userEvent.click(screen.getByRole('button', { name: /Editar salas/ }));
    await screen.findByText('Sala grande');
    // Let the (mocked, loaded) catalog settle before looking for a picker.
    await act(async () => {});

    expect(screen.queryByRole('group', { name: 'Suelo de la sala' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Material')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Color')).not.toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText(/Nombre de la nueva sala/));
    await userEvent.type(screen.getByLabelText(/Nombre de la nueva sala/), 'Sala chica');
    await userEvent.clear(screen.getByLabelText(/^Ancho$/));
    await userEvent.type(screen.getByLabelText(/^Ancho$/), '7');
    await userEvent.clear(screen.getByLabelText(/^Alto$/));
    await userEvent.type(screen.getByLabelText(/^Alto$/), '6');
    await userEvent.click(screen.getByRole('button', { name: /Colocar nueva sala/ }));
    act(() => bridge.emit('layoutplace', { tx: 1, ty: 2, valid: true }));

    await waitFor(() =>
      expect(spaces.createSpace).toHaveBeenCalledWith({ name: 'Sala chica', x: 1, y: 2, w: 7, h: 6, capacity: 8 }),
    );
  });
});

/** A port whose list holds every room created through it, like the server's. */
function listingCreatedRooms(): SpacesAdminPort {
  const rooms: AdminSpace[] = [SALA];
  return fakeSpaces({
    listSpaces: vi.fn(async () => [...rooms]),
    createSpace: vi.fn(async (input) => {
      const room: AdminSpace = { ...SALA, ...input, id: `id-${rooms.length}`, capacity: input.capacity ?? null };
      rooms.push(room);
      return room;
    }),
  });
}

describe('SpaceEditorSection: the form starts with a free name and a default capacity', () => {
  async function open(spaces = fakeSpaces()) {
    const bridge = createOfficeBridge();
    renderSection({ spaces, bridge });
    await userEvent.click(screen.getByRole('button', { name: /Editar salas/ }));
    await screen.findByText('Sala grande');
    return { bridge, spaces };
  }
  const nameField = () => screen.getByLabelText(/Nombre de la nueva sala/);
  const capacityField = () => screen.getByLabelText(/Aforo/);
  const placeButton = () => screen.getByRole('button', { name: /Colocar nueva sala/ });
  async function setSide(label: RegExp, value: string) {
    await userEvent.clear(screen.getByLabelText(label));
    await userEvent.type(screen.getByLabelText(label), value);
  }

  it('prefills "Sala 1" as a real value when no room holds it', async () => {
    await open();
    expect(nameField()).toHaveValue('Sala 1');
  });

  it('prefills the first "Sala N" no room holds, ignoring case', async () => {
    await open(fakeSpaces({
      listSpaces: vi.fn(async () => [SALA, { ...SALA, id: 'id-1', name: 'sala 1' }, { ...SALA, id: 'id-2', name: 'Sala 2' }]),
    }));
    await waitFor(() => expect(nameField()).toHaveValue('Sala 3'));
  });

  it('lets the name be overwritten', async () => {
    const { bridge, spaces } = await open();
    await userEvent.clear(nameField());
    await userEvent.type(nameField(), 'Cafetería');
    await userEvent.click(placeButton());
    act(() => bridge.emit('layoutplace', { tx: 1, ty: 2, valid: true }));
    await waitFor(() => expect(spaces.createSpace).toHaveBeenCalledWith(expect.objectContaining({ name: 'Cafetería' })));
  });

  it('prefills the capacity with its default, one more than the longer side, with no upper bound', async () => {
    const { bridge, spaces } = await open();
    expect(capacityField()).toHaveValue(10);
    expect(capacityField()).toHaveAttribute('min', '1');
    expect(capacityField()).not.toHaveAttribute('max');

    await userEvent.click(placeButton());
    act(() => bridge.emit('layoutplace', { tx: 1, ty: 2, valid: true }));
    await waitFor(() => expect(spaces.createSpace).toHaveBeenCalledWith(expect.objectContaining({ w: 9, h: 9, capacity: 10 })));
  });

  it('an untouched capacity follows the size', async () => {
    await open();
    await setSide(/^Alto$/, '6');
    expect(capacityField()).toHaveValue(10);
    await setSide(/^Ancho$/, '7');
    expect(capacityField()).toHaveValue(8);
    await setSide(/^Alto$/, '12');
    expect(capacityField()).toHaveValue(13);
  });

  it('a typed capacity is the admin\'s: any size change keeps it, larger than the default included', async () => {
    const { bridge, spaces } = await open();
    await userEvent.clear(capacityField());
    await userEvent.type(capacityField(), '50');
    expect(placeButton()).toBeEnabled();

    await setSide(/^Ancho$/, '6');
    await setSide(/^Alto$/, '6');
    expect(capacityField()).toHaveValue(50);
    expect(placeButton()).toBeEnabled();

    await userEvent.click(placeButton());
    act(() => bridge.emit('layoutplace', { tx: 1, ty: 2, valid: true }));
    await waitFor(() => expect(spaces.createSpace).toHaveBeenCalledWith(expect.objectContaining({ w: 6, h: 6, capacity: 50 })));
  });

  it.each(['', '0', '-3', '2.5'])('refuses a capacity of %j', async (value) => {
    await open();
    fireEvent.change(capacityField(), { target: { value } });
    expect(placeButton()).toBeDisabled();
  });

  it.each(['1', '11', '500'])('accepts a capacity of %j', async (value) => {
    await open();
    fireEvent.change(capacityField(), { target: { value } });
    expect(placeButton()).toBeEnabled();
  });

  it('an invalid side keeps the last default and disables placing', async () => {
    await open();
    await userEvent.clear(screen.getByLabelText(/^Ancho$/));
    expect(capacityField()).toHaveValue(10);
    expect(placeButton()).toBeDisabled();
  });

  it('puts Ancho and Alto on one row, apart from the rest of the form', async () => {
    await open();
    const form = placeButton().closest('form');
    const widthField = screen.getByLabelText(/^Ancho$/).parentElement;
    const heightField = screen.getByLabelText(/^Alto$/).parentElement;
    const row = widthField?.parentElement;
    expect(row).toBe(heightField?.parentElement);
    expect(row).not.toBe(form);
    expect(row?.parentElement).toBe(form);
    expect(capacityField().parentElement?.parentElement).toBe(form);
    expect(nameField().parentElement?.parentElement).toBe(form);
  });
});

describe('SpaceEditorSection: «Múltiple» (#207)', () => {
  async function openForm(name: string, spaces = fakeSpaces()) {
    const bridge = createOfficeBridge();
    renderSection({ spaces, bridge });
    await userEvent.click(screen.getByRole('button', { name: /Editar salas/ }));
    await screen.findByText('Sala grande');
    await userEvent.clear(screen.getByLabelText(/Nombre de la nueva sala/));
    await userEvent.type(screen.getByLabelText(/Nombre de la nueva sala/), name);
    await userEvent.clear(screen.getByLabelText(/^Ancho$/));
    await userEvent.type(screen.getByLabelText(/^Ancho$/), '7');
    await userEvent.clear(screen.getByLabelText(/^Alto$/));
    await userEvent.type(screen.getByLabelText(/^Alto$/), '6');
    await userEvent.clear(screen.getByLabelText(/Aforo/));
    await userEvent.type(screen.getByLabelText(/Aforo/), '4');
    return { bridge, spaces };
  }
  const place = (bridge: ReturnType<typeof createOfficeBridge>, tx: number) =>
    act(() => bridge.emit('layoutplace', { tx, ty: 2, valid: true }));

  it('is off by default: a created room goes back to a fresh form with the next free name', async () => {
    const { bridge, spaces } = await openForm('Sala 1', listingCreatedRooms());
    expect(screen.getByRole('checkbox', { name: /^Múltiple/ })).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: /Colocar nueva sala/ }));
    place(bridge, 1);

    await waitFor(() => expect(spaces.createSpace).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText(/Nombre de la nueva sala/)).toHaveValue('Sala 2'));
    expect(screen.getByLabelText(/^Ancho$/)).toHaveValue(9);
    expect(screen.getByLabelText(/Aforo/)).toHaveValue(10);
  });

  it('on, a created room goes back to placing the next one: same size and capacity, the next name, until Escape', async () => {
    const { bridge, spaces } = await openForm('Sala 1');
    await userEvent.click(screen.getByRole('checkbox', { name: /^Múltiple/ }));
    await userEvent.click(screen.getByRole('button', { name: /Colocar nueva sala/ }));

    place(bridge, 1);
    await waitFor(() => expect(spaces.createSpace).toHaveBeenCalledWith({ name: 'Sala 1', x: 1, y: 2, w: 7, h: 6, capacity: 4 }));
    expect(await screen.findByText(/Toca el nuevo sitio/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /^Múltiple/ })).toBeChecked();
    place(bridge, 20);
    await waitFor(() => expect(spaces.createSpace).toHaveBeenCalledWith({ name: 'Sala 2', x: 20, y: 2, w: 7, h: 6, capacity: 4 }));
    expect(await screen.findByText(/Toca el nuevo sitio/)).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByText(/Toca el nuevo sitio/)).not.toBeInTheDocument();
    // The form holds what was about to be placed, ready to go on later.
    await waitFor(() => expect(screen.getByLabelText(/Nombre de la nueva sala/)).toHaveValue('Sala 3'));
    expect(screen.getByLabelText(/^Ancho$/)).toHaveValue(7);
    expect(screen.getByLabelText(/Aforo/)).toHaveValue(4);
    expect(spaces.createSpace).toHaveBeenCalledTimes(2);
  });

  it('on, skips a next name another room already has', async () => {
    const spaces = fakeSpaces({ listSpaces: vi.fn(async () => [SALA, { ...SALA, id: 'id-2', name: 'Sala 2' }]) });
    const { bridge } = await openForm('Sala 1', spaces);
    await userEvent.click(screen.getByRole('checkbox', { name: /^Múltiple/ }));
    await userEvent.click(screen.getByRole('button', { name: /Colocar nueva sala/ }));

    place(bridge, 1);
    await waitFor(() => expect(spaces.createSpace).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Toca el nuevo sitio/)).toBeInTheDocument();
    place(bridge, 20);
    await waitFor(() => expect(spaces.createSpace).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Sala 3' })));
  });

  it('on, a refused room shows why and is placed again with the same name: only that placement is dropped', async () => {
    const createSpace = vi.fn<SpacesAdminPort['createSpace']>(async () => Promise.reject(new AdminError('space-overlap')));
    const spaces = fakeSpaces({ createSpace });
    const { bridge } = await openForm('Sala 1', spaces);
    await userEvent.click(screen.getByRole('checkbox', { name: /^Múltiple/ }));
    await userEvent.click(screen.getByRole('button', { name: /Colocar nueva sala/ }));

    place(bridge, 1);
    await waitFor(() => expect(createSpace).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/Toca el nuevo sitio/)).toBeInTheDocument());
    expect(screen.getByRole('alert')).toBeInTheDocument();

    createSpace.mockImplementation(async () => SALA);
    place(bridge, 20);
    await waitFor(() => expect(createSpace).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Sala 1', x: 20 })));
  });
});

describe('SpaceEditorSection: Escape, one level per press', () => {
  it('standalone: releases a selection first, then leaves like "Salir"', async () => {
    const onExit = vi.fn();
    const onEditingChange = vi.fn();
    const { bridge } = renderSection({ onExit, onEditingChange });
    await userEvent.click(screen.getByRole('button', { name: /Editar salas/ }));
    await screen.findByText('Sala grande');
    const selectedOnMap = trackSelectionOnMap(bridge);
    act(() => bridge.emit('layoutpick', { id: 'id-sala' }));
    expect(selectedOnMap()).toBe('id-sala');

    await userEvent.keyboard('{Escape}');
    expect(selectedOnMap()).toBeNull();
    expect(screen.getByRole('button', { name: /Salir/ })).toBeInTheDocument();
    expect(onExit).not.toHaveBeenCalled();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: /Salir/ })).not.toBeInTheDocument();
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('cancels a placement before anything else', async () => {
    const onExit = vi.fn();
    renderSection({ onExit });
    await userEvent.click(screen.getByRole('button', { name: /Editar salas/ }));
    await screen.findByText('Sala grande');
    await userEvent.type(screen.getByLabelText('Nombre de la nueva sala'), 'Office');
    await userEvent.click(screen.getByRole('button', { name: 'Colocar nueva sala' }));
    expect(screen.getByText(/Toca el nuevo sitio/)).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByText(/Toca el nuevo sitio/)).not.toBeInTheDocument();
    expect(onExit).not.toHaveBeenCalled();
  });

  it('embedded: a selection is released first, then with nothing held it asks the section around it to exit', async () => {
    const onExit = vi.fn();
    const { bridge, spaces } = renderSection({ embedded: true, initiallyActive: true, onExit });
    await waitFor(() => expect(spaces.listSpaces).toHaveBeenCalled());
    const selectedOnMap = trackSelectionOnMap(bridge);
    act(() => bridge.emit('layoutpick', { id: 'id-sala' }));
    await waitFor(() => expect(selectedOnMap()).toBe('id-sala'));

    await userEvent.keyboard('{Escape}');
    expect(onExit).not.toHaveBeenCalled();
    expect(selectedOnMap()).toBeNull();

    await userEvent.keyboard('{Escape}');
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Colocar nueva sala' })).toBeInTheDocument();
  });

  it('embedded: the room list goes back to the default view first, and only the next press exits', async () => {
    const onExit = vi.fn();
    renderSection({ embedded: true, initiallyActive: true, onExit });
    await userEvent.click(screen.getByRole('button', { name: 'Editar salas' }));
    await screen.findByText('Sala grande');

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByText('Sala grande')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar salas' })).toBeInTheDocument();
    expect(onExit).not.toHaveBeenCalled();

    await userEvent.keyboard('{Escape}');
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('embedded without a way to exit leaves the press alone', async () => {
    const { spaces } = renderSection({ embedded: true, initiallyActive: true });
    await waitFor(() => expect(spaces.listSpaces).toHaveBeenCalled());
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});


describe('SpaceEditorSection embedded in "Editar espacios": the rooms behind "Editar salas", like the desks', () => {
  function renderEmbedded(overrides: Partial<Parameters<typeof SpaceEditorSection>[0]> = {}) {
    return renderSection({ embedded: true, initiallyActive: true, ...overrides });
  }

  it('the default view lists no rooms: "Editar salas" and the creation form', async () => {
    const { spaces } = renderEmbedded();
    await waitFor(() => expect(spaces.listSpaces).toHaveBeenCalled());
    await act(async () => {});

    expect(screen.getByRole('heading', { name: 'Salas' })).toBeInTheDocument();
    const enter = screen.getByRole('button', { name: 'Editar salas' });
    const form = screen.getByRole('button', { name: 'Colocar nueva sala' }).closest('form');
    // Above the form, like "Editar escritorios" heads the desk group.
    expect(enter.compareDocumentPosition(form as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('Sala grande')).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Volver' })).not.toBeInTheDocument();
  });

  it('"Editar salas" swaps the form for the room list, and "Volver" swaps it back', async () => {
    const onListViewChange = vi.fn();
    renderEmbedded({ onListViewChange });

    await userEvent.click(screen.getByRole('button', { name: 'Editar salas' }));

    expect(await screen.findByText('Sala grande')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mover Sala grande' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Eliminar Sala grande' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Volver' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Colocar nueva sala' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar salas' })).not.toBeInTheDocument();
    expect(onListViewChange).toHaveBeenLastCalledWith(true);

    await userEvent.click(screen.getByRole('button', { name: 'Volver' }));

    expect(screen.queryByText('Sala grande')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Colocar nueva sala' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar salas' })).toBeInTheDocument();
    expect(onListViewChange).toHaveBeenLastCalledWith(false);
  });

  it('a row move goes back to the room list once placed', async () => {
    const { spaces, bridge } = renderEmbedded();
    await userEvent.click(screen.getByRole('button', { name: 'Editar salas' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Mover Sala grande' }));

    act(() => bridge.emit('layoutplace', { tx: 5, ty: 6, valid: true }));

    await waitFor(() => expect(spaces.updateSpace).toHaveBeenCalledWith('id-sala', { x: 5, y: 6, w: 5, h: 5 }));
    expect(await screen.findByRole('button', { name: 'Mover Sala grande' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Volver' })).toBeInTheDocument();
  });

  it('a room picked on the map from the default view keeps the default view, and its buttons on the map act on it', async () => {
    const { spaces, bridge } = renderEmbedded();
    await waitFor(() => expect(spaces.listSpaces).toHaveBeenCalled());
    await act(async () => {});
    const selectedOnMap = trackSelectionOnMap(bridge);

    act(() => bridge.emit('layoutpick', { id: 'id-sala' }));

    expect(selectedOnMap()).toBe('id-sala');
    expect(screen.getByRole('button', { name: 'Colocar nueva sala' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deseleccionar' })).not.toBeInTheDocument();
    act(() => bridge.emit('layoutaction', { action: 'deselect', id: 'id-sala' }));
    expect(selectedOnMap()).toBeNull();
    act(() => bridge.emit('layoutpick', { id: 'id-sala' }));
    act(() => bridge.emit('layoutaction', { action: 'delete', id: 'id-sala' }));
    await waitFor(() => expect(spaces.deleteSpace).toHaveBeenCalledWith('id-sala'));
  });
});
