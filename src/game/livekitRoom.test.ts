import { Room, RoomEvent } from 'livekit-client';
import { describe, expect, it, vi } from 'vitest';
import type { AttachableTrack } from './attachableTrack';
import { connectLivekitRoom } from './livekitRoom';

/**
 * Sala falsa: reproduce solo la superficie de `Room` que este modulo usa. El
 * hallazgo de slice 1 (documentado en `livekitRoom.ts`) es que lo unico hostil
 * bajo jsdom es `room.connect()`, asi que inyectando la sala por `createRoom`
 * el CABLEADO de eventos se prueba entero aqui, sin servidor. Lo que sigue
 * necesitando un LiveKit real -- que el sonido salga de verdad -- vive en
 * `livekitRoom.browser.test.ts`.
 */
function fakeRoom() {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  const room = {
    remoteParticipants: new Map(),
    canPlaybackAudio: true,
    startAudio: vi.fn(async () => undefined),
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    localParticipant: {
      identity: 'yo',
      trackPublications: new Map<string, ReturnType<typeof fakePublication>>(),
      setMicrophoneEnabled: vi.fn(async () => undefined),
      setCameraEnabled: vi.fn(async () => undefined),
      setScreenShareEnabled: vi.fn(async () => undefined),
      createScreenTracks: vi.fn(async (): Promise<ReturnType<typeof fakeLocalTrack>[]> => []),
      publishTrack: vi.fn(async () => undefined),
      unpublishTrack: vi.fn(async () => undefined),
    },
    on(event: string, handler: (...args: unknown[]) => void) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return room;
    },
    emit(event: string, ...args: unknown[]) {
      for (const handler of handlers.get(event) ?? []) handler(...args);
    },
  };
  return room;
}

function fakeTrack(kind: 'audio' | 'video' = 'audio'): AttachableTrack {
  const elements: HTMLMediaElement[] = [];
  return {
    kind,
    attach() {
      const element = document.createElement(kind === 'audio' ? 'audio' : 'video');
      elements.push(element);
      return element;
    },
    detach: () => elements.splice(0),
  };
}

/**
 * Publicacion falsa que refleja su propio `isSubscribed` cuando `setSubscribed`
 * se invoca -- necesario para probar que `reconcileKind` observa el estado
 * VIVO (D2) en vez de asumirlo, igual que hace el `reconcile()` de audio.
 */
function fakePublication(
  kind: 'audio' | 'video',
  {
    source,
    trackName,
    track,
    isMuted = false,
  }: { source?: string; trackName?: string; track?: unknown; isMuted?: boolean } = {},
) {
  const publication = {
    kind,
    source,
    trackName,
    track,
    isMuted,
    isSubscribed: false,
    setSubscribed: vi.fn((value: boolean) => {
      publication.isSubscribed = value;
    }),
  };
  return publication;
}

function fakeParticipant(publications: ReturnType<typeof fakePublication>[]) {
  return {
    trackPublications: new Map(publications.map((publication, i) => [`pub${i}`, publication])),
  };
}

function connect(room: ReturnType<typeof fakeRoom>, container: HTMLElement) {
  return connectLivekitRoom({
    url: 'ws://localhost:7880',
    token: 'jwt',
    createRoom: () => room as unknown as Room,
    audioContainer: container,
  });
}

describe('connectLivekitRoom (cableado de reproduccion, #18)', () => {
  it('TrackSubscribed adjunta la pista al DOM: sin esto la suscripcion es silencio', async () => {
    const container = document.createElement('div');
    const room = fakeRoom();
    await connect(room, container);

    room.emit(RoomEvent.TrackSubscribed, fakeTrack(), undefined, { identity: 'p1' });

    expect(container.querySelectorAll('audio')).toHaveLength(1);
  });

  it('la pista adjunta lleva la identidad del participante que la publica (D3, spec "remote-audio-playback")', async () => {
    const container = document.createElement('div');
    const room = fakeRoom();
    await connect(room, container);

    room.emit(RoomEvent.TrackSubscribed, fakeTrack(), undefined, { identity: 'p1' });

    const [element] = container.querySelectorAll('audio');
    expect(element.dataset.sessionId).toBe('p1');
  });

  it('TrackUnsubscribed retira el elemento: salir del radio corta el audio', async () => {
    const container = document.createElement('div');
    const room = fakeRoom();
    await connect(room, container);
    const track = fakeTrack();

    room.emit(RoomEvent.TrackSubscribed, track, undefined, { identity: 'p1' });
    room.emit(RoomEvent.TrackUnsubscribed, track, undefined, { identity: 'p1' });

    expect(container.querySelectorAll('audio')).toHaveLength(0);
  });

  it('disconnect no deja elementos adjuntos detras', async () => {
    const container = document.createElement('div');
    const room = fakeRoom();
    const connection = await connect(room, container);

    room.emit(RoomEvent.TrackSubscribed, fakeTrack(), undefined, { identity: 'p1' });
    await connection.disconnect();

    expect(container.querySelectorAll('audio')).toHaveLength(0);
    expect(room.disconnect).toHaveBeenCalledTimes(1);
  });

  it('avisa cuando el navegador bloquea la reproduccion (politica de autoplay)', async () => {
    const room = fakeRoom();
    const onAudioPlaybackChanged = vi.fn();
    await connectLivekitRoom({
      url: 'ws://localhost:7880',
      token: 'jwt',
      createRoom: () => room as unknown as Room,
      onAudioPlaybackChanged,
    });

    room.canPlaybackAudio = false;
    room.emit(RoomEvent.AudioPlaybackStatusChanged);

    expect(onAudioPlaybackChanged).toHaveBeenLastCalledWith(false);
  });

  it('avisa tambien al desbloquearse, para que el HUD retire el aviso', async () => {
    const room = fakeRoom();
    const onAudioPlaybackChanged = vi.fn();
    await connectLivekitRoom({
      url: 'ws://localhost:7880',
      token: 'jwt',
      createRoom: () => room as unknown as Room,
      onAudioPlaybackChanged,
    });

    room.canPlaybackAudio = false;
    room.emit(RoomEvent.AudioPlaybackStatusChanged);
    room.canPlaybackAudio = true;
    room.emit(RoomEvent.AudioPlaybackStatusChanged);

    expect(onAudioPlaybackChanged).toHaveBeenLastCalledWith(true);
  });

  it('startAudio delega en la sala: es el gesto de usuario que exige el navegador', async () => {
    const room = fakeRoom();
    const connection = await connect(room, document.createElement('div'));

    await connection.startAudio();

    expect(room.startAudio).toHaveBeenCalledTimes(1);
  });

  it('un startAudio rechazado no lanza: el aviso del HUD sigue en pie', async () => {
    const room = fakeRoom();
    room.startAudio.mockRejectedValueOnce(new Error('gesture required'));
    const connection = await connect(room, document.createElement('div'));

    await expect(connection.startAudio()).resolves.toBeUndefined();
  });
});

