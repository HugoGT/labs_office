/**
 * Cableado HTTP de las rutas de administracion (#24). Los handlers puros ya se
 * prueban en `admin/adminRoutes.test.ts`; lo que se prueba AQUI es lo unico que
 * aquellos no pueden ver: que esten montados, con el metodo y la ruta que el
 * cliente usa, que el `:id` de revocar llegue al handler, y que el CORS deje
 * pasar la cabecera `Authorization`.
 *
 * Es exactamente la clase de fallo que un test de unidad no atrapa: un handler
 * perfecto que nadie monta responde 404, y un 404 en `/admin/*` es
 * indistinguible del `index.html` que Caddy devuelve cuando falta el bloque
 * `handle` (issue #24 punto 3). Dos fallos silenciosos con la misma cara.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createOfficeServer, type OfficeServer } from './createOfficeServer.ts';
import type { DirectoryUser } from './directory/directoryPort.ts';
import { createMemoryDirectory } from './directory/memoryDirectory.ts';
import type { IdTokenVerifier, VerifiedIdentity } from './verifyIdToken.ts';

// Cada `createOfficeServer` engancha sus propios listeners de apagado al
// proceso; el aviso de fuga de memoria seria ruido, no un sintoma.
process.setMaxListeners(100);

const JEFA: VerifiedIdentity = { uid: 'uid-jefa', email: 'jefa@example.com', name: 'Jefa' };
const CURRA: VerifiedIdentity = { uid: 'uid-curra', email: 'curra@example.com', name: 'Curra' };

/** Doble indexado por token; las firmas de verdad las prueba `verifyIdToken`. */
function verifierFor(tokens: Record<string, VerifiedIdentity>): IdTokenVerifier {
  return {
    async verify(token) {
      return typeof token === 'string' ? (tokens[token] ?? null) : null;
    },
  };
}

function userRow(over: Partial<DirectoryUser> & Pick<DirectoryUser, 'id' | 'email'>): DirectoryUser {
  return {
    uid: null,
    displayName: null,
    role: 'employee',
    status: 'active',
    expiresAt: null,
    invitedBy: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

const SUPERADMIN = userRow({
  id: '00000000-0000-4000-8000-00000000000a',
  uid: JEFA.uid,
  email: JEFA.email!,
  role: 'superadmin',
});

const EMPLEADA = userRow({
  id: '00000000-0000-4000-8000-00000000000b',
  uid: CURRA.uid,
  email: CURRA.email!,
  role: 'employee',
});

const open: OfficeServer[] = [];

async function start(overrides: Parameters<typeof createOfficeServer>[0]): Promise<string> {
  const server = createOfficeServer(overrides);
  open.push(server);
  const port = await server.listen(0);
  return `http://localhost:${port}`;
}

let baseUrl: string;

beforeEach(async () => {
  baseUrl = await start({
    auth: verifierFor({ 'tok-jefa': JEFA, 'tok-curra': CURRA }),
    directory: createMemoryDirectory({ seed: [SUPERADMIN, EMPLEADA] }),
    identityAdmin: null,
  });
});

afterEach(async () => {
  await Promise.all(open.splice(0).map((server) => server.shutdown()));
});

function as(token: string | null, path: string, init?: RequestInit) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
}

describe('rutas /admin montadas (#24)', () => {
  it('GET /admin/session responde a cualquiera autenticado, no solo a quien administra', async () => {
    // Si esta ruta exigiese rol de administracion, la pantalla de "no
    // autorizado" del panel no podria renderizarse NUNCA: el cliente la decide
    // justo con esta respuesta. Un 403 aqui romperia el unico caso que la ruta
    // existe para servir.
    const res = await as('tok-curra', '/admin/session');

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ role: 'employee', email: CURRA.email });
  });

  it('GET /admin/invitations exige rol de administracion', async () => {
    const res = await as('tok-curra', '/admin/invitations');

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  it('GET /admin/invitations responde la lista a quien administra', async () => {
    const res = await as('tok-jefa', '/admin/invitations');

    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty('invitations');
  });

  it('sin cabecera Authorization responde 401 y no 404', async () => {
    const res = await as(null, '/admin/invitations');

    expect(res.status).toBe(401);
  });

  it('POST /admin/invitations sin credencial de Identity Platform responde 503', async () => {
    const res = await as('tok-jefa', '/admin/invitations', {
      method: 'POST',
      body: JSON.stringify({ email: 'nueva@example.com', days: 7 }),
    });

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'identity-admin-not-configured' });
  });

  it('POST /admin/users exige rol de administracion', async () => {
    const res = await as('tok-curra', '/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email: 'nueva@example.com', role: 'employee' }),
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  it('POST /admin/users hace llegar el cuerpo al handler', async () => {
    // Sin credencial de Identity Platform el alta responde 503, y eso es
    // precisamente lo que distingue "el handler corrio" de "Express no tenia
    // ruta": un 404 sin cuerpo JSON seria indistinguible del index.html que
    // Caddy sirve cuando falta el bloque `handle /admin/*`.
    const res = await as('tok-jefa', '/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email: 'nueva@example.com', role: 'employee' }),
    });

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'identity-admin-not-configured' });
  });

  it('POST /admin/users con un rol que no se reparte responde 400 del handler', async () => {
    // El 503 de arriba ya prueba que el cuerpo llega (con un rol invalido seria
    // 400); esto prueba lo contrario, que la guarda de roles del handler se
    // alcanza por HTTP y no solo llamandolo a mano desde un test.
    const res = await as('tok-jefa', '/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email: 'nueva@example.com', role: 'superadmin' }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid-request' });
  });

  it('POST /admin/invitations/:id/revoke hace llegar el id al handler', async () => {
    // Un id inexistente tiene que dar 404 del HANDLER, no 404 de Express por no
    // haber ruta: si el parametro no se cableara, el handler nunca correria y
    // el test pasaria por el motivo equivocado. Lo que lo distingue es el
    // cuerpo JSON, que Express no produce para una ruta ausente.
    const res = await as('tok-jefa', '/admin/invitations/no-existe/revoke', { method: 'POST' });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not-found' });
  });

  it('POST /admin/users/:id/password-reset is mounted and passes the id to the handler (#94)', async () => {
    // Same reasoning as revoke: an unknown id must be the HANDLER's JSON 404.
    const missing = await as('tok-jefa', '/admin/users/no-existe/password-reset', {
      method: 'POST',
    });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'not-found' });

    // A real id reaches the adapter check: without Identity Platform it is 503.
    const known = await as('tok-jefa', `/admin/users/${EMPLEADA.id}/password-reset`, {
      method: 'POST',
    });
    expect(known.status).toBe(503);
    expect(await known.json()).toEqual({ error: 'identity-admin-not-configured' });
  });

  it('POST /admin/users/:id/password-reset requires an admin role', async () => {
    const res = await as('tok-curra', `/admin/users/${EMPLEADA.id}/password-reset`, {
      method: 'POST',
    });

    expect(res.status).toBe(403);
  });
});

