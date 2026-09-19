import type { CallInvitationCard as CallInvitationCardData } from '../hooks/useCallInvitations';
import styles from './CallInvitationCard.module.css';

export interface CallInvitationCardProps {
  invitation: CallInvitationCardData;
  onAccept: (from: string) => void;
  onDismiss: (from: string) => void;
}

/**
 * Una tarjeta de invitacion de llamada entrante (issue #2, D11/D12).
 * Puramente presentacional (D3, mismo patron que `Toast`/`BottomBar`): ni
 * bridge ni temporizadores propios, solo la invitacion ya resuelta por
 * `useCallInvitations` y dos callbacks.
 */
export function CallInvitationCard({ invitation, onAccept, onDismiss }: CallInvitationCardProps) {
  return (
    <div className={styles.card} data-alerting={invitation.alerting}>
      <div className={styles.body}>
        {invitation.callerPresent ? (
          <>
            📞 <b>{invitation.name}</b> te está llamando
          </>
        ) : (
          // D7, decision humana #305.5: la notificacion no se descarta al
          // desconectarse el llamador -- se queda como tombstone informativo.
          <>
            <b>{invitation.name}</b> te llamó, pero ya se desconectó
          </>
        )}
      </div>
      <div className={styles.actions}>
        {invitation.callerPresent && (
          <button type="button" className={styles.accept} onClick={() => onAccept(invitation.from)}>
            🚶 Ir con la persona
          </button>
        )}
        <button type="button" className={styles.dismiss} onClick={() => onDismiss(invitation.from)}>
          Pasar
        </button>
      </div>
    </div>
  );
}