describe('reconciliacion consciente del kind (issue #17): audio y video son deltas independientes', () => {
  it('retirar el peer del video deseado desuscribe SOLO su publicacion de video: el audio sigue', async () => {
    const audioPub = fakePublication('audio');
    const videoPub = fakePublication('video');
    const room = fakeRoom();
    room.remoteParticipants.set('p1', fakeParticipant([audioPub, videoPub]));
    const connection = await connect(room, document.createElement('div'));

    connection.setDesiredAudioPeers(['p1']);
    connection.setDesiredVideoPeers(['p1']);
    expect(audioPub.isSubscribed).toBe(true);
    expect(videoPub.isSubscribed).toBe(true);

    connection.setDesiredVideoPeers([]);

    expect(videoPub.isSubscribed).toBe(false);
    expect(audioPub.isSubscribed).toBe(true);
  });

  it('retirar el peer del audio deseado desuscribe SOLO su publicacion de audio: el video sigue', async () => {
    const audioPub = fakePublication('audio');
    const videoPub = fakePublication('video');
    const room = fakeRoom();
    room.remoteParticipants.set('p1', fakeParticipant([audioPub, videoPub]));
    const connection = await connect(room, document.createElement('div'));

    connection.setDesiredAudioPeers(['p1']);
    connection.setDesiredVideoPeers(['p1']);
    expect(audioPub.isSubscribed).toBe(true);
    expect(videoPub.isSubscribed).toBe(true);

    connection.setDesiredAudioPeers([]);

    expect(audioPub.isSubscribed).toBe(false);
    expect(videoPub.isSubscribed).toBe(true);
  });
});

describe('video, camara local y habla llegan hacia afuera (issue #17, D3/D7): livekitRoom REPORTA, nunca adjunta video', () => {
  it('onVideoTrackSubscribed dispara solo para pistas de video, con la identidad de quien la publica', async () => {
    const room = fakeRoom();
    const onVideoTrackSubscribed = vi.fn();
    await connectLivekitRoom({
      url: 'ws://localhost:7880',
      token: 'jwt',
      createRoom: () => room as unknown as Room,
      onVideoTrackSubscribed,
    });
    const audioTrack = fakeTrack('audio');
    const videoTrack = fakeTrack('video');

    room.emit(RoomEvent.TrackSubscribed, audioTrack, undefined, { identity: 'p1' });
    room.emit(RoomEvent.TrackSubscribed, videoTrack, undefined, { identity: 'p1' });

    expect(onVideoTrackSubscribed).toHaveBeenCalledTimes(1);
    expect(onVideoTrackSubscribed).toHaveBeenCalledWith('p1', videoTrack);
  });

  it('onVideoTrackUnsubscribed dispara solo para pistas de video, con la misma identidad', async () => {
    const room = fakeRoom();
    const onVideoTrackUnsubscribed = vi.fn();
    await connectLivekitRoom({
      url: 'ws://localhost:7880',
      token: 'jwt',
      createRoom: () => room as unknown as Room,
      onVideoTrackUnsubscribed,
    });
    const audioTrack = fakeTrack('audio');
    const videoTrack = fakeTrack('video');

    room.emit(RoomEvent.TrackUnsubscribed, audioTrack, undefined, { identity: 'p1' });
    room.emit(RoomEvent.TrackUnsubscribed, videoTrack, undefined, { identity: 'p1' });

    expect(onVideoTrackUnsubscribed).toHaveBeenCalledTimes(1);
    expect(onVideoTrackUnsubscribed).toHaveBeenCalledWith('p1', videoTrack);
  });

  it('onLocalVideoTrackChanged reporta la pista al publicarse la camara local', async () => {
    const room = fakeRoom();
    const onLocalVideoTrackChanged = vi.fn();
    await connectLivekitRoom({
      url: 'ws://localhost:7880',
      token: 'jwt',
      createRoom: () => room as unknown as Room,
      onLocalVideoTrackChanged,
    });
    const localTrack = fakeTrack('video');

    room.emit(RoomEvent.LocalTrackPublished, { kind: 'video', track: localTrack });

    expect(onLocalVideoTrackChanged).toHaveBeenCalledWith(localTrack);
  });

  it('onLocalVideoTrackChanged reporta null al despublicarse la camara: no queda huerfano el ultimo valor', async () => {
    const room = fakeRoom();
    const onLocalVideoTrackChanged = vi.fn();
    await connectLivekitRoom({
      url: 'ws://localhost:7880',
      token: 'jwt',
      createRoom: () => room as unknown as Room,
      onLocalVideoTrackChanged,
    });

    room.emit(RoomEvent.LocalTrackPublished, { kind: 'video', track: fakeTrack('video') });
    room.emit(RoomEvent.LocalTrackUnpublished, { kind: 'video' });

    expect(onLocalVideoTrackChanged).toHaveBeenLastCalledWith(null);
  });

  it('publicar/despublicar audio local nunca dispara onLocalVideoTrackChanged: el gate es por kind, no por "es local"', async () => {
    const room = fakeRoom();
    const onLocalVideoTrackChanged = vi.fn();
    await connectLivekitRoom({
      url: 'ws://localhost:7880',
      token: 'jwt',
      createRoom: () => room as unknown as Room,
      onLocalVideoTrackChanged,
    });

    room.emit(RoomEvent.LocalTrackPublished, { kind: 'audio', track: fakeTrack('audio') });
    room.emit(RoomEvent.LocalTrackUnpublished, { kind: 'audio' });

    expect(onLocalVideoTrackChanged).not.toHaveBeenCalled();
  });

  it('onActiveSpeakersChanged mapea los participantes reportados a sus identidades', async () => {
    const room = fakeRoom();
    const onActiveSpeakersChanged = vi.fn();
    await connectLivekitRoom({
      url: 'ws://localhost:7880',
      token: 'jwt',
      createRoom: () => room as unknown as Room,
      onActiveSpeakersChanged,
    });

    room.emit(RoomEvent.ActiveSpeakersChanged, [{ identity: 'p1' }, { identity: 'yo' }]);

    expect(onActiveSpeakersChanged).toHaveBeenCalledWith(['p1', 'yo']);
  });

  it('un arreglo vacio de speakers tambien se reporta: nadie habla ya no puede quedar colgado del ultimo valor', async () => {
    const room = fakeRoom();
    const onActiveSpeakersChanged = vi.fn();
    await connectLivekitRoom({
      url: 'ws://localhost:7880',
      token: 'jwt',
      createRoom: () => room as unknown as Room,
      onActiveSpeakersChanged,
    });

    room.emit(RoomEvent.ActiveSpeakersChanged, [{ identity: 'p1' }]);
    room.emit(RoomEvent.ActiveSpeakersChanged, []);

    expect(onActiveSpeakersChanged).toHaveBeenLastCalledWith([]);
  });

  it('guarda contra micOn: activar el microfono real jamas dispara onActiveSpeakersChanged (D7, tarea 2.9)', async () => {
    const room = fakeRoom();
    const onActiveSpeakersChanged = vi.fn();
    const connection = await connectLivekitRoom({
      url: 'ws://localhost:7880',
      token: 'jwt',
      createRoom: () => room as unknown as Room,
      onActiveSpeakersChanged,
    });

    await connection.setMicrophoneEnabled(true);

    expect(onActiveSpeakersChanged).not.toHaveBeenCalled();
  });
});

