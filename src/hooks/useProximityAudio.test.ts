import { act, renderHook } from '@testing-library/react';
import { Room } from 'livekit-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttachableTrack } from '../game/attachableTrack';
import { createOfficeBridge } from '../game/officeBridge';
import type { PresenceStatus } from '../game/officeProtocol';
import type { LivekitConfig } from '../game/livekitEndpoint';
import type { ConnectLivekitRoomOptions, LivekitRoomConnection } from '../game/livekitRoom';
import {
  LivekitTokenError,
  type LivekitTokenRequest,
  type LivekitTokenResponse,
} from '../game/livekitTokenClient';
import { useProximityAudio } from './useProximityAudio';

const CONFIG: LivekitConfig = { tokenUrl: 'http://localhost:2567/livekit/token', url: null };

function fakeConnection(overrides: Partial<LivekitRoomConnection> = {}): LivekitRoomConnection {
  return {
    setDesiredAudioPeers: vi.fn(),
    setDesiredVideoPeers: vi.fn(),
    setMicrophoneEnabled: vi.fn(async (enabled: boolean) => enabled),
    setCameraEnabled: vi.fn(async (enabled: boolean) => enabled),
    setScreenShareEnabled: vi.fn(async (enabled: boolean) => enabled),
    startAudio: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    ...overrides,
  };
}

function fakeTokenResponse(): LivekitTokenResponse {
  return { token: 'jwt', url: 'ws://localhost:7880', identity: 'yo', room: 'office-livekit' };
}

/** Construye `voice.peers` a partir de una lista simple de sessionIds. */
function peersOf(sessionIds: string[]): { sessionId: string; name: string }[] {
  return sessionIds.map((sessionId) => ({ sessionId, name: sessionId }));
}

/** Promesa controlable desde afuera: deja un `connect()`/`disconnect()` en
 * vuelo a voluntad, para reproducir la carrera de obs #570 (el `voice` que
 * SI trae el par llega mientras `connect()` todavia no resolvio). */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function fakeAttachableTrack(): AttachableTrack {
  return {
    kind: 'video',
    attach: () => document.createElement('video'),
    detach: () => [],
  };
}

