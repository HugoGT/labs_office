/** Empty bootstrap topology. Existing database rooms are never reset or re-seeded. */

import type { CanonicalSpace } from './spaceRules.ts';
import { hashSpaces } from './spaceRules.ts';

export const BUILT_IN_SEED_SPACES: readonly CanonicalSpace[] = [];

/**
 * La version que un cliente en modo fallback debe publicar (D4) para
 * coincidir con un despliegue sin editar. Calculada, no copiada a mano: si
 * `BUILT_IN_SEED_SPACES` cambia, este valor cambia solo con el.
 */
export const BUILT_IN_SEED_VERSION = hashSpaces(BUILT_IN_SEED_SPACES);