describe('/admin sin directorio configurado (#24)', () => {
  it('responde 503 y no 404, para no confundirse con el SPA', async () => {
    // Un 404 aqui seria indistinguible del `index.html` que Caddy sirve cuando
    // falta el bloque `handle /admin/*`. El 503 dice "la ruta existe y el
    // servidor no esta configurado", que es una incidencia distinta.
    const url = await start({ auth: null, directory: null });

    const res = await fetch(`${url}/admin/session`);

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'directory-not-configured' });
  });
});

describe('CORS de /admin (#24, toca #9)', () => {
  it('el preflight permite la cabecera Authorization', async () => {
    // Sin esto el navegador bloquea TODAS las llamadas del panel antes de que
    // salgan: `/admin` es la primera ruta del servidor que autentica por
    // cabecera y no por el cuerpo, asi que la lista de `Content-Type` a secas
    // que valia para `/livekit/token` ya no alcanza.
    const res = await fetch(`${baseUrl}/admin/invitations`, { method: 'OPTIONS' });

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-headers')).toMatch(/authorization/i);
  });

  it('no concede credenciales de navegador', async () => {
    // Se autentica con un bearer en una cabecera que el cliente pone a mano, no
    // con cookies. Conceder credenciales ampliaria la superficie sin que nada
    // lo necesite.
    const res = await fetch(`${baseUrl}/admin/invitations`, { method: 'OPTIONS' });

    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('con ALLOWED_ORIGIN solo refleja un origen de la lista', async () => {
    const url = await start({
      auth: verifierFor({ 'tok-jefa': JEFA }),
      directory: createMemoryDirectory({ seed: [SUPERADMIN] }),
      identityAdmin: null,
      allowedOrigins: ['https://app.example.com', 'https://otro.example.com'],
    });

    const permitido = await fetch(`${url}/admin/invitations`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://otro.example.com' },
    });
    const ajeno = await fetch(`${url}/admin/invitations`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://malo.example.com' },
    });

    expect(permitido.headers.get('access-control-allow-origin')).toBe('https://otro.example.com');
    // Ni el origen ajeno ni un `*` que lo dejaria pasar igualmente.
    expect(ajeno.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('sin ALLOWED_ORIGIN se mantiene el comportamiento de hoy', async () => {
    // El desarrollo local y la suite e2e viven de este `*`. Apretarlo sin una
    // lista configurada dejaria el panel inaccesible fuera del despliegue.
    const res = await fetch(`${baseUrl}/admin/invitations`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173' },
    });

    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});
