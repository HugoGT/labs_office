/**
 * Sala Colyseus de la oficina (PRD 6.2): sincroniza por WebSocket la posicion
 * de los avatares REALES. Los NPCs simulados del cliente no pasan por aqui.
 *
 * Regla que gobierna todo el fichero: el cliente no es de fiar. Cada mensaje
 * `move` se valida y se recorta contra los limites del mundo antes de tocar el
 * estado, porque cualquiera puede abrir una consola y mandar
 * `{ x: 1e9, y: -1 }`. Lo mismo con el nombre y con los enumerados.
 *
 * Desde #8 esa regla tiene un segundo piso: con un verificador inyectado,
 * `onAuth` exige un ID token valido antes de dejar entrar, y el nombre pasa a
 * salir del token en vez de `options.name`. Sin verificador la sala se comporta
 * exactamente como antes, puerta abierta incluida.
 *
 * Y desde #24 tiene un tercero: con un directorio inyectado, la firma valida ya
 * no basta. Son dos preguntas distintas y las dos tienen que decir que si -- la
 * firma prueba QUIEN es, el directorio dice si esa persona puede entrar HOY.
 * Hace falta justo porque Identity Platform no sabe caducar cuentas: su token
 * dura una hora y se renueva indefinidamente mientras la cuenta exista, asi que
 * sin esta segunda puerta un invitado de un dia entraria para siempre.
 */

import { Room, ServerError, type AuthContext, type Client } from '@colyseus/core';
import {
  BUILT_IN_SPACES_VERSION,
  PLAYER_SPAWN_TX,
  PLAYER_SPAWN_TY,
  TILE,
  WORLD_H,
  WORLD_W,
} from '../../src/game/mapData.ts';
import {
  DEFAULT_FACING,
  DEFAULT_NAME,
  DEFAULT_STATUS,
  DO_NOT_DISTURB,
  FACINGS,
  MAX_NAME_LENGTH,
  OFFICE_ROOM_NAME,
  isPresenceStatus,
  recordingAvailableUntil,
} from '../../src/game/officeProtocol.ts';
import { createCallInvitationRegistry, type CallInvitationRegistry } from './callInvitations.ts';
import { decideAccess, type AccessDecision } from './directory/accessDecision.ts';
import type { UserDirectory } from './directory/directoryPort.ts';
import type { LiveSessionRegistry } from './liveSessions.ts';
import { participantKeyOf, type FinishedRecordingStore } from './recording/finishedRecordings.ts';
import type { ActiveRecording, RecordingRegistry } from './recording/recordingRegistry.ts';
import { OfficeState, createPlayerState, createRecordingState } from './schema.ts';
import type { IdTokenVerifier, VerifiedIdentity } from './verifyIdToken.ts';

export { DEFAULT_NAME, MAX_NAME_LENGTH, OFFICE_ROOM_NAME };

const FACING_SET = new Set<string>(FACINGS);

/**
 * Cuanto se guarda el asiento -- y con el, el avatar y la sesion de LiveKit --
 * de alguien que se cayo sin avisar (issue #52).
 *
 * 30 s, y no el maximo que Colyseus admite, porque la ventana paga dos precios
 * opuestos y hay que quedarse en medio. Corta de mas, una siesta de wifi o una
 * NAT que reabre hacen desaparecer el avatar y ya no hay vuelta: el borrado
 * viajo a todo el mundo como `onRemove`. Larga de mas, quien cierra la pestana
 * de golpe -- o se queda sin bateria -- deja un fantasma de pie en mitad de la
 * oficina durante minutos, y los demas le hablan a un avatar que no escucha.
 *
 * El suelo lo fija el cliente: su escalera de reintentos
 * (`RECONNECT_DELAYS_MS`, `src/game/reconnectPolicy.ts`) suma 15,5 s y corre EN
 * PARALELO a esta ventana, porque las dos arrancan del mismo suceso -- el
 * socket muriendo. 30 s deja casi el doble de margen sobre el ultimo escalon,
 * que es lo que absorbe la parte que nadie controla: el reloj de las dos
 * maquinas no es el mismo y el reintento aun tiene que viajar.
 */
export const RECONNECTION_WINDOW_SECONDS = 30;

/**
 * Reparte a los que entran alrededor de la tile de spawn en vez de apilarlos
 * todos en el mismo pixel, que haria ilegible una entrada de varias personas.
 */
