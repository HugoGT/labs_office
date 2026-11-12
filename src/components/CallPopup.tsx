import { type ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AttachableTrack } from '../game/attachableTrack';
import type { OfficeBridge, OfficeEventMap } from '../game/officeBridge';
import { selectScreenShareStage } from '../game/screenShare';
import { selectVideoTiles } from '../game/videoTileSelection';
import type { CallPopupControl } from '../hooks/useCallPopup';
import styles from './CallPopup.module.css';
import { VideoTile } from './VideoTile';

/** Faces that fit the column, counting the "+N" counter as one of them. */
const MAX_FACES = 4;

const INITIAL_VOICE: OfficeEventMap['voice'] = { selfSessionId: null, selfName: '', peers: [], spaceId: null };

export interface CallPopupProps {
  popup: CallPopupControl;
  bridge: OfficeBridge;
  /** Live call in a space: only then is the popup offered. */
  available: boolean;
  /** Where the player is (room name, or whose desk), for the status pill of the installed-app window. */
  placeLabel: string | null;
  /** Identities speaking right now, the same set the tiles' green border follows. */
  speakers: ReadonlySet<string>;
  videoTracks: ReadonlyMap<string, AttachableTrack>;
  localVideoTrack: AttachableTrack | null;
  /** The share of the space, shown as a thumbnail above the faces. */
  screenShareTracks: ReadonlyMap<string, AttachableTrack>;
  localScreenShareTrack: AttachableTrack | null;
  activeScreenSharer: string | null;
  /** The bottom bar's own state, not a copy: toggling here is toggling there. */
  micOn: boolean;
  camOn: boolean;
  screenShareOn: boolean;
  screenShareAvailable: boolean;
  /** Where the bottom bar disables mic and camera (no LiveKit, do not disturb). */
  controlsDisabled: boolean;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onToggleScreenShare: () => void;
}

/**
 * The call popup of #320. In the tab it is only the small button that opens
 * or closes the floating window; the window itself is a React portal into the
 * document of whatever window the hook opened, so it is the very same React
 * tree as the bottom bar: same `micOn`/`camOn`, same toggles, no second
 * source of truth. Closing the window (its X) is the way to hang up from it:
 * the call is the presence in the space, which the popup does not touch.
 *
 * Two variants of one layout (a column of faces, the shared screen on top of
 * it, three controls): `pip` is the installed app's Document Picture-in-Picture
 * window and adds the status pill; `popup` is the plain browser popup.
 *
 * It subscribes to the bridge from the start, not when the window opens: the
 * "voice" and "portraits" events are not replayed to a late subscriber.
 */
