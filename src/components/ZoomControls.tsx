import { ZOOM_CONTROLS_RIGHT, ZOOM_CONTROLS_TOP } from '../game/hudLayout';
import { ZOOM_DEFAULT, zoomPercent, type ZoomView } from '../game/mapZoom';
import styles from './ZoomControls.module.css';

export interface ZoomControlsProps {
  view: ZoomView;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}

/**
 * Map zoom next to the minimap (map-zoom). Presentational (D3): it shows the
 * stop it is given and reports clicks; whether the zoom changed is up to the
 * scene, which also answers the wheel and the keys.
 */
export function ZoomControls({ view, onZoomIn, onZoomOut, onReset }: ZoomControlsProps) {
  const percent = zoomPercent(view.zoom);
  const resetLabel = `Restablecer zoom (${percent})`;

  return (
    <div
      className={styles.controls}
      role="group"
      aria-label="Zoom del mapa"
      style={{ top: ZOOM_CONTROLS_TOP, right: ZOOM_CONTROLS_RIGHT }}
    >
      <button type="button" className={styles.btn} aria-label="Acercar" title="Acercar" disabled={!view.canZoomIn} onClick={onZoomIn}>
        +
      </button>
      <button
        type="button"
        className={`${styles.btn} ${styles.percent}`}
        aria-label={resetLabel}
        title={resetLabel}
        disabled={view.zoom === ZOOM_DEFAULT}
        onClick={onReset}
      >
        {percent}
      </button>
      <button type="button" className={styles.btn} aria-label="Alejar" title="Alejar" disabled={!view.canZoomOut} onClick={onZoomOut}>
        -
      </button>
    </div>
  );
}