describe('useProximityAudio', () => {
  it('el import estatico de livekitRoom no rompe bajo jsdom (hallazgo slice 1, ADJUST 1.9)', () => {
    // Slice 1 confirmo por ejecucion que `livekit-client` NO es hostil a un
    // import estatico bajo jsdom: solo `room.connect()` lanza, de forma
    // catchable. Este test es la regresion que justifica NO usar un
    // `import()` dinamico en `useProximityAudio.ts`.
    expect(() => new Room()).not.toThrow();
  });

  it('mic y cam empiezan apagados, y sin sesion Colyseus nunca se conecta a LiveKit', () => {
    const bridge = createOfficeBridge();
    const connect = vi.fn();
    const fetchToken = vi.fn();

    const { result } = renderHook(() =>
      useProximityAudio(bridge, { config: CONFIG, status: 'g', connect, fetchToken }),
    );

    expect(result.current.micOn).toBe(false);
    expect(result.current.camOn).toBe(false);
    expect(result.current.audioAvailable).toBe(false);
    expect(connect).not.toHaveBeenCalled();
    expect(fetchToken).not.toHaveBeenCalled();
  });

  it('config null (Colyseus abajo, D6): nunca intenta LiveKit aunque llegue un selfSessionId', async () => {
    const bridge = createOfficeBridge();
    const connect = vi.fn();
    const fetchToken = vi.fn();

    renderHook(() => useProximityAudio(bridge, { config: null, status: 'g', connect, fetchToken }));

    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), spaceId: null });
    });

    expect(fetchToken).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  it('conecta una sola vez para el mismo selfSessionId y reenvia los pares deseados', async () => {
    const bridge = createOfficeBridge();
    const connection = fakeConnection();
    const connect = vi.fn(async () => connection);
    const fetchToken = vi.fn(async () => fakeTokenResponse());

    const { result } = renderHook(() =>
      useProximityAudio(bridge, { config: CONFIG, status: 'g', connect, fetchToken }),
    );

    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), spaceId: null });
    });

    expect(fetchToken).toHaveBeenCalledTimes(1);
    expect(fetchToken).toHaveBeenCalledWith({
      tokenUrl: CONFIG.tokenUrl,
      sessionId: 'yo',
      token: null,
    });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(result.current.audioAvailable).toBe(true);

    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf(['ana']), spaceId: null });
    });

    // Mismo selfSessionId: NO reconecta, solo reenvia el conjunto deseado.
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connection.setDesiredAudioPeers).toHaveBeenCalledWith(['ana']);
  });

  it('reenvia el conjunto de VIDEO por separado, aplicando la regla mas angosta (issue #17)', async () => {
    const bridge = createOfficeBridge();
    const connection = fakeConnection();
    const connect = vi.fn(async () => connection);
    const fetchToken = vi.fn(async () => fakeTokenResponse());

    renderHook(() =>
      useProximityAudio(bridge, { config: CONFIG, status: 'g', connect, fetchToken }),
    );

    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), spaceId: null });
    });

    // Piso abierto (room null): audio ya deseado vacio, y video TAMBIEN vacio.
    expect(connection.setDesiredVideoPeers).toHaveBeenLastCalledWith([]);

    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf(['ana']), spaceId: null });
    });

    // Piso abierto con un par audible: audio lo pide, video NUNCA (D8/#17).
    expect(connection.setDesiredAudioPeers).toHaveBeenLastCalledWith(['ana']);
    expect(connection.setDesiredVideoPeers).toHaveBeenLastCalledWith([]);

    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf(['ana']), spaceId: 'Sala de Juntas' });
    });

    // Compartiendo sala: video pide exactamente los mismos ids que el audio.
    expect(connection.setDesiredAudioPeers).toHaveBeenLastCalledWith(['ana']);
    expect(connection.setDesiredVideoPeers).toHaveBeenLastCalledWith(['ana']);
  });

  describe('video subscrito y habla real llegan al hook (issue #17, D3/D7)', () => {
    /** Conecta y captura las opciones (incluidos los callbacks) con las que el hook llamo a `connect`. */
    async function connectAndCaptureCallbacks() {
      const bridge = createOfficeBridge();
      const connection = fakeConnection();
      let captured: ConnectLivekitRoomOptions | undefined;
      const connect = vi.fn(async (opts: ConnectLivekitRoomOptions) => {
        captured = opts;
        return connection;
      });
      const fetchToken = vi.fn(async () => fakeTokenResponse());

      const rendered = renderHook(() =>
        useProximityAudio(bridge, { config: CONFIG, status: 'g', connect, fetchToken }),
      );

      await act(async () => {
        bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), spaceId: null });
      });

      return { ...rendered, bridge, connection, callbacks: captured! };
    }

    it('empieza sin pistas, sin hablantes y sin camara local', () => {
      const bridge = createOfficeBridge();
      const { result } = renderHook(() =>
        useProximityAudio(bridge, { config: CONFIG, status: 'g', connect: vi.fn(), fetchToken: vi.fn() }),
      );

      expect(result.current.videoTracks.size).toBe(0);
      expect(result.current.speakers.size).toBe(0);
      expect(result.current.localVideoTrack).toBeNull();
    });

    it('onVideoTrackSubscribed agrega el peer a videoTracks, indexado por sessionId', async () => {
      const { result, callbacks } = await connectAndCaptureCallbacks();
      const track = fakeAttachableTrack();

      await act(async () => callbacks.onVideoTrackSubscribed?.('ana', track));

      expect(result.current.videoTracks.get('ana')).toBe(track);
    });

    it('onVideoTrackUnsubscribed retira exactamente ese peer, sin tocar a los demas', async () => {
      const { result, callbacks } = await connectAndCaptureCallbacks();
      const anaTrack = fakeAttachableTrack();
      const beaTrack = fakeAttachableTrack();

      await act(async () => callbacks.onVideoTrackSubscribed?.('ana', anaTrack));
      await act(async () => callbacks.onVideoTrackSubscribed?.('bea', beaTrack));
      await act(async () => callbacks.onVideoTrackUnsubscribed?.('ana', anaTrack));

      expect(result.current.videoTracks.has('ana')).toBe(false);
      expect(result.current.videoTracks.get('bea')).toBe(beaTrack);
    });

    it('onLocalVideoTrackChanged fija y limpia la camara propia', async () => {
      const { result, callbacks } = await connectAndCaptureCallbacks();
      const track = fakeAttachableTrack();

      await act(async () => callbacks.onLocalVideoTrackChanged?.(track));
      expect(result.current.localVideoTrack).toBe(track);

      await act(async () => callbacks.onLocalVideoTrackChanged?.(null));
      expect(result.current.localVideoTrack).toBeNull();
    });

    it('onActiveSpeakersChanged reemplaza el conjunto de hablantes con las identidades reportadas', async () => {
      const { result, callbacks } = await connectAndCaptureCallbacks();

      await act(async () => callbacks.onActiveSpeakersChanged?.(['ana', 'yo']));
      expect(result.current.speakers.has('ana')).toBe(true);
      expect(result.current.speakers.has('yo')).toBe(true);

      await act(async () => callbacks.onActiveSpeakersChanged?.([]));
      expect(result.current.speakers.size).toBe(0);
    });

    it('desconectar limpia video, hablantes y camara local: nada queda colgado tras salir', async () => {
      const { result, callbacks, bridge } = await connectAndCaptureCallbacks();
      await act(async () => callbacks.onVideoTrackSubscribed?.('ana', fakeAttachableTrack()));
      await act(async () => callbacks.onLocalVideoTrackChanged?.(fakeAttachableTrack()));
      await act(async () => callbacks.onActiveSpeakersChanged?.(['ana']));

      await act(async () => {
        bridge.emit('voice', { selfSessionId: null, selfName: 'Yo', peers: peersOf([]), spaceId: null });
      });

      expect(result.current.videoTracks.size).toBe(0);
      expect(result.current.speakers.size).toBe(0);
      expect(result.current.localVideoTrack).toBeNull();
    });
  });

  it('el rechazo de connect deja audioAvailable en false, sin lanzar y sin reintentar', async () => {
    const bridge = createOfficeBridge();
    const connect = vi.fn(async () => {
      throw new Error('LiveKit doesn\'t seem to be supported on this browser...');
    });
    const fetchToken = vi.fn(async () => fakeTokenResponse());

    const { result } = renderHook(() =>
      useProximityAudio(bridge, { config: CONFIG, status: 'g', connect, fetchToken }),
    );

    await expect(
      act(async () => {
        bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), spaceId: null });
      }),
    ).resolves.not.toThrow();

    expect(result.current.audioAvailable).toBe(false);

    // Un segundo evento con el MISMO selfSessionId no reintenta la conexion.
    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf(['ana']), spaceId: null });
    });
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('un selfSessionId null desconecta y apaga audioAvailable', async () => {
    const bridge = createOfficeBridge();
    const connection = fakeConnection();
    const connect = vi.fn(async () => connection);
    const fetchToken = vi.fn(async () => fakeTokenResponse());

    const { result } = renderHook(() =>
      useProximityAudio(bridge, { config: CONFIG, status: 'g', connect, fetchToken }),
    );

    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), spaceId: null });
    });
    expect(result.current.audioAvailable).toBe(true);

    await act(async () => {
      bridge.emit('voice', { selfSessionId: null, selfName: 'Yo', peers: peersOf([]), spaceId: null });
    });

    expect(connection.disconnect).toHaveBeenCalledTimes(1);
    expect(result.current.audioAvailable).toBe(false);
  });

  it('se desconecta al desmontar', async () => {
    const bridge = createOfficeBridge();
    const connection = fakeConnection();
    const connect = vi.fn(async () => connection);
    const fetchToken = vi.fn(async () => fakeTokenResponse());

    const { unmount } = renderHook(() =>
      useProximityAudio(bridge, { config: CONFIG, status: 'g', connect, fetchToken }),
    );

    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), spaceId: null });
    });

    unmount();

    expect(connection.disconnect).toHaveBeenCalledTimes(1);
  });

  it('toggleMic enciende el microfono real y refleja el estado devuelto', async () => {
    const bridge = createOfficeBridge();
    const connection = fakeConnection();
    const connect = vi.fn(async () => connection);
    const fetchToken = vi.fn(async () => fakeTokenResponse());

    const { result } = renderHook(() =>
      useProximityAudio(bridge, { config: CONFIG, status: 'g', connect, fetchToken }),
    );

    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), spaceId: null });
    });

    await act(async () => {
      result.current.toggleMic();
    });

    expect(connection.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(result.current.micOn).toBe(true);
  });

  it('la denegacion de camara mantiene camOn en false', async () => {
    const bridge = createOfficeBridge();
    const connection = fakeConnection({ setCameraEnabled: vi.fn(async () => false) });
    const connect = vi.fn(async () => connection);
    const fetchToken = vi.fn(async () => fakeTokenResponse());

    const { result } = renderHook(() =>
      useProximityAudio(bridge, { config: CONFIG, status: 'g', connect, fetchToken }),
    );

    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), spaceId: null });
    });

    await act(async () => {
      result.current.toggleCam();
    });

    expect(result.current.camOn).toBe(false);
  });

  describe('autoreproduccion bloqueada por el navegador (#18)', () => {
    /** Conecta y devuelve el aviso de reproduccion que el hook le paso a connect. */
    async function connectAndCapture() {
      const bridge = createOfficeBridge();
      const connection = fakeConnection();
      let notify: ((canPlayback: boolean) => void) | undefined;
      const connect = vi.fn(async (opts: { onAudioPlaybackChanged?: (ok: boolean) => void }) => {
        notify = opts.onAudioPlaybackChanged;
        return connection;
      });
      const fetchToken = vi.fn(async () => fakeTokenResponse());

      const rendered = renderHook(() =>
        useProximityAudio(bridge, { config: CONFIG, status: 'g', connect, fetchToken }),
      );

      await act(async () => {
        bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), spaceId: null });
      });

      return { ...rendered, bridge, connection, notify: notify! };
    }

    it('empieza desbloqueado: no se molesta al usuario sin motivo', async () => {
      const { result } = await connectAndCapture();

      expect(result.current.audioBlocked).toBe(false);
    });

    it('el aviso del SDK marca el audio como bloqueado', async () => {
      const { result, notify } = await connectAndCapture();

      await act(async () => notify(false));

      expect(result.current.audioBlocked).toBe(true);
    });

    it('unblockAudio pide el desbloqueo a la sala (el gesto del usuario)', async () => {
      const { result, connection, notify } = await connectAndCapture();
      await act(async () => notify(false));

      await act(async () => result.current.unblockAudio());

      expect(connection.startAudio).toHaveBeenCalledTimes(1);
    });

    it('el desbloqueo solo se da por bueno cuando el SDK lo confirma', async () => {
      const { result, notify } = await connectAndCapture();
      await act(async () => notify(false));

      // `startAudio()` resolver no prueba nada: quien decide es la politica
      // del navegador, y lo dice por evento. Marcarlo aqui seria mentir.
      await act(async () => result.current.unblockAudio());
      expect(result.current.audioBlocked).toBe(true);

      await act(async () => notify(true));
      expect(result.current.audioBlocked).toBe(false);
    });

    it('desconectar limpia el bloqueo: no queda un aviso sin sala detras', async () => {
      const { result, bridge, notify } = await connectAndCapture();
      await act(async () => notify(false));

      await act(async () => {
        bridge.emit('voice', { selfSessionId: null, selfName: 'Yo', peers: peersOf([]), spaceId: null });
      });

      expect(result.current.audioBlocked).toBe(false);
    });

    it('un aviso de una conexion ya reemplazada no reactiva el bloqueo', async () => {
      const { result, bridge, notify } = await connectAndCapture();

      await act(async () => {
        bridge.emit('voice', { selfSessionId: null, selfName: 'Yo', peers: peersOf([]), spaceId: null });
      });
      await act(async () => notify(false));

      expect(result.current.audioBlocked).toBe(false);
    });

    it('unblockAudio sin conexion viva no lanza', async () => {
      const bridge = createOfficeBridge();
      const { result } = renderHook(() =>
        useProximityAudio(bridge, {
          config: CONFIG,
          status: 'g',
          connect: vi.fn(),
          fetchToken: vi.fn(),
        }),
      );

      expect(() => result.current.unblockAudio()).not.toThrow();
    });
  });

  describe('"No molestar" deja de publicar (#1)', () => {
    /** Monta el hook con un estado cambiable y lo deja ya conectado a LiveKit. */
    async function connectedWithStatus(initial: PresenceStatus = 'g') {
      const bridge = createOfficeBridge();
      const connection = fakeConnection();
      const connect = vi.fn(async () => connection);
      const fetchToken = vi.fn(async () => fakeTokenResponse());

      const rendered = renderHook(
        ({ status }: { status: PresenceStatus }) =>
          useProximityAudio(bridge, { config: CONFIG, status, connect, fetchToken }),
        { initialProps: { status: initial } },
      );

      await act(async () => {
        bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), spaceId: null });
      });

      return { ...rendered, bridge, connection, connect };
    }

    it('entrar en "No molestar" apaga microfono y camara publicados', async () => {
      const { result, rerender, connection } = await connectedWithStatus();
      await act(async () => result.current.toggleMic());
      await act(async () => result.current.toggleCam());
      expect(result.current.micOn).toBe(true);
      expect(result.current.camOn).toBe(true);

      await act(async () => rerender({ status: 'r' }));

      // La escena ya corta la SUSCRIPCION (emite un conjunto de pares vacio);
      // lo que falta aqui es dejar de PUBLICAR.
      expect(connection.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);
      expect(connection.setCameraEnabled).toHaveBeenLastCalledWith(false);
      expect(result.current.micOn).toBe(false);
      expect(result.current.camOn).toBe(false);
      expect(result.current.dnd).toBe(true);
    });

    it('no tira la sala al entrar en "No molestar"', async () => {
      const { rerender, connection, connect } = await connectedWithStatus();

      await act(async () => rerender({ status: 'r' }));

      // Mantenerla viva hace que volver a "En línea" sea instantaneo, en vez
      // de costar un token nuevo y una reconexion entera.
      expect(connection.disconnect).not.toHaveBeenCalled();
      expect(connect).toHaveBeenCalledTimes(1);
    });

    it('"Ocupado" no toca lo que se publica: es senal social', async () => {
      const { result, rerender, connection } = await connectedWithStatus();
      await act(async () => result.current.toggleMic());

      await act(async () => rerender({ status: 'y' }));

      expect(connection.setMicrophoneEnabled).toHaveBeenLastCalledWith(true);
      expect(result.current.micOn).toBe(true);
      expect(result.current.dnd).toBe(false);
    });

    it('volver a "En línea" no vuelve a publicar solo: decide el usuario', async () => {
      const { result, rerender, connection } = await connectedWithStatus();
      await act(async () => result.current.toggleMic());
      await act(async () => rerender({ status: 'r' }));
      vi.mocked(connection.setMicrophoneEnabled).mockClear();

      await act(async () => rerender({ status: 'g' }));

      // Reabrir el microfono sin pedirlo seria justo lo contrario de lo que
      // "No molestar" prometio.
      expect(connection.setMicrophoneEnabled).not.toHaveBeenCalled();
      expect(result.current.micOn).toBe(false);
    });

    it('los toggles son inertes mientras dura "No molestar"', async () => {
      const { result, rerender, connection } = await connectedWithStatus();
      await act(async () => rerender({ status: 'r' }));
      vi.mocked(connection.setMicrophoneEnabled).mockClear();
      vi.mocked(connection.setCameraEnabled).mockClear();

      await act(async () => result.current.toggleMic());
      await act(async () => result.current.toggleCam());

      // Defensa en profundidad: el boton ya va `disabled`, pero un estado que
      // solo protege mientras la UI coopere no protege.
      expect(connection.setMicrophoneEnabled).not.toHaveBeenCalled();
      expect(connection.setCameraEnabled).not.toHaveBeenCalled();
      expect(result.current.micOn).toBe(false);
      expect(result.current.camOn).toBe(false);
    });

    it('montar ya en "No molestar" no deja nada publicado', async () => {
      const { result, connection } = await connectedWithStatus('r');

      expect(result.current.dnd).toBe(true);
      expect(connection.setMicrophoneEnabled).toHaveBeenLastCalledWith(false);
      expect(connection.setCameraEnabled).toHaveBeenLastCalledWith(false);
    });
  });
});

