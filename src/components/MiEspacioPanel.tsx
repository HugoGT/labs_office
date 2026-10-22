import type { ArtPreviewCache } from '../game/artPreview';
import type { OfficeBridge } from '../game/officeBridge';
import type { DecorTileRect } from '../game/officeDecor';
import type { OfficeDecorPort } from '../game/officeDecorPort';
import type { LoadMaterials } from '../hooks/useMaterialCatalog';
import { DecorEditorSection } from './DecorEditorSection';
import styles from './MiEspacioPanel.module.css';

export interface MiEspacioPanelProps {
  /** Whether the person claimed a desk (`OfficeDesk.mine`). Admins too: everyone decorates their own. */
  hasDesk: boolean;
  /** That desk's area in tiles, what the editor may touch; `null` without one. */
  area?: DecorTileRect | null;
  bridge?: OfficeBridge;
  /** `POST /me/decor`; without it (no server) there is nothing to write to. */
  decor?: OfficeDecorPort | null;
  /** Releases the desk, the same way as the map toast's "Dejarlo". */
  onLeaveDesk?: () => void;
  /** The palette's catalog and thumbnails; injected by tests. */
  loadMaterials?: LoadMaterials;
  preview?: ArtPreviewCache;
}

/**
 * "Mi espacio" (inside "Personalizar", `OfficeSidebar`), for everyone, admin
 * or not: where one decorates the desk one occupies. Furniture lives in the
 * office decor layer since #208 (`officeDecor.ts`, `POST /me/decor`), and a
 * desk keeps it when it changes hands, so the editor here is "Decoración"
 * scoped to the desk. It ends with "Dejar escritorio", for whoever moves to
 * another area: the desk is free again for anyone, this person included.
 * Without a claimed desk this asks to claim one.
 */
export function MiEspacioPanel({ hasDesk, area = null, bridge, decor, onLeaveDesk, loadMaterials, preview }: MiEspacioPanelProps) {
  return (
    <section className={styles.section} aria-labelledby="mi-espacio-heading">
      <h3 className={styles.title} id="mi-espacio-heading">
        Mi espacio
      </h3>
      {!hasDesk && <p className={styles.body}>Reclama un escritorio libre en el mapa para decorarlo.</p>}
      {hasDesk && area !== null && bridge !== undefined && decor != null && (
        <DecorEditorSection bridge={bridge} decor={decor} scope="desk" area={area} loadMaterials={loadMaterials} preview={preview} />
      )}
      {hasDesk && onLeaveDesk !== undefined && (
        <button type="button" className={styles.leave} onClick={onLeaveDesk}>
          Dejar escritorio
        </button>
      )}
    </section>
  );
}
