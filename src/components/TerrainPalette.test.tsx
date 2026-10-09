import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import exportedManifest from '../../public/assets/pack/manifest.json?raw';
import { materialCatalogFrom } from '../game/artMaterials';
import type { ArtPreviewCache } from '../game/artPreview';
import { TerrainPalette, WallPalette } from './TerrainPalette';

const catalog = materialCatalogFrom(JSON.parse(exportedManifest), 'assets/pack/manifest.json')!;

function noPreview(): ArtPreviewCache {
  return { sheet: vi.fn(async () => null) };
}

/** Highest drawing priority first, the void eraser last. */
const NAMES = ['Moqueta', 'Baldosa', 'Madera', 'Césped', 'Empedrado', 'Tierra', 'Arena', 'Agua', 'Vacío'];

describe('TerrainPalette', () => {
  it('offers every floor by its Spanish name from the highest drawing priority down, then the void eraser, none pressed until one is picked', () => {
    render(<TerrainPalette value={null} onPick={() => {}} floors={catalog.floor} preview={noPreview()} />);

    const group = screen.getByRole('group', { name: 'Suelos' });
    const buttons = Array.from(group.querySelectorAll('button'));
    expect(buttons.map((button) => button.textContent)).toEqual(NAMES);
    expect(buttons.every((button) => button.getAttribute('aria-pressed') === 'false')).toBe(true);
  });

  it('marks the picked floor as pressed and reports every click', async () => {
    const onPick = vi.fn();
    render(<TerrainPalette value={{ kind: 'floor', material: 'grass' }} onPick={onPick} floors={catalog.floor} preview={noPreview()} />);

    expect(screen.getByRole('button', { name: 'Césped' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Madera' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Madera' }));
    await userEvent.click(screen.getByRole('button', { name: 'Césped' }));
    await userEvent.click(screen.getByRole('button', { name: 'Vacío' }));

    expect(onPick.mock.calls).toEqual([['wood'], ['grass'], ['void']]);
  });

  it('cuts each thumbnail from the pack floor of the same material, through the shared preview generator', async () => {
    const preview = noPreview();
    render(<TerrainPalette value={null} onPick={() => {}} floors={catalog.floor} preview={preview} />);

    await waitFor(() => expect(preview.sheet).toHaveBeenCalledWith(expect.objectContaining({ id: 'floor-cobblestone' }), null));
    expect(preview.sheet).toHaveBeenCalledTimes(8);
  });

  it('keeps a flat color swatch while the pack catalog is unavailable', () => {
    render(<TerrainPalette value={null} onPick={() => {}} floors={null} preview={noPreview()} />);

    expect(screen.getAllByRole('button')).toHaveLength(NAMES.length);
    expect(screen.getByRole('button', { name: 'Vacío' }).querySelector('span')).toHaveStyle({ background: 'rgb(0, 0, 0)' });
    expect(screen.getByRole('button', { name: 'Agua' }).querySelector('span')).toHaveStyle({ background: 'rgb(63, 120, 196)' });
  });

  it('disables every entry while editing is unavailable', () => {
    render(<TerrainPalette value={null} onPick={() => {}} floors={catalog.floor} preview={noPreview()} disabled />);

    expect(screen.getAllByRole('button').every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
  });
});

describe('WallPalette', () => {
  const WALL_NAMES = ['Ladrillo', 'Piedra', 'Yeso', 'Vidrio', 'Quitar pared'];

  it('offers every wall by its Spanish name, then the wall eraser, none pressed while a floor or nothing is picked', () => {
    const { rerender } = render(<WallPalette value={null} onPick={() => {}} walls={catalog.wall} preview={noPreview()} />);

    const group = screen.getByRole('group', { name: 'Paredes' });
    const buttons = Array.from(group.querySelectorAll('button'));
    expect(buttons.map((button) => button.textContent)).toEqual(WALL_NAMES);
    expect(buttons.every((button) => button.getAttribute('aria-pressed') === 'false')).toBe(true);

    rerender(<WallPalette value={{ kind: 'floor', material: 'void' }} onPick={() => {}} walls={catalog.wall} preview={noPreview()} />);
    expect(screen.getByRole('button', { name: 'Quitar pared' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('marks the picked wall or the eraser as pressed and reports every click', async () => {
    const onPick = vi.fn();
    const { rerender } = render(<WallPalette value={{ kind: 'wall', piece: 'wall-stone' }} onPick={onPick} walls={catalog.wall} preview={noPreview()} />);

    expect(screen.getByRole('button', { name: 'Piedra' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Quitar pared' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Vidrio' }));
    await userEvent.click(screen.getByRole('button', { name: 'Quitar pared' }));
    expect(onPick.mock.calls).toEqual([['wall-glass'], [null]]);

    rerender(<WallPalette value={{ kind: 'wall', piece: null }} onPick={onPick} walls={catalog.wall} preview={noPreview()} />);
    expect(screen.getByRole('button', { name: 'Quitar pared' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Piedra' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('cuts each thumbnail from the pack wall sheet, and keeps flat swatches without the catalog', async () => {
    const preview = noPreview();
    const { unmount } = render(<WallPalette value={null} onPick={() => {}} walls={catalog.wall} preview={preview} />);
    await waitFor(() => expect(preview.sheet).toHaveBeenCalledWith(expect.objectContaining({ id: 'wall-plaster' }), null));
    expect(preview.sheet).toHaveBeenCalledTimes(4);
    unmount();

    render(<WallPalette value={null} onPick={() => {}} walls={null} preview={noPreview()} disabled />);
    expect(screen.getAllByRole('button')).toHaveLength(WALL_NAMES.length);
    expect(screen.queryAllByRole('img')).toHaveLength(0);
    expect(screen.getAllByRole('button').every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
  });
});
