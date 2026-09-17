import { cleanup, render } from '@testing-library/react';
import * as vitestBrowser from 'vitest/browser';
import type { BrowserCommands } from 'vitest/browser';
import { Room } from 'livekit-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectLivekitRoom, type LivekitRoomConnection } from '../game/livekitRoom';
import type { AttachableTrack } from '../game/attachableTrack';
import { LIVEKIT_ROOM_NAME } from '../game/officeProtocol';
import { VideoTile } from './VideoTile';

const commands = (vitestBrowser as unknown as { commands: BrowserCommands }).commands;

/**
 * Necesita un LiveKit real levantado (mismo setup que `livekitRoom.browser.test.ts`),
 * gateado tras `VITE_LIVEKIT_E2E` con el mismo limite aceptado que el audio: no
 * corre en CI (#239), solo a mano con `VITE_LIVEKIT_E2E=1 pnpm test:browser --
 * VideoTile.browser`. Prueba el invariante de retiro completo (issue #17):
 * ningun `<video>` real sobrevive a desmontar la tile (lo que en produccion
 * ocurre al apagar la camara o salir de la sala, via
 * `onVideoTrackUnsubscribed`/`onLocalVideoTrackChanged(null)`).
 */
const LIVEKIT_WS_URL = 'ws://localhost:7880';

const rawRooms: Room[] = [];
const connections: LivekitRoomConnection[] = [];

afterEach(async () => {
  cleanup();
  for (const connection of connections.splice(0)) await connection.disconnect();
  for (const room of rawRooms.splice(0)) await room.disconnect();
});

async function connectPublisherWithCamera(identity: string): Promise<Room> {
  const token = await commands.mintLivekitToken(identity, LIVEKIT_ROOM_NAME);
  const room = new Room();
  rawRooms.push(room);
  await room.connect(LIVEKIT_WS_URL, token, { autoSubscribe: false });
  await room.localParticipant.setCameraEnabled(true);
  return room;
}

describe.skipIf(!import.meta.env.VITE_LIVEKIT_E2E)(
  'VideoTile: invariante de retiro completo contra un LiveKit real (issue #17, D3)',
  () => {
    it('la pista de video real suscrita se adjunta; al desmontar no queda ningun <video>', async () => {
      const publisherIdentity = `pub-${Date.now()}`;
      const publisher = await connectPublisherWithCamera(publisherIdentity);

      let subscribedTrack: AttachableTrack | undefined;
      const connection = await connectLivekitRoom({
        url: LIVEKIT_WS_URL,
        token: await commands.mintLivekitToken(`sub-${Date.now()}`, LIVEKIT_ROOM_NAME),
        createRoom: () => new Room(),
        onVideoTrackSubscribed: (_sessionId, track) => {
          subscribedTrack = track;
        },
      });
      connections.push(connection);
      connection.setDesiredVideoPeers([publisherIdentity]);

      await vi.waitFor(() => expect(subscribedTrack).toBeDefined(), { timeout: 15000 });

      const { container, unmount } = render(
        <VideoTile sessionId={publisherIdentity} name="Publisher" portraits={null} track={subscribedTrack!} speaking={false} />,
      );

      await vi.waitFor(() => {
        expect(container.querySelectorAll('video')).toHaveLength(1);
      });
      const videoEl = container.querySelector('video') as HTMLVideoElement;
      expect(videoEl.srcObject).toBeInstanceOf(MediaStream);

      unmount();

      expect(document.querySelectorAll('video')).toHaveLength(0);

      await publisher.disconnect();
    }, 20000);
  },
);
