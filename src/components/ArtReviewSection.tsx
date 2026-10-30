import { useCallback, useEffect, useId, useState } from 'react';
import { ArtPieceViewer } from './ArtPieceViewer';
import { describeAdminError } from '../dashboard/adminErrors';
import { CONTRIBUTION_KINDS, type Contribution, type ContributionStatus } from '../dashboard/artContributionPort';
import type { ArtReviewPort } from '../dashboard/artReviewPort';
import styles from './ArtAdminSection.module.css';

const TABS: readonly { status: ContributionStatus; label: string; empty: string }[] = [
  { status: 'pending', label: 'Pendientes', empty: 'No hay piezas pendientes de revisión.' },
  { status: 'approved', label: 'Aprobadas', empty: 'Todavía no hay piezas aprobadas.' },
  { status: 'rejected', label: 'Rechazadas', empty: 'No hay piezas rechazadas.' },
];

const KIND_LABELS: Readonly<Record<string, string>> = {
  character: 'Personaje',
  plant: 'Planta de escritorio',
  desk: 'Escritorio',
  floor: 'Suelo',
  chair: 'Silla',
  table: 'Mesa de sala',
  door: 'Puerta',
};

/** What the server lets a reviewer withdraw: the contributable kinds. */
const RETIRABLE_KINDS: ReadonlySet<string> = new Set(CONTRIBUTION_KINDS);

function uploaderOf(contribution: Contribution): string {
  const uploader = contribution.uploadedBy;
  if (uploader === null) return 'Enviado por una cuenta que ya no existe';
  return uploader.name === null ? `Enviado por ${uploader.email}` : `Enviado por ${uploader.name} (${uploader.email})`;
}

interface RowProps {
  contribution: Contribution;
  read: (path: string) => Promise<string>;
  busy: boolean;
  onApprove(): void;
  onReject(reason: string): void;
  onRetire(): void;
}

