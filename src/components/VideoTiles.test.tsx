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
    ...overrides,
  };
  render(<VideoTiles {...props} />);
  return props;
}

/**
 * Self-tile SIN gate (issue #17, D8): la camara propia se ve en todas partes,
 * incluso en el piso abierto sin ningun par audible -- distinto de la regla
 * de video de PARES, que si depende de compartir sala.
 */
describe('VideoTiles: self-tile ungated (issue #17, D8)', () => {
  it('el self-tile existe solo, sin pares audibles ni sala', () => {
    const { bridge } = renderTiles();

    act(() => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'HugoGT', peers: [], room: null });
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
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'HugoGT', peers: [], room: null });
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
 * Gate de video de PARES: solo dentro de una sala compartida (D8, decision
 * G). El retrato sigue existiendo siempre -- lo que cambia es solo el
 * contenido, nunca la existencia del tile.
 */
describe('VideoTiles: gate de video de pares por sala (issue #17, D8)', () => {
  it('en el piso abierto (room null), el par tiene tile pero SIN video, aunque haya una pista suscrita', () => {
    const peerTrack = fakeVideoTrack();
    const { bridge } = renderTiles({ videoTracks: new Map([['par-1', peerTrack]]) });

    act(() => {
      bridge.emit('voice', {
        selfSessionId: 'yo',
        selfName: 'HugoGT',
        peers: [{ sessionId: 'par-1', name: 'Ana Real' }],
        room: null,
      });
    });

    // El tile del par existe (con su placeholder, sin "portraits" emitido en
    // este test), pero ningun <video> real: eso es lo que este test fija.
    expect(document.querySelector('[data-session-id="par-1"]')).not.toBeNull();
    expect(document.querySelectorAll('video')).toHaveLength(0);
  });

  it('compartiendo sala, el par muestra su video real', () => {
    const peerTrack = fakeVideoTrack();
    const { bridge } = renderTiles({ videoTracks: new Map([['par-1', peerTrack]]) });

    act(() => {
      bridge.emit('voice', {
        selfSessionId: 'yo',
        selfName: 'HugoGT',
        peers: [{ sessionId: 'par-1', name: 'Ana Real' }],
        room: 'Sala de Juntas',
      });
    });

    expect(document.querySelectorAll('video')).toHaveLength(1);
    expect(screen.queryByAltText('Retrato de par-1')).not.toBeInTheDocument();
  });
});

/**
 * D5: un unico contenedor plano, `key={sessionId}` identico en todo modo.
 * Regresion que prueba que un cambio de `data-mode` (anclado <-> fila, el
 * mecanismo que PR4 usara para colapsar) nunca desmonta el nodo ni el
 * `<video>` que cuelga de el.
 */
describe('VideoTiles: D5 -- ningun remonte al cambiar data-mode', () => {
  it('el mismo nodo y el mismo <video> sobreviven a un flip anclado -> fila -> anclado', () => {
    const peerTrack = fakeVideoTrack();
    const { bridge } = renderTiles({ videoTracks: new Map([['par-1', peerTrack]]) });

    act(() => {
      bridge.emit('voice', {
        selfSessionId: 'yo',
        selfName: 'HugoGT',
        peers: [{ sessionId: 'par-1', name: 'Ana Real' }],
        room: 'Sala de Juntas',
      });
    });

    const tileNode = document.querySelector('[data-session-id="par-1"]');
    expect(tileNode).not.toBeNull();
    const videoNode = tileNode!.querySelector('video');
    expect(videoNode).not.toBeNull();

    // Simula lo que hara el bucle de rAF de PR4: escribe `data-mode` directo
    // al DOM, nunca via React state/props.
    act(() => {
      (tileNode as HTMLElement).dataset.mode = 'row';
    });
    expect(document.body.contains(tileNode)).toBe(true);
    expect(tileNode!.querySelector('video')).toBe(videoNode);

    act(() => {
      (tileNode as HTMLElement).dataset.mode = 'anchored';
    });
    expect(document.body.contains(tileNode)).toBe(true);
    expect(tileNode!.querySelector('video')).toBe(videoNode);
  });
});
