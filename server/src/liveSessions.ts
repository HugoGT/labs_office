/**
 * Registro de sesiones Colyseus vivas: quien esta conectado ahora mismo
 * (D4). `createOfficeServer.ts` construye una unica instancia y la inyecta
 * en `OfficeRoom` via `gameServer.define(name, Room, { sessions })`, nunca
 * como singleton de modulo (evita tests que dependan del orden de ejecucion).
 *
 * Lo que este registro demuestra: que el sessionId esta conectado ahora.
 * Lo que NO demuestra: que quien lo pide es el dueno de esa conexion — ver
 * `livekitToken.ts` para el limite exacto de esta guarda.
 */

export interface LiveSessionRegistry {
  add(id: string): void;
  remove(id: string): void;
  has(id: string): boolean;
  size(): number;
}

export function createLiveSessionRegistry(): LiveSessionRegistry {
  const sessions = new Set<string>();

  return {
    add(id) {
      sessions.add(id);
    },
    remove(id) {
      sessions.delete(id);
    },
    has(id) {
      return sessions.has(id);
    },
    size() {
      return sessions.size;
    },
  };
}
