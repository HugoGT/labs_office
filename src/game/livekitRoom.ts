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
  AudioPresets,
  ConnectionQuality,
  DisconnectReason,
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
  supportsAudioOutputSelection,
} from 'livekit-client';
import type { AttachableTrack } from './attachableTrack';
import { loadBackgroundBlur as loadRealBackgroundBlur } from './backgroundBlur';
import { blurRadiusOf, isBlurFilter, type BlurFilter, type CameraFilter } from './cameraFilter';
import {
  DEVICE_KINDS,
  deviceListsOf,
  deviceLoss,
  mediaFailureOf,
  NO_DEVICES,
  resolveDevice,
  type DeviceInfoLike,
  type DeviceKind,
  type DeviceLists,
  type DevicePreferences,
  type MediaFailure,
} from './mediaDevices';
import { MEDIA_DISCONNECT_REASONS, type MediaDisconnectReason, type MediaEventMessage } from './officeProtocol';
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
  createProcessor(blurRadius: number): BlurProcessor;
}

/** A running blur changes strength in place, without tearing its pipeline down. */
export interface BlurProcessor extends TrackProcessor<Track.Kind.Video> {
  switchTo(options: { mode: 'background-blur'; blurRadius: number }): Promise<void>;
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
   * The one place that changes the microphone, speaker or camera in use
   * (#284), live tracks included. Resolves `false` when the device did not
   * take, after reporting why through `onDeviceFailed`.
   */
  switchDevice(kind: DeviceKind, deviceId: string): Promise<boolean>;
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
   * Carries what the disconnect reason calls for (#283, `disconnectReaction`).
   */
  onDisconnected?: (reaction: DisconnectReaction) => void;
  /**
   * LiveKit lost the connection and is retrying it by itself (`true`), or got
   * it back (`false`) (#283). A short outage, before any `onDisconnected`:
   * without it the person only hears silence with nothing explaining it.
   */
  onReconnectingChanged?: (reconnecting: boolean) => void;
  /**
   * What happened to this connection, for the server's metrics (#275):
   * connected and reconnected with how long it took, disconnected with the
   * reason's name. Never our own `disconnect()`, and nothing about who.
   */
  onMediaEvent?: (event: MediaEventMessage) => void;
  /** Quality LiveKit measures for the own connection (#275), on every change. */
  onConnectionQualityChanged?: (quality: ConnectionQualityLevel) => void;
  /** Clock for those durations; injectable for tests. */
  now?: () => number;
  /** Injectable for tests; by default the lazy `@livekit/track-processors`. */
  loadBackgroundBlur?: () => Promise<BackgroundBlur>;
  /**
   * The camera went on without the blur it was asked for (the library did
   * not load, the browser lacks support, or the processor did not start).
   * The filter is `'none'` from then on. Failures of `setCameraFilter`
   * itself are its result instead, never this callback.
   */
  onCameraFilterFailed?: () => void;
  /**
   * The own microphone was muted by somebody else (#282): a moderator, through
   * the server's `mutePublishedTrack`. livekit-client mutes the track by
   * itself; this only tells the caller, whose button would stay lit
   * otherwise. Never called for this client's own `setMicrophoneEnabled`.
   */
  onMicrophoneMutedRemotely?: () => void;
  /**
   * Devices picked in this browser (#284), applied before connecting. The
   * microphone and camera are a preference, not exact: one unplugged since
   * falls back to the system's instead of failing.
   */
  preferredDevices?: DevicePreferences;
  /** Injectable for tests; by default livekit-client's listing, which never prompts. */
  listDevices?: () => Promise<readonly DeviceInfoLike[]>;
  /** Where `devicechange` fires; injectable for tests, `null` where the browser has no media devices. */
  deviceEvents?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null;
  /** Devices by kind, right after connecting, on every device change, and once a permission names them. */
  onDevicesChanged?: (devices: DeviceLists) => void;
  /** The device in use was disconnected; the room already moved to the fallback (#284). */
  onDeviceLost?: (kind: DeviceKind) => void;
  /** A device could not be turned on or switched to, and why (#284). */
  onDeviceFailed?: (kind: DeviceKind, failure: MediaFailure) => void;
}

/**
 * Whether this browser can pick where remote audio plays (`setSinkId`):
 * Firefox and Safari did not for a long time, and without it the speaker
 * selector is not shown.
 */
export function audioOutputSelectionSupported(): boolean {
  return supportsAudioOutputSelection();
}

function browserDeviceEvents(): Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null {
  return typeof navigator === 'undefined' ? null : (navigator.mediaDevices ?? null);
}

/** livekit-client's `ConnectionQuality` values, as plain strings for the UI. */
export type ConnectionQualityLevel = 'excellent' | 'good' | 'poor' | 'lost' | 'unknown';

const QUALITY_LEVELS: Record<ConnectionQuality, ConnectionQualityLevel> = {
  [ConnectionQuality.Excellent]: 'excellent',
  [ConnectionQuality.Good]: 'good',
  [ConnectionQuality.Poor]: 'poor',
  [ConnectionQuality.Lost]: 'lost',
  [ConnectionQuality.Unknown]: 'unknown',
};

/** The reason's enum name, the label the server counts it by (`mediaEventOf`). */
function disconnectReasonName(reason: DisconnectReason | undefined): MediaDisconnectReason {
  const name = reason === undefined ? undefined : DisconnectReason[reason];
  return MEDIA_DISCONNECT_REASONS.find((known) => known === name) ?? 'UNKNOWN_REASON';
}

/** What a disconnect calls for (#283); `ignore` never reaches `onDisconnected`. */
export type DisconnectReaction = 'ignore' | 'stop' | 'rebuild';

/**
 * The SDK does not reconnect after emitting `Disconnected`, so a room comes
 * back only when this client rebuilds it. That is right for an outage and
 * wrong when the server removed us (#282) or the same identity joined from
 * elsewhere: rebuilding would undo exactly what happened. `ROOM_DELETED` and
 * `ROOM_CLOSED` are rebuilt too: nothing here closes rooms on purpose, and the
 * room name of a place does not change.
 */
export function disconnectReaction(reason: DisconnectReason | undefined): DisconnectReaction {
  switch (reason) {
    case DisconnectReason.CLIENT_INITIATED:
      return 'ignore';
    case DisconnectReason.PARTICIPANT_REMOVED:
    case DisconnectReason.DUPLICATE_IDENTITY:
      return 'stop';
    default:
      return 'rebuild';
  }
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

/**
 * A space puts every occupant's camera and share on every screen, mostly as
 * small tiles. `adaptiveStream` subscribes each video at the layer its
 * attached element shows (and pauses it while hidden), so a tile pulls a low
 * simulcast layer instead of the top one; `dynacast` stops the publisher
 * encoding layers nobody receives. Both cut SFU egress and viewers' decoding
 * in a full space. Needs videos attached through `track.attach()`, which
 * `VideoTile` does.
 */
/**
 * The microphone uses the speech preset (24 kbps instead of the SDK's 48 kbps
 * music default, #281): voice loses nothing audible and leaves more headroom
 * on a bad network. Shared screen audio overrides it back to music, see
 * `setScreenShareEnabled`. Every value and its reason: `docs/media-profile.md`.
 */
export function createOfficeRoom(): Room {
  return new Room({
    adaptiveStream: true,
    dynacast: true,
    publishDefaults: { audioPreset: AudioPresets.speech },
  });
}

export async function connectLivekitRoom({
  url,
  token,
  createRoom = createOfficeRoom,
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
  onReconnectingChanged,
  onMediaEvent,
  onConnectionQualityChanged,
  now = () => performance.now(),
  loadBackgroundBlur = loadRealBackgroundBlur,
  onCameraFilterFailed,
  onMicrophoneMutedRemotely,
  preferredDevices,
  listDevices = () => Room.getLocalDevices(undefined, false),
  deviceEvents = browserDeviceEvents(),
  onDevicesChanged,
  onDeviceLost,
  onDeviceFailed,
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

  /**
   * Same for the microphone (#277): a mute clicked while the unmute of a
   * room just joined is still publishing would otherwise race it, and the
   * microphone could stay open after the last click said off.
   */
  let microphoneQueue: Promise<unknown> = Promise.resolve();

  /** Own microphone calls running: a mute while one runs is this client's own. */
  let ownMicrophoneCalls = 0;

  function serializeMicrophone<T>(task: () => Promise<T>): Promise<T> {
    const run = microphoneQueue.then(task, task);
    microphoneQueue = run.catch(() => undefined);
    return run;
  }

  /** Latest listing: a device can only be lost if it was in it. */
  let listedDevices: DeviceLists = NO_DEVICES;

  /** `null` when the browser would not list them: nothing is decided from that. */
  async function refreshDevices(): Promise<DeviceLists | null> {
    let devices: DeviceLists;
    try {
      devices = deviceListsOf(await listDevices());
    } catch {
      return null;
    }
    if (closing) return null;
    listedDevices = devices;
    onDevicesChanged?.(devices);
    return devices;
  }

  /**
   * Switches a device, in the queue of the track it changes: a switch and a
   * toggle of the same microphone must not restart its track at once. The
   * speaker has no local track, so nothing to wait for.
   */
  function switchDevice(kind: DeviceKind, deviceId: string, exact: boolean): Promise<boolean> {
    const task = async () => {
      try {
        return await room.switchActiveDevice(kind, deviceId, exact);
      } catch (err) {
        onDeviceFailed?.(kind, mediaFailureOf(err));
        return false;
      }
    };
    if (kind === 'audioinput') return serializeMicrophone(task);
    if (kind === 'videoinput') return serializeCamera(task);
    return task();
  }

  /**
   * On every `devicechange`. The device in use is read right away, before
   * livekit-client's own handler of the same event (it lists devices first)
   * can move it: that is the one that was unplugged, if any.
   */
  function handleDeviceChange(): void {
    const before = new Map(DEVICE_KINDS.map((kind) => [kind, room.getActiveDevice(kind)]));
    const previous = listedDevices;
    void (async () => {
      const devices = await refreshDevices();
      if (devices === null) return;
      for (const kind of DEVICE_KINDS) {
        const { lost, switchTo } = deviceLoss(
          before.get(kind),
          room.getActiveDevice(kind),
          previous[kind],
          devices[kind],
        );
        if (!lost) continue;
        if (switchTo !== null) await switchDevice(kind, switchTo, true);
        if (closing) return;
        onDeviceLost?.(kind);
      }
    })();
  }

  function cameraPublication(): TrackPublication | undefined {
    return publicationsOf(room.localParticipant, Track.Source.Camera)[0];
  }

  /**
   * `true` when the track ends up blurred at `filter`'s strength. Any
   * processor on a camera track is a blur: it is the only one this module
   * sets, so a running one only switches strength. On failure the track is
   * left raw and working.
   */
  async function blurTrack(track: LocalVideoTrack, filter: BlurFilter): Promise<boolean> {
    const blurRadius = blurRadiusOf(filter);
    const running = track.getProcessor() as BlurProcessor | undefined;
    if (running) {
      try {
        await running.switchTo({ mode: 'background-blur', blurRadius });
        return true;
      } catch {
        // Neither strength is sure anymore: no filter is the honest state.
        await unblurTrack(track);
        return false;
      }
    }
    let processor: BlurProcessor | undefined;
    try {
      const blur = await loadBackgroundBlur();
      if (!blur.supported()) return false;
      processor = blur.createProcessor(blurRadius);
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
  async function enableBlurredCamera(filter: BlurFilter): Promise<void> {
    const publication = cameraPublication();
    const existing = publication?.track as LocalVideoTrack | undefined;
    if (existing && publication) {
      if (existing.getProcessor()) {
        // Unmuting restarts the processor on the new capture
        // (`LocalTrack.setMediaStreamTrack`); then it takes the strength
        // picked while the camera was off, if that changed.
        await room.localParticipant.setCameraEnabled(true);
        if (!(await blurTrack(existing, filter))) blurFailedOnCameraOn();
        return;
      }
      if (!publication.isMuted) {
        if (!(await blurTrack(existing, filter))) blurFailedOnCameraOn();
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
    if (!(await blurTrack(track, filter))) blurFailedOnCameraOn();
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
  // A server mute (#282) reaches livekit-client as a `mute` signal, which
  // mutes the publication and emits `TrackMuted` for the local participant,
  // the same event as an own mute: only the call counter tells them apart.
  room.on(RoomEvent.TrackMuted, (publication: TrackPublication, participant: Participant) => {
    if (participant !== room.localParticipant || publication.source !== Track.Source.Microphone) return;
    if (ownMicrophoneCalls > 0) return;
    onMicrophoneMutedRemotely?.();
  });

  // D7: unica fuente de habla. No lee `micOn` ni ningun umbral de audioLevel
  // propio -- solo lo que LiveKit ya calculo y reporta por este evento.
  room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
    onActiveSpeakersChanged?.(speakers.map((speaker) => speaker.identity));
  });

  room.on(RoomEvent.ConnectionQualityChanged, (quality: ConnectionQuality, participant: Participant) => {
    if (participant !== room.localParticipant) return;
    onConnectionQualityChanged?.(QUALITY_LEVELS[quality] ?? 'unknown');
  });

  // Before connecting, so the first microphone or camera on already uses
  // them. Without tracks yet, this only sets the capture defaults.
  for (const kind of ['audioinput', 'videoinput'] as const) {
    const deviceId = preferredDevices?.[kind];
    if (deviceId) await switchDevice(kind, deviceId, false);
  }
  deviceEvents?.addEventListener('devicechange', handleDeviceChange);
  // A speaker is set on each remote audio element: only one connected now
  // is worth it, or every element would fail to play through it.
  void refreshDevices().then((devices) => {
    const speaker = preferredDevices?.audiooutput;
    if (!devices || !speaker || resolveDevice(speaker, devices.audiooutput) !== speaker) return;
    void switchDevice('audiooutput', speaker, true);
  });

  const connectStartedAt = now();
  try {
    await room.connect(url, token, { autoSubscribe: false });
  } catch (err) {
    deviceEvents?.removeEventListener('devicechange', handleDeviceChange);
    throw err;
  }
  onMediaEvent?.({ event: 'connected', durationMs: now() - connectStartedAt });
  // Only fired once LiveKit's own resume/reconnect attempts are exhausted
  // (#84): a mere blip is `Reconnecting`/`Reconnected` and needs nothing
  // here. Listened to after `connect()`, whose own failure the caller gets
  // as a rejection instead.
  room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
    if (closing) return;
    onMediaEvent?.({ event: 'disconnected', reason: disconnectReasonName(reason) });
    const reaction = disconnectReaction(reason);
    if (reaction !== 'ignore') onDisconnected?.(reaction);
  });
  let reconnectingSince: number | null = null;
  room.on(RoomEvent.Reconnecting, () => {
    reconnectingSince = now();
    onReconnectingChanged?.(true);
  });
  room.on(RoomEvent.Reconnected, () => {
    if (reconnectingSince !== null) {
      onMediaEvent?.({ event: 'reconnected', durationMs: now() - reconnectingSince });
      reconnectingSince = null;
    }
    onReconnectingChanged?.(false);
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
    setMicrophoneEnabled(enabled) {
      return serializeMicrophone(async () => {
        ownMicrophoneCalls += 1;
        try {
          await room.localParticipant.setMicrophoneEnabled(enabled);
          // The permission just granted gives the devices their names.
          if (enabled) void refreshDevices();
          return enabled;
        } catch (err) {
          // Includes livekit-client 2.22.3 giving up after 15 s on a publish
          // started while the signal was reconnecting (it stops the track).
          if (enabled) onDeviceFailed?.('audioinput', mediaFailureOf(err));
          return false;
        } finally {
          ownMicrophoneCalls -= 1;
        }
      });
    },
    setCameraEnabled(enabled) {
      return serializeCamera(async () => {
        try {
          if (enabled && isBlurFilter(cameraFilter)) {
            await enableBlurredCamera(cameraFilter);
            void refreshDevices();
            return true;
          }
          await room.localParticipant.setCameraEnabled(enabled);
          // No filter picked while it was off: the unmuted track restarted
          // its old processor, which is stopped now (blurred for a moment,
          // never the other way round).
          const track = cameraPublication()?.track as LocalVideoTrack | undefined;
          if (enabled && track) await unblurTrack(track);
          if (enabled) void refreshDevices();
          return enabled;
        } catch (err) {
          // Only the camera: its failure never touches the microphone.
          if (enabled) onDeviceFailed?.('videoinput', mediaFailureOf(err));
          return false;
        }
      });
    },
    switchDevice(kind, deviceId) {
      return switchDevice(kind, deviceId, true);
    },
    setCameraFilter(filter) {
      return serializeCamera(async () => {
        cameraFilter = filter;
        const publication = cameraPublication();
        const track = publication?.track as LocalVideoTrack | undefined;
        // Camera off (no track, or a muted one): the next camera on applies it.
        if (!track || publication?.isMuted) return filter;
        if (!isBlurFilter(filter)) {
          await unblurTrack(track);
          return 'none';
        }
        if (await blurTrack(track, filter)) return filter;
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
        // `detail` (#281): the usual share is a document, so the encoder
        // keeps resolution and drops frame rate under pressure.
        tracks = await room.localParticipant.createScreenTracks({ audio: true, contentHint: 'detail' });
      } catch {
        return false;
      }

      // The claim is taken AFTER the picker, not at the click: the picker can
      // stay open for a while, and a share started meanwhile must still be
      // outranked by this one, which is the later one.
      const name = screenShareTrackName(nextScreenShareClaim(screenShareClaims()));
      try {
        // A shared video's soundtrack is not speech: keep the music preset.
        await Promise.all(
          tracks.map((track) =>
            room.localParticipant.publishTrack(
              track,
              track.kind === Track.Kind.Audio ? { name, audioPreset: AudioPresets.music } : { name },
            ),
          ),
        );
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
      deviceEvents?.removeEventListener('devicechange', handleDeviceChange);
      sink.clear();
      await room.disconnect();
    },
  };
}
