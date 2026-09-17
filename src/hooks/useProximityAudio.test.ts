import { act, renderHook } from '@testing-library/react';
import { Room } from 'livekit-client';
import { describe, expect, it, vi } from 'vitest';
import type { AttachableTrack } from '../game/attachableTrack';
import { createOfficeBridge } from '../game/officeBridge';
import type { PresenceStatus } from '../game/officeProtocol';
import type { LivekitConfig } from '../game/livekitEndpoint';
import type { ConnectLivekitRoomOptions, LivekitRoomConnection } from '../game/livekitRoom';
import type { LivekitTokenResponse } from '../game/livekitTokenClient';
import { useProximityAudio } from './useProximityAudio';

const CONFIG: LivekitConfig = { tokenUrl: 'http://localhost:2567/livekit/token', url: null };

function fakeConnection(overrides: Partial<LivekitRoomConnection> = {}): LivekitRoomConnection {
  return {
    setDesiredAudioPeers: vi.fn(),
    setDesiredVideoPeers: vi.fn(),
    setMicrophoneEnabled: vi.fn(async (enabled: boolean) => enabled),
    setCameraEnabled: vi.fn(async (enabled: boolean) => enabled),
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
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), room: null });
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
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), room: null });
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
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf(['ana']), room: null });
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
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), room: null });
    });

    // Piso abierto (room null): audio ya deseado vacio, y video TAMBIEN vacio.
    expect(connection.setDesiredVideoPeers).toHaveBeenLastCalledWith([]);

    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf(['ana']), room: null });
    });

    // Piso abierto con un par audible: audio lo pide, video NUNCA (D8/#17).
    expect(connection.setDesiredAudioPeers).toHaveBeenLastCalledWith(['ana']);
    expect(connection.setDesiredVideoPeers).toHaveBeenLastCalledWith([]);

    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf(['ana']), room: 'Sala de Juntas' });
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
        bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), room: null });
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
        bridge.emit('voice', { selfSessionId: null, selfName: 'Yo', peers: peersOf([]), room: null });
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
        bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), room: null });
      }),
    ).resolves.not.toThrow();

    expect(result.current.audioAvailable).toBe(false);

    // Un segundo evento con el MISMO selfSessionId no reintenta la conexion.
    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf(['ana']), room: null });
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
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), room: null });
    });
    expect(result.current.audioAvailable).toBe(true);

    await act(async () => {
      bridge.emit('voice', { selfSessionId: null, selfName: 'Yo', peers: peersOf([]), room: null });
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
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), room: null });
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
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), room: null });
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
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), room: null });
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
        bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), room: null });
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
        bridge.emit('voice', { selfSessionId: null, selfName: 'Yo', peers: peersOf([]), room: null });
      });

      expect(result.current.audioBlocked).toBe(false);
    });

    it('un aviso de una conexion ya reemplazada no reactiva el bloqueo', async () => {
      const { result, bridge, notify } = await connectAndCapture();

      await act(async () => {
        bridge.emit('voice', { selfSessionId: null, selfName: 'Yo', peers: peersOf([]), room: null });
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
        bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), room: null });
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
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), room: null });
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
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), room: null });
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
        bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), room: null });
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
      bridge.emit('voice', { selfSessionId: null, selfName: 'Yo', peers: peersOf([]), room: null });
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
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: peersOf([]), room: null });
    });

    expect(fetchToken.mock.calls.length).toBeLessThanOrEqual(2);
  });
});
