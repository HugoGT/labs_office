import { useEffect, useRef, useState } from 'react';
import type { AttachableTrack } from '../game/attachableTrack';
import type { OfficeBridge, OfficeEventMap } from '../game/officeBridge';
import { VideoTile } from './VideoTile';
import styles from './VideoTiles.module.css';

export interface VideoTilesProps {
  bridge: OfficeBridge;
  /** Video de peers suscritos, indexado por sessionId (issue #17, D3). */
  videoTracks: ReadonlyMap<string, AttachableTrack>;
  /** Identidades hablando ahora mismo, segun `RoomEvent.ActiveSpeakersChanged` (D7). */
  speakers: ReadonlySet<string>;
  /** Camara propia, o `null` si esta apagada/no publicada (D8: ungated). */
  localVideoTrack: AttachableTrack | null;
}

const INITIAL_VOICE: OfficeEventMap['voice'] = {
  selfSessionId: null,
  selfName: '',
  peers: [],
  room: null,
};

/**
 * Overlay de tiles de conversacion (issue #17): un contenedor plano unico con
 * un hijo por sessionId -- el propio y cada par audible --, `key={sessionId}`
 * (D5) -- lo que en PR4 garantizara que anclado<->fila sea un cambio de
 * estilo, nunca un remonte que se llevaria un `<video>` real por delante.
 *
 * Existencia/contenido son discretos (React, via "voice"/"portraits");
 * posicion es continua y SALTA React por completo (D4): un unico
 * `requestAnimationFrame` lee `bridge.anchors.snapshot()` y escribe
 * `transform`/`visibility` directo a los nodos. Cero `setState` por cuadro.
 *
 * El self-tile pasa por el MISMO canal de anclas que un par (decision F,
 * textual del mantenedor: "Tu propio recuadro cuelga de tu avatar igual que
 * el de los demas") -- `OfficeScene.publishAnchors()` proyecta tambien la
 * posicion del jugador local, con la identica formula de camara, asi que el
 * self-tile se registra en `nodesRef` igual que cualquier tile de par y
 * queda sujeto a la misma regla "sin ancla este cuadro -> oculto, nunca
 * desmontado" (D4/D5). Lo unico que lo distingue de un par es el origen de
 * sus props (nombre/pista propios en vez de los de un par) y que su video
 * nunca pasa por el gate de sala (D8): la posicion es identica en ambos.
 */
export function VideoTiles({ bridge, videoTracks, speakers, localVideoTrack }: VideoTilesProps) {
  const [voice, setVoice] = useState<OfficeEventMap['voice']>(INITIAL_VOICE);
  const [portraits, setPortraits] = useState<Record<string, string> | null>(null);
  const nodesRef = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    const unsubscribeVoice = bridge.on('voice', setVoice);
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
      {voice.selfSessionId !== null && (
        <div
          key={voice.selfSessionId}
          ref={registerNode(voice.selfSessionId)}
          className={styles.tile}
          data-mode="self"
          data-session-id={voice.selfSessionId}
        >
          <VideoTile
            sessionId={voice.selfSessionId}
            name={voice.selfName}
            portraits={portraits}
            track={localVideoTrack}
            speaking={speakers.has(voice.selfSessionId)}
          />
        </div>
      )}
      {voice.peers.map((peer) => (
        <div
          key={peer.sessionId}
          ref={registerNode(peer.sessionId)}
          className={styles.tile}
          data-mode="anchored"
          data-session-id={peer.sessionId}
        >
          <VideoTile
            sessionId={peer.sessionId}
            name={peer.name}
            portraits={portraits}
            // Gate de video de PARES (D8, decision G): solo dentro de una
            // sala compartida. El self-tile de arriba NUNCA pasa por esta
            // regla -- la propia camara no cuesta downlink alguno.
            track={voice.room !== null ? (videoTracks.get(peer.sessionId) ?? null) : null}
            speaking={speakers.has(peer.sessionId)}
          />
        </div>
      ))}
    </div>
  );
}
