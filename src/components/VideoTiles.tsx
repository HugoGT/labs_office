import { useEffect, useRef, useState } from 'react';
import type { OfficeBridge } from '../game/officeBridge';
import { VideoTile } from './VideoTile';
import styles from './VideoTiles.module.css';

export interface VideoTilesProps {
  bridge: OfficeBridge;
}

/**
 * Overlay de tiles de conversacion (issue #17, PR3a): un contenedor plano
 * unico con un hijo por sessionId audible, `key={sessionId}` (D5) -- lo que
 * en PR4 garantizara que anclado<->fila sea un cambio de estilo, nunca un
 * remonte que se llevaria un `<video>` real por delante.
 *
 * Existencia/contenido son discretos (React, via "voice"/"portraits");
 * posicion es continua y SALTA React por completo (D4): un unico
 * `requestAnimationFrame` lee `bridge.anchors.snapshot()` y escribe
 * `transform`/`visibility` directo a los nodos. Cero `setState` por cuadro.
 */
export function VideoTiles({ bridge }: VideoTilesProps) {
  const [peerIds, setPeerIds] = useState<string[]>([]);
  const [portraits, setPortraits] = useState<Record<string, string> | null>(null);
  const nodesRef = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    const unsubscribeVoice = bridge.on('voice', (payload) => setPeerIds(payload.sessionIds));
    // Un solo emisor durante toda la sesion (D1): no hace falta desuscribirse
    // para volver a escuchar, solo quedarse con el ultimo valor recibido.
    const unsubscribePortraits = bridge.on('portraits', (payload) => setPortraits(payload.byKey));

    return () => {
      unsubscribeVoice();
      unsubscribePortraits();
    };
  }, [bridge]);

  useEffect(() => {
    // jsdom no implementa `requestAnimationFrame` (confirmado): el bucle solo
    // arranca donde de verdad existe, para que montar este componente bajo
    // los tests de `OfficeShell` no explote.
    if (typeof requestAnimationFrame !== 'function') return undefined;

    let frameId: number;
    let lastGeneration = -1;

    function tick(): void {
      const frame = bridge.anchors.snapshot();
      if (frame.generation !== lastGeneration) {
        lastGeneration = frame.generation;
        for (const [sessionId, node] of nodesRef.current) {
          const anchor = frame.anchors.get(sessionId);
          if (anchor) {
            node.style.transform = `translate(${anchor.x}px, ${anchor.y}px)`;
            node.style.visibility = anchor.onScreen ? 'visible' : 'hidden';
          } else {
            // Sin ancla este cuadro (aun no reportada, o podada): oculto,
            // nunca desmontado (D4/D5).
            node.style.visibility = 'hidden';
          }
        }
      }
      frameId = requestAnimationFrame(tick);
    }

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [bridge]);

  function registerNode(sessionId: string) {
    return (node: HTMLDivElement | null) => {
      if (node) nodesRef.current.set(sessionId, node);
      else nodesRef.current.delete(sessionId);
    };
  }

  return (
    <div className={styles.overlay}>
      {peerIds.map((sessionId) => (
        <div
          key={sessionId}
          ref={registerNode(sessionId)}
          className={styles.tile}
          data-mode="anchored"
          data-session-id={sessionId}
        >
          <VideoTile sessionId={sessionId} portraits={portraits} />
        </div>
      ))}
    </div>
  );
}
