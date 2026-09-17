import { avatarKeyFor } from '../game/remoteAvatars';
import styles from './VideoTiles.module.css';

export interface VideoTileProps {
  sessionId: string;
  /**
   * `null` mientras el evento "portraits" del bridge aun no llego (D1): un
   * `undefined` en la clave concreta cae en el mismo placeholder. Ninguno de
   * los dos casos intenta pintar una `src` vacia (imagen rota).
   */
  portraits: Record<string, string> | null;
}

/**
 * Contenido de un tile de conversacion, solo-retrato en este slice (issue
 * #17, PR3a): el `<video>` real llega en PR3b. El retrato es el mismo mapa
 * de bits que ya pinta el avatar en el canvas -- exportado una vez por
 * `scene.textures.getBase64` (D1) -- resuelto por la misma
 * `avatarKeyFor(sessionId)` determinista que usa el canvas, nunca redibujado.
 */
export function VideoTile({ sessionId, portraits }: VideoTileProps) {
  const dataUrl = portraits?.[avatarKeyFor(sessionId)];

  return (
    <div className={styles.content}>
      {dataUrl ? (
        <img className={styles.portrait} src={dataUrl} alt={`Retrato de ${sessionId}`} />
      ) : (
        <div className={styles.placeholder} aria-hidden="true" />
      )}
    </div>
  );
}
