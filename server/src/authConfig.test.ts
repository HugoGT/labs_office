/**
 * `resolveAuthConfig` es una funcion pura sobre un objeto de entorno inyectado
 * (no lee `process.env` por su cuenta): estas pruebas no ensucian el entorno
 * del proceso ni dependen del orden en que vitest ejecute los ficheros.
 */

import { describe, expect, it } from 'vitest';
import { resolveAuthConfig } from './authConfig.ts';

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
