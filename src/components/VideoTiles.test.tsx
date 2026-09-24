import { act, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it } from 'vitest';
import type { AttachableTrack } from '../game/attachableTrack';
import { createOfficeBridge } from '../game/officeBridge';
import { VideoTiles } from './VideoTiles';

/** Doble estructural minimo de una pista, mismo patron que `VideoTile.test.tsx`. */
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

function renderTiles(overrides: Partial<ComponentProps<typeof VideoTiles>> = {}) {
  const bridge = createOfficeBridge();
  const props = {
    bridge,
    videoTracks: new Map<string, AttachableTrack>(),
    speakers: new Set<string>(),
    localVideoTrack: null as AttachableTrack | null,
    screenShareTracks: new Map<string, AttachableTrack>(),
    localScreenShareTrack: null as AttachableTrack | null,
    activeScreenSharer: null as string | null,
    ...overrides,
  };
  const { rerender } = render(<VideoTiles {...props} />);
  return {
    ...props,
    rerender: (next: Partial<ComponentProps<typeof VideoTiles>>) =>
      rerender(<VideoTiles {...props} {...next} />),
  };
}

function tileIds(): string[] {
  const bar = screen.getByTestId('video-tile-bar');
  return [...bar.children].map((node) => (node as HTMLElement).dataset.sessionId ?? '');
}

/**
 * La barra es una fila fija arriba al centro que se apila segun cuanta gente
 * audible hay, no un overlay que sigue a cada avatar por el mundo. El orden es
 * determinista -- el tile propio primero, luego cada par en el orden en que lo
 * reporta el evento "voice" -- para que la fila no baile entre cuadros.
 */
describe('VideoTiles: fila fija arriba al centro', () => {
  it('apila un tile por participante audible, con el propio primero', () => {
    const { bridge } = renderTiles();

    act(() => {
      bridge.emit('voice', {
        selfSessionId: 'yo',
        selfName: 'HugoGT',
        peers: [
          { sessionId: 'par-1', name: 'Ana' },
          { sessionId: 'par-2', name: 'Beto' },
        ],
        spaceId: 'sala-de-juntas-stub',
      });
    });

    expect(tileIds()).toEqual(['yo', 'par-1', 'par-2']);
  });

  it('la fila crece y encoge con la cantidad de audibles, sin tocar el tile propio', () => {
    const { bridge } = renderTiles();

    act(() => {
      bridge.emit('voice', {
        selfSessionId: 'yo',
        selfName: 'HugoGT',
        peers: [{ sessionId: 'par-1', name: 'Ana' }],
        spaceId: 'sala-de-juntas-stub',
      });
    });
    const selfNode = document.querySelector('[data-session-id="yo"]');
    expect(tileIds()).toEqual(['yo', 'par-1']);

    act(() => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'HugoGT', peers: [], spaceId: null });
    });

    expect(tileIds()).toEqual(['yo']);
    // El tile propio es el MISMO nodo: que un par entre o salga nunca puede
    // remontar el tile de al lado, o se llevaria su `<video>` por delante.
    expect(document.querySelector('[data-session-id="yo"]')).toBe(selfNode);
  });

  it('la posicion no depende de ningun bucle de cuadro: sin rAF los tiles se ven igual', () => {
    // jsdom no implementa `requestAnimationFrame`. Antes el overlay se anclaba
    // al avatar desde un bucle de rAF y sin el los tiles quedaban ocultos; la
    // fila fija no puede tener esa dependencia.
    const { bridge } = renderTiles();

    act(() => {
      bridge.emit('voice', {
        selfSessionId: 'yo',
        selfName: 'HugoGT',
        peers: [{ sessionId: 'par-1', name: 'Ana' }],
        spaceId: 'sala-de-juntas-stub',
      });
    });

    for (const id of ['yo', 'par-1']) {
      const node = document.querySelector(`[data-session-id="${id}"]`) as HTMLElement;
      expect(node.style.transform).toBe('');
      expect(node.style.visibility).toBe('');
    }
  });
});

/**
 * Self-tile SIN gate (issue #17, D8): la camara propia se ve en todas partes,
 * incluso en el piso abierto sin ningun par audible -- distinto de la regla
 * de video de PARES, que si depende de compartir sala.
 */
describe('VideoTiles: self-tile ungated (issue #17, D8)', () => {
  it('el self-tile existe solo, sin pares audibles ni sala', () => {
    const { bridge } = renderTiles();

    act(() => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'HugoGT', peers: [], spaceId: null });
    });

    // Sin el evento "portraits" (no emitido en este test), el contenido cae
    // al placeholder -- lo que importa aqui es que el tile EXISTE y muestra
    // el nombre propio, no la fidelidad del retrato (ya cubierta en VideoTile.test.tsx).
    expect(document.querySelector('[data-session-id="yo"]')).not.toBeNull();
    expect(screen.queryAllByTestId('tile-name')).toHaveLength(1);
    expect(screen.getByTestId('tile-name')).toHaveTextContent('HugoGT');
  });

  it('con camara local encendida, el self-tile muestra video real aunque no haya sala', () => {
    const { bridge } = renderTiles({ localVideoTrack: fakeVideoTrack() });

    act(() => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'HugoGT', peers: [], spaceId: null });
    });

    expect(document.querySelectorAll('video')).toHaveLength(1);
    expect(screen.queryByAltText('Retrato de yo')).not.toBeInTheDocument();
  });

  it('sin selfSessionId (aun sin sesion) no existe ningun self-tile', () => {
    renderTiles();

    expect(screen.queryAllByTestId('tile-name')).toHaveLength(0);
  });
});

