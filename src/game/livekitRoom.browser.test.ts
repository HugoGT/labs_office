// La cadena de re-exportacion de tipos de `vitest/browser` no resuelve
// `commands` cuando solo hay un provider de navegador instalado
// (`@vitest/browser-playwright`, sin `webdriverio`/`preview`): el `export *`
// hacia ese subpath no tiene condicion "import"/"default", solo "types". El
// valor en runtime SI existe (modulo virtual inyectado por Vitest Browser
// Mode); `BrowserCommands` si se exporta de forma directa (no via wildcard),
// asi que se usa para tipar el cast.
import * as vitestBrowser from 'vitest/browser';
import type { BrowserCommands } from 'vitest/browser';
import { Room, RoomEvent, Track, type LocalTrackPublication, type TrackProcessor } from 'livekit-client';

const commands = (vitestBrowser as unknown as { commands: BrowserCommands }).commands;
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIVEKIT_ROOM_NAME, livekitRoomFor } from './officeProtocol';
import {
  connectLivekitRoom,
  createOfficeRoom,
  createSharedMicrophone,
  releaseSharedMicrophone,
  type BlurProcessor,
  type ConnectLivekitRoomOptions,
  type LivekitRoomConnection,
} from './livekitRoom';

/**
 * Necesita un LiveKit real levantado (`docker compose up -d redis livekit` en
 * `infra/livekit/`) y `infra/livekit/.env` con credenciales validas. No hay
 * provision de Docker en CI (diseno, #239), asi que este archivo se salta por
 * defecto. Slice 1 ADJUST (b) confirmo que las flags de dispositivo falso SI
 * son configurables aqui (`vite.config.ts`), asi que cuando SI corre (a mano,
 * con `VITE_LIVEKIT_E2E=1 pnpm test:browser -- livekitRoom`), ejerce
 * microfono/camara reales en vez de saltarse tambien esas ramas.
 *
 * `createRoom` se inyecta con una instancia propia (en vez de dejar que
 * `connectLivekitRoom` cree la suya) para poder escuchar sus eventos
 * directamente: `LivekitRoomConnection` no expone la sala interna a
 * proposito (D-implicito: la interfaz publica no filtra el SDK).
 */
const LIVEKIT_WS_URL = 'ws://localhost:7880';

const rooms: LivekitRoomConnection[] = [];
const rawRooms: Room[] = [];

afterEach(async () => {
  for (const connection of rooms.splice(0)) await connection.disconnect();
  for (const room of rawRooms.splice(0)) await room.disconnect();
});

async function connectPublisher(identity: string): Promise<Room> {
  const token = await commands.mintLivekitToken(identity, LIVEKIT_ROOM_NAME);
  const room = new Room();
  rawRooms.push(room);
  await room.connect(LIVEKIT_WS_URL, token, { autoSubscribe: false });
  await room.localParticipant.setMicrophoneEnabled(true);
  return room;
}

async function connectWrapped(
  identity: string,
  options: Partial<ConnectLivekitRoomOptions> = {},
): Promise<{
  connection: LivekitRoomConnection;
  room: Room;
}> {
  const token = await commands.mintLivekitToken(identity, LIVEKIT_ROOM_NAME);
  const room = new Room();
  const connection = await connectLivekitRoom({
    url: LIVEKIT_WS_URL,
    token,
    createRoom: () => room,
    ...options,
  });
  rooms.push(connection);
  return { connection, room };
}

