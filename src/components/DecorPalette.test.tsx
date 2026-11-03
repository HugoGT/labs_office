import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

/** The pick buttons of a group by accessible name (the color picker is a button of its own, left out). */
const names = (group: string): string[] =>
  within(screen.getByRole('group', { name: group }))
    .getAllByRole('button')
    .filter((button) => button.hasAttribute('aria-pressed'))
    .map((button) => button.getAttribute('aria-label') ?? '');

describe('DecorPalette', () => {
  it('offers every decor piece of the catalog by its full Spanish name, grouped by kind, none pressed, and no eraser', () => {
    render(<DecorPalette value={null} catalog={catalog} onPick={() => {}} preview={noPreview()} />);

    expect(screen.getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toEqual(['Mi espacio', 'Escritorios', 'Sillas', 'Sala', 'Árboles', 'Puertas']);
    expect(names('Puertas')).toEqual(['Puerta simple', 'Puerta doble']);
    // The chairs and desk tables that take a color come first, each kind otherwise in catalog order.
    expect(names('Sillas')).toEqual(['Silla gamer', 'Sillón tapizado', 'Puff', 'Silla de madera', 'Silla de metal', 'Silla de cuero', 'Silla de oficina', 'Silla giratoria', 'Silla de comedor']);
    expect(names('Escritorios')).toEqual(['Escritorio pintado', 'Escritorio gamer', 'Escritorio de vidrio', 'Escritorio de metal', 'Escritorio de madera', 'Escritorio curvo']);
    // A room's furniture together: its tables, then its sofas.
    expect(names('Sala')).toEqual([
      'Mesa de reuniones',
      'Mesa de cafetería',
      'Mesa ovalada',
      'Mesa redonda',
      'Sofá de cuero (2 plazas)',
      'Sofá de cuero (3 plazas)',
      'Sofá tapizado (2 plazas)',
      'Sofá tapizado (3 plazas)',
    ]);
    expect(names('Mi espacio')).toEqual(['Bonsái']);
    expect(names('Árboles')).toEqual(['Árbol', 'Árbol grande', 'Ficus']);
    expect(screen.queryByRole('button', { name: 'Quitar' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button').filter((button) => button.getAttribute('aria-pressed') === 'true')).toEqual([]);
  });

  it('leaves a retired upload out, while an active upload is offered (#264)', () => {
    const ficus = catalog.plant.find((option) => option.id === 'plant-bonsai')!;
    const plant = [
      ...catalog.plant,
      { ...ficus, id: 'plant-upload-0123456789abcdef', name: 'Monstera' },
      { ...ficus, id: 'plant-upload-fedcba9876543210', name: 'Helecho', retired: true },
    ];
    render(<DecorPalette value={null} catalog={{ ...catalog, plant }} onPick={() => {}} preview={noPreview()} />);

    expect(names('Mi espacio')).toEqual(['Bonsái', 'Monstera']);
  });

  it('writes on a tile only the size of a room table or a sofa, the full name kept for its title and accessible name', () => {
    render(<DecorPalette value={null} catalog={catalog} onPick={() => {}} preview={noPreview()} />);

    for (const group of ['Sillas', 'Escritorios', 'Mi espacio', 'Puertas']) {
      for (const button of within(screen.getByRole('group', { name: group })).getAllByRole('button')) expect(button.textContent).toBe('');
    }
    expect(screen.getByRole('button', { name: 'Silla de madera' })).toHaveAttribute('title', 'Silla de madera');
    // Only the group headings are text.
    expect(screen.getByRole('group', { name: 'Puertas' }).parentElement!.textContent).toBe('Puertas');
  });

  it('shows the size of each room table and sofa on its tile, the horizontal one, and in its title', () => {
    render(<DecorPalette value={null} catalog={catalog} onPick={() => {}} preview={noPreview()} />);

    const room = within(screen.getByRole('group', { name: 'Sala' })).getAllByRole('button');
    expect(room.map((button) => button.textContent)).toEqual(['7x5', '5x3', '2x1', '1x1', '2x1', '3x1', '2x1', '3x1']);
    expect(room.map((button) => button.getAttribute('title'))).toEqual([
      'Mesa de reuniones (7x5)',
      'Mesa de cafetería (5x3)',
      'Mesa ovalada (2x1)',
      'Mesa redonda (1x1)',
      'Sofá de cuero (2 plazas) (2x1)',
      'Sofá de cuero (3 plazas) (3x1)',
      'Sofá tapizado (2 plazas) (2x1)',
      'Sofá tapizado (3 plazas) (3x1)',
    ]);
    expect(screen.getByRole('button', { name: 'Mesa de reuniones' })).toBeInTheDocument();
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

  it('picks each sofa with its seats as its width, and a fabric one in the color of the fabric armchair', async () => {
    const onPick = vi.fn();
    const onColorChange = vi.fn();
    render(<DecorPalette value={null} catalog={catalog} colors={{ 'chair-fabric': '#2a9d8f' }} onPick={onPick} onColorChange={onColorChange} preview={noPreview()} />);
    expect(screen.getAllByLabelText(/^Color de (Sillón|Sofá) tapizado/).map((color) => color.getAttribute('aria-label'))).toEqual([
      'Color de Sillón tapizado: #2a9d8f',
      'Color de Sofá tapizado (2 plazas): #2a9d8f',
      'Color de Sofá tapizado (3 plazas): #2a9d8f',
    ]);

    await userEvent.click(screen.getByRole('button', { name: 'Sofá de cuero (2 plazas)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sofá de cuero (3 plazas)' }));
    expect(onPick.mock.calls).toEqual([
      [{ id: 'sofa-leather-2', info: { kind: 'sofa', footprint: { w: 2, h: 1 } } }],
      [{ id: 'sofa-leather-3', info: { kind: 'sofa', footprint: { w: 3, h: 1 } } }],
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'Sofá tapizado (3 plazas)' }));
    expect(onColorChange).toHaveBeenCalledWith('sofa-fabric-3', '#2a9d8f');
    expect(catalogDecorInfo(catalog)('sofa-fabric-2')).toEqual({ kind: 'sofa', footprint: { w: 2, h: 1 }, colorable: true });
  });

  it('picks the single door and the double door as two pieces, each with the width of its span (#233)', async () => {
    const onPick = vi.fn();
    render(<DecorPalette value={null} catalog={catalog} onPick={onPick} preview={noPreview()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Puerta simple' }));
    await userEvent.click(screen.getByRole('button', { name: 'Puerta doble' }));
    expect(onPick.mock.calls).toEqual([
      [{ id: 'door-wood', info: { kind: 'door', footprint: { w: 2, h: 1 } } }],
      [{ id: 'door-wood-double', info: { kind: 'door', footprint: { w: 3, h: 1 } } }],
    ]);
  });

  it('gives a colorable piece a color input on its tile, starting in its default, and draws the tile in the color chosen', async () => {
    const onColorChange = vi.fn();
    const preview = noPreview();
    const { rerender } = render(<DecorPalette value={null} catalog={catalog} onPick={() => {}} onColorChange={onColorChange} preview={preview} />);

    // The native picker opens straight from the input: no list of suggested colors in between.
    const input = screen.getByLabelText(/^Color de Escritorio pintado:/);
    expect(input).toHaveAttribute('type', 'color');
    expect(input).toHaveAttribute('aria-label', 'Color de Escritorio pintado: #4f9a8a');
    // Only the painted desk, the gamer desk (its lights), the gamer chair (its red accent), the fabric armchair, the pouf, the fabric sofas and the tree (its leaves) take a color; every other tile has none.
    expect(screen.getAllByLabelText(/^Color de/).map((color) => color.getAttribute('aria-label')).sort()).toEqual([
      'Color de Escritorio gamer: #a066e8',
      'Color de Escritorio pintado: #4f9a8a',
      'Color de Puff: #6b8fb3',
      'Color de Silla gamer: #d8433b',
      'Color de Sillón tapizado: #c4ab8c',
      'Color de Sofá tapizado (2 plazas): #c4ab8c',
      'Color de Sofá tapizado (3 plazas): #c4ab8c',
      'Color de Árbol: #4f8f3a',
    ]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: '#C83C3C' } });
    expect(onColorChange).toHaveBeenCalledWith('desk-painted', '#c83c3c');

    const painted = catalog.desk.find((option) => option.id === 'desk-painted')!;
    rerender(<DecorPalette value={null} catalog={catalog} colors={{ 'desk-painted': '#c83c3c' }} onPick={() => {}} onColorChange={onColorChange} preview={preview} />);
    expect(screen.getByLabelText('Color de Escritorio pintado: #c83c3c')).toHaveValue('#c83c3c');
    await waitFor(() => expect(preview.sheet).toHaveBeenCalledWith(painted, '#c83c3c'));
  });

  it('a click on a colorable tile puts it in hand in its current color and opens the picker, instead of toggling it', async () => {
    const showPicker = vi.fn();
    Object.defineProperty(HTMLInputElement.prototype, 'showPicker', { configurable: true, value: showPicker });
    try {
      const onPick = vi.fn();
      const onColorChange = vi.fn();
      const onColorPicking = vi.fn();
      render(
        <DecorPalette value={null} catalog={catalog} colors={{ 'desk-painted': '#c83c3c' }} onPick={onPick} onColorChange={onColorChange} onColorPicking={onColorPicking} preview={noPreview()} />,
      );

      // Its picked color, or its manifest default (a chair has one now, like the painted desk).
      await userEvent.click(screen.getByRole('button', { name: 'Escritorio pintado' }));
      await userEvent.click(screen.getByRole('button', { name: 'Silla gamer' }));
      expect(onColorChange.mock.calls).toEqual([
        ['desk-painted', '#c83c3c'],
        ['chair-gamer', '#d8433b'],
      ]);
      expect(onPick).not.toHaveBeenCalled();
      expect(showPicker).toHaveBeenCalledTimes(2);
      expect(onColorPicking).toHaveBeenCalledWith(true);

      // A tile that takes no color only picks, as ever.
      await userEvent.click(screen.getByRole('button', { name: 'Silla de madera' }));
      expect(onPick).toHaveBeenCalledTimes(1);
      expect(showPicker).toHaveBeenCalledTimes(2);
    } finally {
      Reflect.deleteProperty(HTMLInputElement.prototype, 'showPicker');
    }
  });

  it('offers only what fits a desk when asked: desk tables, never a room table (#116)', () => {
    render(<DecorPalette value={null} catalog={catalog} offers={fitsDeskArea} onPick={() => {}} preview={noPreview()} />);
    expect(screen.getByRole('group', { name: 'Escritorios' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Sala' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Sillas' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Mi espacio' })).toBeInTheDocument();
    // Doors open walls, which only an admin edits (#223); sofas furnish the office, not a desk.
    expect(screen.queryByRole('group', { name: 'Puertas' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Sofá/ })).not.toBeInTheDocument();
  });

  it('cuts every thumbnail from its sheet through the shared preview generator, both layers for a chair', async () => {
    const preview = noPreview();
    render(<DecorPalette value={null} catalog={catalog} onPick={() => {}} preview={preview} />);
    await waitFor(() => expect(preview.sheet).toHaveBeenCalledWith(catalog.table[0], null));
    const chair = screen.getByRole('button', { name: 'Silla gamer' });
    expect(chair.querySelectorAll('canvas')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Sofá de cuero (3 plazas)' }).querySelectorAll('canvas')).toHaveLength(2);
  });

  it('offers nothing while the catalog is unavailable, and disables everything while editing is', () => {
    const { unmount } = render(<DecorPalette value={null} catalog={null} onPick={() => {}} preview={noPreview()} />);
    expect(screen.queryAllByRole('group')).toEqual([]);
    expect(screen.queryAllByRole('button')).toEqual([]);
    unmount();

    render(<DecorPalette value={null} catalog={catalog} onPick={() => {}} preview={noPreview()} disabled />);
    expect(screen.getByRole('button', { name: 'Silla gamer' })).toBeDisabled();
    expect(screen.getByLabelText(/^Color de Escritorio pintado/)).toBeDisabled();
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
    expect(infoOf('door-wood-double')).toEqual({ kind: 'door', footprint: { w: 3, h: 1 } });
    expect(infoOf('table-nope')).toBeNull();
    expect(catalogDecorInfo(null)('chair-wood')).toBeNull();
  });
});
