/**
 * What the hover banner of a desk says and offers. Pure: `OfficeShell` passes
 * the served desks and the roster, and `DeskBanner` draws the result.
 */

import type { OfficeDesk } from '../game/desksPort';
import { DO_NOT_DISTURB, type PresenceStatus } from '../game/officeProtocol';
import type { RosterPeer } from '../game/roster';

/** What a desk held by someone without a chosen name is called. */
export const UNNAMED_OCCUPANT = 'Ocupado';

export type DeskBannerView =
  | { kind: 'free'; deskId: string; label: string; canClaim: boolean }
  | { kind: 'mine'; deskId: string; label: string; name: string; status: PresenceStatus; sessionId: string | null }
  | {
      kind: 'taken';
      deskId: string;
      label: string;
      name: string;
      /** `null` while they are not in the office. */
      status: PresenceStatus | null;
      sessionId: string | null;
      callable: boolean;
    };

export interface DeskBannerContext {
  self: RosterPeer;
  peers: readonly RosterPeer[];
  desks: readonly OfficeDesk[];
}

/**
 * The directory's unique key for a chosen name (`users_display_name_unique`
 * in `schema.sql`): two names that only differ here are the same person.
 */
function nameKey(name: string): string {
  return name.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * The occupant's session, found by name: the room publishes no user id, and a
 * chosen name is unique in the directory and is what the room shows. An
 * occupant without one (`displayName` null) is never guessed.
 */
function occupantSession(displayName: string | null, peers: readonly RosterPeer[]): RosterPeer | null {
  if (displayName === null) return null;
  const key = nameKey(displayName);
  return peers.find((peer) => nameKey(peer.name) === key) ?? null;
}

export function deskBannerView(desk: OfficeDesk, { self, peers, desks }: DeskBannerContext): DeskBannerView {
  const base = { deskId: desk.id, label: desk.label };
  if (desk.occupant === null) {
    // One desk per person: the server would move them, but the banner only offers a free desk to whoever has none.
    return { kind: 'free', ...base, canClaim: !desks.some((other) => other.mine) };
  }
  if (desk.mine) {
    return { kind: 'mine', ...base, name: self.name, status: self.status, sessionId: self.sessionId };
  }
  const peer = occupantSession(desk.occupant.displayName, peers);
  return {
    kind: 'taken',
    ...base,
    name: desk.occupant.displayName ?? UNNAMED_OCCUPANT,
    status: peer?.status ?? null,
    sessionId: peer?.sessionId ?? null,
    // Same D8 rule as the context menu: the server drops a call to No molestar anyway.
    callable: peer !== null && peer.status !== DO_NOT_DISTURB,
  };
}