describe.skipIf(!import.meta.env.VITE_LIVEKIT_E2E)(
  'connectLivekitRoom (D1/D2, contra un LiveKit real)',
  () => {
    it('autoSubscribe:false no entrega ninguna suscripcion sin pedirla', async () => {
      await connectPublisher(`pub-${Date.now()}`);
      const { room } = await connectWrapped(`sub-${Date.now()}`);

      let subscribedEarly = false;
      room.on(RoomEvent.TrackSubscribed, () => {
        subscribedEarly = true;
      });

      // Ventana breve para detectar una suscripcion indebida: si el wrapper
      // suscribiera solo (sin que nadie llame setDesiredAudioPeers), esto
      // tendria tiempo de dispararse.
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(subscribedEarly).toBe(false);
    });

    it('setDesiredAudioPeers suscribe al publicador cuando aparece en el conjunto deseado', async () => {
      const publisherIdentity = `pub-${Date.now()}`;
      await connectPublisher(publisherIdentity);
      const { connection, room } = await connectWrapped(`sub-${Date.now()}`);

      const subscribed = new Promise<void>((resolve) => {
        room.on(RoomEvent.TrackSubscribed, () => resolve());
      });

      connection.setDesiredAudioPeers([publisherIdentity]);

      await expect(subscribed).resolves.toBeUndefined();
    });

    it('quitar un peer del conjunto deseado lo desuscribe', async () => {
      const publisherIdentity = `pub-${Date.now()}`;
      await connectPublisher(publisherIdentity);
      const { connection, room } = await connectWrapped(`sub-${Date.now()}`);

      const subscribed = new Promise<void>((resolve) => {
        room.on(RoomEvent.TrackSubscribed, () => resolve());
      });
      connection.setDesiredAudioPeers([publisherIdentity]);
      await subscribed;

      const unsubscribed = new Promise<void>((resolve) => {
        room.on(RoomEvent.TrackUnsubscribed, () => resolve());
      });
      connection.setDesiredAudioPeers([]);

      await expect(unsubscribed).resolves.toBeUndefined();
    });

    it('una publicacion tardia (llega despues de pedirla) igual termina suscrita', async () => {
      const publisherIdentity = `pub-late-${Date.now()}`;
      const { connection, room } = await connectWrapped(`sub-${Date.now()}`);

      // El peer se pide ANTES de que exista: solo publica despues.
      connection.setDesiredAudioPeers([publisherIdentity]);

      const subscribed = new Promise<void>((resolve) => {
        room.on(RoomEvent.TrackSubscribed, () => resolve());
      });

      await connectPublisher(publisherIdentity);

      await expect(subscribed).resolves.toBeUndefined();
    });

    it('microfono con dispositivo falso: enciende y devuelve true', async () => {
      const { connection } = await connectWrapped(`mic-${Date.now()}`);

      const enabled = await connection.setMicrophoneEnabled(true);

      expect(enabled).toBe(true);
    });

    it('camara con dispositivo falso: enciende y devuelve true', async () => {
      const { connection } = await connectWrapped(`cam-${Date.now()}`);

      const enabled = await connection.setCameraEnabled(true);

      expect(enabled).toBe(true);
    });

    it('la pista suscrita se adjunta al documento: es lo que la convierte en sonido', async () => {
      const publisherIdentity = `pub-${Date.now()}`;
      await connectPublisher(publisherIdentity);
      const { connection, room } = await connectWrapped(`sub-${Date.now()}`);

      const subscribed = new Promise<void>((resolve) => {
        room.on(RoomEvent.TrackSubscribed, () => resolve());
      });
      connection.setDesiredAudioPeers([publisherIdentity]);
      await subscribed;

      // El evento lo entrega el SDK; el handler del modulo corre justo
      // despues, asi que se cede un turno antes de mirar el DOM.
      await new Promise((resolve) => setTimeout(resolve, 0));

      const elements = document.querySelectorAll('audio');
      expect(elements).toHaveLength(1);
      // Un `<audio>` sin `srcObject` es un elemento decorativo: la prueba de
      // que la pista real llego hasta el navegador es el MediaStream.
      expect((elements[0] as HTMLAudioElement).srcObject).toBeInstanceOf(MediaStream);
    });

    it('al salir del conjunto deseado no queda ningun elemento adjunto', async () => {
      const publisherIdentity = `pub-${Date.now()}`;
      await connectPublisher(publisherIdentity);
      const { connection, room } = await connectWrapped(`sub-${Date.now()}`);

      const subscribed = new Promise<void>((resolve) => {
        room.on(RoomEvent.TrackSubscribed, () => resolve());
      });
      connection.setDesiredAudioPeers([publisherIdentity]);
      await subscribed;

      const unsubscribed = new Promise<void>((resolve) => {
        room.on(RoomEvent.TrackUnsubscribed, () => resolve());
      });
      connection.setDesiredAudioPeers([]);
      await unsubscribed;
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(document.querySelectorAll('audio')).toHaveLength(0);
    });

    it('a microphone muted through the room API is reported as a moderator mute (#282)', async () => {
      const identity = `moderated-${Date.now()}`;
      const token = await commands.mintLivekitToken(identity, LIVEKIT_ROOM_NAME);
      const room = new Room();
      let mutedRemotely = 0;
      const connection = await connectLivekitRoom({
        url: LIVEKIT_WS_URL,
        token,
        createRoom: () => room,
        onMicrophoneMutedRemotely: () => {
          mutedRemotely += 1;
        },
      });
      rooms.push(connection);
      expect(await connection.setMicrophoneEnabled(true)).toBe(true);
      expect(mutedRemotely).toBe(0);

      await expect.poll(() => commands.muteLivekitMicrophone(identity, LIVEKIT_ROOM_NAME), { timeout: 10_000 }).toBe(1);

      await expect.poll(() => mutedRemotely, { timeout: 10_000 }).toBe(1);
      const microphone = [...room.localParticipant.trackPublications.values()].find((pub) => pub.source === 'microphone');
      expect(microphone?.isMuted).toBe(true);
    });
  },
);

