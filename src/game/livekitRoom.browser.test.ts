// La cadena de re-exportacion de tipos de `vitest/browser` no resuelve
// `commands` cuando solo hay un provider de navegador instalado
// (`@vitest/browser-playwright`, sin `webdriverio`/`preview`): el `export *`
// hacia ese subpath no tiene condicion "import"/"default", solo "types". El
// valor en runtime SI existe (modulo virtual inyectado por Vitest Browser
// Mode); `BrowserCommands` si se exporta de forma directa (no via wildcard),
// asi que se usa para tipar el cast.
import * as vitestBrowser from 'vitest/browser';
import type { BrowserCommands } from 'vitest/browser';
import { Room, RoomEvent } from 'livekit-client';

const commands = (vitestBrowser as unknown as { commands: BrowserCommands }).commands;
import { afterEach, describe, expect, it } from 'vitest';
import { LIVEKIT_ROOM_NAME } from './officeProtocol';
import { connectLivekitRoom, type LivekitRoomConnection } from './livekitRoom';

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

async function connectWrapped(identity: string): Promise<{
  connection: LivekitRoomConnection;
  room: Room;
}> {
  const token = await commands.mintLivekitToken(identity, LIVEKIT_ROOM_NAME);
  const room = new Room();
  const connection = await connectLivekitRoom({
    url: LIVEKIT_WS_URL,
    token,
    createRoom: () => room,
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
      // suscribiera solo (sin que nadie llame setDesiredPeers), esto tendria
      // tiempo de dispararse.
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(subscribedEarly).toBe(false);
    });

    it('setDesiredPeers suscribe al publicador cuando aparece en el conjunto deseado', async () => {
      const publisherIdentity = `pub-${Date.now()}`;
      await connectPublisher(publisherIdentity);
      const { connection, room } = await connectWrapped(`sub-${Date.now()}`);

      const subscribed = new Promise<void>((resolve) => {
        room.on(RoomEvent.TrackSubscribed, () => resolve());
      });

      connection.setDesiredPeers([publisherIdentity]);

      await expect(subscribed).resolves.toBeUndefined();
    });

    it('quitar un peer del conjunto deseado lo desuscribe', async () => {
      const publisherIdentity = `pub-${Date.now()}`;
      await connectPublisher(publisherIdentity);
      const { connection, room } = await connectWrapped(`sub-${Date.now()}`);

      const subscribed = new Promise<void>((resolve) => {
        room.on(RoomEvent.TrackSubscribed, () => resolve());
      });
      connection.setDesiredPeers([publisherIdentity]);
      await subscribed;

      const unsubscribed = new Promise<void>((resolve) => {
        room.on(RoomEvent.TrackUnsubscribed, () => resolve());
      });
      connection.setDesiredPeers([]);

      await expect(unsubscribed).resolves.toBeUndefined();
    });

    it('una publicacion tardia (llega despues de pedirla) igual termina suscrita', async () => {
      const publisherIdentity = `pub-late-${Date.now()}`;
      const { connection, room } = await connectWrapped(`sub-${Date.now()}`);

      // El peer se pide ANTES de que exista: solo publica despues.
      connection.setDesiredPeers([publisherIdentity]);

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
      connection.setDesiredPeers([publisherIdentity]);
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
      connection.setDesiredPeers([publisherIdentity]);
      await subscribed;

      const unsubscribed = new Promise<void>((resolve) => {
        room.on(RoomEvent.TrackUnsubscribed, () => resolve());
      });
      connection.setDesiredPeers([]);
      await unsubscribed;
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(document.querySelectorAll('audio')).toHaveLength(0);
    });
  },
);
