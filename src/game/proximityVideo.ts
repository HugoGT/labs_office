/**
 * Regla pura de membresia de VIDEO para LiveKit (issue #17, decision D8).
 * Audio y video usan reglas DISTINTAS a proposito: el video cuesta mucho mas
 * ancho de banda, asi que solo se pide dentro de una sala compartida. En el
 * piso abierto NUNCA se pide video de un par, sin importar el radio -- esta
 * regla es deliberadamente mas angosta que la de audio, no un espejo.
 *
 * El propio video local (la camara del usuario) NO pasa por esta funcion: es
 * una pista local, no una suscripcion, y se gobierna aparte (decision D8,
 * fuera del alcance de este slice).
 *
 * Cero Phaser, cero `livekit-client`: igual que `proximityAudio.ts`, esto es
 * provable por completo bajo jsdom.
 */

export interface VideoPeersInput {
  /** Sala del jugador local. `null` = piso abierto: video de pares nunca se pide. */
  room: string | null;
  /**
   * Conjunto ya audible (salida de `audiblePeers()`): ya excluye al propio
   * sessionId y ya aplica "No molestar". El video reutiliza exactamente ese
   * conjunto -- solo le agrega el candado extra de la sala.
   */
  audibleSessionIds: readonly string[];
}

/**
 * `room !== null ? audibleSessionIds : []` (spec: reconciliacion de video).
 * Deliberadamente mas angosta que el audio: el piso abierto nunca suscribe
 * video de un par, sin importar la cercania.
 */
export function videoPeers(input: VideoPeersInput): string[] {
  return input.room !== null ? [...input.audibleSessionIds] : [];
}
