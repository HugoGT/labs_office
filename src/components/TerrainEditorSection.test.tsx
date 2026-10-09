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
    expect(screen.getByText(/9 × 9/)).toBeInTheDocument();
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
    act(() => bridge.emit('terrain', { blocks: withBlock(BASE_LAYOUT.blocks, LAWN, 'grass'), walls: BASE_LAYOUT.walls }));
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

  it('offers the walls below the floors, one entry pressed at a time across both, and says what it paints', async () => {
    const { commands } = renderSection();
    await open();

    expect(screen.getByRole('group', { name: 'Paredes' })).toBeInTheDocument();
    expect(screen.getByText(/paredes van sobre las líneas entre casillas/i)).toBeInTheDocument();
    expect(screen.getByText(/escritorios, sillas ni la entrada/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Césped' }));
    await userEvent.click(screen.getByRole('button', { name: 'Ladrillo' }));
    expect(screen.getByRole('button', { name: 'Ladrillo' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Césped' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Pintando paredes de Ladrillo')).toBeInTheDocument();
    expect(commands.at(-1)).toEqual({ brush: { kind: 'wall', piece: 'wall-brick' } });

    await userEvent.click(screen.getByRole('button', { name: 'Quitar pared' }));
    expect(screen.getByText('Quitando paredes')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Quitar pared' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('paints the clicked tiles with the picked wall, and says why the server refused one', async () => {
    const setWalls = vi.fn(async () => {
      throw new AdminError('terrain-under-placement');
    });
    const { bridge } = renderSection({ terrain: { setBlock: vi.fn(), setBlocks: vi.fn(), setWalls } });
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Piedra' }));

    act(() => bridge.emit('wallpick', { index: 7 }));

    await vi.waitFor(() => expect(setWalls).toHaveBeenCalledWith([{ index: 7, piece: 'wall-stone' }]));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Una pared no puede tapar un escritorio/);
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
});
