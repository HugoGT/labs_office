/**
 * `resolveAuthConfig` es una funcion pura sobre un objeto de entorno inyectado
 * (no lee `process.env` por su cuenta): estas pruebas no ensucian el entorno
 * del proceso ni dependen del orden en que vitest ejecute los ficheros.
 */

import { describe, expect, it } from 'vitest';
import { resolveAuthConfig, resolveServerAuthConfig } from './authConfig.ts';
import { AuthConfigError } from './authConfigError.ts';
import { LOCAL_AUTH_MIN_SECRET_LENGTH } from './localAuth/localAuthConfig.ts';

describe('resolveAuthConfig', () => {
  it('devuelve el projectId cuando la variable esta definida', () => {
    expect(resolveAuthConfig({ FIREBASE_PROJECT_ID: 'oficina-virtual' })).toEqual({
      projectId: 'oficina-virtual',
    });
  });

  it('recorta los espacios que suele dejar un `.env` escrito a mano', () => {
    expect(resolveAuthConfig({ FIREBASE_PROJECT_ID: '  oficina-virtual \n' })).toEqual({
      projectId: 'oficina-virtual',
    });
  });

  it('devuelve null si la variable no existe: auth desactivada', () => {
    expect(resolveAuthConfig({})).toBeNull();
  });

  it('devuelve null si la variable esta vacia o es solo espacios', () => {
    // Un `FIREBASE_PROJECT_ID=` sin valor en un `.env` llega como cadena vacia,
    // no como `undefined`. Tratarlo como configurado emitiria un `iss` esperado
    // de `https://securetoken.google.com/` que ningun token puede cumplir, y el
    // sintoma seria "todos los tokens son invalidos" en vez de "falta config".
    expect(resolveAuthConfig({ FIREBASE_PROJECT_ID: '' })).toBeNull();
    expect(resolveAuthConfig({ FIREBASE_PROJECT_ID: '   ' })).toBeNull();
  });
});

describe('resolveServerAuthConfig', () => {
  const SECRET = 'k'.repeat(LOCAL_AUTH_MIN_SECRET_LENGTH);

  it('is null without any auth variable: auth disabled, as before', () => {
    expect(resolveServerAuthConfig({})).toBeNull();
  });

  it('selects Firebase from FIREBASE_PROJECT_ID alone', () => {
    expect(resolveServerAuthConfig({ FIREBASE_PROJECT_ID: 'oficina-virtual' })).toEqual({
      kind: 'firebase',
      projectId: 'oficina-virtual',
    });
  });

  it('selects local auth from LOCAL_AUTH_USERS and LOCAL_AUTH_SECRET', () => {
    const config = resolveServerAuthConfig({
      LOCAL_AUTH_USERS: 'ana@local.test:pw',
      LOCAL_AUTH_SECRET: SECRET,
    });
    expect(config?.kind).toBe('local');
    expect(config?.kind === 'local' && config.users.get('ana@local.test')).toBe('pw');
  });

  it.each([
    { LOCAL_AUTH_USERS: 'ana@local.test:pw', LOCAL_AUTH_SECRET: SECRET },
    { LOCAL_AUTH_USERS: 'ana@local.test:pw' },
    { LOCAL_AUTH_SECRET: SECRET },
  ])('refuses to start with Firebase and any local auth variable together', (local) => {
    expect(() => resolveServerAuthConfig({ FIREBASE_PROJECT_ID: 'oficina-virtual', ...local })).toThrow(
      /mutually exclusive/,
    );
  });

  it('turns a malformed local configuration into an AuthConfigError', () => {
    expect(() => resolveServerAuthConfig({ LOCAL_AUTH_USERS: 'ana@local.test:pw' })).toThrow(
      AuthConfigError,
    );
  });
});
