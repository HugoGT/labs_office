import { fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BASE_CHARACTERS } from '../art/characters';
import { CHARACTER_TEMPLATES, HAIR_COLORS, SKIN_TONES, type CustomCharacterSpec } from '../art/customCharacter';
import type { CharacterChoice, CharacterOption } from '../auth/characterPort';
import { CharacterCreator, PREVIEW_SCALE, type CharacterCreatorProps } from './CharacterCreator';

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

type User = ReturnType<typeof userEvent.setup>;

async function pickStyle(user: User, section: string, trigger: RegExp, option: string): Promise<void> {
  await user.click(within(part(section)).getByRole('button', { name: trigger }));
  await user.click(screen.getByRole('menuitemradio', { name: option }));
}

async function pickPreset(user: User, section: string, trigger: RegExp, preset: string): Promise<void> {
  await user.click(within(part(section)).getByRole('button', { name: trigger }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: preset }));
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

  it('groups the parts in labelled sections, in order, each choice a picture button', () => {
    renderCreator();

    expect(screen.getByRole('heading', { name: 'Crea tu personaje' })).toBeInTheDocument();
    const order = ['Pelo', 'Piel', 'Superior', 'Inferior', 'Zapatos'];
    const sections = order.map((name) => part(name));
    sections.slice(1).forEach((section, index) => {
      expect(sections[index]!.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
    const lucia = CHARACTER_TEMPLATES[1]!.spec;
    expect(within(part('Pelo')).getByRole('button', { name: 'Estilo de pelo: Largo liso' })).toHaveAttribute('aria-haspopup', 'menu');
    expect(within(part('Pelo')).getByRole('button', { name: `Color de pelo: ${lucia.hair.color}` })).toHaveAttribute('aria-haspopup', 'dialog');
    const skin = SKIN_TONES.find((swatch) => swatch.hex === lucia.skin)!;
    expect(within(part('Piel')).getByRole('button', { name: `Tono de piel: ${skin.label}` })).toBeInTheDocument();
    expect(within(part('Superior')).getByRole('button', { name: 'Estilo de la parte superior: Blazer' })).toBeInTheDocument();
    expect(within(part('Superior')).getByRole('button', { name: /^Color de la parte superior: / })).toBeInTheDocument();
    expect(within(part('Superior')).getByRole('button', { name: 'Extras: Bolso' })).toBeInTheDocument();
    expect(within(part('Superior')).getByRole('button', { name: 'Lentes: Ninguno' })).toBeInTheDocument();
    expect(within(part('Inferior')).getByRole('button', { name: 'Estilo de la parte inferior: Pantalón ancho' })).toBeInTheDocument();
    expect(within(part('Inferior')).getByRole('button', { name: /^Color de la parte inferior: / })).toBeInTheDocument();
    expect(within(part('Zapatos')).getByRole('button', { name: 'Estilo de zapatos: Tacones' })).toBeInTheDocument();
    expect(within(part('Zapatos')).getByRole('button', { name: /^Color de zapatos: / })).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('offers no build, earrings or separate extras section', () => {
    renderCreator();

    expect(screen.queryByRole('group', { name: 'Extras' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByText('Aretes')).not.toBeInTheDocument();
    expect(screen.queryByText('Complexión')).not.toBeInTheDocument();
  });

  it('names the bottoms Jean, Pantalón ancho and Falda, and the lenses Ninguno, Lentes and Lentes de sol', async () => {
    const user = userEvent.setup();
    renderCreator();

    await user.click(within(part('Inferior')).getByRole('button', { name: /^Estilo de la parte inferior/ }));
    expect(screen.getAllByRole('menuitemradio').map((item) => item.getAttribute('aria-label'))).toEqual(['Jean', 'Pantalón ancho', 'Falda']);
    await user.keyboard('{Escape}');
    await user.click(within(part('Superior')).getByRole('button', { name: /^Lentes/ }));
    expect(screen.getAllByRole('menuitemradio').map((item) => item.getAttribute('aria-label'))).toEqual(['Ninguno', 'Lentes', 'Lentes de sol']);
  });

  it('opens on the saved pack character as a pressed template', () => {
    renderCreator();

    expect(screen.getByRole('button', { name: 'Plantilla 2' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Plantilla 1' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('a template used as is is saved as that pack character, so it keeps its exact art', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCreator();

    await user.click(screen.getByRole('button', { name: 'Plantilla 3' }));
    await user.click(screen.getByRole('button', { name: 'Entrar a la oficina' }));

    expect(submitted(onSubmit)).toEqual({ kind: 'piece', avatarId: PACK[2]!.id });
  });

  it('previews a piece standing still only, big, over the wood floor and without a caption', () => {
    renderCreator();

    const preview = screen.getByRole('region', { name: 'Vista previa' });
    const images = within(preview).getAllByRole('img');
    expect(images).toHaveLength(1);
    expect(images[0]).toHaveAccessibleName('Tu personaje');
    expect(images[0]!.style.backgroundImage).toContain('pack/p2-walk.png');
    expect(images[0]!.style.width).toBe(`${32 * PREVIEW_SCALE}px`);
    expect(preview).not.toHaveTextContent(/Reposo|Caminando|En su silla/);
    const floor = preview.querySelector<HTMLElement>('[data-floor]')!;
    expect(floor.style.backgroundImage).toContain('assets/pack/floor/wood.png');
    expect(floor.style.backgroundSize).toBe(`${96 * PREVIEW_SCALE}px ${96 * PREVIEW_SCALE}px`);
  });

  it('changing any part turns the template into a character of its own, previewed on canvas', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCreator();

    await pickStyle(user, 'Pelo', /^Estilo de pelo/, 'Coleta');
    await pickPreset(user, 'Pelo', /^Color de pelo/, HAIR_COLORS[4]!.label);
    await pickStyle(user, 'Superior', /^Lentes/, 'Lentes de sol');
    await pickStyle(user, 'Superior', /^Extras/, 'Ninguno');
    await pickStyle(user, 'Inferior', /^Estilo de la parte inferior/, 'Jean');

    expect(screen.getByRole('button', { name: 'Plantilla 2' })).toHaveAttribute('aria-pressed', 'false');
    const preview = screen.getByRole('region', { name: 'Vista previa' });
    const canvas = within(preview).getByRole('img', { name: 'Tu personaje' });
    expect(canvas.tagName).toBe('CANVAS');
    expect(canvas.style.width).toBe(`${32 * PREVIEW_SCALE}px`);

    await user.click(screen.getByRole('button', { name: 'Entrar a la oficina' }));
    const expected: CustomCharacterSpec = {
      ...CHARACTER_TEMPLATES[1]!.spec,
      hair: { style: 'ponytail', color: HAIR_COLORS[4]!.hex },
      glasses: 'sunglasses',
      accessory: 'none',
      bottom: { ...CHARACTER_TEMPLATES[1]!.spec.bottom, style: 'pants' },
    };
    // Build and earrings are not editable: the spread above keeps the template's.
    expect(submitted(onSubmit)).toEqual({ kind: 'custom', spec: expected });
  });

  it('takes any rgb color from the free picker', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCreator();

    await user.click(within(part('Zapatos')).getByRole('button', { name: /^Color de zapatos/ }));
    fireEvent.input(screen.getByLabelText('Otro color'), { target: { value: '#12AB34' } });
    await user.keyboard('{Escape}');

    expect(within(part('Zapatos')).getByRole('button', { name: 'Color de zapatos: #12ab34' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Entrar a la oficina' }));
    const template = CHARACTER_TEMPLATES[1]!.spec;
    expect(submitted(onSubmit)).toEqual({ kind: 'custom', spec: { ...template, shoes: { ...template.shoes, color: '#12ab34' } } });
  });

  it('reopens a custom character with its parts and saves it unchanged', async () => {
    const user = userEvent.setup();
    const spec: CustomCharacterSpec = { ...CHARACTER_TEMPLATES[4]!.spec, build: 'broad', earrings: true };
    const { onSubmit } = renderCreator({ initial: { kind: 'custom', spec } });

    expect(within(part('Superior')).getByRole('button', { name: 'Estilo de la parte superior: Traje con corbata' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Plantilla 5' })).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'Entrar a la oficina' }));

    expect(submitted(onSubmit)).toEqual({ kind: 'custom', spec });
  });

  it('keeps the build and earrings it cannot edit when another part changes', async () => {
    const user = userEvent.setup();
    const spec: CustomCharacterSpec = { ...CHARACTER_TEMPLATES[4]!.spec, build: 'broad', earrings: true };
    const { onSubmit } = renderCreator({ initial: { kind: 'custom', spec } });

    await pickStyle(user, 'Zapatos', /^Estilo de zapatos/, 'Tacones');
    await user.click(screen.getByRole('button', { name: 'Entrar a la oficina' }));

    expect(submitted(onSubmit)).toEqual({ kind: 'custom', spec: { ...spec, shoes: { ...spec.shoes, style: 'heels' } } });
  });

  it('a template brings its own build and earrings', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCreator();

    await user.click(screen.getByRole('button', { name: 'Plantilla 5' }));
    await pickStyle(user, 'Superior', /^Lentes/, 'Ninguno');
    await user.click(screen.getByRole('button', { name: 'Entrar a la oficina' }));

    const template = CHARACTER_TEMPLATES[4]!.spec;
    expect(submitted(onSubmit)).toEqual({ kind: 'custom', spec: { ...template, glasses: 'none' } });
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
