import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminError } from '../dashboard/adminPort';
import type { AdminDesk, DeskAdminPort } from '../dashboard/deskAdminPort';
import type { SpacesAdminPort } from '../dashboard/spacesAdminPort';
import { createOfficeBridge } from '../game/officeBridge';
import { DeskEditorSection, deskName } from './DeskEditorSection';

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

  const MESA_B: AdminDesk = { id: 'id-mesa-b', label: 'Mesa 5', x: 20, y: 20, w: 3, h: 3, occupant: null };

  async function openListOfTwo(overrides: Partial<DeskAdminPort> = {}) {
    const desks = fakeDesks({ listDesks: vi.fn(async () => [MESA, MESA_B]), ...overrides });
    const bridge = createOfficeBridge();
    render(<DeskEditorSection bridge={bridge} desks={desks} spaces={fakeSpaces()} refreshDesks={vi.fn()} refreshSpaces={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /Editar escritorios/ }));
    await screen.findByText('Mesa 5');
    return { desks, bridge };
  }

  it('each row is one line: the name, a "Mover" and a trash, with no "Seleccionar" in between', async () => {
    await openListOfTwo();

    expect(screen.queryByRole('button', { name: /Seleccionar/ })).not.toBeInTheDocument();
    for (const name of ['Mesa 4', 'Mesa 5']) {
      expect(screen.getByRole('button', { name: `Mover ${name}` })).toHaveTextContent(/^Mover$/);
      const trash = screen.getByRole('button', { name: `Eliminar ${name}` });
      expect(trash).toHaveAttribute('title', 'Eliminar');
      // An icon only: nothing to read but its label.
      expect(trash).toHaveTextContent('');
      expect(trash.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    }
    const row = screen.getByText('Mesa 4').closest('li');
    expect(within(row as HTMLElement).getAllByRole('button')).toHaveLength(2);
    // Nothing is selected: the selection actions are not on screen.
    expect(screen.queryByRole('button', { name: 'Deseleccionar' })).not.toBeInTheDocument();
  });

  it('"Mover" on a row moves that desk, not another one', async () => {
    const { desks, bridge } = await openListOfTwo();

    await userEvent.click(screen.getByRole('button', { name: 'Mover Mesa 5' }));
    expect(screen.getByText(/Toca el nuevo sitio en el mapa para confirmarlo/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
    act(() => bridge.emit('layoutplace', { tx: 5, ty: 6, valid: true }));

    await waitFor(() => expect(desks.updateDesk).toHaveBeenCalledWith('id-mesa-b', { x: 5, y: 6 }));
    expect(desks.updateDesk).toHaveBeenCalledTimes(1);
  });

  it('the trash on a row deletes that desk, not another one', async () => {
    const { desks } = await openListOfTwo();

    await userEvent.click(screen.getByRole('button', { name: 'Eliminar Mesa 5' }));

    await waitFor(() => expect(desks.deleteDesk).toHaveBeenCalledWith('id-mesa-b'));
    expect(desks.deleteDesk).toHaveBeenCalledTimes(1);
  });

  it('every button of the list is disabled while a delete is in flight', async () => {
    let finish: () => void = () => {};
    const deleteDesk = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    await openListOfTwo({ deleteDesk });

    await userEvent.click(screen.getByRole('button', { name: 'Eliminar Mesa 4' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Mover Mesa 5' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Mover Mesa 4' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Eliminar Mesa 4' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Eliminar Mesa 5' })).toBeDisabled();
    await act(async () => finish());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mover Mesa 5' })).toBeEnabled());
  });

  it('a refused delete shows its reason and leaves the list as it was', async () => {
    const { desks } = await openListOfTwo({ deleteDesk: vi.fn(async () => Promise.reject(new AdminError('unknown'))) });

    await userEvent.click(screen.getByRole('button', { name: 'Eliminar Mesa 5' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo completar la operación.');
    expect(desks.deleteDesk).toHaveBeenCalledWith('id-mesa-b');
    expect(screen.getByText('Mesa 4')).toBeInTheDocument();
    expect(screen.getByText('Mesa 5')).toBeInTheDocument();
  });

  it('selecting a desk on the map still offers Mover, Eliminar and Deseleccionar', async () => {
    const { desks, bridge } = await openListOfTwo();

    act(() => bridge.emit('layoutpick', { id: 'id-mesa' }));

    expect(screen.getByRole('button', { name: 'Mover' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Eliminar' })).toBeInTheDocument();
    // The row actions give way to the selection's: one desk, three buttons.
    expect(screen.queryByRole('button', { name: 'Mover Mesa 5' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mover' }));
    act(() => bridge.emit('layoutplace', { tx: 1, ty: 1, valid: true }));
    await waitFor(() => expect(desks.updateDesk).toHaveBeenCalledWith('id-mesa', { x: 1, y: 1 }));
    await screen.findByText('Mesa 5');
    act(() => bridge.emit('layoutpick', { id: 'id-mesa' }));
    await userEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(desks.deleteDesk).toHaveBeenCalledWith('id-mesa'));
    act(() => bridge.emit('layoutpick', { id: 'id-mesa-b' }));
    expect(screen.getByRole('button', { name: 'Deseleccionar' })).toBeInTheDocument();
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

  it('names an empty desk by where it is, and a claimed one by who claimed it', async () => {
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

    expect(await screen.findByText('Escritorio libre (4, 7)')).toBeInTheDocument();
    expect(screen.getByText('Escritorio de Ana')).toBeInTheDocument();
  });

  it('the row buttons carry the desk name so every accessible name is unique, and the name never wraps', async () => {
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
    await screen.findByText('Escritorio de Ana');

    expect(screen.getAllByRole('button', { name: /^Mover/ }).map((button) => button.getAttribute('aria-label'))).toEqual([
      'Mover Escritorio libre (4, 7)',
      'Mover Escritorio de Ana',
    ]);
    expect(screen.getAllByRole('button', { name: /^Eliminar/ }).map((button) => button.getAttribute('aria-label'))).toEqual([
      'Eliminar Escritorio libre (4, 7)',
      'Eliminar Escritorio de Ana',
    ]);
    // A long name is cut with an ellipsis by CSS; the full one stays in a tooltip.
    expect(screen.getByText('Escritorio de Ana')).toHaveAttribute('title', 'Escritorio de Ana');
  });

  it('embedded in "Editar espacios" it leaves "Salir" to the section around it and offers "Volver" instead', async () => {
    const bridge = createOfficeBridge();
    render(
      <DeskEditorSection bridge={bridge} desks={fakeDesks()} spaces={fakeSpaces()} refreshDesks={vi.fn()} refreshSpaces={vi.fn()} embedded initiallyActive />,
    );

    expect(await screen.findByText('Mesa 4')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Escritorios' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Salir/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Volver' })).toBeInTheDocument();
  });

  it('embedded, "Volver" leaves the desk editor without calling the exit of the section around it', async () => {
    const onEditingChange = vi.fn();
    const onExit = vi.fn();
    const bridge = createOfficeBridge();
    render(
      <DeskEditorSection
        bridge={bridge}
        desks={fakeDesks()}
        spaces={fakeSpaces()}
        refreshDesks={vi.fn()}
        refreshSpaces={vi.fn()}
        onEditingChange={onEditingChange}
        onExit={onExit}
        embedded
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Editar escritorios' }));
    await screen.findByText('Mesa 4');

    await userEvent.click(screen.getByRole('button', { name: 'Volver' }));

    expect(screen.getByRole('button', { name: 'Editar escritorios' })).toBeInTheDocument();
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
    expect(onExit).not.toHaveBeenCalled();
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

describe('DeskEditorSection inside "Editar espacios" (embedded)', () => {
  function renderEmbedded(overrides: Partial<Parameters<typeof DeskEditorSection>[0]> = {}) {
    const bridge = overrides.bridge ?? createOfficeBridge();
    const props = {
      bridge,
      desks: fakeDesks(),
      spaces: fakeSpaces(),
      refreshDesks: vi.fn(),
      refreshSpaces: vi.fn(),
      embedded: true,
      ...overrides,
    };
    return { ...props, ...render(<DeskEditorSection {...props} />) };
  }

  const placeAt = (bridge: ReturnType<typeof createOfficeBridge>, tx = 1, ty = 2) =>
    act(() => bridge.emit('layoutplace', { tx, ty, valid: true }));

  it('its default view is two buttons under the heading: the submenu and "Crear escritorio"', () => {
    renderEmbedded();

    expect(screen.getByRole('heading', { name: 'Escritorios' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar escritorios' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crear escritorio' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Volver' })).not.toBeInTheDocument();
  });

  it('its list view is only the list: "Crear escritorio" lives in the default view', async () => {
    renderEmbedded();
    await userEvent.click(screen.getByRole('button', { name: 'Editar escritorios' }));
    await screen.findByText('Mesa 4');

    expect(screen.queryByRole('button', { name: 'Crear escritorio' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mover Mesa 4' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Eliminar Mesa 4' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Volver' })).toBeInTheDocument();
  });

  it('"Crear escritorio" starts the placement at once, asking the section around it for the map first', async () => {
    const onRequestActive = vi.fn();
    const onEditingChange = vi.fn();
    const { bridge } = renderEmbedded({ onRequestActive, onEditingChange });
    const commands: unknown[] = [];
    bridge.onCommand('layoutedit', (command) => commands.push(command));

    await userEvent.click(screen.getByRole('button', { name: 'Crear escritorio' }));

    expect(onRequestActive).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Toca el nuevo sitio en el mapa para confirmarlo/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
    // Just the placement: no list, no way into the list.
    expect(screen.queryByRole('button', { name: /^Mover/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar escritorios' })).not.toBeInTheDocument();
    expect(onEditingChange).toHaveBeenLastCalledWith(true);
    expect(commands.at(-1)).toMatchObject({ placing: { w: 3, h: 3 } });
  });

  it('a map click creates the desk there and goes back to the default view', async () => {
    const desks = fakeDesks();
    const { bridge } = renderEmbedded({ desks });
    await userEvent.click(screen.getByRole('button', { name: 'Crear escritorio' }));

    placeAt(bridge);

    await waitFor(() => expect(desks.createDesk).toHaveBeenCalledWith({ x: 1, y: 2 }));
    expect(await screen.findByRole('button', { name: 'Editar escritorios' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crear escritorio' })).toBeInTheDocument();
    expect(screen.queryByText(/Toca el nuevo sitio/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('"Cancelar" goes back to the default view without creating anything', async () => {
    const desks = fakeDesks();
    const onEditingChange = vi.fn();
    renderEmbedded({ desks, onEditingChange });
    await userEvent.click(screen.getByRole('button', { name: 'Crear escritorio' }));

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.getByRole('button', { name: 'Editar escritorios' })).toBeInTheDocument();
    expect(screen.queryByText(/Toca el nuevo sitio/)).not.toBeInTheDocument();
    expect(desks.createDesk).not.toHaveBeenCalled();
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
  });

  it('a refusal goes back to the default view too, with the reason still visible', async () => {
    const desks = fakeDesks({ createDesk: vi.fn(async () => Promise.reject(new AdminError('desk-overlap'))) });
    const { bridge } = renderEmbedded({ desks });
    await userEvent.click(screen.getByRole('button', { name: 'Crear escritorio' }));

    placeAt(bridge);

    // The alert already shows while the editor is still active, so wait for the
    // default view itself (its entry button) before asserting on what it keeps.
    expect(await screen.findByRole('button', { name: 'Editar escritorios' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Esas coordenadas chocan con otro escritorio: cada uno ocupa 3×3 casillas y ni los bordes pueden tocarse.',
    );
    expect(screen.queryByText(/Toca el nuevo sitio/)).not.toBeInTheDocument();

    // The next try starts clean.
    await userEvent.click(screen.getByRole('button', { name: 'Crear escritorio' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a placement being made is not the list: the desks are not offered to pick until it ends', async () => {
    const { bridge } = renderEmbedded();
    await userEvent.click(screen.getByRole('button', { name: 'Crear escritorio' }));

    // A pick on the map while placing changes nothing.
    act(() => bridge.emit('layoutpick', { id: 'id-mesa' }));

    expect(screen.getByText(/Toca el nuevo sitio/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mover' })).not.toBeInTheDocument();
  });

  describe('Escape, one level per press', () => {
    it('releases a selection made on the map first, then leaves the list for the default view, and never asks the section around it to exit', async () => {
      const onExit = vi.fn();
      const { bridge } = renderEmbedded({ onExit });
      await userEvent.click(screen.getByRole('button', { name: 'Editar escritorios' }));
      await screen.findByText('Mesa 4');
      act(() => bridge.emit('layoutpick', { id: 'id-mesa' }));
      expect(screen.getByRole('button', { name: 'Mover' })).toBeInTheDocument();

      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('button', { name: 'Mover' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Volver' })).toBeInTheDocument();

      await userEvent.keyboard('{Escape}');
      expect(screen.getByRole('button', { name: 'Editar escritorios' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Volver' })).not.toBeInTheDocument();
      expect(onExit).not.toHaveBeenCalled();
    });

    it('cancels a move started from a row first, back on the list, and the next press leaves the list', async () => {
      const desks = fakeDesks();
      const onExit = vi.fn();
      renderEmbedded({ desks, onExit });
      await userEvent.click(screen.getByRole('button', { name: 'Editar escritorios' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Mover Mesa 4' }));
      expect(screen.getByText(/Toca el nuevo sitio/)).toBeInTheDocument();

      await userEvent.keyboard('{Escape}');
      expect(screen.queryByText(/Toca el nuevo sitio/)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Mover Mesa 4' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Volver' })).toBeInTheDocument();
      expect(desks.updateDesk).not.toHaveBeenCalled();

      await userEvent.keyboard('{Escape}');
      expect(screen.getByRole('button', { name: 'Editar escritorios' })).toBeInTheDocument();
      expect(onExit).not.toHaveBeenCalled();
    });

    it('cancels a placement and lands on the default view in one press', async () => {
      const desks = fakeDesks();
      renderEmbedded({ desks });
      await userEvent.click(screen.getByRole('button', { name: 'Crear escritorio' }));

      await userEvent.keyboard('{Escape}');

      expect(screen.getByRole('button', { name: 'Editar escritorios' })).toBeInTheDocument();
      expect(screen.queryByText(/Toca el nuevo sitio/)).not.toBeInTheDocument();
      expect(desks.createDesk).not.toHaveBeenCalled();
    });

    it('is left alone in the default view (the rooms part owns it there)', async () => {
      const onExit = vi.fn();
      renderEmbedded({ onExit });
      const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });

      window.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(onExit).not.toHaveBeenCalled();
    });
  });
});

describe('DeskEditorSection standalone: Escape', () => {
  it('cancels a move first, then leaves like "Salir"', async () => {
    const onExit = vi.fn();
    const onEditingChange = vi.fn();
    render(
      <DeskEditorSection bridge={createOfficeBridge()} desks={fakeDesks()} spaces={fakeSpaces()} refreshDesks={vi.fn()} refreshSpaces={vi.fn()} onExit={onExit} onEditingChange={onEditingChange} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Editar escritorios/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Mover Mesa 4' }));
    expect(screen.getByText(/Toca el nuevo sitio/)).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByText(/Toca el nuevo sitio/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Salir/ })).toBeInTheDocument();
    expect(onExit).not.toHaveBeenCalled();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('button', { name: /Salir/ })).not.toBeInTheDocument();
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

describe('deskName', () => {
  const base: AdminDesk = { id: 'id-d', label: '', x: 106, y: 71, w: 3, h: 3, occupant: null };

  it('keeps the label of an older desk first', () => {
    expect(deskName({ ...base, label: 'Mesa 4', occupant: { id: 'u-ana', displayName: 'Ana' } })).toBe('Mesa 4');
  });

  it('tells a free desk apart by where it is', () => {
    expect(deskName(base)).toBe('Escritorio libre (106, 71)');
  });

  it('names a claimed desk after its owner, with no coordinates', () => {
    expect(deskName({ ...base, occupant: { id: 'u-hugo', displayName: 'Hugo' } })).toBe('Escritorio de Hugo');
  });

  it('falls back to the place when the owner has no display name', () => {
    expect(deskName({ ...base, occupant: { id: 'u-x', displayName: '' } })).toBe('Escritorio ocupado (106, 71)');
  });
});
