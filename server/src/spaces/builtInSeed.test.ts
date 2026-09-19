/**
 * Comprueba que la semilla de `schema.sql` y lo que un cliente en modo
 * fallback publicaria coinciden (D4). En el diseno original esto se prueba
 * contra `BUILT_IN_SPACES`/`BUILT_IN_SPACES_VERSION` en `src/game/mapData.ts`
 * -- pero esos dos simbolos pertenecen a la slice 1 (identidad de espacio),
 * que en esta rama todavia NO ha aterrizado (`mapData.ts` sigue exportando
 * `ROOMS`, no `BUILT_IN_SPACES`), y la slice 2 tiene prohibido tocar ese
 * fichero.
 *
 * Este test fija el contrato desde el lado de la slice 2: `BUILT_IN_SEED_SPACES`
 * es la fuente canonica server-side, y sus valores (ids, slugs, nombres,
 * rectangulos) son EXACTAMENTE los que `schema.sql` siembra. Cuando la slice 1
 * aterrice, `BUILT_IN_SPACES` en `mapData.ts` debe copiar estos mismos ids y
 * rectangulos (en tiles), y `BUILT_IN_SPACES_VERSION` debe ser literalmente
 * `BUILT_IN_SEED_VERSION` de este fichero -- ese es el trabajo pendiente que
 * cierra el contrato completo, no una comprobacion que esta prueba pueda
 * hacer sin importar `mapData.ts`.
 */

import { describe, expect, it } from 'vitest';
import { readSchemaSql } from '../directory/migrate.ts';
import { hashSpaces } from './spaceRules.ts';
import { BUILT_IN_SEED_SPACES, BUILT_IN_SEED_VERSION } from './builtInSeed.ts';

describe('BUILT_IN_SEED_SPACES', () => {
  it('tiene exactamente los dos espacios de siempre', () => {
    expect(BUILT_IN_SEED_SPACES).toHaveLength(2);
    expect(BUILT_IN_SEED_SPACES.map((space) => space.name)).toEqual([
      'Sala de Juntas',
      'Cafetería',
    ]);
  });

  it('sus ids, slugs y rectangulos coinciden con lo que schema.sql siembra', () => {
    const schema = readSchemaSql().toLowerCase();

    for (const space of BUILT_IN_SEED_SPACES) {
      expect(schema).toContain(`'${space.id}', '${space.slug}'`);
    }
  });

  it('BUILT_IN_SEED_VERSION es hash(BUILT_IN_SEED_SPACES): no un literal copiado a mano', () => {
    expect(BUILT_IN_SEED_VERSION).toBe(hashSpaces(BUILT_IN_SEED_SPACES));
  });

  it('BUILT_IN_SEED_VERSION son 16 caracteres hex, la misma forma que `version` (D4)', () => {
    expect(BUILT_IN_SEED_VERSION).toMatch(/^[0-9a-f]{16}$/);
  });
});
