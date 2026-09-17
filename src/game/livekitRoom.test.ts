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
      setMicrophoneEnabled: vi.fn(async () => undefined),
      setCameraEnabled: vi.fn(async () => undefined),
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
function fakePublication(kind: 'audio' | 'video') {
  const publication = {
    kind,
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

    room.emit(RoomEvent.TrackSubscribed, fakeTrack());

    expect(container.querySelectorAll('audio')).toHaveLength(1);
  });

  it('TrackUnsubscribed retira el elemento: salir del radio corta el audio', async () => {
    const container = document.createElement('div');
    const room = fakeRoom();
    await connect(room, container);
    const track = fakeTrack();

    room.emit(RoomEvent.TrackSubscribed, track);
    room.emit(RoomEvent.TrackUnsubscribed, track);

    expect(container.querySelectorAll('audio')).toHaveLength(0);
  });

  it('disconnect no deja elementos adjuntos detras', async () => {
    const container = document.createElement('div');
    const room = fakeRoom();
    const connection = await connect(room, container);

    room.emit(RoomEvent.TrackSubscribed, fakeTrack());
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