/** Captured screen track, as `createScreenTracks` returns it. */
function fakeLocalTrack(source: 'screen_share' | 'screen_share_audio') {
  return { source, kind: source === 'screen_share' ? 'video' : 'audio', stop: vi.fn() };
}

/** Subscribed remote track carrying its LiveKit source. */
function fakeSourcedTrack(source: string): AttachableTrack & { source: string } {
  return { ...fakeTrack(source === 'screen_share_audio' ? 'audio' : 'video'), source };
}

/** Puts a share in the local participant's publications, as the SDK does before `LocalTrackPublished`. */
function publishLocalShare(room: ReturnType<typeof fakeRoom>, claim: number) {
  const track = fakeSourcedTrack('screen_share');
  const publication = fakePublication('video', {
    source: 'screen_share',
    trackName: `screen_share#${claim}`,
    track,
  });
  room.localParticipant.trackPublications.set('local-screen', publication);
  room.emit(RoomEvent.LocalTrackPublished, publication);
  return publication;
}

/** A peer of the same room publishing a share (`TrackPublished`, not yet subscribed). */
function publishRemoteShare(room: ReturnType<typeof fakeRoom>, identity: string, claim: number) {
  const publication = fakePublication('video', {
    source: 'screen_share',
    trackName: `screen_share#${claim}`,
  });
  room.remoteParticipants.set(identity, fakeParticipant([publication]));
  room.emit(RoomEvent.TrackPublished, publication, { identity });
  return publication;
}

describe('per-publication reconcile (#20): a share next to the camera is subscribed too', () => {
  it('a screen share published after the camera was subscribed gets subscribed', async () => {
    const cameraPub = fakePublication('video', { source: 'camera' });
    const room = fakeRoom();
    const participant = fakeParticipant([cameraPub]);
    room.remoteParticipants.set('p1', participant);
    const connection = await connect(room, document.createElement('div'));
    connection.setDesiredVideoPeers(['p1']);
    expect(cameraPub.isSubscribed).toBe(true);

    const screenPub = fakePublication('video', { source: 'screen_share' });
    participant.trackPublications.set('screen', screenPub);
    room.emit(RoomEvent.TrackPublished, screenPub, participant);

    expect(screenPub.isSubscribed).toBe(true);
    // The camera is not asked for again: only what is missing is requested.
    expect(cameraPub.setSubscribed).toHaveBeenCalledTimes(1);
  });

  it('screen share audio published after the microphone was subscribed gets subscribed', async () => {
    const micPub = fakePublication('audio', { source: 'microphone' });
    const room = fakeRoom();
    const participant = fakeParticipant([micPub]);
    room.remoteParticipants.set('p1', participant);
    const connection = await connect(room, document.createElement('div'));
    connection.setDesiredAudioPeers(['p1']);

    const screenAudioPub = fakePublication('audio', { source: 'screen_share_audio' });
    participant.trackPublications.set('screen-audio', screenAudioPub);
    room.emit(RoomEvent.TrackPublished, screenAudioPub, participant);

    expect(screenAudioPub.isSubscribed).toBe(true);
  });

  it('screen share audio plays through the same sink as voice (#18)', async () => {
    const container = document.createElement('div');
    const room = fakeRoom();
    await connect(room, container);

    room.emit(RoomEvent.TrackSubscribed, fakeSourcedTrack('screen_share_audio'), undefined, { identity: 'p1' });

    expect(container.querySelectorAll('audio')).toHaveLength(1);
  });
});

