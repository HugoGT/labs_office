import type { OfficeEventMap } from '../game/officeBridge';
import { DO_NOT_DISTURB, PRESENCE_STATUSES, type PresenceStatus } from '../game/officeProtocol';
import { STATUS_EMOJI, STATUS_LABEL, statusCssColor } from '../game/presence';
import styles from './BottomBar.module.css';

export interface BottomBarProps {
  /**
   * Nombre del usuario local, ya resuelto por quien conoce la sesion (#6).
   * Llega plano a proposito: esta barra es presentacional (D3) y no debe
   * aprender que existe una sesion para poder escribir un nombre.
   */
  playerName: string;
  micOn: boolean;
  camOn: boolean;
  /** `false` mientras no hay conexion viva a LiveKit (matriz de degradacion). */
  audioAvailable: boolean;
  recording: boolean;
  room: string | null;
  /**
   * Salud de la sesion con el servidor de avatares (#52). Llega entera desde
   * el puente, tal cual: esta barra no deriva `state` de `online` ni al reves
   * -- dos fuentes para el mismo hecho acabarian discrepando en algun render,
   * por la misma razon que `dnd` se deriva de `status` y no se recibe aparte.
   */
  presence: OfficeEventMap['presence'];
  status: PresenceStatus;
  onChangeStatus: (status: PresenceStatus) => void;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onToggleRecord: () => void;
  /**
   * Pide reintentar la conexion perdida (#52). Callback y no accion propia: la
   * barra sigue siendo presentacional (D3) y no sabe que existe un puente, ni
   * mucho menos un servidor al que volver.
   */
  onRetryConnection: () => void;
  /** Own screen share is published (#20). */
  screenShareOn: boolean;
  /** Connected to a space room: shares are per space, never on the open floor (#20). */
  screenShareAvailable: boolean;
  onToggleScreenShare: () => void;
}

/** Explica el `disabled` de mic/camara cuando no hay conexion viva a LiveKit. */
const AUDIO_UNAVAILABLE_TITLE = 'Audio no disponible: sin conexion a LiveKit';

/** El otro motivo de `disabled`, y el unico que el usuario puede deshacer solo. */
const DND_TITLE = 'No molestar: no publicas micrófono ni cámara';

/** Same reason and wording as the record button: both only exist inside a space. */
const ONLY_IN_SPACE_TITLE = 'Solo disponible dentro de una sala';

const SCREEN_SHARE_DND_TITLE = 'No molestar: no compartes pantalla';

/**
 * Un title por estado de sesion (#52). Reciclar el de "conectado" para la
 * reconexion dejaria a quien pasa el raton leyendo que hay servidor justo
 * mientras la barra dice que no lo hay.
 */
const PRESENCE_TITLE = {
  reconnecting: 'Se perdio la conexión: recuperando la sesión sin recargar la página',
  offline: 'Sin servidor: la oficina corre en solitario',
  replaced: 'Abriste la oficina en otra pestaña o dispositivo',
} as const;

/**
 * Barra inferior: mic/camara/grabar + estado de audio, portada de `#bar`
 * (`index.html`, `app.js:516-571`). Puramente presentacional (D3): no recibe
 * el bridge, solo props y callbacks. Los chips de cercania se retiraron
 * (issue #17, D9): cada companero audible ahora tiene su propio tile de
 * video, que ya trae su nombre -- la informacion no se perdio, cambio de casa.
 */