const SPAWN_RING: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, -1],
  [1, -1],
];

export interface MoveMessage {
  x: number;
  y: number;
  facing: string;
}

export interface StatusMessage {
  status: string;
}

/** Mensaje que publica una nueva version de config de espacios (#7, D4). */
export interface SpacesVersionMessage {
  version: string;
}

/**
 * Mensajes de invitacion de llamada (issue #2). Viven aqui y no en
 * `officeProtocol.ts` a proposito (D4): el TTL que habria exigido vocabulario
 * compartido se elimino (#305.3), asi que no queda nada que las dos partes
 * necesiten declarar juntas -- el unico simbolo compartido sigue siendo
 * `DO_NOT_DISTURB`, que ya vivia alli.
 *
 * Sin id de invitacion (D5): una tarjeta se identifica en el cable por el
 * `sessionId` de quien llama, asi que no hace falta generar ni transportar uno.
 */
export interface CallMessage {
  to: string;
}

export interface CallRespondMessage {
  from: string;
  accept: boolean;
}

/** Recorta un numero al rango, descartando NaN/Infinity del cliente. */
export function clamp(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, value));
}

export function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_NAME;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return DEFAULT_NAME;
  return trimmed.slice(0, MAX_NAME_LENGTH);
}

export function sanitizeFacing(raw: unknown): string {
  return typeof raw === 'string' && FACING_SET.has(raw) ? raw : DEFAULT_FACING;
}

export function sanitizeStatus(raw: unknown): string {
  return isPresenceStatus(raw) ? raw : DEFAULT_STATUS;
}

/**
 * A diferencia de `sanitizeStatus`, no hay un enumerado cerrado que validar:
 * `spacesVersion` es un hash opaco. Lo unico que se exige es que sea un
 * string no vacio -- un cliente trucado o desactualizado que mande otra cosa
 * cae al mismo valor que un cliente honesto en modo fallback (#7, D4), asi
 * que el predicado mutuo de `audiblePeers` sigue comparando algo con sentido
 * en vez de `undefined`.
 */
export function sanitizeSpacesVersion(raw: unknown): string {
  return typeof raw === 'string' && raw.length > 0 ? raw : BUILT_IN_SPACES_VERSION;
}

/**
 * Nombre que se muestra sobre el avatar de alguien autenticado. El `name` del
 * token es lo primero; si no viene (cuentas por telefono, anonimas, o un perfil
 * sin rellenar) la parte local del email es lo que esa persona reconoce de si
 * misma, y el dominio no aporta nada en una etiqueta.
 *
 * NO recorta la longitud a proposito: de eso se sigue encargando `sanitizeName`
 * en `onJoin`, para que `MAX_NAME_LENGTH` viva en un solo sitio. Un `name` de
 * 200 caracteres es perfectamente emitible en un token firmado -- viene firmado,
 * no saneado.
 */
export function deriveIdentityName(identity: VerifiedIdentity, fallback: string): string {
  const name = identity.name?.trim();
  if (name) return name;

  const localPart = identity.email?.split('@')[0]?.trim();
  if (localPart) return localPart;

  return fallback;
}

