import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ArtContributionPort } from '../dashboard/artContributionPort';
import type { AssetAdminPort } from '../dashboard/assetAdminPort';
import type { AdminDesk, DeskAdminPort } from '../dashboard/deskAdminPort';
import type { AdminSpace, SpacesAdminPort } from '../dashboard/spacesAdminPort';
import { SIDEBAR_TOP } from '../game/hudLayout';
import { createOfficeBridge } from '../game/officeBridge';
import { statusCssColor } from '../game/presence';
import type { RosterPeer } from '../game/roster';
import { OfficeSidebar } from './OfficeSidebar';

// The sidebar's lazy sections transform cold in the first test that opens one; on a loaded CI
// runner that outlasted findBy's 1 s deadline. Warm them once so tests only wait on React.
beforeAll(async () => {
  await Promise.all([import('./OfficeLayoutEditor'), import('../dashboard/AssetsPanel'), import('./ArtContributionSection')]);
});

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

  it('without admin access, offers Mi espacio as a submenu without layout entries', async () => {
    const user = userEvent.setup();
    renderSidebar({ role: 'employee' });

    await user.click(screen.getByRole('button', { name: /Personalizar/ }));

    expect(screen.getByRole('button', { name: 'Mi espacio' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Mi espacio' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Editar escritorios/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Editar salas/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Catálogo/ })).not.toBeInTheDocument();
  });

  it('with an unresolved role, still offers the personal submenu', async () => {
    const user = userEvent.setup();
    renderSidebar({ role: null });

    await user.click(screen.getByRole('button', { name: /Personalizar/ }));

    expect(screen.getByRole('button', { name: 'Mi espacio' })).toBeInTheDocument();
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

  it('con rol admin y puerto de terreno, ofrece TAMBIEN la edicion del terreno (#123 phase 2)', async () => {
    const user = userEvent.setup();
    renderSidebar({ ...adminProps(), terrain: { setBlock: vi.fn(async () => undefined), setBlocks: vi.fn(), setWalls: vi.fn() } });

    await user.click(screen.getByRole('button', { name: /Personalizar/ }));

    expect(await screen.findByRole('button', { name: 'Editar terreno' })).toBeInTheDocument();
  });

  it('con rol admin y puerto de colisiones, ofrece TAMBIEN la edicion de colisiones', async () => {
    const user = userEvent.setup();
    renderSidebar({ ...adminProps(), collisions: { saveRects: vi.fn(async () => undefined), reset: vi.fn(async () => undefined) } });

    await user.click(screen.getByRole('button', { name: /Personalizar/ }));

    expect(await screen.findByRole('button', { name: 'Editar colisiones' })).toBeInTheDocument();
  });

  it('con rol admin pero sin puerto de terreno, no ofrece la edicion del terreno', async () => {
    const user = userEvent.setup();
    renderSidebar(adminProps());

    await user.click(screen.getByRole('button', { name: /Personalizar/ }));

    await screen.findByRole('button', { name: /Editar escritorios/ });
    expect(screen.queryByRole('button', { name: 'Editar terreno' })).not.toBeInTheDocument();
  });

  it('con rol admin y puerto de catalogo, ofrece TAMBIEN "Catálogo de decoración"', async () => {
    const user = userEvent.setup();
    renderSidebar({ ...adminProps(), assets: fakeAssets() });

    await user.click(screen.getByRole('button', { name: /Personalizar/ }));

    await user.click(screen.getByRole('button', { name: 'Catálogo de decoración' }));
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

    expect(screen.getByRole('button', { name: 'Mi espacio' })).toBeInTheDocument();
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

  it('opening either panel closes the other, and reopening starts at the root', async () => {
    renderSidebar(adminProps());
    const personalize = screen.getByRole('button', { name: /Personalizar/ });
    const people = screen.getByRole('button', { name: /Personas conectadas/ });
    await userEvent.click(people);
    await userEvent.click(personalize);
    expect(people).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mi espacio' }));
    expect(screen.getByRole('heading', { name: 'Mi espacio' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar salas' })).not.toBeInTheDocument();
    await userEvent.click(people);
    expect(personalize).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('heading', { name: 'Mi espacio' })).not.toBeInTheDocument();
    await userEvent.click(personalize);
    expect(screen.getByRole('button', { name: 'Mi espacio' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salir' })).not.toBeInTheDocument();
  });

  it.each([
    ['Editar escritorios', 'layoutedit'],
    ['Editar salas', 'layoutedit'],
    ['Editar terreno', 'terrainedit'],
    ['Editar colisiones', 'collisionedit'],
  ] as const)('%s enters only its submenu and leaving clears the map mode', async (label, command) => {
    const props = adminProps();
    const onEditingChange = vi.fn();
    const commands: unknown[] = [];
    props.bridge.onCommand(command, (value) => commands.push(value));
    renderSidebar({ ...props, terrain: { setBlock: vi.fn(), setBlocks: vi.fn(), setWalls: vi.fn() }, collisions: { saveRects: vi.fn(), reset: vi.fn() }, onLayoutEditingChange: onEditingChange });
    await userEvent.click(screen.getByRole('button', { name: /Personalizar/ }));
    await userEvent.click(screen.getByRole('button', { name: label }));
    const exit = await screen.findByRole('button', { name: 'Salir' });
    // The lazy editor resolves outside act: 'Salir' can commit before the passive effect reports editing.
    await waitFor(() => expect(onEditingChange).toHaveBeenLastCalledWith(true));
    await waitFor(() => expect(commands.at(-1)).toBeDefined());
    expect(commands.at(-1)).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Mi espacio' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Editar/ })).not.toBeInTheDocument();
    await userEvent.click(exit);
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
    expect(commands.at(-1)).toBeNull();
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salir' })).not.toBeInTheDocument();
  });

  it.each(['people', 'toggle', 'forceCollapsed', 'capability'] as const)('leaving an editing submenu through %s closes editing', async (reason) => {
    const props = { self: SELF, peers: [ANA], ...adminProps(), onLayoutEditingChange: vi.fn() };
    const commands: unknown[] = [];
    props.bridge.onCommand('layoutedit', (value) => commands.push(value));
    const { rerender } = render(<OfficeSidebar {...props} />);
    await userEvent.click(screen.getByRole('button', { name: /Personalizar/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Editar escritorios' }));
    await screen.findByText('Mesa 4');
    if (reason === 'people') await userEvent.click(screen.getByRole('button', { name: /Personas conectadas/ }));
    if (reason === 'toggle') await userEvent.click(screen.getByRole('button', { name: /Personalizar/ }));
    if (reason === 'forceCollapsed') rerender(<OfficeSidebar {...props} forceCollapsed />);
    if (reason === 'capability') rerender(<OfficeSidebar {...props} role="employee" />);
    expect(props.onLayoutEditingChange).toHaveBeenLastCalledWith(false);
    expect(commands.at(-1)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Salir' })).not.toBeInTheDocument();
    if (reason === 'capability') {
      expect(screen.getByRole('button', { name: 'Mi espacio' })).toBeInTheDocument();
      rerender(<OfficeSidebar {...props} />);
      expect(screen.queryByText('Mesa 4')).not.toBeInTheDocument();
    }
    if (reason === 'forceCollapsed') {
      expect(screen.getByRole('button', { name: /Personalizar/ })).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByRole('button', { name: /Personas conectadas/ })).toHaveAttribute('aria-expanded', 'false');
    }
  });

  it('does not offer admin capabilities to guests even when all ports exist', async () => {
    renderSidebar({ ...adminProps(), role: 'guest', assets: fakeAssets(), terrain: { setBlock: vi.fn(), setBlocks: vi.fn(), setWalls: vi.fn() }, collisions: { saveRects: vi.fn(), reset: vi.fn() } });
    await userEvent.click(screen.getByRole('button', { name: /Personalizar/ }));
    expect(screen.queryByRole('button', { name: /Editar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Catálogo de decoración' })).not.toBeInTheDocument();
  });

  it('a missing optional port returns to the root without restoring a stale submenu later', async () => {
    const props = { self: SELF, peers: [], ...adminProps(), assets: fakeAssets() };
    const { rerender } = render(<OfficeSidebar {...props} />);
    await userEvent.click(screen.getByRole('button', { name: /Personalizar/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Catálogo de decoración' }));
    await screen.findByRole('region', { name: 'Catálogo de decoración' });
    rerender(<OfficeSidebar {...props} assets={null} />);
    expect(screen.getByRole('button', { name: 'Mi espacio' })).toBeInTheDocument();
    rerender(<OfficeSidebar {...props} />);
    expect(screen.getByRole('button', { name: 'Catálogo de decoración' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Catálogo de decoración' })).not.toBeInTheDocument();
  });

  it('an external forceExit leaves the editing submenu at the root, which remains navigable', async () => {
    const props = { self: SELF, peers: [], ...adminProps(), onLayoutEditingChange: vi.fn() };
    const commands: unknown[] = [];
    props.bridge.onCommand('layoutedit', (value) => commands.push(value));
    const { rerender } = render(<OfficeSidebar {...props} />);
    await userEvent.click(screen.getByRole('button', { name: /Personalizar/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Editar salas' }));
    await screen.findByText('Sala grande');
    rerender(<OfficeSidebar {...props} forceExitLayoutEditing />);
    expect(props.onLayoutEditingChange).toHaveBeenLastCalledWith(false);
    expect(commands.at(-1)).toBeNull();
    expect(screen.getByRole('button', { name: 'Mi espacio' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mi espacio' }));
    expect(screen.getByRole('button', { name: 'Salir' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Salir' }));
    await userEvent.click(screen.getByRole('button', { name: 'Editar salas' }));
    await screen.findByText('Sala grande');
    expect(props.onLayoutEditingChange).toHaveBeenLastCalledWith(true);
  });

  it('losing the collision port also clears debug outlines and drops the submenu', async () => {
    const props = { self: SELF, peers: [], ...adminProps(), collisions: { saveRects: vi.fn(), reset: vi.fn() }, onLayoutEditingChange: vi.fn() };
    const debug = vi.fn();
    const edit = vi.fn();
    props.bridge.onCommand('collisiondebug', debug);
    props.bridge.onCommand('collisionedit', edit);
    const { rerender } = render(<OfficeSidebar {...props} />);
    await userEvent.click(screen.getByRole('button', { name: /Personalizar/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Editar colisiones' }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Mostrar colisiones' }));
    expect(debug).toHaveBeenLastCalledWith({ show: true });
    rerender(<OfficeSidebar {...props} collisions={null} />);
    expect(debug).toHaveBeenLastCalledWith({ show: false });
    expect(edit).toHaveBeenLastCalledWith(null);
    expect(props.onLayoutEditingChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole('button', { name: 'Mi espacio' })).toBeInTheDocument();
    rerender(<OfficeSidebar {...props} />);
    expect(screen.getByRole('button', { name: 'Editar colisiones' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Mostrar colisiones' })).not.toBeInTheDocument();
  });
});

describe('OfficeSidebar: contributing art (#122)', () => {
  function fakeContributions(): ArtContributionPort {
    return {
      submit: vi.fn(),
      listMine: vi.fn(async () => ({ contributions: [], usage: { pending: 0, lastHour: 0, maxPending: 5, maxPerHour: 10 } })),
      fileDataUrl: vi.fn(),
    };
  }

  it('anyone signed in can contribute from "Personalizar", with no admin role', async () => {
    const user = userEvent.setup();
    renderSidebar({ role: 'employee', contributions: fakeContributions() });

    await user.click(screen.getByRole('button', { name: /Personalizar/ }));

    await user.click(screen.getByRole('button', { name: 'Aportar arte' }));
    expect(await screen.findByRole('heading', { name: 'Aportar arte' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Salir' }));
    expect(screen.getByRole('button', { name: 'Aportar arte' })).toBeInTheDocument();
  });

  it('without a contributions port (no server, or no session) there is nothing to contribute to', async () => {
    const user = userEvent.setup();
    renderSidebar({ role: 'employee' });

    await user.click(screen.getByRole('button', { name: /Personalizar/ }));

    expect(screen.queryByRole('heading', { name: 'Aportar arte' })).not.toBeInTheDocument();
  });
});

describe('OfficeSidebar: Escape closes the open panel', () => {
  it('closes "Personas conectadas" and gives focus back to its toggle, even while typing in the search', async () => {
    const user = userEvent.setup();
    renderSidebar();
    const toggle = screen.getByRole('button', { name: /Personas/ });
    await user.click(toggle);
    await user.click(screen.getByRole('searchbox'));

    await user.keyboard('{Escape}');

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();
  });

  it('closes the "Personalizar" menu', async () => {
    const user = userEvent.setup();
    renderSidebar({ role: 'employee' });
    const toggle = screen.getByRole('button', { name: /Personalizar/ });
    await user.click(toggle);

    await user.keyboard('{Escape}');

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Personalizar' })).not.toBeInTheDocument();
  });

  it('closes "Personalizar" from a section too, and opens again on its menu', async () => {
    const user = userEvent.setup();
    renderSidebar({ role: 'employee' });
    const toggle = screen.getByRole('button', { name: /Personalizar/ });
    await user.click(toggle);
    await user.click(screen.getByRole('button', { name: 'Mi espacio' }));

    await user.keyboard('{Escape}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Mi espacio' })).toBeInTheDocument();
  });

  it('leaves a map editor open: there Escape belongs to the editor (a picked brush, a draft)', async () => {
    const user = userEvent.setup();
    const desks: DeskAdminPort = {
      listDesks: vi.fn(async () => []),
      createDesk: vi.fn(),
      updateDesk: vi.fn(),
      deleteDesk: vi.fn(),
    } as unknown as DeskAdminPort;
    const spaces = { listSpaces: vi.fn(async () => []) } as unknown as SpacesAdminPort;
    renderSidebar({
      role: 'admin',
      bridge: createOfficeBridge(),
      desks,
      spaces,
      refreshDesks: vi.fn(),
      refreshSpaces: vi.fn(),
    });
    const toggle = screen.getByRole('button', { name: /Personalizar/ });
    await user.click(toggle);
    await user.click(screen.getByRole('button', { name: 'Editar escritorios' }));

    await user.keyboard('{Escape}');

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('steps out of the terrain editor one Escape at a time: brush, editor, then the panel', async () => {
    const user = userEvent.setup();
    const desks = { listDesks: vi.fn(async () => []) } as unknown as DeskAdminPort;
    const spaces = { listSpaces: vi.fn(async () => []) } as unknown as SpacesAdminPort;
    const onLayoutEditingChange = vi.fn();
    renderSidebar({
      role: 'admin',
      bridge: createOfficeBridge(),
      desks,
      spaces,
      refreshDesks: vi.fn(),
      refreshSpaces: vi.fn(),
      terrain: { setBlock: vi.fn(), setBlocks: vi.fn(), setWalls: vi.fn() },
      onLayoutEditingChange,
    });
    const toggle = screen.getByRole('button', { name: /Personalizar/ });
    await user.click(toggle);
    await user.click(screen.getByRole('button', { name: 'Editar terreno' }));
    await user.click(await screen.findByRole('button', { name: 'Césped' }));

    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Césped' })).toHaveAttribute('aria-pressed', 'false');

    await user.keyboard('{Escape}');
    expect(await screen.findByRole('button', { name: 'Editar terreno' })).toBeInTheDocument();
    expect(onLayoutEditingChange).toHaveBeenLastCalledWith(false);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard('{Escape}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('ignores an Escape another control already handled', async () => {
    const user = userEvent.setup();
    renderSidebar();
    const toggle = screen.getByRole('button', { name: /Personas/ });
    await user.click(toggle);
    const handled = (event: KeyboardEvent) => event.preventDefault();
    window.addEventListener('keydown', handled, { capture: true });

    try {
      await user.keyboard('{Escape}');
    } finally {
      window.removeEventListener('keydown', handled, { capture: true });
    }

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });
});
