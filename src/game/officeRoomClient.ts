/**
 * Envoltorio del cliente Colyseus (PRD 6.2). Traduce el estado sincronizado a
 * `RemotePlayerSnapshot`, que es lo unico que la escena necesita saber, y
 * regula la frecuencia de publicacion con `createMoveThrottle`.
 *
 * Solo importa `colyseus.js`, nunca `@colyseus/core`: el paquete de servidor
 * arrastraria Node al bundle del navegador.
 *
 * No captura los fallos de conexion INICIALES. Rechaza, y quien llama decide:
 * la oficina tiene que seguir siendo jugable en solitario si el servidor no
 * esta. Lo que si gestiona -- desde la issue #52 -- son las caidas a mitad de
 * sesion: ahi no hay nadie a quien rechazarle nada, porque la promesa del join
 * se resolvio hace rato. Ver `reconnectPolicy.ts` y `handleLeave`.
 */

import { Client, getStateCallbacks, type Room } from 'colyseus.js';
import { createMoveThrottle } from './moveThrottle';
import {
  DEFAULT_STATUS,
  MOVE_INTERVAL_MS,
  OFFICE_ROOM_NAME,
  type Facing,
  type PresenceStatus,
  type RecordingReadyPayload,
} from './officeProtocol';
import { onPageHide } from './pageLifecycle';
import { decideReconnect } from './reconnectPolicy';
import type { RemotePlayerSnapshot } from './remoteAvatars';

/**
 * Forma del jugador tal y como llega por el cable. El cliente no declara el
 * schema: Colyseus lo refleja desde el servidor, asi que aqui solo se describe
 * lo que se lee.
 */
interface RemotePlayer {
  name: string;
  x: number;
  y: number;
  status: string;
  facing: string;
  /** Version de config de espacios con la que este par deriva su sala (#7, D4). */
  spacesVersion: string;
}

/** Active recording of a space, as synced (#5). Keyed by spaceId. */
export interface ActiveRecordingSnapshot {
  startedBy: string;
  startedAt: number;
}

interface OfficeRoomState {
  players: {
    get(sessionId: string): RemotePlayer | undefined;
  };
  recordings: unknown;
}

/**
 * Superficie de los callbacks de estado que este modulo usa. Se declara a mano
 * porque el cliente NO define el schema -- Colyseus lo refleja del servidor en
 * tiempo de ejecucion -- y los genericos de `getStateCallbacks` esperan clases
 * `Schema` concretas que aqui no existen. Declarar solo lo que se consume, y
 * afirmarlo en un unico punto, es preferible a un `any` suelto.
 */
interface PlayersCallbacks {
  onAdd(handler: (player: RemotePlayer, sessionId: string) => void): () => void;
  onRemove(handler: (player: RemotePlayer, sessionId: string) => void): () => void;
}

interface PlayerCallbacks {
  onChange(handler: () => void): () => void;
}

interface RecordingsCallbacks {
  onAdd(handler: (recording: ActiveRecordingSnapshot, spaceId: string) => void): () => void;
  onRemove(handler: (recording: ActiveRecordingSnapshot, spaceId: string) => void): () => void;
}

/**
 * Salud de la sesion con el servidor (issue #52). Tres estados y no un
 * booleano: "reconectando" es exactamente lo que faltaba antes -- el HUD solo
 * sabia decir conectado o sin servidor, asi que una caida a mitad de sesion se
 * seguia anunciando como "N en linea" cuando ya no lo era.
 *
 * `replaced` (#78) is its own state and not `offline` because what follows is
 * different: offline may offer a retry, while a tab whose account joined from
 * somewhere else has to leave the office, since retrying would evict the
 * newer tab.
 */
export type OfficeConnectionState = 'connected' | 'reconnecting' | 'offline' | 'replaced';

