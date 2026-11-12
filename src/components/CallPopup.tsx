import { type CSSProperties, type ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AttachableTrack } from '../game/attachableTrack';
import type { OfficeBridge, OfficeEventMap } from '../game/officeBridge';
import { selectScreenShareStage } from '../game/screenShare';
import type { CallPopupControl } from '../hooks/useCallPopup';
import { OVERFLOW_HEIGHT, SCREEN_TILE_ID, desiredPopupSize, layoutCallPopup, type TileSize } from './callPopupLayout';
import styles from './CallPopup.module.css';
import { VideoTile } from './VideoTile';

const INITIAL_VOICE: OfficeEventMap['voice'] = { selfSessionId: null, selfName: '', peers: [], spaceId: null };

/** Inner size of the popup window, kept up to date on its own `resize`: it is not the tab's. */
function useWindowSize(target: Window | null): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (target === null) {
      setSize({ width: 0, height: 0 });
      return undefined;
    }
    const read = () => setSize({ width: target.innerWidth || 0, height: target.innerHeight || 0 });
    read();
    target.addEventListener('resize', read);
    return () => target.removeEventListener('resize', read);
  }, [target]);
  return size;
}

const sized = ({ width, height }: TileSize): CSSProperties => ({ width, height });

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
  // The face this popup brought to the foreground. Its own: the tab's `stageFocus` is not touched.
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const { popupWindow, variant, setSize } = popup;
  const windowSize = useWindowSize(popupWindow);

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
  // Someone who left takes the focus with them: coming back does not bring it back.
  const focusedPresent = focusedId !== null && people.some((person) => person.sessionId === focusedId);
  useEffect(() => {
    if (focusedId !== null && !focusedPresent) setFocusedId(null);
  }, [focusedId, focusedPresent]);

  const nameOf = (sessionId: string) => people.find((person) => person.sessionId === sessionId)?.name ?? '';
  const trackOf = (sessionId: string) => (sessionId === voice.selfSessionId ? localVideoTrack : (videoTracks.get(sessionId) ?? null));

  // Unlike the tab's stage, a share is always shown here: it is the first thing the popup is for.
  const share = selectScreenShareStage({
    activeSharer: activeScreenSharer,
    selfSessionId: voice.selfSessionId,
    localTrack: localScreenShareTrack,
    remoteTracks: screenShareTracks,
  });
  const shareLabel =
    share?.sessionId === voice.selfSessionId ? 'Tu pantalla' : share && nameOf(share.sessionId) ? `Pantalla de ${nameOf(share.sessionId)}` : 'Pantalla compartida';

  // Only the installed app's window has the status pill; a window not open yet is asked for it.
  const hasPill = variant !== 'popup' && placeLabel !== null;
  const layoutPeople = people.map((person) => ({ sessionId: person.sessionId, speaking: speakers.has(person.sessionId) }));
  const layout = layoutCallPopup({
    width: windowSize.width,
    height: windowSize.height,
    people: layoutPeople,
    hasShare: share !== null,
    hasPill,
    focusedId: focusedPresent ? focusedId : null,
  });

  // The window is kept the size of its content: the first frame when it opens, a resize while it is open.
  const desired = desiredPopupSize({
    width: popupWindow !== null && windowSize.width > 0 ? windowSize.width : null,
    people: layoutPeople,
    hasShare: share !== null,
    hasPill,
    focusedId: layout.focusedId,
  });
  useEffect(() => {
    setSize({ width: desired.width, height: desired.height });
  }, [setSize, desired.width, desired.height]);

  const open = popupWindow !== null;
  const toggleLabel = open ? 'Cerrar ventana flotante de la llamada' : 'Abrir ventana flotante de la llamada';
  const shareDisabled = controlsDisabled || !screenShareAvailable;

  /** A tile of a face or of the screen, `fit` and click included. */
  const tile = (id: string, size: TileSize, inForeground: boolean) => {
    const isScreen = id === SCREEN_TILE_ID;
    if (isScreen && share === null) return null;
    const label = isScreen ? shareLabel : nameOf(id);
    const pressLabel = isScreen
      ? 'Poner la pantalla compartida en primer plano'
      : inForeground
        ? `Quitar a ${label} del primer plano`
        : `Poner a ${label} en primer plano`;
    return (
      <div key={id} className={styles.tile} style={sized(size)} data-testid={isScreen ? 'popup-screen-share' : 'popup-tile'}>
        <VideoTile
          sessionId={isScreen ? share!.sessionId : id}
          name={label}
          portraits={portraits}
          characterPortraits={characterPortraits}
          track={isScreen ? share!.track : trackOf(id)}
          speaking={!isScreen && speakers.has(id)}
          fit={isScreen || inForeground ? 'contain' : 'cover'}
        />
        {/* The screen in the foreground has nothing to click: it is where a click on a face leaves from. */}
        {!(isScreen && inForeground) && (
          <button
            type="button"
            className={styles.hit}
            aria-label={pressLabel}
            title={pressLabel}
            onClick={() => setFocusedId(isScreen || layout.foreground === id ? null : id)}
          />
        )}
      </div>
    );
  };

  const overflow =
    layout.hiddenCount > 0 ? (
      <div className={styles.overflow} style={{ height: OVERFLOW_HEIGHT }}>
        {layout.hiddenCount === 1 ? '+1 persona' : `+${layout.hiddenCount} personas`}
      </div>
    ) : null;
  const strip = (
    <div
      className={styles.strip}
      data-testid="popup-strip"
      role="group"
      aria-label="Personas en la sala"
      style={{ '--columns': layout.columns } as CSSProperties}
    >
      {layout.tiles.map((id) => tile(id, layout.tileSize, false))}
    </div>
  );

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
      {popupWindow &&
        createPortal(
          // A pointer down is the user gesture a refused resize of the window waits for.
          <div className={styles.popup} data-variant={variant} onPointerDown={popup.applySize}>
            <div className={styles.scroll}>
              <div
                className={styles.tiles}
                data-testid="popup-tiles"
                data-mode={layout.mode}
                data-placement={layout.stripPlacement ?? undefined}
                style={{ '--columns': layout.columns } as CSSProperties}
              >
                {layout.foreground !== null && layout.foregroundSize !== null && (
                  <div className={styles.foreground} data-testid="popup-foreground" style={sized(layout.foregroundSize)}>
                    {tile(layout.foreground, layout.foregroundSize, true)}
                  </div>
                )}
                {strip}
                {overflow}
              </div>
            </div>
            {hasPill && (
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
          popupWindow.document.body,
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
