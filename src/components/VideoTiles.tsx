import { useEffect, useState } from 'react';
import type { AttachableTrack } from '../game/attachableTrack';
import type { OfficeBridge, OfficeEventMap } from '../game/officeBridge';
import { selectScreenShareStage } from '../game/screenShare';
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
  /** Subscribed peer screen shares, keyed by sessionId (#20): never mixed with `videoTracks`. */
  screenShareTracks: ReadonlyMap<string, AttachableTrack>;
  /** Own screen share, or `null` when not sharing. */
  localScreenShareTrack: AttachableTrack | null;
  /** SessionId holding the single share slot of the space, or `null` (#20). */
  activeScreenSharer: string | null;
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
export function VideoTiles({
  bridge,
  videoTracks,
  speakers,
  localVideoTrack,
  screenShareTracks,
  localScreenShareTrack,
  activeScreenSharer,
}: VideoTilesProps) {
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

  /**
   * La barra entera -- self-tile incluido -- solo existe con compania
   * audible real: a solas no hay con quien hablar por video, y una camara
   * propia flotando sin nadie enfrente no informa nada. Distinto del gate de
   * SALA que el self-tile nunca pasa (D8): esto es presencia de pares, no
   * pertenencia a una sala.
   */
  const hasCompany = voice.peers.length > 0;

  const entries: TileEntry[] = [];
  if (hasCompany) {
    if (voice.selfSessionId !== null) {
      // El self-tile NUNCA pasa por el gate de sala (D8, decision G): la propia
      // camara no cuesta downlink alguno.
      entries.push({ sessionId: voice.selfSessionId, name: voice.selfName, track: localVideoTrack });
    }
    for (const peer of voice.peers) {
      entries.push({
        sessionId: peer.sessionId,
        name: peer.name,
        // No room gate (#75): the subscription already follows proximity.
        track: videoTracks.get(peer.sessionId) ?? null,
      });
    }
  }

  const stage = selectScreenShareStage({
    activeSharer: activeScreenSharer,
    selfSessionId: voice.selfSessionId,
    localTrack: localScreenShareTrack,
    // Screen share stays space-only: the open floor never shares (#20).
    remoteTracks: voice.spaceId !== null ? screenShareTracks : new Map(),
  });
  const stageOwner = stage && entries.find((entry) => entry.sessionId === stage.sessionId);
  const stageLabel =
    stage?.sessionId === voice.selfSessionId
      ? 'Tu pantalla'
      : stageOwner
        ? `Pantalla de ${stageOwner.name}`
        : 'Pantalla compartida';

  // Stage layout (#20), like Google Meet: while a share is up it takes the
  // big stage and the tiles move to a column on the left. The stage comes
  // BEFORE the bar in the same position whether it exists or not, and the
  // bar only changes its `data-layout`, so opening or closing the stage never
  // remounts a tile (and the `<video>` hanging from it). The stage is keyed
  // by (participant, source): a new sharer gets a fresh element.
  return (
    <>
      {stage && (
        <div
          key={`${stage.sessionId}:screen_share`}
          className={styles.stage}
          data-testid="screen-share-stage"
          data-session-id={stage.sessionId}
        >
          <VideoTile
            sessionId={stage.sessionId}
            name={stageLabel}
            portraits={portraits}
            track={stage.track}
            speaking={false}
            fit="contain"
          />
        </div>
      )}
      {entries.length > 0 && (
        <div className={styles.bar} data-layout={stage ? 'column' : 'row'} data-testid="video-tile-bar">
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
      )}
    </>
  );
}
