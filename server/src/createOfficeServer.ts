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
import { resolveAuthConfig } from './authConfig.ts';
import { createLiveSessionRegistry, type LiveSessionRegistry } from './liveSessions.ts';
import { mintOfficeToken } from './livekitToken.ts';
import { OFFICE_ROOM_NAME, OfficeRoom } from './OfficeRoom.ts';
import { createIdTokenVerifier, type IdTokenVerifier } from './verifyIdToken.ts';

interface LivekitTokenResult {
  status: 200 | 400 | 401 | 403 | 503;
  body: Record<string, unknown>;
}

/**
 * Adaptador HTTP puro (sin `req`/`res`) sobre `mintOfficeToken`, para poder
 * probar las ramas del contrato sin montar Express. D5: del cuerpo solo se leen
 * `sessionId` y, con auth activa, `token`; cualquier `room`/`permissions` que
 * mande el cliente se IGNORA, no se valida - no hay nada legitimo que el
 * cliente pueda decir ahi.
 *
 * Con `auth` presente se anade la guarda de dueno (#8): el uid del ID token
 * tiene que ser el mismo que `OfficeRoom.onAuth` ligo a ese `sessionId` al
 * entrar. Sin `auth` la funcion se comporta exactamente como antes, guardas y
 * orden incluidos: `identity` se queda en `null` y las dos ramas nuevas no
 * llegan a mirarse.
 */
async function handleLivekitToken(
  body: unknown,
  sessions: LiveSessionRegistry,
  auth?: IdTokenVerifier,
): Promise<LivekitTokenResult> {
  const sessionId = (body as { sessionId?: unknown } | null)?.sessionId;
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    return { status: 400, body: { error: 'invalid-request' } };
  }

  // Con auth activa, la credencial se comprueba ANTES que nada que hable de la
  // sesion. El orden no es cosmetico: si `unknown-session` fuese primero, quien
  // sondea sin token distinguiria un `sessionId` vivo (401) de uno inventado
  // (403), que es justo el oraculo que este 401 mudo quiere negarle. Un token
  // ausente o con el tipo cambiado tambien cae aqui, y responde 401 y no 400,
  // por lo mismo: el llamante solo aprende "no autorizado".
  const identity = auth ? await auth.verify((body as { token?: unknown }).token) : null;
  if (auth && identity === null) {
    return { status: 401, body: { error: 'unauthorized' } };
  }

  if (!sessions.has(sessionId)) {
    return { status: 403, body: { error: 'unknown-session' } };
  }

  // La guarda de verdad: estar autenticado no basta, hay que ser el dueno de
  // ESTA sesion. Sin esto cualquier participante podia leer el `sessionId` de
  // otro en el estado de la sala y mintar un token en su nombre -- con su
  // propio token valido, asi que la verificacion de firma no lo habria
  // frenado. Se separa del 401 a proposito: aqui el llamante ya ha probado
  // quien es, y decirle que esa sesion no es suya no le revela nada que no
  // supiese.
  if (identity !== null && sessions.uidOf(sessionId) !== identity.uid) {
    return { status: 403, body: { error: 'forbidden-session' } };
  }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!apiKey || !apiSecret) {
    return { status: 503, body: { error: 'livekit-not-configured' } };
  }

  const token = await mintOfficeToken(
    { apiKey, apiSecret },
    {
      // `identity` es el sessionId de Colyseus y tiene que seguir siendolo,
      // NUNCA el uid, ni siquiera con auth activa. `useProximityAudio` empareja
      // participantes de LiveKit por sessionId: manda `payload.sessionIds` a
      // `setDesiredPeers`, que los busca en `room.remoteParticipants.get(...)`.
      // Cambiarlo por el uid mataria el audio por proximidad sin un solo error:
      // el token se emite, la sala conecta, y nadie se oye. Es lo mas fragil de
      // todo este cambio.
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

/**
 * Lee la configuracion de auth del entorno y construye el verificador, o
 * `undefined` si no hay projectId. Separado de `createOfficeServer` para que el
 * "sin config, sin auth" se lea de un vistazo.
 */
function authVerifierFromEnv(env: { FIREBASE_PROJECT_ID?: string }): IdTokenVerifier | undefined {
  const config = resolveAuthConfig(env);
  return config ? createIdTokenVerifier(config) : undefined;
}

export interface OfficeServerOverrides {
  /**
   * Sustituye el verificador que saldria de `process.env`. `null` fuerza el
   * modo sin auth. Existe para los tests: `process.env` es estado global del
   * proceso y cambiarlo a mitad de una corrida acopla ficheros entre si, que es
   * justo lo que `liveSessions.ts` evita al no ser un singleton de modulo.
   */
  auth?: IdTokenVerifier | null;
}

export function createOfficeServer(overrides?: OfficeServerOverrides): OfficeServer {
  const app = express();

  // El SPA y este servidor corren en origenes distintos (D5: puerto 2599
  // fijo para el servidor, el preview/dev del cliente en cualquier otro).
  // `Content-Type: application/json` no es un "simple request" (CORS spec),
  // asi que el navegador manda un preflight OPTIONS antes del POST real.
  // Descubierto por Slice E (`two-client-audio.e2e.test.mjs`): sin esto, el
  // fetch del token de LiveKit se bloquea antes de llegar a esta ruta, y
  // `connectLivekitRoom` jamas progresa.
  //
  // Por que `*` se sostiene AHORA, que no es lo que decia esta nota antes de
  // #8: la ruta sigue sin usar cookies ni credenciales de navegador, asi que
  // ningun origen tercero puede hacer que el navegador adjunte una sesion
  // ajena. Lo que ha cambiado es que ya no basta con el `sessionId`: con auth
  // activa hace falta ademas un ID token en el CUERPO, que un sitio tercero no
  // tiene forma de obtener. Sin auth, en cambio, `*` si deja que cualquier
  // pagina pida un token para un `sessionId` que haya averiguado, que es
  // exactamente el modo degradado que describe `authConfig.ts`.
  //
  // Apretar CORS es la issue #9 y queda fuera de este cambio a proposito.
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

  /**
   * El verificador se construye UNA vez, al arrancar: `createRemoteJWKSet`
   * guarda dentro su cache de claves publicas, asi que uno por peticion haria
   * que cada token pagase una descarga a googleapis.com.
   *
   * `overrides.auth` gana sobre el entorno, incluido un `null` explicito para
   * pedir el modo abierto. Sin override se lee `process.env` una sola vez aqui.
   */
  const auth =
    overrides?.auth !== undefined
      ? (overrides.auth ?? undefined)
      : authVerifierFromEnv(process.env);

  app.get('/health', (_req, res) => {
    // `auth` expone el modo EFECTIVO, no la variable de entorno: es la unica
    // forma de notar desde fuera que un despliegue se ha quedado sin
    // `FIREBASE_PROJECT_ID` y por tanto sin la guarda de dueno de sesion. No
    // dice el projectId: no hace falta para eso y es informacion del proyecto.
    res.json({ ok: true, room: OFFICE_ROOM_NAME, auth: auth ? 'enabled' : 'disabled' });
  });

  app.post('/livekit/token', (req, res) => {
    handleLivekitToken(req.body, sessions, auth)
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
  // D4: el registro se inyecta via options, `OfficeRoom` no lo crea. Lo mismo
  // con el verificador (#8): la sala no lee `process.env`.
  gameServer.define(OFFICE_ROOM_NAME, OfficeRoom, { sessions, auth });

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
