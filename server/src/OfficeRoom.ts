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

import { Room, ServerError, type AuthContext, type Client, type Deferred } from '@colyseus/core';
import {
  BUILT_IN_SPACES_VERSION,
  PLAYER_SPAWN_TX,
  PLAYER_SPAWN_TY,
  TILE,
  WORLD_H,
  WORLD_W,
} from '../../src/game/mapData.ts';
import {
  ACCESS_DENIED_CODE,
  DEFAULT_FACING,
  DEFAULT_NAME,
  DEFAULT_STATUS,
  DO_NOT_DISTURB,
  FACINGS,
  MAX_NAME_LENGTH,
  OFFICE_ROOM_NAME,
  SESSION_REPLACED_CLOSE_CODE,
  SESSION_REVOKED_CLOSE_CODE,
  isPresenceStatus,
  recordingAvailableUntil,
  type AccessDeniedReason,
} from '../../src/game/officeProtocol.ts';
import {
  BASE_LAYOUT,
  BASE_TERRAIN,
  encodeTerrainBlocks,
  encodeTerrainWalls,
  isPositionWalkable,
  isFootprintWalkable,
  type LayoutMaterial,
  type TerrainSnapshot,
} from '../../src/game/officeLayout.ts';
import {
  collisionWorld,
  boxOverlapsRects,
  encodeCollisionTable,
  isPositionBlocked,
  staticCollisionInstances,
  type CollisionRect,
} from '../../src/game/pieceCollisions.ts';
import {
  BASE_MAP_SEATS,
  DESK_SEAT_FACING,
  deskSeatTiles,
  inSeatReach,
  mapSeatTiles,
  parseSeatRef,
  type SeatTiles,
} from '../../src/game/seating.ts';
import { createCallInvitationRegistry, type CallInvitationRegistry } from './callInvitations.ts';
import { physicalBodyRect } from '../../src/game/avatarGeometry.ts';
import { ART_PACK_DEFAULTS } from './decor/artCatalogRules.ts';
import type { DeskDirectory } from './desks/desksPort.ts';
import { decideAccess, type AccessDecision } from './directory/accessDecision.ts';
import type { LastPosition, UserDirectory } from './directory/directoryPort.ts';
import { isPositionInMap } from './directory/positionRules.ts';
import type { LiveSessionRegistry } from './liveSessions.ts';
import type { SessionEvictionHub } from './sessionEviction.ts';
import type { CharacterRetirementHub } from './characterRetirement.ts';
import { participantKeyOf, type FinishedRecordingStore } from './recording/finishedRecordings.ts';
import type { ActiveRecording, RecordingRegistry } from './recording/recordingRegistry.ts';
import { OfficeState, createPlayerState, createRecordingState } from './schema.ts';
import { SESSION_EXPIRED, type IdTokenVerifier, type VerifiedIdentity } from './verifyIdToken.ts';

export { DEFAULT_NAME, MAX_NAME_LENGTH, OFFICE_ROOM_NAME };

const FACING_SET = new Set<string>(FACINGS);

