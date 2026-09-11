/**
 * Prueba de integracion de `POST /livekit/token`: servidor Colyseus + HTTP
 * reales, sin dobles. El guard de sesion viva (D5) solo prueba algo si se
 * ejercita contra un `onJoin`/`onLeave` reales; un doble de `sessions`
 * pasaria por alto justo el bug que este slice quiere evitar.
 *
 * Recordatorio (D5, no se repite en cada test): este guard demuestra que el
 * sessionId esta conectado ahora, NO que quien llama es su dueno. Eso llega
 * con Google OAuth (PRD 10), fuera de alcance aqui.
 */

import { Client } from 'colyseus.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIVEKIT_ROOM_NAME } from '../../src/game/officeProtocol.ts';
import { createOfficeServer, type OfficeServer } from './createOfficeServer.ts';
import { OFFICE_ROOM_NAME } from './OfficeRoom.ts';
import type { OfficeState } from './schema.ts';

process.setMaxListeners(50);

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
