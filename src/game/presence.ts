/**
 * Vocabulario de PRESENTACION de la presencia: como se pinta y como se nombra
 * cada estado. El vocabulario de protocolo (los codigos y su validacion) vive
 * en `officeProtocol.ts`, que es lo unico que comparte con el servidor.
 *
 * Vive aqui y ya no en `npcData.ts` porque desde #1 estas etiquetas describen
 * a personas reales -- el estado que cada cual elige en la barra inferior y el
 * que llega por Colyseus -- y no solo al roster de NPCs simulados. Dejarlas
 * junto al roster invitaba a creer que cambiarlas solo afectaba al decorado.
 *
 * Sin dependencias de Phaser ni del DOM: lo consumen las dos capas.
 */

import type { PresenceStatus } from './officeProtocol';

/** Color del punto de estado de la pildora de nombre (app.js:53). */
export const STATUS_COLOR: Record<PresenceStatus, number> = {
  g: 0x22c55e,
  y: 0xeab308,
  r: 0xef4444,
};

/**
 * Etiqueta visible. "Ocupado" es senal social pura (se sigue escuchando);
 * "No molestar" es la unica que promete algo sobre el audio, y por eso se
 * llama como se llama en vez de "En reunión".
 */
export const STATUS_LABEL: Record<PresenceStatus, string> = {
  g: 'En línea',
  y: 'Ocupado',
  r: 'No molestar',
};

/**
 * The same color as a glyph, for places that only take text: a native
 * `<option>` cannot hold the styled dot next to the name (#67).
 */
export const STATUS_EMOJI: Record<PresenceStatus, string> = {
  g: '🟢',
  y: '🟡',
  r: '🔴',
};

/**
 * El mismo color, en la forma que entiende el DOM. La conversion vive aqui y
 * no repetida en cada componente: el relleno a seis digitos es facil de
 * olvidar y un color a medio escribir no falla, simplemente se pinta mal.
 */
export function statusCssColor(status: PresenceStatus): string {
  return `#${STATUS_COLOR[status].toString(16).padStart(6, '0')}`;
}
