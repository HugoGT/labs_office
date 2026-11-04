import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import exportedManifest from '../../public/assets/pack/manifest.json?raw';
import { AdminError } from '../dashboard/adminPort';
import type { TerrainAdminPort } from '../dashboard/terrainAdminPort';
import { materialCatalogFrom } from '../game/artMaterials';
import type { ArtPreviewCache } from '../game/artPreview';
import { MAP_W, SPAWN_BLOCK_INDEX } from '../game/mapData';
import { createOfficeBridge, type OfficeCommandMap } from '../game/officeBridge';
import { BASE_LAYOUT, withBlock, withWalls } from '../game/officeLayout';
import type { OfficeDecorPort } from '../game/officeDecorPort';
import { TerrainEditorSection } from './TerrainEditorSection';

const LAWN = 35;
const catalog = materialCatalogFrom(JSON.parse(exportedManifest), 'assets/pack/manifest.json')!;
const noPreview: ArtPreviewCache = { sheet: vi.fn(async () => null) };
const at = (tx: number, ty: number): number => ty * MAP_W + tx;

function renderSection(overrides: Partial<Parameters<typeof TerrainEditorSection>[0]> = {}) {
  const bridge = overrides.bridge ?? createOfficeBridge();
  const commands: OfficeCommandMap['terrainedit'][] = [];
  bridge.onCommand('terrainedit', (command) => commands.push(command));
  const terrain: TerrainAdminPort = overrides.terrain ?? { setBlock: vi.fn(async () => undefined), setBlocks: vi.fn(async () => undefined), setWalls: vi.fn(async () => undefined) };
  const props = { bridge, terrain, loadMaterials: async () => catalog, preview: noPreview, ...overrides };
  return { ...props, commands, ...render(<TerrainEditorSection {...props} />) };
}

async function open() {
  await userEvent.click(screen.getByRole('button', { name: 'Editar terreno' }));
}

describe('TerrainEditorSection: carpet picker', () => {
  it('a click on carpet keeps the rail while its picker is open and follows the color live; one Escape closes the picker keeping the color, a second puts the floor down', async () => {
    Object.defineProperty(HTMLInputElement.prototype, 'showPicker', { configurable: true, value: vi.fn() });
    try {
      const { commands } = renderSection();
      await open();

      await userEvent.click(await screen.findByRole('button', { name: 'Moqueta' }));
      expect(commands.at(-1)).toMatchObject({ brush: { kind: 'floor', material: 'carpet', color: '#5a6f86' }, pickingColor: true });

      fireEvent.input(screen.getByLabelText(/^Color de Moqueta:/), { target: { value: '#c0392b' } });
      await vi.waitFor(() => expect(commands.at(-1)).toMatchObject({ brush: { material: 'carpet', color: '#c0392b' }, pickingColor: true }));

      // The first Escape is the browser's picker's: it closes and sends back the color it opened with, which is not kept.
      fireEvent.input(screen.getByLabelText(/^Color de Moqueta:/), { target: { value: '#5a6f86' } });
      await vi.waitFor(() => expect(commands.at(-1)).not.toHaveProperty('pickingColor'));
      expect(commands.at(-1)).toMatchObject({ brush: { material: 'carpet', color: '#c0392b' } });
      expect(screen.getByLabelText('Color de Moqueta: #c0392b')).toHaveValue('#c0392b');

      // The second one reaches the page and puts the floor down, like any Escape does.
      fireEvent.keyDown(document.body, { key: 'Escape' });
      await vi.waitFor(() => expect(commands.at(-1)?.brush).toBeNull());
      expect(screen.getByLabelText('Color de Moqueta: #c0392b')).toHaveValue('#c0392b');
    } finally {
      Reflect.deleteProperty(HTMLInputElement.prototype, 'showPicker');
    }
  });
});

