import { STATUS_LABEL, statusCssColor } from '../game/presence';
import { CharacterIcon, ClaimIcon, DecorateIcon, LeaveIcon } from './DeskBannerIcons';
import type { DeskBannerView } from './deskBannerView';
import { PhoneIcon } from './PhoneIcon';
import styles from './DeskBanner.module.css';

/** What a desk held by someone not in the office says instead of a status. */
export const OFFLINE_LABEL = 'Desconectado';
const OFFLINE_COLOR = '#6b7280';
const CLAIM_DISABLED_TITLE = 'Ya tienes un escritorio: déjalo antes de reclamar otro';

export interface DeskBannerProps {
  view: DeskBannerView;
  /** Client point of the middle of the desk's top edge (`deskhover`). */
  anchor: { x: number; y: number };
  /** The occupant's pack portrait, when it loaded. */
  portrait: string | null;
  onClaim: () => void;
  onCall: (sessionId: string, name: string) => void;
  /** Opens "Mi personaje"; without it (no character editor) the button is left out. */
  onCharacter?: () => void;
  onDecorate: () => void;
  onLeave: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

/**
 * The banner over a hovered desk: who holds it and what one can do there.
 * Presentational; `OfficeShell` decides the view and runs the actions.
 */
export function DeskBanner({
  view,
  anchor,
  portrait,
  onClaim,
  onCall,
  onCharacter,
  onDecorate,
  onLeave,
  onPointerEnter,
  onPointerLeave,
}: DeskBannerProps) {
  const title = view.kind === 'free' ? 'Escritorio Libre' : view.name;

  return (
    <div
      role="dialog"
      aria-label={title}
      className={view.kind === 'free' ? `${styles.banner} ${styles.free}` : styles.banner}
      style={{ left: anchor.x, top: anchor.y }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      {view.kind === 'free' ? (
        <>
          <div className={styles.freeLabel}>{title}</div>
          <button
            type="button"
            className={styles.claim}
            disabled={!view.canClaim}
            title={view.canClaim ? undefined : CLAIM_DISABLED_TITLE}
            onClick={onClaim}
          >
            <ClaimIcon />
            Reclamar escritorio
          </button>
        </>
      ) : (
        <>
          {portrait !== null && <img className={styles.portrait} src={portrait} alt={view.name} />}
          <div className={styles.name}>
            {view.name}
            <span
              className={styles.dot}
              style={{ background: view.status === null ? OFFLINE_COLOR : statusCssColor(view.status) }}
            />
          </div>
          <div className={styles.status}>{view.status === null ? OFFLINE_LABEL : STATUS_LABEL[view.status]}</div>
          {view.kind === 'mine' && (
            <div className={styles.actions}>
              {onCharacter !== undefined && (
                <button type="button" className={styles.action} aria-label="Mi personaje" title="Mi personaje" onClick={onCharacter}>
                  <CharacterIcon />
                </button>
              )}
              <button type="button" className={styles.action} aria-label="Decorar" title="Decorar" onClick={onDecorate}>
                <DecorateIcon />
              </button>
              <button type="button" className={styles.action} aria-label="Dejar escritorio" title="Dejar escritorio" onClick={onLeave}>
                <LeaveIcon />
              </button>
            </div>
          )}
          {view.kind === 'taken' && view.callable && view.sessionId !== null && (
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.action}
                aria-label={`Llamar a ${view.name}`}
                title={`Llamar a ${view.name}`}
                onClick={() => onCall(view.sessionId as string, view.name)}
              >
                <PhoneIcon />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
