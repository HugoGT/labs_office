/**
 * Traduccion de los fallos de autenticacion a texto para la persona (#8).
 * Pura y sin importar firebase: solo lee el campo `code`, que es la unica
 * parte estable del error del SDK.
 *
 * El mensaje crudo del proveedor NUNCA llega a la pantalla. Esta escrito en
 * ingles, para quien programa, y suele arrastrar detalles internos
 * ("Firebase: INTERNAL ASSERTION FAILED...") que no ayudan a nadie a entrar.
 */

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

export function describeAuthError(error: unknown): string {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (typeof code !== 'string') return GENERIC_MESSAGE;
  return MESSAGES[code] ?? GENERIC_MESSAGE;
}