describe('screen share tracks are reported apart from the camera (#20)', () => {
  it('a subscribed share goes to onScreenShareTrackSubscribed, never replacing the camera', async () => {
    const room = fakeRoom();
    const onVideoTrackSubscribed = vi.fn();
    const onScreenShareTrackSubscribed = vi.fn();
    await connectLivekitRoom({
      url: 'ws://localhost:7880',
      token: 'jwt',
      createRoom: () => room as unknown as Room,
      onVideoTrackSubscribed,
      onScreenShareTrackSubscribed,
    });
    const screen = fakeSourcedTrack('screen_share');

    room.emit(RoomEvent.TrackSubscribed, screen, undefined, { identity: 'p1' });

    expect(onScreenShareTrackSubscribed).toHaveBeenCalledWith('p1', screen);
    expect(onVideoTrackSubscribed).not.toHaveBeenCalled();
  });

  it('an unsubscribed share goes to onScreenShareTrackUnsubscribed', async () => {
    const room = fakeRoom();
    const onVideoTrackUnsubscribed = vi.fn();
    const onScreenShareTrackUnsubscribed = vi.fn();
    await connectLivekitRoom({
      url: 'ws://localhost:7880',
      token: 'jwt',
      createRoom: () => room as unknown as Room,
      onVideoTrackUnsubscribed,
      onScreenShareTrackUnsubscribed,
    });
    const screen = fakeSourcedTrack('screen_share');

    room.emit(RoomEvent.TrackUnsubscribed, screen, undefined, { identity: 'p1' });

    expect(onScreenShareTrackUnsubscribed).toHaveBeenCalledWith('p1', screen);
    expect(onVideoTrackUnsubscribed).not.toHaveBeenCalled();
  });

  it('the own share is reported on its own callback, not as the camera', async () => {
    const room = fakeRoom();
    const onLocalVideoTrackChanged = vi.fn();
    const onLocalScreenShareChanged = vi.fn();
    await connectLivekitRoom({
      url: 'ws://localhost:7880',
      token: 'jwt',
      createRoom: () => room as unknown as Room,
      onLocalVideoTrackChanged,
      onLocalScreenShareChanged,
    });

    const publication = publishLocalShare(room, 1);

    expect(onLocalScreenShareChanged).toHaveBeenCalledWith(publication.track);
    expect(onLocalVideoTrackChanged).not.toHaveBeenCalled();
  });

  it('ending the share (our button or the browser bar) reports null and leaves no audio published', async () => {
    const room = fakeRoom();
    const onLocalScreenShareChanged = vi.fn();
    await connectLivekitRoom({
      url: 'ws://localhost:7880',
      token: 'jwt',
      createRoom: () => room as unknown as Room,
      onLocalScreenShareChanged,
    });
    const publication = publishLocalShare(room, 1);
    const audioTrack = fakeSourcedTrack('screen_share_audio');
    room.localParticipant.trackPublications.set(
      'local-screen-audio',
      fakePublication('audio', { source: 'screen_share_audio', track: audioTrack }),
    );

    // The SDK unpublishes the video on its own when the browser ends it.
    room.localParticipant.trackPublications.delete('local-screen');
    room.emit(RoomEvent.LocalTrackUnpublished, publication);

    expect(onLocalScreenShareChanged).toHaveBeenLastCalledWith(null);
    expect(room.localParticipant.unpublishTrack).toHaveBeenCalledWith(audioTrack);
  });
});

describe('setScreenShareEnabled (#20)', () => {
  it('captures with audio offered and publishes every track with the next claim', async () => {
    const room = fakeRoom();
    const video = fakeLocalTrack('screen_share');
    const audio = fakeLocalTrack('screen_share_audio');
    room.localParticipant.createScreenTracks.mockResolvedValueOnce([video, audio]);
    const connection = await connect(room, document.createElement('div'));
    publishRemoteShare(room, 'p1', 4);

    await expect(connection.setScreenShareEnabled(true)).resolves.toBe(true);

    expect(room.localParticipant.createScreenTracks).toHaveBeenCalledWith({ audio: true });
    expect(room.localParticipant.publishTrack).toHaveBeenCalledWith(video, { name: 'screen_share#5' });
    expect(room.localParticipant.publishTrack).toHaveBeenCalledWith(audio, { name: 'screen_share#5' });
  });

  it('sharing without audio publishes only the video: a valid state, not an error', async () => {
    const room = fakeRoom();
    const video = fakeLocalTrack('screen_share');
    room.localParticipant.createScreenTracks.mockResolvedValueOnce([video]);
    const connection = await connect(room, document.createElement('div'));

    await expect(connection.setScreenShareEnabled(true)).resolves.toBe(true);

    expect(room.localParticipant.publishTrack).toHaveBeenCalledTimes(1);
    expect(room.localParticipant.publishTrack).toHaveBeenCalledWith(video, { name: 'screen_share#1' });
  });

  it('closing the browser picker resolves false without throwing and publishes nothing', async () => {
    const room = fakeRoom();
    room.localParticipant.createScreenTracks.mockRejectedValueOnce(new Error('NotAllowedError'));
    const connection = await connect(room, document.createElement('div'));

    await expect(connection.setScreenShareEnabled(true)).resolves.toBe(false);

    expect(room.localParticipant.publishTrack).not.toHaveBeenCalled();
  });

  it('a failed publish stops the captured tracks and unpublishes whatever did go out', async () => {
    const room = fakeRoom();
    const video = fakeLocalTrack('screen_share');
    room.localParticipant.createScreenTracks.mockResolvedValueOnce([video]);
    room.localParticipant.publishTrack.mockRejectedValueOnce(new Error('publish failed'));
    const connection = await connect(room, document.createElement('div'));

    await expect(connection.setScreenShareEnabled(true)).resolves.toBe(false);

    expect(video.stop).toHaveBeenCalled();
    expect(room.localParticipant.setScreenShareEnabled).toHaveBeenCalledWith(false);
  });

  it('disabling unpublishes the share through the SDK and resolves false', async () => {
    const room = fakeRoom();
    const connection = await connect(room, document.createElement('div'));

    await expect(connection.setScreenShareEnabled(false)).resolves.toBe(false);

    expect(room.localParticipant.setScreenShareEnabled).toHaveBeenCalledWith(false);
  });
});

