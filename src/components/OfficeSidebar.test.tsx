import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { AdminDesk, DeskAdminPort } from '../dashboard/deskAdminPort';
import type { AdminSpace, SpacesAdminPort } from '../dashboard/spacesAdminPort';
import { SIDEBAR_TOP } from '../game/hudLayout';
import { createOfficeBridge } from '../game/officeBridge';
import type { RosterPeer } from '../game/roster';
import { OfficeSidebar } from './OfficeSidebar';

const SELF: RosterPeer = { sessionId: 'yo', name: 'Hugo', status: 'g' };
const ANA: RosterPeer = { sessionId: 'a', name: 'Ana', status: 'g' };
const BETO: RosterPeer = { sessionId: 'b', name: 'Beto', status: 'y' };

function renderSidebar(overrides: Partial<ComponentProps<typeof OfficeSidebar>> = {}) {
  const props = { self: SELF, peers: [ANA, BETO], ...overrides };
  render(<OfficeSidebar {...props} />);
  return props;
}

describe('OfficeSidebar (#74)', () => {
  it('esta colapsada por defecto: el boton dice que no esta expandida', () => {
    renderSidebar();

    expect(screen.getByRole('button', { name: /Personas/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('activar el boton la expande y volver a activarlo la colapsa', async () => {
    const user = userEvent.setup();
    renderSidebar();
    const toggle = screen.getByRole('button', { name: /Personas/ });

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('searchbox')).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('lista a uno mismo primero y a los pares despues, expandida', async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole('button', { name: /Personas/ }));

    const items = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(items[0]).toMatch(/Hugo/);
    expect(items[1]).toMatch(/Ana/);
    expect(items[2]).toMatch(/Beto/);
  });

  it('el buscador filtra las entradas visibles', async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole('button', { name: /Personas/ }));

    await user.type(screen.getByRole('searchbox'), 'ana');

    const items = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatch(/Ana/);
  });

  it('el panel fijo lee su borde superior de SIDEBAR_TOP y el resto de la geometria de la spec', () => {
    renderSidebar();

    const panel = screen.getByRole('complementary', { name: 'Personas' });
    expect(panel).toHaveStyle({
      position: 'fixed',
      top: `${SIDEBAR_TOP}px`,
      bottom: '72px',
      width: '280px',
      zIndex: '15',
    });
  });

  it('forceCollapsed en true colapsa aunque estuviese expandida', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<OfficeSidebar self={SELF} peers={[ANA]} />);
    await user.click(screen.getByRole('button', { name: /Personas/ }));
    expect(screen.getByRole('button', { name: /Personas/ })).toHaveAttribute('aria-expanded', 'true');

    rerender(<OfficeSidebar self={SELF} peers={[ANA]} forceCollapsed />);

    expect(screen.getByRole('button', { name: /Personas/ })).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('OfficeSidebar: seccion de administracion de escritorios (#74, PR3c + PR4)', () => {
  const MESA: AdminDesk = { id: 'id-mesa', label: 'Mesa 4', x: 10, y: 10, w: 3, h: 3, occupant: null };
  const SALA: AdminSpace = { id: 'id-sala', name: 'Sala grande', x: 0, y: 0, w: 4, h: 4, capacity: null, kind: 'room' };

  function fakeDesks(): DeskAdminPort {
    return {
      listDesks: vi.fn(async () => [MESA]),
      createDesk: vi.fn(async () => MESA),
      updateDesk: vi.fn(async () => MESA),
      deleteDesk: vi.fn(async () => undefined),
    };
  }

  function fakeSpaces(): SpacesAdminPort {
    return {
      listSpaces: vi.fn(async () => [SALA]),
      createSpace: vi.fn(),
      updateSpace: vi.fn(),
      deleteSpace: vi.fn(),
    } as unknown as SpacesAdminPort;
  }

  it('sin rol de administracion, expandida, no ofrece nada de edicion', async () => {
    const user = userEvent.setup();
    renderSidebar({ role: 'employee' });

    await user.click(screen.getByRole('button', { name: /Personas/ }));

    expect(screen.queryByRole('button', { name: /Editar escritorios/ })).not.toBeInTheDocument();
  });

  it('sin saber el rol todavia (null), no ofrece nada de edicion', async () => {
    const user = userEvent.setup();
    renderSidebar({ role: null });

    await user.click(screen.getByRole('button', { name: /Personas/ }));

    expect(screen.queryByRole('button', { name: /Editar escritorios/ })).not.toBeInTheDocument();
  });

  it('con rol admin, expandida, ofrece la seccion de escritorios (cargada de forma diferida)', async () => {
    const user = userEvent.setup();
    renderSidebar({
      role: 'admin',
      bridge: createOfficeBridge(),
      desks: fakeDesks(),
      spaces: fakeSpaces(),
      refreshDesks: vi.fn(),
      refreshSpaces: vi.fn(),
    });

    await user.click(screen.getByRole('button', { name: /Personas/ }));

    expect(await screen.findByRole('button', { name: /Editar escritorios/ })).toBeInTheDocument();
  });

  it('con rol superadmin, expandida, ofrece la seccion de escritorios', async () => {
    const user = userEvent.setup();
    renderSidebar({
      role: 'superadmin',
      bridge: createOfficeBridge(),
      desks: fakeDesks(),
      spaces: fakeSpaces(),
      refreshDesks: vi.fn(),
      refreshSpaces: vi.fn(),
    });

    await user.click(screen.getByRole('button', { name: /Personas/ }));

    expect(await screen.findByRole('button', { name: /Editar escritorios/ })).toBeInTheDocument();
  });

  it('con rol admin y el resto de props, pero sin spaces, no ofrece nada de edicion (#74, PR4 addition)', async () => {
    const user = userEvent.setup();
    renderSidebar({
      role: 'admin',
      bridge: createOfficeBridge(),
      desks: fakeDesks(),
      refreshDesks: vi.fn(),
      refreshSpaces: vi.fn(),
    });

    await user.click(screen.getByRole('button', { name: /Personas/ }));

    expect(screen.queryByRole('button', { name: /Editar escritorios/ })).not.toBeInTheDocument();
  });
});
