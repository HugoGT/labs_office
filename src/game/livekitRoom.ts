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

import { Room, RoomEvent, type RemoteParticipant } from 'livekit-client';
import { reconcileSubscriptions } from './proximityAudio';

export interface LivekitRoomConnection {
  /** Guarda el conjunto deseado y reconcilia contra el estado vivo de la sala. */
  setDesiredPeers(sessionIds: readonly string[]): void;
  /** Devuelve el estado real: `false` si el dispositivo se deniega. */
  setMicrophoneEnabled(enabled: boolean): Promise<boolean>;
  setCameraEnabled(enabled: boolean): Promise<boolean>;
  disconnect(): Promise<void>;
}

export interface ConnectLivekitRoomOptions {
  url: string;
  token: string;
  /** Inyectable para pruebas: permite retener una referencia a la sala real. */
  createRoom?: () => Room;
}

/** Identidades con al menos una publicacion suscrita AHORA MISMO (D2: observado, no cacheado). */
function currentlySubscribed(room: Room): string[] {
  const subscribed: string[] = [];
  room.remoteParticipants.forEach((participant: RemoteParticipant, identity: string) => {
    const hasSubscribed = Array.from(participant.trackPublications.values()).some(
      (publication) => publication.isSubscribed,
    );
    if (hasSubscribed) subscribed.push(identity);
  });
  return subscribed;
}

export async function connectLivekitRoom({
  url,
  token,
  createRoom = () => new Room(),
}: ConnectLivekitRoomOptions): Promise<LivekitRoomConnection> {
  const room = createRoom();
  let desired: readonly string[] = [];

  function reconcile(): void {
    const current = currentlySubscribed(room);
    const { subscribe, unsubscribe } = reconcileSubscriptions(current, desired);

    for (const identity of subscribe) {
      const participant = room.remoteParticipants.get(identity);
      participant?.trackPublications.forEach((publication) => publication.setSubscribed(true));
    }
    for (const identity of unsubscribe) {
      const participant = room.remoteParticipants.get(identity);
      participant?.trackPublications.forEach((publication) => publication.setSubscribed(false));
    }
  }

  // Re-ejecuta la reconciliacion cuando una publicacion llega TARDE (un peer
  // ya deseado que aun no habia publicado nada al pedirlo).
  room.on(RoomEvent.TrackPublished, () => reconcile());
  room.on(RoomEvent.ParticipantConnected, () => reconcile());

  await room.connect(url, token, { autoSubscribe: false });

  return {
    setDesiredPeers(sessionIds) {
      desired = sessionIds;
      reconcile();
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
    async disconnect() {
      await room.disconnect();
    },
  };
}
