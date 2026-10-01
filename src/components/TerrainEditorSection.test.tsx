import { act, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminError } from '../dashboard/adminPort';
import type { TerrainAdminPort } from '../dashboard/terrainAdminPort';
import { createOfficeBridge, type OfficeCommandMap } from '../game/officeBridge';
import { BASE_LAYOUT, withBlock } from '../game/officeLayout';
import { TerrainEditorSection } from './TerrainEditorSection';

const LAWN = 35;

function renderSection(overrides: Partial<Parameters<typeof TerrainEditorSection>[0]> = {}) {
  const bridge = overrides.bridge ?? createOfficeBridge();
  const commands: OfficeCommandMap['terrainedit'][] = [];
  bridge.onCommand('terrainedit', (command) => commands.push(command));
  const terrain: TerrainAdminPort = overrides.terrain ?? { setBlock: vi.fn(async () => undefined) };
  const props = { bridge, terrain, ...overrides };
  return { ...props, commands, ...render(<TerrainEditorSection {...props} />) };
}

describe('TerrainEditorSection', () => {
  it('offers only the way in while closed', () => {
    renderSection();

    expect(screen.getByRole('button', { name: 'Editar terreno' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Material' })).not.toBeInTheDocument();
  });

  it('asks the other editors out before opening, and reports each change of mode', async () => {
    const onRequestActive = vi.fn();
    const onEditingChange = vi.fn();
    renderSection({ onRequestActive, onEditingChange });

    await userEvent.click(screen.getByRole('button', { name: 'Editar terreno' }));

    expect(onRequestActive).toHaveBeenCalledTimes(1);
    expect(onEditingChange).toHaveBeenLastCalledWith(true);
    await userEvent.click(screen.getByRole('button', { name: 'Salir' }));
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
  });

  it('selects a block clicked on the map and shows what it is made of', async () => {
    const { bridge } = renderSection();
    await userEvent.click(screen.getByRole('button', { name: 'Editar terreno' }));
    expect(screen.getByText(/Toca un bloque en el mapa/)).toBeInTheDocument();

    act(() => bridge.emit('terrainpick', { index: LAWN }));

    expect(screen.getByText('Columna 8, fila 3 · ahora Césped')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Material' })).toHaveValue('grass');
  });

  it('selects a block by column and row', async () => {
    const { commands } = renderSection();
    await userEvent.click(screen.getByRole('button', { name: 'Editar terreno' }));

    await userEvent.type(screen.getByRole('spinbutton', { name: 'Columna (1-14)' }), '8');
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Fila (1-10)' }), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Seleccionar bloque' }));

    expect(commands.at(-1)).toEqual({ selected: LAWN, preview: null });
  });

  it('previews the chosen material on the map and applies it', async () => {
    const { bridge, terrain, commands } = renderSection();
    await userEvent.click(screen.getByRole('button', { name: 'Editar terreno' }));
    act(() => bridge.emit('terrainpick', { index: LAWN }));

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Material' }), 'Agua');

    expect(commands.at(-1)).toEqual({ selected: LAWN, preview: { index: LAWN, material: 'water' } });
    expect(screen.getByText(/Vista previa en el mapa/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    expect(terrain.setBlock).toHaveBeenCalledWith(LAWN, 'water');
    expect(await screen.findByRole('status')).toHaveTextContent('Bloque actualizado.');

    act(() => bridge.emit('terrain', { blocks: withBlock(BASE_LAYOUT.blocks, LAWN, 'water') }));
    expect(screen.getByText('Columna 8, fila 3 · ahora Agua')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aplicar' })).toBeDisabled();
  });

  it('discards a preview without applying', async () => {
    const { bridge, terrain, commands } = renderSection();
    await userEvent.click(screen.getByRole('button', { name: 'Editar terreno' }));
    act(() => bridge.emit('terrainpick', { index: LAWN }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Material' }), 'Arena');

    await userEvent.click(screen.getByRole('button', { name: 'Descartar' }));

    expect(commands.at(-1)).toEqual({ selected: LAWN, preview: null });
    expect(terrain.setBlock).not.toHaveBeenCalled();
  });

  it('shows the reason a server refusal gives', async () => {
    const terrain: TerrainAdminPort = {
      setBlock: vi.fn(async () => {
        throw new AdminError('terrain-under-placement');
      }),
    };
    const { bridge } = renderSection({ terrain });
    await userEvent.click(screen.getByRole('button', { name: 'Editar terreno' }));
    act(() => bridge.emit('terrainpick', { index: LAWN }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Material' }), 'Agua');

    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Elige otro bloque/);
  });

  it('leaves when another editor takes the map', async () => {
    const { rerender, bridge, terrain, commands } = renderSection();
    await userEvent.click(screen.getByRole('button', { name: 'Editar terreno' }));

    rerender(<TerrainEditorSection bridge={bridge} terrain={terrain} forceExit />);

    expect(commands.at(-1)).toBeNull();
    expect(screen.getByRole('button', { name: 'Editar terreno' })).toBeInTheDocument();
  });
});
