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
import { createOfficeServer, warnIfOriginsUnrestricted, type OfficeServer } from './createOfficeServer.ts';
import type { DirectoryUser, UserDirectory } from './directory/directoryPort.ts';
import { createMemoryDirectory } from './directory/memoryDirectory.ts';
import { createMemoryDecor } from './decor/memoryDecor.ts';
import type { DecorCatalog } from './decor/decorPort.ts';
import { createMemoryDesks } from './desks/memoryDesks.ts';
import type { DeskDirectory } from './desks/desksPort.ts';
import { createMemorySpaces } from './spaces/memorySpaces.ts';
import type { SpacesDirectory } from './spaces/spacesPort.ts';
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
    // `Origin`. Se escribe igual como red de regresion para ese invariante.
    const url = await start({ allowedOrigins: ['https://app.example.com'] });

    const res = await fetch(`${url}/health`);

    expect(res.status).toBe(200);
    // Sin cabecera `Origin` no hay nada que reflejar. Se afirma aqui y no solo
    // en el caso "ajeno" porque es un GIVEN distinto: alli el navegador manda
    // un origen que no esta en la lista, aqui no manda ninguno.
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('no aparece Allow-Credentials con lista blanca configurada', async () => {
    // La lista blanca es lo que haria tentador activar credenciales: reflejar
    // un origen concreto es justo lo que exige la spec para permitirlas. No se
    // activan. La autenticacion viaja en un bearer token, no en cookies, asi
    // que la cabecera no debe existir ni con lista ni sin ella
    // (`adminRoutesWiring.test.ts:214-221` cubre el caso sin lista).
    const url = await start({ allowedOrigins: ['https://app.example.com'] });

    const preflight = await fetch(`${url}/livekit/token`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://app.example.com',
        'Access-Control-Request-Method': 'POST',
      },
    });
    const real = await fetch(`${url}/health`, {
      headers: { Origin: 'https://app.example.com' },
    });

    expect(preflight.headers.get('access-control-allow-credentials')).toBeNull();
    expect(real.headers.get('access-control-allow-credentials')).toBeNull();
  });
});

describe('warnIfOriginsUnrestricted', () => {
  it('avisa en produccion cuando no hay lista blanca', () => {
    const sink = vi.fn();

    warnIfOriginsUnrestricted([], { NODE_ENV: 'production' }, sink);

    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0]?.[0]).toContain('ALLOWED_ORIGIN');
  });

  it('no avisa en produccion si hay lista', () => {
    const sink = vi.fn();

    warnIfOriginsUnrestricted(['https://app.example.com'], { NODE_ENV: 'production' }, sink);

    expect(sink).not.toHaveBeenCalled();
  });

  it('no avisa fuera de produccion aunque no haya lista', () => {
    const sink = vi.fn();

    warnIfOriginsUnrestricted([], { NODE_ENV: 'test' }, sink);
    warnIfOriginsUnrestricted([], {}, sink);

    expect(sink).not.toHaveBeenCalled();
  });
});

/**
 * El cableado de las rutas de espacios (#7, slice 3). Lo que se prueba aqui es
 * la TRADUCCION -- que cada ruta existe, en su verbo, y que el estado "sin
 * almacen" responde 503 y no 404 -- no las reglas, que ya cubre
 * `spacesRoutes.test.ts` sin levantar servidor.
 *
 * Todo va por POST y ninguna por PUT/PATCH/DELETE a proposito: el middleware de
 * CORS anuncia `GET,POST,OPTIONS`, asi que un verbo de mas se bloquearia en el
 * preflight del navegador antes de llegar a Express. Es la misma forma que ya
 * usa `/admin/invitations/:id/revoke`.
 */
