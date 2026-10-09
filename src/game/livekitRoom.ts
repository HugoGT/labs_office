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
  type LocalVideoTrack,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type TrackProcessor,
  type TrackPublication,
} from 'livekit-client';
import type { AttachableTrack } from './attachableTrack';
import { loadBackgroundBlur as loadRealBackgroundBlur } from './backgroundBlur';
import type { CameraFilter } from './cameraFilter';
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

/**
 * The background blur, as this module needs it (`backgroundBlur.ts` is the
 * real one). A port so tests never load MediaPipe under jsdom.
 */
export interface BackgroundBlur {
  /** The library's own check, the authority once it is loaded. */
  supported(): boolean;
  /** A new processor per camera track: a track that stops destroys its processor. */
  createProcessor(): TrackProcessor<Track.Kind.Video>;
}

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
   * Filter for the own camera, applied on this machine before publishing.
   * Picked with the camera off it waits for the next camera on; with the
   * camera on it applies to the live track. Resolves the filter actually in
   * effect: `'none'` when blur failed (unsupported browser, MediaPipe that
   * did not load), and the camera keeps going without it.
   */
  setCameraFilter(filter: CameraFilter): Promise<CameraFilter>;
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
   * Whether anyone in the room, self included, publishes an unmuted track
   * (#144): Egress only starts a room composite once it can subscribe to one,
   * and fails with "Start signal not received" otherwise. Publications count
   * whether or not this client subscribes to them. Reported right after
   * connecting and then on every change.
   */
  onRoomMediaChanged?: (hasMedia: boolean) => void;
  /**
   * The room is gone for good and this connection is dead (#84): LiveKit gave
   * up reconnecting, or the server removed us. Never fired by our own
   * `disconnect()`. Without it a dead room keeps every button enabled, the
   * share picker opens and nothing is published, and no camera comes back.
   */
  onDisconnected?: () => void;
  /** Injectable for tests; by default the lazy `@livekit/track-processors`. */
  loadBackgroundBlur?: () => Promise<BackgroundBlur>;
  /**
   * The camera went on without the blur it was asked for (the library did
   * not load, the browser lacks support, or the processor did not start).
   * The filter is `'none'` from then on. Failures of `setCameraFilter`
   * itself are its result instead, never this callback.
   */
  onCameraFilterFailed?: () => void;
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
  onRoomMediaChanged,
  onDisconnected,
  loadBackgroundBlur = loadRealBackgroundBlur,
  onCameraFilterFailed,
}: ConnectLivekitRoomOptions): Promise<LivekitRoomConnection> {
  const room = createRoom();
  const sink = createRemoteAudioSink(audioContainer);
  let desiredAudio: readonly string[] = [];
  let desiredVideo: readonly string[] = [];
  let activeScreenSharer: string | null = null;
  let roomHasMedia: boolean | null = null;
  /** Set by our own `disconnect()`, which also makes the room emit `Disconnected`. */
  let closing = false;
  let cameraFilter: CameraFilter = 'none';
  /**
   * Camera toggles and filter changes run one at a time: each reads the
   * camera publication and may replace it, so two interleaved would each
   * decide from a state the other is about to change.
   */
  let cameraQueue: Promise<unknown> = Promise.resolve();

  function serializeCamera<T>(task: () => Promise<T>): Promise<T> {
    const run = cameraQueue.then(task, task);
    cameraQueue = run.catch(() => undefined);
    return run;
  }

  function cameraPublication(): TrackPublication | undefined {
    return publicationsOf(room.localParticipant, Track.Source.Camera)[0];
  }

  /**
   * `true` when the track ends up blurred. Any processor on a camera track
   * is a blur: it is the only one this module sets. On failure the track is
   * left as it was, raw and working.
   */
  async function blurTrack(track: LocalVideoTrack): Promise<boolean> {
    if (track.getProcessor()) return true;
    let processor: TrackProcessor<Track.Kind.Video> | undefined;
    try {
      const blur = await loadBackgroundBlur();
      if (!blur.supported()) return false;
      processor = blur.createProcessor();
      await track.setProcessor(processor);
      return true;
    } catch {
      // `setProcessor` only keeps a processor whose `init` resolved, so a
      // failed one is ours to clean up.
      void processor?.destroy().catch(() => undefined);
      return false;
    }
  }

  async function unblurTrack(track: LocalVideoTrack): Promise<void> {
    if (!track.getProcessor()) return;
    try {
      await track.stopProcessor();
    } catch {
      // Still blurred: harmless, and the next camera on tries again.
    }
  }

  /** Blur did not take while turning the camera on: it is off from now on, and the UI is told. */
  function blurFailedOnCameraOn(): void {
    cameraFilter = 'none';
    onCameraFilterFailed?.();
  }

  /**
   * Camera on with blur. Unmuting a track that has no processor would
   * publish the raw background until the processor started (MediaPipe can
   * take seconds to download), so such a track is replaced: a new one is
   * created, blurred, and only then published, which is what
   * `setCameraEnabled` does for a first camera minus the processor.
   * livekit-client's own `processor` capture option is not used because a
   * processor failing there leaves the captured camera running.
   */
  async function enableBlurredCamera(): Promise<void> {
    const publication = cameraPublication();
    const existing = publication?.track as LocalVideoTrack | undefined;
    if (existing && publication) {
      if (existing.getProcessor()) {
        // Unmuting restarts the processor on the new capture (`LocalTrack.setMediaStreamTrack`).
        await room.localParticipant.setCameraEnabled(true);
        return;
      }
      if (!publication.isMuted) {
        if (!(await blurTrack(existing))) blurFailedOnCameraOn();
        return;
      }
      await room.localParticipant.unpublishTrack(existing);
    }

    const tracks = await room.localParticipant.createTracks({ video: true });
    const track = tracks.find((candidate) => candidate.kind === Track.Kind.Video) as LocalVideoTrack | undefined;
    if (!track) {
      for (const candidate of tracks) candidate.stop();
      throw new Error('no camera track was created');
    }
    if (!(await blurTrack(track))) blurFailedOnCameraOn();
    try {
      await room.localParticipant.publishTrack(track);
    } catch (err) {
      track.stop();
      throw err;
    }
  }

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

  function reportRoomMedia(): void {
    const publishes = (participant: Participant) =>
      Array.from(participant.trackPublications.values()).some((publication) => !publication.isMuted);
    const hasMedia =
      publishes(room.localParticipant) || Array.from(room.remoteParticipants.values()).some(publishes);
    if (hasMedia === roomHasMedia) return;
    roomHasMedia = hasMedia;
    onRoomMediaChanged?.(hasMedia);
  }

  for (const event of [
    RoomEvent.TrackPublished,
    RoomEvent.TrackUnpublished,
    RoomEvent.TrackMuted,
    RoomEvent.TrackUnmuted,
    RoomEvent.LocalTrackPublished,
    RoomEvent.LocalTrackUnpublished,
    RoomEvent.ParticipantConnected,
    RoomEvent.ParticipantDisconnected,
  ]) {
    room.on(event, () => reportRoomMedia());
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
  reportRoomMedia();

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
    setCameraEnabled(enabled) {
      return serializeCamera(async () => {
        try {
          if (enabled && cameraFilter === 'blur') {
            await enableBlurredCamera();
            return true;
          }
          await room.localParticipant.setCameraEnabled(enabled);
          // No filter picked while it was off: the unmuted track restarted
          // its old processor, which is stopped now (blurred for a moment,
          // never the other way round).
          const track = cameraPublication()?.track as LocalVideoTrack | undefined;
          if (enabled && track) await unblurTrack(track);
          return enabled;
        } catch {
          return false;
        }
      });
    },
    setCameraFilter(filter) {
      return serializeCamera(async () => {
        cameraFilter = filter;
        const publication = cameraPublication();
        const track = publication?.track as LocalVideoTrack | undefined;
        // Camera off (no track, or a muted one): the next camera on applies it.
        if (!track || publication?.isMuted) return filter;
        if (filter === 'none') {
          await unblurTrack(track);
          return 'none';
        }
        if (await blurTrack(track)) return 'blur';
        cameraFilter = 'none';
        return 'none';
      });
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
