import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AdminDesk, DeskAdminPort } from '../dashboard/deskAdminPort';
import type { AdminSpace, SpacesAdminPort } from '../dashboard/spacesAdminPort';
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
