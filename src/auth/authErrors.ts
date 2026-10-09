/**
 * Traduccion de los fallos de autenticacion a texto para la persona (#8).
 * Pura y sin importar firebase: solo lee el campo `code`, que es la unica
 * parte estable del error del SDK.
 *
 * El mensaje crudo del proveedor NUNCA llega a la pantalla. Esta escrito en
 * ingles, para quien programa, y suele arrastrar detalles internos
 * ("Firebase: INTERNAL ASSERTION FAILED...") que no ayudan a nadie a entrar.
 */

import { accessDeniedReasonOf, type AccessDeniedReason } from '../game/officeProtocol';

/** Ultimo recurso: tambien cubre lo que no es un `Error` (un `throw` raro, un rechazo con string). */
const GENERIC_MESSAGE = 'No se pudo iniciar sesión.';

/**
 * Un unico mensaje para los tres codigos de credencial equivocada.
 *
 * No es pereza: separarlos convertiria la pantalla de login en un oraculo de
 * enumeracion de cuentas. "Ese correo no existe" contra "contrasena
 * incorrecta" le dice a cualquiera que pruebe direcciones quien tiene cuenta
 * en la oficina, que es justo lo que no debe poder averiguarse desde fuera.
 * `authErrors.test.ts` lo fija como regresion de seguridad.
 */
const WRONG_CREDENTIALS_MESSAGE = 'Correo o contraseña incorrectos.';

const MESSAGES: Readonly<Record<string, string>> = {
  'auth/invalid-email': 'El correo no tiene un formato válido.',
  'auth/invalid-credential': WRONG_CREDENTIALS_MESSAGE,
  'auth/wrong-password': WRONG_CREDENTIALS_MESSAGE,
  'auth/user-not-found': WRONG_CREDENTIALS_MESSAGE,
  'auth/user-disabled': 'Esta cuenta está desactivada.',
  'auth/too-many-requests': 'Demasiados intentos. Vuelve a probar en unos minutos.',
  'auth/network-request-failed': 'No se pudo contactar con el servidor de autenticación.',
  // No es un error de quien escribe: el proyecto de GCP no tiene habilitado
  // el metodo de correo y contrasena, asi que no entrara nadie hasta que se
  // active. Decirle "credenciales incorrectas" le haria repetir sus datos
  // para siempre.
  'auth/operation-not-allowed':
    'El acceso con correo y contraseña no está habilitado en la configuración del proyecto.',
};

function codeOf(error: unknown): string | null {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' ? code : null;
}

export function describeAuthError(error: unknown): string {
  const code = codeOf(error);
  if (code === null) return GENERIC_MESSAGE;
  return MESSAGES[code] ?? GENERIC_MESSAGE;
}

/** Keep the recovery offer identical for all credential failures, too. */
export function isWrongCredentials(error: unknown): boolean {
  const code = codeOf(error);
  return code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found';
}

/**
 * Codes that must look exactly like a sent email (#94). Same anti-enumeration
 * rule as `WRONG_CREDENTIALS_MESSAGE`: "no account with that email" or "that
 * account is disabled" would tell anyone probing addresses who has an account
 * in the office. The provider may already hide them (email enumeration
 * protection), but this does not depend on that project setting.
 */
const RESET_LOOKS_SENT: ReadonlySet<string> = new Set(['auth/user-not-found', 'auth/user-disabled']);

const RESET_GENERIC_MESSAGE = 'No se pudo enviar el correo.';

/**
 * Local auth mode (`localAuthAdapter.ts`): accounts live in the server's
 * `LOCAL_AUTH_USERS`, so there is no email to send. The same answer for every
 * address, so it tells nobody which accounts exist.
 */
export const LOCAL_PASSWORD_RESET_UNAVAILABLE = 'auth/local-password-reset-unavailable';

const RESET_MESSAGES: Readonly<Record<string, string>> = {
  [LOCAL_PASSWORD_RESET_UNAVAILABLE]:
    'Las cuentas locales no recuperan la contraseña por correo. Pídesela a quien administra la oficina.',
  'auth/invalid-email': MESSAGES['auth/invalid-email'],
  'auth/missing-email': 'Escribe tu correo.',
  'auth/too-many-requests': MESSAGES['auth/too-many-requests'],
  'auth/network-request-failed': MESSAGES['auth/network-request-failed'],
};

/**
 * Translation for the "forgot your password" flow (#94). `null` means "show the
 * neutral confirmation", which is what the person sees on success too.
 */
export function describePasswordResetError(error: unknown): string | null {
  const code = codeOf(error);
  if (code === null) return RESET_GENERIC_MESSAGE;
  if (RESET_LOOKS_SENT.has(code)) return null;
  return RESET_MESSAGES[code] ?? RESET_GENERIC_MESSAGE;
}

/**
 * Why the office sent the person back to the login (#129), from the reason the
 * server gave when it refused the join. A `Record` and not a lookup with a
 * fallback: a new reason does not compile until it has its own notice.
 */
const ACCESS_DENIED_NOTICES: Readonly<Record<AccessDeniedReason, string>> = {
  expired: 'Tu sesión caducó. El administrador debe darte acceso a la oficina.',
  revoked: 'Acceso retirado: un administrador retiró tu acceso a la oficina. Contacta con un administrador.',
  'not-provisioned': 'Tu cuenta no está dada de alta en la oficina. Pide a un administrador que te invite.',
  unauthorized: 'No se pudo comprobar tu sesión. Vuelve a iniciar sesión.',
  'session-expired': 'Tu sesión caducó. Vuelve a iniciar sesión.',
};

export function describeAccessDenied(reason: AccessDeniedReason): string {
  return ACCESS_DENIED_NOTICES[reason];
}

export type AccessDeniedResult = { outcome: 'denied'; reason: AccessDeniedReason };

/** A 401 is a refusal even from an older server or a non-JSON proxy response. */
export async function readAccessDenied(response: Response): Promise<AccessDeniedResult> {
  let body: { reason?: unknown } | null = null;
  try {
    body = await response.json();
  } catch {
    // Never turn an unreadable refusal into a name/character retry.
  }
  return { outcome: 'denied', reason: accessDeniedReasonOf(body?.reason) };
}
