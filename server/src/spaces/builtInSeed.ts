/**
 * Los dos espacios de siempre (#7), en un unico sitio server-side. Estos son
 * los datos que `schema.sql` inserta con `ON CONFLICT (id) DO NOTHING`, y son
 * los mismos ids/slugs/nombres/rectangulos que `BUILT_IN_SPACES` en
 * `src/game/mapData.ts` DEBE usar cuando la slice 1 (identidad de espacio)
 * aterrice -- ver la nota en `builtInSeed.test.ts` sobre por que esa
 * comprobacion cruzada vive aqui como literal en vez de importar de
 * `mapData.ts` todavia.
 *
 * Unidades: TILES. `ROOMS` en `mapData.ts` guarda las mismas dos salas en
 * PIXELES (`50 * TILE`, `TILE = 32`); estos valores son ese mismo rectangulo
 * ya dividido por `TILE`.
 */

import type { CanonicalSpace } from './spaceRules.ts';
import { hashSpaces } from './spaceRules.ts';

export const BUILT_IN_SEED_SPACES: readonly CanonicalSpace[] = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    slug: 'sala-de-juntas',
    name: 'Sala de Juntas',
    x: 50,
    y: 2,
    w: 13,
    h: 14,
    capacity: null,
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    slug: 'cafeteria',
    name: 'Cafetería',
    x: 50,
    y: 18,
    w: 13,
    h: 14,
    capacity: null,
  },
];

/**
 * La version que un cliente en modo fallback debe publicar (D4) para
 * coincidir con un despliegue sin editar. Calculada, no copiada a mano: si
 * `BUILT_IN_SEED_SPACES` cambia, este valor cambia solo con el.
 */
export const BUILT_IN_SEED_VERSION = hashSpaces(BUILT_IN_SEED_SPACES);
