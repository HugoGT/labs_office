import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { avatarKeyFor } from '../game/remoteAvatars';
import { VideoTile } from './VideoTile';

/**
 * Portrait-only por ahora (issue #17, PR3a): el `<video>` real llega en 3b.
 * Lo que se prueba aqui es la fidelidad del retrato -- que se resuelve por
 * `avatarKeyFor(sessionId)` contra el mapa `byKey` que trae el evento
 * "portraits", nunca redibujado (D1) -- y el placeholder mientras ese evento
 * aun no llego.
 */
describe('VideoTile: retrato fiel via avatarKeyFor (issue #17, D1)', () => {
  it('renderiza el retrato exportado que corresponde a avatarKeyFor(sessionId)', () => {
    const sessionId = 'par-1';
    const key = avatarKeyFor(sessionId);
    const portraits = { [key]: 'data:image/png;base64,AAAA' };

    render(<VideoTile sessionId={sessionId} portraits={portraits} />);

    const img = screen.getByAltText(`Retrato de ${sessionId}`);
    expect(img).toHaveAttribute('src', portraits[key]);
  });

  it('dos sessionId distintos con distinta clave muestran retratos distintos', () => {
    // 'a' y 'b' hashean a claves distintas de av0..av9 (ver avatarKeyFor); se
    // fija de antemano cual retrato corresponde a cada uno.
    const keyA = avatarKeyFor('sesion-a');
    const keyB = avatarKeyFor('sesion-b');
    const portraits = {
      [keyA]: 'data:image/png;base64,AAAA',
      [keyB]: 'data:image/png;base64,BBBB',
    };

    const { rerender } = render(<VideoTile sessionId="sesion-a" portraits={portraits} />);
    expect(screen.getByAltText('Retrato de sesion-a')).toHaveAttribute('src', portraits[keyA]);

    rerender(<VideoTile sessionId="sesion-b" portraits={portraits} />);
    expect(screen.getByAltText('Retrato de sesion-b')).toHaveAttribute('src', portraits[keyB]);
  });

  it('muestra un placeholder mientras "portraits" aun no llego, sin romper con una imagen vacia', () => {
    render(<VideoTile sessionId="par-1" portraits={null} />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('un sessionId cuya clave no esta (todavia) en byKey tambien cae al placeholder', () => {
    render(<VideoTile sessionId="par-1" portraits={{}} />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
