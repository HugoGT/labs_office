import { describe, expect, it } from 'vitest';
import { resolveAuthConfig, resolveAuthSelection } from './authConfig';

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

describe('resolveAuthSelection', () => {
  const FIREBASE = { apiKey: 'AIza-publica', projectId: 'oficina-virtual' };

  it('without a mode keeps the Firebase behavior exactly', () => {
    expect(resolveAuthSelection({ ...FIREBASE, officeEndpoint: 'ws://localhost:2567' })).toEqual({
      kind: 'firebase',
      config: { apiKey: 'AIza-publica', projectId: 'oficina-virtual', authDomain: 'oficina-virtual.firebaseapp.com' },
    });
    expect(resolveAuthSelection({ mode: 'firebase', ...FIREBASE, officeEndpoint: null })?.kind).toBe('firebase');
  });

  it('without a mode or Firebase variables there is no auth', () => {
    expect(resolveAuthSelection({ officeEndpoint: 'ws://localhost:2567' })).toBeNull();
    expect(resolveAuthSelection({ mode: '', officeEndpoint: 'ws://localhost:2567' })).toBeNull();
  });

  it('local mode signs in against the office server, over http(s)', () => {
    expect(resolveAuthSelection({ mode: 'local', officeEndpoint: 'ws://localhost:2567' })).toEqual({
      kind: 'local',
      baseUrl: 'http://localhost:2567',
    });
    expect(resolveAuthSelection({ mode: ' LOCAL ', officeEndpoint: 'wss://app.example' })).toEqual({
      kind: 'local',
      baseUrl: 'https://app.example',
    });
  });

  it('local mode wins over Firebase variables, which it never initializes', () => {
    expect(resolveAuthSelection({ mode: 'local', ...FIREBASE, officeEndpoint: 'ws://localhost:2567' })?.kind).toBe(
      'local',
    );
  });

  it('local mode without a server has nothing to sign in against: no auth, like the server being off', () => {
    expect(resolveAuthSelection({ mode: 'local', officeEndpoint: null })).toBeNull();
  });
});
