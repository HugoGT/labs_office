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
import {
  handleAdminSession,
  handleCreateInvitation,
  handleCreateUser,
  handleListInvitations,
  handleRevokeInvitation,
  type AdminDeps,
  type AdminResult,
} from './admin/adminRoutes.ts';
import { identityAdminFromEnv } from './admin/gcpIdentityAdmin.ts';
import type { IdentityAdmin } from './admin/identityAdminPort.ts';
import type { SpacesDirectory } from './spaces/spacesPort.ts';
import {
  handleCreateSpace,
  handleDeleteSpace,
  handleGetSpacesConfig,
  handleUpdateSpace,
  type SpacesDeps,
} from './spaces/spacesRoutes.ts';
import { resolveAuthConfig } from './authConfig.ts';
import type { UserDirectory } from './directory/directoryPort.ts';
import { directoryFromEnv, type DirectoryRuntime } from './directory/fromEnv.ts';
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
  /**
   * Directorio de usuarios (#24), o `undefined` si esta desactivado. Expuesto
   * para las rutas de administracion y para los tests, igual que `sessions`.
   */
  directory?: UserDirectory;
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
  /**
   * Sustituye el directorio que saldria de `process.env` (#24). `null` fuerza
   * el modo sin directorio. Existe por la misma razon que el de arriba, y por
   * una mas: sin este override, probar la caducidad exigiria un Postgres
   * levantado, y una suite que necesita infraestructura acaba sin correrse.
   * Ver `memoryDirectory.ts`.
   */
  directory?: UserDirectory | null;
  /**
   * Sustituye el administrador de Identity Platform que saldria de
   * `process.env` (#24). `null` fuerza el modo sin credencial, que es el estado
   * REAL del despliegue mientras no exista la cuenta de servicio: el alta
   * responde 503 y todo lo demas del panel funciona.
   */
  identityAdmin?: IdentityAdmin | null;
  /**
   * Sustituye el almacen de espacios que saldria de `process.env` (#7, slice
   * 3). `null` fuerza el modo sin espacios, que es el estado real de cualquier
   * despliegue sin `DATABASE_URL`: `/spaces` responde 503, el cliente cae a
   * `BUILT_IN_SPACES` y todo se comporta como antes de esta slice.
   *
   * Es un override propio y no una pieza del de `directory` porque un test que
   * inyecta un directorio en memoria no tiene por que traer espacios, y al
   * reves: probar `/spaces` no deberia obligar a sembrar usuarios.
   */
  spaces?: SpacesDirectory | null;
  /**
   * Lista blanca de origenes para TODAS las rutas que sirve Express
   * (`/livekit/token`, `/health`, `/admin/*`), normalmente de
   * `ALLOWED_ORIGIN`. Vacia o ausente mantiene el `*` de hoy (ver el
   * middleware de CORS).
   */
  allowedOrigins?: readonly string[];
}

/**
 * Lee `ALLOWED_ORIGIN` como lista separada por comas. Ausente o vacia devuelve
 * lista vacia, que el middleware interpreta como "sigue el comportamiento de
 * hoy": sin esto, un despliegue existente se quedaria abierto de par en par al
 * actualizar.
 */