export interface OfficeRoomOptions {
  /**
   * Registro de sesiones vivas para LiveKit (D4), inyectado por
   * `createOfficeServer.ts` via `gameServer.define(name, Room, { sessions })`.
   * `OfficeRoom` no crea su propio registro: si lo hiciera como singleton de
   * modulo, los tests quedarian acoplados al orden de ejecucion.
   */
  sessions?: LiveSessionRegistry;
  /**
   * Verificador de ID tokens (#8), inyectado por la misma via y por la misma
   * razon. Ausente significa auth desactivada: la sala vuelve a ser la puerta
   * abierta de siempre. Ver `authConfig.ts` para cuando pasa eso.
   */
  auth?: IdTokenVerifier;
  /**
   * Directorio de usuarios (#24), inyectado por la misma via y por la misma
   * razon. Ausente significa directorio desactivado: nadie caduca y nadie queda
   * fuera por no estar en una tabla, que es el comportamiento anterior a este
   * cambio. Ver `bootstrapConfig.ts` para cuando pasa eso.
   *
   * Solo se consulta con `auth` presente: sin verificador no hay identidad que
   * buscar, y preguntar por un usuario que nadie ha probado que exista no
   * significa nada.
   */
  directory?: UserDirectory;
  /**
   * Inyectable para que los tests afirmen sobre lo que se registra, igual que
   * `logFailure` en `verifyIdToken.ts` y por el mismo motivo: el motivo del
   * rechazo no viaja al cliente, asi que la unica forma de probar que existe es
   * capturarlo aqui.
   */
  logDirectoryDenial?: DirectoryDenialLogger;
  /**
   * Ventana de reconexion en segundos (issue #52), inyectada por la misma via
   * que `sessions`/`auth`/`directory` y por la misma razon: los tests necesitan
   * una ventana corta, y la alternativa -- falsear el reloj -- dejaria de
   * probar el camino que importa. `allowReconnection` reserva el asiento en
   * Colyseus y es SU temporizador el que rechaza el `Deferred`; con un reloj
   * falso se probaria un doble de ese camino, no el camino.
   *
   * Ausente cae en `RECONNECTION_WINDOW_SECONDS`, que es lo que corre en
   * produccion.
   */
  reconnectionWindowSeconds?: number;
  /**
   * Active recordings (#5), shared with the `/recordings/*` routes. The room
   * mirrors it into `state.recordings` so every occupant sees it, and stops
   * whatever a session started when that session is released.
   */
  recordings?: RecordingRegistry;
  /** Stops and files one recording (`finishRecording`), for that cleanup. */
  stopRecording?: (entry: ActiveRecording) => Promise<void>;
  /**
   * Finished recordings (#58). The room tells the participants still
   * connected when one is uploaded, as a `recordingready` message.
   */
  finished?: FinishedRecordingStore;
}

/** Registro del motivo por el que el directorio cerro la puerta. */
export type DirectoryDenialLogger = (decision: AccessDecision, uid: string) => void;

/**
 * Lo que Colyseus deja en `client.auth`. El `true` no es decorativo: Colyseus
 * rechaza el join si `onAuth` devuelve algo falsy, asi que el modo sin auth
 * tiene que devolver `true`, y ese `true` acaba en `client.auth` tal cual. Si
 * el generico dijera solo `VerifiedIdentity`, `onJoin` trataria ese `true` como
 * una identidad valida y le pondria a todo el mundo el nombre por defecto --
 * ocurrio de verdad al implementarlo, y solo salto porque los tests del camino
 * abierto siguen exigiendo `options.name`.
 */
type OfficeAuthData = VerifiedIdentity | true;

export class OfficeRoom extends Room<OfficeState, unknown, unknown, OfficeAuthData> {
  private joinCount = 0;
  private sessions?: LiveSessionRegistry;
  private auth?: IdTokenVerifier;
  private directory?: UserDirectory;
  /**
   * Registro de invitaciones de llamada (issue #2). A diferencia de `sessions`
   * NO se inyecta: es estado propio de esta sala, no algo compartido entre
   * salas ni con las rutas HTTP, asi que se crea aqui mismo, igual que
   * `this.state`.
   */
  private invitations: CallInvitationRegistry = createCallInvitationRegistry();
  private logDirectoryDenial: DirectoryDenialLogger = (decision, uid) =>
    console.warn(`[directory] acceso denegado (${decision}): ${uid}`);
  private reconnectionWindowSeconds = RECONNECTION_WINDOW_SECONDS;
  private recordings?: RecordingRegistry;
  private stopRecording?: (entry: ActiveRecording) => Promise<void>;
  private unsubscribeRecordings?: () => void;
  private unsubscribeReady?: () => void;

