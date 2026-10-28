import { act, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import exportedManifest from '../../public/assets/pack/manifest.json?raw';
import { AdminError } from '../dashboard/adminPort';
import type { TerrainAdminPort } from '../dashboard/terrainAdminPort';
import { materialCatalogFrom } from '../game/artMaterials';
import type { ArtPreviewCache } from '../game/artPreview';
import { MAP_W } from '../game/mapData';
import { createOfficeBridge, type OfficeCommandMap } from '../game/officeBridge';
import { BASE_LAYOUT, withWalls } from '../game/officeLayout';
import type { OfficeDecorPort } from '../game/officeDecorPort';
import { DecorEditorSection } from './DecorEditorSection';

const catalog = materialCatalogFrom(JSON.parse(exportedManifest), 'assets/pack/manifest.json')!;
const noPreview: ArtPreviewCache = { sheet: vi.fn(async () => null) };
const at = (tx: number, ty: number): number => ty * MAP_W + tx;

function renderSection(overrides: Partial<Parameters<typeof DecorEditorSection>[0]> = {}) {
  const bridge = overrides.bridge ?? createOfficeBridge();
  const commands: OfficeCommandMap['decoredit'][] = [];
  bridge.onCommand('decoredit', (command) => commands.push(command));
  const terrainCommands: OfficeCommandMap['terrainedit'][] = [];
  bridge.onCommand('terrainedit', (command) => terrainCommands.push(command));
  const decor: OfficeDecorPort = overrides.decor ?? { setDecor: vi.fn(async () => undefined) };
  const props = { bridge, decor, scope: 'office' as const, area: null, loadMaterials: async () => catalog, preview: noPreview, ...overrides };
  return { ...props, commands, terrainCommands, ...render(<DecorEditorSection {...props} />) };
}

function terrainPort(overrides: Partial<TerrainAdminPort> = {}): TerrainAdminPort {
  return { setBlock: vi.fn(async () => undefined), setBlocks: vi.fn(async () => undefined), setWalls: vi.fn(async () => undefined), ...overrides };
}

describe('DecorEditorSection: Decoración (the whole office)', () => {
  it('offers only the way in while closed, and asks the other editors out before opening', async () => {
    const onRequestActive = vi.fn();
    const onEditingChange = vi.fn();
    renderSection({ onRequestActive, onEditingChange });
    expect(screen.queryByRole('group', { name: 'Sillas' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Decoración' }));
    expect(onRequestActive).toHaveBeenCalledTimes(1);
    expect(onEditingChange).toHaveBeenLastCalledWith(true);
    expect(await screen.findByRole('group', { name: 'Sillas' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Mesas de sala' })).toBeInTheDocument();
  });

  it('opens directly from the sidebar, places the picked piece on the clicked tile and says what it places', async () => {
    const decor: OfficeDecorPort = { setDecor: vi.fn(async () => undefined) };
    const { bridge, commands } = renderSection({ decor, initiallyActive: true });

    await userEvent.click(await screen.findByRole('button', { name: 'Silla gamer' }));
    expect(screen.getByText('Poniendo Silla gamer')).toBeInTheDocument();
    expect(commands.at(-1)).toMatchObject({ brush: { kind: 'piece', piece: 'chair-gamer', rotation: 0 }, area: null });

    act(() => bridge.emit('decorpick', { index: at(40, 40) }));
    await vi.waitFor(() => expect(decor.setDecor).toHaveBeenCalledWith([{ index: at(40, 40), item: { piece: 'chair-gamer', rotation: 0 } }]));
  });

  it('explains nothing between its header and «Múltiple», and offers no turn or eraser control of its own (#207, #208)', async () => {
    const { container } = renderSection({ initiallyActive: true });
    const multiple = await screen.findByRole('checkbox', { name: 'Múltiple: varios a la vez' });
    expect(multiple).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText(/rueda del mouse/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Elige una pieza/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Sin pieza elegida/)).not.toBeInTheDocument();
    expect(screen.queryByText(/muestra de color/)).not.toBeInTheDocument();
    expect(screen.queryByText('Termina con Escape.')).not.toBeInTheDocument();
    // The header's title is followed straight by the checkbox's row.
    const title = screen.getByRole('heading', { name: 'Decoración' });
    expect(title.parentElement?.nextElementSibling).toContainElement(multiple);
    expect(container.textContent).not.toMatch(/gírala/);
    expect(screen.queryByRole('button', { name: 'Girar' })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Mirando/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quitar' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Quitar/)).not.toBeInTheDocument();
  });

  it('with «Múltiple» off one click places one piece and the brush is put down; on, it stays picked (#207)', async () => {
    const decor: OfficeDecorPort = { setDecor: vi.fn(async () => undefined) };
    const { bridge, commands } = renderSection({ decor, initiallyActive: true });
    const multiple = await screen.findByRole('checkbox', { name: /^Múltiple/ });
    expect(multiple).not.toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: 'Silla gamer' }));
    act(() => bridge.emit('decorpick', { index: at(40, 40) }));
    expect(commands.at(-1)).toMatchObject({ brush: null });
    expect(screen.getByRole('button', { name: 'Silla gamer' })).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(multiple);
    await userEvent.click(screen.getByRole('button', { name: 'Silla gamer' }));
    act(() => bridge.emit('decorpick', { index: at(41, 40) }));
    act(() => bridge.emit('decorpick', { index: at(42, 40) }));
    expect(screen.getByRole('button', { name: 'Silla gamer' })).toHaveAttribute('aria-pressed', 'true');
    await vi.waitFor(() => expect(decor.setDecor).toHaveBeenCalledTimes(3));
  });

  it('turns a picked room table with the map, horizontal and vertical', async () => {
    const { bridge, commands } = renderSection({ initiallyActive: true });
    await userEvent.click(await screen.findByRole('button', { name: 'Mesa de reuniones' }));
    act(() => bridge.emit('decorrotate', { step: 1 }));
    expect(commands.at(-1)).toMatchObject({ brush: { piece: 'table-meeting', rotation: 90 } });
    act(() => bridge.emit('decorrotate', { step: 1 }));
    expect(commands.at(-1)).toMatchObject({ brush: { piece: 'table-meeting', rotation: 0 } });
  });

  it('places the painted desk in the color chosen on its tile', async () => {
    const decor: OfficeDecorPort = { setDecor: vi.fn(async () => undefined) };
    const { bridge, commands } = renderSection({ decor, initiallyActive: true });

    await userEvent.click(await screen.findByRole('button', { name: /^Color de Escritorio pintado/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Rojo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Escritorio pintado' }));
    expect(commands.at(-1)).toMatchObject({ brush: { piece: 'desk-painted', color: '#c0392b' } });

    act(() => bridge.emit('decorpick', { index: at(40, 40) }));
    await vi.waitFor(() => expect(decor.setDecor).toHaveBeenCalledWith([{ index: at(40, 40), item: { piece: 'desk-painted', rotation: 0, color: '#c0392b' } }]));
  });

  it('unpicks with «Deseleccionar», and shows why the server refused', async () => {
    const decor: OfficeDecorPort = {
      setDecor: vi.fn(async () => {
        throw new AdminError('terrain-under-placement');
      }),
    };
    const { bridge } = renderSection({ decor, initiallyActive: true });

    await userEvent.click(await screen.findByRole('button', { name: 'Ficus' }));
    act(() => bridge.emit('decorpick', { index: at(40, 40) }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/necesita suelo libre/);
    // One click, one edit: the brush is put down (no «Múltiple»).
    expect(screen.getByRole('button', { name: 'Ficus' })).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(screen.getByRole('button', { name: 'Ficus' }));
    await userEvent.click(screen.getByRole('button', { name: 'Deseleccionar' }));
    expect(screen.getByRole('button', { name: 'Ficus' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('leaves with «Salir», and on an Escape with nothing picked', async () => {
    const onExit = vi.fn();
    const { commands } = renderSection({ initiallyActive: true, onExit });
    await userEvent.click(await screen.findByRole('button', { name: 'Salir' }));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(commands.at(-1)).toBeNull();

    const second = renderSection({ initiallyActive: true, onExit });
    await screen.findAllByRole('button', { name: 'Salir' });
    await userEvent.keyboard('{Escape}');
    expect(onExit).toHaveBeenCalledTimes(2);
    expect(second.commands.at(-1)).toBeNull();
  });

  describe('walls (#224)', () => {
    it('offers the walls below the pieces, one entry pressed at a time across both, and says what it paints', async () => {
      const { commands, terrainCommands } = renderSection({ initiallyActive: true, terrain: terrainPort() });

      expect(await screen.findByRole('group', { name: 'Paredes' })).toBeInTheDocument();
      expect(screen.getByText(/paredes van sobre las líneas entre casillas/i)).toBeInTheDocument();
      expect(screen.getByText(/escritorios, muebles ni la entrada/i)).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Ficus' }));
      await userEvent.click(screen.getByRole('button', { name: 'Ladrillo' }));
      expect(screen.getByRole('button', { name: 'Ladrillo' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Ficus' })).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByText('Pintando paredes de Ladrillo')).toBeInTheDocument();
      expect(terrainCommands.at(-1)).toEqual({ brush: { kind: 'wall', piece: 'wall-brick' } });
      // The decor tool lets go of the map while a wall is picked: its clicks are the wall's.
      expect(commands.at(-1)).toBeNull();

      await userEvent.click(screen.getByRole('button', { name: 'Ficus' }));
      expect(screen.getByRole('button', { name: 'Ladrillo' })).toHaveAttribute('aria-pressed', 'false');
      expect(terrainCommands.at(-1)).toBeNull();
      expect(commands.at(-1)).toMatchObject({ brush: { kind: 'piece', piece: 'plant-ficus' } });
    });

    it('puts «Borrar» right below «Múltiple», out of the walls, and says only that while it is picked (#223)', async () => {
      const { terrainCommands } = renderSection({ initiallyActive: true, terrain: terrainPort() });
      const multiple = await screen.findByRole('checkbox', { name: 'Múltiple: varios a la vez' });
      const eraser = screen.getByRole('button', { name: 'Borrar' });

      // The row of «Múltiple» is followed straight by the eraser, before the pieces' palettes.
      expect(multiple.closest('label')?.parentElement?.nextElementSibling).toContainElement(eraser);
      expect(within(screen.getByRole('group', { name: 'Paredes' })).queryByRole('button', { name: 'Borrar' })).not.toBeInTheDocument();
      expect(eraser).toHaveTextContent(/^Borrar$/);
      expect(eraser).toHaveAttribute('title', 'Borrar');
      expect(document.body.textContent).not.toMatch(/Quitar pared|Quitando paredes|Goma/);

      await userEvent.click(screen.getByRole('button', { name: 'Ladrillo' }));
      await userEvent.click(eraser);
      expect(eraser).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'Ladrillo' })).toHaveAttribute('aria-pressed', 'false');
      expect(terrainCommands.at(-1)?.brush).toEqual({ kind: 'wall', piece: null });
      expect(screen.getByRole('button', { name: 'Deseleccionar' }).parentElement).toHaveTextContent(/^Borrar/);
      expect(document.body.textContent).not.toMatch(/Quitando|Quitar/);

      await userEvent.click(screen.getByRole('button', { name: 'Ficus' }));
      expect(eraser).toHaveAttribute('aria-pressed', 'false');
      expect(terrainCommands.at(-1)).toBeNull();
    });

    it('erases the clicked vertex when the eraser is picked, and the walls stay paintable (#223)', async () => {
      const setWalls = vi.fn(async () => undefined);
      const { bridge } = renderSection({ initiallyActive: true, terrain: terrainPort({ setWalls }) });
      act(() => bridge.emit('terrain', { blocks: BASE_LAYOUT.blocks, walls: withWalls(BASE_LAYOUT.walls, [{ index: 7, piece: 'wall-stone' }]), colors: new Map() }));

      await userEvent.click(await screen.findByRole('button', { name: 'Borrar' }));
      act(() => bridge.emit('wallpick', { index: 7 }));
      await vi.waitFor(() => expect(setWalls).toHaveBeenLastCalledWith([{ index: 7, piece: null }]));

      await userEvent.click(screen.getByRole('button', { name: 'Ladrillo' }));
      act(() => bridge.emit('wallpick', { index: 9 }));
      await vi.waitFor(() => expect(setWalls).toHaveBeenLastCalledWith([{ index: 9, piece: 'wall-brick' }]));
    });

    describe('on a door (#232, #233)', () => {
      // A wall along row 40, posts (39, 40)..(44, 40), and the doors on its line: a door spans 2 tiles, a double door 3.
      const WALL = withWalls(BASE_LAYOUT.walls, [39, 40, 41, 42, 43, 44].map((tx) => ({ index: at(tx, 40), piece: 'wall-brick' as const })));
      const LONE = [{ index: at(40, 40), piece: 'door-wood', rotation: 0 as const }];
      const DOUBLE = [{ index: at(40, 40), piece: 'door-wood-double', rotation: 0 as const }];
      const TWO = [...LONE, { index: at(42, 40), piece: 'door-wood', rotation: 0 as const }];

      function onWall(items: typeof TWO) {
        const setWalls = vi.fn(async () => undefined);
        const decor: OfficeDecorPort = { setDecor: vi.fn(async () => undefined) };
        const view = renderSection({ initiallyActive: true, decor, terrain: terrainPort({ setWalls }) });
        act(() => view.bridge.emit('terrain', { blocks: BASE_LAYOUT.blocks, walls: WALL, colors: new Map() }));
        act(() => view.bridge.emit('decor', { items }));
        return { ...view, setWalls };
      }

      it('takes a lone door off the post at either end and keeps the post, then erases the post once the room shows it gone', async () => {
        const { bridge, decor, setWalls } = onWall(LONE);
        await userEvent.click(await screen.findByRole('button', { name: 'Borrar' }));

        act(() => bridge.emit('wallpick', { index: at(42, 40) }));
        await vi.waitFor(() => expect(decor.setDecor).toHaveBeenCalledWith([{ index: at(40, 40), item: null }]));
        // The other end of the same door, before the room shows it gone: still the door's, never erased.
        act(() => bridge.emit('wallpick', { index: at(40, 40) }));
        expect(decor.setDecor).toHaveBeenCalledTimes(1);
        expect(setWalls).not.toHaveBeenCalled();

        act(() => bridge.emit('decor', { items: [] }));
        act(() => bridge.emit('wallpick', { index: at(42, 40) }));
        await vi.waitFor(() => expect(setWalls).toHaveBeenCalledWith([{ index: at(42, 40), piece: null }]));
      });

      it('takes a door off from the post in its middle, where the eraser lands when it is over the door', async () => {
        const { bridge, decor, setWalls } = onWall(LONE);
        await userEvent.click(await screen.findByRole('button', { name: 'Borrar' }));

        act(() => bridge.emit('wallpick', { index: at(41, 40) }));
        await vi.waitFor(() => expect(decor.setDecor).toHaveBeenCalledWith([{ index: at(40, 40), item: null }]));
        expect(setWalls).not.toHaveBeenCalled();
      });

      it('leaves the posts past the ends of a door to the eraser', async () => {
        const { bridge, decor, setWalls } = onWall(LONE);
        await userEvent.click(await screen.findByRole('button', { name: 'Borrar' }));

        act(() => bridge.emit('wallpick', { index: at(43, 40) }));
        await vi.waitFor(() => expect(setWalls).toHaveBeenCalledWith([{ index: at(43, 40), piece: null }]));
        expect(decor.setDecor).not.toHaveBeenCalled();
      });

      it('takes a double door off from the post at either end or in the middle of its three tiles', async () => {
        const { bridge, decor, setWalls } = onWall(DOUBLE);
        await userEvent.click(await screen.findByRole('button', { name: 'Borrar' }));

        act(() => bridge.emit('wallpick', { index: at(43, 40) }));
        await vi.waitFor(() => expect(decor.setDecor).toHaveBeenCalledWith([{ index: at(40, 40), item: null }]));
        expect(setWalls).not.toHaveBeenCalled();

        act(() => bridge.emit('decor', { items: DOUBLE }));
        act(() => bridge.emit('wallpick', { index: at(42, 40) }));
        await vi.waitFor(() => expect(decor.setDecor).toHaveBeenCalledTimes(2));
        expect(decor.setDecor).toHaveBeenLastCalledWith([{ index: at(40, 40), item: null }]);
        expect(setWalls).not.toHaveBeenCalled();
      });

      it('takes off only the doors that end on the post: both of a post they share, one of a post that is only its own', async () => {
        const { bridge, decor, setWalls } = onWall(TWO);
        await userEvent.click(await screen.findByRole('button', { name: 'Borrar' }));

        act(() => bridge.emit('wallpick', { index: at(44, 40) }));
        await vi.waitFor(() => expect(decor.setDecor).toHaveBeenCalledWith([{ index: at(42, 40), item: null }]));

        act(() => bridge.emit('decor', { items: TWO }));
        act(() => bridge.emit('wallpick', { index: at(42, 40) }));
        await vi.waitFor(() =>
          expect(decor.setDecor).toHaveBeenLastCalledWith([
            { index: at(40, 40), item: null },
            { index: at(42, 40), item: null },
          ]),
        );
        expect(setWalls).not.toHaveBeenCalled();
      });

      it('deletes a selected double door like any piece, as one item', async () => {
        const { bridge, decor } = onWall(DOUBLE);
        await screen.findByRole('group', { name: 'Sillas' });

        act(() => bridge.emit('decorselect', { index: at(40, 40) }));
        act(() => bridge.emit('decordelete', { index: at(40, 40) }));
        await vi.waitFor(() => expect(decor.setDecor).toHaveBeenCalledWith([{ index: at(40, 40), item: null }]));
      });
    });

    it('steps out on Escape: the picked wall first, then the editor', async () => {
      const onExit = vi.fn();
      const { commands, terrainCommands } = renderSection({ initiallyActive: true, terrain: terrainPort(), onExit });
      await userEvent.click(await screen.findByRole('button', { name: 'Borrar' }));
      expect(screen.getByRole('button', { name: 'Deseleccionar' }).parentElement).toHaveTextContent('Borrar');

      await userEvent.keyboard('{Escape}');
      expect(screen.getByRole('button', { name: 'Borrar' })).toHaveAttribute('aria-pressed', 'false');
      expect(terrainCommands.at(-1)).toBeNull();
      expect(commands.at(-1)).toMatchObject({ brush: null, area: null });
      expect(onExit).not.toHaveBeenCalled();

      await userEvent.keyboard('{Escape}');
      expect(onExit).toHaveBeenCalledTimes(1);
    });

    it('paints the clicked vertices with the picked wall, and says why the server refused one', async () => {
      const setWalls = vi.fn(async () => {
        throw new AdminError('terrain-under-placement');
      });
      const { bridge } = renderSection({ initiallyActive: true, terrain: terrainPort({ setWalls }) });
      await userEvent.click(await screen.findByRole('button', { name: 'Piedra' }));

      act(() => bridge.emit('wallpick', { index: 7 }));

      await vi.waitFor(() => expect(setWalls).toHaveBeenCalledWith([{ index: 7, piece: 'wall-stone' }]));
      expect(await screen.findByRole('alert')).toHaveTextContent(/Una pared no puede tapar un escritorio/);
    });

    it('offers no walls without the terrain port', async () => {
      renderSection({ initiallyActive: true });
      await screen.findByRole('group', { name: 'Sillas' });
      expect(screen.queryByRole('group', { name: 'Paredes' })).not.toBeInTheDocument();
    });
  });

  it('leaves when another editor takes the map', async () => {
    const { rerender, bridge, decor, commands } = renderSection({ initiallyActive: true });
    await screen.findByRole('group', { name: 'Sillas' });
    rerender(<DecorEditorSection bridge={bridge} decor={decor} scope="office" area={null} forceExit loadMaterials={async () => catalog} preview={noPreview} />);
    expect(commands.at(-1)).toBeNull();
    expect(screen.getByRole('button', { name: 'Decoración' })).toBeInTheDocument();
  });
});

/**
 * "Decoración" for whoever does not administer (#208): the same menu scoped
 * to the desk they claimed, through `POST /me/decor`, with no «Múltiple».
 */
describe('DecorEditorSection: Decoración for one desk', () => {
  const DESK = { x: 10, y: 10, w: 3, h: 3 };
  const DESK_OUTLINE = { x0: 10, y0: 10, x1: 12, y1: 12 };
  const NO_DESK_TEXT = 'Reclama un escritorio libre en el mapa para decorarlo.';

  it('is open at once over the desk under the same header, offers only what fits it and no «Múltiple»', async () => {
    const { commands } = renderSection({ scope: 'desk', area: DESK });
    expect(await screen.findByRole('group', { name: 'Sillas' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Decoración' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salir' })).toBeInTheDocument();
    // A desk holds desk tables, never a room table, not even the 2x1 oval one (#116).
    expect(screen.getByRole('group', { name: 'Mesas de escritorio' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Mesas de sala' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Múltiple/ })).not.toBeInTheDocument();
    expect(commands.at(-1)).toEqual({ brush: null, area: DESK, outlines: [DESK_OUTLINE] });
  });

  it('places one piece per click and unpicks the brush', async () => {
    const decor: OfficeDecorPort = { setDecor: vi.fn(async () => undefined) };
    const { bridge } = renderSection({ scope: 'desk', area: DESK, decor });
    await userEvent.click(await screen.findByRole('button', { name: 'Ficus' }));
    act(() => bridge.emit('decorpick', { index: at(11, 11) }));
    await vi.waitFor(() => expect(decor.setDecor).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/^Poniendo/)).not.toBeInTheDocument();
  });

  it('without a claimed desk asks to claim one, offers no pieces and leaves with «Salir» or Escape', async () => {
    const onExit = vi.fn();
    const { commands } = renderSection({ scope: 'desk', area: null, onExit });
    expect(screen.getByText(NO_DESK_TEXT)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Sillas' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dejar escritorio' })).not.toBeInTheDocument();
    expect(commands).toEqual([]);

    await userEvent.keyboard('{Escape}');
    expect(onExit).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Salir' }));
    expect(onExit).toHaveBeenCalledTimes(2);
  });

  it('with a claimed desk ends with «Dejar escritorio»', async () => {
    const onLeaveDesk = vi.fn();
    renderSection({ scope: 'desk', area: DESK, onLeaveDesk });
    await screen.findByRole('group', { name: 'Sillas' });

    const leave = screen.getByRole('button', { name: 'Dejar escritorio' });
    expect(screen.getAllByRole('button').at(-1)).toBe(leave);
    await userEvent.click(leave);
    expect(onLeaveDesk).toHaveBeenCalledTimes(1);
  });

  it('steps out on Escape like the admin menu: the brush, then the editor itself', async () => {
    const onExit = vi.fn();
    const { commands } = renderSection({ scope: 'desk', area: DESK, onExit });
    await userEvent.click(await screen.findByRole('button', { name: 'Ficus' }));

    await userEvent.keyboard('{Escape}');
    expect(commands.at(-1)).toMatchObject({ brush: null });
    expect(onExit).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(commands.at(-1)).toBeNull();
  });

  it('opens over a desk claimed meanwhile, and closes the map overlay once the desk is gone', async () => {
    const { rerender, bridge, decor, commands } = renderSection({ scope: 'desk', area: null });
    const props = { bridge, decor, scope: 'desk' as const, loadMaterials: async () => catalog, preview: noPreview };
    rerender(<DecorEditorSection {...props} area={DESK} />);
    expect(await screen.findByRole('group', { name: 'Sillas' })).toBeInTheDocument();
    expect(commands.at(-1)).toEqual({ brush: null, area: DESK, outlines: [DESK_OUTLINE] });

    rerender(<DecorEditorSection {...props} area={null} />);
    expect(commands.at(-1)).toBeNull();
    expect(screen.getByText(NO_DESK_TEXT)).toBeInTheDocument();
  });

  it('refuses a tile outside the desk without asking the server', async () => {
    const decor: OfficeDecorPort = { setDecor: vi.fn(async () => undefined) };
    const { bridge } = renderSection({ scope: 'desk', area: DESK, decor });
    await userEvent.click(await screen.findByRole('button', { name: 'Ficus' }));
    act(() => bridge.emit('decorpick', { index: at(20, 20) }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/dentro de tu escritorio/);
    expect(decor.setDecor).not.toHaveBeenCalled();
  });

  it('offers no walls: only an admin paints them (#224)', async () => {
    renderSection({ scope: 'desk', area: DESK, terrain: terrainPort() });
    await screen.findByRole('group', { name: 'Sillas' });
    expect(screen.queryByRole('group', { name: 'Paredes' })).not.toBeInTheDocument();
  });

  it('passes the desks to the map for the desk rules', async () => {
    const desks = [DESK, { x: 20, y: 10, w: 3, h: 3 }];
    const { commands } = renderSection({ scope: 'desk', area: DESK, desks });
    await screen.findByRole('group', { name: 'Sillas' });
    expect(commands.at(-1)).toEqual({ brush: null, area: DESK, desks, outlines: [DESK_OUTLINE] });
  });
});

describe('DecorEditorSection: space outlines (#216)', () => {
  const desks = [{ x: 2, y: 3, w: 4, h: 4 }, { x: 10, y: 3, w: 4, h: 4 }];
  const rooms = [{ x: 20, y: 5, w: 9, h: 9 }];

  it('asks the map to outline every desk and room for an admin', async () => {
    const { commands } = renderSection({ initiallyActive: true, desks, rooms });
    await screen.findByRole('group', { name: 'Sillas' });

    expect(commands.at(-1)?.outlines).toEqual([
      { x0: 2, y0: 3, x1: 5, y1: 6 },
      { x0: 10, y0: 3, x1: 13, y1: 6 },
      { x0: 20, y0: 5, x1: 28, y1: 13 },
    ]);
  });

  it('asks the map to outline only the own desk for whoever decorates one', async () => {
    const { commands } = renderSection({ scope: 'desk', area: desks[1]!, desks, rooms });
    await screen.findByRole('group', { name: 'Sillas' });

    expect(commands.at(-1)?.outlines).toEqual([{ x0: 10, y0: 3, x1: 13, y1: 6 }]);
  });

  it('does not change what can be placed: the area is the same with or without outlines', async () => {
    const { commands } = renderSection({ initiallyActive: true, desks, rooms });
    await screen.findByRole('group', { name: 'Sillas' });

    expect(commands.at(-1)).toMatchObject({ area: null, desks });
  });

  it('takes the outlines down when the editor closes', async () => {
    const { commands, rerender, ...props } = renderSection({ initiallyActive: true, desks, rooms });
    await screen.findByRole('group', { name: 'Sillas' });

    rerender(<DecorEditorSection bridge={props.bridge} decor={props.decor} scope="office" area={null} desks={desks} rooms={rooms} loadMaterials={async () => catalog} preview={noPreview} forceExit />);
    expect(commands.at(-1)).toBeNull();
  });
});
