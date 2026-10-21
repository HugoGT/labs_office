import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import exportedManifest from '../../public/assets/pack/manifest.json?raw';
import { materialCatalogFrom } from '../game/artMaterials';
import type { ArtPreviewCache } from '../game/artPreview';
import { fitsDeskArea } from '../game/decorEditor';
import { DecorPalette, catalogDecorInfo } from './DecorPalette';

const catalog = materialCatalogFrom(JSON.parse(exportedManifest), 'assets/pack/manifest.json')!;

function noPreview(): ArtPreviewCache {
  return { sheet: vi.fn(async () => null) };
}

const names = (group: string): string[] =>
  within(screen.getByRole('group', { name: group }))
    .getAllByRole('button')
    .map((button) => button.textContent ?? '');

describe('DecorPalette', () => {
  it('offers every decor piece of the catalog by its Spanish name, grouped by kind, then the eraser, none pressed', () => {
    render(<DecorPalette value={null} catalog={catalog} onPick={() => {}} onErase={() => {}} preview={noPreview()} />);

    expect(screen.getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toEqual(['Sillas', 'Mesas de escritorio', 'Mesas de sala', 'Plantas']);
    expect(names('Sillas')).toEqual(['Silla de madera', 'Silla de metal', 'Silla de cuero', 'Silla gamer']);
    expect(names('Mesas de escritorio')).toEqual(['Escritorio de vidrio', 'Escritorio de metal', 'Escritorio de madera', 'Escritorio pintado']);
    expect(names('Mesas de sala')).toEqual(['Mesa de reuniones', 'Mesa de cafetería']);
    expect(names('Plantas')).toEqual(['Ficus']);
    expect(screen.getByRole('button', { name: 'Quitar' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getAllByRole('button').filter((button) => button.getAttribute('aria-pressed') === 'true')).toEqual([]);
  });

  it('reports each pick with the piece info the map needs, and presses the picked piece whatever its rotation, or the eraser', async () => {
    const onPick = vi.fn();
    const onErase = vi.fn();
    const { rerender } = render(<DecorPalette value={null} catalog={catalog} onPick={onPick} onErase={onErase} preview={noPreview()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Escritorio de madera' }));
    await userEvent.click(screen.getByRole('button', { name: 'Mesa de reuniones' }));
    await userEvent.click(screen.getByRole('button', { name: 'Quitar' }));
    expect(onPick.mock.calls).toEqual([
      [{ id: 'desk-wood', info: { kind: 'desk', footprint: { w: 3, h: 1 } } }],
      [{ id: 'table-meeting', info: { kind: 'table', footprint: { w: 7, h: 5 } } }],
    ]);
    expect(onErase).toHaveBeenCalledTimes(1);

    rerender(
      <DecorPalette
        value={{ kind: 'piece', piece: 'chair-gamer', info: { kind: 'chair', footprint: { w: 1, h: 1 } }, rotation: 90 }}
        catalog={catalog}
        onPick={onPick}
        onErase={onErase}
        preview={noPreview()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Silla gamer' })).toHaveAttribute('aria-pressed', 'true');
    rerender(<DecorPalette value={{ kind: 'eraser' }} catalog={catalog} onPick={onPick} onErase={onErase} preview={noPreview()} />);
    expect(screen.getByRole('button', { name: 'Quitar' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('offers only what fits a desk when asked, leaving out the room tables', () => {
    render(<DecorPalette value={null} catalog={catalog} offers={fitsDeskArea} onPick={() => {}} onErase={() => {}} preview={noPreview()} />);
    expect(screen.queryByRole('group', { name: 'Mesas de sala' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Sillas' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Plantas' })).toBeInTheDocument();
  });

  it('cuts every thumbnail from its sheet through the shared preview generator, both layers for a chair', async () => {
    const preview = noPreview();
    render(<DecorPalette value={null} catalog={catalog} onPick={() => {}} onErase={() => {}} preview={preview} />);
    await waitFor(() => expect(preview.sheet).toHaveBeenCalledWith(catalog.table[0], null));
    const chair = screen.getByRole('button', { name: 'Silla gamer' });
    expect(chair.querySelectorAll('canvas')).toHaveLength(2);
  });

  it('keeps only the eraser while the catalog is unavailable, and disables everything while editing is', () => {
    render(<DecorPalette value={null} catalog={null} onPick={() => {}} onErase={() => {}} preview={noPreview()} disabled />);
    expect(screen.queryAllByRole('group')).toEqual([]);
    expect(screen.getByRole('button', { name: 'Quitar' })).toBeDisabled();
  });
});

describe('catalogDecorInfo', () => {
  it('sizes a piece from its catalog entry, and knows nothing of what the catalog lacks', () => {
    const infoOf = catalogDecorInfo(catalog);
    expect(infoOf('table-cafeteria')).toEqual({ kind: 'table', footprint: { w: 5, h: 3 } });
    expect(infoOf('chair-wood')).toEqual({ kind: 'chair', footprint: { w: 1, h: 1 } });
    expect(infoOf('table-nope')).toBeNull();
    expect(catalogDecorInfo(null)('chair-wood')).toBeNull();
  });
});
