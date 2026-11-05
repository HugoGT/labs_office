import styles from './LayoutItemList.module.css';
import { TrashIcon } from './TrashIcon';

export interface LayoutListItem {
  id: string;
  name: string;
  /** Rooms only (#282): whether it is a meeting room. */
  meeting?: boolean;
}

export interface LayoutItemListProps {
  items: readonly LayoutListItem[];
  /** A write in flight: every button waits for it. */
  busy: boolean;
  onMove: (id: string) => void;
  onRemove: (id: string) => void;
  /** Rooms only (#282): flips meeting mode. Absent (desks), no row offers it. */
  onToggleMeeting?: (id: string, meeting: boolean) => void;
}

/**
 * The list of "Editar escritorios" and "Editar salas" (Editar espacios): one
 * line per item, its name and the two actions on that row, with no selection
 * step. Presentational; each editor maps its own items and hook actions in, so
 * desks and rooms look and behave the same.
 */
export function LayoutItemList({ items, busy, onMove, onRemove, onToggleMeeting }: LayoutItemListProps) {
  return (
    <ul className={styles.list}>
      {items.map(({ id, name, meeting = false }) => (
        <li key={id} className={styles.row}>
          <span className={styles.name} title={name}>{name}</span>
          <div className={styles.rowActions}>
            {onToggleMeeting !== undefined && (
              <button
                type="button"
                className={meeting ? `${styles.button} ${styles.on}` : styles.button}
                aria-label={`Sala de junta: ${name}`}
                aria-pressed={meeting}
                title="Sala de junta: se entra en silencio y un admin puede silenciar"
                disabled={busy}
                onClick={() => onToggleMeeting(id, !meeting)}
              >
                Junta
              </button>
            )}
            {/* The visible text stays short; the label keeps each accessible name unique. */}
            <button
              type="button"
              className={styles.button}
              aria-label={`Mover ${name}`}
              disabled={busy}
              onClick={() => onMove(id)}
            >
              Mover
            </button>
            <button
              type="button"
              className={`${styles.button} ${styles.danger}`}
              aria-label={`Eliminar ${name}`}
              title="Eliminar"
              disabled={busy}
              onClick={() => onRemove(id)}
            >
              <TrashIcon />
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
