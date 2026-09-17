/**
 * Canal continuo posicion-por-cuadro entre Phaser y React (issue #17, D4).
 * A proposito NO es un `EventTarget`: React nunca actua sobre `setState` ni
 * un `CustomEvent` por cuadro -- lee `snapshot()` desde un unico bucle
 * `requestAnimationFrame` y escribe `transform` directo al DOM. Es lo unico
 * continuo en un puente que hoy es 100% eventos discretos (`officeBridge.ts`).
 *
 * La guarda de epoca es la pieza no obvia: `open()` invalida al escritor
 * anterior de forma INCONDICIONAL, sin depender de que su `close()` se haya
 * ejecutado antes. React StrictMode remonta dos veces en desarrollo y
 * `GameCanvas` hace un `destroy(true)` duro al desmontar (`GameCanvas.tsx`) --
 * el orden de apagado nunca es una suposicion segura. Con la epoca, una
 * escena zombi queda ESTRUCTURALMENTE incapaz de corromper el cuadro vivo.
 *
 * Las entradas se mutan en el sitio: cero asignaciones por cuadro para el
 * caso comun (un id que ya existia solo actualiza sus campos).
 */

export interface ScreenAnchor {
  x: number;
  y: number;
  onScreen: boolean;
}

export interface AnchorFrame {
  /** Monotonico. El bucle de rAF no hace nada si no avanzo desde el ultimo cuadro leido. */
  readonly generation: number;
  readonly anchors: ReadonlyMap<string, ScreenAnchor>;
}

export interface AnchorWriter {
  set(sessionId: string, x: number, y: number, onScreen: boolean): void;
  /** Poda los ids no fijados en este cuadro y avanza `generation`. */
  commit(): void;
  close(): void;
}

export interface AnchorChannel {
  /** Invalida cualquier escritor anterior. Sus llamadas pasan a ser no-ops silenciosos. */
  open(): AnchorWriter;
  snapshot(): AnchorFrame;
}

export function createAnchorChannel(): AnchorChannel {
  let currentEpoch = 0;
  let generation = 0;
  const anchors = new Map<string, ScreenAnchor>();

  return {
    open(): AnchorWriter {
      // Incondicional a proposito: invalida a quien sea que estuviera
      // vigente, haya llamado `close()` o no.
      currentEpoch += 1;
      const epoch = currentEpoch;
      const touchedThisFrame = new Set<string>();

      return {
        set(sessionId, x, y, onScreen) {
          if (epoch !== currentEpoch) return;
          const existing = anchors.get(sessionId);
          if (existing) {
            existing.x = x;
            existing.y = y;
            existing.onScreen = onScreen;
          } else {
            anchors.set(sessionId, { x, y, onScreen });
          }
          touchedThisFrame.add(sessionId);
        },
        commit() {
          if (epoch !== currentEpoch) return;
          for (const sessionId of anchors.keys()) {
            if (!touchedThisFrame.has(sessionId)) anchors.delete(sessionId);
          }
          touchedThisFrame.clear();
          generation += 1;
        },
        close() {
          // Condicional: si un `open()` posterior ya avanzo la epoca, este
          // cierre tardio no debe volver a adelantarla e invalidar al
          // escritor nuevo que ya esta vigente.
          if (epoch === currentEpoch) currentEpoch += 1;
        },
      };
    },
    snapshot(): AnchorFrame {
      return { generation, anchors };
    },
  };
}