describe('rutas de espacios (#7, slice 3)', () => {
  const ADMIN_SPACES: DirectoryUser = {
    id: 'id-admin',
    uid: 'uid-admin',
    email: 'admin@example.com',
    displayName: 'Admin',
    role: 'admin',
    status: 'active',
    expiresAt: null,
    invitedBy: null,
    createdAt: new Date('2025-12-01T00:00:00.000Z'),
  };

  const spacesVerifier: IdTokenVerifier = {
    async verify(token: unknown) {
      if (token !== 'valido-uid-admin') return null;
      return { uid: 'uid-admin', email: 'admin@example.com', name: 'Admin' };
    },
  };

  const BEARER = { Authorization: 'Bearer valido-uid-admin', 'Content-Type': 'application/json' };

  async function spacesServer(overrides: { spaces?: SpacesDirectory | null } = {}) {
    const spaces = overrides.spaces === undefined ? createMemorySpaces() : overrides.spaces;
    const server = createOfficeServer({
      auth: spacesVerifier,
      directory: createMemoryDirectory({ seed: [ADMIN_SPACES] }),
      spaces,
      identityAdmin: null,
    });
    const port = await server.listen(0);
    return { server, spaces, url: `http://localhost:${port}` };
  }

  it('GET /spaces sirve la config sin cabecera de autorizacion', async () => {
    const { server, url } = await spacesServer();

    const res = await fetch(`${url}/spaces`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ spaces: [], version: expect.any(String) });
    await server.shutdown();
  });

  it('GET /spaces sin almacen responde 503 y no 404', async () => {
    // Un 404 aqui es indistinguible del `index.html` que sirve Caddy cuando
    // falta su bloque `handle`: dos averias con el mismo sintoma y causas
    // opuestas. El 503 afirma que la ruta existe y que falta la configuracion.
    // El cliente cae al fallback ante cualquier respuesta que no sea 200, asi
    // que un despliegue sin base de datos se comporta como hoy.
    const { server, url } = await spacesServer({ spaces: null });

    expect((await fetch(`${url}/spaces`)).status).toBe(503);
    await server.shutdown();
  });

  it('POST /admin/spaces sin credencial responde 401', async () => {
    const { server, url } = await spacesServer();

    const res = await fetch(`${url}/admin/spaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Sala', x: 1, y: 1, w: 4, h: 4, capacity: null }),
    });

    expect(res.status).toBe(401);
    await server.shutdown();
  });

  it('POST /admin/spaces crea el espacio y GET /spaces ya lo devuelve', async () => {
    const { server, url } = await spacesServer();

    const created = await fetch(`${url}/admin/spaces`, {
      method: 'POST',
      headers: BEARER,
      body: JSON.stringify({ name: 'Sala de Juntas', x: 1, y: 1, w: 4, h: 4, capacity: null }),
    });

    expect(created.status).toBe(201);
    const config = (await (await fetch(`${url}/spaces`)).json()) as { spaces: { name: string }[] };
    expect(config.spaces.map((space) => space.name)).toEqual(['Sala de Juntas']);
    await server.shutdown();
  });

  it('POST /admin/spaces/:id renombra sin cambiar el id', async () => {
    const { server, spaces, url } = await spacesServer();
    const created = await spaces!.createSpace({ name: 'Antes', x: 1, y: 1, w: 4, h: 4, capacity: null });

    const res = await fetch(`${url}/admin/spaces/${created.id}`, {
      method: 'POST',
      headers: BEARER,
      body: JSON.stringify({ name: 'Despues' }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: created.id, name: 'Despues' });
    await server.shutdown();
  });

  it('POST /admin/spaces/:id/delete borra el espacio', async () => {
    const { server, spaces, url } = await spacesServer();
    const created = await spaces!.createSpace({ name: 'Una', x: 1, y: 1, w: 4, h: 4, capacity: null });

    const res = await fetch(`${url}/admin/spaces/${created.id}/delete`, {
      method: 'POST',
      headers: BEARER,
    });

    expect(res.status).toBe(200);
    expect(await spaces!.listSpaces()).toEqual([]);
    await server.shutdown();
  });

  it('las rutas de administracion sin almacen responden 503', async () => {
    const { server, url } = await spacesServer({ spaces: null });

    const res = await fetch(`${url}/admin/spaces`, {
      method: 'POST',
      headers: BEARER,
      body: JSON.stringify({ name: 'Sala', x: 1, y: 1, w: 4, h: 4, capacity: null }),
    });

    expect(res.status).toBe(503);
    await server.shutdown();
  });
});

/**
 * El cableado de las rutas de decoracion (#7, slice 4). Lo que se prueba aqui
 * es la TRADUCCION -- que cada ruta existe, en su verbo, y que el estado "sin
 * almacen" responde 503 y no 404 -- no las reglas, que ya cubre
 * `decorRoutes.test.ts` sin levantar servidor.
 *
 * Archivar va por `POST .../archive` y no por `DELETE`, y nada usa `PUT`: el
 * middleware de CORS anuncia `GET,POST,OPTIONS`, asi que un verbo de mas se
 * bloquearia en el preflight del navegador antes de llegar a Express, y
 * ampliar esa lista seria ensanchar una cabecera de seguridad para todo el
 * servidor (#9). Misma forma que `/admin/spaces/:id/delete`.
 */
describe('rutas de decoracion (#7, slice 4)', () => {
  const ADMIN_DECOR: DirectoryUser = {
    id: 'id-admin',
    uid: 'uid-admin',
    email: 'admin@example.com',
    displayName: 'Admin',
    role: 'admin',
    status: 'active',
    expiresAt: null,
    invitedBy: null,
    createdAt: new Date('2025-12-01T00:00:00.000Z'),
  };

  const EMPLEADO_DECOR: DirectoryUser = {
    ...ADMIN_DECOR,
    id: 'id-empleado',
    uid: 'uid-empleado',
    email: 'empleado@example.com',
    displayName: 'Empleado',
    role: 'employee',
  };

  const decorVerifier: IdTokenVerifier = {
    async verify(token: unknown) {
      if (token === 'valido-uid-admin') {
        return { uid: 'uid-admin', email: 'admin@example.com', name: 'Admin' };
      }
      if (token === 'valido-uid-empleado') {
        return { uid: 'uid-empleado', email: 'empleado@example.com', name: 'Empleado' };
      }
      return null;
    },
  };

  const JSON_HEADERS = { 'Content-Type': 'application/json' };
  const BEARER_ADMIN = { Authorization: 'Bearer valido-uid-admin', ...JSON_HEADERS };
  const BEARER_EMPLEADO = { Authorization: 'Bearer valido-uid-empleado', ...JSON_HEADERS };

  const ASSET = {
    name: 'Planta Grande',
    kind: 'plant',
    textureKey: 'plant-large',
    w: 1,
    h: 1,
    placeableOnDesk: true,
  };

  async function decorServer(overrides: { decor?: DecorCatalog | null } = {}) {
    const decor = overrides.decor === undefined ? createMemoryDecor() : overrides.decor;
    const server = createOfficeServer({
      auth: decorVerifier,
      directory: createMemoryDirectory({ seed: [ADMIN_DECOR, EMPLEADO_DECOR] }),
      decor,
      identityAdmin: null,
    });
    const port = await server.listen(0);
    return { server, decor, url: `http://localhost:${port}` };
  }

  it('GET /admin/assets sin credencial responde 401', async () => {
    const { server, url } = await decorServer();

    expect((await fetch(`${url}/admin/assets`)).status).toBe(401);
    await server.shutdown();
  });

  it('POST /admin/assets crea el asset y GET /admin/assets ya lo devuelve', async () => {
    const { server, url } = await decorServer();

    const created = await fetch(`${url}/admin/assets`, {
      method: 'POST',
      headers: BEARER_ADMIN,
      body: JSON.stringify(ASSET),
    });

    expect(created.status).toBe(201);
    const listed = (await (
      await fetch(`${url}/admin/assets`, { headers: BEARER_ADMIN })
    ).json()) as { assets: { slug: string }[] };
    expect(listed.assets.map((asset) => asset.slug)).toEqual(['planta-grande']);
    await server.shutdown();
  });

  it('POST /admin/assets/:id/archive retira del catalogo sin borrar (D1b)', async () => {
    const { server, url } = await decorServer();
    const created = (await (
      await fetch(`${url}/admin/assets`, {
        method: 'POST',
        headers: BEARER_ADMIN,
        body: JSON.stringify(ASSET),
      })
    ).json()) as { id: string };

    const res = await fetch(`${url}/admin/assets/${created.id}/archive`, {
      method: 'POST',
      headers: BEARER_ADMIN,
    });

    expect(res.status).toBe(200);
    const listed = (await (
      await fetch(`${url}/admin/assets`, { headers: BEARER_ADMIN })
    ).json()) as { assets: unknown[] };
    expect(listed.assets).toEqual([]);
    await server.shutdown();
  });

  it('POST /admin/assets/:id/archive con un id desconocido responde 404', async () => {
    const { server, url } = await decorServer();

    const res = await fetch(`${url}/admin/assets/no-existe/archive`, {
      method: 'POST',
      headers: BEARER_ADMIN,
    });

    expect(res.status).toBe(404);
    await server.shutdown();
  });

  it('GET /assets deja ver el catalogo a quien no administra', async () => {
    // `/admin/assets` corre la guarda de rol, asi que sin esta ruta la unica
    // gente que podria ver que piezas hay seria justo la que no las coloca.
    const { server, url } = await decorServer();
    await fetch(`${url}/admin/assets`, {
      method: 'POST',
      headers: BEARER_ADMIN,
      body: JSON.stringify(ASSET),
    });

    const res = await fetch(`${url}/assets`, { headers: BEARER_EMPLEADO });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { assets: { slug: string }[] }).assets.map((a) => a.slug)).toEqual(
      ['planta-grande'],
    );
    await server.shutdown();
  });

  it('GET /assets sin credencial responde 401', async () => {
    // Cuelga de la raiz como `/desks`, y como `/desks` SI pide credencial: el
    // catalogo dice que tiene dentro esta oficina.
    const { server, url } = await decorServer();

    expect((await fetch(`${url}/assets`)).status).toBe(401);
    await server.shutdown();
  });

  it('GET /assets no ofrece lo retirado (D1b)', async () => {
    // Es el selector de quien coloca, y una pieza retirada no se puede volver
    // a anadir: ofrecerla seria ofrecer un 400.
    const { server, url } = await decorServer();
    const created = (await (
      await fetch(`${url}/admin/assets`, {
        method: 'POST',
        headers: BEARER_ADMIN,
        body: JSON.stringify(ASSET),
      })
    ).json()) as { id: string };
    await fetch(`${url}/admin/assets/${created.id}/archive`, {
      method: 'POST',
      headers: BEARER_ADMIN,
    });

    const res = await fetch(`${url}/assets`, { headers: BEARER_EMPLEADO });

    expect(((await res.json()) as { assets: unknown[] }).assets).toEqual([]);
    await server.shutdown();
  });

  it('GET /assets sin almacen responde 503 y no 404', async () => {
    // La misma guarda que el resto de rutas de decoracion: el 503 afirma que
    // la ruta existe y que falta la configuracion, y es lo que deja al cliente
    // degradar sin editor en vez de creer que se equivoco de url.
    const { server, url } = await decorServer({ decor: null });

    expect((await fetch(`${url}/assets`, { headers: BEARER_EMPLEADO })).status).toBe(503);
    await server.shutdown();
  });

  it('GET /me/desk no exige rol de administracion', async () => {
    const { server, url } = await decorServer();

    const res = await fetch(`${url}/me/desk`, { headers: BEARER_EMPLEADO });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [] });
    await server.shutdown();
  });

  it('POST /me/desk guarda el escritorio de quien manda el token, no el del cuerpo', async () => {
    // La propiedad de la slice, comprobada tambien de extremo a extremo: un
    // `userId` ajeno en el cuerpo no puede escribir el sitio de otra persona.
    const { server, decor, url } = await decorServer();
    const created = (await (
      await fetch(`${url}/admin/assets`, {
        method: 'POST',
        headers: BEARER_ADMIN,
        body: JSON.stringify(ASSET),
      })
    ).json()) as { id: string };

    const res = await fetch(`${url}/me/desk`, {
      method: 'POST',
      headers: BEARER_EMPLEADO,
      body: JSON.stringify({
        userId: ADMIN_DECOR.id,
        items: [{ assetId: created.id, slot: 0, rotation: 90 }],
      }),
    });

    expect(res.status).toBe(200);
    expect(await decor!.getDeskConfig(EMPLEADO_DECOR.id)).toHaveLength(1);
    expect(await decor!.getDeskConfig(ADMIN_DECOR.id)).toEqual([]);
    await server.shutdown();
  });

  it('POST /me/desk conserva una pieza retirada ya puesta, pero rechaza anadirla de nuevo (D1b)', async () => {
    // El diseno dice que una pieza retirada se conserva, se puede quitar y no
    // se puede volver a anadir. Las tres, de extremo a extremo: sin el 400 del
    // final, "no se puede re-anadir" seria solo que el selector la esconde.
    const { server, url } = await decorServer();
    const created = (await (
      await fetch(`${url}/admin/assets`, {
        method: 'POST',
        headers: BEARER_ADMIN,
        body: JSON.stringify(ASSET),
      })
    ).json()) as { id: string };
    const items = [{ assetId: created.id, slot: 0, rotation: 90 }];

    await fetch(`${url}/me/desk`, {
      method: 'POST',
      headers: BEARER_EMPLEADO,
      body: JSON.stringify({ items }),
    });
    await fetch(`${url}/admin/assets/${created.id}/archive`, {
      method: 'POST',
      headers: BEARER_ADMIN,
    });

    // Conservarla al reguardar: sigue ahi.
    const conservada = await fetch(`${url}/me/desk`, {
      method: 'POST',
      headers: BEARER_EMPLEADO,
      body: JSON.stringify({ items: [{ assetId: created.id, slot: 3, rotation: 0 }] }),
    });
    expect(conservada.status).toBe(200);

    // Quitarla: se puede.
    const vaciada = await fetch(`${url}/me/desk`, {
      method: 'POST',
      headers: BEARER_EMPLEADO,
      body: JSON.stringify({ items: [] }),
    });
    expect(vaciada.status).toBe(200);

    // Volver a ponerla: ya no.
    const reanadida = await fetch(`${url}/me/desk`, {
      method: 'POST',
      headers: BEARER_EMPLEADO,
      body: JSON.stringify({ items }),
    });
    expect(reanadida.status).toBe(400);
    expect(await reanadida.json()).toEqual({ error: 'invalid-request' });

    await server.shutdown();
  });

  it('POST /me/desk con un slot invalido responde 400', async () => {
    const { server, url } = await decorServer();

    const res = await fetch(`${url}/me/desk`, {
      method: 'POST',
      headers: BEARER_EMPLEADO,
      body: JSON.stringify({ items: [{ assetId: 'cualquiera', slot: 99, rotation: 0 }] }),
    });

    expect(res.status).toBe(400);
    await server.shutdown();
  });

  it('sin almacen las cinco rutas responden 503 y nunca 404', async () => {
    // Un 404 aqui es indistinguible del `index.html` que sirve Caddy cuando
    // falta su bloque `handle`: dos averias con el mismo sintoma y causas
    // opuestas. El 503 afirma que la ruta existe y que falta la configuracion.
    const { server, url } = await decorServer({ decor: null });

    const respuestas = await Promise.all([
      fetch(`${url}/admin/assets`, { headers: BEARER_ADMIN }),
      fetch(`${url}/admin/assets`, {
        method: 'POST',
        headers: BEARER_ADMIN,
        body: JSON.stringify(ASSET),
      }),
      fetch(`${url}/admin/assets/cualquiera/archive`, { method: 'POST', headers: BEARER_ADMIN }),
      fetch(`${url}/me/desk`, { headers: BEARER_EMPLEADO }),
      fetch(`${url}/me/desk`, {
        method: 'POST',
        headers: BEARER_EMPLEADO,
        body: JSON.stringify({ items: [] }),
      }),
    ]);

    expect(respuestas.map((res) => res.status)).toEqual([503, 503, 503, 503, 503]);
    expect(await respuestas[0].json()).toEqual({ error: 'decor-not-configured' });
    await server.shutdown();
  });
});