describe('one sharer per space (#20): takeover and the start race', () => {
  it('a peer taking over stops the own share', async () => {
    const room = fakeRoom();
    await connect(room, document.createElement('div'));
    publishLocalShare(room, 1);
    expect(room.localParticipant.setScreenShareEnabled).not.toHaveBeenCalled();

    publishRemoteShare(room, 'p1', 2);

    expect(room.localParticipant.setScreenShareEnabled).toHaveBeenCalledWith(false);
  });

  it('an older peer share never stops the own, newer one', async () => {
    const room = fakeRoom();
    await connect(room, document.createElement('div'));
    publishRemoteShare(room, 'p1', 1);

    publishLocalShare(room, 2);

    expect(room.localParticipant.setScreenShareEnabled).not.toHaveBeenCalled();
  });

  it('two shares started together (same claim): the identity decides, on both sides alike', async () => {
    // Local identity is 'yo'. 'zz' ranks above it, 'aa' below it.
    const outranked = fakeRoom();
    await connect(outranked, document.createElement('div'));
    publishLocalShare(outranked, 3);
    publishRemoteShare(outranked, 'zz', 3);

    const outranking = fakeRoom();
    await connect(outranking, document.createElement('div'));
    publishLocalShare(outranking, 3);
    publishRemoteShare(outranking, 'aa', 3);

    expect(outranked.localParticipant.setScreenShareEnabled).toHaveBeenCalledWith(false);
    expect(outranking.localParticipant.setScreenShareEnabled).not.toHaveBeenCalled();
  });

  it('reports the active sharer of the space on every change, null when the share ends', async () => {
    const room = fakeRoom();
    const onActiveScreenSharerChanged = vi.fn();
    await connectLivekitRoom({
      url: 'ws://localhost:7880',
      token: 'jwt',
      createRoom: () => room as unknown as Room,
      onActiveScreenSharerChanged,
    });

    const publication = publishRemoteShare(room, 'p1', 1);
    publishRemoteShare(room, 'p2', 2);
    room.remoteParticipants.delete('p1');
    room.emit(RoomEvent.TrackUnpublished, publication, { identity: 'p1' });
    room.remoteParticipants.delete('p2');
    room.emit(RoomEvent.ParticipantDisconnected, { identity: 'p2' });

    expect(onActiveScreenSharerChanged.mock.calls).toEqual([['p1'], ['p2'], [null]]);
  });

  it('a share already running when joining the space is reported right after connecting', async () => {
    const room = fakeRoom();
    room.remoteParticipants.set(
      'p1',
      fakeParticipant([fakePublication('video', { source: 'screen_share', trackName: 'screen_share#1' })]),
    );
    const onActiveScreenSharerChanged = vi.fn();

    await connectLivekitRoom({
      url: 'ws://localhost:7880',
      token: 'jwt',
      createRoom: () => room as unknown as Room,
      onActiveScreenSharerChanged,
    });

    expect(onActiveScreenSharerChanged).toHaveBeenCalledWith('p1');
  });
});

describe('connectLivekitRoom: a room lost for good is reported (#84)', () => {
  it('reports a disconnect nobody asked for, such as LiveKit giving up on reconnecting', async () => {
    const room = fakeRoom();
    const onDisconnected = vi.fn();

    await connectLivekitRoom({
      url: 'ws://localhost:7880',
      token: 'jwt',
      createRoom: () => room as unknown as Room,
      onDisconnected,
    });
    room.emit(RoomEvent.Disconnected);

    expect(onDisconnected).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when the disconnect is our own', async () => {
    const room = fakeRoom();
    // The real `Room` emits `Disconnected` from its own `disconnect()` as well.
    room.disconnect = vi.fn(async () => {
      room.emit(RoomEvent.Disconnected);
      return undefined;
    });
    const onDisconnected = vi.fn();

    const connection = await connectLivekitRoom({
      url: 'ws://localhost:7880',
      token: 'jwt',
      createRoom: () => room as unknown as Room,
      onDisconnected,
    });
    await connection.disconnect();

    expect(onDisconnected).not.toHaveBeenCalled();
  });
});

