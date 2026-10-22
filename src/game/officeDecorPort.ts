/**
 * Port of the office decor layer's writes (#208). Types only, like
 * `terrainAdminPort.ts`; the only adapter is `officeDecorClient.ts`.
 *
 * There is no read: every client already holds the live layer, replicated by
 * the room (`OfficeState.officeDecor`), and the editor takes it from the
 * scene (`decor` bridge event).
 */

import type { DecorEdit } from './officeDecor';

export interface OfficeDecorPort {
  /**
   * Places, turns, replaces (`item`) or removes (`null`) the items anchored
   * on the edited tiles, all or none, at most `MAX_DECOR_EDITS` per call.
   * Everyone, this person included, sees the change through the room state,
   * so nothing comes back. Refused with `terrain-under-placement` when an
   * item would stand on water, void, a wall, another item or the entrance;
   * on one's own desk also with `no-desk` and `outside-desk`.
   */
  setDecor(edits: readonly DecorEdit[]): Promise<void>;
}
