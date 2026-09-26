import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { AssetAdminPort } from '../dashboard/assetAdminPort';
import type { AdminDesk, DeskAdminPort } from '../dashboard/deskAdminPort';
import type { AdminSpace, SpacesAdminPort } from '../dashboard/spacesAdminPort';
import { SIDEBAR_TOP } from '../game/hudLayout';
import { createOfficeBridge } from '../game/officeBridge';
import { statusCssColor } from '../game/presence';
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

  it('muestra cuantos hay en linea, contandose a uno mismo, tambien expandida', async () => {
    const user = userEvent.setup();
    renderSidebar();
    const toggle = screen.getByRole('button', { name: /Personas/ });

    // The online count moved here from BottomBar: it belongs next to the list.
    expect(toggle).toHaveTextContent('Personas conectadas (3)');
    await user.click(toggle);
    expect(toggle).toHaveTextContent('Personas conectadas (3)');
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

  it('marca el estado con el mismo punto sober de color que usa la barra inferior, no con un emoji', async () => {
    const user = userEvent.setup();
    renderSidebar({ peers: [{ sessionId: 'a', name: 'Ana', status: 'y' }, BETO] });

    await user.click(screen.getByRole('button', { name: /Personas/ }));

    const items = screen.getAllByRole('listitem');
    const anaItem = items.find((item) => item.textContent?.includes('Ana'));
    expect(anaItem).not.toBeUndefined();
    // Nada de 🟢/🟡/🔴: el mismo lenguaje visual sobrio que `BottomBar.meDot`.
    expect(anaItem?.textContent).not.toMatch(/[\u{1F534}\u{1F7E1}\u{1F7E2}]/u);
    const dot = anaItem?.querySelector('span[style]');
    expect(dot).toHaveStyle({ background: statusCssColor('y') });
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
      zIndex: '15',
    });
    // The 280px width (#90) and the bottom edge, which now follows the bottom
    // bar's real height (#86), live in CSS that jsdom does not load:
    // `HudLayout.browser.test.tsx` measures both.
  });

  it('expandida ofrece un boton Cerrar que la colapsa (#86, pantallas muy chicas)', async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole('button', { name: /Personas/ }));

    await user.click(screen.getByRole('button', { name: 'Cerrar' }));

    expect(screen.getByRole('button', { name: /Personas/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('colapsada no hay nada que cerrar', () => {
    renderSidebar();

    expect(screen.queryByRole('button', { name: 'Cerrar' })).not.toBeInTheDocument();
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

describe('OfficeSidebar: panel "Personalizar" (migra la edicion de escritorios/salas y el catalogo)', () => {
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

  function fakeAssets(): AssetAdminPort {
    return {
      listAssets: vi.fn(async () => []),
      createAsset: vi.fn(),
      archiveAsset: vi.fn(),
      updateAsset: vi.fn(),
    };
  }

  function adminProps() {
    return {
      role: 'admin' as const,
      bridge: createOfficeBridge(),
      desks: fakeDesks(),
      spaces: fakeSpaces(),
      refreshDesks: vi.fn(),
      refreshSpaces: vi.fn(),
    };
  }

  it('esta colapsado por defecto', () => {
    renderSidebar();

    expect(screen.getByRole('button', { name: /Personalizar/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('sin rol de administracion, activarlo va DIRECTO a "Mi espacio", sin menu intermedio', async () => {
    const user = userEvent.setup();
    renderSidebar({ role: 'employee' });

    await user.click(screen.getByRole('button', { name: /Personalizar/ }));

    expect(screen.getByRole('heading', { name: 'Mi espacio' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Editar escritorios/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Editar salas/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Catálogo/ })).not.toBeInTheDocument();
  });

  it('sin saber el rol todavia (null), tambien va directo a "Mi espacio"', async () => {
    const user = userEvent.setup();
    renderSidebar({ role: null });

    await user.click(screen.getByRole('button', { name: /Personalizar/ }));

    expect(screen.getByRole('heading', { name: 'Mi espacio' })).toBeInTheDocument();
  });

  it('con rol admin, ofrece la edicion de escritorios (cargada de forma diferida)', async () => {
    const user = userEvent.setup();
    renderSidebar(adminProps());

    await user.click(screen.getByRole('button', { name: /Personalizar/ }));

    expect(await screen.findByRole('button', { name: /Editar escritorios/ })).toBeInTheDocument();
  });

  it('con rol superadmin, ofrece la edicion de escritorios', async () => {
    const user = userEvent.setup();
    renderSidebar({ ...adminProps(), role: 'superadmin' });

    await user.click(screen.getByRole('button', { name: /Personalizar/ }));

    expect(await screen.findByRole('button', { name: /Editar escritorios/ })).toBeInTheDocument();
  });

  it('con rol admin y el resto de props, pero sin spaces, no ofrece edicion de layout (#74, PR4 addition)', async () => {
    const user = userEvent.setup();
    const { spaces: _spaces, ...rest } = adminProps();
    renderSidebar(rest);

    await user.click(screen.getByRole('button', { name: /Personalizar/ }));

    expect(screen.queryByRole('button', { name: /Editar escritorios/ })).not.toBeInTheDocument();
  });

  it('con rol admin y spaces, ofrece TAMBIEN la edicion de salas', async () => {
    const user = userEvent.setup();
    renderSidebar(adminProps());

    await user.click(screen.getByRole('button', { name: /Personalizar/ }));

    expect(await screen.findByRole('button', { name: /Editar salas/ })).toBeInTheDocument();
  });

  it('con rol admin y puerto de catalogo, ofrece TAMBIEN "Catálogo de decoración"', async () => {
    const user = userEvent.setup();
    renderSidebar({ ...adminProps(), assets: fakeAssets() });

    await user.click(screen.getByRole('button', { name: /Personalizar/ }));

    expect(await screen.findByRole('region', { name: /Catálogo de decoración/ })).toBeInTheDocument();
  });

  it('con rol admin pero sin puerto de catalogo, no ofrece "Catálogo de decoración"', async () => {
    const user = userEvent.setup();
    renderSidebar(adminProps());

    await user.click(screen.getByRole('button', { name: /Personalizar/ }));

    await screen.findByRole('button', { name: /Editar escritorios/ });
    expect(screen.queryByRole('region', { name: /Catálogo/ })).not.toBeInTheDocument();
  });

  it('con rol admin, tambien ofrece "Mi espacio" junto al resto', async () => {
    const user = userEvent.setup();
    renderSidebar(adminProps());

    await user.click(screen.getByRole('button', { name: /Personalizar/ }));

    expect(screen.getByRole('heading', { name: 'Mi espacio' })).toBeInTheDocument();
  });

  it('activarlo y volver a activarlo lo colapsa', async () => {
    const user = userEvent.setup();
    renderSidebar({ role: 'employee' });
    const toggle = screen.getByRole('button', { name: /Personalizar/ });

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('heading', { name: 'Mi espacio' })).not.toBeInTheDocument();
  });

  it('forceCollapsed en true tambien lo colapsa aunque estuviese expandido', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<OfficeSidebar self={SELF} peers={[ANA]} role="employee" />);
    await user.click(screen.getByRole('button', { name: /Personalizar/ }));
    expect(screen.getByRole('button', { name: /Personalizar/ })).toHaveAttribute('aria-expanded', 'true');

    rerender(<OfficeSidebar self={SELF} peers={[ANA]} role="employee" forceCollapsed />);

    expect(screen.getByRole('button', { name: /Personalizar/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('la edicion de escritorios/salas ya NO vive bajo "Personas conectadas" (migrada a "Personalizar")', async () => {
    const user = userEvent.setup();
    renderSidebar(adminProps());

    await user.click(screen.getByRole('button', { name: /Personas/ }));

    expect(screen.queryByRole('button', { name: /Editar escritorios/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Editar salas/ })).not.toBeInTheDocument();
  });
});