describe('connectLivekitRoom: whether the room has anything to record (#144)', () => {
  function connectWithMedia(room: ReturnType<typeof fakeRoom>) {
    const onRoomMediaChanged = vi.fn();
    const connected = connectLivekitRoom({
      url: 'ws://localhost:7880',
      token: 'jwt',
      createRoom: () => room as unknown as Room,
      onRoomMediaChanged,
    });
    return { connected, onRoomMediaChanged };
  }

  it('reports an empty room right after connecting', async () => {
    const room = fakeRoom();
    const { connected, onRoomMediaChanged } = connectWithMedia(room);
    await connected;

    expect(onRoomMediaChanged.mock.calls).toEqual([[false]]);
  });

  it('a peer already publishing when joining is reported right after connecting', async () => {
    const room = fakeRoom();
    room.remoteParticipants.set('p1', fakeParticipant([fakePublication('audio', { source: 'microphone' })]));
    const { connected, onRoomMediaChanged } = connectWithMedia(room);
    await connected;

    expect(onRoomMediaChanged.mock.calls).toEqual([[true]]);
  });

  it('follows a peer publishing and unpublishing, whether or not this client subscribes', async () => {
    const room = fakeRoom();
    const { connected, onRoomMediaChanged } = connectWithMedia(room);
    await connected;

    const participant = fakeParticipant([fakePublication('video', { source: 'screen_share' })]);
    room.remoteParticipants.set('p1', participant);
    room.emit(RoomEvent.TrackPublished);
    participant.trackPublications.clear();
    room.emit(RoomEvent.TrackUnpublished);

    expect(onRoomMediaChanged.mock.calls).toEqual([[false], [true], [false]]);
  });

  it('a muted microphone has nothing to record until it is unmuted', async () => {
    const room = fakeRoom();
    const microphone = fakePublication('audio', { source: 'microphone', isMuted: true });
    room.remoteParticipants.set('p1', fakeParticipant([microphone]));
    const { connected, onRoomMediaChanged } = connectWithMedia(room);
    await connected;

    microphone.isMuted = false;
    room.emit(RoomEvent.TrackUnmuted);
    microphone.isMuted = true;
    room.emit(RoomEvent.TrackMuted);

    expect(onRoomMediaChanged.mock.calls).toEqual([[false], [true], [false]]);
  });

  it('counts the own camera, and a peer leaving takes its media along', async () => {
    const room = fakeRoom();
    const { connected, onRoomMediaChanged } = connectWithMedia(room);
    await connected;

    const camera = fakePublication('video', { source: 'camera', track: fakeTrack('video') });
    room.localParticipant.trackPublications.set('cam', camera);
    room.emit(RoomEvent.LocalTrackPublished, camera);
    room.localParticipant.trackPublications.delete('cam');
    room.emit(RoomEvent.LocalTrackUnpublished, camera);
    room.remoteParticipants.set('p1', fakeParticipant([fakePublication('audio', { source: 'microphone' })]));
    room.emit(RoomEvent.ParticipantConnected);
    room.remoteParticipants.delete('p1');
    room.emit(RoomEvent.ParticipantDisconnected);

    expect(onRoomMediaChanged.mock.calls).toEqual([[false], [true], [false], [true], [false]]);
  });

  it('reports changes only, never the same answer twice in a row', async () => {
    const room = fakeRoom();
    room.remoteParticipants.set('p1', fakeParticipant([fakePublication('audio', { source: 'microphone' })]));
    const { connected, onRoomMediaChanged } = connectWithMedia(room);
    await connected;

    room.emit(RoomEvent.TrackPublished);
    room.emit(RoomEvent.TrackUnmuted);

    expect(onRoomMediaChanged.mock.calls).toEqual([[true]]);
  });
});

/** Own camera track with the processor slice of `LocalVideoTrack` this module uses. */
function fakeCameraTrack() {
  let processor: unknown;
  const track = {
    kind: 'video' as const,
    source: 'camera',
    getProcessor: vi.fn(() => processor),
    setProcessor: vi.fn(async (next: unknown) => {
      processor = next;
    }),
    stopProcessor: vi.fn(async () => {
      processor = undefined;
    }),
    stop: vi.fn(),
  };
  return track;
}

type FakeCameraTrack = ReturnType<typeof fakeCameraTrack>;

/**
 * A room whose own camera behaves like livekit-client's: turning it on the
 * first time creates and publishes a track, off mutes it (the publication
 * stays), on again unmutes the same track, and unpublishing stops it.
 */
function fakeCameraRoom() {
  const room = fakeRoom();
  const local = room.localParticipant;
  const created: FakeCameraTrack[] = [];
  const cameraPublication = () =>
    Array.from(local.trackPublications.values()).find((publication) => publication.source === 'camera');
  const publish = (track: FakeCameraTrack) => {
    local.trackPublications.set(`cam${created.length}`, fakePublication('video', { source: 'camera', track }));
  };
  const createTracks = vi.fn(async () => {
    const track = fakeCameraTrack();
    created.push(track);
    return [track];
  });
  const camera = Object.assign(local, {
    createTracks,
    setCameraEnabled: vi.fn(async (enabled: boolean) => {
      const publication = cameraPublication();
      if (publication) {
        publication.isMuted = !enabled;
      } else if (enabled) {
        const [track] = await createTracks();
        publish(track);
      }
    }),
    publishTrack: vi.fn(async (track: FakeCameraTrack) => publish(track)),
    unpublishTrack: vi.fn(async (track: FakeCameraTrack) => {
      for (const [key, publication] of local.trackPublications) {
        if (publication.track === track) local.trackPublications.delete(key);
      }
      track.stop();
    }),
  });
  return {
    room,
    local: camera,
    created,
    cameraTrack: () => cameraPublication()?.track as FakeCameraTrack | undefined,
  };
}

function fakeBlur({ supported = true } = {}) {
  const processors: {
    name: string;
    blurRadius: number;
    destroy: ReturnType<typeof vi.fn>;
    switchTo: ReturnType<typeof vi.fn>;
  }[] = [];
  const blur = {
    supported: vi.fn(() => supported),
    createProcessor: vi.fn((blurRadius: number) => {
      const processor = {
        name: 'blur',
        blurRadius,
        destroy: vi.fn(async () => undefined),
        switchTo: vi.fn(async () => undefined),
      };
      processors.push(processor);
      return processor as never;
    }),
  };
  return { blur, processors, load: vi.fn(async () => blur) };
}

function connectCamera(
  room: ReturnType<typeof fakeRoom>,
  loadBackgroundBlur: () => Promise<ReturnType<typeof fakeBlur>['blur']>,
) {
  const onCameraFilterFailed = vi.fn();
  const connected = connectLivekitRoom({
    url: 'ws://localhost:7880',
    token: 'jwt',
    createRoom: () => room as unknown as Room,
    audioContainer: document.createElement('div'),
    loadBackgroundBlur,
    onCameraFilterFailed,
  });
  return { connected, onCameraFilterFailed };
}

