import { useEffect, useRef, useState } from 'react';
import type { AttachableTrack } from '../game/attachableTrack';
import { useEscapeStep } from '../hooks/useEscapeStep';
import type { OfficeBridge, OfficeEventMap } from '../game/officeBridge';
import { selectScreenShareStage } from '../game/screenShare';
import { selectVideoTiles, videoTileCapacity } from '../game/videoTileSelection';
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
  /** The share moved from the stage up to a thumbnail in the bar (#304). */
  stageMinimized: boolean;
  /** Escape on an open stage. It only moves the view: the share goes on. */
  onMinimizeStage: () => void;
  /** A click on the thumbnail. */
  onRestoreStage: () => void;
}

const INITIAL_VOICE: OfficeEventMap['voice'] = {
  selfSessionId: null,
  selfName: '',
  peers: [],
  spaceId: null,
};

function readViewport() {
  return { width: window.innerWidth, height: window.innerHeight };
}

/** "+N personas" for the people left without a tile (#280). */
function overflowLabel(hidden: number): string {
  return hidden === 1 ? '+1 persona' : `+${hidden} personas`;
}

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
 *
 * Crowded rooms (#280): only the tiles that fit the layout are rendered,
 * chosen by `selectVideoTiles` (cameras and speakers first, sticky slots),
 * plus a "+N personas" counter for the rest.
 */
export function VideoTiles({
  bridge,
  videoTracks,
  speakers,
  localVideoTrack,
  screenShareTracks,
  localScreenShareTrack,
  activeScreenSharer,
  stageMinimized,
  onMinimizeStage,
  onRestoreStage,
}: VideoTilesProps) {
  const [voice, setVoice] = useState<OfficeEventMap['voice']>(INITIAL_VOICE);
  const [portraits, setPortraits] = useState<Record<string, string> | null>(null);
  const [characterPortraits, setCharacterPortraits] = useState<Record<string, string> | null>(null);
  const [viewport, setViewport] = useState(readViewport);
  // Last committed selection: the next one starts from it so slots stay put (#280).
  const visibleRef = useRef<readonly string[]>([]);

  useEffect(() => {
    const onResize = () => setViewport(readViewport());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const unsubscribeVoice = bridge.on('voice', setVoice);
    // Un solo emisor durante toda la sesion (D1): no hace falta desuscribirse
    // para volver a escuchar, solo quedarse con el ultimo valor recibido.
    const unsubscribePortraits = bridge.on('portraits', (payload) => setPortraits(payload.byKey));
    // Unlike the procedural set, this one changes as sheets load and peers come and go (step 6).
    const unsubscribeCharacterPortraits = bridge.on('characterportraits', (payload) =>
      setCharacterPortraits(payload.bySession),
    );

    return () => {
      unsubscribeVoice();
      unsubscribePortraits();
      unsubscribeCharacterPortraits();
    };
  }, [bridge]);

  const hasCompany = voice.peers.length > 0;

  const entries: TileEntry[] = [];
  // Preview an active local camera even alone; keep the camera-off portrait company-only.
  if (voice.selfSessionId !== null && (hasCompany || localVideoTrack !== null)) {
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

  const stage = selectScreenShareStage({
    activeSharer: activeScreenSharer,
    selfSessionId: voice.selfSessionId,
    localTrack: localScreenShareTrack,
    // Screen share stays space-only: the open floor never shares (#20).
    remoteTracks: voice.spaceId !== null ? screenShareTracks : new Map(),
  });
  const thumbnail = stage && stageMinimized ? stage : null;
  const openStage = stage && !stageMinimized ? stage : null;
  useEscapeStep(openStage !== null, () => {
    onMinimizeStage();
    return true;
  });
  const layout = openStage ? 'column' : 'row';
  const capacity = videoTileCapacity({ layout, viewportWidth: viewport.width, viewportHeight: viewport.height });
  // Cameras and speakers first, within what fits the layout (#280).
  const selection = selectVideoTiles(
    entries.map((entry) => ({
      sessionId: entry.sessionId,
      hasVideo: entry.track !== null,
      speaking: speakers.has(entry.sessionId),
      pinned: entry.sessionId === voice.selfSessionId,
    })),
    // The thumbnail takes one of the slots.
    thumbnail ? Math.max(1, capacity - 1) : capacity,
    visibleRef.current,
  );
  useEffect(() => {
    visibleRef.current = selection.visible;
  });
  const entryById = new Map(entries.map((entry) => [entry.sessionId, entry]));
  const visibleEntries = selection.visible.map((sessionId) => entryById.get(sessionId)!);

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
      {openStage && (
        <div
          key={`${openStage.sessionId}:screen_share`}
          className={styles.stage}
          data-testid="screen-share-stage"
          data-session-id={openStage.sessionId}
        >
          <VideoTile
            sessionId={openStage.sessionId}
            name={stageLabel}
            portraits={portraits}
            characterPortraits={characterPortraits}
            track={openStage.track}
            speaking={false}
            fit="contain"
          />
        </div>
      )}
      {(entries.length > 0 || thumbnail) && (
        <div className={styles.bar} data-layout={layout} data-testid="video-tile-bar">
          {/* No `data-session-id`: that marks the people's tiles, and this is a screen. */}
          {thumbnail && (
            <div
              key={`${thumbnail.sessionId}:screen_share`}
              className={`${styles.tile} ${styles.stageThumbnail}`}
              data-testid="screen-share-thumbnail"
            >
              <VideoTile
                sessionId={thumbnail.sessionId}
                name={stageLabel}
                portraits={portraits}
                characterPortraits={characterPortraits}
                track={thumbnail.track}
                speaking={false}
                fit="contain"
              />
              <button
                type="button"
                className={styles.stageRestore}
                aria-label="Ampliar pantalla compartida"
                title="Ampliar pantalla compartida"
                onClick={onRestoreStage}
              />
            </div>
          )}
          {visibleEntries.map((entry) => (
            <div key={entry.sessionId} className={styles.tile} data-session-id={entry.sessionId}>
              <VideoTile
                sessionId={entry.sessionId}
                name={entry.name}
                portraits={portraits}
                characterPortraits={characterPortraits}
                track={entry.track}
                speaking={speakers.has(entry.sessionId)}
              />
            </div>
          ))}
          {selection.hiddenCount > 0 && (
            <div className={`${styles.tile} ${styles.overflow}`} data-testid="video-tile-overflow">
              {overflowLabel(selection.hiddenCount)}
            </div>
          )}
        </div>
      )}
    </>
  );
}
