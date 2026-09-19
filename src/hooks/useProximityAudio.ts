import { useCallback, useEffect, useRef, useState } from 'react';
import type { OfficeSession } from '../auth/authPort';
import type { AttachableTrack } from '../game/attachableTrack';
import type { LivekitConfig } from '../game/livekitEndpoint';
import {
  connectLivekitRoom,
  type ConnectLivekitRoomOptions,
  type LivekitRoomConnection,
} from '../game/livekitRoom';
import {
  fetchLivekitToken,
  type LivekitTokenRequest,
  type LivekitTokenResponse,
} from '../game/livekitTokenClient';
import type { OfficeBridge } from '../game/officeBridge';
import { DO_NOT_DISTURB, type PresenceStatus } from '../game/officeProtocol';
import { videoPeers } from '../game/proximityVideo';

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
  /** Estado de presencia elegido por el usuario; React es su dueno (ver `OfficeShell`). */
  status: PresenceStatus;
  /**
   * Sesion autenticada (#8), o `null` sin autenticacion. El servidor cruza el
   * ID token con la sesion de Colyseus antes de emitir el token de LiveKit
   * (`forbidden-session`), asi que sin el no hay audio cuando la auth esta
   * encendida. Con ella apagada la peticion viaja igual que antes.
   */
  session?: OfficeSession | null;
  /** Inyectable para pruebas; por defecto la implementacion real. */
  connect?: (opts: ConnectLivekitRoomOptions) => Promise<LivekitRoomConnection>;
  fetchToken?: (request: LivekitTokenRequest) => Promise<LivekitTokenResponse>;
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
  /** `true` en "No molestar": ni se publica ni se escucha audio de la oficina. */
  dnd: boolean;
  toggleMic: () => void;
  toggleCam: () => void;
  /** Gesto de usuario que levanta el bloqueo de autoplay. */
  unblockAudio: () => void;
  /** Video de peers suscritos, indexado por sessionId (issue #17, D3). React (no este hook) lo adjunta al DOM. */
  videoTracks: ReadonlyMap<string, AttachableTrack>;
  /** Identidades hablando AHORA MISMO segun LiveKit (D7). Nunca deriva de `micOn`. */
  speakers: ReadonlySet<string>;
  /** Camara propia, o `null` si esta apagada/no publicada. */
  localVideoTrack: AttachableTrack | null;
}