describe('useProximityAudio: el conjunto deseado en vuelo no se pierde (obs #570, D1)', () => {
  it('un voice() con el par mientras connect() sigue en vuelo se aplica al resolver, no el vacio inicial', async () => {
    const bridge = createOfficeBridge();
    const connection = fakeConnection();
    const gate = deferred<LivekitRoomConnection>();
    const connect = vi.fn(() => gate.promise);
    const fetchToken = vi.fn(async () => fakeTokenResponse());

    renderHook(() => useProximityAudio(bridge, { config: CONFIG, status: 'g', connect, fetchToken }));

    // voice#1: el recien llegado, sin pares todavia (Colyseus no sincronizo).
    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), spaceId: null });
    });
    expect(connect).toHaveBeenCalledTimes(1);

    // voice#2: llega el par mientras `connect()` sigue sin resolver.
    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf(['ana']), spaceId: null });
    });
    // Mismo selfSessionId: no reconecta.
    expect(connect).toHaveBeenCalledTimes(1);

    await act(async () => {
      gate.resolve(connection);
      await gate.promise;
    });

    // HOY: se aplica la instantanea vacia de voice#1 (`pendingSessionIds`).
    // CON EL ARREGLO: se aplica lo ultimo conocido (`desiredRef`), es decir ['ana'].
    expect(connection.setDesiredAudioPeers).toHaveBeenLastCalledWith(['ana']);
  });

  it('la misma actualizacion en vuelo tambien llega al conjunto de VIDEO, no solo al de audio', async () => {
    const bridge = createOfficeBridge();
    const connection = fakeConnection();
    const gate = deferred<LivekitRoomConnection>();
    const connect = vi.fn(() => gate.promise);
    const fetchToken = vi.fn(async () => fakeTokenResponse());

    renderHook(() => useProximityAudio(bridge, { config: CONFIG, status: 'g', connect, fetchToken }));

    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), spaceId: null });
    });

    // Comparte sala con el par: video pide los mismos ids que el audio.
    await act(async () => {
      bridge.emit('voice', {
        selfSessionId: 'yo',
        selfName: 'Yo',
        peers: peersOf(['ana']),
        spaceId: 'Sala de Juntas',
      });
    });

    await act(async () => {
      gate.resolve(connection);
      await gate.promise;
    });

    expect(connection.setDesiredVideoPeers).toHaveBeenLastCalledWith(['ana']);
  });

  it('el teardown no deja un conjunto deseado viejo filtrarse a la sesion siguiente', async () => {
    const bridge = createOfficeBridge();
    const connection1 = fakeConnection();
    const disconnectGate = deferred<void>();
    connection1.disconnect = vi.fn(() => disconnectGate.promise);
    const connection2 = fakeConnection();
    const connect2Gate = deferred<LivekitRoomConnection>();
    const connect = vi
      .fn<(opts: ConnectLivekitRoomOptions) => Promise<LivekitRoomConnection>>()
      .mockImplementationOnce(async () => connection1)
      .mockImplementationOnce(() => connect2Gate.promise);
    const fetchToken = vi.fn(async () => fakeTokenResponse());

    renderHook(() => useProximityAudio(bridge, { config: CONFIG, status: 'g', connect, fetchToken }));

    // Sesion 'yo' conecta y queda con ['ana'] deseado.
    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf(['ana']), spaceId: null });
    });
    expect(connection1.setDesiredAudioPeers).toHaveBeenLastCalledWith(['ana']);

    // Se desconecta: el disconnect() REAL queda en vuelo a proposito.
    await act(async () => {
      bridge.emit('voice', { selfSessionId: null, selfName: 'Yo', peers: peersOf([]), spaceId: null });
    });

    // Antes de que el disconnect viejo termine, arranca una sesion nueva.
    await act(async () => {
      bridge.emit('voice', {
        selfSessionId: 'bea',
        selfName: 'Bea',
        peers: peersOf(['carla']),
        spaceId: null,
      });
    });
    expect(connect).toHaveBeenCalledTimes(2);

    // Se resuelve el disconnect viejo DESPUES de que la sesion nueva ya
    // escribio su propio conjunto deseado: si el reset de `desiredRef`
    // corriera tras el `await` de teardown (en vez de antes), borraria lo
    // que 'bea' ya dejo escrito.
    await act(async () => {
      disconnectGate.resolve();
      await disconnectGate.promise;
    });

    await act(async () => {
      connect2Gate.resolve(connection2);
      await connect2Gate.promise;
    });

    expect(connection2.setDesiredAudioPeers).toHaveBeenLastCalledWith(['carla']);
  });
});

