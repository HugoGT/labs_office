/**
 * Registro puro de invitaciones de llamada entre pares (issue #2). Sin
 * Colyseus, sin temporizador (D6): una entrada solo muere por una respuesta
 * (`remove`) o por la baja de una de las dos partes (`removeAllFor`, D7). Se
 * crea directamente en `OfficeRoom.onCreate`, no se inyecta: es estado propio
 * de la sala, igual que `this.state`, y no algo compartido entre salas como
 * `LiveSessionRegistry` (D4).
 *
 * Clave `(to, from)` (D5): las tarjetas se apilan por EMISOR distinto, no por
 * invitacion. Una segunda llamada del mismo emisor al mismo destinatario es
 * un no-op deliberado -- ver `add()`.
 */

export interface PendingCall {
  from: string;
  to: string;
}

export interface CallInvitationRegistry {
  /** false cuando ese emisor ya tenia una tarjeta pendiente en ese destinatario (D5). */
  add(from: string, to: string): boolean;
  has(from: string, to: string): boolean;
  /** false cuando no habia nada pendiente: asi se rechazan respuestas forjadas o tardias. */
  remove(from: string, to: string): boolean;
  /** Cada entrada donde sessionId es emisor O destinatario, en orden de llegada (D7). */
  removeAllFor(sessionId: string): PendingCall[];
  /** Emisores pendientes sobre este destinatario, en orden de llegada. */
  pendingFor(to: string): readonly string[];
}

/** Combina las dos partes en una clave unica de mapa; nunca sale del modulo. */
function keyOf(from: string, to: string): string {
  return `${from}\u0000${to}`;
}

export function createCallInvitationRegistry(): CallInvitationRegistry {
  // Un unico array como fuente de verdad del orden de llegada (D7 lo exige
  // para `removeAllFor` y para `pendingFor`), mas un Set de claves para que
  // `has`/`add` no tengan que recorrerlo entero en cada llamada.
  const order: PendingCall[] = [];
  const keys = new Set<string>();

  return {
    add(from, to) {
      const key = keyOf(from, to);
      if (keys.has(key)) return false;
      keys.add(key);
      order.push({ from, to });
      return true;
    },
    has(from, to) {
      return keys.has(keyOf(from, to));
    },
    remove(from, to) {
      const key = keyOf(from, to);
      if (!keys.has(key)) return false;
      keys.delete(key);
      const index = order.findIndex((entry) => entry.from === from && entry.to === to);
      order.splice(index, 1);
      return true;
    },
    removeAllFor(sessionId) {
      const removed: PendingCall[] = [];
      for (let i = order.length - 1; i >= 0; i--) {
        const entry = order[i];
        if (entry.from !== sessionId && entry.to !== sessionId) continue;
        keys.delete(keyOf(entry.from, entry.to));
        order.splice(i, 1);
        removed.unshift(entry);
      }
      return removed;
    },
    pendingFor(to) {
      return order.filter((entry) => entry.to === to).map((entry) => entry.from);
    },
  };
}
