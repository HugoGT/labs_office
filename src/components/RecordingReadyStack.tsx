import type { OfficeEventMap } from '../game/officeBridge';
import cardStyles from './CallInvitationCard.module.css';
import styles from './RecordingReadyStack.module.css';

export type RecordingReadyNotice = OfficeEventMap['recordingready'];

export interface RecordingReadyStackProps {
  notices: readonly RecordingReadyNotice[];
  onView: (recordingId: string) => void;
  onDownload: (recordingId: string) => void;
  onDismiss: (recordingId: string) => void;
}

/**
 * `dd/mm/yyyy` in the viewer's own time zone: the day, for them, after which
 * the bucket may delete the recording (#5).
 */
function formatDay(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Finished recordings ready to watch or download (#58). Same pattern as
 * `CallInvitationStack` and the same card look: presentational, persistent
 * until dismissed, because the 3 s toast would be gone before anyone decided
 * to watch a recording.
 */
export function RecordingReadyStack({ notices, onView, onDownload, onDismiss }: RecordingReadyStackProps) {
  if (notices.length === 0) return null;

  return (
    <div className={styles.stack} aria-live="polite">
      {notices.map(({ recordingId, availableUntil }) => (
        <div key={recordingId} className={cardStyles.card}>
          <div className={cardStyles.body}>
            La grabación está lista
            <div className={styles.expiry}>Disponible hasta el {formatDay(availableUntil)}</div>
          </div>
          <div className={cardStyles.actions}>
            <button type="button" className={cardStyles.accept} onClick={() => onView(recordingId)}>
              Ver
            </button>
            <button type="button" className={cardStyles.accept} onClick={() => onDownload(recordingId)}>
              Descargar
            </button>
            <button type="button" className={cardStyles.dismiss} onClick={() => onDismiss(recordingId)}>
              Cerrar
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