export function CallPopup({
  popup,
  bridge,
  available,
  placeLabel,
  speakers,
  videoTracks,
  localVideoTrack,
  screenShareTracks,
  localScreenShareTrack,
  activeScreenSharer,
  micOn,
  camOn,
  screenShareOn,
  screenShareAvailable,
  controlsDisabled,
  onToggleMic,
  onToggleCam,
  onToggleScreenShare,
}: CallPopupProps) {
  const [voice, setVoice] = useState<OfficeEventMap['voice']>(INITIAL_VOICE);
  const [portraits, setPortraits] = useState<Record<string, string> | null>(null);
  const [characterPortraits, setCharacterPortraits] = useState<Record<string, string> | null>(null);

  useEffect(() => {
    const offVoice = bridge.on('voice', setVoice);
    const offPortraits = bridge.on('portraits', (payload) => setPortraits(payload.byKey));
    const offCharacterPortraits = bridge.on('characterportraits', (payload) => setCharacterPortraits(payload.bySession));
    return () => {
      offVoice();
      offPortraits();
      offCharacterPortraits();
    };
  }, [bridge]);

  const people = [
    ...(voice.selfSessionId === null ? [] : [{ sessionId: voice.selfSessionId, name: voice.selfName }]),
    ...voice.peers,
  ];
  const trackOf = (sessionId: string) => (sessionId === voice.selfSessionId ? localVideoTrack : (videoTracks.get(sessionId) ?? null));
  // Whoever speaks gets a slot before anyone else; the rest keep the order of the tiles.
  const selection = selectVideoTiles(
    people.map((person) => ({ sessionId: person.sessionId, hasVideo: false, speaking: speakers.has(person.sessionId) })),
    MAX_FACES,
    [],
  );
  const faces = selection.visible
    .map((sessionId) => people.find((person) => person.sessionId === sessionId)!)
    .sort((a, b) => Number(speakers.has(b.sessionId)) - Number(speakers.has(a.sessionId)));

  // Unlike the tab's stage, nothing is "minimized" here: the share is always the thumbnail.
  const share = selectScreenShareStage({
    activeSharer: activeScreenSharer,
    selfSessionId: voice.selfSessionId,
    localTrack: localScreenShareTrack,
    remoteTracks: screenShareTracks,
  });
  const sharer = share && people.find((person) => person.sessionId === share.sessionId);
  const shareLabel =
    share?.sessionId === voice.selfSessionId ? 'Tu pantalla' : sharer ? `Pantalla de ${sharer.name}` : 'Pantalla compartida';

  const open = popup.popupWindow !== null;
  const toggleLabel = open ? 'Cerrar ventana flotante de la llamada' : 'Abrir ventana flotante de la llamada';
  const shareDisabled = controlsDisabled || !screenShareAvailable;

  return (
    <>
      {available && (
        <button
          type="button"
          className={styles.opener}
          aria-label={toggleLabel}
          title={toggleLabel}
          aria-pressed={open}
          onClick={open ? popup.close : () => void popup.open()}
        >
          <span aria-hidden="true">🗗</span>
        </button>
      )}
      {popup.popupWindow &&
        createPortal(
          <div className={styles.popup} data-variant={popup.variant}>
            <div className={styles.column}>
              {share && (
                <div className={styles.face} data-testid="popup-screen-share">
                  <VideoTile
                    sessionId={share.sessionId}
                    name={shareLabel}
                    portraits={portraits}
                    characterPortraits={characterPortraits}
                    track={share.track}
                    speaking={false}
                    fit="contain"
                  />
                </div>
              )}
              <div className={styles.faces} role="group" aria-label="Personas en la sala">
                {faces.map((person) => (
                  <div key={person.sessionId} className={styles.face}>
                    <VideoTile
                      sessionId={person.sessionId}
                      name={person.name}
                      portraits={portraits}
                      characterPortraits={characterPortraits}
                      track={trackOf(person.sessionId)}
                      speaking={speakers.has(person.sessionId)}
                    />
                  </div>
                ))}
                {selection.hiddenCount > 0 && (
                  <div className={`${styles.face} ${styles.overflow}`}>
                    {selection.hiddenCount === 1 ? '+1 persona' : `+${selection.hiddenCount} personas`}
                  </div>
                )}
              </div>
            </div>
            {popup.variant === 'pip' && placeLabel !== null && (
              <p className={styles.pill} role="status" data-testid="popup-status-pill">
                <span className={styles.pillDot} aria-hidden="true" />
                {placeLabel}
              </p>
            )}
            <div className={styles.controls} role="toolbar" aria-label="Controles de llamada">
              <ControlButton label="Micrófono" pressed={micOn} disabled={controlsDisabled} onClick={onToggleMic}>
                {micOn ? '🎙️' : '🔇'}
              </ControlButton>
              <ControlButton label="Cámara" pressed={camOn} disabled={controlsDisabled} onClick={onToggleCam}>
                {camOn ? '📷' : '🚫'}
              </ControlButton>
              <ControlButton label="Compartir pantalla" pressed={screenShareOn} disabled={shareDisabled} onClick={onToggleScreenShare}>
                🖥️
              </ControlButton>
            </div>
          </div>,
          popup.popupWindow.document.body,
        )}
    </>
  );
}

interface ControlButtonProps {
  label: string;
  pressed: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}

/** Icon only: the column is too narrow for words, so the name is the `aria-label` and the `title`. */
function ControlButton({ label, pressed, disabled, onClick, children }: ControlButtonProps) {
  return (
    <button type="button" className={styles.btn} aria-label={label} title={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>
      <span aria-hidden="true">{children}</span>
    </button>
  );
}
