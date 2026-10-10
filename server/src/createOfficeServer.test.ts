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
import { connectOfficeRoom } from '../../src/game/officeRoomClient.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LIVEKIT_ROOM_NAME,
  SESSION_REVOKED_CLOSE_CODE,
  recordingAvailableUntil,
} from '../../src/game/officeProtocol.ts';
import {
  createOfficeServer as createServer,
  type OfficeServerOverrides,
  reconnectionWindowFromEnv,
  warnIfOriginsUnrestricted,
  type OfficeServer,
} from './createOfficeServer.ts';
import type { DirectoryUser, UserDirectory } from './directory/directoryPort.ts';
import { createMemoryDirectory } from './directory/memoryDirectory.ts';
import { createMemoryDecor } from './decor/memoryDecor.ts';
import type { DecorCatalog } from './decor/decorPort.ts';
import { readArtPackManifest } from './decor/artPackFile.ts';
import type { AssetStoragePort } from './assets/assetStoragePort.ts';
import { createMemoryAssetStorage } from './assets/memoryAssetStorage.ts';
import { encodePng } from './assets/pngCodec.ts';
import { ART_IMAGE_SPECS, sheetSize } from '../../src/game/artContract.ts';
import { createHash } from 'node:crypto';
import { createMemoryDesks } from './desks/memoryDesks.ts';
import type { DeskDirectory } from './desks/desksPort.ts';
import { createMemorySpaces } from './spaces/memorySpaces.ts';
import type { SpacesDirectory } from './spaces/spacesPort.ts';
import { createMemoryTerrain } from './terrain/memoryTerrain.ts';
import type { TerrainStore } from './terrain/terrainPort.ts';
import { createMemoryCollisions } from './collisions/memoryCollisions.ts';
import type { CollisionStore } from './collisions/collisionPort.ts';
import { decodeCollisionTable, isPositionBlocked } from '../../src/game/pieceCollisions.ts';
import { LEGACY_LAYOUT as BASE_LAYOUT, LEGACY_SEATS } from '../../src/test/legacyOffice.ts';
const createOfficeServer = (overrides: OfficeServerOverrides = {}) => createServer({ layout: BASE_LAYOUT, seats: LEGACY_SEATS, ...overrides });
import { OFFICE_ROOM_NAME, RECONNECTION_WINDOW_SECONDS } from './OfficeRoom.ts';
import type { EgressPort } from './recording/egressPort.ts';
import type { RecordingStoragePort } from './recording/recordingStorage.ts';
import type { OfficeState } from './schema.ts';
import { decodeTerrainWalls } from '../../src/game/officeLayout.ts';
import { decodeTerrainChairs } from '../../src/game/seating.ts';
import type { IdTokenVerifier, VerifiedIdentity } from './verifyIdToken.ts';
import { AuthConfigError } from './authConfigError.ts';
import type { LocalAuthConfig } from './localAuth/localAuthConfig.ts';

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

/**
 * Autorizacion del token contra la posicion trackeada en el servidor (#10,
 * #12). Threat matrix de la spec `livekit-room-topology`: la unica pregunta
 * que estas pruebas cierran es "el que pide el token esta REALMENTE donde dice
 * que esta", y la respuesta a un fallo tiene que ser indistinguible entre "el
 * espacio no existe", "no estoy dentro" y "el servidor no sabe donde estoy"
 * (403 `forbidden-space` uniforme, sin oraculo de existencia).
 *
 * `moveTo` se llama aqui DIRECTAMENTE sobre `server.sessions` (el registro
 * real que expone `createOfficeServer`, no un doble) en vez de mandar un
 * mensaje `move` por Colyseus: la relectura de `OfficeRoom` hacia el registro
 * es la tarea 6.3, todavia no aplica en este bloque, y sigue siendo el mismo
 * objeto real que prueba la guarda.
 */
