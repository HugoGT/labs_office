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
 */

export interface LiveSessionRegistry {
  add(id: string, uid?: string): void;
  remove(id: string): void;
  has(id: string): boolean;
  /** uid del dueno, o `undefined` si la sesion no existe o entro sin auth. */
  uidOf(id: string): string | undefined;
  size(): number;
}

export function createLiveSessionRegistry(): LiveSessionRegistry {
  // Un solo Map en vez de Set + Map: dos estructuras podrian desincronizarse y
  // dejar un uid huerfano apuntando a una sesion ya cerrada. `undefined` como
  // valor significa "presente, sin dueno", que es el modo sin auth.
  const sessions = new Map<string, string | undefined>();

  return {
    add(id, uid) {
      sessions.set(id, uid);
    },
    remove(id) {
      sessions.delete(id);
    },
    has(id) {
      return sessions.has(id);
    },
    uidOf(id) {
      return sessions.get(id);
    },
    size() {
      return sessions.size;
    },
  };
}
