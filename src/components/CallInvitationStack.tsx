import type { CallInvitationCard as CallInvitationCardData } from '../hooks/useCallInvitations';
import { CallInvitationCard } from './CallInvitationCard';
import styles from './CallInvitationStack.module.css';

export interface CallInvitationStackProps {
  invitations: readonly CallInvitationCardData[];
  onAccept: (from: string) => void;
  onDismiss: (from: string) => void;
}

/**
 * Pila de invitaciones en el borde derecho (issue #2, decision humana
 * #305.2: OVERRIDE -- no hay "una pendiente por destinatario", TODAS llegan
 * y se apilan, la segunda debajo de la primera). El orden del array ya es el
 * de llegada -- lo decide `useCallInvitations`, mas nueva al final -- aqui
 * solo se traduce a "mas nueva abajo" con una columna flex, sin reordenar
 * nada. `aria-live="assertive"` (D11): cada llegada debe anunciarse.
 */
export function CallInvitationStack({ invitations, onAccept, onDismiss }: CallInvitationStackProps) {
  if (invitations.length === 0) return null;

  return (
    <div className={styles.stack} aria-live="assertive">
      {invitations.map((invitation) => (
        <CallInvitationCard
          key={invitation.from}
          invitation={invitation}
          onAccept={onAccept}
          onDismiss={onDismiss}
        />
      ))}
    </div>
  );
}