describe('POST /livekit/token con spaceId (#10, #12): autorizacion contra la posicion trackeada', () => {
  async function tokenServerWithSpace() {
    const spaces = createMemorySpaces();
    // Rectangulo en tiles (10,10)-(13,13) -> pixeles (320,320)-(416,416).
    const created = await spaces.createSpace({
      name: 'Sala de pruebas',
      x: 10,
      y: 10,
      w: 3,
      h: 3,
      capacity: null,
    });
    const server = createOfficeServer({ spaces });
    const port = await server.listen(0);
    process.env.LIVEKIT_API_KEY = 'devkey';
    process.env.LIVEKIT_API_SECRET = 'un-secreto-suficientemente-largo-para-hs256';
    return { server, spaceId: created.id, url: `http://localhost:${port}` };
  }

  async function joinAt(wsUrl: string) {
    const room = await new Client(wsUrl).joinOrCreate<OfficeState>(OFFICE_ROOM_NAME, { name: 'Ana' });
    openRooms.push(room);
    return room;
  }

  function postTokenTo(url: string, body: unknown) {
    return fetch(`${url}/livekit/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('200 y una sala propia cuando la posicion trackeada esta dentro del espacio reclamado', async () => {
    const { server, spaceId, url } = await tokenServerWithSpace();
    const wsUrl = url.replace('http://', 'ws://');
    const room = await joinAt(wsUrl);
    server.sessions.moveTo(room.sessionId, 330, 330); // dentro de (320,320)-(416,416)

    const res = await postTokenTo(url, { sessionId: room.sessionId, spaceId });

    expect(res.status).toBe(200);
    const body = await readBody(res);
    expect(body.room).toBe(`office-livekit-space-${spaceId}`);
    expect(body.room).not.toBe(LIVEKIT_ROOM_NAME);
    expect(typeof body.token).toBe('string');
    await server.shutdown();
  });

  it('403 forbidden-space cuando la posicion trackeada esta fuera del espacio reclamado', async () => {
    const { server, spaceId, url } = await tokenServerWithSpace();
    const wsUrl = url.replace('http://', 'ws://');
    const room = await joinAt(wsUrl);
    server.sessions.moveTo(room.sessionId, 0, 0); // fuera de (320,320)-(416,416)

    const res = await postTokenTo(url, { sessionId: room.sessionId, spaceId });

    expect(res.status).toBe(403);
    expect(await readBody(res)).toEqual({ error: 'forbidden-space' });
    await server.shutdown();
  });

  it('403 forbidden-space, mismo cuerpo, para un spaceId que no existe (sin oraculo)', async () => {
    const { server, url } = await tokenServerWithSpace();
    const wsUrl = url.replace('http://', 'ws://');
    const room = await joinAt(wsUrl);
    server.sessions.moveTo(room.sessionId, 330, 330); // dentro de la sala real

    const res = await postTokenTo(url, { sessionId: room.sessionId, spaceId: 'jamas-existio' });

    expect(res.status).toBe(403);
    expect(await readBody(res)).toEqual({ error: 'forbidden-space' });
    await server.shutdown();
  });

  it('403 forbidden-space, mismo cuerpo, cuando la sesion aun no tiene posicion trackeada', async () => {
    const { server, spaceId, url } = await tokenServerWithSpace();
    const wsUrl = url.replace('http://', 'ws://');
    const room = await joinAt(wsUrl);
    // Sin moveTo: la sesion existe pero no tiene `pos` todavia.

    const res = await postTokenTo(url, { sessionId: room.sessionId, spaceId });

    expect(res.status).toBe(403);
    expect(await readBody(res)).toEqual({ error: 'forbidden-space' });
    await server.shutdown();
  });

  it('sin spaceId, la sala corredor no cambia aunque haya espacios configurados', async () => {
    const { server, url } = await tokenServerWithSpace();
    const wsUrl = url.replace('http://', 'ws://');
    const room = await joinAt(wsUrl);

    const res = await postTokenTo(url, { sessionId: room.sessionId });

    expect(res.status).toBe(200);
    const body = await readBody(res);
    expect(body.room).toBe(LIVEKIT_ROOM_NAME);
    await server.shutdown();
  });

  it('400 invalid-request si spaceId no es texto ni null', async () => {
    const { server, url } = await tokenServerWithSpace();
    const wsUrl = url.replace('http://', 'ws://');
    const room = await joinAt(wsUrl);

    const res = await postTokenTo(url, { sessionId: room.sessionId, spaceId: 42 });

    expect(res.status).toBe(400);
    expect((await readBody(res)).error).toBe('invalid-request');
    await server.shutdown();
  });

  it('con auth activa, forbidden-session gana a forbidden-space aunque ambas guardas fallarian', async () => {
    const ANA: VerifiedIdentity = { uid: 'uid-ana', email: 'ana@example.com', name: 'Ana' };
    const BETO: VerifiedIdentity = { uid: 'uid-beto', email: 'beto@example.com', name: 'Beto' };
    const verifier: IdTokenVerifier = {
      async verify(token: unknown) {
        if (token === 'token-de-ana') return ANA;
        if (token === 'token-de-beto') return BETO;
        return null;
      },
    };
    const spaces = createMemorySpaces();
    const created = await spaces.createSpace({
      name: 'Sala de pruebas',
      x: 10,
      y: 10,
      w: 3,
      h: 3,
      capacity: null,
    });
    const authServer = createOfficeServer({ auth: verifier, spaces });
    const port = await authServer.listen(0);
    const authUrl = `http://localhost:${port}`;
    const authWsUrl = `ws://localhost:${port}`;
    process.env.LIVEKIT_API_KEY = 'devkey';
    process.env.LIVEKIT_API_SECRET = 'un-secreto-suficientemente-largo-para-hs256';

    const ana = await new Client(authWsUrl).joinOrCreate<OfficeState>(OFFICE_ROOM_NAME, {
      token: 'token-de-ana',
    });
    openRooms.push(ana);
    // Ana ni siquiera esta en el espacio: si forbidden-space se comprobase
    // antes, esta peticion respondería igual de todos modos y la prueba no
    // demostraria el orden. Lo que la demuestra es que Beto -- que NO es el
    // dueno de la sesion -- recibe forbidden-session y no forbidden-space.

    const res = await fetch(`${authUrl}/livekit/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: ana.sessionId, token: 'token-de-beto', spaceId: created.id }),
    });

    expect(res.status).toBe(403);
    expect((await readBody(res)).error).toBe('forbidden-session');
    await authServer.shutdown();
  });

  it('D5: sin almacen de espacios configurado, un spaceId se ignora y emite el corredor (200)', async () => {
    // `spaces: null` fuerza el modo sin almacen (igual que `GET /spaces`
    // respondiendo 503): el estado real de cualquier despliegue sin
    // `DATABASE_URL`. El cliente no tiene forma de distinguir "no hay
    // espacios" de "no se comprobo la posicion", asi que la unica opcion
    // honesta es no rechazar algo que no se puede verificar (D5).
    const server = createOfficeServer({ spaces: null });
    const port = await server.listen(0);
    const url = `http://localhost:${port}`;
    const wsUrl = `ws://localhost:${port}`;
    process.env.LIVEKIT_API_KEY = 'devkey';
    process.env.LIVEKIT_API_SECRET = 'un-secreto-suficientemente-largo-para-hs256';
    const room = await joinAt(wsUrl);

    const res = await postTokenTo(url, { sessionId: room.sessionId, spaceId: 'cualquiera' });

    expect(res.status).toBe(200);
    const body = await readBody(res);
    expect(body.room).toBe(LIVEKIT_ROOM_NAME);
    await server.shutdown();
  });

  it('D10: si listSpaces falla, degrada al 503 existente y no emite token', async () => {
    // Reusa el catch de `/livekit/token` (createOfficeServer.ts) en vez de una
    // rama de error propia: ese catch ya nunca registra el error crudo, que
    // podria arrastrar detalle de una consulta fallida a la base de datos.
    const failingSpaces: SpacesDirectory = {
      async listSpaces() {
        throw new Error('fallo de consulta simulado');
      },
      async getSpace() {
        return null;
      },
      async createSpace() {
        throw new Error('no usado en esta prueba');
      },
      async updateSpace() {
        return null;
      },
      async deleteSpace() {
        return false;
      },
      async listLayout() {
        return [];
      },
      async replaceLayout() {
        return [];
      },
      async version() {
        return 'v0';
      },
    };
    const server = createOfficeServer({ spaces: failingSpaces });
    const port = await server.listen(0);
    const url = `http://localhost:${port}`;
    const wsUrl = `ws://localhost:${port}`;
    process.env.LIVEKIT_API_KEY = 'devkey';
    process.env.LIVEKIT_API_SECRET = 'un-secreto-suficientemente-largo-para-hs256';
    const room = await joinAt(wsUrl);

    const res = await postTokenTo(url, { sessionId: room.sessionId, spaceId: 'cualquiera' });

    expect(res.status).toBe(503);
    const body = await readBody(res);
    expect(body.error).toBe('livekit-not-configured');
    expect(body.token).toBeUndefined();
    await server.shutdown();
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
    avatarId: 'character-p01-burgundy-suit',
    avatarChosenAt: null,
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

  it('announces admin space creation, updates and deletion so every client refetches (#183)', async () => {
    const { server, url } = await spacesServer();
    let notifications = 0;
    const observer = await connectOfficeRoom({
      endpoint: url.replace('http:', 'ws:'), name: 'Admin', getIdToken: async () => 'valido-uid-admin',
      handlers: { onAdd() {}, onChange() {}, onRemove() {}, onSpacesChanged() { notifications++; } },
    });
    try {
      const created = await fetch(`${url}/admin/spaces`, {
        method: 'POST', headers: BEARER,
        body: JSON.stringify({ name: 'Sala', x: 1, y: 1, w: 4, h: 4, capacity: null }),
      });
      expect(created.status).toBe(201);
      const { id } = (await created.json()) as { id: string };
      await vi.waitFor(() => expect(notifications).toBe(1));
      const renamed = await fetch(`${url}/admin/spaces/${id}`, {
        method: 'POST', headers: BEARER, body: JSON.stringify({ name: 'Otra' }),
      });
      expect(renamed.status).toBe(200);
      await vi.waitFor(() => expect(notifications).toBe(2));
      const deleted = await fetch(`${url}/admin/spaces/${id}/delete`, { method: 'POST', headers: BEARER });
      expect(deleted.status).toBe(200);
      await vi.waitFor(() => expect(notifications).toBe(3));

      // A refused write changes nothing, so it announces nothing.
      const unauthenticated = await fetch(`${url}/admin/spaces`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Sala', x: 1, y: 1, w: 4, h: 4, capacity: null }),
      });
      expect(unauthenticated.status).toBe(401);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(notifications).toBe(3);
    } finally {
      await observer.leave();
      await server.shutdown();
    }
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
    avatarId: 'character-p01-burgundy-suit',
    avatarChosenAt: null,
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

  it('POST /admin/assets/:id marks an asset as drawn above avatars and back (#71)', async () => {
    const { server, url } = await decorServer();
    const created = (await (
      await fetch(`${url}/admin/assets`, {
        method: 'POST',
        headers: BEARER_ADMIN,
        body: JSON.stringify(ASSET),
      })
    ).json()) as { id: string; aboveAvatars: boolean };
    expect(created.aboveAvatars).toBe(false);

    const marked = await fetch(`${url}/admin/assets/${created.id}`, {
      method: 'POST',
      headers: BEARER_ADMIN,
      body: JSON.stringify({ aboveAvatars: true }),
    });
    expect(marked.status).toBe(200);
    expect(((await marked.json()) as { aboveAvatars: boolean }).aboveAvatars).toBe(true);

    const unmarked = await fetch(`${url}/admin/assets/${created.id}`, {
      method: 'POST',
      headers: BEARER_ADMIN,
      body: JSON.stringify({ aboveAvatars: false }),
    });
    expect(((await unmarked.json()) as { aboveAvatars: boolean }).aboveAvatars).toBe(false);
    await server.shutdown();
  });

  it('POST /admin/assets/:id is admin-only (#71)', async () => {
    const { server, url } = await decorServer();

    const res = await fetch(`${url}/admin/assets/cualquiera`, {
      method: 'POST',
      headers: BEARER_EMPLEADO,
      body: JSON.stringify({ aboveAvatars: true }),
    });

    expect(res.status).toBe(403);
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

describe('art upload routes (#121)', () => {
  const ADMIN_UPLOAD: DirectoryUser = {
    id: 'id-admin',
    uid: 'uid-admin',
    email: 'admin@example.com',
    displayName: 'Admin',
    role: 'admin',
    status: 'active',
    expiresAt: null,
    invitedBy: null,
    avatarId: 'character-p01-burgundy-suit',
    avatarChosenAt: null,
    createdAt: new Date('2025-12-01T00:00:00.000Z'),
  };
  const uploadVerifier: IdTokenVerifier = {
    async verify(token: unknown) {
      return token === 'valido-uid-admin' ? { uid: 'uid-admin', email: 'admin@example.com', name: 'Admin' } : null;
    },
  };
  const BEARER = { Authorization: 'Bearer valido-uid-admin', 'Content-Type': 'application/json' };

  /** A walk or seated sheet with one opaque pixel per frame: valid, and tiny once encoded. */
  function characterSheet(kind: 'character-walk' | 'character-seated'): string {
    const spec = ART_IMAGE_SPECS[kind];
    const { width, height } = sheetSize(spec);
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = spec.frame.height >> 1; y < height; y += spec.frame.height) {
      for (let x = spec.frame.width >> 1; x < width; x += spec.frame.width) data.set([30, 90, 160, 255], (y * width + x) * 4);
    }
    return encodePng({ width, height, data }).toString('base64');
  }

  const CHARACTER = {
    kind: 'character',
    name: 'Lucía',
    author: 'Equipo de arte',
    license: 'proprietary-internal',
    files: { walk: characterSheet('character-walk'), seated: characterSheet('character-seated') },
  };

  async function uploadServer(assetStorage: AssetStoragePort | null = createMemoryAssetStorage()) {
    const decor = createMemoryDecor();
    await decor.registerArtPack(readArtPackManifest(new URL('../../public/assets/pack/manifest.json', import.meta.url)));
    const server = createOfficeServer({
      auth: uploadVerifier,
      directory: createMemoryDirectory({ seed: [ADMIN_UPLOAD] }),
      decor,
      identityAdmin: null,
      assetStorage,
    });
    const port = await server.listen(0);
    return { server, url: `http://localhost:${port}` };
  }

  it('an uploaded character reaches the uploads manifest and its files are served immutable', async () => {
    const { server, url } = await uploadServer();

    const created = await fetch(`${url}/admin/assets/upload`, { method: 'POST', headers: BEARER, body: JSON.stringify(CHARACTER) });
    expect(created.status).toBe(201);
    const { piece } = (await created.json()) as { piece: { id: string; files: { path: string; sha256: string }[] } };
    expect(piece.id).toMatch(/^character-upload-/);

    const manifest = await fetch(`${url}/assets/files/manifest.json`);
    expect(manifest.status).toBe(200);
    expect(manifest.headers.get('cache-control')).toBe('no-cache');
    expect(((await manifest.json()) as { pieces: { id: string }[] }).pieces.map((entry) => entry.id)).toEqual([piece.id]);

    const file = await fetch(`${url}/assets/files/${piece.files[0]!.path}`);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('image/png');
    expect(file.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const bytes = Buffer.from(await file.arrayBuffer());
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(piece.files[0]!.sha256);
    // Cross-origin like every other route: the office loads it from another port locally.
    expect(file.headers.get('access-control-allow-origin')).toBe('*');

    expect((await fetch(`${url}/assets/files/${'0'.repeat(64)}.png`)).status).toBe(404);
    await server.shutdown();
  });

  it('is not taken by POST /admin/assets/:id, and refuses a body over the upload limit with too-large', async () => {
    const { server, url } = await uploadServer();

    const huge = { ...CHARACTER, files: { walk: 'A'.repeat(2 * 1024 * 1024), seated: '' } };
    const res = await fetch(`${url}/admin/assets/upload`, { method: 'POST', headers: BEARER, body: JSON.stringify(huge) });

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'too-large' });
    await server.shutdown();
  });

  it('without a bucket uploads and files answer 503 asset-upload-not-configured, the manifest still answers', async () => {
    const { server, url } = await uploadServer(null);

    const upload = await fetch(`${url}/admin/assets/upload`, { method: 'POST', headers: BEARER, body: JSON.stringify(CHARACTER) });
    expect(upload.status).toBe(503);
    expect(await upload.json()).toEqual({ error: 'asset-upload-not-configured' });
    const file = await fetch(`${url}/assets/files/${'0'.repeat(64)}.png`);
    expect(file.status).toBe(503);
    const manifest = await fetch(`${url}/assets/files/manifest.json`);
    expect(((await manifest.json()) as { pieces: unknown[] }).pieces).toEqual([]);
    await server.shutdown();
  });
});

/**
 * Contributions over HTTP (#122). The rules live in
 * `assets/artContributionRoutes.test.ts`; what only a real server proves is
 * the wiring: the large body parser on the contribution route, the private
 * preview next to the public file route, the 503 without a bucket, and a
 * retired character reaching the live room.
 */
describe('art contribution routes (#122)', () => {
  const base: DirectoryUser = {
    id: '00000000-0000-4000-8000-0000000000a1',
    uid: 'uid-admin',
    email: 'admin@example.com',
    displayName: 'Admin',
    role: 'admin',
    status: 'active',
    expiresAt: null,
    invitedBy: null,
    avatarId: 'character-p01-burgundy-suit',
    avatarChosenAt: null,
    createdAt: new Date('2025-12-01T00:00:00.000Z'),
  };
  const ADMIN_USER = base;
  const ANA_USER: DirectoryUser = { ...base, id: '00000000-0000-4000-8000-0000000000e1', uid: 'uid-ana', email: 'ana@example.com', displayName: 'Ana', role: 'employee' };
  const BETO_USER: DirectoryUser = { ...base, id: '00000000-0000-4000-8000-0000000000e2', uid: 'uid-beto', email: 'beto@example.com', displayName: 'Beto', role: 'employee' };
  const identities: Record<string, VerifiedIdentity> = {
    'token-admin': { uid: 'uid-admin', email: 'admin@example.com', name: 'Admin' },
    'token-ana': { uid: 'uid-ana', email: 'ana@example.com', name: 'Ana' },
    'token-beto': { uid: 'uid-beto', email: 'beto@example.com', name: 'Beto' },
  };
  const verifier: IdTokenVerifier = {
    async verify(token: unknown) {
      return typeof token === 'string' ? (identities[token] ?? null) : null;
    },
  };
  const as = (token: string) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

  function characterSheet(kind: 'character-walk' | 'character-seated'): string {
    const spec = ART_IMAGE_SPECS[kind];
    const { width, height } = sheetSize(spec);
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = spec.frame.height >> 1; y < height; y += spec.frame.height) {
      for (let x = spec.frame.width >> 1; x < width; x += spec.frame.width) data.set([200, 90, 60, 255], (y * width + x) * 4);
    }
    return encodePng({ width, height, data }).toString('base64');
  }

  const CONTRIBUTION = {
    kind: 'character',
    name: 'Lucía',
    author: 'Ana',
    rightsAccepted: true,
    files: { walk: characterSheet('character-walk'), seated: characterSheet('character-seated') },
  };

  async function contributionServer(assetStorage: AssetStoragePort | null = createMemoryAssetStorage()) {
    const decor = createMemoryDecor();
    await decor.registerArtPack(readArtPackManifest(new URL('../../public/assets/pack/manifest.json', import.meta.url)));
    const created = createOfficeServer({
      auth: verifier,
      directory: createMemoryDirectory({ seed: [ADMIN_USER, ANA_USER, BETO_USER] }),
      decor,
      identityAdmin: null,
      assetStorage,
    });
    const port = await created.listen(0);
    return { server: created, url: `http://localhost:${port}`, ws: `ws://localhost:${port}` };
  }

  it('a contribution is pending and private until approved, then public; retiring it resets its wearer live', async () => {
    const { server: contributions, url, ws } = await contributionServer();
    try {
      const submitted = await fetch(`${url}/me/art/contributions`, { method: 'POST', headers: as('token-ana'), body: JSON.stringify(CONTRIBUTION) });
      expect(submitted.status).toBe(201);
      const { contribution } = (await submitted.json()) as { contribution: { id: string; status: string; piece: { files: { path: string }[] } } };
      expect(contribution.status).toBe('pending');
      const file = contribution.piece.files[0]!.path;

      expect((await fetch(`${url}/assets/files/${file}`)).status).toBe(404);
      expect((await fetch(`${url}/me/art/files/${file}`, { headers: as('token-beto') })).status).toBe(404);
      const preview = await fetch(`${url}/me/art/files/${file}`, { headers: as('token-ana') });
      expect(preview.status).toBe(200);
      expect(preview.headers.get('cache-control')).toBe('private, no-store');
      expect(((await (await fetch(`${url}/assets/files/manifest.json`)).json()) as { pieces: unknown[] }).pieces).toEqual([]);

      const queue = await fetch(`${url}/admin/art/contributions?status=pending`, { headers: as('token-admin') });
      expect(((await queue.json()) as { contributions: { id: string }[] }).contributions.map((entry) => entry.id)).toEqual([contribution.id]);
      expect((await fetch(`${url}/admin/art/contributions/${contribution.id}/approve`, { method: 'POST', headers: as('token-admin') })).status).toBe(200);
      expect((await fetch(`${url}/assets/files/${file}`)).status).toBe(200);

      expect((await fetch(`${url}/me/avatar`, { method: 'POST', headers: as('token-beto'), body: JSON.stringify({ avatarId: contribution.id }) })).status).toBe(200);
      const beto = await new Client(ws).joinOrCreate<OfficeState>(OFFICE_ROOM_NAME, { token: 'token-beto' });
      openRooms.push(beto);
      await waitUntil(() => beto.state.players?.get(beto.sessionId)?.avatarId === contribution.id);

      const retired = await fetch(`${url}/admin/art/pieces/${contribution.id}/retire`, { method: 'POST', headers: as('token-admin') });
      expect(retired.status).toBe(200);
      await waitUntil(() => beto.state.players?.get(beto.sessionId)?.avatarId === 'character-p01-burgundy-suit');
      expect(contributions.sessions.has(beto.sessionId)).toBe(true);
    } finally {
      await contributions.shutdown();
    }
  });

  it('the contribution route takes upload-sized bodies, and refuses larger ones with too-large', async () => {
    const { server: contributions, url } = await contributionServer();
    try {
      const huge = { ...CONTRIBUTION, files: { walk: 'A'.repeat(2 * 1024 * 1024), seated: '' } };
      const res = await fetch(`${url}/me/art/contributions`, { method: 'POST', headers: as('token-ana'), body: JSON.stringify(huge) });
      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({ error: 'too-large' });
    } finally {
      await contributions.shutdown();
    }
  });

  it('without a bucket every contribution route answers 503 asset-upload-not-configured', async () => {
    const { server: contributions, url } = await contributionServer(null);
    try {
      for (const [path, method] of [
        ['/me/art/contributions', 'POST'],
        ['/me/art/contributions', 'GET'],
        [`/me/art/files/${'0'.repeat(64)}.png`, 'GET'],
        ['/admin/art/contributions', 'GET'],
        ['/admin/art/pieces/character-upload-0123456789abcdef/retire', 'POST'],
      ] as const) {
        const res = await fetch(`${url}${path}`, { method, headers: as('token-ana'), ...(method === 'POST' ? { body: '{}' } : {}) });
        expect([path, res.status, await res.json()]).toEqual([path, 503, { error: 'asset-upload-not-configured' }]);
      }
    } finally {
      await contributions.shutdown();
    }
  });
});

async function waitUntil(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/**
 * El cableado de `/me/display-name` (#100). Reusa el mismo `admin()` de
 * `/admin/session`: la unica guarda de configuracion es "sin directorio, 503",
 * no un almacen propio, asi que no hace falta un wiring dedicado como el de
 * decoracion o escritorios. Las reglas en si (canonicalizacion, 400, 409) ya
 * las cubre `displayNameRoutes.test.ts` sin levantar servidor.
 */
describe('rutas de nombre visible (#100)', () => {
  const ANA_NAME: DirectoryUser = {
    id: 'id-ana',
    uid: 'uid-ana',
    email: 'ana@example.com',
    displayName: null,
    role: 'employee',
    status: 'active',
    expiresAt: null,
    invitedBy: null,
    avatarId: 'character-p01-burgundy-suit',
    avatarChosenAt: null,
    createdAt: new Date('2025-12-01T00:00:00.000Z'),
  };

  const BEA_NAME: DirectoryUser = {
    ...ANA_NAME,
    id: 'id-bea',
    uid: 'uid-bea',
    email: 'bea@example.com',
    displayName: 'Bea',
  };

  const nameVerifier: IdTokenVerifier = {
    async verify(token: unknown) {
      if (token === 'valido-uid-ana') return { uid: 'uid-ana', email: 'ana@example.com', name: null };
      if (token === 'valido-uid-bea') return { uid: 'uid-bea', email: 'bea@example.com', name: null };
      return null;
    },
  };

  const JSON_HEADERS = { 'Content-Type': 'application/json' };
  const BEARER_ANA = { Authorization: 'Bearer valido-uid-ana', ...JSON_HEADERS };
  const BEARER_BEA = { Authorization: 'Bearer valido-uid-bea', ...JSON_HEADERS };

  async function nameServer(overrides: { directory?: UserDirectory | null } = {}) {
    const directory =
      overrides.directory === undefined
        ? createMemoryDirectory({ seed: [ANA_NAME, BEA_NAME] })
        : overrides.directory;
    const server = createOfficeServer({ auth: nameVerifier, directory, identityAdmin: null });
    const port = await server.listen(0);
    return { server, url: `http://localhost:${port}` };
  }

  it('GET /me/display-name sin credencial responde 401', async () => {
    const { server, url } = await nameServer();

    expect((await fetch(`${url}/me/display-name`)).status).toBe(401);
    await server.shutdown();
  });

  it('POST /me/display-name guarda y GET lo devuelve despues', async () => {
    const { server, url } = await nameServer();

    const posted = await fetch(`${url}/me/display-name`, {
      method: 'POST',
      headers: BEARER_ANA,
      body: JSON.stringify({ name: 'Ana Lopez' }),
    });
    expect(posted.status).toBe(200);
    expect(await posted.json()).toEqual({ displayName: 'Ana Lopez' });

    const got = await fetch(`${url}/me/display-name`, { headers: BEARER_ANA });
    expect(await got.json()).toEqual({ displayName: 'Ana Lopez' });

    await server.shutdown();
  });

  it('un nombre ya tomado responde 409 de extremo a extremo', async () => {
    const { server, url } = await nameServer();

    const res = await fetch(`${url}/me/display-name`, {
      method: 'POST',
      headers: BEARER_ANA,
      body: JSON.stringify({ name: 'bea' }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'display-name-taken' });
    await server.shutdown();
  });

  it('un nombre invalido responde 400 de extremo a extremo', async () => {
    const { server, url } = await nameServer();

    const res = await fetch(`${url}/me/display-name`, {
      method: 'POST',
      headers: BEARER_ANA,
      body: JSON.stringify({ name: '   ' }),
    });

    expect(res.status).toBe(400);
    await server.shutdown();
  });

  it('sin directorio, GET y POST responden 503 y no 404', async () => {
    const { server, url } = await nameServer({ directory: null });

    expect((await fetch(`${url}/me/display-name`, { headers: BEARER_BEA })).status).toBe(503);
    expect(
      (
        await fetch(`${url}/me/display-name`, {
          method: 'POST',
          headers: BEARER_BEA,
          body: JSON.stringify({ name: 'x' }),
        })
      ).status,
    ).toBe(503);
    await server.shutdown();
  });
});

/**
 * Wiring of `/me/avatar` (art migration, step 5). It hangs from `decorRoute`
 * because the choice is checked against the art catalog, so without a
 * directory or a catalog it answers 503, never 404. The rules themselves are
 * in `avatarRoutes.test.ts`.
 */
describe('character routes (art migration, step 5)', () => {
  const ANA_AVATAR: DirectoryUser = {
    id: 'id-ana',
    uid: 'uid-ana',
    email: 'ana@example.com',
    displayName: null,
    role: 'employee',
    status: 'active',
    expiresAt: null,
    invitedBy: null,
    avatarId: 'character-p01-burgundy-suit',
    avatarChosenAt: null,
    createdAt: new Date('2025-12-01T00:00:00.000Z'),
  };

  const avatarVerifier: IdTokenVerifier = {
    async verify(token: unknown) {
      return token === 'valido-uid-ana' ? { uid: 'uid-ana', email: 'ana@example.com', name: null } : null;
    },
  };

  const BEARER_ANA = { Authorization: 'Bearer valido-uid-ana', 'Content-Type': 'application/json' };

  async function avatarServer(overrides: { decor?: DecorCatalog | null } = {}) {
    let decor = overrides.decor;
    if (decor === undefined) {
      decor = createMemoryDecor();
      await decor.registerArtPack(
        readArtPackManifest(new URL('../../public/assets/pack/manifest.json', import.meta.url)),
      );
    }
    const server = createOfficeServer({
      auth: avatarVerifier,
      directory: createMemoryDirectory({ seed: [ANA_AVATAR] }),
      decor,
      identityAdmin: null,
    });
    const port = await server.listen(0);
    return { server, url: `http://localhost:${port}` };
  }

  it('GET /me/avatar without credentials answers 401', async () => {
    const { server, url } = await avatarServer();

    expect((await fetch(`${url}/me/avatar`)).status).toBe(401);
    await server.shutdown();
  });

  it('POST /me/avatar stores the choice and GET returns it afterwards, chosen', async () => {
    const { server, url } = await avatarServer();

    const before = await fetch(`${url}/me/avatar`, { headers: BEARER_ANA });
    expect(await before.json()).toEqual({ avatarId: 'character-p01-burgundy-suit', chosen: false });

    const posted = await fetch(`${url}/me/avatar`, {
      method: 'POST',
      headers: BEARER_ANA,
      body: JSON.stringify({ avatarId: 'character-p05-charcoal-suit' }),
    });
    expect(posted.status).toBe(200);

    const after = await fetch(`${url}/me/avatar`, { headers: BEARER_ANA });
    expect(await after.json()).toEqual({ avatarId: 'character-p05-charcoal-suit', chosen: true });
    await server.shutdown();
  });

  it('an unknown character answers 400 with its reason end to end', async () => {
    const { server, url } = await avatarServer();

    const res = await fetch(`${url}/me/avatar`, {
      method: 'POST',
      headers: BEARER_ANA,
      body: JSON.stringify({ avatarId: 'character-p99-nobody' }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid-character', reason: 'unknown-piece' });
    await server.shutdown();
  });

  it('without a catalog, GET and POST answer 503 and not 404', async () => {
    const { server, url } = await avatarServer({ decor: null });

    expect((await fetch(`${url}/me/avatar`, { headers: BEARER_ANA })).status).toBe(503);
    const posted = await fetch(`${url}/me/avatar`, {
      method: 'POST',
      headers: BEARER_ANA,
      body: JSON.stringify({ avatarId: 'character-p05-charcoal-suit' }),
    });
    expect(posted.status).toBe(503);
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
    avatarId: 'character-p01-burgundy-suit',
    avatarChosenAt: null,
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

  it('converges a remote authenticated client after committed claim, decoration and release only', async () => {
    const { server, desks, decor, url } = await desksServer();
    const desk = await createDesk(url, { label: 'Shared desk', x: 4, y: 4 });
    const asset = await decor.createAsset({ name: 'Plant', kind: 'plant', textureKey: 'plant-large', w: 1, h: 1, placeableOnDesk: true });
    let notifications = 0;
    let remote: { occupant: { displayName: string; items: unknown[] } | null }[] = [];
    let reads = Promise.resolve();
    const observer = await connectOfficeRoom({
      endpoint: url.replace('http:', 'ws:'), name: 'Bruno', getIdToken: async () => 'valido-uid-bruno',
      handlers: {
        onAdd() {}, onChange() {}, onRemove() {},
        onDesksChanged() {
          notifications++;
          reads = reads.then(async () => {
            const response = await fetch(`${url}/desks`, { headers: BEARER_BRUNO });
            remote = (await response.json() as { desks: typeof remote }).desks;
          });
        },
      },
    });
    const owner = await new Client(url.replace('http:', 'ws:')).joinOrCreate(OFFICE_ROOM_NAME, { token: 'valido-uid-ana' });
    openRooms.push(owner);
    try {
      expect((await fetch(`${url}/desks/${desk.id}/claim`, { method: 'POST', headers: BEARER_ANA })).status).toBe(200);
      await vi.waitFor(() => expect(notifications).toBe(1));
      await reads;
      expect(remote[0].occupant).toMatchObject({ displayName: 'Ana', items: [] });
      expect((await fetch(`${url}/me/desk`, { method: 'POST', headers: BEARER_ANA,
        body: JSON.stringify({ items: [{ assetId: asset.id, slot: 0, rotation: 0 }] }) })).status).toBe(200);
      await vi.waitFor(() => expect(notifications).toBe(2));
      await reads;
      expect(remote[0].occupant?.items).toHaveLength(1);
      expect((await fetch(`${url}/me/desk/release`, { method: 'POST', headers: BEARER_ANA })).status).toBe(200);
      await vi.waitFor(() => expect(notifications).toBe(3));
      await reads;
      expect(remote[0].occupant).toBeNull();

      // Rejected requests and adapter failures (including rollback errors) do
      // not announce changes. Only a successfully completed write may do so.
      expect((await fetch(`${url}/desks/${desk.id}/claim`, { method: 'POST' })).status).toBe(401);
      expect((await fetch(`${url}/me/desk`, { method: 'POST', headers: BEARER_ANA, body: '{}' })).status).toBe(400);
      vi.spyOn(desks!, 'claimDesk').mockRejectedValue(new Error('transaction rolled back'));
      vi.spyOn(desks!, 'releaseDesk').mockRejectedValue(new Error('transaction rolled back'));
      vi.spyOn(decor, 'replaceDeskConfig').mockRejectedValue(new Error('transaction rolled back'));
      for (const path of [`/desks/${desk.id}/claim`, '/me/desk/release', '/me/desk']) {
        expect((await fetch(`${url}${path}`, { method: 'POST', headers: BEARER_ANA, body: '{"items":[]}' })).status).toBe(500);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(notifications).toBe(3);
    } finally {
      await observer.leave();
      await server.shutdown();
    }
  });

  it('announces admin desk creation, moves and deletion so every client refetches (#183)', async () => {
    const { server, url } = await desksServer();
    let notifications = 0;
    const observer = await connectOfficeRoom({
      endpoint: url.replace('http:', 'ws:'), name: 'Bruno', getIdToken: async () => 'valido-uid-bruno',
      handlers: { onAdd() {}, onChange() {}, onRemove() {}, onDesksChanged() { notifications++; } },
    });
    try {
      const desk = await createDesk(url, { label: 'Mesa', x: 0, y: 0 });
      await vi.waitFor(() => expect(notifications).toBe(1));
      const moved = await fetch(`${url}/admin/desks/${desk.id}`, {
        method: 'POST', headers: BEARER_ADMIN, body: JSON.stringify({ x: 8, y: 0 }),
      });
      expect(moved.status).toBe(200);
      await vi.waitFor(() => expect(notifications).toBe(2));
      const deleted = await fetch(`${url}/admin/desks/${desk.id}/delete`, { method: 'POST', headers: BEARER_ADMIN });
      expect(deleted.status).toBe(200);
      await vi.waitFor(() => expect(notifications).toBe(3));

      // A refused write changes nothing, so it announces nothing.
      const missing = await fetch(`${url}/admin/desks/no-existe`, {
        method: 'POST', headers: BEARER_ADMIN, body: JSON.stringify({ label: 'Mesa' }),
      });
      expect(missing.status).toBe(404);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(notifications).toBe(3);
    } finally {
      await observer.leave();
      await server.shutdown();
    }
  });

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

/**
 * Ventana de reconexion desde el entorno (issue #52). Existe para que el
 * despliegue pueda ajustarla sin tocar codigo, y para que el arnes E2E pueda
 * pedir una corta: una suite que espera 30 s por escenario deja de correrse.
 */
describe('reconnectionWindowFromEnv', () => {
  it('sin variable cae en la ventana de produccion', () => {
    expect(reconnectionWindowFromEnv({})).toBe(RECONNECTION_WINDOW_SECONDS);
  });

  it('un numero valido manda sobre el valor por defecto', () => {
    expect(reconnectionWindowFromEnv({ OFFICE_RECONNECTION_WINDOW_SECONDS: '2' })).toBe(2);
  });

  it('cero es una ventana legitima: desactiva la espera', () => {
    // No es lo mismo que "sin variable". Un despliegue con problemas puede
    // querer volver al comportamiento anterior sin revertir el codigo.
    expect(reconnectionWindowFromEnv({ OFFICE_RECONNECTION_WINDOW_SECONDS: '0' })).toBe(0);
  });

  it('una basura no apaga la ventana en silencio', () => {
    // Caer en 0 ante un valor ilegible seria lo peor de los dos mundos: la
    // proteccion desactivada y nadie enterandose. Se ignora y se conserva la
    // de produccion.
    for (const raw of ['', 'pronto', '-5', 'NaN', '1e999']) {
      expect(reconnectionWindowFromEnv({ OFFICE_RECONNECTION_WINDOW_SECONDS: raw })).toBe(
        RECONNECTION_WINDOW_SECONDS,
      );
    }
  });
});

/**
 * Real recording (#5) end to end minus LiveKit: HTTP routes, the registry and
 * its mirror in the synced state, with a fake Egress. The state is what every
 * occupant reads, so this is the "everyone is notified" guarantee.
 */
describe('recordings (#5): routes, synced state and cleanup', () => {
  interface FakeEgress extends EgressPort {
    started: string[];
    filepaths: string[];
    stopped: string[];
  }

  function fakeEgress(): FakeEgress {
    const egress: FakeEgress = {
      started: [],
      filepaths: [],
      stopped: [],
      async start(roomName, filepath) {
        egress.started.push(roomName);
        egress.filepaths.push(filepath);
        return { egressId: `EG_${egress.started.length}` };
      },
      async stop(egressId) {
        egress.stopped.push(egressId);
      },
    };
    return egress;
  }

  /** Every key counts as uploaded: readiness is then one poll away. */
  const uploadedStorage: RecordingStoragePort = {
    async exists() {
      return true;
    },
    async presign(key) {
      return `http://localhost:9000/recordings/${key}`;
    },
  };

  async function recordingServer(
    egress: EgressPort | null = fakeEgress(),
    storage: RecordingStoragePort | null = uploadedStorage,
    source?: SpacesDirectory,
    auth?: IdTokenVerifier,
  ) {
    const spaces = source ?? createMemorySpaces();
    // Tiles (10,10)-(13,13) -> pixels (320,320)-(416,416).
    const created = await spaces.createSpace({ name: 'Sala', x: 10, y: 10, w: 3, h: 3, capacity: null });
    const recServer = createOfficeServer({
      spaces,
      auth,
      egress,
      storage,
      recordingReadiness: { intervalMs: 10, timeoutMs: 2000 },
    });
    const port = await recServer.listen(0);
    return { recServer, spaceId: created.id, url: `http://localhost:${port}`, ws: `ws://localhost:${port}` };
  }

  async function joinInside(ws: string, recServer: OfficeServer, name: string) {
    const room = await new Client(ws).joinOrCreate<OfficeState>(OFFICE_ROOM_NAME, { name });
    openRooms.push(room);
    recServer.sessions.moveTo(room.sessionId, 330, 330);
    return room;
  }

  /**
   * Open lawn far from the test spaces. Not (0, 0): the world's border is a
   * hedge the room refuses moves into (art step 8).
   */
  const OUTSIDE = { x: 600, y: 912, facing: 'down' };

  function post(url: string, path: string, body: unknown) {
    return fetch(`${url}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (predicate()) return;
      } catch {
        /* state not there yet */
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('condition not met before the timeout');
  }

  it('a start is visible to every occupant through the synced state, and a stop clears it', async () => {
    const { recServer, spaceId, url, ws } = await recordingServer();
    const ana = await joinInside(ws, recServer, 'Ana');
    const bruno = await joinInside(ws, recServer, 'Bruno');

    const started = await post(url, '/recordings/start', { sessionId: ana.sessionId, spaceId });
    expect(started.status).toBe(200);
    expect(await started.json()).toMatchObject({ spaceId, startedBy: ana.sessionId });

    await waitFor(() => bruno.state.recordings.get(spaceId)?.startedBy === ana.sessionId);

    const stopped = await post(url, '/recordings/stop', { sessionId: bruno.sessionId, spaceId });
    expect(stopped.status).toBe(200);
    await waitFor(() => ana.state.recordings.get(spaceId) === undefined);
    await recServer.shutdown();
  });

  const recordingVerifier: IdTokenVerifier = {
    async verify(token) {
      return typeof token === 'string' ? { uid: token, email: `${token}@example.com`, name: token } : null;
    },
  };

  it('200 authenticated WebSocket outside moves create zero geometry queries and cannot delay stop', async () => {
    const spaces = createMemorySpaces();
    const { recServer, spaceId, url, ws } = await recordingServer(fakeEgress(), uploadedStorage, spaces, recordingVerifier);
    const owner = await new Client(ws).joinOrCreate(OFFICE_ROOM_NAME, { token: 'owner' });
    const outsider = await new Client(ws).joinOrCreate(OFFICE_ROOM_NAME, { token: 'outsider' });
    openRooms.push(owner, outsider);
    const releases: (() => void)[] = [];
    let stopping: Promise<Response> | undefined;
    let restoreRead = () => {};
    try {
      owner.send('move', { x: 330, y: 330, facing: 'down' });
      await waitFor(() => recServer.sessions.positionOf(owner.sessionId)?.x === 330);
      const request = { sessionId: owner.sessionId, spaceId, token: 'owner' };
      expect((await post(url, '/recordings/start', request)).status).toBe(200);
      const known = await spaces.listSpaces();
      const read = vi.spyOn(spaces, 'listSpaces').mockImplementation(() => new Promise((resolve) => {
        releases.push(() => resolve(known));
      }));
      restoreRead = () => read.mockRestore();
      for (let i = 0; i < 200; i++) outsider.send('move', { x: OUTSIDE.x + i, y: OUTSIDE.y, facing: 'down' });
      await waitFor(() => recServer.sessions.positionOf(outsider.sessionId)?.x === OUTSIDE.x + 199);
      expect(read).not.toHaveBeenCalled();
      stopping = post(url, '/recordings/stop', request);
      await waitFor(() => recServer.recordings.list().length === 0);
      releases.at(-1)!();
      expect((await stopping).status).toBe(200);
      expect(read).toHaveBeenCalledTimes(1);
    } finally {
      restoreRead();
      for (const release of releases) release();
      await stopping;
      await recServer.shutdown();
    }
  });

  it('grants ready and URL access to a verified WebSocket visitor during the final acquisition read', async () => {
    const spaces = createMemorySpaces();
    const { recServer, spaceId, url, ws } = await recordingServer(fakeEgress(), uploadedStorage, spaces, recordingVerifier);
    const owner = await new Client(ws).joinOrCreate(OFFICE_ROOM_NAME, { token: 'owner' });
    const visitor = await new Client(ws).joinOrCreate(OFFICE_ROOM_NAME, { token: 'visitor' });
    openRooms.push(owner, visitor);
    const ready: unknown[] = [];
    let release!: () => void;
    let pending: Promise<Response> | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    try {
      owner.send('move', { x: 330, y: 330, facing: 'down' });
      await waitFor(() => recServer.sessions.positionOf(owner.sessionId)?.x === 330);
      visitor.onMessage('recordingready', (payload) => ready.push(payload));
      const list = spaces.listSpaces.bind(spaces);
      let reads = 0;
      let finalRead = false;
      spaces.listSpaces = async () => {
        const known = await list();
        if (++reads === 2) { finalRead = true; await gate; }
        return known;
      };
      const request = { sessionId: owner.sessionId, spaceId, token: 'owner' };
      pending = post(url, '/recordings/start', request);
      await waitFor(() => finalRead);
      visitor.send('move', { x: 330, y: 330, facing: 'down' });
      await waitFor(() => recServer.sessions.positionOf(visitor.sessionId)?.x === 330);
      visitor.send('move', OUTSIDE);
      await waitFor(() => recServer.sessions.positionOf(visitor.sessionId)?.x === OUTSIDE.x);
      release();
      expect((await pending).status).toBe(200);
      const stopped = await post(url, '/recordings/stop', request);
      expect(stopped.status).toBe(200);
      const { recordingId } = await stopped.json() as { recordingId: string };
      // A ready notice must not rely on the visitor still occupying the room.
      await vi.waitFor(async () => {
        expect((await post(url, '/recordings/url', { sessionId: visitor.sessionId, recordingId, token: 'visitor' })).status).toBe(200);
      });
      await waitFor(() => ready.length === 1);
    } finally {
      release();
      await pending;
      await recServer.shutdown();
    }
  });

  it.each(['room', 'desk'])('uses committed admin %s moves/deletions for participant access without movement queries', async (kind) => {
    const spaces = createMemorySpaces();
    const desks = createMemoryDesks({ spaces: spaces.deskSpaces });
    const desk = kind === 'desk' ? await desks.createDesk({ label: 'Desk', x: 10, y: 10 }) : null;
    const space = kind === 'room'
      ? await spaces.createSpace({ name: 'Room', x: 10, y: 10, w: 3, h: 3, capacity: null })
      : (await spaces.listSpaces())[0];
    const directory = createMemoryDirectory({ seed: ['owner', 'old', 'middle', 'after-delete', 'admin'].map((uid): DirectoryUser => ({
      id: `id-${uid}`, uid, email: `${uid}@example.com`, displayName: uid,
      role: uid === 'admin' ? 'admin' : 'employee', status: 'active', expiresAt: null, invitedBy: null,
      avatarId: 'character-p01-burgundy-suit', avatarChosenAt: null, createdAt: new Date(),
    })) });
    const recServer = createOfficeServer({ spaces, desks, directory, auth: recordingVerifier, egress: fakeEgress(),
      storage: uploadedStorage, recordingReadiness: { intervalMs: 5, timeoutMs: 2000 } });
    const port = await recServer.listen(0);
    const url = `http://localhost:${port}`;
    try {
      const clients: Awaited<ReturnType<Client['joinOrCreate']>>[] = [];
      for (const token of ['owner', 'old', 'middle', 'after-delete']) {
        const client = await new Client(`ws://localhost:${port}`).joinOrCreate(OFFICE_ROOM_NAME, { token });
        clients.push(client);
        openRooms.push(client);
      }
      const [owner, old, middle, afterDelete] = clients;
      const ownerReady: unknown[] = [];
      owner.onMessage('recordingready', (notice) => ownerReady.push(notice));
      owner.send('move', { x: 330, y: 330, facing: 'down' });
      await waitFor(() => recServer.sessions.positionOf(owner.sessionId)?.x === 330);
      const request = { sessionId: owner.sessionId, spaceId: space.id, token: 'owner' };
      expect((await post(url, '/recordings/start', request)).status).toBe(200);
      const read = vi.spyOn(spaces, 'listSpaces');
      const path = kind === 'room' ? `/admin/spaces/${space.id}` : `/admin/desks/${desk!.id}`;
      const headers = { Authorization: 'Bearer admin', 'Content-Type': 'application/json' };
      expect((await fetch(`${url}${path}`, { method: 'POST', headers,
        body: JSON.stringify(kind === 'room' ? { x: 20, y: 10, w: 3, h: 3 } : { x: 20, y: 10 }) })).status).toBe(200);
      for (const [client, x] of [[old, 330], [middle, 650]] as const) {
        client.send('move', { x, y: 330, facing: 'down' });
        await waitFor(() => recServer.sessions.positionOf(client.sessionId)?.x === x);
        client.send('move', OUTSIDE);
        await waitFor(() => recServer.sessions.positionOf(client.sessionId)?.x === OUTSIDE.x);
      }
      expect((await fetch(`${url}${path}/delete`, { method: 'POST', headers })).status).toBe(200);
      afterDelete.send('move', { x: 650, y: 330, facing: 'down' });
      await waitFor(() => recServer.sessions.positionOf(afterDelete.sessionId)?.x === 650);
      expect(read).not.toHaveBeenCalled();
      const stopped = await post(url, '/recordings/stop', request);
      expect(stopped.status).toBe(200);
      const { recordingId } = await stopped.json() as { recordingId: string };
      await waitFor(() => ownerReady.length === 1);
      expect((await post(url, '/recordings/url', { sessionId: middle.sessionId, recordingId, token: 'middle' })).status).toBe(200);
      expect((await post(url, '/recordings/url', { sessionId: old.sessionId, recordingId, token: 'old' })).status).toBe(403);
      expect((await post(url, '/recordings/url', { sessionId: afterDelete.sessionId, recordingId, token: 'after-delete' })).status).toBe(403);
    } finally {
      await recServer.shutdown();
    }
  });

  it.each(['departure', 'movement'])('never mirrors a pending recording abandoned by owner %s', async (change) => {
    const egress = fakeEgress();
    const start = egress.start.bind(egress);
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const acquired = new Promise<void>((resolve) => { entered = resolve; });
    egress.start = async (...args) => { entered(); await gate; return start(...args); };
    const { recServer, spaceId, url, ws } = await recordingServer(egress);
    try {
      const owner = await joinInside(ws, recServer, 'Owner');
      const observer = await joinInside(ws, recServer, 'Observer');
      const pending = post(url, '/recordings/start', { sessionId: owner.sessionId, spaceId });
      await acquired;
      if (change === 'departure') {
        await owner.leave();
        await waitFor(() => !recServer.sessions.has(owner.sessionId));
      } else {
        owner.send('move', OUTSIDE);
        await waitFor(() => recServer.sessions.positionOf(owner.sessionId)?.x === OUTSIDE.x);
      }
      release();
      expect((await pending).status).toBe(403);
      expect(egress.stopped).toEqual(['EG_1']);
      expect(recServer.recordings.list()).toEqual([]);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(observer.state.recordings.get(spaceId)).toBeUndefined();
    } finally {
      release();
      await recServer.shutdown();
    }
  });

  it('sends ready and grants URL access to a middle-only visitor who moved in and out', async () => {
    const { recServer, spaceId, url, ws } = await recordingServer();
    try {
      const owner = await joinInside(ws, recServer, 'Owner');
      const visitor = await new Client(ws).joinOrCreate<OfficeState>(OFFICE_ROOM_NAME, { name: 'Visitor' });
      const outsider = await new Client(ws).joinOrCreate<OfficeState>(OFFICE_ROOM_NAME, { name: 'Outsider' });
      openRooms.push(visitor, outsider);
      const ready: unknown[] = [];
      const ownerReady: unknown[] = [];
      const deniedReady: unknown[] = [];
      owner.onMessage('recordingready', (payload) => ownerReady.push(payload));
      visitor.onMessage('recordingready', (payload) => ready.push(payload));
      outsider.onMessage('recordingready', (payload) => deniedReady.push(payload));
      await post(url, '/recordings/start', { sessionId: owner.sessionId, spaceId });
      visitor.send('move', { x: 330, y: 330, facing: 'down' });
      await waitFor(() => recServer.sessions.positionOf(visitor.sessionId)?.x === 330);
      visitor.send('move', OUTSIDE);
      await waitFor(() => recServer.sessions.positionOf(visitor.sessionId)?.x === OUTSIDE.x);
      const stopped = await post(url, '/recordings/stop', { sessionId: owner.sessionId, spaceId });
      const { recordingId } = await stopped.json() as { recordingId: string };
      await waitFor(() => ownerReady.length === 1);
      expect((await post(url, '/recordings/url', { sessionId: visitor.sessionId, recordingId })).status).toBe(200);
      await waitFor(() => ready.length === 1);
      expect((await post(url, '/recordings/url', { sessionId: outsider.sessionId, recordingId })).status).toBe(403);
      expect(deniedReady).toEqual([]);
    } finally {
      await recServer.shutdown();
    }
  });

  it('a late joiner sees a recording that was already running', async () => {
    const { recServer, spaceId, url, ws } = await recordingServer();
    const ana = await joinInside(ws, recServer, 'Ana');
    await post(url, '/recordings/start', { sessionId: ana.sessionId, spaceId });

    const late = await joinInside(ws, recServer, 'Tarde');

    await waitFor(() => late.state.recordings.get(spaceId)?.startedBy === ana.sessionId);
    await recServer.shutdown();
  });

  it('when the starter leaves the office, the recording is stopped in Egress and cleared for everyone', async () => {
    const egress = fakeEgress();
    const { recServer, spaceId, url, ws } = await recordingServer(egress);
    const ana = await joinInside(ws, recServer, 'Ana');
    const bruno = await joinInside(ws, recServer, 'Bruno');
    await post(url, '/recordings/start', { sessionId: ana.sessionId, spaceId });
    await waitFor(() => bruno.state.recordings.get(spaceId) !== undefined);

    await ana.leave();

    await waitFor(() => bruno.state.recordings.get(spaceId) === undefined);
    await waitFor(() => egress.stopped.includes('EG_1'));
    await recServer.shutdown();
  });

  it('a second start in the same space answers 409 already-recording', async () => {
    const { recServer, spaceId, url, ws } = await recordingServer();
    const ana = await joinInside(ws, recServer, 'Ana');
    const bruno = await joinInside(ws, recServer, 'Bruno');
    await post(url, '/recordings/start', { sessionId: ana.sessionId, spaceId });

    const second = await post(url, '/recordings/start', { sessionId: bruno.sessionId, spaceId });

    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: 'already-recording' });
    await recServer.shutdown();
  });

  it('without Egress configured both routes answer 503 recording-not-configured', async () => {
    const { recServer, spaceId, url, ws } = await recordingServer(null);
    const ana = await joinInside(ws, recServer, 'Ana');

    for (const path of ['/recordings/start', '/recordings/stop']) {
      const res = await post(url, path, { sessionId: ana.sessionId, spaceId });
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'recording-not-configured' });
    }
    await recServer.shutdown();
  });

  it('(#58) once uploaded, only the people who were in the space are told it is ready, and can fetch it', async () => {
    const { recServer, spaceId, url, ws } = await recordingServer();
    const ana = await joinInside(ws, recServer, 'Ana');
    const bruno = await joinInside(ws, recServer, 'Bruno');
    const outsider = await new Client(ws).joinOrCreate<OfficeState>(OFFICE_ROOM_NAME, { name: 'Fuera' });
    openRooms.push(outsider);
    recServer.sessions.moveTo(outsider.sessionId, 0, 0);
    const ready: Record<string, unknown[]> = { ana: [], bruno: [], outsider: [] };
    ana.onMessage('recordingready', (payload) => ready.ana.push(payload));
    bruno.onMessage('recordingready', (payload) => ready.bruno.push(payload));
    outsider.onMessage('recordingready', (payload) => ready.outsider.push(payload));

    await post(url, '/recordings/start', { sessionId: ana.sessionId, spaceId });
    const beforeStop = Date.now();
    const stopped = await post(url, '/recordings/stop', { sessionId: ana.sessionId, spaceId });
    const afterStop = Date.now();
    const { recordingId } = (await stopped.json()) as { recordingId: string };

    await waitFor(() => ready.ana.length === 1 && ready.bruno.length === 1);
    // The notice says until when the recording is kept, so the UI can show it.
    expect(ready.ana).toEqual([{ recordingId, spaceId, availableUntil: expect.any(Number) }]);
    const { availableUntil } = ready.ana[0] as { availableUntil: number };
    expect(availableUntil).toBeGreaterThanOrEqual(recordingAvailableUntil(beforeStop));
    expect(availableUntil).toBeLessThanOrEqual(recordingAvailableUntil(afterStop));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(ready.outsider).toEqual([]);

    const allowed = await post(url, '/recordings/url', { sessionId: bruno.sessionId, recordingId });
    expect(allowed.status).toBe(200);
    expect(((await allowed.json()) as { url: string }).url).toContain('recordings/');
    const denied = await post(url, '/recordings/url', { sessionId: outsider.sessionId, recordingId });
    expect(denied.status).toBe(403);
    await recServer.shutdown();
  });

  it('(#58) a recording stopped because its starter left is also filed as finished', async () => {
    const { recServer, spaceId, url, ws } = await recordingServer();
    const ana = await joinInside(ws, recServer, 'Ana');
    const bruno = await joinInside(ws, recServer, 'Bruno');
    const ready: unknown[] = [];
    bruno.onMessage('recordingready', (payload) => ready.push(payload));
    await post(url, '/recordings/start', { sessionId: ana.sessionId, spaceId });

    await ana.leave();

    await waitFor(() => ready.length === 1);
    await recServer.shutdown();
  });
});

/**
 * Wiring of the users routes (#93): the rules are covered by
 * `adminRoutes.test.ts` and the room eviction by `OfficeRoom.test.ts`; what
 * only a real server proves is that the revoke route reaches the live room.
 */
describe('users routes (#93): revoking over HTTP evicts the live session', () => {
  const ADMIN_USER: DirectoryUser = {
    id: '00000000-0000-4000-8000-0000000000a1',
    uid: 'uid-admin',
    email: 'admin@example.com',
    displayName: 'Admin',
    role: 'admin',
    status: 'active',
    expiresAt: null,
    invitedBy: null,
    avatarId: 'character-p01-burgundy-suit',
    avatarChosenAt: null,
    createdAt: new Date('2025-12-01T00:00:00.000Z'),
  };
  const STAFF_USER: DirectoryUser = {
    ...ADMIN_USER,
    id: '00000000-0000-4000-8000-0000000000e1',
    uid: 'uid-staff',
    email: 'staff@example.com',
    displayName: 'Staff',
    role: 'employee',
  };
  const identities: Record<string, VerifiedIdentity> = {
    'token-admin': { uid: 'uid-admin', email: 'admin@example.com', name: 'Admin' },
    'token-staff': { uid: 'uid-staff', email: 'staff@example.com', name: 'Staff' },
  };
  const usersVerifier: IdTokenVerifier = {
    async verify(token: unknown) {
      return typeof token === 'string' ? (identities[token] ?? null) : null;
    },
  };

  it('GET /admin/users lists everyone and POST /admin/users/:id/revoke throws the account out', async () => {
    const usersServer = createOfficeServer({
      auth: usersVerifier,
      directory: createMemoryDirectory({ seed: [ADMIN_USER, STAFF_USER] }),
      identityAdmin: null,
    });
    const port = await usersServer.listen(0);
    const url = `http://localhost:${port}`;
    const headers = { Authorization: 'Bearer token-admin', 'Content-Type': 'application/json' };

    try {
      const staff = await new Client(`ws://localhost:${port}`).joinOrCreate<OfficeState>(
        OFFICE_ROOM_NAME,
        { token: 'token-staff' },
      );
      openRooms.push(staff);
      const closed = new Promise<number>((resolve) => staff.onLeave(resolve));

      const list = await fetch(`${url}/admin/users`, { headers });
      expect(list.status).toBe(200);
      const { users } = (await list.json()) as { users: { id: string; removable: boolean }[] };
      expect(users.map((row) => [row.id, row.removable])).toEqual([
        [ADMIN_USER.id, false],
        [STAFF_USER.id, true],
      ]);

      const revoke = await fetch(`${url}/admin/users/${STAFF_USER.id}/revoke`, {
        method: 'POST',
        headers,
      });

      expect(revoke.status).toBe(200);
      expect(await closed).toBe(SESSION_REVOKED_CLOSE_CODE);
      expect(usersServer.sessions.size()).toBe(0);
      // And the door stays closed: the directory refuses the next join.
      await expect(
        new Client(`ws://localhost:${port}`).joinOrCreate(OFFICE_ROOM_NAME, { token: 'token-staff' }),
      ).rejects.toThrow();
    } finally {
      await usersServer.shutdown();
    }
  });
});

/**
 * Terrain editing over HTTP (#123 phase 2). The rules are tested in
 * `terrain/`; what only a real server proves is the wiring: the 503 without a
 * store, the protections read from the live room and the spaces store, and
 * the accepted edit reaching the room state.
 */
describe('terrain routes (#123 phase 2)', () => {
  const ADMIN_TERRAIN: DirectoryUser = {
    id: '00000000-0000-4000-8000-0000000000b1',
    uid: 'uid-admin',
    email: 'admin@example.com',
    displayName: 'Admin',
    role: 'admin',
    status: 'active',
    expiresAt: null,
    invitedBy: null,
    avatarId: 'character-p01-burgundy-suit',
    avatarChosenAt: null,
    createdAt: new Date('2025-12-01T00:00:00.000Z'),
  };
  const terrainVerifier: IdTokenVerifier = {
    async verify(token: unknown) {
      if (token !== 'valido-uid-admin') return null;
      return { uid: 'uid-admin', email: 'admin@example.com', name: 'Admin' };
    },
  };
  const BEARER = { Authorization: 'Bearer valido-uid-admin', 'Content-Type': 'application/json' };
  const LAWN = 35;
  const onTile = (tx: number, ty: number) => ({ x: tx * 32 + 16, y: ty * 32 + 5, facing: 'down' });

  async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (predicate()) return;
      } catch {
        // The state may not have arrived yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('condition not met before the timeout');
  }

  async function terrainServer(overrides: { terrain?: TerrainStore | null; spaces?: SpacesDirectory; desks?: OfficeServerOverrides['desks'] } = {}) {
    const terrain = overrides.terrain === undefined ? createMemoryTerrain() : overrides.terrain;
    const server = createOfficeServer({
      auth: terrainVerifier,
      directory: createMemoryDirectory({ seed: [ADMIN_TERRAIN] }),
      spaces: overrides.spaces ?? createMemorySpaces(),
      ...(overrides.desks !== undefined ? { desks: overrides.desks } : {}),
      terrain,
      identityAdmin: null,
    });
    const port = await server.listen(0);
    return { server, url: `http://localhost:${port}`, wsUrl: `ws://localhost:${port}` };
  }

  function setBlock(url: string, index: number, material: string) {
    return fetch(`${url}/admin/terrain/blocks/${index}`, { method: 'POST', headers: BEARER, body: JSON.stringify({ material }) });
  }

  it('answers 503 without a terrain store or without a directory, never 404', async () => {
    const { server, url } = await terrainServer({ terrain: null });
    const res = await setBlock(url, LAWN, 'sand');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'terrain-not-configured' });
    await server.shutdown();

    const bare = createOfficeServer({ auth: terrainVerifier, directory: null, terrain: createMemoryTerrain() });
    const port = await bare.listen(0);
    expect((await setBlock(`http://localhost:${port}`, LAWN, 'sand')).status).toBe(503);
    await bare.shutdown();
  });

  it('loads the persisted blocks at listen, so the first move is already checked against them', async () => {
    const { server } = await terrainServer({ terrain: createMemoryTerrain([[LAWN, 'water']]) });

    expect(server.terrain.blocks()[LAWN]).toBe('water');
    await server.shutdown();
  });

  it('relocates players after water commits, but still refuses water under a space', async () => {
    const spaces = createMemorySpaces();
    const { server, url, wsUrl } = await terrainServer({ spaces });
    const room = await new Client(wsUrl).joinOrCreate<OfficeState>(OFFICE_ROOM_NAME, { token: 'valido-uid-admin' });
    openRooms.push(room);
    const lawn = onTile(67, 22);
    room.send('move', lawn);
    await waitFor(() => room.state.players.get(room.sessionId)?.x === lawn.x);

    const underPlayer = await setBlock(url, LAWN, 'water');
    expect(underPlayer.status).toBe(200);
    expect(await underPlayer.json()).toEqual({ index: LAWN, material: 'water' });
    await waitFor(() => room.state.players.get(room.sessionId)?.positionRevision === 1);
    expect(server.sessions.positionOf(room.sessionId)).not.toEqual({ x: lawn.x, y: lawn.y });

    const away = onTile(20, 23);
    room.send('move', { ...away, positionRevision: 1 });
    await waitFor(() => room.state.players.get(room.sessionId)?.x === away.x);
    expect((await setBlock(url, LAWN, 'grass')).status).toBe(200);
    const sala = await spaces.createSpace({ name: 'Sala del prado', x: 66, y: 21, w: 3, h: 3, capacity: null });
    const underSpace = await setBlock(url, LAWN, 'water');
    expect(underSpace.status).toBe(409);
    expect(await underSpace.json()).toEqual({ error: 'terrain-under-placement' });

    await spaces.deleteSpace(sala.id);
    const accepted = await setBlock(url, LAWN, 'water');
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ index: LAWN, material: 'water' });
    await waitFor(() => room.state.terrainBlocks.split(',')[LAWN] === 'water');
    await server.shutdown();
  });

  function setWalls(url: string, edits: unknown) {
    return fetch(`${url}/admin/terrain/walls`, { method: 'POST', headers: BEARER, body: JSON.stringify({ edits }) });
  }

  it('answers 503 to wall edits without a terrain store, never 404', async () => {
    const { server, url } = await terrainServer({ terrain: null });
    const res = await setWalls(url, [{ index: 0, piece: 'wall-brick' }]);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'terrain-not-configured' });
    expect(server.terrain.walls()[0]).toBeNull();
    await server.shutdown();
  });

  it('paints walls into the room state, refusing one on a served desk but not in a room', async () => {
    const at = new Date('2026-01-01T00:00:00.000Z');
    const desks = createMemoryDesks({ seed: [{ id: 'desk-a', label: 'Mesa A', x: 66, y: 21, occupantId: null, createdAt: at, updatedAt: at }] });
    const spaces = createMemorySpaces();
    await spaces.createSpace({ name: 'Sala del prado', x: 70, y: 18, w: 5, h: 5, capacity: null });
    const { server, url, wsUrl } = await terrainServer({ spaces, desks, terrain: createMemoryTerrain([], [[5, 'wall-stone']]) });
    const room = await new Client(wsUrl).joinOrCreate<OfficeState>(OFFICE_ROOM_NAME, { token: 'valido-uid-admin' });
    openRooms.push(room);
    const { width, height } = server.terrain.snapshot();
    const wallAt = (index: number) => decodeTerrainWalls(room.state.terrainWalls, width * height)?.[index];
    await waitFor(() => wallAt(5) === 'wall-stone');

    const onDesk = await setWalls(url, [{ index: 22 * width + 67, piece: 'wall-brick' }]);
    expect(onDesk.status).toBe(409);
    expect(await onDesk.json()).toEqual({ error: 'terrain-under-placement' });

    const inRoom = await setWalls(url, [{ index: 20 * width + 72, piece: 'wall-brick' }, { index: 5, piece: null }]);
    expect(inRoom.status).toBe(200);
    expect(await inRoom.json()).toEqual({ updated: 2 });
    await waitFor(() => wallAt(20 * width + 72) === 'wall-brick');
    expect(wallAt(5)).toBeNull();
    expect((await setWalls(url, [{ index: 0, piece: 'wall-lava' }])).status).toBe(400);
    await server.shutdown();
  });

  it('refuses a desk created or moved onto a live wall, and a wall painted on the moved desk', async () => {
    const desks = createMemoryDesks();
    const { server, url } = await terrainServer({ desks, terrain: createMemoryTerrain() });
    const { width } = server.terrain.snapshot();
    const postDesk = (path: string, body: unknown) =>
      fetch(`${url}${path}`, { method: 'POST', headers: BEARER, body: JSON.stringify(body) });
    expect((await setWalls(url, [{ index: 22 * width + 67, piece: 'wall-brick' }])).status).toBe(200);

    const onWall = await postDesk('/admin/desks', { label: 'Mesa A', x: 66, y: 21 });
    expect(onWall.status).toBe(409);
    expect(await onWall.json()).toEqual({ error: 'desk-on-wall' });
    expect(await desks.listDesks()).toEqual([]);

    const created = await postDesk('/admin/desks', { label: 'Mesa A', x: 70, y: 21 });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const moved = await postDesk(`/admin/desks/${id}`, { x: 65, y: 20 });
    expect(moved.status).toBe(409);
    expect(await moved.json()).toEqual({ error: 'desk-on-wall' });
    expect((await postDesk(`/admin/desks/${id}`, { label: 'Mesa B' })).status).toBe(200);
    expect(await desks.getDesk(id)).toMatchObject({ label: 'Mesa B', x: 70, y: 21 });
    await server.shutdown();
  });

  function setChairs(url: string, edits: unknown) {
    return fetch(`${url}/admin/terrain/chairs`, { method: 'POST', headers: BEARER, body: JSON.stringify({ edits }) });
  }

  it('answers 503 to chair edits without a terrain store, never 404', async () => {
    const { server, url } = await terrainServer({ terrain: null });
    const res = await setChairs(url, [{ index: 0, chair: { piece: 'chair-wood', facing: 'down' } }]);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'terrain-not-configured' });
    expect(server.terrain.chairs()).toEqual([]);
    await server.shutdown();
  });

  it('places chairs into the room state, keeps desks and water off them and them off desks', async () => {
    const desks = createMemoryDesks();
    const { server, url, wsUrl } = await terrainServer({ desks, terrain: createMemoryTerrain() });
    const room = await new Client(wsUrl).joinOrCreate<OfficeState>(OFFICE_ROOM_NAME, { token: 'valido-uid-admin' });
    openRooms.push(room);
    const { width, height } = server.terrain.snapshot();
    const chair = 22 * width + 67;
    const postDesk = (path: string, body: unknown) =>
      fetch(`${url}${path}`, { method: 'POST', headers: BEARER, body: JSON.stringify(body) });

    const placed = await setChairs(url, [{ index: chair, chair: { piece: 'chair-metal', facing: 'right' } }]);
    expect(placed.status).toBe(200);
    expect(await placed.json()).toEqual({ updated: 1 });
    await waitFor(() => decodeTerrainChairs(room.state.terrainChairs, width * height)?.[0]?.index === chair);
    expect((await setChairs(url, [{ index: 0, chair: { piece: 'chair-throne', facing: 'down' } }])).status).toBe(400);

    const onChair = await postDesk('/admin/desks', { label: 'Mesa A', x: 66, y: 21 });
    expect(onChair.status).toBe(409);
    expect(await onChair.json()).toEqual({ error: 'desk-on-chair' });
    expect(await desks.listDesks()).toEqual([]);
    const blocked = await setBlock(url, LAWN, 'water');
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toEqual({ error: 'terrain-under-placement' });

    // A desk under the chair's tile refuses the chair the other way round.
    expect((await postDesk('/admin/desks', { label: 'Mesa B', x: 70, y: 21 })).status).toBe(201);
    const onDesk = await setChairs(url, [{ index: 22 * width + 71, chair: { piece: 'chair-wood', facing: 'down' } }]);
    expect(onDesk.status).toBe(409);
    await server.shutdown();
  });
});

/**
 * Collision editing over HTTP. The rules are tested in `collisions/`; what
 * only a real server proves is the wiring: the 503 without a store, the
 * players read from the live room, the catalog deciding which pieces exist,
 * the desks feeding the placements, and the edit reaching the room state.
 */
describe('collision routes', () => {
  const ADMIN_COLLISIONS: DirectoryUser = {
    id: '00000000-0000-4000-8000-0000000000c1',
    uid: 'uid-admin',
    email: 'admin@example.com',
    displayName: 'Admin',
    role: 'admin',
    status: 'active',
    expiresAt: null,
    invitedBy: null,
    avatarId: 'character-p01-burgundy-suit',
    avatarChosenAt: null,
    createdAt: new Date('2025-12-01T00:00:00.000Z'),
  };
  const verifier: IdTokenVerifier = {
    async verify(token: unknown) {
      if (token !== 'valido-uid-admin') return null;
      return { uid: 'uid-admin', email: 'admin@example.com', name: 'Admin' };
    },
  };
  const BEARER = { Authorization: 'Bearer valido-uid-admin', 'Content-Type': 'application/json' };
  const tree = BASE_LAYOUT.props.find((prop) => prop.kind === 'tree')!;
  const besideTree = { x: (tree.tx + 2) * 32 + 16, y: tree.ty * 32 + 5, facing: 'down' };

  async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (predicate()) return;
      } catch {
        // The state may not have arrived yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('condition not met before the timeout');
  }

  async function collisionServer(overrides: { collisions?: CollisionStore | null; desks?: DeskDirectory } = {}) {
    const server = createOfficeServer({
      auth: verifier,
      directory: createMemoryDirectory({ seed: [ADMIN_COLLISIONS] }),
      collisions: overrides.collisions === undefined ? createMemoryCollisions() : overrides.collisions,
      desks: overrides.desks ?? createMemoryDesks(),
      identityAdmin: null,
    });
    const port = await server.listen(0);
    return { server, url: `http://localhost:${port}`, wsUrl: `ws://localhost:${port}` };
  }

  function save(url: string, pieceId: string, rects: unknown) {
    return fetch(`${url}/admin/collisions/${pieceId}`, { method: 'POST', headers: BEARER, body: JSON.stringify({ rects }) });
  }

  it('answers 503 without a collision store or without a directory, never 404', async () => {
    const { server, url } = await collisionServer({ collisions: null });
    const res = await save(url, tree.piece, []);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'collisions-not-configured' });
    const reset = await fetch(`${url}/admin/collisions/${tree.piece}/reset`, { method: 'POST', headers: BEARER });
    expect(reset.status).toBe(503);
    await server.shutdown();

    const bare = createOfficeServer({ auth: verifier, directory: null, collisions: createMemoryCollisions() });
    const port = await bare.listen(0);
    expect((await save(`http://localhost:${port}`, tree.piece, [])).status).toBe(503);
    await bare.shutdown();
  });

  it('loads the saved pieces at listen, so the first move is already checked against them', async () => {
    const { server } = await collisionServer({ collisions: createMemoryCollisions([[tree.piece, []]]) });

    expect(server.collisions.table().get(tree.piece)).toEqual([]);
    await server.shutdown();
  });

  it('answers 404 to a piece the office does not know and 400 to bad rectangles', async () => {
    const { server, url } = await collisionServer();

    expect((await save(url, 'plant-nowhere', [])).status).toBe(404);
    expect((await save(url, tree.piece, [{ x: 0, y: 0, w: 0, h: 1 }])).status).toBe(400);
    await server.shutdown();
  });

  it('refuses a rectangle over someone in the room, applies it once they leave it, and resets it', async () => {
    const { server, url, wsUrl } = await collisionServer();
    const room = await new Client(wsUrl).joinOrCreate<OfficeState>(OFFICE_ROOM_NAME, { token: 'valido-uid-admin' });
    openRooms.push(room);
    room.send('move', besideTree);
    await waitFor(() => room.state.players.get(room.sessionId)?.x === besideTree.x);

    // From the tree's anchor (bottom middle of its tile) two tiles to the right.
    const over = [{ x: 48, y: -32, w: 32, h: 32 }];
    const underPlayer = await save(url, tree.piece, over);
    expect(underPlayer.status).toBe(409);
    expect(await underPlayer.json()).toEqual({ error: 'collision-under-player' });

    const away = { ...besideTree, y: besideTree.y + 2 * 32 };
    room.send('move', away);
    await waitFor(() => room.state.players.get(room.sessionId)?.y === away.y);
    const accepted = await save(url, tree.piece, over);
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ pieceId: tree.piece, rects: over });
    await waitFor(() => decodeCollisionTable(room.state.pieceCollisions)?.get(tree.piece)?.length === 1);

    const reset = await fetch(`${url}/admin/collisions/${tree.piece}/reset`, { method: 'POST', headers: BEARER });
    expect(reset.status).toBe(200);
    await waitFor(() => decodeCollisionTable(room.state.pieceCollisions)?.has(tree.piece) === false);
    await server.shutdown();
  });

  it('places a desk the admin creates, so its piece collides without a restart', async () => {
    const desks = createMemoryDesks();
    const { server, url } = await collisionServer({ desks, collisions: createMemoryCollisions([['desk-wood', [{ x: -8, y: -8, w: 16, h: 16 }]]]) });
    const created = await fetch(`${url}/admin/desks`, { method: 'POST', headers: BEARER, body: JSON.stringify({ label: 'Mesa C', x: 21, y: 50 }) });
    expect(created.status).toBe(201);

    // The middle of the 3x3 area at tile (21, 50), as a body center.
    await waitFor(() => isPositionBlocked(server.collisions.rects(), 22 * 32 + 16, 51 * 32 + 5));
    await server.shutdown();
  });
});

