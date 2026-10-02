/**
 * El cableado del directorio desde el entorno, probado con el constructor del
 * pool inyectado: no hace falta Postgres para afirmar lo unico que puede
 * romperse aqui, que es que la configuracion no llegue donde tiene que llegar.
 */

import { describe, expect, it } from 'vitest';
import { directoryFromEnv } from './fromEnv.ts';
import { readSchemaSql } from './migrate.ts';
import { readArtPackManifest } from '../decor/artPackFile.ts';
import type { DirectoryPool } from './pgDirectory.ts';

interface FakePool extends DirectoryPool {
  queries: { text: string; values: unknown[] }[];
  ended: number;
}

function fakePool(): FakePool {
  return fakePoolAnswering([{}]);
}

function fakePoolAnswering(rows: Record<string, unknown>[]): FakePool {
  const queries: { text: string; values: unknown[] }[] = [];
  const state = { ended: 0 };
  const query = async (text: string, values: unknown[] = []) => {
    queries.push({ text, values });
    return { rows, rowCount: rows.length };
  };
  return {
    queries,
    get ended() {
      return state.ended;
    },
    query,
    async connect() {
      return { query, release() {} };
    },
    async end() {
      state.ended++;
    },
  };
}

describe('directoryFromEnv', () => {
  it('sin DATABASE_URL no construye nada: directorio desactivado', () => {
    // Y no construye tampoco el pool: un pool sin destino seria un objeto vivo
    // esperando una conexion que nadie pidio.
    let built = 0;
    const runtime = directoryFromEnv({}, () => {
      built++;
      return fakePool();
    });

    expect(runtime).toBeUndefined();
    expect(built).toBe(0);
  });

  it('la ruta del CA de la base de datos llega hasta el pool (#72)', () => {
    // Si se perdiese por el camino, el pool conectaria sin TLS y Cloud SQL
    // (ENCRYPTED_ONLY) lo rechazaria con un error que no apunta aqui.
    const configs: unknown[] = [];
    directoryFromEnv(
      {
        DATABASE_URL: 'postgres://office@10.100.0.3:5432/office',
        DATABASE_SSL_CA_FILE: '/etc/office/db-server-ca.pem',
      },
      (config) => {
        configs.push(config);
        return fakePool();
      },
    );

    expect(configs).toMatchObject([{ databaseSslCaFile: '/etc/office/db-server-ca.pem' }]);
  });

  it('con DATABASE_URL construye el pool y el directorio', () => {
    const pool = fakePool();
    const runtime = directoryFromEnv({ DATABASE_URL: 'postgres://localhost/oficina' }, () => pool);

    expect(runtime?.directory).toBeDefined();
  });

  it('migrate() manda el esquema por ese mismo pool', async () => {
    const pool = fakePool();
    const runtime = directoryFromEnv({ DATABASE_URL: 'postgres://localhost/oficina' }, () => pool);

    await runtime!.migrate();

    expect(pool.queries[0].text).toBe(readSchemaSql());
  });

  it('migrate() avisa DESPUES de escritorios que el backfill dejo sin cubiculo (#10 + #12, S1a tarea 1.2)', async () => {
    const pool = fakePool();
    const runtime = directoryFromEnv({ DATABASE_URL: 'postgres://localhost/oficina' }, () => pool);

    await runtime!.migrate();

    // La primera consulta es el esquema entero (ya afirmado arriba); la
    // segunda es `reportDesksWithoutSpace`, y tiene que llegar DESPUES del
    // backfill para poder ver lo que este dejo sin cubiculo.
    expect(pool.queries[1].text).toContain('LEFT JOIN spaces s ON s.desk_id = d.id');
  });

  it('el email de bootstrap del entorno llega hasta la sentencia de login', async () => {
    // Prueba de extremo a extremo del cableado: si se perdiese por el camino, el
    // sintoma seria que nadie llega nunca a superadmin y no habria ningun error.
    // Sin filas: nadie existe todavia, asi que el login llega al INSERT de
    // bootstrap, que es la sentencia que necesita ese email (#72).
    const pool = fakePoolAnswering([]);
    const runtime = directoryFromEnv(
      {
        DATABASE_URL: 'postgres://localhost/oficina',
        BOOTSTRAP_SUPERADMIN_EMAIL: 'Hugo@Example.com',
      },
      () => pool,
    );

    await runtime!.directory.resolveOnLogin({ uid: 'uid-hugo', email: 'hugo@example.com', name: 'Hugo' });

    const insert = pool.queries.find((query) => /^\s*insert into users/i.test(query.text));
    expect(insert?.values[2]).toBe('hugo@example.com');
  });

  it('close() del directorio cierra el pool que se construyo', async () => {
    const pool = fakePool();
    const runtime = directoryFromEnv({ DATABASE_URL: 'postgres://localhost/oficina' }, () => pool);

    await runtime!.directory.close();

    expect(pool.ended).toBe(1);
  });
});

