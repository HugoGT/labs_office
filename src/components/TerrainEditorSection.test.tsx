import { act, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import exportedManifest from '../../public/assets/pack/manifest.json?raw';
import { AdminError } from '../dashboard/adminPort';
import type { TerrainAdminPort } from '../dashboard/terrainAdminPort';
import { materialCatalogFrom } from '../game/artMaterials';
import type { ArtPreviewCache } from '../game/artPreview';
import { SPAWN_BLOCK_INDEX } from '../game/mapData';
import { createOfficeBridge, type OfficeCommandMap } from '../game/officeBridge';
import { BASE_LAYOUT, withBlock } from '../game/officeLayout';
import { TerrainEditorSection } from './TerrainEditorSection';

const LAWN = 35;
const catalog = materialCatalogFrom(JSON.parse(exportedManifest), 'assets/pack/manifest.json')!;
const noPreview: ArtPreviewCache = { sheet: vi.fn(async () => null) };

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

  it('offers no walls: they live in Decoración since #224', async () => {
    renderSection();
    await open();

    expect(screen.queryByRole('group', { name: 'Paredes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quitar pared' })).not.toBeInTheDocument();
    expect(screen.queryByText(/pared/i)).not.toBeInTheDocument();
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

    await userEvent.click(await screen.findByRole('button', { name: /^Color de Moqueta/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Rojo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Moqueta' }));
    expect(commands.at(-1)).toEqual({ brush: { kind: 'floor', material: 'carpet', color: '#c0392b' } });
    act(() => bridge.emit('terrainpick', { index: LAWN }));
    await vi.waitFor(() => expect(terrain.setBlock).toHaveBeenCalledTimes(1));
    expect(terrain.setBlock).toHaveBeenLastCalledWith(LAWN, 'carpet', '#c0392b');

    // Recoloring the picked carpet changes what the next click paints.
    await userEvent.click(screen.getByRole('button', { name: 'Color de Moqueta: Rojo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Azul' }));
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
