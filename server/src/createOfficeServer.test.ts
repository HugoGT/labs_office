/**
 * Prueba de integracion de `POST /livekit/token`: servidor Colyseus + HTTP
 * reales, sin dobles. El guard de sesion viva (D5) solo prueba algo si se
 * ejercita contra un `onJoin`/`onLeave` reales; un doble de `sessions`
 * pasaria por alto justo el bug que este slice quiere evitar.
 *
 * Con la auth desactivada (el `describe` de arriba) ese guard sigue demostrando
 * solo que el sessionId esta conectado ahora, NO que quien llama sea su dueno.
 * El bloque de abajo, con auth activa, es el que cierra ese hueco: exige un ID
 * token verificado cuyo uid coincida con el dueno de la sesion (#8).
 */

import { Client } from 'colyseus.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIVEKIT_ROOM_NAME } from '../../src/game/officeProtocol.ts';
import { createOfficeServer, type OfficeServer } from './createOfficeServer.ts';
import type { UserDirectory } from './directory/directoryPort.ts';
import { createMemoryDirectory } from './directory/memoryDirectory.ts';
import { OFFICE_ROOM_NAME } from './OfficeRoom.ts';
import type { OfficeState } from './schema.ts';
import type { IdTokenVerifier, VerifiedIdentity } from './verifyIdToken.ts';

process.setMaxListeners(100);

let server: OfficeServer;
let baseUrl: string;
let wsUrl: string;
const openRooms: { leave: () => Promise<number> }[] = [];
const savedEnv = {
  LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET,
};

beforeEach(async () => {
  server = createOfficeServer();
  const port = await server.listen(0);
  baseUrl = `http://localhost:${port}`;
  wsUrl = `ws://localhost:${port}`;
});

afterEach(async () => {
  await Promise.all(
    openRooms.splice(0).map((room) =>
      Promise.race([
        room.leave().catch(() => 0),
        new Promise((resolve) => setTimeout(resolve, 500)),
      ]),
    ),
  );
  await server.shutdown();
  process.env.LIVEKIT_API_KEY = savedEnv.LIVEKIT_API_KEY;
  process.env.LIVEKIT_API_SECRET = savedEnv.LIVEKIT_API_SECRET;
});

async function join(name: string) {
  const room = await new Client(wsUrl).joinOrCreate<OfficeState>(OFFICE_ROOM_NAME, { name });
  openRooms.push(room);
  return room;
}

