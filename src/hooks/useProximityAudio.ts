import { useCallback, useEffect, useRef, useState } from 'react';
import type { LivekitConfig } from '../game/livekitEndpoint';
import { connectLivekitRoom, type LivekitRoomConnection } from '../game/livekitRoom';
import { fetchLivekitToken, type LivekitTokenResponse } from '../game/livekitTokenClient';
import type { OfficeBridge } from '../game/officeBridge';

/**
 * Conduce la sala de LiveKit a partir del evento `voice` del puente (D3).
 * Import ESTATICO de `livekitRoom.ts` (no dinamico): slice 1 confirmo por
 * ejecucion que `livekit-client` no es hostil a un import estatico bajo
 * jsdom -- solo `room.connect()` lanza, de forma catchable, que es
 * exactamente la rama que este hook ya maneja con `try/catch` en el `catch`
 * de mas abajo. La regresion que probaria lo contrario vive en
 * `useProximityAudio.test.ts`.
 */
export interface UseProximityAudioOptions {
  /** `null` = Colyseus abajo (D6): nunca se intenta LiveKit. */
  config: LivekitConfig | null;
  /** Inyectable para pruebas; por defecto la implementacion real. */
  connect?: (opts: {
    url: string;
    token: string;
    onAudioPlaybackChanged?: (canPlayback: boolean) => void;
  }) => Promise<LivekitRoomConnection>;
  fetchToken?: (tokenUrl: string, sessionId: string) => Promise<LivekitTokenResponse>;
}

export interface UseProximityAudioResult {
  micOn: boolean;
  camOn: boolean;
  /** `false` mientras no hay conexion viva a LiveKit (matriz de degradacion). */
  audioAvailable: boolean;
  /**
   * `true` cuando el navegador bloqueo la reproduccion por su politica de
   * autoplay: hay conexion y hay pistas, pero no sonara hasta que el usuario
   * haga un gesto. Es distinto de `audioAvailable` y se arregla distinto.
   */
  audioBlocked: boolean;
  toggleMic: () => void;
  toggleCam: () => void;
  /** Gesto de usuario que levanta el bloqueo de autoplay. */
  unblockAudio: () => void;
}

export function useProximityAudio(
  bridge: OfficeBridge,
  { config, connect = connectLivekitRoom, fetchToken = fetchLivekitToken }: UseProximityAudioOptions,
): UseProximityAudioResult {
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [audioAvailable, setAudioAvailable] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const connectionRef = useRef<LivekitRoomConnection | null>(null);
  /** Sesion actualmente conectada o en vuelo de conexion; evita reconectar por cada tick. */
  const sessionRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function teardown(): Promise<void> {
      const connection = connectionRef.current;
      connectionRef.current = null;
      sessionRef.current = null;
      setAudioAvailable(false);
      setAudioBlocked(false);
      if (connection) await connection.disconnect();
    }

    const unsubscribe = bridge.on('voice', (payload) => {
      if (payload.selfSessionId === null) {
        void teardown();
        return;
      }

      // D6: sin configuracion (Colyseus abajo) nunca se intenta LiveKit.
      if (config === null) return;

      if (sessionRef.current === payload.selfSessionId) {
        // Misma sesion: solo reenvia el conjunto deseado, no reconecta.
        connectionRef.current?.setDesiredPeers(payload.sessionIds);
        return;
      }

      const pendingSessionId = payload.selfSessionId;
      const pendingSessionIds = payload.sessionIds;
      sessionRef.current = pendingSessionId;

      void (async () => {
        try {
          const tokenResponse = await fetchToken(config.tokenUrl, pendingSessionId);
          const connection = await connect({
            url: config.url ?? tokenResponse.url,
            token: tokenResponse.token,
            // El aviso puede llegar despues de que esta sesion haya sido
            // reemplazada: sin la guarda, una sala muerta encenderia un aviso
            // en el HUD que ningun gesto podria apagar.
            onAudioPlaybackChanged: (canPlayback) => {
              if (sessionRef.current !== pendingSessionId) return;
              setAudioBlocked(!canPlayback);
            },
          });

          // La sesion pudo cambiar (o el hook desmontarse) mientras el
          // `await` estaba en vuelo: una conexion tardia para una sesion que
          // ya no es la actual quedaria huerfana y con audio filtrado.
          if (cancelled || sessionRef.current !== pendingSessionId) {
            void connection.disconnect();
            return;
          }

          connectionRef.current = connection;
          setAudioAvailable(true);
          connection.setDesiredPeers(pendingSessionIds);
        } catch {
          // Rechazo de connect() (p.ej. navegador sin soporte, servidor
          // caido): degrada a sin audio, nunca lanza, nunca reintenta solo.
          if (sessionRef.current === pendingSessionId) {
            setAudioAvailable(false);
          }
        }
      })();
    });

    return () => {
      cancelled = true;
      unsubscribe();
      void teardown();
    };
  }, [bridge, config, connect, fetchToken]);

  /**
   * No marca nada como desbloqueado: quien decide es la politica del
   * navegador y lo comunica por `AudioPlaybackStatusChanged`. Darlo por bueno
   * aqui apagaria el aviso dejando al usuario en silencio y sin salida.
   */
  const unblockAudio = useCallback(() => {
    void connectionRef.current?.startAudio();
  }, []);

  const toggleMic = useCallback(() => {
    const connection = connectionRef.current;
    if (!connection) return;
    void (async () => {
      const next = !micOn;
      const result = await connection.setMicrophoneEnabled(next);
      setMicOn(result);
    })();
  }, [micOn]);

  const toggleCam = useCallback(() => {
    const connection = connectionRef.current;
    if (!connection) return;
    void (async () => {
      const next = !camOn;
      const result = await connection.setCameraEnabled(next);
      setCamOn(result);
    })();
  }, [camOn]);

  return { micOn, camOn, audioAvailable, audioBlocked, toggleMic, toggleCam, unblockAudio };
}
