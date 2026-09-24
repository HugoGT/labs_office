/**
 * Suscribe el arbol de React al evento "roster" del puente (#74). Mismo
 * criterio deliberadamente simple que `useOfficeBridge`: un solo evento, un
 * solo estado, sin logica -- filtrar y ordenar es trabajo de `rosterView.ts`.
 */

import { useEffect, useState } from 'react';
import type { OfficeBridge } from '../game/officeBridge';
import type { RosterPeer } from '../game/roster';

export function useRoster(bridge: OfficeBridge): readonly RosterPeer[] {
  const [roster, setRoster] = useState<readonly RosterPeer[]>([]);

  useEffect(() => bridge.on('roster', (payload) => setRoster(payload.peers)), [bridge]);

  return roster;
}
