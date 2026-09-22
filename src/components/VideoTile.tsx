import { useEffect, useRef } from 'react';
import type { AttachableTrack } from '../game/attachableTrack';
import { avatarKeyFor } from '../game/remoteAvatars';
import styles from './VideoTiles.module.css';

export interface VideoTileProps {
  sessionId: string;
  /** Nombre a mostrar en la etiqueta, esquina inferior izquierda (issue #17). */
  name: string;
  /**
   * `null` mientras el evento "portraits" del bridge aun no llego (D1): un
   * `undefined` en la clave concreta cae en el mismo placeholder. Ninguno de
   * los dos casos intenta pintar una `src` vacia (imagen rota).
   */
  portraits: Record<string, string> | null;
  /**
   * Pista de video ya suscrita/adjuntable, o `null` si no hay camara que
   * mostrar (issue #17, D3). La TILE es la unica dueña de adjuntar/desvincular
   * este `<video>` -- `livekitRoom.ts` solo la reporta hacia afuera, nunca la
   * adjunta ella misma, para que nunca haya dos dueños de un mismo elemento.
   */
  track: AttachableTrack | null;
  /** Habla real reportada por `RoomEvent.ActiveSpeakersChanged` (D7): binario, nunca un nivel. */
  speaking: boolean;
}

/**
 * Tamaño fuente del retrato: el PNG que exporta `textures.ts` mide 16x20, y
 * se pinta a una escala ENTERA fija (nunca estirado al tamaño del tile). Con
 * `object-fit: cover` el personaje se escalaba x4.5 y ademas se recortaba,
 * de modo que ocupaba el tile entero y cambiaba de tamaño con el.
 */
export const PORTRAIT_SOURCE_WIDTH = 16;
export const PORTRAIT_SOURCE_HEIGHT = 20;
export const PORTRAIT_SCALE = 3;

/**
 * Contenido de un tile de conversacion (issue #17, PR3b): video real cuando
 * hay una pista adjuntable, retrato fiel en caso contrario -- el mismo mapa
 * de bits que ya pinta el avatar en el canvas (D1). Nombre y borde de habla
 * se muestran en ambos estados, sin salto de layout entre ellos.
 */
export function VideoTile({ sessionId, name, portraits, track, speaking }: VideoTileProps) {
  const videoHostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!track) return undefined;
    const host = videoHostRef.current;
    if (!host) return undefined;

    const element = track.attach();
    element.autoplay = true;
    element.className = styles.video;
    host.appendChild(element);

    return () => {
      // Igual que `remoteAudioSink.ts`: `detach()` desvincula la pista de sus
      // elementos pero no los saca del documento -- retirarlos es tarea de
      // quien adjunto, y aqui esa dueña es la tile, nunca un sink aparte.
      for (const detached of track.detach()) detached.remove();
      element.remove();
    };
  }, [track]);

  const dataUrl = portraits?.[avatarKeyFor(sessionId)];

  return (
    <div className={styles.content} data-speaking={speaking}>
      {track ? (
        <div className={styles.videoHost} ref={videoHostRef} />
      ) : dataUrl ? (
        <img
          className={styles.portrait}
          src={dataUrl}
          alt={`Retrato de ${sessionId}`}
          width={PORTRAIT_SOURCE_WIDTH * PORTRAIT_SCALE}
          height={PORTRAIT_SOURCE_HEIGHT * PORTRAIT_SCALE}
        />
      ) : (
        <div className={styles.placeholder} aria-hidden="true" />
      )}
      <span className={styles.name} data-testid="tile-name" data-position="bottom-left">
        {name}
      </span>
    </div>
  );
}