describe('useProximityAudio: sesion autenticada (#8)', () => {
  it('pide un token fresco a la sesion y lo manda al servidor de tokens', async () => {
    const bridge = createOfficeBridge();
    const connect = vi.fn(async () => fakeConnection());
    const fetchToken = vi.fn(async () => fakeTokenResponse());
    const getIdToken = vi.fn(async () => 'id-token');

    renderHook(() =>
      useProximityAudio(bridge, {
        config: CONFIG,
        status: 'g',
        session: { displayName: 'Ana', getIdToken },
        connect,
        fetchToken,
      }),
    );

    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), spaceId: null });
    });

    // El servidor cruza el token con la sesion de Colyseus (`forbidden-session`):
    // sin esto, `POST /livekit/token` responde 401 y no hay audio.
    expect(getIdToken).toHaveBeenCalledTimes(1);
    expect(fetchToken).toHaveBeenCalledWith({
      tokenUrl: CONFIG.tokenUrl,
      sessionId: 'yo',
      token: 'id-token',
    });
  });

  it('una sesion sin token (caducada, sin usuario) no inventa uno', async () => {
    const bridge = createOfficeBridge();
    const connect = vi.fn(async () => fakeConnection());
    const fetchToken = vi.fn(async () => fakeTokenResponse());

    renderHook(() =>
      useProximityAudio(bridge, {
        config: CONFIG,
        status: 'g',
        session: { displayName: 'Ana', getIdToken: async () => null },
        connect,
        fetchToken,
      }),
    );

    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), spaceId: null });
    });

    expect(fetchToken).toHaveBeenCalledWith({
      tokenUrl: CONFIG.tokenUrl,
      sessionId: 'yo',
      token: null,
    });
  });

  it('si pedir el token falla, degrada a sin audio en vez de romper la oficina', async () => {
    const bridge = createOfficeBridge();
    const connect = vi.fn(async () => fakeConnection());
    const fetchToken = vi.fn(async () => fakeTokenResponse());

    const { result } = renderHook(() =>
      useProximityAudio(bridge, {
        config: CONFIG,
        status: 'g',
        session: {
          displayName: 'Ana',
          getIdToken: async () => {
            throw new Error('red caida');
          },
        },
        connect,
        fetchToken,
      }),
    );

    await expect(
      act(async () => {
        bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), spaceId: null });
      }),
    ).resolves.not.toThrow();

    expect(result.current.audioAvailable).toBe(false);
    expect(connect).not.toHaveBeenCalled();
  });
});

