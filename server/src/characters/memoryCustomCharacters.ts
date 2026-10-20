/** In-memory `CustomCharacterStore`, for tests and injection; same contract as `pgCustomCharacters.ts`. */

import type { CustomCharacterSpec } from '../../../src/art/customCharacter.ts';
import type { CustomCharacterStore } from './customCharacterPort.ts';

export function createMemoryCustomCharacters(seed: readonly (readonly [string, CustomCharacterSpec])[] = []): CustomCharacterStore {
  const specs = new Map<string, CustomCharacterSpec>(seed);
  return {
    async saveCustomCharacter(hash, spec) {
      if (!specs.has(hash)) specs.set(hash, spec);
    },
    async findCustomCharacter(hash) {
      return specs.get(hash) ?? null;
    },
  };
}