  onCreate(options?: OfficeRoomOptions): void {
    this.state = new OfficeState();
    this.sessions = options?.sessions;
    this.auth = options?.auth;
    this.directory = options?.directory;
    if (options?.logDirectoryDenial) this.logDirectoryDenial = options.logDirectoryDenial;
    if (options?.reconnectionWindowSeconds !== undefined) {
      this.reconnectionWindowSeconds = options.reconnectionWindowSeconds;
    }
    this.stopRecording = options?.stopRecording;
    this.recordings = options?.recordings;
    // Late joiners get the mirror for free: it is plain synced state.
    for (const entry of this.recordings?.list() ?? []) {
      this.state.recordings.set(entry.spaceId, createRecordingState(entry));
    }
    this.unsubscribeRecordings = this.recordings?.subscribe((spaceId, entry) => {
      if (entry) this.state.recordings.set(spaceId, createRecordingState(entry));
      else this.state.recordings.delete(spaceId);
    });
    // Only to participants: a recording is private to the people in it.
    // `availableUntil` is when the bucket lifecycle deletes it (#5), for the
    // "Disponible hasta" of the notice.
    this.unsubscribeReady = options?.finished?.onReady(({ recordingId, spaceId, participants, stoppedAt }) => {
      const notice = { recordingId, spaceId, availableUntil: recordingAvailableUntil(stoppedAt) };
      for (const client of this.clients) {
        const key = this.sessions ? participantKeyOf(this.sessions, client.sessionId) : client.sessionId;
        if (participants.includes(key)) client.send('recordingready', notice);
      }
    });

    this.onMessage('move', (client: Client, message: MoveMessage) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const x = clamp(message?.x, 0, WORLD_W);
      const y = clamp(message?.y, 0, WORLD_H);
      // Un `move` invalido se ignora entero: aplicar solo el eje valido dejaria
      // al avatar en una posicion que el cliente nunca pidio.
      if (x === null || y === null) return;

      player.x = x;
      player.y = y;
      player.facing = sanitizeFacing(message?.facing);

      // Posicion YA recortada (#10, #12): `POST /livekit/token` compara esto
      // contra un `spaceId`, y confiar en la cruda dejaria a un cliente
      // reclamar un espacio fuera del mundo que el clamp de arriba nunca deja
      // pisar. `moveTo` es no-op si la sesion no existe en el registro, igual
      // que aqui `player` ya se comprobo antes de tocar nada.
      this.sessions?.moveTo(client.sessionId, x, y);
    });

