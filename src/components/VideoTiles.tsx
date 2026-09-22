import { useEffect, useState } from 'react';
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
  spaceId: null,
};

interface TileEntry {
  readonly sessionId: string;
  readonly name: string;
  readonly track: AttachableTrack | null;
}

/**
 * Barra de tiles de conversacion (issue #17): una fila fija arriba al centro
 * de la pantalla, con un tile por participante audible -- el propio primero y
 * cada par despues -- que se apila y se recentra sola segun cuantos haya.
 *
 * Deliberadamente NO sigue al avatar por el mundo: la posicion no depende de
 * la camara del juego ni de ningun bucle por cuadro, asi que aqui no hay
 * `requestAnimationFrame`, ni canal de anclas, ni escritura directa al DOM.
 * Existencia y contenido son discretos y los decide React desde dos eventos
 * del puente ("voice" y "portraits"); el resto es layout de CSS.
 *
 * `key={sessionId}` (D5) sigue siendo la invariante que importa: que un par
 * entre o salga reordena la fila, pero nunca remonta el tile de al lado -- un
 * remonte se llevaria por delante el `<video>` real que cuelga de el.
 */
export function VideoTiles({ bridge, videoTracks, speakers, localVideoTrack }: VideoTilesProps) {
  const [voice, setVoice] = useState<OfficeEventMap['voice']>(INITIAL_VOICE);
  const [portraits, setPortraits] = useState<Record<string, string> | null>(null);

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

  const entries: TileEntry[] = [];
  if (voice.selfSessionId !== null) {
    // El self-tile NUNCA pasa por el gate de sala (D8, decision G): la propia
    // camara no cuesta downlink alguno.
    entries.push({ sessionId: voice.selfSessionId, name: voice.selfName, track: localVideoTrack });
  }
  for (const peer of voice.peers) {
    entries.push({
      sessionId: peer.sessionId,
      name: peer.name,
      // Gate de video de PARES (D8): solo dentro de una sala compartida.
      track: voice.spaceId !== null ? (videoTracks.get(peer.sessionId) ?? null) : null,
    });
  }

  return (
    <div className={styles.bar} data-testid="video-tile-bar">
      {entries.map((entry) => (
        <div key={entry.sessionId} className={styles.tile} data-session-id={entry.sessionId}>
          <VideoTile
            sessionId={entry.sessionId}
            name={entry.name}
            portraits={portraits}
            track={entry.track}
            speaking={speakers.has(entry.sessionId)}
          />
        </div>
      ))}
    </div>
  );
}
