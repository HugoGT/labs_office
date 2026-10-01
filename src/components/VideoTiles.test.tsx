import { act, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
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
        peers: [
          { sessionId: 'par-1', name: 'Ana' },
          { sessionId: 'par-2', name: 'Beto' },
        ],
        spaceId: 'sala-de-juntas-stub',
      });
    });
    const selfNode = document.querySelector('[data-session-id="yo"]');
    expect(tileIds()).toEqual(['yo', 'par-1', 'par-2']);

    act(() => {
      bridge.emit('voice', {
        selfSessionId: 'yo',
        selfName: 'HugoGT',
        peers: [{ sessionId: 'par-1', name: 'Ana' }],
        spaceId: 'sala-de-juntas-stub',
      });
    });

    expect(tileIds()).toEqual(['yo', 'par-1']);
    // El tile propio es el MISMO nodo: que un par entre o salga nunca puede
    // remontar el tile de al lado, o se llevaria su `<video>` por delante.
    expect(document.querySelector('[data-session-id="yo"]')).toBe(selfNode);
  });

  it('el ultimo par saliendo se lleva la barra entera, self-tile incluido', () => {
    const { bridge } = renderTiles();

    act(() => {
      bridge.emit('voice', {
        selfSessionId: 'yo',
        selfName: 'HugoGT',
        peers: [{ sessionId: 'par-1', name: 'Ana' }],
        spaceId: 'sala-de-juntas-stub',
      });
    });
    expect(tileIds()).toEqual(['yo', 'par-1']);

    act(() => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'HugoGT', peers: [], spaceId: null });
    });

    expect(screen.queryByTestId('video-tile-bar')).not.toBeInTheDocument();
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

describe('VideoTiles: local camera preview without audible peers', () => {
  it('without a local camera or audible peers, no self portrait or bar is added', () => {
    const { bridge } = renderTiles();

    act(() => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'HugoGT', peers: [], spaceId: null });
    });

    expect(document.querySelector('[data-session-id="yo"]')).toBeNull();
    expect(screen.queryAllByTestId('tile-name')).toHaveLength(0);
    expect(screen.queryByTestId('video-tile-bar')).not.toBeInTheDocument();
  });

  it.each([null, 'sala-de-juntas-stub'])('shows the local camera alone in space %s', (spaceId) => {
    const track = fakeVideoTrack();
    const attach = vi.spyOn(track, 'attach');
    const detach = vi.spyOn(track, 'detach');
    const { bridge, rerender } = renderTiles({ localVideoTrack: track });

    act(() => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'HugoGT', peers: [], spaceId });
    });

    expect(tileIds()).toEqual(['yo']);
    expect(screen.getByTestId('video-tile-bar')).toHaveAttribute('data-layout', 'row');
    expect(screen.getByTestId('tile-name')).toHaveTextContent('HugoGT');
    const video = document.querySelector('video');
    expect(video).toBeInTheDocument();
    expect(attach).toHaveBeenCalledTimes(1);

    rerender({ localVideoTrack: null });

    expect(detach).toHaveBeenCalledTimes(1);
    expect(video).not.toBeInTheDocument();
    expect(document.querySelectorAll('video')).toHaveLength(0);
    expect(screen.queryByTestId('video-tile-bar')).not.toBeInTheDocument();
  });

  it('plays the local preview muted and inline with no audio element', () => {
    const { bridge } = renderTiles({ localVideoTrack: fakeVideoTrack() });
    act(() => bridge.emit('voice', {
      selfSessionId: 'yo', selfName: 'HugoGT',
      peers: [{ sessionId: 'ana', name: 'Ana' }], spaceId: null,
    }));

    const video = document.querySelector('video')!;
    expect(video.autoplay).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(document.querySelector('audio')).toBeNull();
  });

  it('keeps the same self tile and video attached when the last audible peer leaves', () => {
    const track = fakeVideoTrack();
    const attach = vi.spyOn(track, 'attach');
    const detach = vi.spyOn(track, 'detach');
    const { bridge } = renderTiles({ localVideoTrack: track });
    act(() => bridge.emit('voice', {
      selfSessionId: 'yo', selfName: 'HugoGT',
      peers: [{ sessionId: 'ana', name: 'Ana' }], spaceId: null,
    }));
    const selfNode = document.querySelector('[data-session-id="yo"]');
    const video = selfNode!.querySelector('video');

    act(() => bridge.emit('voice', {
      selfSessionId: 'yo', selfName: 'HugoGT', peers: [], spaceId: null,
    }));

    expect(tileIds()).toEqual(['yo']);
    expect(document.querySelector('[data-session-id="yo"]')).toBe(selfNode);
    expect(selfNode!.querySelector('video')).toBe(video);
    expect(video).toBeInTheDocument();
    expect(attach).toHaveBeenCalledTimes(1);
    expect(detach).not.toHaveBeenCalled();
  });

  it('en cuanto aparece un par audible, el self-tile se monta junto al del par', () => {
    const { bridge } = renderTiles();

    act(() => {
      bridge.emit('voice', {
        selfSessionId: 'yo',
        selfName: 'HugoGT',
        peers: [{ sessionId: 'par-1', name: 'Ana' }],
        spaceId: null,
      });
    });

    expect(tileIds()).toEqual(['yo', 'par-1']);
    expect(screen.queryAllByTestId('tile-name')).toHaveLength(2);
  });

  it('without selfSessionId, even a local track does not create a pre-session preview', () => {
    renderTiles({ localVideoTrack: fakeVideoTrack() });

    expect(screen.queryAllByTestId('tile-name')).toHaveLength(0);
  });
});

