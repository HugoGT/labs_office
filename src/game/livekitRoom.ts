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

import {
  Room,
  RoomEvent,
  Track,
  type LocalTrackPublication,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
} from 'livekit-client';
import type { AttachableTrack } from './attachableTrack';
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
  /**
   * Video de un peer YA suscrito (issue #17, D3). Este modulo solo REPORTA:
   * a diferencia del audio, no existe un `remoteVideoSink.ts` que lo adjunte
   * el mismo -- React es el unico dueno del `<video>` (ver `attachableTrack.ts`).
   */
  onVideoTrackSubscribed?: (sessionId: string, track: AttachableTrack) => void;
  /** Contraparte de `onVideoTrackSubscribed`: la pista ya no esta disponible. */
  onVideoTrackUnsubscribed?: (sessionId: string, track: AttachableTrack) => void;
  /**
   * Camara local. `null` cuando se despublica (camara apagada o desconexion):
   * el consumidor no tiene que adivinar el "apagado" a partir de un valor
   * previo que dejo de ser valido.
   */
  onLocalVideoTrackChanged?: (track: AttachableTrack | null) => void;
  /**
   * Identidades reportando voz activa AHORA MISMO (D7): la UNICA fuente de
   * habla. Deliberadamente no deriva de `micOn` ni de un umbral de
   * `audioLevel` propio -- ver la guarda en `livekitRoom.test.ts` (tarea 2.9).
   */
  onActiveSpeakersChanged?: (identities: readonly string[]) => void;
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
  onVideoTrackSubscribed,
  onVideoTrackUnsubscribed,
  onLocalVideoTrackChanged,
  onActiveSpeakersChanged,
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
  room.on(
    RoomEvent.TrackSubscribed,
    (track: RemoteTrack, _publication: unknown, participant: RemoteParticipant) => {
      sink.add(track, participant.identity);
      // D3 (#17): el video NUNCA se adjunta aqui -- solo se reporta. Adjuntar
      // vive en React (la unica pieza con un renderer para video).
      if (track.kind === Track.Kind.Video) onVideoTrackSubscribed?.(participant.identity, track);
    },
  );
  room.on(
    RoomEvent.TrackUnsubscribed,
    (track: RemoteTrack, _publication: unknown, participant: RemoteParticipant) => {
      sink.remove(track);
      if (track.kind === Track.Kind.Video) onVideoTrackUnsubscribed?.(participant.identity, track);
    },
  );
  room.on(RoomEvent.AudioPlaybackStatusChanged, () =>
    onAudioPlaybackChanged?.(room.canPlaybackAudio),
  );
  // Camara local: gate por `kind`, no por "es una publicacion local" (D8 en el
  // diseno separa self-view de la regla de peers, pero el gate de KIND es el
  // mismo para ambos -- audio local nunca debe disparar este callback).
  room.on(RoomEvent.LocalTrackPublished, (publication: LocalTrackPublication) => {
    if (publication.kind === Track.Kind.Video && publication.track) {
      onLocalVideoTrackChanged?.(publication.track);
    }
  });
  room.on(RoomEvent.LocalTrackUnpublished, (publication: LocalTrackPublication) => {
    if (publication.kind === Track.Kind.Video) onLocalVideoTrackChanged?.(null);
  });
  // D7: unica fuente de habla. No lee `micOn` ni ningun umbral de audioLevel
  // propio -- solo lo que LiveKit ya calculo y reporta por este evento.
  room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
    onActiveSpeakersChanged?.(speakers.map((speaker) => speaker.identity));
  });

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
