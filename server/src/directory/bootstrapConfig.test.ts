/**
 * `resolveDirectoryConfig` es pura sobre un objeto de entorno inyectado, igual
 * que `resolveAuthConfig`: estas pruebas no ensucian `process.env` ni dependen
 * del orden en que vitest ejecute los ficheros.
 */

import { describe, expect, it } from 'vitest';
import { resolveDirectoryConfig } from './bootstrapConfig.ts';

describe('resolveDirectoryConfig', () => {
  it('devuelve la url y el email de bootstrap cuando ambos estan definidos', () => {
    expect(
      resolveDirectoryConfig({
        DATABASE_URL: 'postgres://user:pw@localhost:5432/oficina',
        BOOTSTRAP_SUPERADMIN_EMAIL: 'hugo@example.com',
      }),
    ).toEqual({
      databaseUrl: 'postgres://user:pw@localhost:5432/oficina',
      bootstrapSuperadminEmail: 'hugo@example.com',
      databaseSslCaFile: null,
    });
  });

  it('recorta los espacios que suele dejar un `.env` escrito a mano', () => {
    expect(
      resolveDirectoryConfig({
        DATABASE_URL: '  postgres://localhost/oficina \n',
        BOOTSTRAP_SUPERADMIN_EMAIL: ' hugo@example.com ',
      }),
    ).toEqual({
      databaseUrl: 'postgres://localhost/oficina',
      bootstrapSuperadminEmail: 'hugo@example.com',
      databaseSslCaFile: null,
    });
  });

  it('devuelve null si no hay DATABASE_URL: directorio desactivado', () => {
    expect(resolveDirectoryConfig({})).toBeNull();
  });

  it('devuelve null si DATABASE_URL esta vacia o es solo espacios', () => {
    // Un `DATABASE_URL=` sin valor llega como cadena vacia, no como `undefined`.
    // Tratarlo como configurado haria que `pg` intentase conectar a un destino
    // inventado y el sintoma seria un error de conexion en cada login, en vez
    // del honesto "falta configuracion".
    expect(resolveDirectoryConfig({ DATABASE_URL: '' })).toBeNull();
    expect(resolveDirectoryConfig({ DATABASE_URL: '   ' })).toBeNull();
  });

  it('con base de datos pero sin email de bootstrap, el directorio sigue activo', () => {
    // El directorio sirve para algo sin bootstrap: sigue resolviendo a quien
    // ya esta dado de alta y aplicando caducidades. Lo unico que no pasa es que nadie se promocione a
    // superadmin, que es exactamente lo que debe ocurrir si nadie lo ha pedido.
    expect(resolveDirectoryConfig({ DATABASE_URL: 'postgres://localhost/oficina' })).toEqual({
      databaseUrl: 'postgres://localhost/oficina',
      bootstrapSuperadminEmail: null,
      databaseSslCaFile: null,
    });
  });

  it('un email de bootstrap vacio cuenta como ausente, no como cadena vacia', () => {
    // Si se colase '' como email, la comparacion `lower(email) = lower('')` no
    // la cumple nadie; el riesgo no es de seguridad sino de diagnostico: el
    // operador veria la variable "puesta" y nunca entenderia por que no promociona.
    expect(
      resolveDirectoryConfig({
        DATABASE_URL: 'postgres://localhost/oficina',
        BOOTSTRAP_SUPERADMIN_EMAIL: '   ',
      }),
    ).toEqual({
      databaseUrl: 'postgres://localhost/oficina',
      bootstrapSuperadminEmail: null,
      databaseSslCaFile: null,
    });
  });

  it('lee la ruta del CA de la base de datos para exigir TLS verificado (#72)', () => {
    // Cloud SQL por IP privada: el servidor verifica el certificado de la
    // instancia contra SU propio CA. La ruta llega recortada, como las demas.
    expect(
      resolveDirectoryConfig({
        DATABASE_URL: 'postgres://office@10.100.0.3:5432/office',
        DATABASE_SSL_CA_FILE: ' /etc/office/db-server-ca.pem\n',
      }),
    ).toEqual({
      databaseUrl: 'postgres://office@10.100.0.3:5432/office',
      bootstrapSuperadminEmail: null,
      databaseSslCaFile: '/etc/office/db-server-ca.pem',
    });
  });

  it('una ruta de CA vacia cuenta como ausente: sin TLS, como en local', () => {
    expect(
      resolveDirectoryConfig({
        DATABASE_URL: 'postgres://localhost/oficina',
        DATABASE_SSL_CA_FILE: '  ',
      })?.databaseSslCaFile,
    ).toBeNull();
  });
});
