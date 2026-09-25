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
      {
        databaseUrl: 'postgres://user:pw@db:5432/oficina',
        bootstrapSuperadminEmail: null,
        databaseSslCaFile: null,
      },
      FakePool as never,
    );

    // Sin CA, ni rastro de `ssl`: el Postgres local de docker-compose no habla
    // TLS, y el desarrollo en local tiene que seguir igual que antes de #72.
    expect(seen).toEqual([{ connectionString: 'postgres://user:pw@db:5432/oficina' }]);
  });

  it('con CA exige TLS y verifica la cadena contra ese CA (verify-ca, #72)', () => {
    const seen: { ssl?: { ca?: string; rejectUnauthorized?: boolean; checkServerIdentity?: () => unknown } }[] = [];
    class FakePool {
      constructor(options: never) {
        seen.push(options);
      }
    }
    const read: string[] = [];

    createDirectoryPool(
      {
        databaseUrl: 'postgres://office:pw@10.100.0.3:5432/office',
        bootstrapSuperadminEmail: null,
        databaseSslCaFile: '/etc/office/db-server-ca.pem',
      },
      FakePool as never,
      (path) => {
        read.push(path);
        return '-----BEGIN CERTIFICATE-----\nCA\n-----END CERTIFICATE-----\n';
      },
    );

    expect(read).toEqual(['/etc/office/db-server-ca.pem']);
    const ssl = seen[0].ssl!;
    expect(ssl.ca).toBe('-----BEGIN CERTIFICATE-----\nCA\n-----END CERTIFICATE-----\n');
    // La cadena SI se verifica: `rejectUnauthorized` a false seria cifrar sin
    // saber con quien, que dentro de la VPC no protege de nada.
    expect(ssl.rejectUnauthorized).not.toBe(false);
    // El nombre NO: el certificado de Cloud SQL no lleva la IP privada, asi que
    // la comprobacion de hostname fallaria siempre. Verificar contra el CA de
    // la propia instancia es lo que prueba que al otro lado esta ella.
    expect(ssl.checkServerIdentity?.()).toBeUndefined();
  });

  it('un CA que no se puede leer tumba el arranque en vez de conectar sin TLS', () => {
    // Degradar a texto claro en silencio es justo lo que no se quiere: Cloud
    // SQL rechazaria la conexion igual (ENCRYPTED_ONLY) y el error apuntaria a
    // la red, no a un fichero que falta.
    expect(() =>
      createDirectoryPool(
        {
          databaseUrl: 'postgres://office:pw@10.100.0.3:5432/office',
          bootstrapSuperadminEmail: null,
          databaseSslCaFile: '/no/existe.pem',
        },
        class {} as never,
        () => {
          throw new Error('ENOENT: /no/existe.pem');
        },
      ),
    ).toThrow('ENOENT');
  });

  it('por defecto construye un pool de pg de verdad, sin conectar todavia', async () => {
    // `pg.Pool` no abre conexiones al construirse, solo al primer `query`. Por
    // eso este test puede existir sin una base de datos delante, y por eso el
    // arranque del servidor no revienta si Postgres aun no esta listo.
    const pool = createDirectoryPool({
      databaseUrl: 'postgres://user:pw@localhost:5432/no-existe',
      bootstrapSuperadminEmail: null,
      databaseSslCaFile: null,
    });

    expect(typeof pool.query).toBe('function');
    expect(typeof pool.connect).toBe('function');
    await pool.end();
  });
});