describe('useProximityAudio: el desmontaje no puede realimentar al propio efecto', () => {
  /**
   * `teardown()` corre tambien en la limpieza del efecto de conexion, cuyas
   * dependencias incluyen `session` (#8). Si limpiar emitiera colecciones
   * nuevas aun estando ya vacias, cada limpieza provocaria un render, ese
   * render traeria una `session` con identidad nueva y el efecto volveria a
   * limpiarse: bucle infinito que revienta el proceso por memoria.
   */
  it('limpiar con todo ya vacio conserva la identidad de las colecciones', async () => {
    const bridge = createOfficeBridge();
    const connect = vi.fn(async () => fakeConnection());
    const fetchToken = vi.fn(async () => fakeTokenResponse());

    const { result } = renderHook(() =>
      useProximityAudio(bridge, { config: CONFIG, status: 'g', connect, fetchToken }),
    );

    const videoTracks = result.current.videoTracks;
    const speakers = result.current.speakers;

    await act(async () => {
      bridge.emit('voice', { selfSessionId: null, selfName: 'Yo', peers: peersOf([]), spaceId: null });
    });

    expect(result.current.videoTracks).toBe(videoTracks);
    expect(result.current.speakers).toBe(speakers);
  });

  it('una sesion con identidad nueva en cada render no reconecta en bucle', async () => {
    const bridge = createOfficeBridge();
    const connect = vi.fn(async () => fakeConnection());
    const fetchToken = vi.fn(async () => fakeTokenResponse());
    const getIdToken = async () => 'id-token';

    renderHook(() =>
      // La identidad cambia en cada render a proposito: es lo que haria un
      // llamador que construya la sesion en linea.
      useProximityAudio(bridge, {
        config: CONFIG,
        status: 'g',
        session: { displayName: 'Ana', getIdToken },
        connect,
        fetchToken,
      }),
    );

    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), spaceId: null });
    });

    expect(fetchToken.mock.calls.length).toBeLessThanOrEqual(2);
  });
});

