import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WALK_DIRECTIONS } from '../game/artContract';
import { MOCK_DEFAULTS, WALK_CAPTIONS } from '../game/artMock';
import { ArtOfficeMock } from './ArtOfficeMock';

const characterImages = { walk: 'data:walk', seated: 'data:seated' };

function block(name: string): HTMLElement {
  return screen.getByRole('region', { name });
}

function background(element: HTMLElement): string {
  return element.style.backgroundImage;
}

describe('ArtOfficeMock (#121, #122)', () => {
  it('is a 5 x 3 office with the three blocks of the submission in the middle, in order', () => {
    render(<ArtOfficeMock kind="plant" name="Helecho" images={{ sheet: 'data:sheet' }} />);

    expect(screen.getByRole('group', { name: 'Helecho en la oficina' })).toHaveAttribute('data-blocks', '5x3');
    expect(screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'))).toEqual(['Personaje', 'Césped', 'Terreno']);
  });

  describe('a character', () => {
    it('walks its 8 directions, each cut from its own sheet, around the one sitting on a chair', () => {
      render(<ArtOfficeMock kind="character" name="Lucía" images={characterImages} />);

      const personaje = block('Personaje');
      for (const direction of WALK_DIRECTIONS) {
        const sprite = within(personaje).getByRole('img', { name: `Lucía caminando ${WALK_CAPTIONS[direction]}` });
        expect(background(sprite)).toContain('data:walk');
      }
      expect(within(personaje).getAllByRole('img', { name: /caminando/ })).toHaveLength(8);
      expect(background(within(personaje).getByRole('img', { name: 'Lucía sentado' }))).toContain('data:seated');
      // The chair is the pack's, both layers.
      expect(within(personaje).getAllByTestId('chair-layer').map((layer) => background(layer))).toEqual([expect.stringContaining(MOCK_DEFAULTS.chair), expect.stringContaining(MOCK_DEFAULTS.chair)]);
    });

    it('leaves the grass bare and the third block water', () => {
      render(<ArtOfficeMock kind="character" name="Lucía" images={characterImages} />);

      expect(within(block('Césped')).queryByRole('img')).not.toBeInTheDocument();
      expect(background(block('Césped'))).toContain(MOCK_DEFAULTS.grass);
      expect(background(block('Terreno'))).toContain(MOCK_DEFAULTS.water);
    });

    it('shows nothing until both sheets are loaded', () => {
      const { container } = render(<ArtOfficeMock kind="character" name="Lucía" images={{ walk: 'data:walk' }} />);
      expect(container).toBeEmptyDOMElement();
    });
  });

  it('a plant stands on the grass, and the character of the pack walks and sits in the first block', () => {
    render(<ArtOfficeMock kind="plant" name="Helecho" images={{ sheet: 'data:sheet' }} />);

    const planta = within(block('Césped')).getByRole('img', { name: 'Helecho' });
    expect(background(planta)).toContain('data:sheet');
    expect(background(block('Césped'))).toContain(MOCK_DEFAULTS.grass);
    const walker = within(block('Personaje')).getByRole('img', { name: 'Personaje del pack caminando hacia abajo' });
    expect(background(walker)).toContain(MOCK_DEFAULTS.characterWalk);
    expect(background(block('Terreno'))).toContain(MOCK_DEFAULTS.water);
  });

  it('a floor is the terrain of the third block, instead of the water', () => {
    render(<ArtOfficeMock kind="floor" name="Parquet" images={{ sheet: 'data:floor' }} />);

    expect(background(block('Terreno'))).toContain('data:floor');
    expect(background(block('Terreno'))).not.toContain(MOCK_DEFAULTS.water);
    expect(within(block('Césped')).queryByRole('img')).not.toBeInTheDocument();
  });

  it.each([
    ['chair', 'Silla', ['hacia arriba', 'hacia abajo', 'hacia la izquierda', 'hacia la derecha']],
    ['desk', 'Escritorio', ['hacia arriba', 'hacia abajo', 'hacia la izquierda', 'hacia la derecha']],
    ['table', 'Mesa', ['horizontal', 'vertical']],
    ['door', 'Puerta', ['abre hacia abajo', 'abre hacia la derecha', 'abre hacia arriba', 'abre hacia la izquierda']],
  ])('a %s is on the grass in every orientation it has', (kind, name, captions) => {
    render(<ArtOfficeMock kind={kind} name={name} images={{ sheet: 'data:sheet' }} />);

    const pieces = within(block('Césped')).getAllByRole('img');
    expect(pieces.map((piece) => piece.getAttribute('aria-label'))).toEqual(captions.map((caption) => `${name}, ${caption}`));
    for (const piece of pieces) expect(piece.innerHTML + piece.style.backgroundImage).toContain('data:sheet');
    // A figure says which orientation it is.
    for (const caption of captions) expect(within(block('Césped')).getByText(caption)).toBeInTheDocument();
  });

  it('a chair draws both of its layers per orientation', () => {
    render(<ArtOfficeMock kind="chair" name="Silla" images={{ sheet: 'data:sheet' }} />);

    const layers = within(block('Césped')).getAllByTestId('chair-layer');
    expect(layers).toHaveLength(8);
    for (const layer of layers) expect(background(layer)).toContain('data:sheet');
  });

  it('shows nothing until the sheet is loaded', () => {
    const { container } = render(<ArtOfficeMock kind="desk" name="Escritorio" images={{}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
