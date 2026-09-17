/**
 * Puerto de administracion de cuentas de Identity Platform (#24). Solo tipos,
 * igual que `directoryPort.ts`: aqui no hay ni `fetch` ni JWTs ni urls de
 * Google. El adaptador de produccion es `gcpIdentityAdmin.ts`; en los tests de
 * las rutas se inyecta un doble, y por eso `adminRoutes.test.ts` puede probar
 * el 409, el 503 y la compensacion de la cuenta huerfana sin un proyecto de
 * GCP detras.
 *
 * El puerto tiene DOS operaciones y no una por casualidad: crear la cuenta y
 * desactivarla son las dos mitades del ciclo de vida de un invitado, y la
 * segunda es la que hace que revocar signifique algo antes de que caduque su
 * ID token (ver `adminRoutes.ts`, `handleRevokeInvitation`).
 *
 * Es OPCIONAL de punta a punta, igual que el directorio: sin
 * `IDENTITY_ADMIN_CREDENTIALS` la fabrica devuelve `null`, el servidor arranca
 * igual y lo unico que se degrada es el alta, que responde 503.
 */

export interface IdentityAdmin {
  /** Crea la cuenta en Identity Platform y devuelve su uid. */
  createAccount(email: string, password: string): Promise<string>;
  /** Desactiva la cuenta para que deje de poder renovar su token. */
  disableAccount(uid: string): Promise<void>;
}

/**
 * Dos codigos y no el error crudo de Google. La ruta tiene que distinguir "ese
 * correo ya tiene cuenta" (409, culpa del administrador, se arregla escribiendo
 * otro) de "Identity Platform no responde" (503, no es culpa de nadie y se
 * reintenta), y hacerlo por el TEXTO del mensaje de Google es una atadura a una
 * cadena que ellos pueden reescribir sin avisar. Mismo criterio que
 * `InvalidInvitationError` en `invitationRules.ts`.
 *
 * Todo lo demas -- contrasena debil, permisos IAM mal puestos, cuota agotada,
 * la red caida -- colapsa en `unavailable` a proposito: son fallos distintos
 * para el operador, que los ve en el log, pero la misma respuesta para quien
 * llama, que no puede hacer nada distinto con ninguno de ellos.
 */
export class IdentityAdminError extends Error {
  constructor(readonly code: 'email-exists' | 'unavailable') {
    super(`Fallo de Identity Platform (${code})`);
    // Sin esto, `error.name` seria 'Error' en cualquier traza y en cualquier
    // log, que es justo donde hace falta reconocerlo.
    this.name = 'IdentityAdminError';
  }
}
