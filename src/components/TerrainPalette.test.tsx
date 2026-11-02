import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import exportedManifest from '../../public/assets/pack/manifest.json?raw';
import { materialCatalogFrom } from '../game/artMaterials';
import type { ArtPreviewCache } from '../game/artPreview';
import { TerrainPalette, WallEraser, WallPalette } from './TerrainPalette';

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
    const buttons = Array.from(group.querySelectorAll('button[aria-pressed]'));
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

  it('gives carpet, and only carpet, a color picker starting at its pack default, and reports the chosen color (#222)', async () => {
    const onColorChange = vi.fn();
    render(<TerrainPalette value={null} onPick={() => {}} floors={catalog.floor} preview={noPreview()} onColorChange={onColorChange} />);

    const pickers = screen.getAllByRole('button', { name: /^Color de / });
    expect(pickers).toHaveLength(1);
    expect(pickers[0]).toHaveAccessibleName('Color de Moqueta: Por defecto');

    await userEvent.click(pickers[0]!);
    expect(screen.getByRole('button', { name: 'Por defecto' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Rojo' }));

    expect(onColorChange.mock.calls).toEqual([['carpet', '#c0392b']]);
  });

  it('shows the chosen carpet color on its picker and thumbnail (#222)', async () => {
    const preview = noPreview();
    render(<TerrainPalette value={null} onPick={() => {}} floors={catalog.floor} preview={preview} colors={{ carpet: '#3c6ac8' }} />);

    expect(screen.getByRole('button', { name: 'Color de Moqueta: Azul' })).toBeInTheDocument();
    await waitFor(() => expect(preview.sheet).toHaveBeenCalledWith(expect.objectContaining({ id: 'floor-carpet' }), '#3c6ac8'));
    expect(preview.sheet).toHaveBeenCalledWith(expect.objectContaining({ id: 'floor-grass' }), null);
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

describe('TerrainPalette: uploaded floors (S13)', () => {
  const PIECE = 'floor-upload-0123456789abcdef';
  const OTHER_PIECE = 'floor-upload-fedcba9876543210';
  const wood = catalog.floor.find((option) => option.id === 'floor-wood')!;
  const upload = (id: string, name: string) => ({ ...wood, id, name });
  const floors = [...catalog.floor, upload(PIECE, 'Parquet gris'), upload(OTHER_PIECE, 'Mármol')];
  const BUILT_IN = NAMES.slice(0, -1);

  it('appends each approved uploaded floor by its name after the built-in floors, the void eraser staying last', () => {
    render(<TerrainPalette value={null} onPick={() => {}} floors={floors} preview={noPreview()} />);

    const buttons = Array.from(screen.getByRole('group', { name: 'Suelos' }).querySelectorAll('button[aria-pressed]'));
    expect(buttons.map((button) => button.textContent)).toEqual([...BUILT_IN, 'Parquet gris', 'Mármol', 'Vacío']);
    expect(buttons.every((button) => button.getAttribute('aria-pressed') === 'false')).toBe(true);
  });

  it('offers no entry for the built-in floors again, nor for a floor that is not an upload', () => {
    const stray = upload('floor-unknown', 'Raro');
    render(<TerrainPalette value={null} onPick={() => {}} floors={[...catalog.floor, stray]} preview={noPreview()} />);

    const buttons = Array.from(screen.getByRole('group', { name: 'Suelos' }).querySelectorAll('button[aria-pressed]'));
    expect(buttons.map((button) => button.textContent)).toEqual(NAMES);
  });

  it('leaves a retired uploaded floor out: painted terrain keeps it, the palette no longer offers it (#264)', () => {
    render(<TerrainPalette value={null} onPick={() => {}} floors={[...floors, { ...upload('floor-upload-1111111111111111', 'Suelo prueba'), retired: true }]} preview={noPreview()} />);

    const buttons = Array.from(screen.getByRole('group', { name: 'Suelos' }).querySelectorAll('button[aria-pressed]'));
    expect(buttons.map((button) => button.textContent)).toEqual([...BUILT_IN, 'Parquet gris', 'Mármol', 'Vacío']);
  });

  it('reports the piece of a click on an uploaded floor and not a material, and the built-ins still report theirs', async () => {
    const onPick = vi.fn();
    const onPickFloor = vi.fn();
    render(<TerrainPalette value={null} onPick={onPick} onPickFloor={onPickFloor} floors={floors} preview={noPreview()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Mármol' }));
    await userEvent.click(screen.getByRole('button', { name: 'Madera' }));

    expect(onPickFloor.mock.calls).toEqual([[OTHER_PIECE]]);
    expect(onPick.mock.calls).toEqual([['wood']]);
  });

  it('presses only the exact piece picked, and wood stays pressed only for the plain wood brush', () => {
    const { rerender } = render(<TerrainPalette value={{ kind: 'floor', material: 'wood', floor: PIECE }} onPick={() => {}} floors={floors} preview={noPreview()} />);

    expect(screen.getByRole('button', { name: 'Parquet gris' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Mármol' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Madera' })).toHaveAttribute('aria-pressed', 'false');

    rerender(<TerrainPalette value={{ kind: 'floor', material: 'wood' }} onPick={() => {}} floors={floors} preview={noPreview()} />);
    expect(screen.getByRole('button', { name: 'Madera' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Parquet gris' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('cuts the thumbnail of an uploaded floor from its own sheet, uncolored, and has no color picker for it', async () => {
    const preview = noPreview();
    render(<TerrainPalette value={null} onPick={() => {}} floors={floors} preview={preview} />);

    await waitFor(() => expect(preview.sheet).toHaveBeenCalledWith(expect.objectContaining({ id: PIECE }), null));
    expect(screen.getAllByRole('button', { name: /^Color de / })).toHaveLength(1);
  });

  it('disables the uploaded entries with the rest', () => {
    render(<TerrainPalette value={null} onPick={() => {}} floors={floors} preview={noPreview()} disabled />);

    expect(screen.getByRole('button', { name: 'Parquet gris' })).toBeDisabled();
  });
});

describe('WallPalette', () => {
  const WALL_NAMES = ['Ladrillo', 'Piedra', 'Yeso', 'Vidrio'];

  it('offers every wall by its Spanish name, as title and accessible name but no text, and no eraser, none pressed while a floor or nothing is picked', () => {
    const { rerender } = render(<WallPalette value={null} onPick={() => {}} walls={catalog.wall} preview={noPreview()} />);

    const group = screen.getByRole('group', { name: 'Paredes' });
    const buttons = Array.from(group.querySelectorAll('button'));
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(WALL_NAMES);
    expect(buttons.map((button) => button.getAttribute('title'))).toEqual(WALL_NAMES);
    expect(buttons.map((button) => button.textContent)).toEqual(WALL_NAMES.map(() => ''));
    expect(buttons.every((button) => button.getAttribute('aria-pressed') === 'false')).toBe(true);

    expect(screen.queryByRole('button', { name: 'Borrador' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quitar pared' })).not.toBeInTheDocument();

    rerender(<WallPalette value={{ kind: 'floor', material: 'void' }} onPick={() => {}} walls={catalog.wall} preview={noPreview()} />);
    expect(screen.getAllByRole('button').every((button) => button.getAttribute('aria-pressed') === 'false')).toBe(true);
  });

  it('marks the picked wall as pressed and reports every click', async () => {
    const onPick = vi.fn();
    const { rerender } = render(<WallPalette value={{ kind: 'wall', piece: 'wall-stone' }} onPick={onPick} walls={catalog.wall} preview={noPreview()} />);

    expect(screen.getByRole('button', { name: 'Piedra' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Vidrio' }));
    expect(onPick.mock.calls).toEqual([['wall-glass']]);

    // The wall eraser picked is no wall of this palette.
    rerender(<WallPalette value={{ kind: 'wall', piece: null }} onPick={onPick} walls={catalog.wall} preview={noPreview()} />);
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

describe('WallEraser (#223)', () => {
  it('is one small button, «⛔ Borrador», named «Borrador» in its tooltip and accessible name', () => {
    render(<WallEraser value={null} onPick={() => {}} />);

    const button = screen.getByRole('button', { name: 'Borrador' });
    expect(button).toHaveTextContent(/^\u26D4 Borrador$/);
    expect(button).toHaveAttribute('title', 'Borrador');
    expect(button).not.toHaveAttribute('aria-label');
    // The sign is decorative: the name is the word.
    expect(button.querySelector('[aria-hidden="true"]')).toHaveTextContent('\u26D4');
    expect(button.textContent).not.toMatch(/Quitar|Goma|pared/);
  });

  it('is pressed only while the wall eraser is picked, and reports its click as no wall', async () => {
    const onPick = vi.fn();
    const { rerender } = render(<WallEraser value={{ kind: 'wall', piece: 'wall-stone' }} onPick={onPick} />);
    expect(screen.getByRole('button', { name: 'Borrador' })).toHaveAttribute('aria-pressed', 'false');
    rerender(<WallEraser value={{ kind: 'floor', material: 'void' }} onPick={onPick} />);
    expect(screen.getByRole('button', { name: 'Borrador' })).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(screen.getByRole('button', { name: 'Borrador' }));
    expect(onPick.mock.calls).toEqual([[null]]);

    rerender(<WallEraser value={{ kind: 'wall', piece: null }} onPick={onPick} />);
    expect(screen.getByRole('button', { name: 'Borrador' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('can be disabled', () => {
    render(<WallEraser value={null} onPick={() => {}} disabled />);
    expect(screen.getByRole('button', { name: 'Borrador' })).toBeDisabled();
  });
});