export function BottomBar({
  playerName,
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
  onRetryConnection,
  screenShareOn,
  screenShareAvailable,
  onToggleScreenShare,
}: BottomBarProps) {
  // Se deriva del estado en vez de recibirse como prop propia: dos fuentes
  // para el mismo hecho acabarian discrepando en algun render.
  const dnd = status === DO_NOT_DISTURB;
  const audioDisabled = !audioAvailable || dnd;
  // El motivo que el usuario puede deshacer va primero: sin LiveKit no hay
  // nada que hacer desde aqui, pero salir de "No molestar" esta a un clic.
  const audioTitle = dnd ? DND_TITLE : audioAvailable ? undefined : AUDIO_UNAVAILABLE_TITLE;
  // Same order of reasons, plus the one only sharing has: being in a space.
  const screenShareDisabled = audioDisabled || !screenShareAvailable;
  const screenShareTitle = dnd
    ? SCREEN_SHARE_DND_TITLE
    : !audioAvailable
      ? AUDIO_UNAVAILABLE_TITLE
      : screenShareAvailable
        ? undefined
        : ONLY_IN_SPACE_TITLE;

  return (
    // Three sibling blocks placed by the CSS grid: one row on wide screens
    // (identity, controls and indicators side by side, #87), two on narrow
    // ones. The height never depends on how much the indicators say (#67).
    <div className={styles.bar}>
      <div className={styles.me} role="group" aria-label="Identidad">
        <span className={styles.meDot} style={{ background: statusCssColor(status) }} />{' '}
        {playerName}
        <select
          className={styles.statusSelect}
          aria-label="Mi estado"
          value={status}
          onChange={(event) => onChangeStatus(event.target.value as PresenceStatus)}
        >
          {PRESENCE_STATUSES.map((code) => (
            <option key={code} value={code}>
              {STATUS_EMOJI[code]} {STATUS_LABEL[code]}
            </option>
          ))}
        </select>
      </div>
      <div className={styles.controls} role="toolbar" aria-label="Controles de llamada">
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
          aria-pressed={screenShareOn}
          disabled={screenShareDisabled}
          title={screenShareTitle}
          onClick={onToggleScreenShare}
        >
          {screenShareOn ? '🖥️ Dejar de compartir' : '🖥️ Compartir'}
        </button>
        <button
          type="button"
          className={styles.btn}
          disabled={room === null}
          title={room === null ? ONLY_IN_SPACE_TITLE : undefined}
          onClick={onToggleRecord}
        >
          {recording ? '⏹ Detener' : '⏺ Grabar'}
        </button>
      </div>
      <div className={styles.info} role="group" aria-label="Estado">
        <div className={styles.status}>
          {dnd ? (
            // Anunciar "Audio por proximidad" mientras nada es audible seria
            // mentir sobre lo unico que esta linea existe para contar.
            <>🔴 No molestar: aislado del audio de la oficina</>
          ) : room ? (
            <>
              🔒 Sala privada: <b>{room}</b>
            </>
          ) : (
            <>
              Audio por <b>proximidad</b>
            </>
          )}
        </div>
        {/* Connected says nothing here: who is online, and how many, lives in
            the sidebar roster. Only a broken session earns a spot in the bar. */}
        {presence.state !== 'connected' && (
          <div className={styles.presence} title={PRESENCE_TITLE[presence.state]}>
            {presence.state === 'reconnecting' ? (
              // Sin recuento: los pares de antes de la caida siguen en el registro
              // de la escena, pero ahora mismo no hay canal con ninguno, y contarlos
              // seria decir que estan cuando no se les oye.
              <>🟡 Reconectando...</>
            ) : presence.state === 'replaced' ? (
              // #78: the account moved to another tab. Normally `App` unmounts
              // the office before this paints; it is here so the bar never
              // claims "Sin servidor" for a server that is fine.
              <>Abierta en otra pestaña</>
            ) : (
              <>⚪ Sin servidor</>
            )}
          </div>
        )}
        {/* Solo cuando la sesion se perdio Y hay servidor configurado al que
            volver: en modo solitario no hay nada que reintentar, y mientras
            reconecta ya se esta reintentando solo. */}
        {presence.state === 'offline' && presence.canRetry && (
          <button
            type="button"
            className={styles.btn}
            title="Volver a conectar con el servidor de avatares reales"
            onClick={onRetryConnection}
          >
            🔄 Reintentar
          </button>
        )}
      </div>
    </div>
  );
}
