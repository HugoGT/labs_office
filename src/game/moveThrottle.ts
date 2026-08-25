/**
 * Regula la frecuencia con que el jugador local publica su posicion.
 *
 * Sin esto, `update()` de Phaser enviaria un mensaje por frame: 60 por segundo
 * y por cliente, para mover un avatar que nadie percibe a esa resolucion. El
 * agrupado emite el primero al instante (para que arrancar a andar se vea sin
 * retardo) y luego a lo sumo uno por intervalo, siempre el ultimo estado.
 *
 * Puro respecto a Phaser y a la red: recibe un `send` y usa temporizadores del
 * entorno, asi que se prueba en jsdom con reloj falso.
 */

export interface Move {
  x: number;
  y: number;
  facing: string;
}

export interface MoveThrottleOptions {
  intervalMs: number;
  send: (move: Move) => void;
}

export interface MoveThrottle {
  push(move: Move): void;
  dispose(): void;
}

function sameMove(a: Move | null, b: Move): boolean {
  return a !== null && a.x === b.x && a.y === b.y && a.facing === b.facing;
}

export function createMoveThrottle({ intervalMs, send }: MoveThrottleOptions): MoveThrottle {
  let lastSent: Move | null = null;
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let pending: Move | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function flush(): void {
    timer = undefined;
    if (pending === null) return;
    const move = pending;
    pending = null;
    // Se revalida aqui y no solo en `push`: la rafaga pudo volver al punto de
    // partida, y entonces el envio diferido no aporta nada.
    if (sameMove(lastSent, move)) return;
    lastSent = move;
    lastSentAt = Date.now();
    send(move);
  }

  return {
    push(move) {
      // Un jugador quieto es el caso mas comun en una oficina: comparar antes
      // de encolar evita trafico constante que no cambia nada.
      if (sameMove(lastSent, move)) {
        // Y ademas hay que soltar el pendiente. Si una rafaga se alejo y volvio
        // al punto ya publicado, el pendiente guarda una posicion que el
        // jugador ya abandono: dejarlo ahi la publicaria al vencer el plazo y
        // los demas verian el avatar en un sitio donde no esta.
        pending = null;
        return;
      }

      pending = move;
      const elapsed = Date.now() - lastSentAt;
      if (elapsed >= intervalMs) {
        if (timer !== undefined) clearTimeout(timer);
        flush();
        return;
      }
      if (timer === undefined) timer = setTimeout(flush, intervalMs - elapsed);
    },
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      pending = null;
    },
  };
}