function postToken(body: unknown) {
  return fetch(`${baseUrl}/livekit/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

interface LivekitTokenResponseBody {
  token?: string;
  url?: string;
  identity?: string;
  room?: string;
  error?: string;
}

function readBody(res: Response): Promise<LivekitTokenResponseBody> {
  return res.json() as Promise<LivekitTokenResponseBody>;
}

describe('POST /livekit/token', () => {
  it('200 para una sesion viva; la sala la fija el servidor, no el cliente', async () => {
    process.env.LIVEKIT_API_KEY = 'devkey';
    process.env.LIVEKIT_API_SECRET = 'un-secreto-suficientemente-largo-para-hs256';
    const room = await join('Ana');

    const res = await postToken({ sessionId: room.sessionId });

    expect(res.status).toBe(200);
    const body = await readBody(res);
    expect(body.identity).toBe(room.sessionId);
    expect(body.room).toBe(LIVEKIT_ROOM_NAME);
    expect(typeof body.token).toBe('string');
    expect(typeof body.url).toBe('string');
  });

  it('ignora room/permissions que mande el cliente, no los valida (D5)', async () => {
    process.env.LIVEKIT_API_KEY = 'devkey';
    process.env.LIVEKIT_API_SECRET = 'un-secreto-suficientemente-largo-para-hs256';
    const room = await join('Ana');

    const res = await postToken({
      sessionId: room.sessionId,
      room: 'sala-inventada-por-el-cliente',
      permissions: { canPublish: false, canSubscribe: false },
    });

    expect(res.status).toBe(200);
    const body = await readBody(res);
    expect(body.room).toBe(LIVEKIT_ROOM_NAME);
  });

  it('400 si falta sessionId o no es texto', async () => {
    const missing = await postToken({});
    expect(missing.status).toBe(400);
    expect((await readBody(missing)).error).toBe('invalid-request');

    const wrongType = await postToken({ sessionId: 42 });
    expect(wrongType.status).toBe(400);
  });

  it('403 para un sessionId que nunca se conecto (typo o invento)', async () => {
    const res = await postToken({ sessionId: 'jamas-existio' });

    expect(res.status).toBe(403);
    expect((await readBody(res)).error).toBe('unknown-session');
  });

  it('403 para un sessionId que ya salio (sin replay tras leave)', async () => {
    const room = await join('Ana');
    const sessionId = room.sessionId;

    await room.leave();
    await new Promise((resolve) => setTimeout(resolve, 300));

    const res = await postToken({ sessionId });
    expect(res.status).toBe(403);
  });

  it('503 si el servidor no tiene configuradas las credenciales de LiveKit', async () => {
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;
    const room = await join('Ana');

    const res = await postToken({ sessionId: room.sessionId });

    expect(res.status).toBe(503);
    expect((await readBody(res)).error).toBe('livekit-not-configured');
  });

  it('responde el preflight CORS de /livekit/token (cliente y servidor viven en origenes distintos)', async () => {
    // El SPA (vite preview / build estatico) y este servidor Colyseus corren
    // en puertos distintos (D5: 2599 fijo para el servidor); el navegador
    // manda un preflight OPTIONS antes del POST con `Content-Type:
    // application/json` (no es un "simple request"). Descubierto por Slice E
    // (`two-client-audio.e2e.test.mjs`): sin esto, la conexion LiveKit real
    // nunca progresa -- el fetch del token se bloquea antes de llegar aqui.
    const res = await fetch(`${baseUrl}/livekit/token`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:9999',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('incluye Access-Control-Allow-Origin en la respuesta real del POST', async () => {
    process.env.LIVEKIT_API_KEY = 'devkey';
    process.env.LIVEKIT_API_SECRET = 'un-secreto-suficientemente-largo-para-hs256';
    const room = await join('Ana');

    const res = await fetch(`${baseUrl}/livekit/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Origin: 'http://localhost:9999' },
      body: JSON.stringify({ sessionId: room.sessionId }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('el secreto de LiveKit nunca aparece en la respuesta ni en la consola', async () => {
    const secret = 'secreto-unico-de-esta-prueba-que-jamas-debe-filtrarse';
    process.env.LIVEKIT_API_KEY = 'devkey';
    process.env.LIVEKIT_API_SECRET = secret;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const room = await join('Ana');
    const res = await postToken({ sessionId: room.sessionId });
    const rawBody = await res.text();

    expect(rawBody).not.toContain(secret);
    for (const [key, value] of res.headers) {
      expect(`${key}:${value}`).not.toContain(secret);
    }
    const logged = [...logSpy.mock.calls, ...errorSpy.mock.calls, ...warnSpy.mock.calls]
      .flat()
      .map(String)
      .join('\n');
    expect(logged).not.toContain(secret);

    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

describe('GET /health', () => {
  it('con la auth y el directorio desactivados lo informa de los dos', async () => {
    const res = await fetch(`${baseUrl}/health`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      room: OFFICE_ROOM_NAME,
      auth: 'disabled',
      directory: 'disabled',
    });
  });
});

/**
 * El directorio (#24) tiene el mismo problema de diagnostico que la auth: un
 * despliegue sin `DATABASE_URL` arranca perfectamente y deja entrar a todo el
 * mundo para siempre, sin un solo error en el log. La unica forma de notarlo
 * desde fuera es preguntarselo.
 */
describe('createOfficeServer con directorio (#24)', () => {
  function serverWithDirectory(directory: UserDirectory) {
    return createOfficeServer({ auth: null, directory });
  }

  it('informa `directory: enabled` en /health', async () => {
    const withDirectory = serverWithDirectory(createMemoryDirectory());
    const port = await withDirectory.listen(0);

    const res = await fetch(`http://localhost:${port}/health`);

    expect(await res.json()).toEqual({
      ok: true,
      room: OFFICE_ROOM_NAME,
      auth: 'disabled',
      directory: 'enabled',
    });
    await withDirectory.shutdown();
  });

  it('expone el directorio para las rutas de administracion y para los tests', async () => {
    const directory = createMemoryDirectory();
    const withDirectory = serverWithDirectory(directory);

    expect(withDirectory.directory).toBe(directory);
    await withDirectory.shutdown();
  });

  it('un `directory: null` explicito fuerza el modo sin directorio', async () => {
    const withoutDirectory = createOfficeServer({ auth: null, directory: null });

    expect(withoutDirectory.directory).toBeUndefined();
    await withoutDirectory.shutdown();
  });

  it('shutdown() cierra el directorio', async () => {
    // Sin esto, el pool de Postgres se queda con conexiones vivas: en
    // produccion son conexiones que la base de datos sigue contando, y en los
    // tests es un proceso de vitest que no termina.
    const directory = createMemoryDirectory();
    let closed = 0;
    const withDirectory = serverWithDirectory({
      ...directory,
      async close() {
        closed++;
      },
    });

    await withDirectory.shutdown();

    expect(closed).toBe(1);
  });
});

