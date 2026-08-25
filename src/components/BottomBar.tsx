import styles from './BottomBar.module.css';

export interface BottomBarProps {
  micOn: boolean;
  camOn: boolean;
  recording: boolean;
  room: string | null;
  nearby: string[];
  presence: { online: boolean; peers: number };
  onToggleMic: () => void;
  onToggleCam: () => void;
  onToggleRecord: () => void;
}

/** Cuantos chips cercanos se muestran antes de colapsar el resto (`app.js:565`). */
const NEARBY_CHIP_LIMIT = 6;

/**
 * Barra inferior: mic/camara/grabar + estado de audio + chips de cercania,
 * portada de `#bar` (`index.html`, `app.js:516-571`). Puramente
 * presentacional (D3): no recibe el bridge, solo props y callbacks.
 */
export function BottomBar({
  micOn,
  camOn,
  recording,
  room,
  nearby,
  presence,
  onToggleMic,
  onToggleCam,
  onToggleRecord,
}: BottomBarProps) {
  const visibleChips = nearby.slice(0, NEARBY_CHIP_LIMIT);
  const overflow = nearby.length - NEARBY_CHIP_LIMIT;

  return (
    <div className={styles.bar}>
      <div className={styles.me}>
        <span className={styles.meDot} /> HugoGT
      </div>
      <div
        className={styles.presence}
        title={
          presence.online
            ? 'Conectado al servidor de avatares reales'
            : 'Sin servidor: la oficina corre en solitario con los NPCs simulados'
        }
      >
        {presence.online ? `🟢 ${presence.peers} en línea` : '⚪ Sin servidor'}
      </div>
      <button type="button" className={styles.btn} aria-pressed={micOn} onClick={onToggleMic}>
        {micOn ? '🎙️ Mic' : '🔇 Mic'}
      </button>
      <button type="button" className={styles.btn} aria-pressed={camOn} onClick={onToggleCam}>
        {camOn ? '📷 Cámara' : '🚫 Cámara'}
      </button>
      <button
        type="button"
        className={styles.btn}
        disabled={room === null}
        title={room === null ? 'Solo disponible dentro de una sala' : undefined}
        onClick={onToggleRecord}
      >
        {recording ? '⏹ Detener' : '⏺ Grabar'}
      </button>
      <div className={styles.status}>
        {room ? (
          <>
            🔒 Sala privada: <b>{room}</b> — audio aislado
          </>
        ) : (
          <>
            Audio por <b>proximidad</b>
          </>
        )}
      </div>
      <div className={styles.nearby}>
        {visibleChips.map((name) => (
          <span key={name} className={styles.chip}>
            🔊 {name}
          </span>
        ))}
        {overflow > 0 && <span className={styles.chip}>+{overflow}</span>}
      </div>
    </div>
  );
}
