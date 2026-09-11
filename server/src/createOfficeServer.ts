/**
 * Arranque del servidor Colyseus. Se separa de `main.ts` para que los tests
 * puedan levantarlo en un puerto efimero y apagarlo, sin procesos colgados.
 *
 * Transporte WebSocket sobre un `http.Server` propio, no el atajo
 * `new WebSocketTransport({ port })`: `ws` exige exactamente una de
 * `port`/`server`/`noServer` y darle el servidor http deja sitio a los
 * endpoints HTTP que la Fase 1 va a necesitar (salud, monitor, auth).
 *
 * Tampoco se usa el meta-paquete `colyseus`, solo `@colyseus/core` +
 * `@colyseus/ws-transport`: aquel arrastra `@colyseus/uwebsockets-transport`,
 * que depende de `uWebSockets.js` desde un repo git y pnpm lo rechaza.
 */

import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import express from 'express';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { LIVEKIT_ROOM_NAME } from '../../src/game/officeProtocol.ts';
import { createLiveSessionRegistry, type LiveSessionRegistry } from './liveSessions.ts';
import { mintOfficeToken } from './livekitToken.ts';
import { OFFICE_ROOM_NAME, OfficeRoom } from './OfficeRoom.ts';

interface LivekitTokenResult {
  status: 200 | 400 | 403 | 503;
  body: Record<string, unknown>;
}

/**
 * Adaptador HTTP puro (sin `req`/`res`) sobre `mintOfficeToken`, para poder
 * probar las cuatro ramas del contrato sin montar Express. D5: el cuerpo solo
 * aporta `sessionId`; cualquier `room`/`permissions` que mande el cliente se
 * IGNORA, no se valida — no hay nada legitimo que el cliente pueda decir ahi.
 */
async function handleLivekitToken(
  body: unknown,
  sessions: LiveSessionRegistry,
): Promise<LivekitTokenResult> {
  const sessionId = (body as { sessionId?: unknown } | null)?.sessionId;
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    return { status: 400, body: { error: 'invalid-request' } };
  }

  if (!sessions.has(sessionId)) {
    return { status: 403, body: { error: 'unknown-session' } };
  }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) {
    return { status: 503, body: { error: 'livekit-not-configured' } };
  }

  const token = await mintOfficeToken(
    { apiKey, apiSecret },
    {
      identity: sessionId,
      room: LIVEKIT_ROOM_NAME,
      permissions: { canPublish: true, canSubscribe: true, canPublishData: true },
    },
  );

  return {
    status: 200,
    body: {
      token,
      url: process.env.LIVEKIT_URL ?? 'ws://localhost:7880',
      identity: sessionId,
      room: LIVEKIT_ROOM_NAME,
    },
  };
}

export interface OfficeServer {
  gameServer: Server;
  httpServer: HttpServer;
  /** Registro de sesiones vivas (D4); expuesto para la ruta y para tests. */
  sessions: LiveSessionRegistry;
  /** Puerto realmente asignado. Con `listen(0)` lo elige el sistema. */
  port(): number;
  listen(port: number): Promise<number>;
  shutdown(): Promise<void>;
}

export function createOfficeServer(): OfficeServer {
  const app = express();

  // El SPA y este servidor corren en origenes distintos (D5: puerto 2599
  // fijo para el servidor, el preview/dev del cliente en cualquier otro).
  // `Content-Type: application/json` no es un "simple request" (CORS spec),
  // asi que el navegador manda un preflight OPTIONS antes del POST real.
  // Descubierto por Slice E (`two-client-audio.e2e.test.mjs`): sin esto, el
  // fetch del token de LiveKit se bloquea antes de llegar a esta ruta, y
  // `connectLivekitRoom` jamas progresa. `*` es seguro aqui: la ruta no usa
  // cookies/credenciales, solo el `sessionId` del cuerpo, ya validado contra
  // `sessions` mas abajo.
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.use(express.json());

  const sessions = createLiveSessionRegistry();

  app.get('/health', (_req, res) => {
    res.json({ ok: true, room: OFFICE_ROOM_NAME });
  });

  app.post('/livekit/token', (req, res) => {
    handleLivekitToken(req.body, sessions)
      .then((result) => {
        res.status(result.status).json(result.body);
      })
      .catch(() => {
        // Nunca se registra el error crudo: podria arrastrar el secreto por
        // accidente si `mintOfficeToken` fallase con un mensaje inesperado
        // del SDK. El cliente recibe la misma respuesta que "no configurado".
        res.status(503).json({ error: 'livekit-not-configured' });
      });
  });

  const httpServer = createServer(app);
  const gameServer = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
  });
  // D4: el registro se inyecta via options, `OfficeRoom` no lo crea.
  gameServer.define(OFFICE_ROOM_NAME, OfficeRoom, { sessions });

  return {
    gameServer,
    httpServer,
    sessions,
    port() {
      const address = httpServer.address() as AddressInfo | null;
      if (!address) throw new Error('server is not listening yet');
      return address.port;
    },
    async listen(port) {
      await gameServer.listen(port);
      return this.port();
    },
    async shutdown() {
      await gameServer.gracefullyShutdown(false);
    },
  };
}