/**
 * Con auth activa el contrato cambia, y el cambio es el punto de #8: hasta
 * ahora cualquiera podia leer el `sessionId` de otro participante del estado de
 * la sala y pedir un token en su nombre. Estos tests levantan su propio
 * servidor con un verificador inyectado, sin tocar `process.env`.
 */
describe('POST /livekit/token con auth activa (#8)', () => {
  const ANA: VerifiedIdentity = { uid: 'uid-ana', email: 'ana@example.com', name: 'Ana' };
  const BETO: VerifiedIdentity = { uid: 'uid-beto', email: 'beto@example.com', name: 'Beto' };

  /**
   * Doble indexado por token. Las firmas de verdad ya las prueba
   * `verifyIdToken.test.ts`; lo que falta demostrar aqui es la guarda de dueno.
   */
  const verifier: IdTokenVerifier = {
    async verify(token: unknown) {
      if (token === 'token-de-ana') return ANA;
      if (token === 'token-de-beto') return BETO;
      return null;
    },
  };

  let authServer: OfficeServer;
  let authBaseUrl: string;
  let authWsUrl: string;

  beforeEach(async () => {
    authServer = createOfficeServer({ auth: verifier });
    const port = await authServer.listen(0);
    authBaseUrl = `http://localhost:${port}`;
    authWsUrl = `ws://localhost:${port}`;
    process.env.LIVEKIT_API_KEY = 'devkey';
    process.env.LIVEKIT_API_SECRET = 'un-secreto-suficientemente-largo-para-hs256';
  });

  afterEach(async () => {
    await authServer.shutdown();
  });

  async function joinAuth(token: string) {
    const room = await new Client(authWsUrl).joinOrCreate<OfficeState>(OFFICE_ROOM_NAME, { token });
    openRooms.push(room);
    return room;
  }

  function postAuthToken(body: unknown) {
    return fetch(`${authBaseUrl}/livekit/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('informa `auth: enabled` en /health', async () => {
    const res = await fetch(`${authBaseUrl}/health`);

    expect(await res.json()).toEqual({
      ok: true,
      room: OFFICE_ROOM_NAME,
      auth: 'enabled',
      directory: 'disabled',
    });
  });

  it('200 cuando el uid del token es el dueno de la sesion', async () => {
    const room = await joinAuth('token-de-ana');

    const res = await postAuthToken({ sessionId: room.sessionId, token: 'token-de-ana' });

    expect(res.status).toBe(200);
    const body = await readBody(res);
    expect(body.room).toBe(LIVEKIT_ROOM_NAME);
    expect(typeof body.token).toBe('string');
  });

  it('la identity sigue siendo el sessionId, NUNCA el uid', async () => {
    // `useProximityAudio` empareja participantes de LiveKit por sessionId de
    // Colyseus (`src/hooks/useProximityAudio.ts`, que pasa `payload.sessionIds`
    // a `setDesiredPeers` y estos acaban en `room.remoteParticipants.get(...)`).
    // Cambiar la identity al uid mataria el audio por proximidad en silencio:
    // los tokens se emitirian bien, la sala conectaria, y nadie se oiria.
    const room = await joinAuth('token-de-ana');

    const res = await postAuthToken({ sessionId: room.sessionId, token: 'token-de-ana' });

    const body = await readBody(res);
    expect(body.identity).toBe(room.sessionId);
    expect(body.identity).not.toBe('uid-ana');
  });

  it('403 forbidden-session si el token es valido pero de otra persona', async () => {
    // El agujero que cierra #8: Beto lee el sessionId de Ana en el estado de la
    // sala y pide un token en su nombre, con su propio token, que es valido.
    const ana = await joinAuth('token-de-ana');
    await joinAuth('token-de-beto');

    const res = await postAuthToken({ sessionId: ana.sessionId, token: 'token-de-beto' });

    expect(res.status).toBe(403);
    expect((await readBody(res)).error).toBe('forbidden-session');
  });

  it('401 unauthorized si el token es invalido', async () => {
    const room = await joinAuth('token-de-ana');

    const res = await postAuthToken({ sessionId: room.sessionId, token: 'token-forjado' });

    expect(res.status).toBe(401);
    expect((await readBody(res)).error).toBe('unauthorized');
  });

  it('401 (no 400) si falta el token o no es texto, aunque el sessionId sea valido', async () => {
    // Deliberadamente NO se distingue "cuerpo mal formado" de "token invalido":
    // un 400 aqui le diria a quien sondea que el `sessionId` que probo si es
    // bueno y que solo le falta la credencial.
    const room = await joinAuth('token-de-ana');

    const missing = await postAuthToken({ sessionId: room.sessionId });
    expect(missing.status).toBe(401);
    expect((await readBody(missing)).error).toBe('unauthorized');

    const wrongType = await postAuthToken({ sessionId: room.sessionId, token: 42 });
    expect(wrongType.status).toBe(401);
    expect((await readBody(wrongType)).error).toBe('unauthorized');
  });

  it('400 invalid-request si falta el sessionId: esa rama no cambia', async () => {
    const res = await postAuthToken({ token: 'token-de-ana' });

    expect(res.status).toBe(400);
    expect((await readBody(res)).error).toBe('invalid-request');
  });

  it('403 unknown-session mantiene su semantica para quien SI trae token valido', async () => {
    const res = await postAuthToken({ sessionId: 'jamas-existio', token: 'token-de-ana' });

    expect(res.status).toBe(403);
    expect((await readBody(res)).error).toBe('unknown-session');
  });

  it('REGRESION: sin token valido, una sesion viva y una inventada responden igual', async () => {
    // El orden de las guardas es la defensa. Si `unknown-session` se comprobase
    // antes que el token, estas dos respuestas serian distintas (403 la falsa,
    // 401 la viva) y cualquiera podria ir probando sessionIds hasta acertar uno
    // conectado sin tener credencial ninguna. Los sessionId de Colyseus son
    // cortos y no son secretos: es exactamente el sondeo que describe la #9.
    const room = await joinAuth('token-de-ana');

    const viva = await postAuthToken({ sessionId: room.sessionId, token: 'token-forjado' });
    const inventada = await postAuthToken({ sessionId: 'jamas-existio', token: 'token-forjado' });

    expect(viva.status).toBe(401);
    expect(inventada.status).toBe(401);
    expect(await readBody(viva)).toEqual(await readBody(inventada));
  });

  it('503 si falta la configuracion de LiveKit, despues de pasar las guardas', async () => {
    const room = await joinAuth('token-de-ana');
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;

    const res = await postAuthToken({ sessionId: room.sessionId, token: 'token-de-ana' });

    expect(res.status).toBe(503);
    expect((await readBody(res)).error).toBe('livekit-not-configured');
  });

  it('un token valido no sirve tras salir de la sala', async () => {
    const room = await joinAuth('token-de-ana');
    const sessionId = room.sessionId;

    await room.leave();
    await new Promise((resolve) => setTimeout(resolve, 300));

    const res = await postAuthToken({ sessionId, token: 'token-de-ana' });
    expect(res.status).toBe(403);
    expect((await readBody(res)).error).toBe('unknown-session');
  });
});

describe('POST /livekit/token con auth desactivada: nada cambia', () => {
  it('REGRESION: un cuerpo sin token sigue dando 200, no 401', async () => {
    // El modo sin auth tiene que seguir siendo byte por byte el de antes de #8:
    // es lo que permite levantar la oficina en local sin proyecto de Firebase.
    process.env.LIVEKIT_API_KEY = 'devkey';
    process.env.LIVEKIT_API_SECRET = 'un-secreto-suficientemente-largo-para-hs256';
    const room = await join('Ana');

    const res = await postToken({ sessionId: room.sessionId });

    expect(res.status).toBe(200);
    const body = await readBody(res);
    expect(body.identity).toBe(room.sessionId);
    expect(body.room).toBe(LIVEKIT_ROOM_NAME);
  });

  it('REGRESION: un token cualquiera en el cuerpo se ignora, no se verifica', async () => {
    process.env.LIVEKIT_API_KEY = 'devkey';
    process.env.LIVEKIT_API_SECRET = 'un-secreto-suficientemente-largo-para-hs256';
    const room = await join('Ana');

    const res = await postToken({ sessionId: room.sessionId, token: 'basura-absoluta' });

    expect(res.status).toBe(200);
  });

  it('REGRESION: las cuatro ramas de siempre conservan codigo y cuerpo', async () => {
    const sinSessionId = await postToken({});
    expect(sinSessionId.status).toBe(400);
    expect((await readBody(sinSessionId)).error).toBe('invalid-request');

    const desconocida = await postToken({ sessionId: 'jamas-existio' });
    expect(desconocida.status).toBe(403);
    expect((await readBody(desconocida)).error).toBe('unknown-session');

    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;
    const room = await join('Ana');
    const sinLivekit = await postToken({ sessionId: room.sessionId });
    expect(sinLivekit.status).toBe(503);
    expect((await readBody(sinLivekit)).error).toBe('livekit-not-configured');
  });
});

const overriddenServers: OfficeServer[] = [];

/**
 * Arranca un servidor con overrides propios (lista blanca incluida) y lo
 * registra para apagarse en `afterEach`, igual que en `adminRoutesWiring.test.ts:65-70`.
 * Separado del `server`/`beforeEach` de arriba porque estos tests necesitan un
 * `allowedOrigins` distinto por caso, no el servidor por defecto sin lista.
 */
async function start(overrides?: Parameters<typeof createOfficeServer>[0]): Promise<string> {
  const overridden = createOfficeServer(overrides);
  overriddenServers.push(overridden);
  const port = await overridden.listen(0);
  return `http://localhost:${port}`;
}

afterEach(async () => {
  await Promise.all(overriddenServers.splice(0).map((s) => s.shutdown()));
});

describe('CORS con lista blanca (#9)', () => {
  it('preflight de /livekit/token refleja un origen de la lista y marca Vary', async () => {
    const url = await start({ allowedOrigins: ['https://app.example.com'] });

    const res = await fetch(`${url}/livekit/token`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://app.example.com',
        'Access-Control-Request-Method': 'POST',
      },
    });

    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
    expect(res.headers.get('vary')).toContain('Origin');
  });

  it('preflight de /livekit/token no responde nada a un origen ajeno', async () => {
    const url = await start({ allowedOrigins: ['https://app.example.com'] });

    const res = await fetch(`${url}/livekit/token`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://malo.example.com',
        'Access-Control-Request-Method': 'POST',
      },
    });

    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('la respuesta real del POST sigue la misma lista, no solo el preflight', async () => {
    const url = await start({ allowedOrigins: ['https://app.example.com'] });

    const res = await fetch(`${url}/livekit/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Origin: 'https://malo.example.com' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('/health sigue la misma politica que el resto: no hay excepcion', async () => {
    const url = await start({ allowedOrigins: ['https://app.example.com'] });

    const permitido = await fetch(`${url}/health`, {
      headers: { Origin: 'https://app.example.com' },
    });
    const ajeno = await fetch(`${url}/health`, {
      headers: { Origin: 'https://malo.example.com' },
    });

    expect(permitido.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
    expect(ajeno.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('/health sin Origin responde 200 con lista blanca', async () => {
    // Nota de la regla de TDD estricta: esta no es una RED de verdad. El
    // invariante que protege (`/health` nunca rechaza una peticion) ya se
    // cumplia antes de este cambio, con o sin lista blanca configurada -- el
    // healthcheck del contenedor (`colyseus.Dockerfile:63`) llama sin
    // `Origin`. Se escribe igual como red de regresion para ese invariante; la
    // ausencia del propio `access-control-allow-origin` ya la cubre el caso
    // "ajeno" de la prueba anterior.
    const url = await start({ allowedOrigins: ['https://app.example.com'] });

    const res = await fetch(`${url}/health`);

    expect(res.status).toBe(200);
  });
});
