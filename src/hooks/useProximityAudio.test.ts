import { act, renderHook } from '@testing-library/react';
import { Room } from 'livekit-client';
import { describe, expect, it, vi } from 'vitest';
import { createOfficeBridge } from '../game/officeBridge';
import type { LivekitConfig } from '../game/livekitEndpoint';
import type { LivekitRoomConnection } from '../game/livekitRoom';
import type { LivekitTokenResponse } from '../game/livekitTokenClient';
import { useProximityAudio } from './useProximityAudio';

const CONFIG: LivekitConfig = { tokenUrl: 'http://localhost:2567/livekit/token', url: null };

function fakeConnection(overrides: Partial<LivekitRoomConnection> = {}): LivekitRoomConnection {
  return {
    setDesiredPeers: vi.fn(),
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
      useProximityAudio(bridge, { config: CONFIG, connect, fetchToken }),
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

    renderHook(() => useProximityAudio(bridge, { config: null, connect, fetchToken }));

    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', sessionIds: [], room: null });
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
      useProximityAudio(bridge, { config: CONFIG, connect, fetchToken }),
    );

    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', sessionIds: [], room: null });
    });

    expect(fetchToken).toHaveBeenCalledTimes(1);
    expect(fetchToken).toHaveBeenCalledWith(CONFIG.tokenUrl, 'yo');
    expect(connect).toHaveBeenCalledTimes(1);
    expect(result.current.audioAvailable).toBe(true);

    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', sessionIds: ['ana'], room: null });
    });

    // Mismo selfSessionId: NO reconecta, solo reenvia el conjunto deseado.
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connection.setDesiredPeers).toHaveBeenCalledWith(['ana']);
  });

  it('el rechazo de connect deja audioAvailable en false, sin lanzar y sin reintentar', async () => {
    const bridge = createOfficeBridge();
    const connect = vi.fn(async () => {
      throw new Error('LiveKit doesn\'t seem to be supported on this browser...');
    });
    const fetchToken = vi.fn(async () => fakeTokenResponse());

    const { result } = renderHook(() =>
      useProximityAudio(bridge, { config: CONFIG, connect, fetchToken }),
    );

    await expect(
      act(async () => {
        bridge.emit('voice', { selfSessionId: 'yo', sessionIds: [], room: null });
      }),
    ).resolves.not.toThrow();

    expect(result.current.audioAvailable).toBe(false);

    // Un segundo evento con el MISMO selfSessionId no reintenta la conexion.
    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', sessionIds: ['ana'], room: null });
    });
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('un selfSessionId null desconecta y apaga audioAvailable', async () => {
    const bridge = createOfficeBridge();
    const connection = fakeConnection();
    const connect = vi.fn(async () => connection);
    const fetchToken = vi.fn(async () => fakeTokenResponse());

    const { result } = renderHook(() =>
      useProximityAudio(bridge, { config: CONFIG, connect, fetchToken }),
    );

    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', sessionIds: [], room: null });
    });
    expect(result.current.audioAvailable).toBe(true);

    await act(async () => {
      bridge.emit('voice', { selfSessionId: null, sessionIds: [], room: null });
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
      useProximityAudio(bridge, { config: CONFIG, connect, fetchToken }),
    );

    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', sessionIds: [], room: null });
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
      useProximityAudio(bridge, { config: CONFIG, connect, fetchToken }),
    );

    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', sessionIds: [], room: null });
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
      useProximityAudio(bridge, { config: CONFIG, connect, fetchToken }),
    );

    await act(async () => {
      bridge.emit('voice', { selfSessionId: 'yo', sessionIds: [], room: null });
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
        useProximityAudio(bridge, { config: CONFIG, connect, fetchToken }),
      );

      await act(async () => {
        bridge.emit('voice', { selfSessionId: 'yo', sessionIds: [], room: null });
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
        bridge.emit('voice', { selfSessionId: null, sessionIds: [], room: null });
      });

      expect(result.current.audioBlocked).toBe(false);
    });

    it('un aviso de una conexion ya reemplazada no reactiva el bloqueo', async () => {
      const { result, bridge, notify } = await connectAndCapture();

      await act(async () => {
        bridge.emit('voice', { selfSessionId: null, sessionIds: [], room: null });
      });
      await act(async () => notify(false));

      expect(result.current.audioBlocked).toBe(false);
    });

    it('unblockAudio sin conexion viva no lanza', async () => {
      const bridge = createOfficeBridge();
      const { result } = renderHook(() =>
        useProximityAudio(bridge, { config: CONFIG, connect: vi.fn(), fetchToken: vi.fn() }),
      );

      expect(() => result.current.unblockAudio()).not.toThrow();
    });
  });
});
