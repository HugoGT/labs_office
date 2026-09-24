/**
 * Registro de sesiones Colyseus vivas: quien esta conectado ahora mismo
 * (D4). `createOfficeServer.ts` construye una unica instancia y la inyecta
 * en `OfficeRoom` via `gameServer.define(name, Room, { sessions })`, nunca
 * como singleton de modulo (evita tests que dependan del orden de ejecucion).
 *
 * Desde #8 guarda tambien QUIEN es el dueno de cada sesion: el uid del ID token
 * que `OfficeRoom.onAuth` verifico al entrar. Eso cierra exactamente el hueco
 * que esta cabecera admitia antes: con un uid presente, el registro si
 * demuestra la propiedad de la conexion, y `POST /livekit/token` puede exigir
 * que quien pide el token sea el dueno del `sessionId` y no cualquiera que lo
 * haya leido del estado de la sala.
 *
 * El uid es opcional porque la autenticacion tambien lo es: sin
 * `FIREBASE_PROJECT_ID` (ver `authConfig.ts`) las sesiones entran sin dueno y
 * `uidOf` devuelve `undefined`. En ese modo el registro vuelve a demostrar solo
 * que el sessionId esta conectado ahora; ver `livekitToken.ts` para el limite
 * exacto que queda abierto incluso con auth activa.
 *
 * Desde #10/#12 guarda tambien DONDE esta cada sesion: la ultima posicion en
 * pixeles que `OfficeRoom` acepto (tras el `clamp` del manejador de `move`, o
 * la de spawn en `onJoin`). Es lo que permite a `POST /livekit/token` verificar
 * que quien pide un token de un espacio esta REALMENTE dentro de el, en vez de
 * confiar en el `spaceId` que manda el cliente (ver `spaceMembership.ts`).
 */

export interface SessionPosition {
  x: number;
  y: number;
}

/** Valor interno por sesion: dueno opcional + posicion opcional, nunca dos mapas. */
interface SessionEntry {
  uid?: string;
  pos?: SessionPosition;
}

export interface LiveSessionRegistry {
  add(id: string, uid?: string): void;
  remove(id: string): void;
  has(id: string): boolean;
  /** uid del dueno, o `undefined` si la sesion no existe o entro sin auth. */
  uidOf(id: string): string | undefined;
  /**
   * Fija la posicion vigente de una sesion. No-op sobre un id desconocido: un
   * `move` tardio de una sesion que ya se fue no debe resucitarla en el
   * registro (D4).
   */
  moveTo(id: string, x: number, y: number): void;
  /** Ultima posicion conocida, o `undefined` si la sesion no existe o aun no se ha movido. */
  positionOf(id: string): SessionPosition | undefined;
  /** Every live session id; used to find who is inside a space (#58). */
  ids(): string[];
  size(): number;
}

export function createLiveSessionRegistry(): LiveSessionRegistry {
  // Un solo Map en vez de uno por campo: dos estructuras podrian
  // desincronizarse y dejar un uid o una posicion huerfanos apuntando a una
  // sesion ya cerrada. Cada entrada es su propio objeto para poder mutar la
  // posicion sin reconstruir el uid, que casi nunca cambia.
  const sessions = new Map<string, SessionEntry>();

  return {
    add(id, uid) {
      sessions.set(id, { uid });
    },
    remove(id) {
      sessions.delete(id);
    },
    has(id) {
      return sessions.has(id);
    },
    uidOf(id) {
      return sessions.get(id)?.uid;
    },
    moveTo(id, x, y) {
      const entry = sessions.get(id);
      if (!entry) return;
      entry.pos = { x, y };
    },
    positionOf(id) {
      return sessions.get(id)?.pos;
    },
    ids() {
      return [...sessions.keys()];
    },
    size() {
      return sessions.size;
    },
  };
}
