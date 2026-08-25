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
import { OFFICE_ROOM_NAME, OfficeRoom } from './OfficeRoom.ts';

export interface OfficeServer {
  gameServer: Server;
  httpServer: HttpServer;
  /** Puerto realmente asignado. Con `listen(0)` lo elige el sistema. */
  port(): number;
  listen(port: number): Promise<number>;
  shutdown(): Promise<void>;
}

export function createOfficeServer(): OfficeServer {
  const app = express();
  app.get('/health', (_req, res) => {
    res.json({ ok: true, room: OFFICE_ROOM_NAME });
  });

  const httpServer = createServer(app);
  const gameServer = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
  });
  gameServer.define(OFFICE_ROOM_NAME, OfficeRoom);

  return {
    gameServer,
    httpServer,
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
