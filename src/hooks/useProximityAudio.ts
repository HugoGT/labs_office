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
  LivekitTokenError,
  fetchLivekitToken,
  type LivekitTokenRequest,
  type LivekitTokenResponse,
} from '../game/livekitTokenClient';
import type { OfficeBridge } from '../game/officeBridge';
import { DO_NOT_DISTURB, type PresenceStatus } from '../game/officeProtocol';
import { videoPeers } from '../game/proximityVideo';
import {
  MAX_SLOW_RETRIES,
  SLOW_RETRY_MS,
  decideVoiceTransition,
  tokenRetryDelay,
  type VoiceTarget,
} from '../game/voiceRoomTarget';

/** Espera real (no cancelable por si sola): quien llama vuelve a comprobar el objetivo al despertar. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sameTarget(current: VoiceTarget | null, target: VoiceTarget): boolean {
  return current !== null && current.sessionId === target.sessionId && current.spaceId === target.spaceId;
}

function isForbiddenSpace(err: unknown): boolean {
  return err instanceof LivekitTokenError && err.status === 403 && err.code === 'forbidden-space';
}

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
  /** Objetivo (sessionId, spaceId) conectado o en vuelo (#12, D7): reemplaza al `sessionRef` de solo-sesion, porque un cambio de espacio con la MISMA sesion tambien exige sala nueva. */
  const targetRef = useRef<VoiceTarget | null>(null);
  /** Temporizador del reintento lento (D-sec.6) en vuelo; se cancela al empezar otro reconnect o al desmontar. */
  const slowRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Espejo por-ref de `micOn`/`camOn`/`dnd` (#12): el efecto de conexion no depende de `status` ni de la publicacion, asi que una reconexion tardia necesita el valor FRESCO, no el capturado por el closure. */
  const micOnRef = useRef(false);
  const camOnRef = useRef(false);
  const dndRef = useRef(false);
  /**
   * Ultimo conjunto deseado conocido (obs #570, D1): el recien llegado recibe
   * su primer `voice` con `peers: []` (Colyseus aun no sincronizo), asi que
   * `connect()` arranca con una instantanea vacia. El `voice` que SI trae el
   * par puede llegar mientras esa conexion sigue en vuelo -- `connectionRef`
   * todavia es `null` y el encadenamiento opcional de mas abajo lo descarta
   * en silencio. Esta ref guarda SIEMPRE el ultimo valor visto, se escriba
   * donde se escriba, y es lo que se aplica en cuanto la conexion queda lista.
   */
  const desiredRef = useRef<{ sessionIds: readonly string[]; spaceId: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;

    function clearSlowRetry(): void {
      if (slowRetryTimerRef.current !== null) {
        clearTimeout(slowRetryTimerRef.current);
        slowRetryTimerRef.current = null;
      }
    }

    /** Reaplica el microfono/camara deseados tras CUALQUIER conexion nueva (#12): sin esto, una sala recien conectada arranca sin publicar nada aunque el usuario ya lo hubiera encendido en la sala anterior. */
    function reapplyPublishIntent(connection: LivekitRoomConnection): void {
      if (dndRef.current) return;
      if (micOnRef.current) void connection.setMicrophoneEnabled(true);
      if (camOnRef.current) void connection.setCameraEnabled(true);
    }

    function applyDesired(connection: LivekitRoomConnection): void {
      const desired = desiredRef.current;
      connection.setDesiredAudioPeers(desired?.sessionIds ?? []);
      connection.setDesiredVideoPeers(
        videoPeers({ spaceId: desired?.spaceId ?? null, audibleSessionIds: desired?.sessionIds ?? [] }),
      );
    }

    async function teardown(): Promise<void> {
      clearSlowRetry();
      const connection = connectionRef.current;
      connectionRef.current = null;
      targetRef.current = null;
      // Antes del `await` de mas abajo (D1): si se pusiera despues, una
      // sesion nueva que ya escribio la suya mientras este disconnect todavia
      // estaba en vuelo se veria borrada por este reset tardio.
      desiredRef.current = null;
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

    /** Callbacks de `connect()` atados a `target`: un aviso tardio de un objetivo ya reemplazado no debe corromper el estado actual (D6 de #18, generalizado a (sessionId,spaceId)). */
    function connectOptionsFor(
      target: VoiceTarget,
      tokenResponse: LivekitTokenResponse,
    ): ConnectLivekitRoomOptions {
      return {
        url: config?.url ?? tokenResponse.url,
        token: tokenResponse.token,
        onAudioPlaybackChanged: (canPlayback) => {
          if (!sameTarget(targetRef.current, target)) return;
          setAudioBlocked(!canPlayback);
        },
        onVideoTrackSubscribed: (sessionId, track) => {
          if (!sameTarget(targetRef.current, target)) return;
          setVideoTracks((current) => new Map(current).set(sessionId, track));
        },
        onVideoTrackUnsubscribed: (sessionId) => {
          if (!sameTarget(targetRef.current, target)) return;
          setVideoTracks((current) => {
            if (!current.has(sessionId)) return current;
            const next = new Map(current);
            next.delete(sessionId);
            return next;
          });
        },
        onLocalVideoTrackChanged: (track) => {
          if (!sameTarget(targetRef.current, target)) return;
          setLocalVideoTrack(track);
        },
        onActiveSpeakersChanged: (identities) => {
          if (!sameTarget(targetRef.current, target)) return;
          setSpeakers(new Set(identities));
        },
      };
    }

    /** Pide un token fresco para `target`, con `spaceId` sustituido por `forSpaceId` (D5: `null` pide el corredor). */
    async function requestToken(
      target: VoiceTarget,
      forSpaceId: string | null,
    ): Promise<LivekitTokenResponse> {
      if (config === null) throw new Error('LiveKit no configurado (D6)');
      // Se pide en cada conexion y no una vez al entrar: el ID token dura
      // mas o menos una hora y esta ruta puede correr mucho despues.
      const idToken = session ? await session.getIdToken() : null;
      // `spaceId` se omite entero para el corredor (`forSpaceId === null`),
      // igual que `fetchLivekitToken` omite `token` sin sesion: la ausencia
      // es la peticion de modo abierto, no un valor `null` a validar.
      return fetchToken(
        forSpaceId === null
          ? { tokenUrl: config.tokenUrl, sessionId: target.sessionId, token: idToken }
          : { tokenUrl: config.tokenUrl, sessionId: target.sessionId, token: idToken, spaceId: forSpaceId },
      );
    }

    /** Consigue el token para `target` (diseno sec.6): un 403 `forbidden-space` reintenta con `tokenRetryDelay`; agotado, cae al corredor. Otro error, o el objetivo cambiando en la espera, aborta sin corredor -- lo resuelve el reconnect del objetivo nuevo. */
    async function acquireToken(
      target: VoiceTarget,
    ): Promise<{ response: LivekitTokenResponse; corridor: boolean } | null> {
      if (target.spaceId !== null) {
        let attempt = 0;
        for (;;) {
          try {
            const response = await requestToken(target, target.spaceId);
            return { response, corridor: false };
          } catch (err) {
            if (!isForbiddenSpace(err)) return null;
            const delay = tokenRetryDelay(attempt);
            if (delay === null) break; // reintentos rapidos agotados: cae al corredor abajo
            await sleep(delay);
            if (cancelled || !sameTarget(targetRef.current, target)) return null;
            attempt++;
          }
        }
      }
      try {
        const response = await requestToken(target, null);
        return { response, corridor: target.spaceId !== null };
      } catch {
        return null;
      }
    }

    /** Reintento lento (diseno sec.6): cada `SLOW_RETRY_MS` reintenta el token del espacio mientras el objetivo no cambie, hasta `MAX_SLOW_RETRIES` veces. `connectionRef` no se toca hasta confirmar el objetivo justo antes de asignar la conexion nueva, para no pisar un `handleReconnect` real concurrente. */
    function scheduleSlowRetry(target: VoiceTarget, attempt: number): void {
      if (attempt >= MAX_SLOW_RETRIES) return;
      slowRetryTimerRef.current = setTimeout(() => {
        slowRetryTimerRef.current = null;
        void (async () => {
          if (cancelled || !sameTarget(targetRef.current, target) || target.spaceId === null) return;
          try {
            const response = await requestToken(target, target.spaceId);
            if (cancelled || !sameTarget(targetRef.current, target)) return;
            const connection = await connect(connectOptionsFor(target, response));
            if (cancelled || !sameTarget(targetRef.current, target)) {
              void connection.disconnect();
              return;
            }
            // El objetivo no cambio: `connectionRef.current` sigue siendo la
            // sala del corredor que este reintento arranco.
            const oldConnection = connectionRef.current;
            connectionRef.current = connection;
            setAudioAvailable(true);
            reapplyPublishIntent(connection);
            applyDesired(connection);
            if (oldConnection) void oldConnection.disconnect();
          } catch {
            scheduleSlowRetry(target, attempt + 1);
          }
        })();
      }, SLOW_RETRY_MS);
    }

    function handleReconnect(target: VoiceTarget): void {
      clearSlowRetry();
      targetRef.current = target;
      const oldConnection = connectionRef.current;
      connectionRef.current = null;
      // Arranca el disconnect viejo SIN esperarlo, solapado con el token nuevo (D7); se espera justo antes de `connect()`.
      const disconnecting = oldConnection ? oldConnection.disconnect() : Promise.resolve();

      void (async () => {
        const acquired = await acquireToken(target);
        await disconnecting;

        if (cancelled || !sameTarget(targetRef.current, target)) return;

        if (acquired === null) {
          // Degrada a sin audio, nunca lanza, nunca reintenta solo (ver el catch de mas abajo).
          setAudioAvailable(false);
          return;
        }

        try {
          const connection = await connect(connectOptionsFor(target, acquired.response));

          // El objetivo pudo cambiar (o el hook desmontarse) en el `await`: una conexion tardia quedaria huerfana y con audio filtrado.
          if (cancelled || !sameTarget(targetRef.current, target)) {
            void connection.disconnect();
            return;
          }

          connectionRef.current = connection;
          setAudioAvailable(true);
          reapplyPublishIntent(connection);
          applyDesired(connection); // D1: lo ultimo conocido, no la instantanea capturada al arrancar.

          // Se pidio el espacio pero se conecto al corredor (reintentos rapidos agotados, D5): sigue intentando cada 5s.
          if (acquired.corridor) scheduleSlowRetry(target, 0);
        } catch {
          if (sameTarget(targetRef.current, target)) setAudioAvailable(false);
        }
      })();
    }

    const unsubscribe = bridge.on('voice', (payload) => {
      // D6: sin configuracion nunca se intenta LiveKit, ni para decidir teardown/forward/reconnect.
      if (payload.selfSessionId === null) {
        void teardown();
        return;
      }
      if (config === null) return;

      const audibleSessionIds = payload.peers.map((peer) => peer.sessionId);
      // Se guarda ANTES de la rama de abajo (D1): sirve tanto a la conexion viva como a la que sigue en vuelo.
      desiredRef.current = { sessionIds: audibleSessionIds, spaceId: payload.spaceId };

      const transition = decideVoiceTransition(targetRef.current, {
        sessionId: payload.selfSessionId,
        spaceId: payload.spaceId,
      });

      if (transition === 'forward') {
        // Mismo objetivo (sessionId, spaceId): solo reenvia los conjuntos deseados, no reconecta.
        connectionRef.current?.setDesiredAudioPeers(audibleSessionIds);
        connectionRef.current?.setDesiredVideoPeers(
          videoPeers({ spaceId: payload.spaceId, audibleSessionIds }),
        );
        return;
      }

      // 'reconnect': primera conexion, cambio de sesion (#52 manual) o cambio de espacio (D7) -- los tres exigen sala nueva.
      handleReconnect({ sessionId: payload.selfSessionId, spaceId: payload.spaceId });
    });

    return () => {
      cancelled = true;
      clearSlowRetry();
      unsubscribe();
      void teardown();
    };
  }, [bridge, config, session, connect, fetchToken]);

  useEffect(() => {
    micOnRef.current = micOn;
    camOnRef.current = camOn;
    dndRef.current = dnd;
  }, [micOn, camOn, dnd]);

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