/** The own microphone or camera publication: the one other people are subscribed to. */
function ownPublication(room: Room, kind: 'audioinput' | 'videoinput'): LocalTrackPublication {
  const source = kind === 'audioinput' ? Track.Source.Microphone : Track.Source.Camera;
  const publication = room.localParticipant.getTrackPublication(source);
  if (!publication?.track) throw new Error(`no ${kind} publication`);
  return publication;
}

/** The device the track really captures from, not the one asked for. */
function capturedDevice(room: Room, kind: 'audioinput' | 'videoinput'): string | undefined {
  return ownPublication(room, kind).track?.mediaStreamTrack.getSettings().deviceId;
}

/**
 * Another fake device of the same kind. Chromium's fake media lists three
 * microphones and, with `device-count=2` (`vite.config.ts`), two cameras.
 */
async function otherDevice(kind: 'audioinput' | 'videoinput', inUse: string | undefined): Promise<string> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const other = devices.find(
    (device) => device.kind === kind && device.deviceId !== 'default' && device.deviceId !== inUse,
  );
  if (!other) throw new Error(`no second ${kind} to switch to`);
  return other.deviceId;
}

/**
 * Stands in for the background blur, which needs MediaPipe from a CDN: what
 * is checked is that livekit-client keeps the processor across a switch and
 * restarts it on the new capture, not what the processor draws.
 */
function passthroughProcessor(): BlurProcessor & { restarted: MediaStreamTrack[] } {
  const processor: BlurProcessor & { restarted: MediaStreamTrack[] } = {
    name: 'passthrough-blur',
    restarted: [],
    processedTrack: undefined,
    async init({ track }) {
      processor.processedTrack = track.clone();
    },
    async restart({ track }) {
      processor.restarted.push(track);
      processor.processedTrack?.stop();
      processor.processedTrack = track.clone();
    },
    async destroy() {
      processor.processedTrack?.stop();
      processor.processedTrack = undefined;
    },
    async switchTo() {},
  } satisfies TrackProcessor<Track.Kind.Video> & { restarted: MediaStreamTrack[]; switchTo: BlurProcessor['switchTo'] };
  return processor;
}

