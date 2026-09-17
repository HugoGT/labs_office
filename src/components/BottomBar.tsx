import { DO_NOT_DISTURB, PRESENCE_STATUSES, type PresenceStatus } from '../game/officeProtocol';
import { STATUS_LABEL, statusCssColor } from '../game/presence';
import styles from './BottomBar.module.css';

export interface BottomBarProps {
  micOn: boolean;
  camOn: boolean;
  /** `false` mientras no hay conexion viva a LiveKit (matriz de degradacion). */
  audioAvailable: boolean;
  recording: boolean;
  room: string | null;
  presence: { online: boolean; peers: number };
  status: PresenceStatus;
  onChangeStatus: (status: PresenceStatus) => void;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onToggleRecord: () => void;
}

/** Explica el `disabled` de mic/camara cuando no hay conexion viva a LiveKit. */
const AUDIO_UNAVAILABLE_TITLE = 'Audio no disponible: sin conexion a LiveKit';

/** El otro motivo de `disabled`, y el unico que el usuario puede deshacer solo. */
const DND_TITLE = 'No molestar: no publicas micrófono ni cámara';

/**
 * Barra inferior: mic/camara/grabar + estado de audio, portada de `#bar`
 * (`index.html`, `app.js:516-571`). Puramente presentacional (D3): no recibe
 * el bridge, solo props y callbacks. Los chips de cercania se retiraron
 * (issue #17, D9): cada companero audible ahora tiene su propio tile de
 * video, que ya trae su nombre -- la informacion no se perdio, cambio de casa.
 */
export function BottomBar({
  micOn,
  camOn,
  audioAvailable,
  recording,
  room,
  presence,
  status,
  onChangeStatus,
  onToggleMic,
  onToggleCam,
  onToggleRecord,
}: BottomBarProps) {
  // Se deriva del estado en vez de recibirse como prop propia: dos fuentes
  // para el mismo hecho acabarian discrepando en algun render.
  const dnd = status === DO_NOT_DISTURB;
  const audioDisabled = !audioAvailable || dnd;
  // El motivo que el usuario puede deshacer va primero: sin LiveKit no hay
  // nada que hacer desde aqui, pero salir de "No molestar" esta a un clic.
  const audioTitle = dnd ? DND_TITLE : audioAvailable ? undefined : AUDIO_UNAVAILABLE_TITLE;

  return (
    <div className={styles.bar}>
      <div className={styles.me}>
        <span className={styles.meDot} style={{ background: statusCssColor(status) }} />{' '}
        HugoGT
        <select
          className={styles.statusSelect}
          aria-label="Mi estado"
          value={status}
          onChange={(event) => onChangeStatus(event.target.value as PresenceStatus)}
        >
          {PRESENCE_STATUSES.map((code) => (
            <option key={code} value={code}>
              {STATUS_LABEL[code]}
            </option>
          ))}
        </select>
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
      {/* `disabled`+`title` mientras LiveKit no esta disponible, espejando el
          patron ya existente en el boton de grabar (`disabled={room === null}`). */}
      <button
        type="button"
        className={styles.btn}
        aria-pressed={micOn}
        disabled={audioDisabled}
        title={audioTitle}
        onClick={onToggleMic}
      >
        {micOn ? '🎙️ Mic' : '🔇 Mic'}
      </button>
      <button
        type="button"
        className={styles.btn}
        aria-pressed={camOn}
        disabled={audioDisabled}
        title={audioTitle}
        onClick={onToggleCam}
      >
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
        {dnd ? (
          // Anunciar "Audio por proximidad" mientras nada es audible seria
          // mentir sobre lo unico que esta linea existe para contar.
          <>🔴 No molestar: aislado del audio de la oficina</>
        ) : room ? (
          <>
            🔒 Sala privada: <b>{room}</b> — audio aislado
          </>
        ) : (
          <>
            Audio por <b>proximidad</b>
          </>
        )}
      </div>
    </div>
  );
}