function allowedOriginsFromEnv(env: { ALLOWED_ORIGIN?: string }): readonly string[] {
  return (env.ALLOWED_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * Avisa UNA vez al construir el servidor cuando en produccion no hay lista
 * blanca. El `*` sigue siendo el comportamiento; lo que se acaba es el
 * silencio. Atado a `NODE_ENV=production` (lo fija `colyseus.Dockerfile`)
 * para que el desarrollo local, los e2e y la suite no paguen el ruido: un
 * aviso que salta siempre es un aviso que nadie lee.
 *
 * Recibe `env` y el sumidero por parametro, como el resto de lectores de
 * entorno de este fichero, y como `createIdTokenVerifier` recibe su
 * `logFailure`: asi un test lo afirma sin tocar `process.env`, que es estado
 * global del proceso.
 */
export function warnIfOriginsUnrestricted(
  origins: readonly string[],
  env: { NODE_ENV?: string },
  warn: (message: string) => void = (message) => console.warn(message),
): void {
  if (origins.length > 0 || env.NODE_ENV !== 'production') return;
  warn('[cors] ALLOWED_ORIGIN vacia en produccion: se responde Access-Control-Allow-Origin: * a cualquier origen');
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
  // La politica es UNA para todo lo que sirve Express (#9). #24 la estreno
  // solo bajo `/admin/*`; mantener esa excepcion obligaba a justificar ruta
  // por ruta por que `/livekit/token` seguia abierto de par en par, y la
  // respuesta honesta era que nadie lo habia vuelto a mirar. Se borra la
  // rama en vez de ampliarla: una condicion menos que leer y ningun hueco
  // que recordar.
  //
  // Tampoco hay excepcion para `/health`. Las cabeceras de CORS solo las
  // hace cumplir un navegador, y sus tres consumidores reales no lo son: el
  // healthcheck del contenedor (`colyseus.Dockerfile`), el humo de CI y el
  // arranque de los e2e (`e2e/harness.mjs`) llaman sin `Origin` y no leen la
  // respuesta. Una excepcion no protegeria a nadie y si anadiria una rama.
  //
  // Nada de esto RECHAZA una peticion: aqui solo se decide si se emite
  // `Access-Control-Allow-Origin`. Un cliente que no sea navegador entra
  // igual, con lista o sin ella. Lo que la lista impide es que una pagina de
  // un origen ajeno pueda LEER la respuesta.
  //
  // Ojo con el alcance: `/matchmake/*` no pasa por aqui. Colyseus se queda
  // con el listener de `request` del servidor HTTP y responde esas rutas por
  // su cuenta, con su propio `*`. Este middleware cubre Express, no el
  // puerto entero.
  //
  // Sin `ALLOWED_ORIGIN` se mantiene exactamente el `*` de hoy. No es
  // dejadez: el desarrollo local y la suite e2e viven de el -- el preview de
  // Vite escoge puerto en cada corrida, asi que no hay origen fijo que
  // declarar -- y un default que los rompiese convertiria este cambio en una
  // migracion forzosa. Lo que si cambia es que en produccion ese silencio se
  // acaba: ver `warnIfOriginsUnrestricted`.
  const allowedOrigins = overrides?.allowedOrigins ?? allowedOriginsFromEnv(process.env);
  warnIfOriginsUnrestricted(allowedOrigins, process.env);

  app.use((req, res, next) => {
    const origin = req.header('Origin');

    if (allowedOrigins.length > 0) {
      // Se REFLEJA el origen concreto en vez de devolver la lista: la spec solo
      // admite un valor. `Vary: Origin` evita que una cache intermedia sirva la
      // respuesta de un origen permitido a otro que no lo esta.
      res.header('Vary', 'Origin');
      if (origin !== undefined && allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
      }
    } else {
      res.header('Access-Control-Allow-Origin', '*');
    }

    res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    // `Authorization` se declara siempre y no solo bajo `/admin`: el preflight
    // llega a este middleware antes de que nadie mire la ruta, y una lista que
    // dependiese del path se equivocaria justo en la peticion que importa.
    //
    // NO se anade `Access-Control-Allow-Credentials`: se autentica con un
    // bearer que el cliente pone a mano en cada peticion, no con cookies.
    // Concederlo ampliaria la superficie sin que nada lo necesite, y ademas la
    // spec prohibe combinarlo con el `*` de la rama de arriba.
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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

  /**
   * Mismo patron que `auth`, con una pieza mas: del entorno sale ademas la
   * migracion, porque aplicar el esquema necesita el pool y el pool no sale del
   * puerto (ver `fromEnv.ts`). Un directorio inyectado por un test no tiene
   * esquema que aplicar, asi que no hay `migrate` que llamar.
   *
   * El runtime del entorno se resuelve UNA vez y de el se sacan sus dos piezas
   * por separado (#7, slice 3). Antes esta rama fabricaba un `DirectoryRuntime`
   * postizo alrededor del directorio inyectado; ya no cabe, porque el runtime
   * de verdad trae ademas los espacios y un test que inyecta un directorio en
   * memoria no tiene espacios que inyectar con el. Cada pieza sigue su propio
   * override, igual que `auth` e `identityAdmin`.
   */
  const envRuntime: DirectoryRuntime | undefined =
    overrides?.directory === undefined ? directoryFromEnv(process.env) : undefined;

  const directory =
    overrides?.directory !== undefined ? (overrides.directory ?? undefined) : envRuntime?.directory;

  const spaces =
    overrides?.spaces !== undefined ? (overrides.spaces ?? undefined) : envRuntime?.spaces;

  app.get('/health', (_req, res) => {
    // `auth` expone el modo EFECTIVO, no la variable de entorno: es la unica
    // forma de notar desde fuera que un despliegue se ha quedado sin
    // `FIREBASE_PROJECT_ID` y por tanto sin la guarda de dueno de sesion. No
    // dice el projectId: no hace falta para eso y es informacion del proyecto.
    //
    // `directory` esta aqui por lo mismo (#24): sin `DATABASE_URL` el servidor
    // arranca igual de bien y deja entrar a todo el mundo para siempre, sin un
    // solo error en el log. Tampoco dice a que base de datos apunta.
    res.json({
      ok: true,
      room: OFFICE_ROOM_NAME,
      auth: auth ? 'enabled' : 'disabled',
      directory: directory ? 'enabled' : 'disabled',
    });
  });

  /**
   * Credencial de administracion de Identity Platform (#24). Mismo patron de
   * override que `auth` y `directory`, por la misma razon de aislamiento.
   */
  const identityAdmin =
    overrides?.identityAdmin !== undefined
      ? overrides.identityAdmin
      : identityAdminFromEnv(process.env);

  /**
   * Adaptador HTTP de las rutas de administracion. Los handlers son puros y
   * devuelven `{ status, body }` (mismo contrato que `handleLivekitToken`), asi
   * que aqui no queda ninguna decision: solo traducir.
   *
   * La guarda de "sin directorio" responde 503 y NO 404 a proposito. Un 404 en
   * `/admin/*` es indistinguible del `index.html` que Caddy sirve cuando falta
   * su bloque `handle` (issue #24 punto 3): dos averias con sintomas identicos
   * y causas opuestas. El 503 afirma que la ruta existe y que lo que falta es
   * la configuracion.
   */
  function admin(run: (req: express.Request, deps: AdminDeps) => Promise<AdminResult>) {
    return (req: express.Request, res: express.Response): void => {
      if (directory === undefined) {
        res.status(503).json({ error: 'directory-not-configured' });
        return;
      }

      run(req, { directory, auth, identityAdmin })
        .then((result) => {
          res.status(result.status).json(result.body);
        })
        .catch(() => {
          // El error crudo no sale nunca al cliente, por lo mismo que en
          // `/livekit/token`: podria arrastrar una contrasena generada o un
          // fragmento de la credencial de servicio en el mensaje de un SDK.
          console.error('[admin] fallo no controlado en una ruta de administracion');
          res.status(500).json({ error: 'internal' });
        });
    };
  }

  // `/admin/session` NO exige rol de administracion: el panel la usa para
  // decidir si se pinta a si mismo o la pantalla de "no autorizado". Exigirlo
  // aqui haria esa pantalla irrepresentable. El guard de rol vive en las
  // cuatro rutas de abajo, que son las que hacen algo.
  app.get(
    '/admin/session',
    admin((req, deps) => handleAdminSession(req.header('Authorization'), deps)),
  );

  app.get(
    '/admin/invitations',
    admin((req, deps) => handleListInvitations(req.header('Authorization'), deps)),
  );

  app.post(
    '/admin/invitations',
    admin((req, deps) => handleCreateInvitation(req.header('Authorization'), req.body, deps)),
  );

  app.post(
    '/admin/invitations/:id/revoke',
    admin((req, deps) => handleRevokeInvitation(req.header('Authorization'), req.params.id, deps)),
  );

  // El alta de alguien de casa cuelga de `/admin/users` y no de
  // `/admin/invitations`: no crea una invitacion, y compartir la ruta obligaria
  // a mirar el cuerpo para saber que operacion se pidio. Quien puede repartir
  // que rol lo decide el handler, no este cableado.
  app.post(
    '/admin/users',
    admin((req, deps) => handleCreateUser(req.header('Authorization'), req.body, deps)),
  );

  /**
   * Mismo adaptador que `admin(...)` de arriba, con el almacen de espacios
   * anadido a las dependencias y la misma guarda de "sin almacen -> 503, nunca
   * 404" por la misma razon (ver el comentario de `admin`). El directorio
   * tambien hace falta aqui: la guarda de rol lo consulta para saber si quien
   * llama sigue siendo una cuenta que esta oficina admite.
   */
  function spacesRoute(run: (req: express.Request, deps: SpacesDeps) => Promise<AdminResult>) {
    return (req: express.Request, res: express.Response): void => {
      if (directory === undefined || spaces === undefined) {
        res.status(503).json({ error: 'spaces-not-configured' });
        return;
      }

      run(req, { directory, spaces, auth, identityAdmin })
        .then((result) => {
          res.status(result.status).json(result.body);
        })
        .catch(() => {
          console.error('[spaces] fallo no controlado en una ruta de espacios');
          res.status(500).json({ error: 'internal' });
        });
    };
  }

  // Config que lee CADA cliente al arrancar, no solo el panel: por eso cuelga
  // de la raiz y no de `/admin`. Va sin autenticar a proposito -- la cabecera
  // de `spacesRoutes.ts` explica por que.
  app.get(
    '/spaces',
    spacesRoute((_req, deps) => handleGetSpacesConfig(deps)),
  );

  // Las tres de escritura van por POST y ninguna por PUT/PATCH/DELETE: el
  // middleware de CORS de arriba anuncia `GET,POST,OPTIONS`, asi que cualquier
  // otro verbo moriria en el preflight del navegador antes de llegar a Express.
  // Ampliar esa lista por tres rutas seria ensanchar una cabecera de seguridad
  // para todo el servidor; `/admin/invitations/:id/revoke` ya sento la forma.
  app.post(
    '/admin/spaces',
    spacesRoute((req, deps) => handleCreateSpace(req.header('Authorization'), req.body, deps)),
  );

  app.post(
    '/admin/spaces/:id',
    spacesRoute((req, deps) =>
      handleUpdateSpace(req.header('Authorization'), req.params.id, req.body, deps),
    ),
  );

  app.post(
    '/admin/spaces/:id/delete',
    spacesRoute((req, deps) => handleDeleteSpace(req.header('Authorization'), req.params.id, deps)),
  );

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
  gameServer.define(OFFICE_ROOM_NAME, OfficeRoom, { sessions, auth, directory });

  return {
    gameServer,
    httpServer,
    sessions,
    directory,
    port() {
      const address = httpServer.address() as AddressInfo | null;
      if (!address) throw new Error('server is not listening yet');
      return address.port;
    },
    async listen(port) {
      // Las migraciones van ANTES de aceptar conexiones, y su error se propaga
      // en vez de tragarse. Un servidor escuchando sobre un esquema a medias
      // aceptaria logins y fallaria en la primera consulta, con un error que no
      // menciona las migraciones por ningun lado; fallar aqui deja el motivo
      // real ("connection refused", "permission denied") en la primera linea.
      //
      // No contradice la degradacion de `bootstrapConfig.ts`: aquello es "sin
      // configuracion, sin directorio", y esto es "con configuracion que no se
      // puede cumplir". Lo segundo no es un modo degradado, es una averia.
      await envRuntime?.migrate();
      await gameServer.listen(port);
      return this.port();
    },
    async shutdown() {
      await gameServer.gracefullyShutdown(false);
      // El pool queda con conexiones vivas si no se cierra: en produccion son
      // conexiones que la base de datos sigue contando, y en los tests es un
      // proceso de vitest que no termina.
      await directory?.close();
    },
  };
}
