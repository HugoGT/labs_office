import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import exportedManifest from '../../public/assets/pack/manifest.json?raw';
import { materialCatalogFrom } from '../game/artMaterials';
import type { ArtPreviewCache } from '../game/artPreview';
import { TerrainPalette } from './TerrainPalette';

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
    render(<TerrainPalette value="grass" onPick={onPick} floors={catalog.floor} preview={noPreview()} />);

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
