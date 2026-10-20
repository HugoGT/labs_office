import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CHARACTER_TEMPLATES } from '../art/customCharacter';
import { CharacterCreator } from './CharacterCreator';

/**
 * Browser layer: the live preview really draws the shared renderer's frames
 * on a 2D canvas, which jsdom cannot show.
 */

function opaquePixels(canvas: HTMLCanvasElement): number {
  const context = canvas.getContext('2d');
  if (context === null) return 0;
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let count = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) count += 1;
  return count;
}

describe('CharacterCreator in a browser', () => {
  it('draws the character being built on its preview canvases and redraws it after a change', async () => {
    const user = userEvent.setup();
    render(
      <CharacterCreator
        heading="Crea tu personaje"
        description=""
        options={[]}
        initial={{ kind: 'custom', spec: CHARACTER_TEMPLATES[0]!.spec }}
        pending={false}
        error={null}
        submitLabel="Entrar a la oficina"
        onSubmit={vi.fn()}
      />,
    );

    const preview = screen.getByRole('region', { name: 'Vista previa' });
    const idle = within(preview).getByRole('img', { name: 'Tu personaje en reposo' }) as HTMLCanvasElement;
    const seated = within(preview).getByRole('img', { name: 'Tu personaje en su silla' }) as HTMLCanvasElement;
    await vi.waitFor(() => expect(opaquePixels(idle)).toBeGreaterThan(100));
    expect(opaquePixels(seated)).toBeGreaterThan(100);
    const before = idle.getContext('2d')!.getImageData(0, 0, idle.width, idle.height).data.slice();

    await user.click(within(screen.getByRole('group', { name: 'Parte superior' })).getByRole('radio', { name: 'Blanco' }));

    await vi.waitFor(() => {
      const after = idle.getContext('2d')!.getImageData(0, 0, idle.width, idle.height).data;
      expect(after).not.toEqual(before);
    });
  });
});
