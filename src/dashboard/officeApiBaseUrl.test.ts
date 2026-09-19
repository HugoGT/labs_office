import { describe, expect, it } from 'vitest';
import { resolveAdminBaseUrl } from './adminClient';
import { resolveOfficeApiBaseUrl } from './officeApiBaseUrl';

describe('resolveOfficeApiBaseUrl', () => {
  it('sin servidor de oficina no hay nada que consultar', () => {
    // Una URL inventada solo produciria un fallo de red confuso: el panel
    // prefiere decir que no hay servidor.
    expect(resolveOfficeApiBaseUrl({ officeEndpoint: null })).toBeNull();
    expect(resolveOfficeApiBaseUrl({})).toBeNull();
  });

  it('deriva de ws:// a http://', () => {
    expect(resolveOfficeApiBaseUrl({ officeEndpoint: 'ws://localhost:2567' })).toBe(
      'http://localhost:2567',
    );
  });

  it('deriva de wss:// a https://', () => {
    expect(resolveOfficeApiBaseUrl({ officeEndpoint: 'wss://oficina.example.com' })).toBe(
      'https://oficina.example.com',
    );
  });

  it('no cuelga ningun prefijo: la raiz sirve rutas que no viven bajo /admin', () => {
    // `GET /desks` cuelga de la raiz -- lo lee cada cliente al arrancar, no
    // solo el panel -- asi que una base con `/admin` dentro no podria pedirlo.
    expect(resolveOfficeApiBaseUrl({ officeEndpoint: 'ws://localhost:2567' })).not.toContain(
      '/admin',
    );
  });

  it('la base del panel de invitaciones es esta misma mas /admin', () => {
    // Una sola derivacion y no dos copias del cambio de esquema: el dia que el
    // servidor deje de servir HTTP y WebSocket desde el mismo `http.Server`,
    // hay un unico sitio que corregir.
    const endpoint = 'wss://oficina.example.com';

    expect(resolveAdminBaseUrl({ officeEndpoint: endpoint })).toBe(
      `${resolveOfficeApiBaseUrl({ officeEndpoint: endpoint })}/admin`,
    );
  });
});
