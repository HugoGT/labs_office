/**
 * Rastreo del roster de personas conectadas (#74), reemplazando el
 * `onAdd/onChange/onRemove` ad hoc que `OfficeScene.ts` usaba solo para
 * `emitPresence`. Espejo deliberado de `remoteAvatars.ts`: mismo patron de
 * `upsert`/`remove`/`clear`, mismo `ignoreSessionId` para descartar la propia
 * sesion (el HUD ya conoce su propio nombre/estado por otra via, ver
 * `rosterView.ts`).
 *
 * Solo guarda nombre y estado por sesion -- nunca posicion -- porque es
 * exactamente lo unico que cambia la lista visible. Un `onChange` de Colyseus
 * se dispara en cada tick de movimiento; reemitir en cada uno inundaria la
 * barra lateral con renders que no cambian nada en pantalla.
 */

import type { PresenceStatus } from './officeProtocol';

export interface RosterPeer {
  sessionId: string;
  name: string;
  status: PresenceStatus;
}

export interface RosterTrackerOptions {
  /** Sesion propia (espejo de `RemoteAvatarRegistryOptions.ignoreSessionId`): el roster lista PARES, nunca a uno mismo. */
  ignoreSessionId?: string;
}

export interface RosterTracker {
  upsert(peer: RosterPeer): void;
  remove(sessionId: string): void;
  clear(): void;
}

function sameEntry(a: RosterPeer, b: RosterPeer): boolean {
  return a.name === b.name && a.status === b.status;
}

export function createRosterTracker(
  onChange: (peers: readonly RosterPeer[]) => void,
  options: RosterTrackerOptions = {},
): RosterTracker {
  const peers = new Map<string, RosterPeer>();

  function emit(): void {
    onChange([...peers.values()].sort((a, b) => a.name.localeCompare(b.name)));
  }

  return {
    upsert(peer) {
      if (peer.sessionId === options.ignoreSessionId) return;

      const existing = peers.get(peer.sessionId);
      if (existing !== undefined && sameEntry(existing, peer)) return;

      peers.set(peer.sessionId, peer);
      emit();
    },
    remove(sessionId) {
      if (!peers.has(sessionId)) return;
      peers.delete(sessionId);
      emit();
    },
    clear() {
      if (peers.size === 0) return;
      peers.clear();
      emit();
    },
  };
}
