import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import * as vitestBrowser from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../index.css';
import { BASE_CHARACTERS } from '../art/characters';
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

// Typed by hand like `HudLayout.browser.test.tsx`: the provider's `page` is not in the
// package's public types.
const { page } = vitestBrowser as unknown as { page: { viewport(width: number, height: number): Promise<void> } };

// The browser project has no global Testing Library cleanup (`src/test/setup.ts` is jsdom's).
afterEach(() => cleanup());

describe('CharacterCreator in a browser', () => {
  it('draws the character being built on its preview canvas and redraws it after a change', async () => {
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
    const idle = within(preview).getByRole('img', { name: 'Tu personaje' }) as HTMLCanvasElement;
    await vi.waitFor(() => expect(opaquePixels(idle)).toBeGreaterThan(100));
    const before = idle.getContext('2d')!.getImageData(0, 0, idle.width, idle.height).data.slice();

    await user.click(within(screen.getByRole('group', { name: 'Superior' })).getByRole('button', { name: /^Color de la parte superior/ }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Blanco' }));

    await vi.waitFor(() => {
      const after = idle.getContext('2d')!.getImageData(0, 0, idle.width, idle.height).data;
      expect(after).not.toEqual(before);
    });
  });
});

const PACK_OPTIONS = BASE_CHARACTERS.map((base) => ({
  id: `character-${base.id}`,
  name: base.name,
  walkUrl: `/assets/pack/character/${base.id}-walk.png`,
  seatedUrl: `/assets/pack/character/${base.id}-seated.png`,
}));
const UPLOADED = { ...PACK_OPTIONS[3]!, id: 'character-upload-0123456789abcdef', author: 'Bea' };

function noVerticalScroll(): void {
  const card = document.querySelector('form')!;
  const screenBox = card.parentElement!;
  expect(card.scrollHeight).toBeLessThanOrEqual(card.clientHeight);
  expect(screenBox.scrollHeight).toBeLessThanOrEqual(screenBox.clientHeight);
  expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(window.innerHeight);
}

function insideViewport(element: Element): void {
  const box = element.getBoundingClientRect();
  expect(box.top).toBeGreaterThanOrEqual(0);
  expect(box.left).toBeGreaterThanOrEqual(0);
  expect(box.bottom).toBeLessThanOrEqual(window.innerHeight);
  expect(box.right).toBeLessThanOrEqual(window.innerWidth);
}

describe('CharacterCreator fits one screen', () => {
  afterEach(async () => {
    await page.viewport(414, 896);
  });

  it.each([
    [1280, 720],
    [1920, 1080],
  ])('at %ix%i, with uploaded characters too, nothing scrolls and every popover stays on screen', async (width, height) => {
    await page.viewport(width, height);
    const user = userEvent.setup();
    render(
      <CharacterCreator
        heading="Crea tu personaje"
        description="Así te verán tus compañeros en la oficina."
        options={[...PACK_OPTIONS, UPLOADED]}
        initial={{ kind: 'custom', spec: CHARACTER_TEMPLATES[1]!.spec }}
        pending={false}
        error={null}
        submitLabel="Entrar a la oficina"
        onSubmit={vi.fn()}
      />,
    );

    noVerticalScroll();
    await user.click(within(screen.getByRole('group', { name: 'Zapatos' })).getByRole('button', { name: /^Estilo de zapatos/ }));
    insideViewport(screen.getByRole('menu'));
    noVerticalScroll();
    await user.keyboard('{Escape}');
    await user.click(within(screen.getByRole('group', { name: 'Zapatos' })).getByRole('button', { name: /^Color de zapatos/ }));
    insideViewport(screen.getByRole('dialog'));
    noVerticalScroll();
  });
});
