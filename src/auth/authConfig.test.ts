import { describe, expect, it } from 'vitest';
import { resolveAuthConfig } from './authConfig';

describe('resolveAuthConfig', () => {
  it('devuelve la configuracion completa cuando estan las tres variables', () => {
    expect(
      resolveAuthConfig({
        apiKey: 'AIza-publica',
        projectId: 'oficina-virtual',
        authDomain: 'login.oficina.example.com',
      }),
    ).toEqual({
      apiKey: 'AIza-publica',
      projectId: 'oficina-virtual',
      authDomain: 'login.oficina.example.com',
    });
  });

  it('deduce authDomain como <projectId>.firebaseapp.com, que es el que crea GCP', () => {
    expect(resolveAuthConfig({ apiKey: 'AIza-publica', projectId: 'oficina-virtual' })).toEqual({
      apiKey: 'AIza-publica',
      projectId: 'oficina-virtual',
      authDomain: 'oficina-virtual.firebaseapp.com',
    });
  });

  it('recorta los espacios de las tres fuentes', () => {
    expect(
      resolveAuthConfig({
        apiKey: '  AIza-publica  ',
        projectId: '  oficina-virtual  ',
        authDomain: '  login.oficina.example.com  ',
      }),
    ).toEqual({
      apiKey: 'AIza-publica',
      projectId: 'oficina-virtual',
      authDomain: 'login.oficina.example.com',
    });
  });

  it('un authDomain vacio cae al deducido, no produce un dominio en blanco', () => {
    expect(
      resolveAuthConfig({ apiKey: 'AIza-publica', projectId: 'oficina-virtual', authDomain: '   ' }),
    ).toEqual({
      apiKey: 'AIza-publica',
      projectId: 'oficina-virtual',
      authDomain: 'oficina-virtual.firebaseapp.com',
    });
  });

  it('sin apiKey no hay autenticacion', () => {
    expect(resolveAuthConfig({ projectId: 'oficina-virtual' })).toBeNull();
  });

  it('sin projectId no hay autenticacion', () => {
    expect(resolveAuthConfig({ apiKey: 'AIza-publica' })).toBeNull();
  });

  it('variables vacias apagan la autenticacion a proposito, como en .env.e2e', () => {
    // Distinto de no definirlas: "" es una decision (ver `.env.e2e`), y el
    // resultado tiene que ser el mismo que antes de existir el login.
    expect(resolveAuthConfig({ apiKey: '   ', projectId: '   ' })).toBeNull();
    expect(resolveAuthConfig({})).toBeNull();
  });
});
