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
} from '../../src/game/officeProtocol.ts';
import { createCallInvitationRegistry, type CallInvitationRegistry } from './callInvitations.ts';
import { decideAccess, type AccessDecision } from './directory/accessDecision.ts';
import type { UserDirectory } from './directory/directoryPort.ts';
import type { LiveSessionRegistry } from './liveSessions.ts';
import { OfficeState, createPlayerState } from './schema.ts';
import type { IdTokenVerifier, VerifiedIdentity } from './verifyIdToken.ts';

export { DEFAULT_NAME, MAX_NAME_LENGTH, OFFICE_ROOM_NAME };

const FACING_SET = new Set<string>(FACINGS);

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

  onCreate(options?: OfficeRoomOptions): void {
    this.state = new OfficeState();
    this.sessions = options?.sessions;
    this.auth = options?.auth;
    this.directory = options?.directory;
    if (options?.logDirectoryDenial) this.logDirectoryDenial = options.logDirectoryDenial;

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
    options?: { name?: unknown; status?: unknown },
  ): void {
    const [dx, dy] = SPAWN_RING[this.joinCount % SPAWN_RING.length];
    this.joinCount++;

    // Con identidad verificada, `options.name` deja de ser una fuente legitima:
    // lo escribe el cliente y en una oficina autenticada dejaria a cualquiera
    // rotularse con el nombre de otra persona. Sin identidad se mantiene el
    // camino de siempre. En ambos casos pasa por `sanitizeName`, que es quien
    // hace valer `MAX_NAME_LENGTH`.
    const identity = client.auth === true ? undefined : client.auth;

    this.state.players.set(
      client.sessionId,
      createPlayerState({
        name: sanitizeName(
          identity ? deriveIdentityName(identity, DEFAULT_NAME) : options?.name,
        ),
        x: (PLAYER_SPAWN_TX + dx) * TILE + TILE / 2,
        y: (PLAYER_SPAWN_TY + dy) * TILE + TILE / 2,
        status: sanitizeStatus(options?.status),
        facing: DEFAULT_FACING,
      }),
    );

    // El uid es lo que convierte al registro en una prueba de propiedad: sin el
    // (auth desactivada) solo prueba que la sesion esta viva. Ver
    // `liveSessions.ts` y la guarda de `POST /livekit/token`.
    this.sessions?.add(client.sessionId, identity?.uid);
  }

  onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    this.sessions?.remove(client.sessionId);

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
}
