/**
 * Unico modulo que importa `livekit-client` (diseno, tabla de limites de
 * modulo): ciclo de vida de la sala, suscripcion selectiva y publicacion de
 * microfono/camara.
 *
 * Slice 1 confirmo por ejecucion que `livekit-client` NO es hostil a un
 * import estatico bajo jsdom -- solo `room.connect()` lanza, y de forma
 * catchable. Esto es lo unico que hace hostil a este modulo: cualquier otro
 * archivo que lo importe estaticamente (p.ej. `useProximityAudio.ts`) esta a
 * salvo mientras nunca ejecute `connectLivekitRoom` bajo jsdom.
 *
 * D2: `current` nunca se cachea. Cada `reconcile()` lee
 * `room.remoteParticipants` en vivo, asi que un evento perdido se autocura en
 * el siguiente tick en vez de dejar una fuga de audio permanente y silenciosa.
 */

import { Room, RoomEvent, Track, type RemoteParticipant, type RemoteTrack } from 'livekit-client';
import { reconcileSubscriptions } from './proximityAudio';
import { createRemoteAudioSink } from './remoteAudioSink';

/** Los dos kinds que este modulo reconcilia por separado (issue #17, decision D2). */
type TrackKind = Track.Kind.Audio | Track.Kind.Video;

export interface LivekitRoomConnection {
  /** Guarda el conjunto de AUDIO deseado y reconcilia ese kind contra el estado vivo de la sala. */
  setDesiredAudioPeers(sessionIds: readonly string[]): void;
  /**
   * Guarda el conjunto de VIDEO deseado y reconcilia ese kind por separado
   * (issue #17): deliberadamente mas angosto que el audio, ver
   * `proximityVideo.ts`. Nunca afecta las publicaciones de audio del mismo
   * peer -- son deltas independientes por kind.
   */
  setDesiredVideoPeers(sessionIds: readonly string[]): void;
  /** Devuelve el estado real: `false` si el dispositivo se deniega. */
  setMicrophoneEnabled(enabled: boolean): Promise<boolean>;
  setCameraEnabled(enabled: boolean): Promise<boolean>;
  /**
   * Levanta el bloqueo de autoreproduccion del navegador. DEBE invocarse
   * desde un gesto del usuario: no hay forma de saltarselo, solo de ofrecerlo.
   */
  startAudio(): Promise<void>;
  disconnect(): Promise<void>;
}

export interface ConnectLivekitRoomOptions {
  url: string;
  token: string;
  /** Inyectable para pruebas: permite retener una referencia a la sala real. */
  createRoom?: () => Room;
  /** Donde cuelgan los elementos de audio remoto. Inyectable para pruebas. */
  audioContainer?: HTMLElement;
  /**
   * Se llama con el estado de reproduccion del navegador, empezando por el
   * que hay justo despues de conectar. `false` = el navegador bloqueo el
   * audio y hace falta un gesto del usuario (`startAudio`).
   */
  onAudioPlaybackChanged?: (canPlayback: boolean) => void;
}

/**
 * Identidades con al menos una publicacion de ESTE kind suscrita AHORA MISMO
 * (D2: observado, no cacheado). Filtrar por `kind` es lo que hace que audio y
 * video puedan divergir: un peer puede tener su audio suscrito y su video no,
 * o viceversa.
 */
function currentlySubscribed(room: Room, kind: TrackKind): string[] {
  const subscribed: string[] = [];
  room.remoteParticipants.forEach((participant: RemoteParticipant, identity: string) => {
    const hasSubscribed = Array.from(participant.trackPublications.values()).some(
      (publication) => publication.kind === kind && publication.isSubscribed,
    );
    if (hasSubscribed) subscribed.push(identity);
  });
  return subscribed;
}

export async function connectLivekitRoom({
  url,
  token,
  createRoom = () => new Room(),
  audioContainer,
  onAudioPlaybackChanged,
}: ConnectLivekitRoomOptions): Promise<LivekitRoomConnection> {
  const room = createRoom();
  const sink = createRemoteAudioSink(audioContainer);
  let desiredAudio: readonly string[] = [];
  let desiredVideo: readonly string[] = [];

  /**
   * Reconcilia UN kind a la vez contra su propio conjunto deseado. Cada kind
   * tiene su propio delta minimo (`reconcileSubscriptions` sigue siendo la
   * misma funcion pura de `proximityAudio.ts`, la disciplina de deltas no
   * cambia, solo se aplica dos veces, una por kind) -- por eso desuscribir
   * video de un peer nunca toca su publicacion de audio, y viceversa.
   */
  function reconcileKind(kind: TrackKind): void {
    const desired = kind === Track.Kind.Audio ? desiredAudio : desiredVideo;
    const current = currentlySubscribed(room, kind);
    const { subscribe, unsubscribe } = reconcileSubscriptions(current, desired);

    for (const identity of subscribe) {
      const participant = room.remoteParticipants.get(identity);
      participant?.trackPublications.forEach((publication) => {
        if (publication.kind === kind) publication.setSubscribed(true);
      });
    }
    for (const identity of unsubscribe) {
      const participant = room.remoteParticipants.get(identity);
      participant?.trackPublications.forEach((publication) => {
        if (publication.kind === kind) publication.setSubscribed(false);
      });
    }
  }

  function reconcileAll(): void {
    reconcileKind(Track.Kind.Audio);
    reconcileKind(Track.Kind.Video);
  }

  // Re-ejecuta la reconciliacion cuando una publicacion llega TARDE (un peer
  // ya deseado que aun no habia publicado nada al pedirlo).
  room.on(RoomEvent.TrackPublished, () => reconcileAll());
  room.on(RoomEvent.ParticipantConnected, () => reconcileAll());

  // D-reproduccion (#18): `reconcile()` solo PIDE la pista; el sonido empieza
  // cuando llega por `TrackSubscribed` y se adjunta al documento. Son dos
  // pasos distintos y perder el segundo da el peor sintoma posible: conexion
  // sana, suscripcion concedida y silencio.
  room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => sink.add(track));
  room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => sink.remove(track));
  room.on(RoomEvent.AudioPlaybackStatusChanged, () =>
    onAudioPlaybackChanged?.(room.canPlaybackAudio),
  );

  await room.connect(url, token, { autoSubscribe: false });

  // El estado inicial no llega por evento: sin esto, un navegador que ya nace
  // bloqueado no se reporta hasta el primer cambio, que puede no ocurrir nunca.
  onAudioPlaybackChanged?.(room.canPlaybackAudio);

  return {
    setDesiredAudioPeers(sessionIds) {
      desiredAudio = sessionIds;
      reconcileKind(Track.Kind.Audio);
    },
    setDesiredVideoPeers(sessionIds) {
      desiredVideo = sessionIds;
      reconcileKind(Track.Kind.Video);
    },
    async setMicrophoneEnabled(enabled) {
      try {
        await room.localParticipant.setMicrophoneEnabled(enabled);
        return enabled;
      } catch {
        return false;
      }
    },
    async setCameraEnabled(enabled) {
      try {
        await room.localParticipant.setCameraEnabled(enabled);
        return enabled;
      } catch {
        return false;
      }
    },
    async startAudio() {
      try {
        await room.startAudio();
      } catch {
        // Gesto invalido o politica aun no satisfecha: el aviso del HUD sigue
        // en pie y el usuario puede reintentar. Nunca lanza hacia el HUD.
      }
    },
    async disconnect() {
      sink.clear();
      await room.disconnect();
    },
  };
}