export interface OfficeRoomHandlers {
  onAdd(snapshot: RemotePlayerSnapshot): void;
  onChange(snapshot: RemotePlayerSnapshot): void;
  onRemove(sessionId: string): void;
  /**
   * Invitaciones de llamada (issue #2). Opcionales porque los mensajes que las
   * disparan son server-local (D4, no viven en `officeProtocol.ts`): un
   * consumidor que aun no sabe de llamadas -- como el arnes de pruebas de
   * `OfficeScene.browser.test.ts` -- no tiene que declarar tres manejadores
   * mudos solo para seguir compilando.
   */
  onCallInvite?(payload: { from: string; name: string }): void;
  onCallerLeft?(payload: { from: string }): void;
  onCallAccepted?(payload: { by: string; name: string }): void;
  /**
   * Cambios de salud de la sesion (issue #52). Opcional por la MISMA razon que
   * los tres de arriba: el arnes de `OfficeScene.browser.test.ts` construye
   * este objeto a mano, y obligarle a declarar manejadores mudos por cada
   * capacidad nueva convierte cada cambio de esta interfaz en un cambio de
   * todos sus consumidores.
   */
  onConnectionState?(state: OfficeConnectionState): void;
  /**
   * Se acaba de reconectar: olvida TODO lo que sabias de los pares, viene un
   * replay completo (issue #52).
   *
   * Hace falta porque la sala nueva no es la vieja con otro socket: es otro
   * objeto `Room` con su propio estado, que reparte a todos los presentes como
   * altas. Sin este aviso, quien lleve un registro de avatares acumularia el
   * estado viejo y el nuevo, y cualquiera que se hubiese ido durante la caida
   * se quedaria pintado para siempre -- nunca habra un `onRemove` que lo
   * retire, porque ese borrado ocurrio en una sala que ya no existe.
   */
  onResync?(): void;
  /**
   * Every active recording, keyed by spaceId (#5). Always the whole map, never
   * a delta; optional for the same reason as the call handlers.
   */
  onRecordings?(active: Record<string, ActiveRecordingSnapshot>): void;
  /** A finished recording this session took part in is uploaded (#58). */
  onRecordingReady?(payload: RecordingReadyPayload): void;
}

export interface ConnectOfficeRoomOptions {
  endpoint: string;
  name: string;
  handlers: OfficeRoomHandlers;
  moveIntervalMs?: number;
  /** Estado con el que se entra, para no aparecer "En linea" sin haberlo pedido. */
  status?: PresenceStatus;
  /**
   * Version inicial de config de espacios (#7, D4), para que este par no
   * quede "brevemente sin version" mientras espera al primer
   * `sendSpacesVersion`. Ausente cae al valor por defecto del servidor.
   */
  spacesVersion?: string;
  /**
   * ID token de la sesion (#8), pedido justo antes de entrar para que viaje
   * fresco. Ausente cuando no hay autenticacion configurada, que es el modo en
   * el que el servidor sigue abriendo la puerta a cualquiera.
   */
  getIdToken?: () => Promise<string | null>;
}

/** Lo que viaja en el `joinOrCreate`; ver `buildJoinOptions`. */
export interface OfficeJoinOptions {
  name: string;
  status: PresenceStatus;
  spacesVersion?: string;
  token?: string;
}

/**
 * Compone las opciones del join (#8). Separada y pura porque es un contrato
 * con el servidor, no un detalle: con autenticacion encendida `OfficeRoom`
 * exige `token` e IGNORA `name` (deriva el nombre del token verificado), y con
 * autenticacion apagada `name` es lo unico que tiene. Mandar siempre `name` y
 * anadir `token` solo cuando existe es lo que hace que un mismo cliente sirva
 * para los dos modos.
 *
 * Un token vacio no es un token: viajaria como un intento de autenticacion
 * fallido en vez de como la ausencia de sesion que es.
 */
export function buildJoinOptions({
  name,
  status,
  spacesVersion,
  token,
}: {
  name: string;
  status: PresenceStatus;
  spacesVersion?: string;
  token?: string | null;
}): OfficeJoinOptions {
  const options: OfficeJoinOptions = { name, status };
  if (spacesVersion !== undefined) options.spacesVersion = spacesVersion;
  if (token) options.token = token;
  return options;
}