describe.skipIf(!import.meta.env.VITE_LIVEKIT_E2E)('switching a device mid call keeps the publication (#288)', () => {
  it.each(['audioinput', 'videoinput'] as const)(
    'a live %s switch neither unpublishes nor publishes: same sid, new device',
    async (kind) => {
      const { connection, room } = await connectWrapped(`switch-${kind}-${Date.now()}`);
      const enabled = kind === 'audioinput' ? connection.setMicrophoneEnabled(true) : connection.setCameraEnabled(true);
      expect(await enabled).toBe(true);
      const before = ownPublication(room, kind);
      const sid = before.trackSid;
      const target = await otherDevice(kind, capturedDevice(room, kind));
      const unpublish = vi.spyOn(room.localParticipant, 'unpublishTrack');
      const publish = vi.spyOn(room.localParticipant, 'publishTrack');
      const republished = vi.fn();
      room.on(RoomEvent.LocalTrackUnpublished, republished);
      room.on(RoomEvent.LocalTrackPublished, republished);

      expect(await connection.switchDevice(kind, target)).toBe(true);

      expect(unpublish).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
      expect(republished).not.toHaveBeenCalled();
      expect(ownPublication(room, kind)).toBe(before);
      expect(ownPublication(room, kind).trackSid).toBe(sid);
      expect(capturedDevice(room, kind)).toBe(target);
      // The sender went on with the new capture, without renegotiating.
      expect(before.track?.sender?.track).toBe(before.track?.mediaStreamTrack);
    },
  );

  it.each(['audioinput', 'videoinput'] as const)(
    'a %s switch while muted opens no capture; the next unmute uses the new device',
    async (kind) => {
      const { connection, room } = await connectWrapped(`muted-${kind}-${Date.now()}`);
      const toggle = (on: boolean) =>
        kind === 'audioinput' ? connection.setMicrophoneEnabled(on) : connection.setCameraEnabled(on);
      expect(await toggle(true)).toBe(true);
      const target = await otherDevice(kind, capturedDevice(room, kind));
      expect(await toggle(false)).toBe(false);
      const getUserMedia = vi.spyOn(navigator.mediaDevices, 'getUserMedia');

      try {
        expect(await connection.switchDevice(kind, target)).toBe(true);

        expect(getUserMedia).not.toHaveBeenCalled();
        expect(ownPublication(room, kind).isMuted).toBe(true);
        const track = ownPublication(room, kind).track?.mediaStreamTrack;
        // A bare `Room` keeps a muted microphone as a silent track; a muted camera has none running.
        expect(track?.readyState === 'ended' || track?.enabled === false).toBe(true);
      } finally {
        getUserMedia.mockRestore();
      }

      expect(await toggle(true)).toBe(true);
      expect(capturedDevice(room, kind)).toBe(target);
    },
  );

  it.each(['audioinput', 'videoinput'] as const)(
    'a %s switch that fails leaves the call on the previous device and tells the caller',
    async (kind) => {
      const onDeviceFailed = vi.fn();
      const { connection, room } = await connectWrapped(`failed-${kind}-${Date.now()}`, { onDeviceFailed });
      const enabled = kind === 'audioinput' ? connection.setMicrophoneEnabled(true) : connection.setCameraEnabled(true);
      expect(await enabled).toBe(true);
      const before = ownPublication(room, kind);
      const previous = capturedDevice(room, kind);

      expect(await connection.switchDevice(kind, 'no-such-device')).toBe(false);

      expect(onDeviceFailed).toHaveBeenCalledExactlyOnceWith(kind, expect.any(String));
      expect(ownPublication(room, kind)).toBe(before);
      expect(before.isMuted).toBe(false);
      expect(before.track?.mediaStreamTrack.readyState).toBe('live');
      expect(capturedDevice(room, kind)).toBe(previous);
      expect(before.track?.sender?.track).toBe(before.track?.mediaStreamTrack);
    },
  );

  it('a blurred camera stays blurred after a switch: the processor restarts on the new capture', async () => {
    const processor = passthroughProcessor();
    const { connection, room } = await connectWrapped(`blur-${Date.now()}`, {
      loadBackgroundBlur: async () => ({ supported: () => true, createProcessor: () => processor }),
    });
    expect(await connection.setCameraFilter('blur-light')).toBe('blur-light');
    expect(await connection.setCameraEnabled(true)).toBe(true);
    const before = ownPublication(room, 'videoinput');
    const sid = before.trackSid;
    const target = await otherDevice('videoinput', capturedDevice(room, 'videoinput'));

    expect(await connection.switchDevice('videoinput', target)).toBe(true);

    expect(before.trackSid).toBe(sid);
    expect(before.track?.getProcessor()).toBe(processor);
    expect(processor.restarted.at(-1)?.getSettings().deviceId).toBe(target);
    // What leaves this machine is the processed track, never the raw camera.
    expect(before.track?.sender?.track).toBe(processor.processedTrack);
  });
});

