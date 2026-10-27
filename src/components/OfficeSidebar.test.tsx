import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { CharacterPort } from '../auth/characterPort';
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
  await Promise.all([
    import('./OfficeLayoutEditor'),
    import('../dashboard/AssetsPanel'),
    import('./ArtContributionSection'),
    import('./MyCharacterSection'),
  ]);
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

describe('OfficeSidebar: calling from "Personas conectadas" (#187)', () => {
  it('each peer gets a "Llamar" button that calls onCallPeer with its session and name', async () => {
    const user = userEvent.setup();
    const onCallPeer = vi.fn();
    renderSidebar({ onCallPeer });
    await user.click(screen.getByRole('button', { name: /Personas/ }));

    await user.click(screen.getByRole('button', { name: 'Llamar a Beto' }));

    expect(onCallPeer).toHaveBeenCalledTimes(1);
    expect(onCallPeer).toHaveBeenCalledWith('b', 'Beto');
  });

  it('the button draws the green svg phone, not the red phone emoji', async () => {
    const user = userEvent.setup();
    renderSidebar({ onCallPeer: vi.fn() });
    await user.click(screen.getByRole('button', { name: /Personas/ }));

    const call = screen.getByRole('button', { name: 'Llamar a Ana' });
    expect(call.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(call.textContent).not.toContain('\u{1F4DE}');
  });

  it('there is no button to call oneself', async () => {
    const user = userEvent.setup();
    renderSidebar({ onCallPeer: vi.fn() });
    await user.click(screen.getByRole('button', { name: /Personas/ }));

    const selfItem = screen.getAllByRole('listitem')[0];
    expect(selfItem).toHaveTextContent('Hugo (tú)');
    expect(selfItem.querySelector('button')).toBeNull();
    expect(screen.getAllByRole('button', { name: /Llamar/ })).toHaveLength(2);
  });

  it('a peer in "No molestar" cannot be called, with the same title as the context menu', async () => {
    const user = userEvent.setup();
    const onCallPeer = vi.fn();
    renderSidebar({ peers: [ANA, { sessionId: 'c', name: 'Carla', status: 'r' }], onCallPeer });
    await user.click(screen.getByRole('button', { name: /Personas/ }));

    const call = screen.getByRole('button', { name: 'Llamar a Carla' });
    expect(call).toBeDisabled();
    expect(call).toHaveAttribute('title', 'No molestar: no se puede llamar ahora');
    expect(screen.getByRole('button', { name: 'Llamar a Ana' })).toBeEnabled();

    await user.click(call);
    expect(onCallPeer).not.toHaveBeenCalled();
  });

  it('without onCallPeer the list offers no calls', async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole('button', { name: /Personas/ }));

    expect(screen.queryByRole('button', { name: /Llamar/ })).not.toBeInTheDocument();
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

  it('without admin access, offers Decoración as a submenu without layout entries, and no "Mi espacio"', async () => {
    const user = userEvent.setup();
    renderSidebar({ role: 'employee', bridge: createOfficeBridge() });

    await user.click(screen.getByRole('button', { name: /Personalizar/ }));

    expect(screen.getByRole('button', { name: 'Decoración' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Decoración' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mi espacio' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Editar espacios/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Catálogo/ })).not.toBeInTheDocument();
  });

  it('with an unresolved role, still offers the personal submenu', async () => {
    const user = userEvent.setup();
    renderSidebar({ role: null, bridge: createOfficeBridge() });

    await user.click(screen.getByRole('button', { name: /Personalizar/ }));

    expect(screen.getByRole('button', { name: 'Decoración' })).toBeInTheDocument();
  });

  it('con rol admin, ofrece "Editar espacios" en lugar de escritorios y salas por separado', async () => {
    const user = userEvent.setup();
    renderSidebar(adminProps());

    await user.click(screen.getByRole('button', { name: /Personalizar/ }));

    expect(await screen.findByRole('button', { name: 'Editar espacios' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Editar escritorios/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Editar salas/ })).not.toBeInTheDocument();
  });

  it('con rol superadmin, ofrece "Editar espacios"', async () => {
    const user = userEvent.setup();
    renderSidebar({ ...adminProps(), role: 'superadmin' });

    await user.click(screen.getByRole('button', { name: /Personalizar/ }));

    expect(await screen.findByRole('button', { name: 'Editar espacios' })).toBeInTheDocument();
  });

  it('con rol admin y el resto de props, pero sin spaces, no ofrece edicion de layout (#74, PR4 addition)', async () => {
    const user = userEvent.setup();
    const { spaces: _spaces, ...rest } = adminProps();
    renderSidebar(rest);

    await user.click(screen.getByRole('button', { name: /Personalizar/ }));

    expect(screen.queryByRole('button', { name: /Editar espacios/ })).not.toBeInTheDocument();
  });

  it('"Editar espacios" opens on the room form, and the desks and the rooms are each one button away', async () => {
    const user = userEvent.setup();
    renderSidebar(adminProps());

    await user.click(screen.getByRole('button', { name: /Personalizar/ }));
    await user.click(await screen.findByRole('button', { name: 'Editar espacios' }));

    expect(await screen.findByRole('button', { name: 'Colocar nueva sala' })).toBeInTheDocument();
    const headings = screen.getAllByRole('heading').map((heading) => heading.textContent);
    expect(headings.indexOf('Escritorios')).toBeLessThan(headings.indexOf('Salas'));
    expect(screen.getByRole('button', { name: 'Editar salas' })).toBeInTheDocument();
    expect(screen.queryByText('Sala grande')).not.toBeInTheDocument();
    // Beside the submenu, at the level of "Salas".
    expect(screen.getByRole('button', { name: 'Crear escritorio' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Editar escritorios' }));

    expect(await screen.findByText('Mesa 4')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Crear escritorio' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Salas' })).not.toBeInTheDocument();
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

    await screen.findByRole('button', { name: 'Editar espacios' });
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

    await screen.findByRole('button', { name: 'Editar espacios' });
    expect(screen.queryByRole('region', { name: /Catálogo/ })).not.toBeInTheDocument();
  });

  it('con rol admin ya no ofrece "Mi espacio": Decoración es el unico menu de decoracion', async () => {
    const user = userEvent.setup();
    renderSidebar(adminProps());

    await user.click(screen.getByRole('button', { name: /Personalizar/ }));

    expect(screen.getByRole('button', { name: 'Decoración' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mi espacio' })).not.toBeInTheDocument();
  });

  it('activarlo y volver a activarlo lo colapsa', async () => {
    const user = userEvent.setup();
    renderSidebar({ role: 'employee', bridge: createOfficeBridge() });
    const toggle = screen.getByRole('button', { name: /Personalizar/ });

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Decoración' })).not.toBeInTheDocument();
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

    expect(screen.queryByRole('button', { name: /Editar espacios/ })).not.toBeInTheDocument();
  });

  it('opening either panel closes the other, and reopening starts at the root', async () => {
    renderSidebar(adminProps());
    const personalize = screen.getByRole('button', { name: /Personalizar/ });
    const people = screen.getByRole('button', { name: /Personas conectadas/ });
    await userEvent.click(people);
    await userEvent.click(personalize);
    expect(people).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Decoración' }));
    expect(screen.getByRole('heading', { name: 'Decoración' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar espacios' })).not.toBeInTheDocument();
    await userEvent.click(people);
    expect(personalize).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('heading', { name: 'Decoración' })).not.toBeInTheDocument();
    await userEvent.click(personalize);
    expect(screen.getByRole('button', { name: 'Decoración' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salir' })).not.toBeInTheDocument();
  });

  it('offers "Decoración" first to everyone: the whole map to admins, the own desk to the rest (#208)', async () => {
    const decor = { setDecor: vi.fn(async () => undefined) };
    const firstEntry = () => {
      const panel = screen.getByRole('region', { name: 'Personalizar' });
      return within(panel).getAllByRole('button').filter((button) => button.getAttribute('aria-label') !== 'Cerrar')[0];
    };
    const { unmount } = render(<OfficeSidebar self={SELF} peers={[ANA]} {...adminProps()} decor={decor} terrain={{ setBlock: vi.fn(), setBlocks: vi.fn(), setWalls: vi.fn() }} />);
    await userEvent.click(screen.getByRole('button', { name: /Personalizar/ }));
    expect(firstEntry()).toHaveTextContent('Decoración');
    await userEvent.click(firstEntry()!);
    expect(await screen.findByRole('checkbox', { name: /Múltiple/ })).toBeInTheDocument();
    unmount();

    renderSidebar({ ...adminProps(), role: 'employee', decor });
    await userEvent.click(screen.getByRole('button', { name: /Personalizar/ }));
    expect(firstEntry()).toHaveTextContent('Decoración');
    await userEvent.click(firstEntry()!);
    expect(screen.getByText('Reclama un escritorio libre en el mapa para decorarlo.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Múltiple/ })).not.toBeInTheDocument();
  });

  it.each([
    ['Decoración', 'decoredit'],
    ['Editar espacios', 'layoutedit'],
    ['Editar terreno', 'terrainedit'],
    ['Editar colisiones', 'collisionedit'],
  ] as const)('%s enters only its submenu and leaving clears the map mode', async (label, command) => {
    const props = adminProps();
    const onEditingChange = vi.fn();
    const commands: unknown[] = [];
    props.bridge.onCommand(command, (value) => commands.push(value));
    renderSidebar({ ...props, decor: { setDecor: vi.fn() }, terrain: { setBlock: vi.fn(), setBlocks: vi.fn(), setWalls: vi.fn() }, collisions: { saveRects: vi.fn(), reset: vi.fn() }, onLayoutEditingChange: onEditingChange });
    await userEvent.click(screen.getByRole('button', { name: /Personalizar/ }));
    await userEvent.click(screen.getByRole('button', { name: label }));
    const exit = await screen.findByRole('button', { name: 'Salir' });
    // The lazy editor resolves outside act: 'Salir' can commit before the passive effect reports editing.
    await waitFor(() => expect(onEditingChange).toHaveBeenLastCalledWith(true));
    await waitFor(() => expect(commands.at(-1)).toBeDefined());
    expect(commands.at(-1)).not.toBeNull();
    // Only its own submenu: no other menu entry (inside "Editar espacios" the rooms offer their own entry).
    for (const entry of ['Decoración', 'Editar espacios', 'Editar terreno', 'Editar colisiones'].filter((other) => other !== label)) {
      expect(screen.queryByRole('button', { name: entry })).not.toBeInTheDocument();
    }
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
    await userEvent.click(screen.getByRole('button', { name: 'Editar espacios' }));
    await waitFor(() => expect(commands.at(-1)).toMatchObject({ pickable: [{ id: 'id-sala' }] }));
    if (reason === 'people') await userEvent.click(screen.getByRole('button', { name: /Personas conectadas/ }));
    if (reason === 'toggle') await userEvent.click(screen.getByRole('button', { name: /Personalizar/ }));
    if (reason === 'forceCollapsed') rerender(<OfficeSidebar {...props} forceCollapsed />);
    if (reason === 'capability') rerender(<OfficeSidebar {...props} role="employee" />);
    expect(props.onLayoutEditingChange).toHaveBeenLastCalledWith(false);
    expect(commands.at(-1)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Salir' })).not.toBeInTheDocument();
    if (reason === 'capability') {
      expect(screen.getByRole('button', { name: 'Decoración' })).toBeInTheDocument();
      rerender(<OfficeSidebar {...props} />);
      expect(screen.queryByText('Mesa 4')).not.toBeInTheDocument();
    }
    if (reason === 'forceCollapsed') {
      expect(screen.getByRole('button', { name: /Personalizar/ })).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByRole('button', { name: /Personas conectadas/ })).toHaveAttribute('aria-expanded', 'false');
    }
  });

  it('"Decoración" without admin access decorates the claimed desk on the map and ends with «Dejar escritorio» (#208)', async () => {
    const props = adminProps();
    const commands: unknown[] = [];
    props.bridge.onCommand('decoredit', (value) => commands.push(value));
    const onLeaveDesk = vi.fn();
    const onLayoutEditingChange = vi.fn();
    const area = { x: 10, y: 12, w: 3, h: 3 };
    const deskAreas = [area, { x: 20, y: 12, w: 3, h: 3 }];
    renderSidebar({ ...props, role: 'employee', mySpace: { area, decor: { setDecor: vi.fn() }, onLeaveDesk }, deskAreas, onLayoutEditingChange });
    await userEvent.click(screen.getByRole('button', { name: /Personalizar/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Decoración' }));

    expect(commands.at(-1)).toEqual({ brush: null, area, desks: deskAreas, outlines: [{ x0: 10, y0: 12, x1: 12, y1: 14 }] });
    // Desk clicks stay claims and releases: this editor does not hold the desks.
    expect(onLayoutEditingChange).not.toHaveBeenCalledWith(true);
    await userEvent.click(screen.getByRole('button', { name: 'Dejar escritorio' }));
    expect(onLeaveDesk).toHaveBeenCalledTimes(1);
    // Back to the menu: the desk editor lets go of the map.
    await userEvent.click(screen.getByRole('button', { name: 'Salir' }));
    expect(commands.at(-1)).toBeNull();
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
    expect(screen.getByRole('button', { name: 'Decoración' })).toBeInTheDocument();
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
    await userEvent.click(screen.getByRole('button', { name: 'Editar espacios' }));
    await waitFor(() => expect(commands.at(-1)).toMatchObject({ pickable: [{ id: 'id-sala' }] }));
    rerender(<OfficeSidebar {...props} forceExitLayoutEditing />);
    expect(props.onLayoutEditingChange).toHaveBeenLastCalledWith(false);
    expect(commands.at(-1)).toBeNull();
    expect(screen.getByRole('button', { name: 'Decoración' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Decoración' }));
    expect(screen.getByRole('button', { name: 'Salir' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Salir' }));
    await userEvent.click(screen.getByRole('button', { name: 'Editar espacios' }));
    await waitFor(() => expect(commands.at(-1)).toMatchObject({ pickable: [{ id: 'id-sala' }] }));
    expect(props.onLayoutEditingChange).toHaveBeenLastCalledWith(true);
  });

  it('losing the collision port closes the editor and drops the submenu', async () => {
    const props = { self: SELF, peers: [], ...adminProps(), collisions: { saveRects: vi.fn(), reset: vi.fn() }, onLayoutEditingChange: vi.fn() };
    const edit = vi.fn();
    props.bridge.onCommand('collisionedit', edit);
    const { rerender } = render(<OfficeSidebar {...props} />);
    await userEvent.click(screen.getByRole('button', { name: /Personalizar/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Editar colisiones' }));
    await screen.findByText(/Toca un objeto en el mapa/);
    expect(edit).toHaveBeenLastCalledWith(expect.objectContaining({ pieceId: null }));
    rerender(<OfficeSidebar {...props} collisions={null} />);
    expect(edit).toHaveBeenLastCalledWith(null);
    expect(props.onLayoutEditingChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole('button', { name: 'Decoración' })).toBeInTheDocument();
    rerender(<OfficeSidebar {...props} />);
    expect(screen.getByRole('button', { name: 'Editar colisiones' })).toBeInTheDocument();
    expect(screen.queryByText(/Toca un objeto en el mapa/)).not.toBeInTheDocument();
  });

  it('steps out of "Editar espacios" one Escape at a time: the desk list, the default view, the menu, then the panel', async () => {
    const user = userEvent.setup();
    const onLayoutEditingChange = vi.fn();
    renderSidebar({ ...adminProps(), onLayoutEditingChange });
    const toggle = screen.getByRole('button', { name: /Personalizar/ });
    await user.click(toggle);
    await user.click(screen.getByRole('button', { name: 'Editar espacios' }));
    await user.click(await screen.findByRole('button', { name: 'Editar escritorios' }));
    await screen.findByText('Mesa 4');

    await user.keyboard('{Escape}');
    expect(await screen.findByRole('button', { name: 'Colocar nueva sala' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar escritorios' })).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard('{Escape}');
    expect(await screen.findByRole('button', { name: 'Editar espacios' })).toBeInTheDocument();
    expect(onLayoutEditingChange).toHaveBeenLastCalledWith(false);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard('{Escape}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('steps out of the room list the same way: the list, the default view, the menu, then the panel', async () => {
    const user = userEvent.setup();
    renderSidebar(adminProps());
    const toggle = screen.getByRole('button', { name: /Personalizar/ });
    await user.click(toggle);
    await user.click(screen.getByRole('button', { name: 'Editar espacios' }));
    await user.click(await screen.findByRole('button', { name: 'Editar salas' }));
    await screen.findByText('Sala grande');

    await user.keyboard('{Escape}');
    expect(screen.queryByText('Sala grande')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar escritorios' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar salas' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(await screen.findByRole('button', { name: 'Editar espacios' })).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard('{Escape}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('"Crear escritorio" then Escape cancels the placement and lands on the default view in one press', async () => {
    const user = userEvent.setup();
    renderSidebar(adminProps());
    const toggle = screen.getByRole('button', { name: /Personalizar/ });
    await user.click(toggle);
    await user.click(screen.getByRole('button', { name: 'Editar espacios' }));
    await user.click(await screen.findByRole('button', { name: 'Crear escritorio' }));
    expect(screen.getByText(/Toca el nuevo sitio/)).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(await screen.findByRole('button', { name: 'Colocar nueva sala' })).toBeInTheDocument();
    expect(screen.queryByText(/Toca el nuevo sitio/)).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('steps out of the collision editor one Escape at a time: the piece, the editor, then the panel', async () => {
    const user = userEvent.setup();
    const props = { ...adminProps(), collisions: { saveRects: vi.fn(), reset: vi.fn() }, onLayoutEditingChange: vi.fn() };
    renderSidebar(props);
    const toggle = screen.getByRole('button', { name: /Personalizar/ });
    await user.click(toggle);
    await user.click(screen.getByRole('button', { name: 'Editar colisiones' }));
    await screen.findByText(/Toca un objeto en el mapa/);
    act(() => props.bridge.emit('collisionpick', { pieceId: 'tree-oak', rotation: 0, rects: [], saved: false, defaults: [] }));
    expect(screen.getByText('tree-oak · por defecto')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.getByText(/Toca un objeto en el mapa/)).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(await screen.findByRole('button', { name: 'Editar colisiones' })).toBeInTheDocument();
    expect(props.onLayoutEditingChange).toHaveBeenLastCalledWith(false);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard('{Escape}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
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

describe('OfficeSidebar: my character', () => {
  function fakeCharacter(): CharacterPort {
    return {
      read: vi.fn(async () => ({ outcome: 'ok' as const, avatarId: 'character-p01-burgundy-suit', chosen: true })),
      save: vi.fn(async () => ({ outcome: 'ok' as const, avatarId: 'character-p01-burgundy-suit' })),
      catalog: vi.fn(async () => ({
        defaultId: 'character-p01-burgundy-suit',
        options: [{ id: 'character-p01-burgundy-suit', name: 'Mateo', walkUrl: 'w.png', seatedUrl: 's.png' }],
      })),
    };
  }

  it('anyone signed in opens the creator from "Mi personaje" and cancelling goes back to the menu', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const user = userEvent.setup();
    renderSidebar({ role: 'employee', character: fakeCharacter() });

    await user.click(screen.getByRole('button', { name: /Personalizar/ }));
    await user.click(screen.getByRole('button', { name: 'Mi personaje' }));
    const dialog = await screen.findByRole('dialog', { name: 'Mi personaje' });

    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mi personaje' })).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('a request from the desk banner opens "Mi personaje" directly, and a new one opens it again', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const user = userEvent.setup();
    const props = { self: SELF, peers: [ANA, BETO], role: 'employee' as const, character: fakeCharacter() };
    const { rerender } = render(<OfficeSidebar {...props} openRequest={{ section: 'character', seq: 1 }} />);

    expect(screen.getByRole('button', { name: /Personalizar/ })).toHaveAttribute('aria-expanded', 'true');
    await user.click(within(await screen.findByRole('dialog', { name: 'Mi personaje' })).getByRole('button', { name: 'Cancelar' }));
    await user.click(screen.getByRole('button', { name: 'Cerrar' }));

    rerender(<OfficeSidebar {...props} openRequest={{ section: 'character', seq: 2 }} />);

    expect(await screen.findByRole('dialog', { name: 'Mi personaje' })).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('without a character port (no server, or no session) there is no "Mi personaje"', async () => {
    const user = userEvent.setup();
    renderSidebar({ role: 'employee' });

    await user.click(screen.getByRole('button', { name: /Personalizar/ }));

    expect(screen.queryByRole('button', { name: 'Mi personaje' })).not.toBeInTheDocument();
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

  it('steps out of "Decoración" without a desk like the admin one: the menu first, then the panel', async () => {
    const user = userEvent.setup();
    renderSidebar({ role: 'employee', bridge: createOfficeBridge() });
    const toggle = screen.getByRole('button', { name: /Personalizar/ });
    await user.click(toggle);
    await user.click(screen.getByRole('button', { name: 'Decoración' }));

    await user.keyboard('{Escape}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Decoración' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Decoración' })).not.toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
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
    await user.click(screen.getByRole('button', { name: 'Editar espacios' }));

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