describe('camera filter: blur runs on this machine before the camera is published', () => {
  it('without a filter the camera goes on as before and the blur library is never loaded', async () => {
    const { room, cameraTrack } = fakeCameraRoom();
    const { load } = fakeBlur();
    const connection = await connectCamera(room, load).connected;

    expect(await connection.setCameraEnabled(true)).toBe(true);

    expect(room.localParticipant.setCameraEnabled).toHaveBeenCalledWith(true);
    expect(cameraTrack()?.setProcessor).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it('blur picked with the camera off waits for it: nothing is loaded until the camera goes on', async () => {
    const { room, local } = fakeCameraRoom();
    const { load } = fakeBlur();
    const connection = await connectCamera(room, load).connected;

    expect(await connection.setCameraFilter('blur-light')).toBe('blur-light');

    expect(load).not.toHaveBeenCalled();
    expect(local.createTracks).not.toHaveBeenCalled();
  });

  it('a fresh camera gets the blur BEFORE it is published: no peer ever sees the raw background', async () => {
    const { room, local, cameraTrack } = fakeCameraRoom();
    const { load, processors } = fakeBlur();
    const connection = await connectCamera(room, load).connected;
    await connection.setCameraFilter('blur-light');

    expect(await connection.setCameraEnabled(true)).toBe(true);

    const track = cameraTrack()!;
    expect(track.setProcessor).toHaveBeenCalledExactlyOnceWith(processors[0]);
    expect(track.setProcessor.mock.invocationCallOrder[0]).toBeLessThan(
      room.localParticipant.publishTrack.mock.invocationCallOrder[0],
    );
    expect(local.createTracks).toHaveBeenCalledWith({ video: true });
  });

  it('blur picked with the camera on blurs the live track in place', async () => {
    const { room, cameraTrack, created } = fakeCameraRoom();
    const { load, processors } = fakeBlur();
    const connection = await connectCamera(room, load).connected;
    await connection.setCameraEnabled(true);

    expect(await connection.setCameraFilter('blur-light')).toBe('blur-light');

    expect(created).toHaveLength(1);
    expect(cameraTrack()!.setProcessor).toHaveBeenCalledExactlyOnceWith(processors[0]);
  });

  it('no filter with the camera on stops the processor and keeps the same track', async () => {
    const { room, cameraTrack, created } = fakeCameraRoom();
    const { load } = fakeBlur();
    const connection = await connectCamera(room, load).connected;
    await connection.setCameraFilter('blur-light');
    await connection.setCameraEnabled(true);

    expect(await connection.setCameraFilter('none')).toBe('none');

    expect(cameraTrack()!.stopProcessor).toHaveBeenCalledOnce();
    expect(created).toHaveLength(1);
  });

  it('off and on again keeps the blurred track: livekit-client restarts its processor on unmute', async () => {
    const { room, cameraTrack, created } = fakeCameraRoom();
    const { load, blur } = fakeBlur();
    const connection = await connectCamera(room, load).connected;
    await connection.setCameraFilter('blur-light');
    await connection.setCameraEnabled(true);

    expect(await connection.setCameraEnabled(false)).toBe(false);
    expect(await connection.setCameraEnabled(true)).toBe(true);

    expect(created).toHaveLength(1);
    expect(blur.createProcessor).toHaveBeenCalledOnce();
    expect(cameraTrack()!.setProcessor).toHaveBeenCalledOnce();
    expect(room.localParticipant.setCameraEnabled.mock.calls).toEqual([[false], [true]]);
  });

  it('blur picked while the camera is off never unmutes the raw track: it is replaced by a blurred one', async () => {
    const { room, cameraTrack, created } = fakeCameraRoom();
    const { load } = fakeBlur();
    const connection = await connectCamera(room, load).connected;
    await connection.setCameraEnabled(true);
    await connection.setCameraEnabled(false);
    const raw = cameraTrack()!;

    await connection.setCameraFilter('blur-light');
    expect(await connection.setCameraEnabled(true)).toBe(true);

    expect(room.localParticipant.unpublishTrack).toHaveBeenCalledExactlyOnceWith(raw);
    expect(raw.stop).toHaveBeenCalled();
    expect(created).toHaveLength(2);
    expect(cameraTrack()).toBe(created[1]);
    expect(created[1].setProcessor).toHaveBeenCalledOnce();
    expect(room.localParticipant.setCameraEnabled.mock.calls).toEqual([[true], [false]]);
  });

  it('no filter picked while the camera is off unblurs it once it is back on', async () => {
    const { room, cameraTrack } = fakeCameraRoom();
    const { load } = fakeBlur();
    const connection = await connectCamera(room, load).connected;
    await connection.setCameraFilter('blur-light');
    await connection.setCameraEnabled(true);
    await connection.setCameraEnabled(false);

    expect(await connection.setCameraFilter('none')).toBe('none');
    expect(cameraTrack()!.stopProcessor).not.toHaveBeenCalled();
    await connection.setCameraEnabled(true);

    expect(cameraTrack()!.stopProcessor).toHaveBeenCalledOnce();
  });

  it('a filter change and a camera toggle never interleave: blur picked right before turning on applies', async () => {
    const { room, cameraTrack } = fakeCameraRoom();
    const { load } = fakeBlur();
    const connection = await connectCamera(room, load).connected;

    const filter = connection.setCameraFilter('blur-light');
    const camera = connection.setCameraEnabled(true);

    expect(await Promise.all([filter, camera])).toEqual(['blur-light', true]);
    expect(cameraTrack()!.setProcessor).toHaveBeenCalledOnce();
  });
});

describe('camera filter degrades to no filter, never to no camera', () => {
  it('a blur library that fails to load leaves the camera on, unblurred, and reports it', async () => {
    const { room, cameraTrack } = fakeCameraRoom();
    const load = vi.fn(async () => {
      throw new TypeError('Failed to fetch dynamically imported module');
    });
    const { connected, onCameraFilterFailed } = connectCamera(room, load);
    const connection = await connected;
    await connection.setCameraFilter('blur-light');

    expect(await connection.setCameraEnabled(true)).toBe(true);

    expect(cameraTrack()).toBeDefined();
    expect(cameraTrack()!.setProcessor).not.toHaveBeenCalled();
    expect(onCameraFilterFailed).toHaveBeenCalledOnce();
  });

  it('a browser the library refuses never gets a processor', async () => {
    const { room, cameraTrack } = fakeCameraRoom();
    const { load, blur } = fakeBlur({ supported: false });
    const { connected, onCameraFilterFailed } = connectCamera(room, load);
    const connection = await connected;
    await connection.setCameraFilter('blur-light');

    expect(await connection.setCameraEnabled(true)).toBe(true);

    expect(blur.createProcessor).not.toHaveBeenCalled();
    expect(cameraTrack()!.setProcessor).not.toHaveBeenCalled();
    expect(onCameraFilterFailed).toHaveBeenCalledOnce();
  });

  it('a processor that fails to start (model download) is destroyed and the raw camera is published', async () => {
    const { room, local, cameraTrack, created } = fakeCameraRoom();
    const { load, processors } = fakeBlur();
    local.createTracks.mockImplementationOnce(async () => {
      const track = fakeCameraTrack();
      track.setProcessor.mockRejectedValueOnce(new Error('model download failed'));
      created.push(track);
      return [track];
    });
    const { connected, onCameraFilterFailed } = connectCamera(room, load);
    const connection = await connected;
    await connection.setCameraFilter('blur-light');

    expect(await connection.setCameraEnabled(true)).toBe(true);

    expect(cameraTrack()).toBe(created[0]);
    expect(processors[0].destroy).toHaveBeenCalledOnce();
    expect(onCameraFilterFailed).toHaveBeenCalledOnce();
  });

  it('after a failure the filter is off: the next camera on does not try again', async () => {
    const { room } = fakeCameraRoom();
    const load = vi.fn(async (): Promise<ReturnType<typeof fakeBlur>['blur']> => {
      throw new Error('offline');
    });
    const connection = await connectCamera(room, load).connected;
    await connection.setCameraFilter('blur-light');
    await connection.setCameraEnabled(true);
    await connection.setCameraEnabled(false);

    await connection.setCameraEnabled(true);

    expect(load).toHaveBeenCalledOnce();
  });

  it('blur that fails on the live camera resolves to no filter, camera untouched, no extra report', async () => {
    const { room, cameraTrack } = fakeCameraRoom();
    const { load } = fakeBlur({ supported: false });
    const { connected, onCameraFilterFailed } = connectCamera(room, load);
    const connection = await connected;
    await connection.setCameraEnabled(true);

    expect(await connection.setCameraFilter('blur-light')).toBe('none');

    expect(cameraTrack()).toBeDefined();
    expect(cameraTrack()!.setProcessor).not.toHaveBeenCalled();
    expect(onCameraFilterFailed).not.toHaveBeenCalled();
  });

  it('a camera the browser denies is off, and that is not a filter failure', async () => {
    const { room, local } = fakeCameraRoom();
    const { load } = fakeBlur();
    local.createTracks.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    const { connected, onCameraFilterFailed } = connectCamera(room, load);
    const connection = await connected;
    await connection.setCameraFilter('blur-light');

    expect(await connection.setCameraEnabled(true)).toBe(false);

    expect(onCameraFilterFailed).not.toHaveBeenCalled();
    expect(room.localParticipant.publishTrack).not.toHaveBeenCalled();
  });
});

describe('camera filter: two blur strengths switch on the running processor', () => {
  it('a fresh camera starts at the strength picked: 12 for light, 40 for full', async () => {
    for (const [filter, radius] of [['blur-light', 12], ['blur-strong', 40]] as const) {
      const { room } = fakeCameraRoom();
      const { load, blur } = fakeBlur();
      const connection = await connectCamera(room, load).connected;
      await connection.setCameraFilter(filter);

      await connection.setCameraEnabled(true);

      expect(blur.createProcessor).toHaveBeenCalledExactlyOnceWith(radius);
    }
  });

  it('light to full with the camera on only switches the processor: same track, same processor', async () => {
    const { room, cameraTrack, created } = fakeCameraRoom();
    const { load, blur, processors } = fakeBlur();
    const connection = await connectCamera(room, load).connected;
    await connection.setCameraFilter('blur-light');
    await connection.setCameraEnabled(true);

    expect(await connection.setCameraFilter('blur-strong')).toBe('blur-strong');

    expect(processors[0].switchTo).toHaveBeenCalledExactlyOnceWith({ mode: 'background-blur', blurRadius: 40 });
    expect(blur.createProcessor).toHaveBeenCalledOnce();
    expect(cameraTrack()!.setProcessor).toHaveBeenCalledOnce();
    expect(cameraTrack()!.stopProcessor).not.toHaveBeenCalled();
    expect(created).toHaveLength(1);
  });

  it('a strength changed while the camera is off is switched to right after it unmutes', async () => {
    const { room, created } = fakeCameraRoom();
    const { load, blur, processors } = fakeBlur();
    const connection = await connectCamera(room, load).connected;
    await connection.setCameraFilter('blur-strong');
    await connection.setCameraEnabled(true);
    await connection.setCameraEnabled(false);

    expect(await connection.setCameraFilter('blur-light')).toBe('blur-light');
    expect(processors[0].switchTo).not.toHaveBeenCalled();
    await connection.setCameraEnabled(true);

    expect(created).toHaveLength(1);
    expect(blur.createProcessor).toHaveBeenCalledOnce();
    expect(processors[0].switchTo).toHaveBeenCalledExactlyOnceWith({ mode: 'background-blur', blurRadius: 12 });
    expect(room.localParticipant.setCameraEnabled.mock.invocationCallOrder.at(-1)).toBeLessThan(
      processors[0].switchTo.mock.invocationCallOrder[0],
    );
  });

  it('a switch that fails drops the blur rather than leave a strength nobody picked', async () => {
    const { room, cameraTrack } = fakeCameraRoom();
    const { load, processors } = fakeBlur();
    const connection = await connectCamera(room, load).connected;
    await connection.setCameraFilter('blur-light');
    await connection.setCameraEnabled(true);
    processors[0].switchTo.mockRejectedValueOnce(new Error('context lost'));

    expect(await connection.setCameraFilter('blur-strong')).toBe('none');

    expect(cameraTrack()!.stopProcessor).toHaveBeenCalledOnce();
  });
});
