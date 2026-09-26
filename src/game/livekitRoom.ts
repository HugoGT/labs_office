/**
 * Unico modulo que importa `livekit-client` (diseno, tabla de limites de
 * modulo): ciclo de vida de la sala, suscripcion selectiva y publicacion de
 * microfono/camara/pantalla.
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
  type LocalTrack,
  type LocalTrackPublication,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type TrackPublication,
} from 'livekit-client';
import type { AttachableTrack } from './attachableTrack';
import { reconcileSubscriptions } from './proximityAudio';
import { createRemoteAudioSink } from './remoteAudioSink';
import {
  nextScreenShareClaim,
  screenShareClaimOf,
  screenShareTrackName,
  screenShareWinner,
  shouldYieldScreenShare,
  type ScreenShareClaim,
} from './screenShare';

/** Los dos kinds que este modulo reconcilia por separado (issue #17, decision D2). */
type TrackKind = Track.Kind.Audio | Track.Kind.Video;

export interface LivekitRoomConnection {
  /** Guarda el conjunto de AUDIO deseado y reconcilia ese kind contra el estado vivo de la sala. */
  setDesiredAudioPeers(sessionIds: readonly string[]): void;
  /**
   * Guarda el conjunto de VIDEO deseado y reconcilia ese kind por separado
   * (issue #17). Hoy coincide con el de audio (#75), pero nunca afecta las
   * publicaciones de audio del mismo peer -- son deltas independientes por kind.
   */
  setDesiredVideoPeers(sessionIds: readonly string[]): void;
  /** Devuelve el estado real: `false` si el dispositivo se deniega. */
  setMicrophoneEnabled(enabled: boolean): Promise<boolean>;
  setCameraEnabled(enabled: boolean): Promise<boolean>;
  /**
   * Starts or stops the own screen share (#20). Resolves `false` when the
   * user closes the browser picker: that is a choice, not an error. The share
   * can also end without this call (browser bar, a takeover), so the live
   * state is `onLocalScreenShareChanged`, not this result.
   */
  setScreenShareEnabled(enabled: boolean): Promise<boolean>;
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
  /**
   * Subscribed peer screen share (#20), apart from `onVideoTrackSubscribed`:
   * tiles are keyed by (participant, source), so a share must never replace
   * the camera of the same person.
   */
  onScreenShareTrackSubscribed?: (sessionId: string, track: AttachableTrack) => void;
  onScreenShareTrackUnsubscribed?: (sessionId: string, track: AttachableTrack) => void;
  /**
   * Own screen share, `null` when it is unpublished for any reason: our
   * button, the browser's own "stop sharing" bar, or a takeover.
   */
  onLocalScreenShareChanged?: (track: AttachableTrack | null) => void;
  /** Identity holding the single share slot of this room, `null` when nobody shares (#20). */
  onActiveScreenSharerChanged?: (identity: string | null) => void;
  /**
   * The room is gone for good and this connection is dead (#84): LiveKit gave
   * up reconnecting, or the server removed us. Never fired by our own
   * `disconnect()`. Without it a dead room keeps every button enabled, the
   * share picker opens and nothing is published, and no camera comes back.
   */
  onDisconnected?: () => void;
}

