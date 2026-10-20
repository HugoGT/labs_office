import type { DeskDecorAsset, DeskItemPlacement, PlacedDeskItem, SaveDeskOutcome } from '../game/deskDecorPort';
import type { DeskDecorPhase } from '../hooks/useDeskDecor';
import { DeskDecorEditor } from './DeskDecorEditor';
import styles from './MiEspacioPanel.module.css';

export interface MiEspacioPanelProps {
  /** Whether the person claimed a desk (`OfficeDesk.mine`). Admins too: everyone decorates their own. */
  hasDesk: boolean;
  /** Whether the decor can be edited now (`useDeskDecor`). */
  phase: DeskDecorPhase;
  catalog: readonly DeskDecorAsset[];
  items: readonly PlacedDeskItem[];
  onSave: (items: readonly DeskItemPlacement[]) => Promise<SaveDeskOutcome>;
}

/**
 * "Mi espacio" (inside "Personalizar", `OfficeSidebar`), for everyone, admin
 * or not: the editor of the decor of one's own desk (Editar espacios). A desk
 * is an empty 3x3 area; its occupant places a table on one edge, chairs and
 * plants. The decor follows the person, but it only shows where they sit, so
 * without a claimed desk this asks to claim one. That is UI only: the server
 * stores decor for the person whether or not they hold a desk.
 */
export function MiEspacioPanel({ hasDesk, phase, catalog, items, onSave }: MiEspacioPanelProps) {
  return (
    <section className={styles.section} aria-labelledby="mi-espacio-heading">
      <h3 className={styles.title} id="mi-espacio-heading">
        Mi espacio
      </h3>
      {!hasDesk ? (
        <p className={styles.body}>Reclama un escritorio para personalizar tu espacio.</p>
      ) : phase === 'loading' ? (
        <p className={styles.body}>Cargando tu escritorio…</p>
      ) : phase === 'unavailable' ? (
        <p className={styles.body}>La decoración no está disponible ahora mismo.</p>
      ) : (
        <DeskDecorEditor catalog={catalog} items={items} onSave={onSave} />
      )}
    </section>
  );
}
