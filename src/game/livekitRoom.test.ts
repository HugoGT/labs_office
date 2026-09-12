import { Room, RoomEvent } from 'livekit-client';
import { describe, expect, it, vi } from 'vitest';
import { connectLivekitRoom } from './livekitRoom';
import type { AttachableTrack } from './remoteAudioSink';

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
