import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import exportedManifest from '../../public/assets/pack/manifest.json?raw';
import { materialCatalogFrom } from '../game/artMaterials';
import type { ArtPreviewCache } from '../game/artPreview';
import { fitsDeskArea } from '../game/decorEditor';
import { DECOR_COLORS, DecorPalette, catalogDecorInfo } from './DecorPalette';

const catalog = materialCatalogFrom(JSON.parse(exportedManifest), 'assets/pack/manifest.json')!;

function noPreview(): ArtPreviewCache {
  return { sheet: vi.fn(async () => null) };
}

/** The pick buttons of a group by accessible name (the color picker is a button of its own, left out). */
const names = (group: string): string[] =>
  within(screen.getByRole('group', { name: group }))
    .getAllByRole('button')
    .filter((button) => button.hasAttribute('aria-pressed'))
    .map((button) => button.getAttribute('aria-label') ?? '');

const tiles = (group: string): string[] =>
  within(screen.getByRole('group', { name: group }))
    .getAllByRole('button')
    .filter((button) => button.hasAttribute('aria-pressed'))
    .map((button) => button.querySelector('[data-tile-name]')?.textContent ?? '');

describe('DecorPalette', () => {
  it('offers every decor piece of the catalog by its full Spanish name, grouped by kind, none pressed, and no eraser', () => {
    render(<DecorPalette value={null} catalog={catalog} onPick={() => {}} preview={noPreview()} />);

    expect(screen.getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toEqual(['Sillas', 'Mesas de escritorio', 'Mesas de sala', 'Plantas', 'Puertas']);
    expect(names('Puertas')).toEqual(['Puerta de madera', 'Puerta doble de madera']);
    expect(names('Sillas')).toEqual(['Silla de madera', 'Silla de metal', 'Silla de cuero', 'Silla gamer']);
    expect(names('Mesas de escritorio')).toEqual(['Escritorio de vidrio', 'Escritorio de metal', 'Escritorio de madera', 'Escritorio pintado']);
    expect(names('Mesas de sala')).toEqual(['Mesa de reuniones', 'Mesa de cafetería', 'Mesa ovalada']);
    expect(names('Plantas')).toEqual(['Ficus']);
    expect(screen.queryByRole('button', { name: 'Quitar' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button').filter((button) => button.getAttribute('aria-pressed') === 'true')).toEqual([]);
  });

  it('writes on each tile only what tells it apart in its group, keeping the full name for its title', () => {
    render(<DecorPalette value={null} catalog={catalog} onPick={() => {}} preview={noPreview()} />);

    expect(tiles('Sillas')).toEqual(['Madera', 'Metal', 'Cuero', 'Gamer']);
    expect(tiles('Mesas de escritorio')).toEqual(['Vidrio', 'Metal', 'Madera', 'Pintado']);
    expect(tiles('Mesas de sala')).toEqual(['Reuniones', 'Cafetería', 'Ovalada']);
    expect(tiles('Plantas')).toEqual(['Ficus']);
    expect(tiles('Puertas')).toEqual(['Madera', 'Doble de madera']);
    expect(screen.getByRole('button', { name: 'Silla de madera' })).toHaveAttribute('title', 'Silla de madera');
  });

  it('tells under the doors where they go, how wide they are, and that X locks or unlocks one (#223, #233)', () => {
    render(<DecorPalette value={null} catalog={catalog} onPick={() => {}} preview={noPreview()} />);
    const doors = screen.getByRole('group', { name: 'Puertas' }).parentElement!;
    expect(within(doors).getByText('Va entre dos paredes, una en cada extremo: la puerta ocupa 2 casillas y la doble 4. Junto a una puerta, pulsa X para bloquearla o desbloquearla.')).toBeInTheDocument();
  });

  it('shows the size of each room table on its tile, the horizontal one', () => {
    render(<DecorPalette value={null} catalog={catalog} onPick={() => {}} preview={noPreview()} />);

    const sizes = within(screen.getByRole('group', { name: 'Mesas de sala' }))
      .getAllByRole('button')
      .map((button) => button.querySelector('[data-tile-size]')?.textContent);
    expect(sizes).toEqual(['7x5', '5x3', '2x1']);
    expect(screen.getByRole('button', { name: 'Mesa de reuniones' })).toHaveAttribute('title', 'Mesa de reuniones (7x5)');
    expect(screen.getByRole('button', { name: 'Silla gamer' }).querySelector('[data-tile-size]')).toBeNull();
  });

  it('reports each pick with the piece info the map needs, and presses the picked piece whatever its rotation', async () => {
    const onPick = vi.fn();
    const { rerender } = render(<DecorPalette value={null} catalog={catalog} onPick={onPick} preview={noPreview()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Escritorio de madera' }));
    await userEvent.click(screen.getByRole('button', { name: 'Mesa de reuniones' }));
    await userEvent.click(screen.getByRole('button', { name: 'Escritorio pintado' }));
    expect(onPick.mock.calls).toEqual([
      [{ id: 'desk-wood', info: { kind: 'desk', footprint: { w: 3, h: 1 } } }],
      [{ id: 'table-meeting', info: { kind: 'table', footprint: { w: 7, h: 5 } } }],
      [{ id: 'desk-painted', info: { kind: 'desk', footprint: { w: 3, h: 1 }, colorable: true } }],
    ]);

    rerender(
      <DecorPalette
        value={{ kind: 'piece', piece: 'chair-gamer', info: { kind: 'chair', footprint: { w: 1, h: 1 } }, rotation: 90 }}
        catalog={catalog}
        onPick={onPick}
        preview={noPreview()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Silla gamer' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('picks the single door and the double door as two pieces, each with the width of its span (#233)', async () => {
    const onPick = vi.fn();
    render(<DecorPalette value={null} catalog={catalog} onPick={onPick} preview={noPreview()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Puerta de madera' }));
    await userEvent.click(screen.getByRole('button', { name: 'Puerta doble de madera' }));
    expect(onPick.mock.calls).toEqual([
      [{ id: 'door-wood', info: { kind: 'door', footprint: { w: 2, h: 1 } } }],
      [{ id: 'door-wood-double', info: { kind: 'door', footprint: { w: 4, h: 1 } } }],
    ]);
  });

  it('gives a colorable piece a color picker on its tile, starting in its default, and draws the tile in the color chosen', async () => {
    const onColorChange = vi.fn();
    const preview = noPreview();
    const { rerender } = render(<DecorPalette value={null} catalog={catalog} onPick={() => {}} onColorChange={onColorChange} preview={preview} />);

    const picker = screen.getByRole('button', { name: /^Color de Escritorio pintado:/ });
    expect(picker).toHaveAttribute('aria-label', 'Color de Escritorio pintado: Verde azulado');
    expect(screen.getAllByRole('button', { name: /^Color de/ })).toHaveLength(1);
    await userEvent.click(picker);
    await userEvent.click(screen.getByRole('button', { name: 'Rojo' }));
    expect(onColorChange).toHaveBeenCalledWith('desk-painted', DECOR_COLORS.find((swatch) => swatch.label === 'Rojo')!.hex);

    const painted = catalog.desk.find((option) => option.id === 'desk-painted')!;
    rerender(<DecorPalette value={null} catalog={catalog} colors={{ 'desk-painted': '#c83c3c' }} onPick={() => {}} onColorChange={onColorChange} preview={preview} />);
    expect(screen.getByRole('button', { name: 'Color de Escritorio pintado: #c83c3c' })).toBeInTheDocument();
    await waitFor(() => expect(preview.sheet).toHaveBeenCalledWith(painted, '#c83c3c'));
  });

  it('offers only what fits a desk when asked, leaving out the room tables bigger than one', () => {
    render(<DecorPalette value={null} catalog={catalog} offers={fitsDeskArea} onPick={() => {}} preview={noPreview()} />);
    expect(names('Mesas de sala')).toEqual(['Mesa ovalada']);
    expect(screen.getByRole('group', { name: 'Sillas' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Plantas' })).toBeInTheDocument();
    // Doors open walls, which only an admin edits (#223).
    expect(screen.queryByRole('group', { name: 'Puertas' })).not.toBeInTheDocument();
  });

  it('cuts every thumbnail from its sheet through the shared preview generator, both layers for a chair', async () => {
    const preview = noPreview();
    render(<DecorPalette value={null} catalog={catalog} onPick={() => {}} preview={preview} />);
    await waitFor(() => expect(preview.sheet).toHaveBeenCalledWith(catalog.table[0], null));
    const chair = screen.getByRole('button', { name: 'Silla gamer' });
    expect(chair.querySelectorAll('canvas')).toHaveLength(2);
  });

  it('offers nothing while the catalog is unavailable, and disables everything while editing is', () => {
    const { unmount } = render(<DecorPalette value={null} catalog={null} onPick={() => {}} preview={noPreview()} />);
    expect(screen.queryAllByRole('group')).toEqual([]);
    expect(screen.queryAllByRole('button')).toEqual([]);
    unmount();

    render(<DecorPalette value={null} catalog={catalog} onPick={() => {}} preview={noPreview()} disabled />);
    expect(screen.getByRole('button', { name: 'Silla gamer' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Color de Escritorio pintado/ })).toBeDisabled();
  });
});

describe('catalogDecorInfo', () => {
  it('sizes a piece from its catalog entry, and knows nothing of what the catalog lacks', () => {
    const infoOf = catalogDecorInfo(catalog);
    expect(infoOf('table-cafeteria')).toEqual({ kind: 'table', footprint: { w: 5, h: 3 } });
    expect(infoOf('table-oval')).toEqual({ kind: 'table', footprint: { w: 2, h: 1 } });
    expect(infoOf('desk-painted')).toEqual({ kind: 'desk', footprint: { w: 3, h: 1 }, colorable: true });
    expect(infoOf('chair-wood')).toEqual({ kind: 'chair', footprint: { w: 1, h: 1 } });
    expect(infoOf('door-wood')).toEqual({ kind: 'door', footprint: { w: 2, h: 1 } });
    expect(infoOf('door-wood-double')).toEqual({ kind: 'door', footprint: { w: 4, h: 1 } });
    expect(infoOf('table-nope')).toBeNull();
    expect(catalogDecorInfo(null)('chair-wood')).toBeNull();
  });
});
