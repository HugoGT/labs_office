import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import exportedManifest from '../../public/assets/pack/manifest.json?raw';
import type { ArtAppearance } from '../game/artPack';
import { materialCatalogFrom } from '../game/artMaterials';
import type { ArtPreviewCache } from '../game/artPreview';
import { ArtMaterialPicker } from './ArtMaterialPicker';

const catalog = materialCatalogFrom(JSON.parse(exportedManifest), 'assets/pack/manifest.json')!;

function noPreview(): ArtPreviewCache {
  return { sheet: vi.fn(async () => null) };
}

function Harness({
  initial,
  kind = 'desk',
  onChange = () => {},
  preview = noPreview(),
}: {
  initial: ArtAppearance;
  kind?: 'desk' | 'floor';
  onChange?: (next: ArtAppearance) => void;
  preview?: ArtPreviewCache;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ArtMaterialPicker
      id="new-desk"
      legend="Aspecto"
      options={kind === 'desk' ? catalog.desk : catalog.floor}
      value={value}
      preview={preview}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe('ArtMaterialPicker (art step 7)', () => {
  it('offers every material of the catalog by its Spanish name, under an accessible label', () => {
    render(<Harness initial={{ materialId: 'desk-wood', color: null }} />);

    const select = screen.getByLabelText('Material');
    expect(screen.getByRole('group', { name: 'Aspecto' })).toBeInTheDocument();
    expect(select).toHaveValue('desk-wood');
    expect(Array.from((select as HTMLSelectElement).options).map((option) => option.textContent)).toEqual(
      catalog.desk.map((option) => option.name),
    );
  });

  it('a material with its own look shows no color picker', () => {
    render(<Harness initial={{ materialId: 'desk-glass', color: null }} />);

    expect(screen.queryByLabelText('Color')).not.toBeInTheDocument();
    expect(screen.getByText('Este material conserva su propio aspecto.')).toBeInTheDocument();
  });

  it('picking the painted desk shows its color picker in the default color', async () => {
    const onChange = vi.fn();
    render(<Harness initial={{ materialId: 'desk-wood', color: null }} onChange={onChange} />);

    await userEvent.selectOptions(screen.getByLabelText('Material'), 'desk-painted');

    expect(onChange).toHaveBeenLastCalledWith({ materialId: 'desk-painted', color: '#4f9a8a' });
    expect(screen.getByLabelText('Color')).toHaveValue('#4f9a8a');
  });

  it('changing the color reports it, and leaving the colorable material drops it', async () => {
    const onChange = vi.fn();
    render(<Harness initial={{ materialId: 'floor-plain', color: '#b9c3cc' }} kind="floor" onChange={onChange} />);

    // A color input cannot be typed into; `input` is how the browser reports a pick.
    fireEvent.input(screen.getByLabelText('Color'), { target: { value: '#2C3E50' } });
    expect(onChange).toHaveBeenLastCalledWith({ materialId: 'floor-plain', color: '#2c3e50' });

    await userEvent.selectOptions(screen.getByLabelText('Material'), 'floor-grass');
    expect(onChange).toHaveBeenLastCalledWith({ materialId: 'floor-grass', color: null });
  });

  it('asks the shared preview generator for the chosen material and color', async () => {
    const preview = noPreview();
    render(<Harness initial={{ materialId: 'desk-painted', color: '#c0392b' }} preview={preview} />);

    await waitFor(() =>
      expect(preview.sheet).toHaveBeenCalledWith(expect.objectContaining({ id: 'desk-painted' }), '#c0392b'),
    );
    expect(screen.getByRole('img', { name: 'Vista previa: Escritorio pintado, #c0392b' })).toBeInTheDocument();
  });

  it('says that the choice cannot be changed after creating', () => {
    render(<Harness initial={{ materialId: 'desk-wood', color: null }} />);

    expect(screen.getByText('El material y el color no se pueden cambiar después de crear.')).toBeInTheDocument();
  });
});
