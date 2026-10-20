import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BASE_CHARACTERS } from '../art/characters';
import { CHARACTER_TEMPLATES, HAIR_COLORS, SKIN_TONES, type CustomCharacterSpec } from '../art/customCharacter';
import type { CharacterChoice, CharacterOption } from '../auth/characterPort';
import { CharacterCreator, type CharacterCreatorProps } from './CharacterCreator';

/** The pack characters (the templates) plus one uploaded whole character. */
const PACK: CharacterOption[] = BASE_CHARACTERS.map((base, index) => ({
  id: `character-${base.id}`,
  name: base.name,
  walkUrl: `pack/p${index + 1}-walk.png`,
  seatedUrl: `pack/p${index + 1}-seated.png`,
}));
const UPLOADED: CharacterOption = {
  id: 'character-upload-0123456789abcdef',
  name: 'Robot',
  walkUrl: 'files/robot-walk.png',
  seatedUrl: 'files/robot-seated.png',
  author: 'Bea',
};
const OPTIONS = [...PACK, UPLOADED];
const LUCIA = PACK[1]!.id;

function renderCreator(overrides: Partial<CharacterCreatorProps> = {}) {
  const onSubmit = vi.fn<(choice: CharacterChoice) => void>();
  const utils = render(
    <CharacterCreator
      heading="Crea tu personaje"
      description="Así te verán tus compañeros en la oficina."
      options={OPTIONS}
      initial={{ kind: 'piece', avatarId: LUCIA }}
      pending={false}
      error={null}
      submitLabel="Entrar a la oficina"
      onSubmit={onSubmit}
      {...overrides}
    />,
  );
  return { onSubmit, ...utils };
}

function part(name: string) {
  return screen.getByRole('group', { name });
}

function submitted(onSubmit: ReturnType<typeof renderCreator>['onSubmit']): CharacterChoice {
  expect(onSubmit).toHaveBeenCalledTimes(1);
  return onSubmit.mock.calls[0]![0];
}