/**
 * Peer video follows proximity everywhere (#75): the corridor used to hide it
 * (D8), which left only audio outside the spaces.
 */
describe('VideoTiles: peer video in the corridor and in spaces (#75)', () => {
  it('en el piso abierto (room null), el par muestra su video suscrito', () => {
    const peerTrack = fakeVideoTrack();
    const { bridge } = renderTiles({ videoTracks: new Map([['par-1', peerTrack]]) });

    act(() => {
      bridge.emit('voice', {
        selfSessionId: 'yo',
        selfName: 'HugoGT',
        peers: [{ sessionId: 'par-1', name: 'Ana Real' }],
        spaceId: null,
      });
    });

    expect(document.querySelector('[data-session-id="par-1"]')).not.toBeNull();
    expect(document.querySelectorAll('video')).toHaveLength(1);
  });

  it('compartiendo sala, el par muestra su video real', () => {
    const peerTrack = fakeVideoTrack();
    const { bridge } = renderTiles({ videoTracks: new Map([['par-1', peerTrack]]) });

    act(() => {
      bridge.emit('voice', {
        selfSessionId: 'yo',
        selfName: 'HugoGT',
        peers: [{ sessionId: 'par-1', name: 'Ana Real' }],
        spaceId: 'sala-de-juntas-stub',
      });
    });

    expect(document.querySelectorAll('video')).toHaveLength(1);
    expect(screen.queryByAltText('Retrato de par-1')).not.toBeInTheDocument();
  });
});

/**
 * Stage layout (#20), like Google Meet: while someone in the space shares,
 * the share takes the big stage and the participant tiles move to a column
 * on the left. With nobody sharing, the row stays exactly as it was.
 */
describe('VideoTiles: screen share stage (#20)', () => {
  const IN_SPACE = {
    selfSessionId: 'yo',
    selfName: 'HugoGT',
    peers: [{ sessionId: 'ana', name: 'Ana' }],
    spaceId: 'sala-de-juntas-stub',
  };

  it('nobody sharing: no stage, the tiles keep their row', () => {
    const { bridge } = renderTiles();

    act(() => bridge.emit('voice', IN_SPACE));

    expect(screen.queryByTestId('screen-share-stage')).not.toBeInTheDocument();
    expect(screen.getByTestId('video-tile-bar')).toHaveAttribute('data-layout', 'row');
  });

  it('a peer sharing takes the stage and the tiles move to the side column, camera tile included', () => {
    const { bridge } = renderTiles({
      screenShareTracks: new Map([['ana', fakeVideoTrack()]]),
      activeScreenSharer: 'ana',
    });

    act(() => bridge.emit('voice', IN_SPACE));

    const stage = screen.getByTestId('screen-share-stage');
    expect(stage).toHaveAttribute('data-session-id', 'ana');
    expect(stage.querySelectorAll('video')).toHaveLength(1);
    expect(stage).toHaveTextContent('Pantalla de Ana');
    expect(screen.getByTestId('video-tile-bar')).toHaveAttribute('data-layout', 'column');
    // The share sits NEXT to the person, it never replaces their tile.
    expect(tileIds()).toEqual(['yo', 'ana']);
  });

  it('the sharer sees their own screen on the stage', () => {
    const { bridge } = renderTiles({
      localScreenShareTrack: fakeVideoTrack(),
      activeScreenSharer: 'yo',
    });

    act(() => bridge.emit('voice', IN_SPACE));

    const stage = screen.getByTestId('screen-share-stage');
    expect(stage).toHaveAttribute('data-session-id', 'yo');
    expect(stage).toHaveTextContent('Tu pantalla');
  });

  it('opening and closing the stage never remounts the participant tiles', () => {
    const { bridge, rerender } = renderTiles();
    act(() => bridge.emit('voice', IN_SPACE));
    const selfNode = document.querySelector('[data-session-id="yo"]');

    rerender({ screenShareTracks: new Map([['ana', fakeVideoTrack()]]), activeScreenSharer: 'ana' });
    expect(document.querySelector('[data-session-id="yo"]')).toBe(selfNode);

    rerender({ activeScreenSharer: null });
    expect(document.querySelector('[data-session-id="yo"]')).toBe(selfNode);
  });

  it('when the share ends the stage and its video leave the DOM', () => {
    const track = fakeVideoTrack();
    const { bridge, rerender } = renderTiles({
      screenShareTracks: new Map([['ana', track]]),
      activeScreenSharer: 'ana',
    });
    act(() => bridge.emit('voice', IN_SPACE));
    expect(document.querySelectorAll('video')).toHaveLength(1);

    rerender({ screenShareTracks: new Map(), activeScreenSharer: null });

    expect(screen.queryByTestId('screen-share-stage')).not.toBeInTheDocument();
    expect(document.querySelectorAll('video')).toHaveLength(0);
    expect(screen.getByTestId('video-tile-bar')).toHaveAttribute('data-layout', 'row');
  });
});