describe.skipIf(!import.meta.env.VITE_LIVEKIT_E2E)('crossing a door keeps the microphone capture (#286)', () => {
  async function join(identity: string, roomName: string, options: Partial<ConnectLivekitRoomOptions> = {}) {
    const token = await commands.mintLivekitToken(identity, roomName);
    const room = new Room();
    const connection = await connectLivekitRoom({ url: LIVEKIT_WS_URL, token, createRoom: () => room, ...options });
    rooms.push(connection);
    return { connection, room };
  }

  it('the next room publishes the same live capture, a listener there hears it, and nothing captured again', async () => {
    const stamp = Date.now();
    const space = livekitRoomFor(`door-${stamp}`);
    const listener = new Room();
    rawRooms.push(listener);
    await listener.connect(LIVEKIT_WS_URL, await commands.mintLivekitToken(`listener-${stamp}`, space));
    const heard = new Promise<MediaStreamTrack>((resolve) => {
      listener.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) resolve(track.mediaStreamTrack);
      });
    });
    const microphone = createSharedMicrophone();
    const identity = `walker-${stamp}`;

    const floor = await join(identity, LIVEKIT_ROOM_NAME, { microphone });
    expect(await floor.connection.setMicrophoneEnabled(true)).toBe(true);
    const captured = ownPublication(floor.room, 'audioinput').track!;
    const getUserMedia = vi.spyOn(navigator.mediaDevices, 'getUserMedia');
    try {
      await floor.connection.disconnect();
      const inside = await join(identity, space, { microphone });
      expect(await inside.connection.setMicrophoneEnabled(true)).toBe(true);

      expect(getUserMedia).not.toHaveBeenCalled();
      const published = ownPublication(inside.room, 'audioinput');
      expect(published.track).toBe(captured);
      expect(published.isMuted).toBe(false);
      expect(captured.mediaStreamTrack.readyState).toBe('live');
      expect(captured.sender?.track).toBe(captured.mediaStreamTrack);
      await expect(heard).resolves.toBeDefined();

      // Leaving the office stops it: the system indicator goes off.
      await inside.connection.disconnect();
      await releaseSharedMicrophone(microphone);
      expect(captured.mediaStreamTrack.readyState).toBe('ended');
    } finally {
      getUserMedia.mockRestore();
    }
  });

  it('"No molestar" stops the capture and keeps the room', async () => {
    const microphone = createSharedMicrophone();
    const { connection, room } = await join(`dnd-${Date.now()}`, LIVEKIT_ROOM_NAME, { microphone });
    expect(await connection.setMicrophoneEnabled(true)).toBe(true);
    const captured = ownPublication(room, 'audioinput').track!;

    await connection.releaseMicrophone();

    expect(captured.mediaStreamTrack.readyState).toBe('ended');
    expect(room.localParticipant.getTrackPublication(Track.Source.Microphone)).toBeUndefined();
    expect(room.state).toBe('connected');
  });
});