/**
 * El cableado de las rutas de escritorios (#7, slice 5). Lo que se prueba aqui
 * es la TRADUCCION -- que cada ruta existe, en su verbo, y que el estado "sin
 * almacen" responde 503 y no 404 -- no las reglas, que ya cubre
 * `desksRoutes.test.ts` sin levantar servidor.
 *
 * Con una excepcion que si vale la pena de extremo a extremo: que un cuerpo
 * con un `userId` ajeno no pueda sentar ni levantar a otra persona. Los
 * handlers puros ni siquiera reciben cuerpo, pero eso solo significa algo si
 * Express tampoco se lo pasa, y eso se ve aqui.
 *
 * Todo va por POST y ninguna por PUT/PATCH/DELETE a proposito: el middleware
 * de CORS anuncia `GET,POST,OPTIONS`, asi que un verbo de mas se bloquearia en
 * el preflight del navegador antes de llegar a Express. Misma forma que
 * `/admin/spaces/:id/delete` y `/admin/assets/:id/archive`.
 */
describe('rutas de escritorios (#7, slice 5)', () => {
  const ADMIN_DESKS: DirectoryUser = {
    id: 'id-admin',
    uid: 'uid-admin',
    email: 'admin@example.com',
    displayName: 'Admin',
    role: 'admin',
    status: 'active',
    expiresAt: null,
    invitedBy: null,
    createdAt: new Date('2025-12-01T00:00:00.000Z'),
  };

  const ANA_DESKS: DirectoryUser = {
    ...ADMIN_DESKS,
    id: 'id-ana',
    uid: 'uid-ana',
    email: 'ana@example.com',
    displayName: 'Ana',
    role: 'employee',
  };

  const BRUNO_DESKS: DirectoryUser = {
    ...ANA_DESKS,
    id: 'id-bruno',
    uid: 'uid-bruno',
    email: 'bruno@example.com',
    displayName: 'Bruno',
  };

  const desksVerifier: IdTokenVerifier = {
    async verify(token: unknown) {
      for (const person of [ADMIN_DESKS, ANA_DESKS, BRUNO_DESKS]) {
        if (token === `valido-${person.uid}`) {
          return { uid: person.uid!, email: person.email, name: person.displayName };
        }
      }
      return null;
    },
  };

  const JSON_HEADERS = { 'Content-Type': 'application/json' };
  const BEARER_ADMIN = { Authorization: 'Bearer valido-uid-admin', ...JSON_HEADERS };
  const BEARER_ANA = { Authorization: 'Bearer valido-uid-ana', ...JSON_HEADERS };
  const BEARER_BRUNO = { Authorization: 'Bearer valido-uid-bruno', ...JSON_HEADERS };

  async function desksServer(overrides: { desks?: DeskDirectory | null } = {}) {
    const directory = createMemoryDirectory({ seed: [ADMIN_DESKS, ANA_DESKS, BRUNO_DESKS] });
    const decor = createMemoryDecor();
    const desks =
      overrides.desks === undefined ? createMemoryDesks({ directory, decor }) : overrides.desks;
    const server = createOfficeServer({
      auth: desksVerifier,
      directory,
      decor,
      desks,
      identityAdmin: null,
    });
    const port = await server.listen(0);
    return { server, desks, decor, url: `http://localhost:${port}` };
  }

  async function createDesk(url: string, body: Record<string, unknown>) {
    const res = await fetch(`${url}/admin/desks`, {
      method: 'POST',
      headers: BEARER_ADMIN,
      body: JSON.stringify(body),
    });
    return (await res.json()) as { id: string };
  }

  it('GET /desks exige credencial, a diferencia de GET /spaces', async () => {
    const { server, url } = await desksServer();

    expect((await fetch(`${url}/desks`)).status).toBe(401);
    await server.shutdown();
  });

  it('GET /desks con credencial sirve la oficina entera', async () => {
    const { server, url } = await desksServer();

    const res = await fetch(`${url}/desks`, { headers: BEARER_ANA });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ desks: [] });
    await server.shutdown();
  });

  it('POST /admin/desks crea el escritorio y GET /desks ya lo devuelve', async () => {
    const { server, url } = await desksServer();

    await createDesk(url, { label: 'Mesa 1', x: 4, y: 4 });

    const office = (await (await fetch(`${url}/desks`, { headers: BEARER_ANA })).json()) as {
      desks: { label: string; w: number; occupant: unknown }[];
    };
    expect(office.desks).toEqual([
      expect.objectContaining({ label: 'Mesa 1', x: 4, y: 4, w: 3, h: 3, occupant: null }),
    ]);
    await server.shutdown();
  });

  it('POST /admin/desks sin rol de administracion responde 403', async () => {
    const { server, url } = await desksServer();

    const res = await fetch(`${url}/admin/desks`, {
      method: 'POST',
      headers: BEARER_ANA,
      body: JSON.stringify({ label: 'Mesa', x: 0, y: 0 }),
    });

    expect(res.status).toBe(403);
    await server.shutdown();
  });

  it('POST /admin/desks/:id renombra sin cambiar el id', async () => {
    const { server, url } = await desksServer();
    const created = await createDesk(url, { label: 'Antes', x: 0, y: 0 });

    const res = await fetch(`${url}/admin/desks/${created.id}`, {
      method: 'POST',
      headers: BEARER_ADMIN,
      body: JSON.stringify({ label: 'Despues' }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: created.id, label: 'Despues' });
    await server.shutdown();
  });

  it('POST /admin/desks/:id encima de otro responde 409', async () => {
    const { server, url } = await desksServer();
    await createDesk(url, { label: 'Mesa 1', x: 0, y: 0 });
    const segundo = await createDesk(url, { label: 'Mesa 2', x: 8, y: 0 });

    const res = await fetch(`${url}/admin/desks/${segundo.id}`, {
      method: 'POST',
      headers: BEARER_ADMIN,
      body: JSON.stringify({ x: 1, y: 0 }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'desk-overlap' });
    await server.shutdown();
  });

  it('POST /admin/desks/:id con un id que no existe responde 404', async () => {
    const { server, url } = await desksServer();

    const res = await fetch(`${url}/admin/desks/no-existe`, {
      method: 'POST',
      headers: BEARER_ADMIN,
      body: JSON.stringify({ label: 'Mesa' }),
    });

    expect(res.status).toBe(404);
    await server.shutdown();
  });

  it('POST /admin/desks/:id/delete borra el escritorio', async () => {
    const { server, desks, url } = await desksServer();
    const created = await createDesk(url, { label: 'Mesa', x: 0, y: 0 });

    const res = await fetch(`${url}/admin/desks/${created.id}/delete`, {
      method: 'POST',
      headers: BEARER_ADMIN,
    });

    expect(res.status).toBe(200);
    expect(await desks!.listDesks()).toEqual([]);
    await server.shutdown();
  });

  it('POST /desks/:id/claim sienta a quien manda el token, no a quien diga el cuerpo', async () => {
    // La propiedad de la slice, comprobada de extremo a extremo: un `userId`
    // ajeno en el cuerpo no puede sentar a otra persona. Los handlers puros ni
    // reciben cuerpo, pero eso solo significa algo si Express tampoco lo pasa.
    const { server, desks, url } = await desksServer();
    const created = await createDesk(url, { label: 'Mesa', x: 0, y: 0 });

    const res = await fetch(`${url}/desks/${created.id}/claim`, {
      method: 'POST',
      headers: BEARER_ANA,
      body: JSON.stringify({ userId: BRUNO_DESKS.id, occupantId: BRUNO_DESKS.id }),
    });

    expect(res.status).toBe(200);
    expect((await desks!.getDesk(created.id))?.occupantId).toBe(ANA_DESKS.id);
    await server.shutdown();
  });

  it('POST /desks/:id/claim de un escritorio ya ocupado responde 409', async () => {
    const { server, url } = await desksServer();
    const created = await createDesk(url, { label: 'Mesa', x: 0, y: 0 });
    await fetch(`${url}/desks/${created.id}/claim`, { method: 'POST', headers: BEARER_ANA });

    const res = await fetch(`${url}/desks/${created.id}/claim`, {
      method: 'POST',
      headers: BEARER_BRUNO,
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'desk-taken' });
    await server.shutdown();
  });

  it('coger otro escritorio suelta el anterior y la decoracion SIGUE a la persona', async () => {
    const { server, decor, url } = await desksServer();
    const viejo = await createDesk(url, { label: 'Mesa 1', x: 0, y: 0 });
    const nuevo = await createDesk(url, { label: 'Mesa 2', x: 8, y: 0 });
    const asset = (await (
      await fetch(`${url}/admin/assets`, {
        method: 'POST',
        headers: BEARER_ADMIN,
        body: JSON.stringify({
          name: 'Planta Grande',
          kind: 'plant',
          textureKey: 'plant-large',
          w: 1,
          h: 1,
          placeableOnDesk: true,
        }),
      })
    ).json()) as { id: string };
    await decor!.replaceDeskConfig(ANA_DESKS.id, [
      { assetId: asset.id, slot: 8, rotation: 0 },
    ]);

    await fetch(`${url}/desks/${viejo.id}/claim`, { method: 'POST', headers: BEARER_ANA });
    await fetch(`${url}/desks/${nuevo.id}/claim`, { method: 'POST', headers: BEARER_ANA });

    const office = (await (await fetch(`${url}/desks`, { headers: BEARER_ANA })).json()) as {
      desks: { id: string; occupant: { items: unknown[] } | null }[];
    };
    expect(office.desks.find((desk) => desk.id === viejo.id)?.occupant).toBeNull();
    expect(office.desks.find((desk) => desk.id === nuevo.id)?.occupant?.items).toHaveLength(1);
    await server.shutdown();
  });

  it('POST /me/desk/release es idempotente y solo suelta lo propio', async () => {
    const { server, desks, url } = await desksServer();
    const deAna = await createDesk(url, { label: 'Mesa 1', x: 0, y: 0 });
    const deBruno = await createDesk(url, { label: 'Mesa 2', x: 8, y: 0 });
    await fetch(`${url}/desks/${deAna.id}/claim`, { method: 'POST', headers: BEARER_ANA });
    await fetch(`${url}/desks/${deBruno.id}/claim`, { method: 'POST', headers: BEARER_BRUNO });

    const primera = await fetch(`${url}/me/desk/release`, {
      method: 'POST',
      headers: BEARER_ANA,
      body: JSON.stringify({ userId: BRUNO_DESKS.id }),
    });
    const segunda = await fetch(`${url}/me/desk/release`, { method: 'POST', headers: BEARER_ANA });

    expect([primera.status, segunda.status]).toEqual([200, 200]);
    expect((await desks!.getDesk(deAna.id))?.occupantId).toBeNull();
    expect((await desks!.getDesk(deBruno.id))?.occupantId).toBe(BRUNO_DESKS.id);
    await server.shutdown();
  });

  it('sin almacen las seis rutas responden 503 y nunca 404', async () => {
    // Un 404 aqui es indistinguible del `index.html` que sirve Caddy cuando
    // falta su bloque `handle`: dos averias con el mismo sintoma y causas
    // opuestas. El 503 afirma que la ruta existe y que falta la configuracion.
    // El cliente degrada a no pintar ningun escritorio asignable.
    const { server, url } = await desksServer({ desks: null });

    const respuestas = await Promise.all([
      fetch(`${url}/desks`, { headers: BEARER_ANA }),
      fetch(`${url}/admin/desks`, {
        method: 'POST',
        headers: BEARER_ADMIN,
        body: JSON.stringify({ label: 'Mesa', x: 0, y: 0 }),
      }),
      fetch(`${url}/admin/desks/cualquiera`, {
        method: 'POST',
        headers: BEARER_ADMIN,
        body: JSON.stringify({ label: 'Mesa' }),
      }),
      fetch(`${url}/admin/desks/cualquiera/delete`, { method: 'POST', headers: BEARER_ADMIN }),
      fetch(`${url}/desks/cualquiera/claim`, { method: 'POST', headers: BEARER_ANA }),
      fetch(`${url}/me/desk/release`, { method: 'POST', headers: BEARER_ANA }),
    ]);

    expect(respuestas.map((res) => res.status)).toEqual([503, 503, 503, 503, 503, 503]);
    expect(await respuestas[0].json()).toEqual({ error: 'desks-not-configured' });
    await server.shutdown();
  });
});