function ReviewRow({ contribution, read, busy, onApprove, onReject, onRetire }: RowProps) {
  const id = useId();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const { name, status } = contribution;

  return (
    <li className={styles.item}>
      <div className={styles.meta}>
        <strong>{name}</strong>
        <span className={styles.label}>
          {KIND_LABELS[contribution.kind] ?? contribution.kind} · Autoría: {contribution.author}
        </span>
        <span className={styles.label}>{uploaderOf(contribution)}</span>
        {status === 'rejected' && <span className={styles.label}>Motivo: {contribution.reviewNote}</span>}
      </div>
      <div className={styles.actions}>
        <ArtPieceViewer contribution={contribution} read={read} className={styles.button} />
      </div>
      {status === 'pending' && !rejecting && (
        <div className={styles.actions}>
          <button type="button" className={styles.button} disabled={busy} aria-label={`Aprobar ${name}`} onClick={onApprove}>
            Aprobar
          </button>
          <button type="button" className={styles.button} disabled={busy} aria-label={`Rechazar ${name}`} onClick={() => setRejecting(true)}>
            Rechazar
          </button>
        </div>
      )}
      {status === 'pending' && rejecting && (
        <div className={styles.form}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${id}-reason`}>
              Motivo del rechazo
            </label>
            <input id={`${id}-reason`} className={styles.input} value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} />
          </div>
          <button type="button" className={styles.button} disabled={busy || reason.trim() === ''} onClick={() => onReject(reason.trim())}>
            Confirmar rechazo
          </button>
          <button type="button" className={styles.button} disabled={busy} onClick={() => setRejecting(false)}>
            Cancelar
          </button>
        </div>
      )}
      {status === 'approved' && contribution.retiredAt === null && RETIRABLE_KINDS.has(contribution.kind) && (
        <div className={styles.actions}>
          <button type="button" className={`${styles.button} ${styles.danger}`} disabled={busy} aria-label={`Retirar ${name}`} onClick={onRetire}>
            Retirar
          </button>
        </div>
      )}
    </li>
  );
}

export interface ArtReviewSectionProps {
  /** Port already built (`OfficeShell`); this section knows nothing of HTTP. */
  reviews: ArtReviewPort;
  /** How many pieces wait, each time the pending queue is read or changes (the badge of "Revisión de arte"). */
  onPendingCount?: (count: number) => void;
}

/**
 * "Revisión de arte" inside "Personalizar" (#122), for admins and the
 * superadmin. Container like `ArtContributionSection`: the only one that calls
 * the port. Each piece
 * shows its animated preview (a character walks in four directions and sits)
 * read through the private route, since a pending file is not public.
 * Approving puts it in everyone's catalog; rejecting asks for the reason its
 * uploader reads; an approved character or plant can be withdrawn.
 */
export function ArtReviewSection({ reviews, onPendingCount }: ArtReviewSectionProps) {
  const id = useId();
  const [status, setStatus] = useState<ContributionStatus>('pending');
  const [items, setItems] = useState<Contribution[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(
    (wanted: ContributionStatus) => {
      setItems(null);
      reviews
        .list(wanted)
        .then(setItems)
        .catch((loadError) => {
          setItems([]);
          setError(describeAdminError(loadError));
        });
    },
    [reviews],
  );

  useEffect(() => load(status), [load, status]);

  // The queue tells the badge of "Revisión de arte" how many wait, never another tab's count,
  // and not after a failed read, which would show an empty queue that is not.
  useEffect(() => {
    if (status === 'pending' && items !== null && error === null) onPendingCount?.(items.length);
  }, [status, items, error, onPendingCount]);

  async function act(run: () => Promise<string>, update: (list: Contribution[]) => Contribution[]): Promise<void> {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const message = await run();
      setItems((current) => (current === null ? current : update(current)));
      setDone(message);
    } catch (actionError) {
      setError(describeAdminError(actionError));
    } finally {
      setBusy(false);
    }
  }

  const without = (target: string) => (list: Contribution[]) => list.filter((entry) => entry.id !== target);
  const tab = TABS.find((entry) => entry.status === status)!;

  return (
    <section className={styles.section} aria-labelledby={`${id}-title`}>
      <h3 className={styles.title} id={`${id}-title`}>
        Revisión de arte
      </h3>
      <p className={styles.hint}>
        Piezas que sube la gente desde «Personalizar». Nada pendiente se ve en la oficina hasta que lo apruebas.
      </p>

      <div className={styles.tabs} role="tablist" aria-label="Estado">
        {TABS.map((entry) => (
          <button
            key={entry.status}
            type="button"
            role="tab"
            aria-selected={entry.status === status}
            className={entry.status === status ? `${styles.button} ${styles.tabActive}` : styles.button}
            onClick={() => {
              setDone(null);
              setError(null);
              setStatus(entry.status);
            }}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {error !== null && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
      {done !== null && (
        <p className={styles.done} role="status">
          {done}
        </p>
      )}

      {items !== null && items.length === 0 && <p className={styles.empty}>{tab.empty}</p>}
      {items !== null && items.length > 0 && (
        <ul className={styles.list}>
          {items.map((contribution) => (
            <ReviewRow
              key={contribution.id}
              contribution={contribution}
              read={reviews.fileDataUrl}
              busy={busy}
              onApprove={() =>
                void act(async () => {
                  await reviews.approve(contribution.id);
                  return `«${contribution.name}» ya está en el catálogo de toda la oficina.`;
                }, without(contribution.id))
              }
              onReject={(reason) =>
                void act(async () => {
                  await reviews.reject(contribution.id, reason);
                  return `«${contribution.name}» quedó rechazada. Quien la subió verá el motivo.`;
                }, without(contribution.id))
              }
              onRetire={() =>
                void act(
                  async () => {
                    const { usersReset } = await reviews.retire(contribution.id);
                    const people = usersReset === 1 ? '1 persona vuelve' : `${usersReset} personas vuelven`;
                    return usersReset === 0
                      ? `«${contribution.name}» ya no se ofrece.`
                      : `«${contribution.name}» ya no se ofrece. ${people} al personaje por defecto.`;
                  },
                  // A retired piece leaves the review lists (#264).
                  without(contribution.id),
                )
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}