describe.skipIf(!import.meta.env.VITE_LIVEKIT_E2E)('a muted microphone releases its capture', () => {
  async function join(identity: string, roomName: string, options: Partial<ConnectLivekitRoomOptions> = {}) {
    const token = await commands.mintLivekitToken(identity, roomName);
    const room = createOfficeRoom();
    const connection = await connectLivekitRoom({ url: LIVEKIT_WS_URL, token, createRoom: () => room, ...options });
    rooms.push(connection);
    return { connection, room };
  }

  const ON = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

  function processing(track: MediaStreamTrack) {
    const { echoCancellation, noiseSuppression, autoGainControl } = track.getSettings();
    return { echoCancellation, noiseSuppression, autoGainControl };
  }

  it('muting ends the capture; unmuting captures again in the same publication', async () => {
    const stamp = Date.now();
    const microphone = createSharedMicrophone();
    const { connection, room } = await join(`mute-${stamp}`, LIVEKIT_ROOM_NAME, { microphone });
    expect(await connection.setMicrophoneEnabled(true)).toBe(true);
    const publication = ownPublication(room, 'audioinput');
    const sid = publication.trackSid;
    const firstCapture = publication.track!.mediaStreamTrack;

    expect(await connection.setMicrophoneEnabled(false)).toBe(false);

    expect(firstCapture.readyState).toBe('ended');
    expect(publication.isMuted).toBe(true);

    expect(await connection.setMicrophoneEnabled(true)).toBe(true);

    const secondCapture = publication.track!.mediaStreamTrack;
    expect(ownPublication(room, 'audioinput')).toBe(publication);
    expect(publication.trackSid).toBe(sid);
    expect(publication.isMuted).toBe(false);
    expect(secondCapture).not.toBe(firstCapture);
    expect(secondCapture.readyState).toBe('live');
    expect(publication.track!.sender?.track).toBe(secondCapture);
    expect(processing(secondCapture)).toEqual(ON);
    await releaseSharedMicrophone(microphone);
  });

  it('an unmute the browser refuses stays muted, tells the caller, and the next one works', async () => {
    const onDeviceFailed = vi.fn();
    const { connection, room } = await join(`refused-${Date.now()}`, LIVEKIT_ROOM_NAME, { onDeviceFailed });
    expect(await connection.setMicrophoneEnabled(true)).toBe(true);
    expect(await connection.setMicrophoneEnabled(false)).toBe(false);
    const publication = ownPublication(room, 'audioinput');
    const getUserMedia = vi
      .spyOn(navigator.mediaDevices, 'getUserMedia')
      .mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));

    try {
      expect(await connection.setMicrophoneEnabled(true)).toBe(false);

      expect(onDeviceFailed).toHaveBeenCalledExactlyOnceWith('audioinput', 'permission-denied');
      expect(publication.isMuted).toBe(true);
    } finally {
      getUserMedia.mockRestore();
    }

    expect(await connection.setMicrophoneEnabled(true)).toBe(true);
    expect(publication.isMuted).toBe(false);
    expect(publication.track!.mediaStreamTrack.readyState).toBe('live');
    expect(publication.track!.sender?.track).toBe(publication.track!.mediaStreamTrack);
  });

  it('a moderator mute ends the capture too (#282)', async () => {
    const identity = `moderated-capture-${Date.now()}`;
    const { connection, room } = await join(identity, LIVEKIT_ROOM_NAME);
    expect(await connection.setMicrophoneEnabled(true)).toBe(true);
    const capture = ownPublication(room, 'audioinput').track!.mediaStreamTrack;

    await expect.poll(() => commands.muteLivekitMicrophone(identity, LIVEKIT_ROOM_NAME), { timeout: 10_000 }).toBe(1);

    await expect.poll(() => capture.readyState, { timeout: 10_000 }).toBe('ended');
  });

  it('a door crossed while muted captures nothing; the next room captures on unmute, with the picked device', async () => {
    const stamp = Date.now();
    const microphone = createSharedMicrophone();
    const identity = `muted-door-${stamp}`;
    const floor = await join(identity, LIVEKIT_ROOM_NAME, { microphone });
    expect(await floor.connection.setMicrophoneEnabled(true)).toBe(true);
    const target = await otherDevice('audioinput', capturedDevice(floor.room, 'audioinput'));
    expect(await floor.connection.setMicrophoneEnabled(false)).toBe(false);
    expect(await floor.connection.switchDevice('audioinput', target)).toBe(true);
    const getUserMedia = vi.spyOn(navigator.mediaDevices, 'getUserMedia');

    try {
      await floor.connection.disconnect();
      const inside = await join(identity, livekitRoomFor(`muted-door-${stamp}`), {
        microphone,
        preferredDevices: { audioinput: target, audiooutput: null, videoinput: null },
      });

      expect(getUserMedia).not.toHaveBeenCalled();
      expect(inside.room.localParticipant.getTrackPublication(Track.Source.Microphone)).toBeUndefined();

      expect(await inside.connection.setMicrophoneEnabled(true)).toBe(true);

      const published = ownPublication(inside.room, 'audioinput');
      expect(published.isMuted).toBe(false);
      expect(published.track!.mediaStreamTrack.readyState).toBe('live');
      expect(published.track!.sender?.track).toBe(published.track!.mediaStreamTrack);
      expect(capturedDevice(inside.room, 'audioinput')).toBe(target);
      expect(processing(published.track!.mediaStreamTrack)).toEqual(ON);

      await inside.connection.disconnect();
      await releaseSharedMicrophone(microphone);
      expect(published.track?.mediaStreamTrack.readyState ?? 'ended').toBe('ended');
    } finally {
      getUserMedia.mockRestore();
    }
  });
});

