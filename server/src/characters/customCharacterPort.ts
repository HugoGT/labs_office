/**
 * Port of the characters built with the creator. Types only, same rule as
 * `collisionPort.ts`. The production adapter is `pgCustomCharacters.ts`, the
 * test one `memoryCustomCharacters.ts`.
 *
 * Specs are stored by their content hash (`customCharacterHash`), so two
 * people who build the same character share one row, and a row is never
 * changed once written: a different spec is a different hash. Only a stored
 * hash is ever rendered (`GET /assets/characters/<hash>/*`), which is what
 * keeps anyone from making the server draw a spec nobody saved.
 */

import type { CustomCharacterSpec } from '../../../src/art/customCharacter.ts';

export interface CustomCharacterStore {
  /** Stores an already validated spec under its hash; saving a stored hash again changes nothing. */
  saveCustomCharacter(hash: string, spec: CustomCharacterSpec): Promise<void>;
  /** The spec stored under `hash`, or `null` for an unknown hash or a row that no longer validates. */
  findCustomCharacter(hash: string): Promise<CustomCharacterSpec | null>;
}