describe('CharacterCreator', () => {
  // jsdom has no 2D canvas: the preview keeps its labelled, sized canvas and draws nothing.
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('groups the parts in labelled sections', () => {
    renderCreator();

    expect(screen.getByRole('heading', { name: 'Crea tu personaje' })).toBeInTheDocument();
    for (const name of ['Piel', 'Pelo', 'Parte superior', 'Parte inferior', 'Zapatos', 'Extras']) {
      expect(part(name)).toBeInTheDocument();
    }
    expect(within(part('Pelo')).getByRole('group', { name: 'Estilo' })).toBeInTheDocument();
    expect(within(part('Pelo')).getByRole('group', { name: 'Color' })).toBeInTheDocument();
    expect(within(part('Extras')).getByRole('checkbox', { name: 'Gafas' })).toBeInTheDocument();
    expect(within(part('Extras')).getByRole('checkbox', { name: 'Aretes' })).toBeInTheDocument();
    expect(within(part('Extras')).getByRole('group', { name: 'Accesorio' })).toBeInTheDocument();
    expect(within(part('Extras')).getByRole('group', { name: 'Complexión' })).toBeInTheDocument();
  });

  it('opens on the saved pack character as a pressed template, with its parts in the controls', () => {
    renderCreator();

    expect(screen.getByRole('button', { name: 'Plantilla 2' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Plantilla 1' })).toHaveAttribute('aria-pressed', 'false');
    const lucia = CHARACTER_TEMPLATES[1]!.spec;
    expect(within(part('Pelo')).getByRole('radio', { name: 'Largo liso' })).toBeChecked();
    expect(within(part('Parte superior')).getByRole('radio', { name: 'Blazer' })).toBeChecked();
    const skin = SKIN_TONES.find((swatch) => swatch.hex === lucia.skin)!;
    expect(within(part('Piel')).getByRole('radio', { name: skin.label })).toBeChecked();
  });

  it('a template used as is is saved as that pack character, so it keeps its exact art', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCreator();

    await user.click(screen.getByRole('button', { name: 'Plantilla 3' }));
    await user.click(screen.getByRole('button', { name: 'Entrar a la oficina' }));

    expect(submitted(onSubmit)).toEqual({ kind: 'piece', avatarId: PACK[2]!.id });
  });

  it('previews a piece from its own sheets idle, walking and seated', () => {
    renderCreator();

    const preview = screen.getByRole('region', { name: 'Vista previa' });
    expect(within(preview).getByRole('img', { name: 'Tu personaje en reposo' }).style.backgroundImage).toContain('pack/p2-walk.png');
    expect(within(preview).getByRole('img', { name: 'Tu personaje caminando' }).style.backgroundImage).toContain('pack/p2-walk.png');
    expect(within(preview).getByRole('img', { name: 'Tu personaje en su silla' }).style.backgroundImage).toContain('pack/p2-seated.png');
  });

  it('changing any part turns the template into a character of its own, previewed on canvas', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCreator();

    await user.click(within(part('Pelo')).getByRole('radio', { name: 'Coleta' }));
    await user.click(within(within(part('Pelo')).getByRole('group', { name: 'Color' })).getByRole('radio', { name: HAIR_COLORS[4]!.label }));
    await user.click(within(part('Extras')).getByRole('checkbox', { name: 'Gafas' }));
    await user.click(within(part('Extras')).getByRole('radio', { name: 'Ninguno' }));

    expect(screen.getByRole('button', { name: 'Plantilla 2' })).toHaveAttribute('aria-pressed', 'false');
    const preview = screen.getByRole('region', { name: 'Vista previa' });
    expect(within(preview).getByRole('img', { name: 'Tu personaje caminando' }).tagName).toBe('CANVAS');

    await user.click(screen.getByRole('button', { name: 'Entrar a la oficina' }));
    const expected: CustomCharacterSpec = {
      ...CHARACTER_TEMPLATES[1]!.spec,
      hair: { style: 'ponytail', color: HAIR_COLORS[4]!.hex },
      glasses: 'glasses',
      accessory: 'none',
    };
    expect(submitted(onSubmit)).toEqual({ kind: 'custom', spec: expected });
  });

  it('reopens a custom character with its parts and saves it unchanged', async () => {
    const user = userEvent.setup();
    const spec: CustomCharacterSpec = { ...CHARACTER_TEMPLATES[4]!.spec, build: 'broad', earrings: true };
    const { onSubmit } = renderCreator({ initial: { kind: 'custom', spec } });

    expect(within(part('Extras')).getByRole('radio', { name: 'Robusta' })).toBeChecked();
    expect(within(part('Extras')).getByRole('checkbox', { name: 'Aretes' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Plantilla 5' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'Entrar a la oficina' }));

    expect(submitted(onSubmit)).toEqual({ kind: 'custom', spec });
  });

  it('offers uploaded characters apart, as whole characters with their credit', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCreator();

    const whole = screen.getByRole('region', { name: 'Personajes completos' });
    expect(within(whole).getAllByRole('button')).toHaveLength(1);
    await user.click(within(whole).getByRole('button', { name: 'Personaje completo 1' }));

    expect(within(whole).getByRole('button', { name: 'Personaje completo 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Autoría: Bea')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Entrar a la oficina' }));
    expect(submitted(onSubmit)).toEqual({ kind: 'piece', avatarId: UPLOADED.id });
  });

  it('has no whole characters section when nobody uploaded one', () => {
    renderCreator({ options: PACK });

    expect(screen.queryByRole('region', { name: 'Personajes completos' })).not.toBeInTheDocument();
  });

  it('never shows or announces the manifest names, which stay internal', () => {
    const { container } = renderCreator();

    for (const name of ['Mateo', 'Lucia', 'Robot']) {
      expect(container).not.toHaveTextContent(name);
      expect(container.innerHTML).not.toContain(name);
    }
  });

  it('shows the save in flight and a rejected save', () => {
    renderCreator({ pending: true, error: 'Esa combinación no está disponible. Revisa las opciones.' });

    expect(screen.getByRole('button', { name: 'Guardando…' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Esa combinación no está disponible.');
  });

  it('offers a way back only when the caller can cancel', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderCreator();
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();

    renderCreator({ onCancel });
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