function publicationsOf(participant: Participant, source: Track.Source): TrackPublication[] {
  return Array.from(participant.trackPublications.values()).filter(
    (publication) => publication.source === source,
  );
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
  onScreenShareTrackSubscribed,
  onScreenShareTrackUnsubscribed,
  onLocalScreenShareChanged,
  onActiveScreenSharerChanged,
  onDisconnected,
}: ConnectLivekitRoomOptions): Promise<LivekitRoomConnection> {
  const room = createRoom();
  const sink = createRemoteAudioSink(audioContainer);
  let desiredAudio: readonly string[] = [];
  let desiredVideo: readonly string[] = [];
  let activeScreenSharer: string | null = null;
  /** Set by our own `disconnect()`, which also makes the room emit `Disconnected`. */
  let closing = false;

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
    const { unsubscribe } = reconcileSubscriptions(current, desired);

    // Per publication, not per identity (#20): a peer whose camera is already
    // subscribed still has to get the screen share it publishes later, and
    // its microphone does not cover the screen share audio either.
    for (const identity of desired) {
      const participant = room.remoteParticipants.get(identity);
      participant?.trackPublications.forEach((publication) => {
        if (publication.kind === kind && !publication.isSubscribed) publication.setSubscribed(true);
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

  /** Screen share claims of this room, own included; each space is its own room (#20). */
  function screenShareClaims(): ScreenShareClaim[] {
    const claims: ScreenShareClaim[] = [];
    const collect = (participant: Participant, identity: string) => {
      for (const publication of publicationsOf(participant, Track.Source.ScreenShare)) {
        claims.push({ identity, claim: screenShareClaimOf(publication.trackName) });
      }
    };
    collect(room.localParticipant, room.localParticipant.identity);
    room.remoteParticipants.forEach(collect);
    return claims;
  }

  /**
   * Unpublishes the own share, audio included. `setScreenShareEnabled(false)`
   * only drops the audio next to a live video, so an audio left behind by a
   * video the browser already ended is unpublished here as well.
   */
  async function stopScreenShare(): Promise<void> {
    try {
      await room.localParticipant.setScreenShareEnabled(false);
    } catch {
      // Already gone: nothing left to unpublish.
    }
    unpublishLeftoverScreenAudio();
  }

  function unpublishLeftoverScreenAudio(): void {
    for (const publication of publicationsOf(room.localParticipant, Track.Source.ScreenShareAudio)) {
      const track = publication.track as LocalTrack | undefined;
      if (track) void room.localParticipant.unpublishTrack(track).catch(() => undefined);
    }
  }

  /**
   * Single sharer per space (#20, see `screenShare.ts`). Runs on every change
   * of the room's shares: whoever is outranked stops their own share, and
   * everyone reports the same winner because everyone ranks the same set.
   */
  function arbitrateScreenShare(): void {
    const claims = screenShareClaims();
    const winner = screenShareWinner(claims);
    if (winner !== activeScreenSharer) {
      activeScreenSharer = winner;
      onActiveScreenSharerChanged?.(winner);
    }
    if (shouldYieldScreenShare(room.localParticipant.identity, claims)) void stopScreenShare();
  }

  // Re-ejecuta la reconciliacion cuando una publicacion llega TARDE (un peer
  // ya deseado que aun no habia publicado nada al pedirlo).
  room.on(RoomEvent.TrackPublished, () => {
    reconcileAll();
    arbitrateScreenShare();
  });
  room.on(RoomEvent.ParticipantConnected, () => reconcileAll());
  room.on(RoomEvent.TrackUnpublished, () => arbitrateScreenShare());
  room.on(RoomEvent.ParticipantDisconnected, () => arbitrateScreenShare());

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
      if (track.source === Track.Source.ScreenShare) {
        onScreenShareTrackSubscribed?.(participant.identity, track);
      } else if (track.kind === Track.Kind.Video) {
        onVideoTrackSubscribed?.(participant.identity, track);
      }
    },
  );
  room.on(
    RoomEvent.TrackUnsubscribed,
    (track: RemoteTrack, _publication: unknown, participant: RemoteParticipant) => {
      sink.remove(track);
      if (track.source === Track.Source.ScreenShare) {
        onScreenShareTrackUnsubscribed?.(participant.identity, track);
      } else if (track.kind === Track.Kind.Video) {
        onVideoTrackUnsubscribed?.(participant.identity, track);
      }
    },
  );
  room.on(RoomEvent.AudioPlaybackStatusChanged, () =>
    onAudioPlaybackChanged?.(room.canPlaybackAudio),
  );
  // Camara local: gate por `kind`, no por "es una publicacion local" (D8 en el
  // diseno separa self-view de la regla de peers, pero el gate de KIND es el
  // mismo para ambos -- audio local nunca debe disparar este callback).
  // The own screen share is video too, but it is not the camera (#20).
  room.on(RoomEvent.LocalTrackPublished, (publication: LocalTrackPublication) => {
    if (publication.source === Track.Source.ScreenShare) {
      if (publication.track) onLocalScreenShareChanged?.(publication.track);
      arbitrateScreenShare();
      return;
    }
    if (publication.kind === Track.Kind.Video && publication.track) {
      onLocalVideoTrackChanged?.(publication.track);
    }
  });
  room.on(RoomEvent.LocalTrackUnpublished, (publication: LocalTrackPublication) => {
    if (publication.source === Track.Source.ScreenShare) {
      // Also reached when the browser's own bar ends the capture: the SDK
      // unpublishes the video by itself, and this resets the button.
      unpublishLeftoverScreenAudio();
      onLocalScreenShareChanged?.(null);
      arbitrateScreenShare();
      return;
    }
    if (publication.kind === Track.Kind.Video) onLocalVideoTrackChanged?.(null);
  });
  // D7: unica fuente de habla. No lee `micOn` ni ningun umbral de audioLevel
  // propio -- solo lo que LiveKit ya calculo y reporta por este evento.
  room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
    onActiveSpeakersChanged?.(speakers.map((speaker) => speaker.identity));
  });

  await room.connect(url, token, { autoSubscribe: false });
  // Only fired once LiveKit's own resume/reconnect attempts are exhausted
  // (#84): a mere blip is `Reconnecting`/`Reconnected` and needs nothing
  // here. Listened to after `connect()`, whose own failure the caller gets
  // as a rejection instead.
  room.on(RoomEvent.Disconnected, () => {
    if (!closing) onDisconnected?.();
  });

  // El estado inicial no llega por evento: sin esto, un navegador que ya nace
  // bloqueado no se reporta hasta el primer cambio, que puede no ocurrir nunca.
  onAudioPlaybackChanged?.(room.canPlaybackAudio);
  // Same for a share already running in the space when joining it.
  arbitrateScreenShare();

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
    async setScreenShareEnabled(enabled) {
      if (!enabled) {
        await stopScreenShare();
        return false;
      }
      if (publicationsOf(room.localParticipant, Track.Source.ScreenShare).length > 0) return true;

      let tracks: Awaited<ReturnType<typeof room.localParticipant.createScreenTracks>>;
      try {
        // `audio: true` only OFFERS the checkbox: without it the capture is
        // video alone, which is a normal share and not a failure.
        tracks = await room.localParticipant.createScreenTracks({ audio: true });
      } catch {
        return false;
      }

      // The claim is taken AFTER the picker, not at the click: the picker can
      // stay open for a while, and a share started meanwhile must still be
      // outranked by this one, which is the later one.
      const name = screenShareTrackName(nextScreenShareClaim(screenShareClaims()));
      try {
        await Promise.all(tracks.map((track) => room.localParticipant.publishTrack(track, { name })));
        return true;
      } catch {
        for (const track of tracks) track.stop();
        await stopScreenShare();
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
      closing = true;
      sink.clear();
      await room.disconnect();
    },
  };
}