describe('useProximityAudio: reconecta al cambiar de espacio (#12, D7, targetRef{sessionId,spaceId})', () => {
  it('el mismo sessionId con un spaceId nuevo reconecta a una sala nueva y conserva los pares deseados', async () => {
    const bridge = createOfficeBridge();
    const connection1 = fakeConnection();
    const connection2 = fakeConnection();
    const connect = vi
      .fn<(opts: ConnectLivekitRoomOptions) => Promise<LivekitRoomConnection>>()
      .mockResolvedValueOnce(connection1)
      .mockResolvedValueOnce(connection2);
    const fetchToken = vi.fn(async () => fakeTokenResponse());

    renderHook(() => useProximityAudio(bridge, { config: CONFIG, status: 'g', connect, fetchToken }));

    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf(['ana']), spaceId: null });
    });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connection1.setDesiredAudioPeers).toHaveBeenLastCalledWith(['ana']);

    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf(['ana']), spaceId: 's1' });
    });

    // Mismo sessionId, spaceId distinto: SI reconecta (D7), a diferencia del
    // caso de mismo (sessionId, spaceId) ya cubierto arriba en el archivo. La
    // sala nueva arranca YA con el par deseado ('ana'), sin pasar por un
    // vacio intermedio: "teardown menos el reset de desiredRef".
    expect(connect).toHaveBeenCalledTimes(2);
    expect(fetchToken).toHaveBeenLastCalledWith({
      tokenUrl: CONFIG.tokenUrl,
      sessionId: 'yo',
      token: null,
      spaceId: 's1',
    });
    expect(connection1.disconnect).toHaveBeenCalledTimes(1);
    expect(connection2.setDesiredAudioPeers).toHaveBeenLastCalledWith(['ana']);
    expect(connection2.setDesiredVideoPeers).toHaveBeenLastCalledWith(['ana']);
  });

  it('un segundo cambio de espacio mientras el primero sigue en vuelo: la conexion tardia se descarta', async () => {
    const bridge = createOfficeBridge();
    const staleConnection = fakeConnection();
    const connectGateStale = deferred<LivekitRoomConnection>();
    const finalConnection = fakeConnection();
    const connect = vi
      .fn<(opts: ConnectLivekitRoomOptions) => Promise<LivekitRoomConnection>>()
      .mockImplementationOnce(() => connectGateStale.promise)
      .mockResolvedValueOnce(finalConnection);
    const fetchToken = vi.fn(async () => fakeTokenResponse());

    renderHook(() => useProximityAudio(bridge, { config: CONFIG, status: 'g', connect, fetchToken }));

    // Primer objetivo ('s1'): su connect() queda en vuelo.
    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), spaceId: 's1' });
    });
    // Segundo objetivo ('s2') antes de que 's1' resuelva.
    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), spaceId: 's2' });
    });
    expect(connect).toHaveBeenCalledTimes(2);

    // La conexion de 's1' resuelve TARDE: el objetivo ya es 's2', asi que se
    // descarta (se desconecta) en vez de quedar viva.
    await act(async () => {
      connectGateStale.resolve(staleConnection);
    });

    expect(staleConnection.disconnect).toHaveBeenCalledTimes(1);
  });

  it('flap A->B->A2: la conexion tardia de la A original no pisa la conexion viva de A2 (fuga de conexion)', async () => {
    const bridge = createOfficeBridge();
    const connectGateA = deferred<LivekitRoomConnection>();
    const connectionB = fakeConnection();
    const connectionA2 = fakeConnection();
    const staleConnectionA = fakeConnection();
    const connect = vi
      .fn<(opts: ConnectLivekitRoomOptions) => Promise<LivekitRoomConnection>>()
      .mockImplementationOnce(() => connectGateA.promise)
      .mockResolvedValueOnce(connectionB)
      .mockResolvedValueOnce(connectionA2);
    const fetchToken = vi.fn(async () => fakeTokenResponse());

    const { result } = renderHook(() =>
      useProximityAudio(bridge, { config: CONFIG, status: 'g', connect, fetchToken }),
    );

    // A original ('s1'): su connect() queda en vuelo.
    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), spaceId: 's1' });
    });
    // B ('s2'): conecta rapido.
    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), spaceId: 's2' });
    });
    expect(connect).toHaveBeenCalledTimes(2);
    // A2: MISMO valor (sessionId,spaceId) que A original, pero un intento posterior. Conecta rapido.
    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), spaceId: 's1' });
    });
    expect(connect).toHaveBeenCalledTimes(3);

    // La conexion de A original resuelve TARDE, despues de que A2 ya esta viva.
    // Comparar por VALOR (sessionId,spaceId) confundiria esto con "sigue vigente",
    // porque A2 tiene el mismo valor que A original -- debe descartarse igual.
    await act(async () => {
      connectGateA.resolve(staleConnectionA);
    });

    expect(staleConnectionA.disconnect).toHaveBeenCalledTimes(1);
    expect(connectionA2.disconnect).not.toHaveBeenCalled();

    // Una accion del usuario actua sobre la conexion VIVA (A2), nunca sobre la huerfana.
    await act(async () => {
      result.current.toggleMic();
    });
    expect(connectionA2.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(staleConnectionA.setMicrophoneEnabled).not.toHaveBeenCalled();
  });
});

