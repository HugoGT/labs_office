/**
 * Port of the character chosen at the office entrance (art migration, step
 * 5). Describes what `useCharacterChoice` needs, not how it is fetched: the
 * adapter (`characterClient.ts`) is the only module that talks HTTP, the same
 * split as `displayNamePort.ts`.
 *
 * Outcomes are closed unions, like the display name ones: `unavailable` (no
 * directory or no catalog on the server) is not a failure, it means "this
 * office does not keep characters today", which is solved by entering with
 * the pack default, not by retrying.
 */

import type { AccessDeniedResult } from './authErrors';

/** One character the selector can offer, with the sheets its previews cut frames from. */
export interface CharacterOption {
  readonly id: string;
  /** Spanish name from the pack manifest. */
  readonly name: string;
  readonly walkUrl: string;
  readonly seatedUrl: string;
  /** Credit of a contributed or uploaded character (#122); absent or `null` for the pack's. */
  readonly author?: string | null;
}

export interface CharacterCatalog {
  readonly options: readonly CharacterOption[];
  /** The pack default, preselected for someone whose stored id is not offered. */
  readonly defaultId: string;
}

export type ReadCharacterResult =
  | AccessDeniedResult
  | { outcome: 'ok'; avatarId: string; chosen: boolean }
  | { outcome: 'unavailable' | 'failed' };

/** `reason` is the server's `InvalidArtChoiceError` code, for the copy the selector shows. */
export type InvalidCharacterReason = 'unknown-piece' | 'retired-piece';

export type SaveCharacterResult =
  | AccessDeniedResult
  | { outcome: 'ok'; avatarId: string }
  | { outcome: 'invalid'; reason: InvalidCharacterReason }
  | { outcome: 'unavailable' | 'failed' };

export interface CharacterPort {
  /** The saved character and whether it was ever chosen. */
  read(): Promise<ReadCharacterResult>;
  save(avatarId: string): Promise<SaveCharacterResult>;
  /** The characters of the pack the SPA serves; `null` when it cannot be read. */
  catalog(): Promise<CharacterCatalog | null>;
}
