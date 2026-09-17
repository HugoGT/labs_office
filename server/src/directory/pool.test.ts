/**
 * El pool es tan fino que lo unico que puede fallar es el cableado: que la url
 * no llegue, o que llegue por el nombre de opcion equivocado. Eso no lo dice
 * ningun tipo -- las opciones de `pg.Pool` son todas opcionales -- y el sintoma
 * seria un intento de conexion a `localhost` en el despliegue. De ahi que se
 * pruebe con el constructor inyectado, sin abrir ninguna conexion.
 */

import { describe, expect, it } from 'vitest';
import { createDirectoryPool } from './pool.ts';

describe('createDirectoryPool', () => {
  it('pasa la DATABASE_URL como connectionString', () => {
    const seen: unknown[] = [];
    class FakePool {
      constructor(options: unknown) {
        seen.push(options);
      }
      async query() {
        return { rows: [] };
      }
      async connect() {
        return { query: this.query, release() {} };
      }
      async end() {}
    }

    createDirectoryPool(
      { databaseUrl: 'postgres://user:pw@db:5432/oficina', bootstrapSuperadminEmail: null },
      FakePool as never,
    );

    expect(seen).toEqual([{ connectionString: 'postgres://user:pw@db:5432/oficina' }]);
  });

  it('por defecto construye un pool de pg de verdad, sin conectar todavia', async () => {
    // `pg.Pool` no abre conexiones al construirse, solo al primer `query`. Por
    // eso este test puede existir sin una base de datos delante, y por eso el
    // arranque del servidor no revienta si Postgres aun no esta listo.
    const pool = createDirectoryPool({
      databaseUrl: 'postgres://user:pw@localhost:5432/no-existe',
      bootstrapSuperadminEmail: null,
    });

    expect(typeof pool.query).toBe('function');
    expect(typeof pool.connect).toBe('function');
    await pool.end();
  });
});
