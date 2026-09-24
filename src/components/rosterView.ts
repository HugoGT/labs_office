/**
 * Vista pura del roster (#74): decide QUE se pinta y en que orden, sin tocar
 * el DOM. Separada de `OfficeSidebar.tsx` para probarla sin React ni jsdom,
 * mismo criterio que `proximity.ts`/`reconnectPolicy.ts`.
 */

import type { RosterPeer } from '../game/roster';

export interface VisibleRosterEntry extends RosterPeer {
  /** Uno mismo va primero y se distingue en la lista (#74). */
  isSelf: boolean;
}

/** Quita acentos y normaliza mayusculas para un filtro insensible a ambos. */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * Uno mismo siempre primero (spec "people-roster"), el resto ordenado por
 * nombre con `localeCompare('es')`. El roster que llega por el puente
 * (`OfficeEventMap['roster']`) YA excluye a uno mismo -- lo antepone esta
 * funcion, no un filtro contra `peers` -- porque `createRosterTracker` se
 * crea con `ignoreSessionId` (espejo de `remoteAvatars.ts`).
 */
export function visibleRoster(
  self: RosterPeer,
  peers: readonly RosterPeer[],
  query: string,
): readonly VisibleRosterEntry[] {
  const normalizedQuery = normalize(query);
  const matches = (entry: RosterPeer) => normalize(entry.name).includes(normalizedQuery);

  const rest = peers
    .filter(matches)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    .map((peer): VisibleRosterEntry => ({ ...peer, isSelf: false }));

  if (!matches(self)) return rest;

  return [{ ...self, isSelf: true }, ...rest];
}
