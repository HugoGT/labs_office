import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ArtPiecePreview } from './ArtPiecePreview';

describe('ArtPiecePreview (#122)', () => {
  it('a character walks in the four directions and sits, cut from its own sheets', () => {
    render(<ArtPiecePreview kind="character" name="Lucía" images={{ walk: 'data:walk', seated: 'data:seated' }} />);

    for (const label of ['Lucía caminando hacia abajo', 'Lucía caminando hacia la izquierda', 'Lucía caminando hacia la derecha', 'Lucía caminando hacia arriba']) {
      const sprite = screen.getByRole('img', { name: label });
      expect(sprite.style.backgroundImage).toContain('data:walk');
    }
    expect(screen.getByRole('img', { name: 'Lucía sentado' }).style.backgroundImage).toContain('data:seated');
  });

  it('a plant shows its sheet', () => {
    render(<ArtPiecePreview kind="plant" name="Helecho" images={{ sheet: 'data:sheet' }} />);

    expect(screen.getByRole('img', { name: 'Helecho' })).toHaveAttribute('src', 'data:sheet');
  });

  it('shows nothing until the files are loaded', () => {
    const { container } = render(<ArtPiecePreview kind="character" name="Lucía" images={{}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