describe('TerrainEditorSection', () => {
  it('offers only the way in while closed', () => {
    renderSection();

    expect(screen.getByRole('button', { name: 'Editar terreno' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Suelos' })).not.toBeInTheDocument();
  });

  it('asks the other editors out before opening, and reports each change of mode', async () => {
    const onRequestActive = vi.fn();
    const onEditingChange = vi.fn();
    renderSection({ onRequestActive, onEditingChange });

    await open();

    expect(onRequestActive).toHaveBeenCalledTimes(1);
    expect(onEditingChange).toHaveBeenLastCalledWith(true);
    await userEvent.click(screen.getByRole('button', { name: 'Salir' }));
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
  });

  it('shows the floor palette with no generator, coordinates or material list', async () => {
    renderSection();
    await open();

    expect(screen.getByRole('group', { name: 'Suelos' })).toBeInTheDocument();
    expect(screen.getByText('Pintar sobre el vacío crea terreno nuevo; «Vacío» lo borra. El agua y el vacío no se pueden caminar. Con ESC sales del editor.')).toBeInTheDocument();
    // That sentence is the menu's only explanation.
    expect(screen.queryByText(/9 × 9/)).not.toBeInTheDocument();
    expect(screen.queryByText(/minimapa/)).not.toBeInTheDocument();
    expect(screen.queryByText(/siempre es de madera/)).not.toBeInTheDocument();
    expect(screen.queryByText(/procedural/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Semilla/)).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Seleccionar bloque' })).not.toBeInTheDocument();
  });

  it('picks a floor in the palette, paints every clicked block with it, and unpicks it', async () => {
    const { bridge, terrain, commands } = renderSection();
    await open();

    await userEvent.click(screen.getByRole('button', { name: 'Césped' }));
    expect(screen.getByRole('button', { name: 'Césped' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Pintando con Césped')).toBeInTheDocument();
    expect(commands.at(-1)).toEqual({ brush: { kind: 'floor', material: 'grass' } });

    act(() => bridge.emit('terrainpick', { index: LAWN }));
    act(() => bridge.emit('terrainpick', { index: LAWN + 1 }));
    await vi.waitFor(() => expect(terrain.setBlock).toHaveBeenCalledTimes(2));
    expect(terrain.setBlock).toHaveBeenLastCalledWith(LAWN + 1, 'grass');

    await userEvent.click(screen.getByRole('button', { name: 'Deseleccionar' }));
    expect(screen.getByRole('button', { name: 'Césped' })).toHaveAttribute('aria-pressed', 'false');
    act(() => bridge.emit('terrainpick', { index: LAWN + 2 }));
    expect(terrain.setBlock).toHaveBeenCalledTimes(2);
  });

  it('a second click on the picked floor unpicks it, and so does Escape', async () => {
    renderSection();
    await open();

    await userEvent.click(screen.getByRole('button', { name: 'Madera' }));
    await userEvent.click(screen.getByRole('button', { name: 'Madera' }));
    expect(screen.getByRole('button', { name: 'Madera' })).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(screen.getByRole('button', { name: 'Vacío' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Vacío' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('leaves like «Salir» on an Escape with nothing picked', async () => {
    const onExit = vi.fn();
    const onEditingChange = vi.fn();
    renderSection({ onExit, onEditingChange });
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Césped' }));

    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('heading', { name: 'Terreno' })).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('heading', { name: 'Terreno' })).not.toBeInTheDocument();
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('shows the reason a server refusal gives', async () => {
    const terrain: TerrainAdminPort = {
      setBlocks: vi.fn(),
      setWalls: vi.fn(),
      setBlock: vi.fn(async () => {
        throw new AdminError('terrain-under-placement');
      }),
    };
    const { bridge } = renderSection({ terrain });
    await open();
    act(() => bridge.emit('terrain', { blocks: withBlock(BASE_LAYOUT.blocks, LAWN, 'grass'), walls: BASE_LAYOUT.walls, colors: new Map() }));
    await userEvent.click(screen.getByRole('button', { name: 'Vacío' }));

    act(() => bridge.emit('terrainpick', { index: LAWN }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Elige otro bloque/);
  });

  it('says the entrance block stays wood', async () => {
    const { bridge, terrain } = renderSection();
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Agua' }));

    act(() => bridge.emit('terrainpick', { index: SPAWN_BLOCK_INDEX }));

    expect(screen.getByRole('alert')).toHaveTextContent('El bloque central de la entrada siempre es de madera.');
    expect(terrain.setBlock).not.toHaveBeenCalled();
  });

  it('offers no chairs: they live in Decoración since #208', async () => {
    renderSection();
    await open();

    expect(screen.queryByRole('group', { name: 'Sillas' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Girar' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Mirando/)).not.toBeInTheDocument();
  });

  it('offers no way to empty the whole terrain', async () => {
    renderSection();
    await open();

    expect(screen.queryByRole('button', { name: 'Vaciar terreno' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /Confirmo vaciar/ })).toBeNull();
  });

  it('leaves when another editor takes the map', async () => {
    const { rerender, bridge, terrain, commands } = renderSection();
    await open();

    rerender(<TerrainEditorSection bridge={bridge} terrain={terrain} loadMaterials={async () => catalog} preview={noPreview} forceExit />);

    expect(commands.at(-1)).toBeNull();
    expect(screen.getByRole('button', { name: 'Editar terreno' })).toBeInTheDocument();
  });

  it('paints carpet in the color chosen on its palette tile, like the painted desk (#222)', async () => {
    const { bridge, terrain, commands } = renderSection();
    await open();

    // Choosing the color is enough: the carpet is picked, with no click on its tile.
    fireEvent.change(await screen.findByLabelText(/^Color de Moqueta/), { target: { value: '#c0392b' } });
    expect(commands.at(-1)).toEqual({ brush: { kind: 'floor', material: 'carpet', color: '#c0392b' } });
    act(() => bridge.emit('terrainpick', { index: LAWN }));
    await vi.waitFor(() => expect(terrain.setBlock).toHaveBeenCalledTimes(1));
    expect(terrain.setBlock).toHaveBeenLastCalledWith(LAWN, 'carpet', '#c0392b');

    // Recoloring the picked carpet changes what the next click paints.
    fireEvent.change(screen.getByLabelText('Color de Moqueta: #c0392b'), { target: { value: '#3c6ac8' } });
    act(() => bridge.emit('terrainpick', { index: LAWN + 1 }));
    await vi.waitFor(() => expect(terrain.setBlock).toHaveBeenCalledTimes(2));
    expect(terrain.setBlock).toHaveBeenLastCalledWith(LAWN + 1, 'carpet', '#3c6ac8');
  });
});

describe('TerrainEditorSection: uploaded floors (S13)', () => {
  const PIECE = 'floor-upload-0123456789abcdef';
  const wood = catalog.floor.find((option) => option.id === 'floor-wood')!;
  const withUpload = { ...catalog, floor: [...catalog.floor, { ...wood, id: PIECE, name: 'Parquet gris' }] };

  it('picks an approved uploaded floor from the palette and paints every clicked block with it over wood', async () => {
    const { bridge, terrain, commands } = renderSection({ loadMaterials: async () => withUpload });
    await open();

    await userEvent.click(await screen.findByRole('button', { name: 'Parquet gris' }));
    expect(screen.getByRole('button', { name: 'Parquet gris' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Madera' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Pintando con Parquet gris')).toBeInTheDocument();
    expect(commands.at(-1)).toEqual({ brush: { kind: 'floor', material: 'wood', floor: PIECE } });

    act(() => bridge.emit('terrainpick', { index: LAWN }));
    await vi.waitFor(() => expect(terrain.setBlock).toHaveBeenCalledTimes(1));
    expect(terrain.setBlock).toHaveBeenLastCalledWith(LAWN, 'wood', undefined, PIECE);
  });

  it('keeps the plain wood label and paint when the built-in wood is picked', async () => {
    const { bridge, terrain } = renderSection({ loadMaterials: async () => withUpload });
    await open();

    await userEvent.click(await screen.findByRole('button', { name: 'Madera' }));
    expect(screen.getByText('Pintando con Madera')).toBeInTheDocument();
    act(() => bridge.emit('terrainpick', { index: LAWN }));
    await vi.waitFor(() => expect(terrain.setBlock).toHaveBeenCalledTimes(1));
    expect(terrain.setBlock).toHaveBeenLastCalledWith(LAWN, 'wood');
  });
});

describe('TerrainEditorSection: space outlines (#216)', () => {
  const desks = [{ x: 2, y: 3, w: 4, h: 4 }];
  const rooms = [{ x: 20, y: 5, w: 9, h: 9 }];

  it('asks the map to outline every desk and room while it is open, and to stop when it closes', async () => {
    const { commands, rerender, bridge, terrain } = renderSection({ desks, rooms });
    expect(commands).toEqual([]);

    await open();
    expect(commands.at(-1)?.outlines).toEqual([
      { x0: 2, y0: 3, x1: 5, y1: 6 },
      { x0: 20, y0: 5, x1: 28, y1: 13 },
    ]);

    rerender(<TerrainEditorSection bridge={bridge} terrain={terrain} desks={desks} rooms={rooms} loadMaterials={async () => catalog} preview={noPreview} forceExit />);
    expect(commands.at(-1)).toBeNull();
  });

  it('sends no outlines when it knows no desk or room', async () => {
    const { commands } = renderSection();
    await open();

    expect(commands.at(-1)).toEqual({ brush: null });
  });
});

/**
 * The walls (#224) moved from "Decoración" to "Editar terreno": the same
 * tool (`useWallEditor`), its palette and its eraser, under «Paredes»
 * below the floors. One entry is picked at a time across floors and walls.
 */
describe('TerrainEditorSection: walls', () => {
  it('offers the walls under «Paredes» below the floors, one entry pressed at a time across both, and says what it paints', async () => {
    const { commands } = renderSection({ initiallyActive: true });

    const walls = await screen.findByRole('group', { name: 'Paredes' });
    // The floors first, then the heading, the eraser's line and the walls.
    const heading = screen.getByRole('heading', { name: 'Paredes' });
    expect(screen.getByRole('button', { name: 'Agua' }).compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(heading.nextElementSibling).toContainElement(screen.getByRole('button', { name: 'Borrador' }));
    expect(heading.nextElementSibling?.nextElementSibling).toBe(walls);
    expect(document.body.textContent).not.toMatch(/líneas entre casillas|muebles ni la entrada/);

    await userEvent.click(screen.getByRole('button', { name: 'Agua' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ladrillo' }));
    expect(screen.getByRole('button', { name: 'Ladrillo' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Agua' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Pintando paredes de Ladrillo')).toBeInTheDocument();
    expect(commands.at(-1)).toEqual({ brush: { kind: 'wall', piece: 'wall-brick' } });

    // Back to a floor: the floor tool takes the map again.
    await userEvent.click(screen.getByRole('button', { name: 'Agua' }));
    expect(screen.getByRole('button', { name: 'Ladrillo' })).toHaveAttribute('aria-pressed', 'false');
    expect(commands.at(-1)).toEqual({ brush: { kind: 'floor', material: 'water' } });
  });

  it('puts «⛔ Borrador» on its own line, out of the walls group, and says only that while it is picked (#223)', async () => {
    const { commands } = renderSection({ initiallyActive: true });
    const eraser = await screen.findByRole('button', { name: 'Borrador' });

    expect(within(screen.getByRole('group', { name: 'Paredes' })).queryByRole('button', { name: 'Borrador' })).not.toBeInTheDocument();
    expect(eraser).toHaveTextContent(/^\u26D4 Borrador$/);
    expect(eraser).toHaveAttribute('title', 'Borrador');
    expect(document.body.textContent).not.toMatch(/Quitar pared|Quitando paredes|Goma/);

    await userEvent.click(screen.getByRole('button', { name: 'Ladrillo' }));
    await userEvent.click(eraser);
    expect(eraser).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Ladrillo' })).toHaveAttribute('aria-pressed', 'false');
    expect(commands.at(-1)?.brush).toEqual({ kind: 'wall', piece: null });
    expect(screen.getByRole('button', { name: 'Deseleccionar' }).parentElement).toHaveTextContent(/^Borrador/);
    expect(document.body.textContent).not.toMatch(/Quitando|Quitar/);

    await userEvent.click(screen.getByRole('button', { name: 'Agua' }));
    expect(eraser).toHaveAttribute('aria-pressed', 'false');
    expect(commands.at(-1)).toEqual({ brush: { kind: 'floor', material: 'water' } });
  });

  it('erases the clicked wall when the eraser is picked, and the walls stay paintable (#223)', async () => {
    const setWalls = vi.fn(async () => undefined);
    const { bridge } = renderSection({ initiallyActive: true, terrain: { setBlock: vi.fn(), setBlocks: vi.fn(), setWalls } });
    act(() => bridge.emit('terrain', { blocks: BASE_LAYOUT.blocks, walls: withWalls(BASE_LAYOUT.walls, [{ index: 7, piece: 'wall-stone' }]), colors: new Map() }));

    await userEvent.click(await screen.findByRole('button', { name: 'Borrador' }));
    act(() => bridge.emit('wallpick', { index: 7 }));
    await vi.waitFor(() => expect(setWalls).toHaveBeenLastCalledWith([{ index: 7, piece: null }]));

    await userEvent.click(screen.getByRole('button', { name: 'Ladrillo' }));
    act(() => bridge.emit('wallpick', { index: 9 }));
    await vi.waitFor(() => expect(setWalls).toHaveBeenLastCalledWith([{ index: 9, piece: 'wall-brick' }]));
  });

  it('takes the decor on the clicked tile off before the wall, through the decor port', async () => {
    const setWalls = vi.fn(async () => undefined);
    const decor: OfficeDecorPort = { setDecor: vi.fn(async () => undefined) };
    const { bridge } = renderSection({ initiallyActive: true, decor, terrain: { setBlock: vi.fn(), setBlocks: vi.fn(), setWalls } });
    act(() => bridge.emit('decor', { items: [{ index: at(40, 41), piece: 'chair-gamer', rotation: 0 }] }));

    await userEvent.click(await screen.findByRole('button', { name: 'Borrador' }));
    act(() => bridge.emit('wallpick', { index: at(40, 41), tile: at(40, 41) }));
    await vi.waitFor(() => expect(decor.setDecor).toHaveBeenCalledWith([{ index: at(40, 41), item: null }]));
    expect(setWalls).not.toHaveBeenCalled();
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
      const view = renderSection({ initiallyActive: true, decor, terrain: { setBlock: vi.fn(), setBlocks: vi.fn(), setWalls } });
      act(() => view.bridge.emit('terrain', { blocks: BASE_LAYOUT.blocks, walls: WALL, colors: new Map() }));
      act(() => view.bridge.emit('decor', { items }));
      return { ...view, decor, setWalls };
    }

    it('takes a lone door off the post at either end and keeps the post, then erases the post once the room shows it gone', async () => {
      const { bridge, decor, setWalls } = onWall(LONE);
      await userEvent.click(await screen.findByRole('button', { name: 'Borrador' }));

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
      await userEvent.click(await screen.findByRole('button', { name: 'Borrador' }));

      act(() => bridge.emit('wallpick', { index: at(41, 40) }));
      await vi.waitFor(() => expect(decor.setDecor).toHaveBeenCalledWith([{ index: at(40, 40), item: null }]));
      expect(setWalls).not.toHaveBeenCalled();
    });

    it('leaves the posts past the ends of a door to the eraser', async () => {
      const { bridge, decor, setWalls } = onWall(LONE);
      await userEvent.click(await screen.findByRole('button', { name: 'Borrador' }));

      act(() => bridge.emit('wallpick', { index: at(43, 40) }));
      await vi.waitFor(() => expect(setWalls).toHaveBeenCalledWith([{ index: at(43, 40), piece: null }]));
      expect(decor.setDecor).not.toHaveBeenCalled();
    });

    it('takes a double door off from the post at either end or in the middle of its three tiles', async () => {
      const { bridge, decor, setWalls } = onWall(DOUBLE);
      await userEvent.click(await screen.findByRole('button', { name: 'Borrador' }));

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
      await userEvent.click(await screen.findByRole('button', { name: 'Borrador' }));

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
  });

  it('steps out on Escape: the picked wall first, then the editor', async () => {
    const onExit = vi.fn();
    const { commands } = renderSection({ initiallyActive: true, onExit });
    await userEvent.click(await screen.findByRole('button', { name: 'Borrador' }));
    expect(screen.getByRole('button', { name: 'Deseleccionar' }).parentElement).toHaveTextContent('Borrador');

    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Borrador' })).toHaveAttribute('aria-pressed', 'false');
    // The floor tool holds the map again, with nothing picked.
    expect(commands.at(-1)).toEqual({ brush: null });
    expect(onExit).not.toHaveBeenCalled();

    await userEvent.keyboard('{Escape}');
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('paints the clicked tiles with the picked wall, and says why the server refused one', async () => {
    const setWalls = vi.fn(async () => {
      throw new AdminError('terrain-under-placement');
    });
    const { bridge } = renderSection({ initiallyActive: true, terrain: { setBlock: vi.fn(), setBlocks: vi.fn(), setWalls } });
    await userEvent.click(await screen.findByRole('button', { name: 'Piedra' }));

    act(() => bridge.emit('wallpick', { index: 7 }));

    await vi.waitFor(() => expect(setWalls).toHaveBeenCalledWith([{ index: 7, piece: 'wall-stone' }]));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Una pared no puede tapar un escritorio/);
  });

  it('puts the picked wall down when it leaves', async () => {
    const { rerender, bridge, terrain, commands } = renderSection({ initiallyActive: true });
    await userEvent.click(await screen.findByRole('button', { name: 'Ladrillo' }));

    rerender(<TerrainEditorSection bridge={bridge} terrain={terrain} loadMaterials={async () => catalog} preview={noPreview} forceExit />);
    expect(commands.at(-1)).toBeNull();
    rerender(<TerrainEditorSection bridge={bridge} terrain={terrain} loadMaterials={async () => catalog} preview={noPreview} />);
    await open();
    expect(screen.getByRole('button', { name: 'Ladrillo' })).toHaveAttribute('aria-pressed', 'false');
    expect(commands.at(-1)).toEqual({ brush: null });
  });
});
