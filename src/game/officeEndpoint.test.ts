import { describe, expect, it } from 'vitest';
import { DEFAULT_SERVER_PORT, resolveOfficeEndpoint } from './officeEndpoint';

describe('resolveOfficeEndpoint', () => {
  it('respeta la URL configurada por encima de todo', () => {
    expect(
      resolveOfficeEndpoint({
        configured: 'wss://oficina.example.com',
        protocol: 'http:',
        hostname: 'localhost',
      }),
    ).toBe('wss://oficina.example.com');
  });

  it('deduce ws://host:2567 cuando no hay configuracion', () => {
    expect(resolveOfficeEndpoint({ protocol: 'http:', hostname: 'localhost' })).toBe(
      `ws://localhost:${DEFAULT_SERVER_PORT}`,
    );
  });

  it('usa wss sobre https: el navegador bloquea ws en pagina segura', () => {
    expect(resolveOfficeEndpoint({ protocol: 'https:', hostname: 'oficina.example.com' })).toBe(
      `wss://oficina.example.com:${DEFAULT_SERVER_PORT}`,
    );
  });

  it('una variable vacia apaga el multijugador a proposito', () => {
    // Distinto de no definirla: "" es una decision, `undefined` es un olvido.
    expect(resolveOfficeEndpoint({ configured: '   ', hostname: 'localhost' })).toBeNull();
  });

  it('sin host que deducir, devuelve null en vez de una URL invalida', () => {
    expect(resolveOfficeEndpoint({})).toBeNull();
  });
});
