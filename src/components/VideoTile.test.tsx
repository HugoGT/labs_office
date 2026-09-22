import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AttachableTrack } from '../game/attachableTrack';
import { avatarKeyFor } from '../game/remoteAvatars';
import {
  PORTRAIT_SCALE,
  PORTRAIT_SOURCE_HEIGHT,
  PORTRAIT_SOURCE_WIDTH,
  VideoTile,
} from './VideoTile';

/** Doble estructural minimo de una pista, mismo patron que `remoteAudioSink.test.ts`. */
function fakeVideoTrack(): AttachableTrack {
  const elements: HTMLMediaElement[] = [];
  return {
    kind: 'video',
    attach() {
      const element = document.createElement('video');
      elements.push(element);
      return element;
    },
    detach() {
      return elements.splice(0);
    },
  };
}

/**
 * Retrato fiel via `avatarKeyFor(sessionId)` (issue #17, D1): resuelto contra
 * el mapa `byKey` que trae el evento "portraits", nunca redibujado. Se
 * muestra siempre que no haya una pista real que mostrar (`track: null`).
 */
describe('VideoTile: retrato fiel via avatarKeyFor (issue #17, D1)', () => {
  it('renderiza el retrato exportado que corresponde a avatarKeyFor(sessionId)', () => {
    const sessionId = 'par-1';
    const key = avatarKeyFor(sessionId);
    const portraits = { [key]: 'data:image/png;base64,AAAA' };

    render(
      <VideoTile
        sessionId={sessionId}
        name="Par Uno"
        portraits={portraits}
        track={null}
        speaking={false}
      />,
    );

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

    const { rerender } = render(
      <VideoTile
        sessionId="sesion-a"
        name="Sesion A"
        portraits={portraits}
        track={null}
        speaking={false}
      />,
    );
    expect(screen.getByAltText('Retrato de sesion-a')).toHaveAttribute('src', portraits[keyA]);

    rerender(
      <VideoTile
        sessionId="sesion-b"
        name="Sesion B"
        portraits={portraits}
        track={null}
        speaking={false}
      />,
    );
    expect(screen.getByAltText('Retrato de sesion-b')).toHaveAttribute('src', portraits[keyB]);
  });

  it('muestra un placeholder mientras "portraits" aun no llego, sin romper con una imagen vacia', () => {
    render(
      <VideoTile sessionId="par-1" name="Par Uno" portraits={null} track={null} speaking={false} />,
    );

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('un sessionId cuya clave no esta (todavia) en byKey tambien cae al placeholder', () => {
    render(
      <VideoTile sessionId="par-1" name="Par Uno" portraits={{}} track={null} speaking={false} />,
    );

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});

/**
 * Adjuntar/desvincular el `<video>` real (issue #17, D3): la TILE es la unica
 * dueña de esta pista -- `livekitRoom.ts` solo la reporta, nunca la adjunta.
 * Mismo patron que `remoteAudioSink.ts`, aplicado aqui en vez de en un sink
 * porque el video SI tiene renderer (D3 rechaza un `remoteVideoSink.ts`).
 */
describe('VideoTile: adjunta/desvincula el video real (issue #17, D3)', () => {
  it('con track no nulo, adjunta un <video> real al DOM y oculta el retrato', () => {
    const sessionId = 'par-1';
    const key = avatarKeyFor(sessionId);
    const portraits = { [key]: 'data:image/png;base64,AAAA' };
    const track = fakeVideoTrack();

    const { container } = render(
      <VideoTile sessionId={sessionId} name="Par Uno" portraits={portraits} track={track} speaking={false} />,
    );

    expect(container.querySelectorAll('video')).toHaveLength(1);
    expect(screen.queryByAltText(`Retrato de ${sessionId}`)).not.toBeInTheDocument();
  });

  it('al desmontar, el <video> se retira del DOM (cero huerfanos)', () => {
    const track = fakeVideoTrack();

    const { container, unmount } = render(
      <VideoTile sessionId="par-1" name="Par Uno" portraits={null} track={track} speaking={false} />,
    );
    expect(container.querySelectorAll('video')).toHaveLength(1);

    unmount();

    expect(document.querySelectorAll('video')).toHaveLength(0);
  });

  it('track null (camara apagada) no deja ningun <video>: se ve el retrato', () => {
    const sessionId = 'par-1';
    const key = avatarKeyFor(sessionId);
    const portraits = { [key]: 'data:image/png;base64,AAAA' };

    const { container } = render(
      <VideoTile sessionId={sessionId} name="Par Uno" portraits={portraits} track={null} speaking={false} />,
    );

    expect(container.querySelectorAll('video')).toHaveLength(0);
    expect(screen.getByAltText(`Retrato de ${sessionId}`)).toBeInTheDocument();
  });

  it('cambiar de track (apagar camara mid-conversacion) desvincula la anterior sin dejarla colgada', () => {
    const trackA = fakeVideoTrack();

    const { container, rerender } = render(
      <VideoTile sessionId="par-1" name="Par Uno" portraits={null} track={trackA} speaking={false} />,
    );
    expect(container.querySelectorAll('video')).toHaveLength(1);

    rerender(
      <VideoTile sessionId="par-1" name="Par Uno" portraits={null} track={null} speaking={false} />,
    );

    expect(container.querySelectorAll('video')).toHaveLength(0);
  });
});

/**
 * Etiqueta de nombre, esquina inferior izquierda (issue #17): el issue decia
 * "esquina inferior" sin precisar cual; el mantenedor la fijo en la
 * izquierda. Se pinea con un atributo explicito (`data-position`), no con una
 * clase CSS (las clases son detalle de implementacion, nunca aserciones).
 */
describe('VideoTile: etiqueta de nombre en la esquina inferior izquierda (issue #17)', () => {
  it('muestra el nombre marcado como "bottom-left" con retrato (camara apagada)', () => {
    render(
      <VideoTile sessionId="par-1" name="Ana Real" portraits={null} track={null} speaking={false} />,
    );

    const label = screen.getByTestId('tile-name');
    expect(label).toHaveTextContent('Ana Real');
    expect(label).toHaveAttribute('data-position', 'bottom-left');
  });

  it('el mismo nombre y posicion se mantienen con video real (camara encendida)', () => {
    render(
      <VideoTile
        sessionId="par-1"
        name="Ana Real"
        portraits={null}
        track={fakeVideoTrack()}
        speaking={false}
      />,
    );

    const label = screen.getByTestId('tile-name');
    expect(label).toHaveTextContent('Ana Real');
    expect(label).toHaveAttribute('data-position', 'bottom-left');
  });
});

/**
 * Borde de habla, binario y solo desde voz real (issue #17, D7): la prop
 * `speaking` es el UNICO insumo -- `VideoTileProps` no tiene `micOn` ni
 * `audioLevel`, asi que es estructuralmente imposible que se cuelen aqui.
 */
describe('VideoTile: borde de habla solo desde voz real (issue #17, D7)', () => {
  it('speaking=true marca el contenido como hablando', () => {
    render(
      <VideoTile sessionId="par-1" name="Ana Real" portraits={null} track={null} speaking={true} />,
    );

    expect(screen.getByTestId('tile-name').parentElement).toHaveAttribute('data-speaking', 'true');
  });

  it('speaking=false (mic encendido pero en silencio) NO marca el contenido como hablando', () => {
    render(
      <VideoTile sessionId="par-1" name="Ana Real" portraits={null} track={null} speaking={false} />,
    );

    expect(screen.getByTestId('tile-name').parentElement).toHaveAttribute('data-speaking', 'false');
  });
});

/**
 * El retrato es el MISMO PNG de 16x20 que genera `textures.ts`, y se pinta a
 * una escala entera fija, nunca estirado al tamaño del tile: con `object-fit:
 * cover` el personaje se escalaba x4.5 y se recortaba, ocupando el tile
 * entero. El tamaño se fija con los atributos intrinsecos de la imagen (no
 * solo con CSS) para que sea el mismo este el tile donde este.
 */
describe('VideoTile: el retrato tiene tamaño fijo, sin re-size (issue #17, D1)', () => {
  it('pinta el retrato a la escala entera declarada, no al tamaño del tile', () => {
    const sessionId = 'par-1';
    const portraits = { [avatarKeyFor(sessionId)]: 'data:image/png;base64,AAAA' };

    render(
      <VideoTile sessionId={sessionId} name="Par Uno" portraits={portraits} track={null} speaking={false} />,
    );

    const img = screen.getByAltText(`Retrato de ${sessionId}`);
    expect(img).toHaveAttribute('width', String(PORTRAIT_SOURCE_WIDTH * PORTRAIT_SCALE));
    expect(img).toHaveAttribute('height', String(PORTRAIT_SOURCE_HEIGHT * PORTRAIT_SCALE));
  });
});