describe('local auth mode', () => {
  const LOCAL: LocalAuthConfig = {
    users: new Map([
      ['admin@local.test', 'cambiame'],
      ['ana@local.test', 'otra'],
    ]),
    secret: 'a-local-secret-that-is-long-enough-0123456789',
  };

  async function localServer() {
    const directory = createMemoryDirectory({ bootstrapSuperadminEmail: 'admin@local.test' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const local = createOfficeServer({ localAuth: LOCAL, directory });
    const port = await local.listen(0);
    return { local, url: `http://localhost:${port}`, ws: `ws://localhost:${port}`, warn, directory };
  }

  /** Signs in and joins the room, which is where the directory resolves the login. */
  async function enter(url: string, ws: string, email: string, password: string): Promise<string> {
    const { token } = (await (await signIn(url, { email, password })).json()) as { token: string };
    const room = await new Client(ws).joinOrCreate<OfficeState>(OFFICE_ROOM_NAME, { token });
    openRooms.push(room);
    return token;
  }

  function signIn(url: string, body: unknown) {
    return fetch(`${url}/auth/local/sign-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('signs in, and the token joins the room and opens the dashboard: the bootstrap email becomes superadmin', async () => {
    const { local, url, ws } = await localServer();

    const res = await signIn(url, { email: 'Admin@Local.Test', password: 'cambiame' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: expect.any(String) });
    const token = await enter(url, ws, 'Admin@Local.Test', 'cambiame');

    const session = await fetch(`${url}/admin/session`, { headers: { Authorization: `Bearer ${token}` } });
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({ role: 'superadmin', email: 'admin@local.test' });
    await local.shutdown();
  });

  it('answers the same 401 for a wrong password and an unknown email', async () => {
    const { local, url } = await localServer();

    const wrong = await signIn(url, { email: 'ana@local.test', password: 'nope' });
    const unknown = await signIn(url, { email: 'nadie@local.test', password: 'nope' });

    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: 'invalid-credentials' });
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toEqual({ error: 'invalid-credentials' });
    await local.shutdown();
  });

  it('reports auth enabled in /health and warns loudly at startup', async () => {
    const { local, url, warn } = await localServer();

    expect(await (await fetch(`${url}/health`)).json()).toMatchObject({ auth: 'enabled' });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/LOCAL AUTH/));
    await local.shutdown();
  });

  it('provisions dashboard accounts with the uid the local token carries', async () => {
    const { local, url, ws, directory } = await localServer();
    const token = await enter(url, ws, 'admin@local.test', 'cambiame');

    const created = await fetch(`${url}/admin/users`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ana@local.test', role: 'employee' }),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ outcome: 'created', emailSent: false });
    expect((await directory.findByEmail('ana@local.test'))?.uid).toBe('local:ana@local.test');
    await local.shutdown();
  });

  it('has no sign-in route without local auth', async () => {
    const res = await signIn(baseUrl, { email: 'admin@local.test', password: 'cambiame' });
    expect(res.status).toBe(404);
  });

  it('refuses to build the server with Firebase and local auth both in the environment', () => {
    vi.stubEnv('FIREBASE_PROJECT_ID', 'oficina-virtual');
    vi.stubEnv('LOCAL_AUTH_USERS', 'admin@local.test:cambiame');
    vi.stubEnv('LOCAL_AUTH_SECRET', LOCAL.secret);

    expect(() => createOfficeServer()).toThrow(AuthConfigError);
  });

  it('builds the local verifier and route from the environment', async () => {
    vi.stubEnv('LOCAL_AUTH_USERS', 'admin@local.test:cambiame');
    vi.stubEnv('LOCAL_AUTH_SECRET', LOCAL.secret);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const local = createOfficeServer({ directory: null });
    const port = await local.listen(0);

    const res = await signIn(`http://localhost:${port}`, { email: 'admin@local.test', password: 'cambiame' });
    expect(res.status).toBe(200);
    await local.shutdown();
  });
});