describe('directoryFromEnv, espacios (#7, slice 3)', () => {
  it('con DATABASE_URL construye tambien el directorio de espacios', () => {
    const pool = fakePool();
    const runtime = directoryFromEnv({ DATABASE_URL: 'postgres://localhost/oficina' }, () => pool);

    expect(runtime?.spaces).toBeDefined();
  });

  it('los espacios salen del MISMO pool que el directorio de usuarios', async () => {
    // Un segundo pool contra la misma base seria el doble de conexiones que la
    // instancia cuenta, y ademas `directory.close()` solo cerraria el suyo:
    // el otro quedaria vivo tras el apagado.
    let built = 0;
    const pool = fakePool();
    const runtime = directoryFromEnv({ DATABASE_URL: 'postgres://localhost/oficina' }, () => {
      built++;
      return pool;
    });

    await runtime!.spaces.listSpaces();

    expect(built).toBe(1);
    expect(pool.queries.at(-1)?.text).toContain('FROM spaces');
  });
});

describe('directoryFromEnv, decoracion (#7, slice 4)', () => {
  it('con DATABASE_URL construye tambien el catalogo de decoracion', () => {
    const pool = fakePool();
    const runtime = directoryFromEnv({ DATABASE_URL: 'postgres://localhost/oficina' }, () => pool);

    expect(runtime?.decor).toBeDefined();
  });

  it('la decoracion sale del MISMO pool que el directorio y los espacios', async () => {
    // Misma razon que los espacios: un tercer pool contra la misma base seria
    // el triple de conexiones que la instancia cuenta, y `directory.close()`
    // solo cerraria el suyo.
    let built = 0;
    const pool = fakePool();
    const runtime = directoryFromEnv({ DATABASE_URL: 'postgres://localhost/oficina' }, () => {
      built++;
      return pool;
    });

    await runtime!.decor.listAssets();

    expect(built).toBe(1);
    expect(pool.queries.at(-1)?.text).toContain('FROM assets');
  });

  it('no trae migracion propia: las tablas ya estan en el mismo schema.sql', () => {
    const runtime = directoryFromEnv({ DATABASE_URL: 'postgres://localhost/oficina' }, fakePool);

    expect(Object.keys(runtime!)).toEqual(['directory', 'spaces', 'decor', 'desks', 'terrain', 'collisions', 'migrate']);
  });

  it('reads the terrain blocks (#123 phase 2) from the same pool', async () => {
    let built = 0;
    const pool = fakePool();
    const runtime = directoryFromEnv({ DATABASE_URL: 'postgres://localhost/oficina' }, () => {
      built++;
      return pool;
    });

    await runtime!.terrain.loadBlocks();

    expect(built).toBe(1);
    expect(pool.queries.at(-1)?.text).toContain('FROM terrain_blocks');
  });

  it('reads the piece collisions from the same pool', async () => {
    let built = 0;
    const pool = fakePool();
    const runtime = directoryFromEnv({ DATABASE_URL: 'postgres://localhost/oficina' }, () => {
      built++;
      return pool;
    });

    await runtime!.collisions.loadCollisions();

    expect(built).toBe(1);
    expect(pool.queries.at(-1)?.text).toContain('FROM piece_collisions');
  });
});