describe.skipIf(!import.meta.env.VITE_LIVEKIT_E2E)('the browser voice processing reaches the shared microphone (#285)', () => {
  async function join(identity: string, roomName: string, microphone: ReturnType<typeof createSharedMicrophone>) {
    const token = await commands.mintLivekitToken(identity, roomName);
    const room = createOfficeRoom();
    const connection = await connectLivekitRoom({ url: LIVEKIT_WS_URL, token, createRoom: () => room, microphone });
    rooms.push(connection);
    return { connection, room };
  }

  function processing(track: MediaStreamTrack) {
    const { echoCancellation, noiseSuppression, autoGainControl } = track.getSettings();
    return { echoCancellation, noiseSuppression, autoGainControl };
  }

  const ON = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

  it('is on at capture, after a device switch and in the room behind a door', async () => {
    const stamp = Date.now();
    const microphone = createSharedMicrophone();
    const identity = `voice-${stamp}`;

    const floor = await join(identity, LIVEKIT_ROOM_NAME, microphone);
    expect(await floor.connection.setMicrophoneEnabled(true)).toBe(true);
    const captured = ownPublication(floor.room, 'audioinput').track!;
    expect(processing(captured.mediaStreamTrack)).toEqual(ON);

    // A switch restarts the capture: the new one must ask for the same processing.
    const target = await otherDevice('audioinput', capturedDevice(floor.room, 'audioinput'));
    expect(await floor.connection.switchDevice('audioinput', target)).toBe(true);
    expect(processing(captured.mediaStreamTrack)).toEqual(ON);

    await floor.connection.disconnect();
    const inside = await join(identity, livekitRoomFor(`voice-${stamp}`), microphone);
    expect(await inside.connection.setMicrophoneEnabled(true)).toBe(true);

    const published = ownPublication(inside.room, 'audioinput').track!;
    expect(published).toBe(captured);
    expect(processing(published.mediaStreamTrack)).toEqual(ON);
    expect(published.sender?.track).toBe(published.mediaStreamTrack);

    await inside.connection.disconnect();
    await releaseSharedMicrophone(microphone);
  });
});
