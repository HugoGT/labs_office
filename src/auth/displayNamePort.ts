/**
 * Puerto del cliente HTTP para el nombre visible auto-elegido en login (#100).
 * Describe lo que `AuthGate`/`useDisplayName` necesitan del servidor, no como
 * se pide: este archivo no importa `fetch`, igual que `authPort.ts` no importa
 * firebase. El adaptador (`displayNameClient.ts`) es el unico que habla HTTP.
 *
 * Los outcomes son discriminantes cerrados y no un booleano + un motivo suelto:
 * `taken` e `invalid` piden acciones distintas de la persona (elegir otro
 * nombre vs. corregir el que escribio), y `unavailable` (sin directorio) no es
 * un fallo -- es "esta oficina no impone unicidad hoy", que se resuelve
 * entrando con el nombre derivado, no reintentando.
 */

export type ClaimDisplayNameResult =
  | { outcome: 'ok'; displayName: string }
  | { outcome: 'taken' | 'invalid' | 'unavailable' | 'failed' };

export type ReadDisplayNameResult =
  | { outcome: 'ok'; displayName: string | null }
  | { outcome: 'unavailable' | 'failed' };

export interface DisplayNamePort {
  /** `name` es el texto crudo del formulario; el servidor lo canonicaliza. */
  claim(name: string): Promise<ClaimDisplayNameResult>;
  /** Lectura para la restauracion de sesion (D6): sin reclamar nada. */
  read(): Promise<ReadDisplayNameResult>;
}