describe('useProximityAudio: 403 forbidden-space reintenta antes de caer al corredor (#12, diseno sec.6)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reintenta con las demoras 150/300/600 y luego cae al corredor', async () => {
    vi.useFakeTimers();
    const bridge = createOfficeBridge();
    const corridorConnection = fakeConnection();
    const connect = vi.fn(async () => corridorConnection);
    const fetchToken = vi.fn(async (request: LivekitTokenRequest) => {
      if (request.spaceId) throw new LivekitTokenError(403, 'forbidden-space');
      return fakeTokenResponse();
    });

    renderHook(() => useProximityAudio(bridge, { config: CONFIG, status: 'g', connect, fetchToken }));

    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), spaceId: 's1' });
    });
    expect(fetchToken).toHaveBeenCalledTimes(1);

    // Secuencia exacta de las demoras (150/300/600) ya la prueba
    // `voiceRoomTarget.test.ts`; aqui solo importa que el hook las use: tres
    // reintentos mas, y sin mas demora que esperar cae al corredor -- 5
    // llamadas en total dentro de este avance combinado.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150 + 300 + 600);
    });
    expect(fetchToken).toHaveBeenCalledTimes(5);
    expect(fetchToken.mock.calls[4][0]).not.toHaveProperty('spaceId');
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('un error que no es forbidden-space (p.ej. 503) no reintenta: degrada de inmediato', async () => {
    const bridge = createOfficeBridge();
    const connect = vi.fn();
    const fetchToken = vi.fn(async () => {
      throw new LivekitTokenError(503, 'livekit-not-configured');
    });

    const { result } = renderHook(() =>
      useProximityAudio(bridge, { config: CONFIG, status: 'g', connect, fetchToken }),
    );

    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), spaceId: 's1' });
    });

    expect(fetchToken).toHaveBeenCalledTimes(1);
    expect(connect).not.toHaveBeenCalled();
    expect(result.current.audioAvailable).toBe(false);
  });

  it('agotados los reintentos, cada 5s reintenta el token del espacio y cambia de sala si tiene exito', async () => {
    vi.useFakeTimers();
    const bridge = createOfficeBridge();
    const corridorConnection = fakeConnection();
    const spaceConnection = fakeConnection();
    const connect = vi
      .fn<(opts: ConnectLivekitRoomOptions) => Promise<LivekitRoomConnection>>()
      .mockResolvedValueOnce(corridorConnection)
      .mockResolvedValueOnce(spaceConnection);
    let spaceRequests = 0;
    const fetchToken = vi.fn(async (request: LivekitTokenRequest) => {
      if (request.spaceId) {
        spaceRequests++;
        if (spaceRequests <= 4) throw new LivekitTokenError(403, 'forbidden-space');
        return fakeTokenResponse();
      }
      return fakeTokenResponse();
    });

    renderHook(() => useProximityAudio(bridge, { config: CONFIG, status: 'g', connect, fetchToken }));

    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), spaceId: 's1' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150 + 300 + 600);
    });
    // Ya en el corredor tras agotar los reintentos rapidos.
    expect(connect).toHaveBeenCalledTimes(1);

    // El reintento lento (5s) ahora SI consigue el token del espacio.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(connect).toHaveBeenCalledTimes(2);
    expect(corridorConnection.disconnect).toHaveBeenCalledTimes(1);
  });

  it('el reintento lento se detiene tras 6 intentos y se queda en el corredor', async () => {
    vi.useFakeTimers();
    const bridge = createOfficeBridge();
    const corridorConnection = fakeConnection();
    const connect = vi.fn(async () => corridorConnection);
    const fetchToken = vi.fn(async (request: LivekitTokenRequest) => {
      if (request.spaceId) throw new LivekitTokenError(403, 'forbidden-space');
      return fakeTokenResponse();
    });

    renderHook(() => useProximityAudio(bridge, { config: CONFIG, status: 'g', connect, fetchToken }));

    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), spaceId: 's1' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150 + 300 + 600); // 3 reintentos rapidos + caida al corredor.
    });
    const callsAfterFastRetries = fetchToken.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6 * 5000); // 6 reintentos lentos, todos fallando.
    });
    expect(fetchToken.mock.calls.length).toBe(callsAfterFastRetries + 6);

    // Avanzar mucho mas no debe generar un 7mo reintento: el tope de 6 es real.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 5000);
    });
    expect(fetchToken.mock.calls.length).toBe(callsAfterFastRetries + 6);
    expect(connect).toHaveBeenCalledTimes(1); // sigue en el corredor.
  });

  it('el reintento lento se detiene si el objetivo cambia antes de que dispare el temporizador de 5s', async () => {
    vi.useFakeTimers();
    const bridge = createOfficeBridge();
    const corridorConnection = fakeConnection();
    const otherConnection = fakeConnection();
    const connect = vi
      .fn<(opts: ConnectLivekitRoomOptions) => Promise<LivekitRoomConnection>>()
      .mockResolvedValueOnce(corridorConnection)
      .mockResolvedValueOnce(otherConnection);
    const fetchToken = vi.fn(async (request: LivekitTokenRequest) => {
      if (request.spaceId === 's1') throw new LivekitTokenError(403, 'forbidden-space');
      return fakeTokenResponse();
    });

    renderHook(() => useProximityAudio(bridge, { config: CONFIG, status: 'g', connect, fetchToken }));

    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), spaceId: 's1' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150 + 300 + 600); // cae al corredor, arranca el reintento lento.
    });
    const callsBeforeChange = fetchToken.mock.calls.length;

    // El usuario se mueve a 's2' antes de que el reintento lento de 5s dispare.
    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), spaceId: 's2' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    // El reintento lento viejo (para 's1') se abandono: solo la peticion de 's2' se sumo.
    expect(fetchToken.mock.calls.length).toBe(callsBeforeChange + 1);
    expect(connect).toHaveBeenCalledTimes(2); // corredor + 's2', nunca un tercer connect() para 's1'.
  });

  it('si el objetivo cambia durante el reintento rapido, se abandona la cadena vieja sin conectar', async () => {
    vi.useFakeTimers();
    const bridge = createOfficeBridge();
    const finalConnection = fakeConnection();
    // Solo UNA resolucion configurada: si la cadena vieja ('s1') tambien
    // llegara a `connect()`, la segunda llamada devolveria `undefined` y
    // reventaria el `await connect(...)` del hook, fallando el test.
    const connect = vi
      .fn<(opts: ConnectLivekitRoomOptions) => Promise<LivekitRoomConnection>>()
      .mockResolvedValueOnce(finalConnection);
    const fetchToken = vi.fn(async (request: LivekitTokenRequest) => {
      if (request.spaceId === 's1') throw new LivekitTokenError(403, 'forbidden-space');
      return fakeTokenResponse();
    });

    renderHook(() => useProximityAudio(bridge, { config: CONFIG, status: 'g', connect, fetchToken }));

    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), spaceId: 's1' });
    });

    // Mientras el reintento espera, el usuario ya se movio a 's2' (exito directo).
    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), spaceId: 's2' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });

    // El primer objetivo ('s1') no debe generar una conexion al corredor
    // colgada: solo la conexion final de 's2' debe existir.
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('desmontar durante un reintento rapido o lento en espera no reintenta ni actualiza estado', async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bridge = createOfficeBridge();
    const connect = vi.fn(async () => fakeConnection());
    const fetchToken = vi.fn(async (request: LivekitTokenRequest) => {
      if (request.spaceId) throw new LivekitTokenError(403, 'forbidden-space');
      return fakeTokenResponse();
    });

    const { unmount } = renderHook(() =>
      useProximityAudio(bridge, { config: CONFIG, status: 'g', connect, fetchToken }),
    );

    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), spaceId: 's1' });
    });
    const callsBeforeUnmount = fetchToken.mock.calls.length;

    unmount();

    // El temporizador falso sigue "programado", pero el efecto ya se limpio:
    // avanzar el tiempo (reintentos rapidos + uno lento) no debe reintentar ni conectar.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150 + 300 + 600 + 5000);
    });

    expect(fetchToken.mock.calls.length).toBe(callsBeforeUnmount);
    expect(connect).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('useProximityAudio: reaplica microfono/camara tras cada conexion (#12, la sala nueva no arrancaba en silencio)', () => {
  it('reconectar a un espacio nuevo re-publica el microfono ya encendido, sin que el usuario lo repita', async () => {
    const bridge = createOfficeBridge();
    const connection1 = fakeConnection();
    const connection2 = fakeConnection();
    const connect = vi
      .fn<(opts: ConnectLivekitRoomOptions) => Promise<LivekitRoomConnection>>()
      .mockResolvedValueOnce(connection1)
      .mockResolvedValueOnce(connection2);
    const fetchToken = vi.fn(async () => fakeTokenResponse());

    const { result } = renderHook(() =>
      useProximityAudio(bridge, { config: CONFIG, status: 'g', connect, fetchToken }),
    );

    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), spaceId: null });
    });
    await act(async () => {
      result.current.toggleMic();
    });
    expect(result.current.micOn).toBe(true);
    vi.mocked(connection2.setMicrophoneEnabled).mockClear();

    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), spaceId: 's1' });
    });

    // Hoy la sala nueva arrancaba sin publicar nada: esto es lo que el
    // slice arregla -- el intento de publicar sobrevive a la reconexion.
    expect(connection2.setMicrophoneEnabled).toHaveBeenCalledWith(true);
  });

  it('en "No molestar" el reconnect no re-publica, aunque hubiera microfono encendido antes de entrar', async () => {
    const bridge = createOfficeBridge();
    const connection1 = fakeConnection();
    const connection2 = fakeConnection();
    const connect = vi
      .fn<(opts: ConnectLivekitRoomOptions) => Promise<LivekitRoomConnection>>()
      .mockResolvedValueOnce(connection1)
      .mockResolvedValueOnce(connection2);
    const fetchToken = vi.fn(async () => fakeTokenResponse());

    const { result, rerender } = renderHook(
      ({ status }: { status: PresenceStatus }) =>
        useProximityAudio(bridge, { config: CONFIG, status, connect, fetchToken }),
      { initialProps: { status: 'g' as PresenceStatus } },
    );

    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), spaceId: null });
    });
    await act(async () => {
      result.current.toggleMic();
    });
    expect(result.current.micOn).toBe(true);

    // Entra en "No molestar": el microfono ya se apaga (comportamiento existente).
    await act(async () => rerender({ status: 'r' }));
    expect(result.current.micOn).toBe(false);

    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), spaceId: 's1' });
    });

    expect(connection2.setMicrophoneEnabled).not.toHaveBeenCalledWith(true);
  });
});