/** The static office's collision rectangles with every piece at its default: what a room without a runtime checks. */
const BASE_COLLISION_RECTS: readonly CollisionRect[] = collisionWorld(staticCollisionInstances(BASE_LAYOUT.props, BASE_MAP_SEATS), new Map());

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
  positionRevision?: number;
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
/** A request to sit (art migration, step 6): a `seating.ts` reference. */
export interface SitMessage {
  seat: string;
  positionRevision?: number;
}

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
  seats?: readonly { tx: number; ty: number; facing: 'up' | 'down' | 'left' | 'right' }[];
  /**
   * The terrain every `move` is checked against (art migration, step 8),
   * read on each move so it can change while the room lives. Absent is the
   * committed layout's (`BASE_TERRAIN`); persisted blocks (#123 phase 2)
   * hand in their own snapshot here.
   */
  terrain?: () => TerrainSnapshot;
  /**
   * Accepted terrain edits (#123 phase 2) and wall edits, with the whole new
   * block list, which the room replicates as `state.terrainBlocks`; the walls
   * (`state.terrainWalls`) come from the snapshot. `terrain` above must
   * already answer with the new snapshot when this fires.
   */
  subscribeTerrainChanges?: (listener: (blocks: readonly LayoutMaterial[]) => void) => () => void;
  /**
   * The collision rectangles every `move` is checked against, read on each
   * move. Absent is the static office with every piece at its default (the
   * footprint of each Tiled prop), exactly the tiles props blocked before.
   */
  collisions?: () => readonly CollisionRect[];
  /** The saved collision table in its wire form, replicated as `state.pieceCollisions`. */
  collisionTable?: () => string;
  /** Accepted collision edits, with the new wire form; `collisions` already answers with them. */
  subscribeCollisionChanges?: (listener: (encoded: string) => void) => () => void;
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
   * `logFailure` en `verifyIdToken.ts`. The client learns the reason too
   * (#129), but not the uid, which is what the operator needs to find the row.
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
  /** Shared committed desk mutations; no occupant data travels in the notice. */
  subscribeDesksChanges?: (listener: () => void) => () => void;
  /**
   * Live eviction (#93): the room registers here so an admin route can throw
   * a revoked account out right away. Absent, nobody can evict from outside.
   */
  eviction?: SessionEvictionHub;
  /**
   * Live reset of a retired character (#122): the room registers here so the
   * retire route can put every player wearing it on the pack default.
   */
  characters?: CharacterRetirementHub;
  /**
   * Assignable desks (art migration, step 6), to check a desk seat: that the
   * desk exists, where it is and who owns it. Absent (no `DATABASE_URL`)
   * there are no desks, so only the base map chairs can be sat on.
   */
  desks?: Pick<DeskDirectory, 'getDesk' | 'listDesks'>;
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
type OfficeAuthData =
  | (VerifiedIdentity & { directoryName: string | null; avatarId: string | null; directoryUserId: string | null })
  | true;

/** Account behind a client, or `undefined` in the open office (#78). */
function accountOf(client: Client<unknown, OfficeAuthData>): string | undefined {
  return client.auth === true ? undefined : client.auth?.uid;
}

/** A claimed desk seats only its owner; a free one seats anyone (step 6). */
function mayUseDesk(userId: string | null, occupantId: string | null): boolean {
  return occupantId === null || (userId !== null && userId === occupantId);
}

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
  private unsubscribeDesksChanges?: () => void;
  private unsubscribeTerrainChanges?: () => void;
  private unsubscribeCollisionChanges?: () => void;
  private unregisterEviction?: () => void;
  private unregisterCharacters?: () => void;
  /**
   * Sessions a newer join of the same account already released (#78). Their
   * own `onLeave` arrives later, as a plain non-consented close, and must
   * neither grant a reconnection window nor release them a second time.
   */
  private replaced = new Set<string>();
  /**
   * Sessions waiting in their reconnection window, by owner (#78). They are
   * no longer in `this.clients`, so this is the only way a newer join of the
   * same account can find them and cancel the seat.
   */
  private pendingReconnections = new Map<string, { uid: string; seat: Deferred<Client> }>();
  private desks?: Pick<DeskDirectory, 'getDesk' | 'listDesks'>;
  /**
   * Each sitter's seat reach and directory id, by session (step 6). Kept
   * because a desk seat's area comes from the store, and a `move` has to know
   * it without asking the store on every step; the id survives a
   * reconnection window, when the client is not in `this.clients`.
   */
  private seated = new Map<string, { reach: SeatTiles; userId: string | null }>();
  private terrain: () => TerrainSnapshot = () => BASE_TERRAIN;
  private mapSeats = BASE_MAP_SEATS;
  private collisions: () => readonly CollisionRect[] = () => BASE_COLLISION_RECTS;
  // Bridges a definitive leave and a refresh while its write is in flight.
  // Serializing per uid prevents an older slow write from undoing a newer leave.
  private positionWrites = new Map<string, { position: LastPosition; done: Promise<void> }>();

  onCreate(options?: OfficeRoomOptions): void {
    this.mapSeats = options?.seats ?? BASE_MAP_SEATS;
    this.state = new OfficeState();
    if (options?.terrain) this.terrain = options.terrain;
    this.state.terrainBlocks = encodeTerrainBlocks(this.terrain().blocks);
    this.state.terrainWalls = encodeTerrainWalls(this.terrain().walls);
    this.unsubscribeTerrainChanges = options?.subscribeTerrainChanges?.((blocks) => {
      this.state.terrainBlocks = encodeTerrainBlocks(blocks);
      this.state.terrainWalls = encodeTerrainWalls(this.terrain().walls);
      // The runtime has persisted and published its authoritative snapshot.
      // Iterate replicated players, not sockets: reserved reconnects must move too.
      for (const [sessionId, player] of this.state.players) {
        if (isFootprintWalkable(this.terrain(), player)) continue;
        const position = this.safeSpawn(this.joinCount++ % SPAWN_RING.length);
        this.standUp(sessionId);
        player.x = position.x;
        player.y = position.y;
        player.facing = DEFAULT_FACING;
        player.positionRevision++;
        this.sessions?.moveTo(sessionId, position.x, position.y);
      }
    });
    if (options?.collisions) this.collisions = options.collisions;
    this.state.pieceCollisions = options?.collisionTable?.() ?? encodeCollisionTable(new Map());
    this.unsubscribeCollisionChanges = options?.subscribeCollisionChanges?.((encoded) => {
      this.state.pieceCollisions = encoded;
    });
    this.sessions = options?.sessions;
    this.auth = options?.auth;
    this.directory = options?.directory;
    if (options?.logDirectoryDenial) this.logDirectoryDenial = options.logDirectoryDenial;
    if (options?.reconnectionWindowSeconds !== undefined) {
      this.reconnectionWindowSeconds = options.reconnectionWindowSeconds;
    }
    this.stopRecording = options?.stopRecording;
    this.recordings = options?.recordings;
    this.desks = options?.desks;
    this.unsubscribeDesksChanges = options?.subscribeDesksChanges?.(() => {
      this.broadcast('deskschanged');
      void this.recheckDeskSeats();
    });
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
    this.unregisterEviction = options?.eviction?.register((uid) => this.evictAccount(uid));
    this.unregisterCharacters = options?.characters?.register((pieceId, fallbackId) => this.retireCharacter(pieceId, fallbackId));
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

      if ((message?.positionRevision ?? 0) !== player.positionRevision) return;

      const x = clamp(message?.x, 0, WORLD_W);
      const y = clamp(message?.y, 0, WORLD_H);
      // Un `move` invalido se ignora entero: aplicar solo el eje valido dejaria
      // al avatar en una posicion que el cliente nunca pidio.
      if (x === null || y === null) return;
      // Moving away from a seat stands up (step 6). A move that stays within
      // reach keeps it: the client snaps onto the chair after the room says
      // yes, and a move sent just before the sit is not a request to leave.
      // Seated, the facing is the seat's, whatever the client says.
      const reach = this.seated.get(client.sessionId)?.reach;
      const withinSeat = reach !== undefined && inSeatReach({ x, y }, reach);
      // The same rule the client collides with (step 8): water, walls and
      // hedges block by tile, and the collision rectangles of the pieces
      // (props, desks, decor, chairs) by the body center. A sitter is exempt
      // within its seat's reach: feet on the chair put the body over the
      // table, out of the collider.
      if (!withinSeat && (!isPositionWalkable(this.terrain(), x, y) || isPositionBlocked(this.collisions(), x, y))) return;

      player.x = x;
      player.y = y;
      if (reach !== undefined && !withinSeat) this.standUp(client.sessionId);
      if (player.seat === '') player.facing = sanitizeFacing(message?.facing);

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

    // Sitting (step 6) is a request like any other: an unknown seat, one out
    // of reach, an occupied one or someone else's desk is dropped whole.
    this.onMessage('sit', (client: Client<unknown, OfficeAuthData>, message: SitMessage) => {
      void this.sit(client, message?.seat, message?.positionRevision ?? 0);
    });

    this.onMessage('stand', (client: Client) => {
      this.standUp(client.sessionId);
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
    this.unsubscribeDesksChanges?.();
    this.unsubscribeTerrainChanges?.();
    this.unsubscribeCollisionChanges?.();
    this.unregisterEviction?.();
    this.unregisterCharacters?.();
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
   * The directory refusals (#24) use the same 401 but say why in the message
   * (#129): `expired`, `revoked` or `not-provisioned` (`ACCESS_DENIED_REASONS`),
   * and so does a session too old to trust (#128, `session-expired`).
   * They only reach someone whose token verified, who already proved who they
   * are; a mute refusal left the client nothing to show but "Sin servidor".
   * The server LOG still records it too, with the uid: "todo el mundo cae en
   * not-provisioned" (las migraciones no corrieron, o el despliegue apunta a
   * otra base de datos) y "un invitado caduco" son dos incidencias distintas.
   */
  async onAuth(
    _client: Client<unknown, OfficeAuthData>,
    options: unknown,
    _context: AuthContext,
  ): Promise<OfficeAuthData> {
    if (!this.auth) return true;

    const token = (options as { token?: unknown } | null | undefined)?.token;
    const identity = await this.auth.verify(token);
    if (identity === null) throw new ServerError(ACCESS_DENIED_CODE, 'unauthorized' satisfies AccessDeniedReason);
    // #128: a login older than `MAX_SESSION_AGE_DAYS`. The client signs out on
    // it and asks for email and password again; the directory is not asked.
    if (identity === SESSION_EXPIRED) {
      throw new ServerError(ACCESS_DENIED_CODE, SESSION_EXPIRED satisfies AccessDeniedReason);
    }

    // #100, D5: el nombre visible ya elegido en el directorio viaja junto a la
    // identidad, para que `onJoin` no tenga que volver a consultar la fila que
    // `resolveOnLogin` ya trajo. `null` cubre tanto "sin directorio" como
    // "todavia no eligio nombre" -- las dos caen al mismo `deriveIdentityName`.
    let directoryName: string | null = null;
    // Art migration, step 5: the persisted character rides along for the same
    // reason. `null` means "no directory", which `onJoin` turns into the pack
    // default.
    let avatarId: string | null = null;
    // Desk owners are directory ids, not uids (step 6, desk seats).
    let directoryUserId: string | null = null;

    if (this.directory) {
      // La hora se toma aqui y se pasa a `decideAccess`, que es pura: asi la
      // regla de caducidad se puede probar en sus bordes exactos sin tocar el
      // reloj del proceso.
      const user = await this.directory.resolveOnLogin(identity);
      const decision = decideAccess(user, new Date());
      if (decision !== 'allow') {
        this.logDirectoryDenial(decision, identity.uid);
        // Typed through the shared vocabulary, so a directory decision the
        // client cannot read back fails to compile instead of reaching it.
        const reason: AccessDeniedReason = decision;
        throw new ServerError(ACCESS_DENIED_CODE, reason);
      }
      // `decision === 'allow'` solo puede darse con `user` no nulo (ver
      // `decideAccess`): el primer caso que cubre es justamente `null`.
      directoryName = user!.displayName;
      avatarId = user!.avatarId;
      directoryUserId = user!.id;
    }

    return { ...identity, directoryName, avatarId, directoryUserId };
  }

  async onJoin(
    client: Client<unknown, OfficeAuthData>,
    options?: { name?: unknown; status?: unknown; spacesVersion?: unknown },
  ): Promise<void> {
    const spawnOffset = this.joinCount % SPAWN_RING.length;
    this.joinCount++;

    // Con identidad verificada, `options.name` deja de ser una fuente legitima:
    // lo escribe el cliente y en una oficina autenticada dejaria a cualquiera
    // rotularse con el nombre de otra persona. Sin identidad se mantiene el
    // camino de siempre. En ambos casos pasa por `sanitizeName`, que es quien
    // hace valer `MAX_NAME_LENGTH`.
    const identity = client.auth === true ? undefined : client.auth;
    let position: LastPosition | null = null;
    if (identity && this.directory) {
      position = this.currentPositionOf(identity.uid, client);
      // Live state is already newer than storage; never wait on a read that
      // could outlive that session and return its stale pre-leave coordinate.
      if (position === null) {
        try {
          position = await this.directory.getLastPosition(identity.uid);
        } catch (error) {
          console.warn('[office] last position read failed', error);
        }
        // #78 may have closed this still-joining socket while storage waited.
        // Never resurrect its player or let it replace the newer tab.
        if (!this.clients.includes(client)) return;
        // Another join may have completed and moved during the storage await.
        position = this.currentPositionOf(identity.uid, client) ?? position;
      }
      if (position && (!isPositionInMap(position)
        || !this.isOccupable(position))) position = null;
    }
    if (identity) this.replaceOtherSessionsOf(identity.uid, client);
    const spawn = position ?? this.safeSpawn(spawnOffset);
    const spawnX = spawn.x;
    const spawnY = spawn.y;

    this.state.players.set(
      client.sessionId,
      createPlayerState({
        // #100, D5: con identidad verificada, el nombre elegido en el
        // directorio manda sobre el derivado del token -- es el mismo valor
        // que ya devuelve `/me/display-name` -- y solo cae al derivado cuando
        // todavia no eligio ninguno (`directoryName === null`).
        name: sanitizeName(
          identity ? (identity.directoryName ?? deriveIdentityName(identity, DEFAULT_NAME)) : options?.name,
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
        // Never from `options`: what others see must be what the account
        // saved through `/me/avatar`. Without a directory (or without auth)
        // nothing was saved, so everyone is the pack default.
        avatarId: identity?.avatarId ?? ART_PACK_DEFAULTS.character,
        seat: '',
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
  async onLeave(client: Client<unknown, OfficeAuthData>, consented: boolean): Promise<void> {
    // Already released by the join that replaced it (#78); a window here would
    // let the old tab reconnect and take the account back.
    if (this.replaced.delete(client.sessionId)) return;

    if (consented) {
      await this.releaseSession(client.sessionId, accountOf(client));
      return;
    }

    const seat = this.allowReconnection(client, this.reconnectionWindowSeconds);
    const uid = accountOf(client);
    if (uid !== undefined) this.pendingReconnections.set(client.sessionId, { uid, seat });
    try {
      await seat;
    } catch {
      if (!this.replaced.delete(client.sessionId)) await this.releaseSession(client.sessionId, uid);
    } finally {
      this.pendingReconnections.delete(client.sessionId);
    }
  }

  /**
   * Last join wins (#78): every other session of `uid`, connected or waiting
   * to reconnect, is released right here, before this join adds its own player,
   * so the first state the new tab receives already holds exactly one avatar
   * for the account.
   *
   * A connected tab is closed with `SESSION_REPLACED_CLOSE_CODE`, which its
   * client reads as "do not retry". A tab inside its reconnection window has
   * its seat rejected, which is what makes its old reconnection token useless.
   * Both are marked in `replaced` so their late `onLeave` does nothing.
   */
  private replaceOtherSessionsOf(uid: string, newcomer: Client): void {
    this.closeSessionsOf(uid, SESSION_REPLACED_CLOSE_CODE, 'session-replaced', newcomer);
  }

  /**
   * An admin took this account's access away (#93). The directory already
   * refuses its next join; this throws out the sessions already inside, with
   * the same mechanism as a replaced tab (#78) and its own close code.
   */
  private evictAccount(uid: string): void {
    this.closeSessionsOf(uid, SESSION_REVOKED_CLOSE_CODE, 'session-revoked');
  }

  /**
   * A retired character (#122): whoever wears it, connected or inside a
   * reconnection window, wears `fallbackId` now. Only the replicated field
   * changes; every client already redraws an avatar whose character changes,
   * so nobody's session is touched.
   */
  private retireCharacter(pieceId: string, fallbackId: string): void {
    for (const player of this.state.players.values()) {
      if (player.avatarId === pieceId) player.avatarId = fallbackId;
    }
  }

  /**
   * Releases every session of `uid` but `except`, connected or waiting in its
   * reconnection window, and marks them in `replaced` so their late `onLeave`
   * neither grants a window nor releases them twice.
   */
  private closeSessionsOf(uid: string, closeCode: number, reason: string, except?: Client): void {
    for (const other of this.clients) {
      if (other === except || accountOf(other) !== uid) continue;
      this.replaced.add(other.sessionId);
      void this.releaseSession(other.sessionId, uid);
      other.leave(closeCode);
    }

    for (const [sessionId, pending] of this.pendingReconnections) {
      if (pending.uid !== uid) continue;
      this.pendingReconnections.delete(sessionId);
      this.replaced.add(sessionId);
      void this.releaseSession(sessionId, uid);
      pending.seat.reject(new Error(reason));
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
  private releaseSession(sessionId: string, uid?: string): Promise<void> {
    const player = this.state.players.get(sessionId);
    const saved = player && uid !== undefined && this.directory
      ? this.savePosition(uid, { x: player.x, y: player.y }) : Promise.resolve();
    this.state.players.delete(sessionId);
    this.seated.delete(sessionId);
    this.sessions?.remove(sessionId);
    this.stopRecordingsOf(sessionId);

    // D7: sin caducidad, la unica limpieza posible es la baja de una de las
    // dos partes. `removeAllFor` cubre a quien se va como emisor Y como
    // destinatario de un solo barrido; solo el primer caso avisa a alguien --
    // si el que se va era el DESTINATARIO, la tarjeta ya la tiene el que
    // llamo y no hay a quien notificar (el emisor no vuelve a saber de esto
    // hasta que el destinatario responda o se vaya el).
    for (const entry of this.invitations.removeAllFor(sessionId)) {
      if (entry.from === sessionId) {
        this.sendTo(entry.to, 'callerleft', { from: entry.from });
      }
    }
    return saved;
  }

  private savePosition(uid: string, position: LastPosition): Promise<void> {
    // A seated move can be exempt from terrain checks; storage still must
    // never replace a good value with NaN or an off-map coordinate.
    if (!isPositionInMap(position)) return Promise.resolve();
    const previous = this.positionWrites.get(uid)?.done ?? Promise.resolve();
    const done = previous.then(() => this.directory!.saveLastPosition(uid, position))
      .catch((error: unknown) => { console.warn('[office] last position save failed', error); })
      .finally(() => {
        if (this.positionWrites.get(uid)?.done === done) this.positionWrites.delete(uid);
      });
    this.positionWrites.set(uid, { position, done });
    return done;
  }

  private currentPositionOf(uid: string, newcomer: Client): LastPosition | null {
    for (const other of this.clients) {
      if (other === newcomer || accountOf(other) !== uid) continue;
      const player = this.state.players.get(other.sessionId);
      if (player) return { x: player.x, y: player.y };
    }
    for (const [sessionId, pending] of this.pendingReconnections) {
      if (pending.uid !== uid) continue;
      const player = this.state.players.get(sessionId);
      if (player) return { x: player.x, y: player.y };
    }
    return this.positionWrites.get(uid)?.position ?? null;
  }

  /**
   * Seats `client` on `raw` if the room agrees (step 6). A base map chair is
   * checked right away; a desk seat asks the store, so everything is checked
   * again after that wait: the player may have moved, left or lost the seat
   * to someone faster in between.
   *
   * Desk rule: a claimed desk only seats its owner; a free one seats anyone,
   * and sitting never claims it. `recheckDeskSeats` keeps that true when the
   * desk changes hands while someone sits at it.
   */
  private async sit(client: Client<unknown, OfficeAuthData>, raw: unknown, revision: number): Promise<void> {
    const ref = parseSeatRef(raw, this.mapSeats.length);
    if (ref === null) return;
    const seatId = raw as string;
    const player = this.state.players.get(client.sessionId);
    if (!player || player.positionRevision !== revision || player.seat === seatId) return;
    const userId = client.auth === true ? null : (client.auth?.directoryUserId ?? null);

    if (ref.kind === 'map') {
      const seat = this.mapSeats[ref.index];
      this.takeSeat(client.sessionId, seatId, { reach: mapSeatTiles(seat), userId }, seat.facing);
      return;
    }

    if (!this.desks) return;
    let desk: Awaited<ReturnType<DeskDirectory['getDesk']>>;
    try {
      desk = await this.desks.getDesk(ref.deskId);
    } catch {
      return;
    }
    if (desk === null || player.positionRevision !== revision || !mayUseDesk(userId, desk.occupantId)) return;
    this.takeSeat(client.sessionId, seatId, { reach: deskSeatTiles(desk), userId }, DESK_SEAT_FACING);
  }

  private takeSeat(
    sessionId: string,
    seatId: string,
    seat: { reach: SeatTiles; userId: string | null },
    facing: string,
  ): void {
    const player = this.state.players.get(sessionId);
    if (!player || !inSeatReach(player, seat.reach)) return;
    for (const [otherId, other] of this.state.players) {
      if (otherId !== sessionId && other.seat === seatId) return;
    }
    player.seat = seatId;
    player.facing = facing;
    this.seated.set(sessionId, seat);
  }

  private standUp(sessionId: string): void {
    this.seated.delete(sessionId);
    const player = this.state.players.get(sessionId);
    if (player && player.seat !== '') player.seat = '';
  }

  private isOccupable(position: LastPosition): boolean {
    if (!isFootprintWalkable(this.terrain(), position)) return false;
    const body = physicalBodyRect(position);
    return !boxOverlapsRects(this.collisions(), body);
  }

  private safeSpawn(preferred = 0): LastPosition {
    const at = ([dx, dy]: readonly [number, number]): LastPosition => ({
      x: (PLAYER_SPAWN_TX + dx) * TILE + TILE / 2,
      y: (PLAYER_SPAWN_TY + dy) * TILE + TILE / 2,
    });
    const candidate = at(SPAWN_RING[preferred]!);
    if (this.isOccupable(candidate)) return candidate;
    // An unavailable return square falls back to primary spawn, then its ring.
    return SPAWN_RING.map(at).find((position) => this.isOccupable(position)) ?? at(SPAWN_RING[0]!);
  }

  /**
   * A desk changed (claimed, released, moved or deleted): whoever sits at one
   * it no longer allows, or no longer reaches, stands up.
   */
  private async recheckDeskSeats(): Promise<void> {
    if (!this.desks) return;
    const deskSitters = [...this.seated].filter(
      ([sessionId]) => parseSeatRef(this.state.players.get(sessionId)?.seat)?.kind === 'desk',
    );
    if (deskSitters.length === 0) return;
    let desks: Awaited<ReturnType<DeskDirectory['listDesks']>>;
    try {
      desks = await this.desks.listDesks();
    } catch {
      return;
    }
    const byId = new Map(desks.map((desk) => [desk.id, desk]));
    for (const [sessionId, seat] of deskSitters) {
      const player = this.state.players.get(sessionId);
      const ref = parseSeatRef(player?.seat);
      if (!player || ref?.kind !== 'desk' || this.seated.get(sessionId) !== seat) continue;
      const desk = byId.get(ref.deskId);
      if (desk === undefined || !mayUseDesk(seat.userId, desk.occupantId) || !inSeatReach(player, deskSeatTiles(desk))) {
        this.standUp(sessionId);
      } else {
        this.seated.set(sessionId, { ...seat, reach: deskSeatTiles(desk) });
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