export interface OfficeConnection {
  sessionId: string;
  sendMove(x: number, y: number, facing: Facing): void;
  sendStatus(status: PresenceStatus): void;
  /**
   * Publica una nueva version de config de espacios (#7, D4). Sin agrupar,
   * como `sendStatus`: agrupar podria tragarse justo la actualizacion que
   * aisla a alguien -- el predicado mutuo de `audiblePeers` depende de que
   * cada cambio de version llegue, no solo el ultimo de una rafaga.
   */
  sendSpacesVersion(version: string): void;
  /** Pide invitar a `to` a una llamada. Sin agrupar, como `sendStatus`: es un gesto humano, no un flujo continuo. */
  sendCall(to: string): void;
  /** Responde a quien nos llamo: aceptar o pasar viajan por el mismo mensaje (D3, cableado del servidor). */
  sendCallRespond(from: string, accept: boolean): void;
  leave(): Promise<void>;
}

function toSnapshot(sessionId: string, player: RemotePlayer): RemotePlayerSnapshot {
  return {
    sessionId,
    name: player.name,
    x: player.x,
    y: player.y,
    status: player.status,
    facing: player.facing,
    spacesVersion: player.spacesVersion,
  };
}

export async function connectOfficeRoom({
  endpoint,
  name,
  handlers,
  moveIntervalMs = MOVE_INTERVAL_MS,
  status = DEFAULT_STATUS,
  spacesVersion,
  getIdToken,
}: ConnectOfficeRoomOptions): Promise<OfficeConnection> {
  const client = new Client(endpoint);
  // El token se pide aqui y no antes: entre elegir estado y llegar a este
  // punto puede haber pasado tiempo, y el que importa es el del momento del
  // join. Un fallo al pedirlo no se traga: la escena ya degrada a solitario
  // cuando este `connect` rechaza.
  const token = getIdToken ? await getIdToken() : null;
  /**
   * La sala VIVA, mutable a proposito (issue #52). `client.reconnect` devuelve
   * un `Room` NUEVO, no revive el viejo, asi que todo lo que publica --
   * `sendMove`, `sendStatus`, el `send` del agrupador -- tiene que leer esta
   * variable en cada llamada. Capturar la sala en una constante dejaria a la
   * sesion recuperada hablandole a un socket muerto sin que nada fallase.
   */
  let room: Room<OfficeRoomState> = await client.joinOrCreate(
    OFFICE_ROOM_NAME,
    buildJoinOptions({ name, status, spacesVersion, token }),
  );

  /** Reintentos ya fallidos; `reconnectPolicy` lo traduce a retardo o rendicion. */
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * `leave()` ya corrio. Corta cualquier reintento en vuelo: una escena que se
   * apaga a mitad del backoff no puede resucitar la sesion cuando venza el
   * temporizador, o quedaria una conexion publicando la posicion de un jugador
   * que ya no existe -- el mismo fallo que la guarda `alive` de `OfficeScene`.
   */
  let disposed = false;

  /**
   * Cablea una sala -- la del join o la de un reconnect -- con todo lo que este
   * modulo escucha. Existe como funcion y no en linea porque el constructor de
   * `Room` de `colyseus.js` hace `this.onLeave(() => this.removeAllListeners())`:
   * al morir una sala se lleva por delante TODOS sus manejadores, asi que la
   * sala nueva llega virgen y hay que repetir el cableado entero. Tener un solo
   * sitio donde se registra es lo que impide que join y reconnect se separen.
   */
  function registerRoom(target: Room<OfficeRoomState>): void {
    const $ = getStateCallbacks(target) as unknown as {
      (state: OfficeRoomState): { players: PlayersCallbacks; recordings: RecordingsCallbacks };
      (player: RemotePlayer): PlayerCallbacks;
    };

    $(target.state).players.onAdd((player, sessionId) => {
      handlers.onAdd(toSnapshot(sessionId, player));
      // La suscripcion por jugador se registra dentro del alta: `onChange` a
      // nivel de mapa solo avisa de altas y bajas, no de campos que mutan.
      $(player).onChange(() => handlers.onChange(toSnapshot(sessionId, player)));
    });

    $(target.state).players.onRemove((_player, sessionId) => {
      handlers.onRemove(sessionId);
    });

    // Recordings (#5). A fresh map per wired room, and nothing is reported
    // until that room's first state sync: after a reconnect the replay adds
    // entries one by one, and reporting halfway would flash "stopped" for a
    // recording that never stopped. The first sync also covers one that DID
    // stop during the outage, since it is simply absent from the new map.
    const recordings: Record<string, ActiveRecordingSnapshot> = {};
    let synced = false;
    const reportRecordings = () => {
      if (synced) handlers.onRecordings?.({ ...recordings });
    };
    $(target.state).recordings.onAdd((recording, spaceId) => {
      recordings[spaceId] = { startedBy: recording.startedBy, startedAt: recording.startedAt };
      reportRecordings();
    });
    $(target.state).recordings.onRemove((_recording, spaceId) => {
      delete recordings[spaceId];
      reportRecordings();
    });
    target.onStateChange.once(() => {
      synced = true;
      reportRecordings();
    });

    // Mensajes sueltos del servidor (issue #2), no estado sincronizado: no hay
    // `players.onChange` que los cubra porque no describen a nadie del mapa,
    // describen un evento puntual.
    target.onMessage('callinvite', (payload: { from: string; name: string }) => {
      handlers.onCallInvite?.(payload);
    });
    target.onMessage('callerleft', (payload: { from: string }) => {
      handlers.onCallerLeft?.(payload);
    });
    target.onMessage('callaccepted', (payload: { by: string; name: string }) => {
      handlers.onCallAccepted?.(payload);
    });
    target.onMessage('recordingready', (payload: RecordingReadyPayload) => {
      handlers.onRecordingReady?.(payload);
    });

    // No dispara el reintento -- de eso se encarga `onLeave`, que es el unico
    // que sabe si la sala se murio -- pero tragarselo en silencio es
    // exactamente lo que hizo invisible la issue #52 durante semanas: el
    // cliente tenia el motivo del fallo y no lo decia en ningun sitio.
    target.onError((code, message) => {
      console.warn(`[office] error de sala (${code}): ${message ?? 'sin mensaje'}`);
    });

    target.onLeave((code) => {
      // El token se lee de la sala que MUERE y lo primero de todo: es lo unico
      // que sobrevive a su cierre, y la variable `room` puede apuntar a otra
      // antes de que el temporizador venza.
      handleLeave(code, target.reconnectionToken);
    });
  }

  /** Programa el siguiente escalon, o declara la sesion perdida si no queda. */
  function handleLeave(closeCode: number, reconnectionToken: string): void {
    if (disposed) return;

    // El codigo de cierre es la unica pista que queda de POR QUE se cayo, y se
    // pierde en el instante en que este manejador vuelve. La issue #52 explica
    // la consecuencia de la caida pero no su causa, y sin este registro la
    // proxima vez que ocurra volveria a no haber nada que mirar.
    //
    // Que buscar: 1006 es un cierre abrupto SIN trama de cierre, y es ambiguo
    // por si solo -- lo produce tanto un transporte que se muere (wifi, NAT,
    // el multiplexor del 443) como el propio servidor matando a un cliente que
    // dejo de responder a los pings, porque `autoTerminateUnresponsiveClients`
    // llama a `terminate()`. Quien deshace ese empate es el servidor: con
    // `DEBUG=colyseus:connection` registra "terminating unresponsive client"
    // solo en el segundo caso. 1001 es la pestana yendose, y 4002 un error del
    // lado del servidor. 4100 is this account joining from another tab (#78).
    console.warn(`[office] sesion cerrada (${closeCode}); intento ${attempt}`);

    const decision = decideReconnect({ closeCode, attempt });
    if (decision.kind === 'stop' && decision.reason === 'replaced') {
      handlers.onConnectionState?.('replaced');
      return;
    }
    if (decision.kind !== 'retry') {
      // Tanto la salida voluntaria como la rendicion acaban aqui: para quien
      // escucha, las dos significan "ya no hay sesion". La diferencia la nota
      // en `canRetry`, que la decide la escena, no este modulo.
      handlers.onConnectionState?.('offline');
      return;
    }

    // Se avisa YA, no al vencer el retardo: durante esos segundos el HUD
    // seguiria anunciando "en línea" a alguien que no lo esta, que es
    // literalmente el sintoma que esta issue viene a quitar.
    handlers.onConnectionState?.('reconnecting');
    retryTimer = setTimeout(() => {
      void reconnect(closeCode, reconnectionToken);
    }, decision.delayMs);
  }

  async function reconnect(closeCode: number, reconnectionToken: string): Promise<void> {
    retryTimer = undefined;
    if (disposed) return;

    try {
      const recovered = (await client.reconnect(reconnectionToken)) as Room<OfficeRoomState>;
      // La escena pudo apagarse mientras el reconnect estaba en vuelo; misma
      // guarda y misma razon que en `OfficeScene.connectToOffice`.
      if (disposed) {
        void recovered.leave();
        return;
      }

      room = recovered;
      attempt = 0;
      // El resync va ANTES de cablear la sala nueva, y el orden no es
      // cosmetico: `players.onAdd` de `@colyseus/schema` puede reproducir de
      // golpe lo que ya venga decodificado en el estado. Avisando primero,
      // quien escuche vacia lo viejo y el replay entra sobre limpio; al reves,
      // vaciaria justo DESPUES de haber repoblado y el avatar del otro no
      // volveria a aparecer -- el sintoma de la issue, movido de sitio.
      handlers.onResync?.();
      registerRoom(recovered);
      // Y "conectado" va el ultimo, cuando ya hay por donde escuchar.
      handlers.onConnectionState?.('connected');
    } catch {
      if (disposed) return;
      // Un intento fallido gasta escalon, no la escalera: se sigue con el
      // MISMO token, que es el que el servidor tiene reservado -- la sala
      // muerta no va a emitir otro.
      attempt++;
      handleLeave(closeCode, reconnectionToken);
    }
  }

  registerRoom(room);

  const throttle = createMoveThrottle({
    intervalMs: moveIntervalMs,
    send: (move) => room.send('move', move),
  });

  /**
   * Cerrar la pestana es una salida PEDIDA, y hay que decirlo antes de irse.
   *
   * El servidor no puede distinguirlo por su cuenta: una pestana que se cierra
   * y una red que se muere llegan las dos como un socket cerrado sin la trama
   * consentida, y desde que existe la ventana de reconexion eso significa
   * guardar el asiento 30 s. Sin este aviso, cerrar la pestana dejaria el
   * avatar plantado en la oficina de los demas todo ese rato -- que es el
   * fantasma que la propia issue #52 nombraba como el precio de una ventana
   * larga. Aqui no se paga porque la salida limpia se anuncia.
   *
   * `room.leave()` manda la trama de forma sincrona sobre un socket que aun
   * esta abierto, que es lo unico que se puede confiar en que salga mientras
   * la pagina se desmonta; la promesa que devuelve no se espera porque ya no
   * hay nadie para recibirla.
   */
  const stopPageHide = onPageHide(() => {
    disposed = true;
    if (retryTimer !== undefined) clearTimeout(retryTimer);
    retryTimer = undefined;
    throttle.dispose();
    void room.leave();
  });

  return {
    // Se fija al entrar y no se relee: Colyseus conserva el `sessionId` a
    // traves de una reconexion (no repite `onJoin`), asi que la sala nueva
    // devuelve el mismo valor.
    sessionId: room.sessionId,
    sendMove(x, y, facing) {
      throttle.push({ x, y, facing });
    },
    // Sin agrupar, al contrario que `sendMove`: cambiar de estado es un gesto
    // humano y raro, y agrupar podria tragarse justo el que aisla a alguien.
    sendStatus(next) {
      room.send('status', { status: next });
    },
    sendSpacesVersion(version) {
      room.send('spacesversion', { version });
    },
    sendCall(to) {
      room.send('call', { to });
    },
    sendCallRespond(from, accept) {
      room.send('callrespond', { from, accept });
    },
    async leave() {
      // El orden importa: marcar primero es lo que hace que el `onLeave` que
      // este mismo `room.leave()` provoca no se lea como una caida, y que un
      // reintento ya programado muera en vez de resucitar la sesion.
      disposed = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      retryTimer = undefined;
      stopPageHide();
      throttle.dispose();
      await room.leave();
    },
  };
}