/**
 * Peer video follows proximity everywhere (#75): the corridor used to hide it
 * (D8), which left only audio outside the spaces.
 */
describe('VideoTiles: peer video in the corridor and in spaces (#75)', () => {
  it.each([false, true])('never attaches a non-audible remote camera (audible company: %s)', (hasCompany) => {
    const excludedTrack = fakeVideoTrack();
    const attach = vi.spyOn(excludedTrack, 'attach');
    const { bridge } = renderTiles({
      localVideoTrack: fakeVideoTrack(),
      videoTracks: new Map([['excluded', excludedTrack]]),
    });
    act(() => bridge.emit('voice', {
      selfSessionId: 'yo', selfName: 'HugoGT',
      peers: hasCompany ? [{ sessionId: 'ana', name: 'Ana' }] : [], spaceId: null,
    }));

    expect(document.querySelector('[data-session-id="excluded"]')).toBeNull();
    expect(attach).not.toHaveBeenCalled();
  });

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

  it('keeps the solo camera alongside its own share without remounting, then tears each down independently', () => {
    const camera = fakeVideoTrack();
    const share = fakeVideoTrack();
    const attachCamera = vi.spyOn(camera, 'attach');
    const detachCamera = vi.spyOn(camera, 'detach');
    const detachShare = vi.spyOn(share, 'detach');
    const { bridge, rerender } = renderTiles({ localVideoTrack: camera });
    act(() => bridge.emit('voice', { ...IN_SPACE, peers: [] }));
    const bar = screen.getByTestId('video-tile-bar');
    const selfNode = bar.querySelector('[data-session-id="yo"]');
    const video = selfNode!.querySelector('video');

    rerender({ localScreenShareTrack: share, activeScreenSharer: 'yo' });
    const stage = screen.getByTestId('screen-share-stage');
    expect(stage).toHaveAttribute('data-session-id', 'yo');
    expect(stage).toHaveTextContent('Tu pantalla');
    expect(stage.querySelector('video')).toBeInTheDocument();
    expect(bar).toHaveAttribute('data-layout', 'column');
    expect(bar.querySelector('[data-session-id="yo"]')).toBe(selfNode);
    expect(selfNode!.querySelector('video')).toBe(video);
    expect(attachCamera).toHaveBeenCalledTimes(1);

    rerender({ activeScreenSharer: null });
    expect(screen.queryByTestId('screen-share-stage')).not.toBeInTheDocument();
    expect(detachShare).toHaveBeenCalledTimes(1);
    expect(bar).toHaveAttribute('data-layout', 'row');
    expect(selfNode!.querySelector('video')).toBe(video);
    expect(detachCamera).not.toHaveBeenCalled();

    rerender({ localScreenShareTrack: share, activeScreenSharer: 'yo', localVideoTrack: null });
    expect(detachCamera).toHaveBeenCalledTimes(1);
    expect(video).not.toBeInTheDocument();
    expect(screen.queryByTestId('video-tile-bar')).not.toBeInTheDocument();
    expect(screen.getByTestId('screen-share-stage').querySelectorAll('video')).toHaveLength(1);
  });

  it('a local camera preview does not expose remote screen shares in the corridor', () => {
    const share = fakeVideoTrack();
    const attachShare = vi.spyOn(share, 'attach');
    const { bridge } = renderTiles({
      localVideoTrack: fakeVideoTrack(),
      screenShareTracks: new Map([['ana', share]]),
      activeScreenSharer: 'ana',
    });
    act(() => bridge.emit('voice', { ...IN_SPACE, spaceId: null }));

    expect(screen.queryByTestId('screen-share-stage')).not.toBeInTheDocument();
    expect(attachShare).not.toHaveBeenCalled();
    expect(screen.getByTestId('video-tile-bar')).toHaveAttribute('data-layout', 'row');
  });

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
