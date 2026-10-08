import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CharacterOption } from '../auth/characterPort';
import { CharacterSelect } from './CharacterSelect';

const OPTIONS: CharacterOption[] = [
  { id: 'character-p01-burgundy-suit', name: 'Mateo', walkUrl: 'pack/p01-walk.png', seatedUrl: 'pack/p01-seated.png' },
  { id: 'character-p02-beige-blazer', name: 'Lucia', walkUrl: 'pack/p02-walk.png', seatedUrl: 'pack/p02-seated.png' },
  { id: 'character-p03-forest-suit', name: 'Diego', walkUrl: 'pack/p03-walk.png', seatedUrl: 'pack/p03-seated.png' },
];

function renderSelect(overrides: Partial<Parameters<typeof CharacterSelect>[0]> = {}) {
  const onSubmit = vi.fn();
  render(
    <CharacterSelect
      options={OPTIONS}
      initialId="character-p02-beige-blazer"
      pending={false}
      error={null}
      onSubmit={onSubmit}
      {...overrides}
    />,
  );
  return { onSubmit };
}

describe('CharacterSelect (art migration, step 5)', () => {
  it('offers every character as a labelled radio, with the initial one checked', () => {
    renderSelect();

    const group = screen.getByRole('radiogroup', { name: /elige tu personaje/i });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('radio', { name: 'Personaje 2' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Personaje 1' })).not.toBeChecked();
  });

  it('never shows or announces the manifest names, which stay internal', () => {
    const { container } = render(
      <CharacterSelect options={OPTIONS} initialId="character-p02-beige-blazer" pending={false} error={null} onSubmit={vi.fn()} />,
    );

    for (const name of ['Mateo', 'Lucia', 'Diego']) {
      expect(container).not.toHaveTextContent(name);
      expect(container.innerHTML).not.toContain(name);
    }
  });

  it('previews the selected character idle, walking and seated, from its own sheets', () => {
    renderSelect();

    const idle = screen.getByRole('img', { name: 'Personaje 2 en reposo' });
    const walking = screen.getByRole('img', { name: 'Personaje 2 caminando' });
    const seated = screen.getByRole('img', { name: 'Personaje 2 en su silla' });
    expect(idle.style.backgroundImage).toContain('pack/p02-walk.png');
    expect(walking.style.backgroundImage).toContain('pack/p02-walk.png');
    expect(seated.style.backgroundImage).toContain('pack/p02-seated.png');
    // Idle and walk come from the same sheet but different cells.
    expect(idle.style.backgroundPosition).not.toBe(walking.style.backgroundPosition);
  });

  it('picking another character moves the previews to it', async () => {
    const user = userEvent.setup();
    renderSelect();

    await user.click(screen.getByRole('radio', { name: 'Personaje 3' }));

    expect(screen.getByRole('radio', { name: 'Personaje 3' })).toBeChecked();
    expect(screen.getByRole('img', { name: 'Personaje 3 caminando' }).style.backgroundImage).toContain('pack/p03-walk.png');
  });

  it('works from the keyboard: arrows move the choice, Enter submits it', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderSelect();

    screen.getByRole('radio', { name: 'Personaje 2' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Personaje 3' })).toBeChecked();

    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledWith('character-p03-forest-suit');
  });

  it('the button submits the selected character', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderSelect();

    await user.click(screen.getByRole('button', { name: /entrar a la oficina/i }));

    expect(onSubmit).toHaveBeenCalledWith('character-p02-beige-blazer');
  });

  it('while saving the button is disabled and a second submit does nothing', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderSelect({ pending: true });

    const button = screen.getByRole('button', { name: /guardando/i });
    expect(button).toBeDisabled();
    screen.getByRole('radio', { name: 'Personaje 2' }).focus();
    await user.keyboard('{Enter}');

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows a rejected save as an alert', () => {
    renderSelect({ error: 'Ese personaje ya no está disponible. Elige otro.' });

    expect(screen.getByRole('alert')).toHaveTextContent('Ese personaje ya no está disponible. Elige otro.');
  });

  it('credits the author of a contributed character, and nothing for a pack one (#122)', async () => {
    const user = userEvent.setup();
    const contributed = { id: 'character-upload-0123456789abcdef', name: 'Rosa', walkUrl: 'u/a.png', seatedUrl: 'u/b.png', author: 'Ana' };
    render(<CharacterSelect options={[...OPTIONS, contributed]} initialId="character-p02-beige-blazer" pending={false} error={null} onSubmit={vi.fn()} />);

    expect(screen.queryByText(/Autoría/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Personaje 4' }));

    expect(screen.getByText('Autoría: Ana')).toBeInTheDocument();
  });
});