    this.onMessage('status', (client: Client, message: StatusMessage) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      // Un estado desconocido se ignora entero en vez de caer al valor por
      // defecto: degradar silenciosamente un "No molestar" a "En linea" seria
      // una fuga de privacidad disfrazada de saneamiento. En `onJoin` si vale
      // el valor por defecto, porque alli no hay estado previo que proteger.
      if (!isPresenceStatus(message?.status)) return;
      player.status = message.status;
    });

    // Espeja el manejador de `status` de arriba (#7, D4): mismo criterio,
    // mismo tipo de guarda. Sin agrupar, como `sendStatus`: agrupar podria
    // tragarse justo la actualizacion que aisla a alguien.
    this.onMessage('spacesversion', (client: Client, message: SpacesVersionMessage) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      player.spacesVersion = sanitizeSpacesVersion(message?.version);
    });

    // El cliente no es de fiar tampoco aqui: `to`/`from` se comprueban como
    // string, el objetivo tiene que existir en `state.players`, y las dos
    // guardas de negocio (D5/D8) van antes de tocar el registro.
    this.onMessage('call', (client: Client, message: CallMessage) => {
      const caller = this.state.players.get(client.sessionId);
      if (!caller) return;

      const to = typeof message?.to === 'string' ? message.to : undefined;
      if (!to || to === client.sessionId) return; // string valido y no un auto-llamado

      const target = this.state.players.get(to);
      if (!target) return; // sessionId inexistente o ya desconectado

      // D8: el objetivo en DND se comporta igual con un cliente honesto (boton
      // deshabilitado) que con uno trucado que manda el mensaje de todos modos.
      if (target.status === DO_NOT_DISTURB) return;

      // D5: una segunda llamada del mismo emisor a este destinatario es un
      // no-op. Sin esto, 20 clicks de "Llamar" serian 20 tarjetas.
      if (!this.invitations.add(client.sessionId, to)) return;

      this.sendTo(to, 'callinvite', { from: client.sessionId, name: caller.name });
    });

    // `respondCall` sirve tanto para aceptar como para pasar (D3): una sola
    // ruta, no dos mensajes. `remove()` devolviendo `false` es lo que rechaza
    // una respuesta forjada (nunca hubo tal llamada) o tardia (ya resuelta).
    this.onMessage('callrespond', (client: Client, message: CallRespondMessage) => {
      const from = typeof message?.from === 'string' ? message.from : undefined;
      if (!from) return;

      if (!this.invitations.remove(from, client.sessionId)) return;

      // Pasar es silencioso a proposito (D3, regla de feedback del emisor sin
      // cambios respecto a la propuesta): solo un accept genera aviso, y es el
      // UNICO caso en el que el emisor se entera de algo tras enviar su "Llamando...".
      if (message?.accept !== true) return;

      const recipient = this.state.players.get(client.sessionId);
      this.sendTo(from, 'callaccepted', { by: client.sessionId, name: recipient?.name ?? DEFAULT_NAME });
    });
  }

  onDispose(): void {
    this.unsubscribeRecordings?.();
    this.unsubscribeReady?.();
  }

  /** Unico punto de salida hacia un sessionId concreto; `undefined` si ya no esta conectado. */
  private sendTo(sessionId: string, type: string, payload: unknown): void {
    this.clients.getById(sessionId)?.send(type, payload);
  }

  /**
   * Hook de instancia de Colyseus 0.16 (firma confirmada en
   * `node_modules/@colyseus/core/build/Room.d.ts:149`). Corre ANTES de `onJoin`
   * y de reservar el asiento, asi que un token invalido no llega a tocar ni el
   * estado ni el registro de sesiones.
   *
   * Sin verificador devuelve `true`, que es literalmente lo que hacia la sala
   * hasta ahora: nadie queda fuera. Con verificador, lo que devuelve es la
   * identidad, y Colyseus la deja en `client.auth` para `onJoin`.
   *
   * `ServerError` SI lo exporta `@colyseus/core` (comprobado en su
   * `build/index.d.ts`), asi que el cliente recibe un 401 con `unauthorized` en
   * vez de un 500 generico. El mensaje es deliberadamente mudo: no distingue
   * "sin token" de "token caducado" de "token forjado", por la misma razon que
   * `verifyIdToken.verify` devuelve `null` y no un motivo.
   *
   * Los cuatro rechazos del directorio (#24) colapsan en ESE MISMO 401, y no en
   * uno propio, por lo mismo: distinguir "caducado" de "token invalido" le
   * diria a quien sondea que esa cuenta existe y que hubo un acceso legitimo
   * que caduco. Pero el LOG del servidor si lo distingue -- nadie de fuera lo
   * lee, asi que callar ahi no defiende de nada y cuesta caro: "todo el mundo
   * cae en not-provisioned" (las migraciones no corrieron, o el despliegue
   * apunta a otra base de datos) y "un invitado caduco" son la misma respuesta
   * HTTP y dos incidencias completamente distintas.
   */
  async onAuth(
    _client: Client<unknown, OfficeAuthData>,
    options: unknown,
    _context: AuthContext,
  ): Promise<OfficeAuthData> {
    if (!this.auth) return true;

    const token = (options as { token?: unknown } | null | undefined)?.token;
    const identity = await this.auth.verify(token);
    if (identity === null) throw new ServerError(401, 'unauthorized');

    if (this.directory) {
      // La hora se toma aqui y se pasa a `decideAccess`, que es pura: asi la
      // regla de caducidad se puede probar en sus bordes exactos sin tocar el
      // reloj del proceso.
      const user = await this.directory.resolveOnLogin(identity);
      const decision = decideAccess(user, new Date());
      if (decision !== 'allow') {
        this.logDirectoryDenial(decision, identity.uid);
        throw new ServerError(401, 'unauthorized');
      }
    }

    return identity;
  }

  onJoin(
    client: Client<unknown, OfficeAuthData>,
    options?: { name?: unknown; status?: unknown; spacesVersion?: unknown },
  ): void {
    const [dx, dy] = SPAWN_RING[this.joinCount % SPAWN_RING.length];
    this.joinCount++;

    // Con identidad verificada, `options.name` deja de ser una fuente legitima:
    // lo escribe el cliente y en una oficina autenticada dejaria a cualquiera
    // rotularse con el nombre de otra persona. Sin identidad se mantiene el
    // camino de siempre. En ambos casos pasa por `sanitizeName`, que es quien
    // hace valer `MAX_NAME_LENGTH`.
    const identity = client.auth === true ? undefined : client.auth;
    const spawnX = (PLAYER_SPAWN_TX + dx) * TILE + TILE / 2;
    const spawnY = (PLAYER_SPAWN_TY + dy) * TILE + TILE / 2;

    this.state.players.set(
      client.sessionId,
      createPlayerState({
        name: sanitizeName(
          identity ? deriveIdentityName(identity, DEFAULT_NAME) : options?.name,
        ),
        x: spawnX,
        y: spawnY,
        status: sanitizeStatus(options?.status),
        facing: DEFAULT_FACING,
        // Viaja en el join (#7, D4), no en un mensaje posterior: sin esto un
        // peer recien llegado quedaria un instante "sin version" y
        // audiblePeers() lo silenciaria contra todo el mundo (una version
        // vacia no coincide con ninguna otra).
        spacesVersion: sanitizeSpacesVersion(options?.spacesVersion),
      }),
    );

    // El uid es lo que convierte al registro en una prueba de propiedad: sin el
    // (auth desactivada) solo prueba que la sesion esta viva. Ver
    // `liveSessions.ts` y la guarda de `POST /livekit/token`.
    this.sessions?.add(client.sessionId, identity?.uid);

    // La posicion de spawn entra al registro en el mismo instante que al
    // estado (#10, #12): sin esto, un token pedido antes del primer `move`
    // (por ejemplo al aceptar una llamada nada mas entrar) encontraria la
    // sesion sin posicion trackeada y caeria siempre en `forbidden-space`.
    this.sessions?.moveTo(client.sessionId, spawnX, spawnY);
  }

  /**
   * Hook de Colyseus 0.16: el segundo argumento dice si la baja fue PEDIDA
   * (`room.leave()`, cerrar la pestana) o sufrida (el socket se murio). La
   * diferencia lo es todo aqui (issue #52).
   *
   * Pedida, se suelta en el acto: es el comportamiento de siempre, y esperar
   * dejaria un fantasma de pie medio minuto tras algo tan comun como cerrar la
   * pestana.
   *
   * Sufrida, se espera. Y mientras se espera el avatar SIGUE VISIBLE para todos
   * los demas a proposito: que no parpadee es el punto entero de este cambio.
   * Un borrado "provisional" no existe en este protocolo -- `state.players`
   * viaja como `onRemove` a cada cliente en el instante en que se toca, y
   * ningun cliente sabe deshacer eso.
   *
   * `allowReconnection` devuelve un `Deferred` que RESUELVE si vuelve y RECHAZA
   * al vencer la ventana; por eso la unica liberacion vive en el `catch`. Al
   * volver, Colyseus no repite `onAuth` ni `onJoin` y conserva el `sessionId`
   * (`@colyseus/core/build/Room.js`, `_onJoin` con `isWaitingReconnection`):
   * el estado y `this.sessions` siguen exactamente donde estaban, asi que aqui
   * no hay nada que rehacer, solo algo que NO deshacer.
   */
  async onLeave(client: Client, consented: boolean): Promise<void> {
    if (consented) {
      this.releaseSession(client);
      return;
    }

    try {
      await this.allowReconnection(client, this.reconnectionWindowSeconds);
    } catch {
      this.releaseSession(client);
    }
  }

  /**
   * Todo lo que deja de existir cuando alguien se va de verdad. Vive aparte de
   * `onLeave` porque sus tres efectos son irreversibles de cara a los demas --
   * el avatar desaparece, el token de LiveKit deja de poder pedirse y la
   * tarjeta de llamada se marca como huerfana -- y por tanto los tres tienen
   * que aplazarse juntos mientras dure la ventana. Aplicar uno solo antes de
   * tiempo daria el peor resultado posible: alguien a quien se ve pero no se
   * oye, o al reves.
   */
  private releaseSession(client: Client): void {
    this.state.players.delete(client.sessionId);
    this.sessions?.remove(client.sessionId);
    this.stopRecordingsOf(client.sessionId);

    // D7: sin caducidad, la unica limpieza posible es la baja de una de las
    // dos partes. `removeAllFor` cubre a quien se va como emisor Y como
    // destinatario de un solo barrido; solo el primer caso avisa a alguien --
    // si el que se va era el DESTINATARIO, la tarjeta ya la tiene el que
    // llamo y no hay a quien notificar (el emisor no vuelve a saber de esto
    // hasta que el destinatario responda o se vaya el).
    for (const entry of this.invitations.removeAllFor(client.sessionId)) {
      if (entry.from === client.sessionId) {
        this.sendTo(entry.to, 'callerleft', { from: entry.from });
      }
    }
  }

  /**
   * Whoever started a recording and is gone for good cannot stop it anymore,
   * so the server does (#5), and files it like a manual stop (#58). Best
   * effort: `stopRecording` clears the badge before it talks to Egress.
   */
  private stopRecordingsOf(sessionId: string): void {
    for (const entry of this.recordings?.bySession(sessionId) ?? []) {
      if (this.stopRecording) {
        this.stopRecording(entry).catch(() => {
          console.error('[recording] failed to stop the recording of a session that left');
        });
      } else {
        this.recordings?.delete(entry.spaceId);
      }
    }
  }
}
