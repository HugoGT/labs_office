import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import exportedManifest from '../../public/assets/pack/manifest.json?raw';
import { materialCatalogFrom } from '../game/artMaterials';
import type { ArtPreviewCache } from '../game/artPreview';
import { ArtPreviewCanvas } from './ArtPreviewCanvas';

const catalog = materialCatalogFrom(JSON.parse(exportedManifest), 'assets/pack/manifest.json')!;
const grass = catalog.floor.find((option) => option.id === 'floor-grass')!;

describe('ArtPreviewCanvas', () => {
  it('asks the shared preview generator for the sheet and sizes the canvas to the frame, one sheet pixel per CSS pixel', async () => {
    const preview: ArtPreviewCache = { sheet: vi.fn(async () => null) };
    render(<ArtPreviewCanvas option={grass} color={null} frame={{ x: 0, y: 0, width: 48, height: 40 }} label="Césped" preview={preview} />);

    const canvas = screen.getByRole('img', { name: 'Césped' }) as HTMLCanvasElement;
    expect(canvas.width).toBe(48);
    expect(canvas.height).toBe(40);
    expect(canvas.style.width).toBe('48px');
    await waitFor(() => expect(preview.sheet).toHaveBeenCalledWith(grass, null));
  });

  it('copies the frame of the loaded sheet onto the canvas', async () => {
    const sheet = { width: 96, height: 96 } as unknown as HTMLCanvasElement;
    const preview: ArtPreviewCache = { sheet: vi.fn(async () => sheet) };
    const drawImage = vi.fn();
    const clearRect = vi.fn();
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage, clearRect, imageSmoothingEnabled: true } as never);
    try {
      render(<ArtPreviewCanvas option={grass} color={null} frame={{ x: 8, y: 16, width: 32, height: 32 }} label="Césped" preview={preview} />);

      await waitFor(() => expect(drawImage).toHaveBeenCalledWith(sheet, 8, 16, 32, 32, 0, 0, 32, 32));
    } finally {
      getContext.mockRestore();
    }
  });
});
