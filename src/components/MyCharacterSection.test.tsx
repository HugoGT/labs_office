import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHARACTER_TEMPLATES } from '../art/customCharacter';
import type { CharacterChoice, CharacterPort, ReadCharacterResult, SaveCharacterResult } from '../auth/characterPort';
import { MyCharacterSection } from './MyCharacterSection';

const SPEC = CHARACTER_TEMPLATES[2]!.spec;
const OPTIONS = [
  { id: 'character-p01-burgundy-suit', name: 'Mateo', walkUrl: 'w1.png', seatedUrl: 's1.png' },
  { id: 'character-p02-beige-blazer', name: 'Lucia', walkUrl: 'w2.png', seatedUrl: 's2.png' },
];

function fakePort(read: ReadCharacterResult, save?: (choice: CharacterChoice) => Promise<SaveCharacterResult>): CharacterPort {
  return {
    read: vi.fn(async () => read),
    save: vi.fn(save ?? (async () => ({ outcome: 'ok' as const, avatarId: 'character-custom-x', spec: SPEC }))),
    catalog: vi.fn(async () => ({ defaultId: OPTIONS[0]!.id, options: OPTIONS })),
  };
}

describe('MyCharacterSection', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens the creator as a dialog prefilled with the saved custom character', async () => {
    render(<MyCharacterSection character={fakePort({ outcome: 'ok', avatarId: 'character-custom-x', chosen: true, spec: SPEC })} onClose={vi.fn()} />);

    const dialog = await screen.findByRole('dialog', { name: 'Mi personaje' });
    const top = within(dialog).getByRole('group', { name: 'Parte superior' });
    expect(within(top).getByRole('radio', { name: 'Traje con corbata' })).toBeChecked();
  });

  it('opens on a saved pack character as its pressed template', async () => {
    render(<MyCharacterSection character={fakePort({ outcome: 'ok', avatarId: OPTIONS[1]!.id, chosen: true })} onClose={vi.fn()} />);

    expect(await screen.findByRole('button', { name: 'Plantilla 2' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('saves through the same port and says the office already shows it', async () => {
    const user = userEvent.setup();
    let stored: ReadCharacterResult = { outcome: 'ok', avatarId: 'character-custom-x', chosen: true, spec: SPEC };
    const port = fakePort(stored, async (choice) => {
      if (choice.kind === 'custom') stored = { outcome: 'ok', avatarId: 'character-custom-y', chosen: true, spec: choice.spec };
      return { outcome: 'ok', avatarId: 'character-custom-y' };
    });
    port.read = vi.fn(async () => stored);
    render(<MyCharacterSection character={port} onClose={vi.fn()} />);

    const dialog = await screen.findByRole('dialog', { name: 'Mi personaje' });
    await user.click(within(dialog).getByRole('checkbox', { name: 'Gafas' }));
    await user.click(within(dialog).getByRole('button', { name: 'Guardar personaje' }));

    expect(port.save).toHaveBeenCalledWith({ kind: 'custom', spec: { ...SPEC, glasses: !SPEC.glasses } });
    expect(await screen.findByRole('status')).toHaveTextContent('Personaje guardado. Ya te ven así en la oficina.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Editar de nuevo' }));
    const again = await screen.findByRole('dialog', { name: 'Mi personaje' });
    expect(within(again).getByRole('checkbox', { name: 'Gafas' })).toBeChecked();
    expect(port.read).toHaveBeenCalledTimes(2);
  });

  it('a rejected save keeps the dialog open with a readable error', async () => {
    const user = userEvent.setup();
    const port = fakePort({ outcome: 'ok', avatarId: 'character-custom-x', chosen: true, spec: SPEC }, async () => ({
      outcome: 'invalid',
      reason: 'invalid-spec',
    }));
    render(<MyCharacterSection character={port} onClose={vi.fn()} />);

    const dialog = await screen.findByRole('dialog', { name: 'Mi personaje' });
    await user.click(within(dialog).getByRole('button', { name: 'Guardar personaje' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Esa combinación no está disponible. Revisa las opciones.');
  });

  it('cancelling (or Escape) leaves without saving', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const port = fakePort({ outcome: 'ok', avatarId: OPTIONS[0]!.id, chosen: true });
    render(<MyCharacterSection character={port} onClose={onClose} />);

    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(port.save).not.toHaveBeenCalled();
  });

  it('keeps keys pressed inside the dialog away from the office behind it', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    try {
      render(<MyCharacterSection character={fakePort({ outcome: 'ok', avatarId: OPTIONS[0]!.id, chosen: true })} onClose={onClose} />);
      const dialog = await screen.findByRole('dialog');
      within(dialog).getByRole('checkbox', { name: 'Gafas' }).focus();

      await user.keyboard('{ArrowLeft}');
      await user.keyboard('{Escape}');

      expect(onWindowKey).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', onWindowKey);
    }
  });

  it('says so when the saved character cannot be read', async () => {
    render(<MyCharacterSection character={fakePort({ outcome: 'failed' })} onClose={vi.fn()} />);

    expect(await screen.findByText('No se pudo cargar tu personaje. Inténtalo de nuevo más tarde.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