export function useProximityAudio(
  bridge: OfficeBridge,
  {
    config,
    status,
    session = null,
    connect = connectLivekitRoom,
    fetchToken = fetchLivekitToken,
  }: UseProximityAudioOptions,
): UseProximityAudioResult {
  const dnd = status === DO_NOT_DISTURB;
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [audioAvailable, setAudioAvailable] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [videoTracks, setVideoTracks] = useState<ReadonlyMap<string, AttachableTrack>>(new Map());
  const [speakers, setSpeakers] = useState<ReadonlySet<string>>(new Set());
  const [localVideoTrack, setLocalVideoTrack] = useState<AttachableTrack | null>(null);
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
      // Ninguna pista, hablante o camara sobrevive a la sala que las reporto:
      // sin esto, salir de una sala dejaria el ultimo estado colgado en React.
      // Estando ya vacias se devuelve la MISMA coleccion, no una nueva: este
      // `teardown` tambien corre en la limpieza del efecto de conexion, que
      // depende de `session` (#8). Emitir una coleccion nueva provocaria un
      // render, ese render traeria una `session` con identidad nueva y el
      // efecto volveria a limpiarse -- bucle infinito.
      setVideoTracks((current) => (current.size === 0 ? current : new Map()));
      setSpeakers((current) => (current.size === 0 ? current : new Set()));
      setLocalVideoTrack(null);
      if (connection) await connection.disconnect();
    }

    const unsubscribe = bridge.on('voice', (payload) => {
      if (payload.selfSessionId === null) {
        void teardown();
        return;
      }

      // D6: sin configuracion (Colyseus abajo) nunca se intenta LiveKit.
      if (config === null) return;

      const audibleSessionIds = payload.peers.map((peer) => peer.sessionId);

      if (sessionRef.current === payload.selfSessionId) {
        // Misma sesion: solo reenvia los conjuntos deseados, no reconecta.
        connectionRef.current?.setDesiredAudioPeers(audibleSessionIds);
        connectionRef.current?.setDesiredVideoPeers(
          videoPeers({ spaceId: payload.spaceId, audibleSessionIds }),
        );
        return;
      }

      const pendingSessionId = payload.selfSessionId;
      const pendingSessionIds = audibleSessionIds;
      const pendingSpaceId = payload.spaceId;
      sessionRef.current = pendingSessionId;

      void (async () => {
        try {
          // Se pide en cada conexion y no una vez al entrar: el ID token dura
          // mas o menos una hora y esta ruta puede correr mucho despues.
          const idToken = session ? await session.getIdToken() : null;
          const tokenResponse = await fetchToken({
            tokenUrl: config.tokenUrl,
            sessionId: pendingSessionId,
            token: idToken,
          });
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
            // Misma guarda que arriba (D6 de #18): un aviso tardio de una
            // sesion ya reemplazada no debe corromper el estado actual.
            onVideoTrackSubscribed: (sessionId, track) => {
              if (sessionRef.current !== pendingSessionId) return;
              setVideoTracks((current) => new Map(current).set(sessionId, track));
            },
            onVideoTrackUnsubscribed: (sessionId) => {
              if (sessionRef.current !== pendingSessionId) return;
              setVideoTracks((current) => {
                if (!current.has(sessionId)) return current;
                const next = new Map(current);
                next.delete(sessionId);
                return next;
              });
            },
            onLocalVideoTrackChanged: (track) => {
              if (sessionRef.current !== pendingSessionId) return;
              setLocalVideoTrack(track);
            },
            onActiveSpeakersChanged: (identities) => {
              if (sessionRef.current !== pendingSessionId) return;
              setSpeakers(new Set(identities));
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
          connection.setDesiredAudioPeers(pendingSessionIds);
          connection.setDesiredVideoPeers(
            videoPeers({ spaceId: pendingSpaceId, audibleSessionIds: pendingSessionIds }),
          );
        } catch {
          // Rechazo de connect(), de la peticion del token o de la propia
          // sesion (p.ej. navegador sin soporte, servidor caido, token
          // caducado): degrada a sin audio, nunca lanza, nunca reintenta solo.
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
  }, [bridge, config, session, connect, fetchToken]);

  /**
   * Efecto aparte del de conexion: meter `status` en las dependencias de
   * aquel reconstruiria la sala de LiveKit en cada cambio de estado. Depende
   * tambien de `audioAvailable` para cubrir el orden inverso -- entrar ya en
   * "No molestar" y conectar despues. La suscripcion ya la corta la escena (emite un conjunto de pares
   * vacio); lo unico que falta aqui es dejar de PUBLICAR, y para eso no hace
   * falta tirar la sala -- mantenerla viva hace que volver a "En linea" sea
   * instantaneo en vez de costar un token nuevo y una reconexion.
   *
   * Al salir de "No molestar" NO se vuelve a publicar solo: reabrir el
   * microfono sin que nadie lo pida seria lo contrario de lo prometido.
   */
  useEffect(() => {
    if (!dnd) return;
    const connection = connectionRef.current;
    setMicOn(false);
    setCamOn(false);
    if (!connection) return;
    void connection.setMicrophoneEnabled(false);
    void connection.setCameraEnabled(false);
  }, [dnd, audioAvailable]);

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
    // Defensa en profundidad: el boton ya va `disabled`, pero un estado que
    // solo protege mientras la UI coopere no protege.
    if (!connection || dnd) return;
    void (async () => {
      const next = !micOn;
      const result = await connection.setMicrophoneEnabled(next);
      setMicOn(result);
    })();
  }, [micOn, dnd]);

  const toggleCam = useCallback(() => {
    const connection = connectionRef.current;
    if (!connection || dnd) return;
    void (async () => {
      const next = !camOn;
      const result = await connection.setCameraEnabled(next);
      setCamOn(result);
    })();
  }, [camOn, dnd]);

  return {
    micOn,
    camOn,
    audioAvailable,
    audioBlocked,
    dnd,
    toggleMic,
    toggleCam,
    unblockAudio,
    videoTracks,
    speakers,
    localVideoTrack,
  };
}
