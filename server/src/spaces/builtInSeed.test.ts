/**
 * Comprueba que la semilla de `schema.sql` y lo que un cliente en modo
 * fallback publicaria coinciden (D4).
 *
 * Historia (relevante para no reabrir esto por error): cuando la slice 2
 * escribio este fichero, la slice 1 (identidad de espacio) todavia no habia
 * aterrizado -- `mapData.ts` exportaba `ROOMS`, no `BUILT_IN_SPACES` -- y la
 * slice 2 tenia prohibido tocar ese fichero. Por eso el primer describe de
 * abajo fija el contrato SOLO desde el lado server: `BUILT_IN_SEED_SPACES`
 * es la fuente canonica, y sus valores son EXACTAMENTE los que `schema.sql`
 * siembra. Ahora que la slice 1 aterrizo, el segundo describe cierra el
 * contrato completo: `BUILT_IN_SPACES`/`BUILT_IN_SPACES_VERSION` en
 * `mapData.ts` deben coincidir EXACTAMENTE con esta fuente server-side.
 */

import { describe, expect, it } from 'vitest';
import { BUILT_IN_SPACES, BUILT_IN_SPACES_VERSION } from '../../../src/game/mapData.ts';
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

/**
 * Cierra el contrato que la cabecera de este fichero dejaba pendiente para
 * la slice 1 (identidad de espacio): ahora que `BUILT_IN_SPACES` existe en
 * `src/game/mapData.ts`, sus ids/rectangulos y su version deben coincidir
 * EXACTAMENTE con esta fuente canonica server-side. Si algo diverge, un
 * despliegue sin editar dejaria de servir un payload que canonicaliza a la
 * version que el cliente en modo fallback ya sostiene -- exactamente el
 * escenario que D4 promete que no ocurre. Fijado con una prueba, no dejado a
 * la suerte.
 */
describe('BUILT_IN_SPACES (mapData.ts) coincide con BUILT_IN_SEED_SPACES (#7, D4)', () => {
  it('mismos ids, mismo orden, mismos nombres', () => {
    expect(BUILT_IN_SPACES.map((space) => space.id)).toEqual(
      BUILT_IN_SEED_SPACES.map((space) => space.id),
    );
    expect(BUILT_IN_SPACES.map((space) => space.name)).toEqual(
      BUILT_IN_SEED_SPACES.map((space) => space.name),
    );
  });

  it('mismos rectangulos, una vez convertidos de pixeles (cliente) a tiles (servidor)', () => {
    for (let i = 0; i < BUILT_IN_SPACES.length; i++) {
      const client = BUILT_IN_SPACES[i];
      const seed = BUILT_IN_SEED_SPACES[i];
      const TILE = 32;
      expect(client.x / TILE).toBe(seed.x);
      expect(client.y / TILE).toBe(seed.y);
      expect(client.w / TILE).toBe(seed.w);
      expect(client.h / TILE).toBe(seed.h);
    }
  });

  it('BUILT_IN_SPACES_VERSION (literal, cliente) === BUILT_IN_SEED_VERSION (calculado, servidor)', () => {
    expect(BUILT_IN_SPACES_VERSION).toBe(BUILT_IN_SEED_VERSION);
  });
});