describe('directoryFromEnv, escritorios (#7, slice 5)', () => {
  it('con DATABASE_URL construye tambien el directorio de escritorios', () => {
    const pool = fakePool();
    const runtime = directoryFromEnv({ DATABASE_URL: 'postgres://localhost/oficina' }, () => pool);

    expect(runtime?.desks).toBeDefined();
  });

  it('los escritorios salen del MISMO pool que todo lo demas', async () => {
    // Misma razon que los espacios y la decoracion: un cuarto pool contra la
    // misma base seria el cuadruple de conexiones que la instancia cuenta, y
    // `directory.close()` solo cerraria el suyo.
    let built = 0;
    const pool = fakePool();
    const runtime = directoryFromEnv({ DATABASE_URL: 'postgres://localhost/oficina' }, () => {
      built++;
      return pool;
    });

    await runtime!.desks.listDesks();

    expect(built).toBe(1);
    expect(pool.queries.at(-1)?.text).toContain('FROM desks');
  });

  it('sin DATABASE_URL no hay escritorios que servir', () => {
    // Es el estado real de cualquier despliegue sin base de datos, y lo que
    // convierte las rutas en 503. Ver `createOfficeServer`.
    expect(directoryFromEnv({}, fakePool)).toBeUndefined();
  });
});

describe('directoryFromEnv, art pack catalog (art migration, step 3)', () => {
  const PACK = readArtPackManifest(new URL('../../../public/assets/pack/manifest.json', import.meta.url));

  it('migrate() registers the pack AFTER the schema, through the same pool', async () => {
    const pool = fakePool();
    const runtime = directoryFromEnv({ DATABASE_URL: 'postgres://localhost/oficina' }, () => pool, () => PACK);

    await runtime!.migrate();

    // The catalog table only exists once the schema ran.
    const firstUpsert = pool.queries.findIndex((query) => /insert into art_pieces/i.test(query.text));
    expect(firstUpsert).toBeGreaterThan(1);
    expect(pool.queries[firstUpsert].values[0]).toBe(PACK.pieces[0].id);
  });

  it('reads the manifest at migrate() time, not when the runtime is built', async () => {
    let reads = 0;
    const runtime = directoryFromEnv({ DATABASE_URL: 'postgres://localhost/oficina' }, fakePool, () => {
      reads++;
      return PACK;
    });
    expect(reads).toBe(0);

    await runtime!.migrate();

    expect(reads).toBe(1);
  });

  it('a manifest that cannot be read fails the start, like a schema that cannot be applied', async () => {
    const runtime = directoryFromEnv({ DATABASE_URL: 'postgres://localhost/oficina' }, fakePool, () => {
      throw new Error('ENOENT: manifest.json');
    });

    await expect(runtime!.migrate()).rejects.toThrow('ENOENT');
  });

  it('by default reads the committed manifest', async () => {
    const pool = fakePool();
    const runtime = directoryFromEnv({ DATABASE_URL: 'postgres://localhost/oficina' }, () => pool);

    await runtime!.migrate();

    const upserts = pool.queries.filter((query) => /insert into art_pieces/i.test(query.text));
    expect(upserts.map((query) => query.values[0])).toEqual(PACK.pieces.map((piece) => piece.id));
  });

  it('without DATABASE_URL there is no catalog and nothing reads the manifest', () => {
    let reads = 0;
    expect(
      directoryFromEnv({}, fakePool, () => {
        reads++;
        return PACK;
      }),
    ).toBeUndefined();
    expect(reads).toBe(0);
  });
});
