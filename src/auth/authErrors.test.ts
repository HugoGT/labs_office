import { describe, expect, it } from 'vitest';
import { describeAuthError, describePasswordResetError } from './authErrors';

/** Imita el `FirebaseError` del SDK: lo unico que se lee de el es `code`. */
function firebaseError(code: string, message = 'Firebase: Error (auth/...).'): unknown {
  return Object.assign(new Error(message), { code });
}

describe('describeAuthError', () => {
  it('traduce un correo con formato invalido', () => {
    expect(describeAuthError(firebaseError('auth/invalid-email'))).toBe(
      'El correo no tiene un formato válido.',
    );
  });

  it('traduce la cuenta desactivada', () => {
    expect(describeAuthError(firebaseError('auth/user-disabled'))).toBe(
      'Esta cuenta está desactivada.',
    );
  });

  it('traduce el limite de intentos', () => {
    expect(describeAuthError(firebaseError('auth/too-many-requests'))).toBe(
      'Demasiados intentos. Vuelve a probar en unos minutos.',
    );
  });

  it('traduce el fallo de red', () => {
    expect(describeAuthError(firebaseError('auth/network-request-failed'))).toBe(
      'No se pudo contactar con el servidor de autenticación.',
    );
  });

  it('el metodo no habilitado apunta a la configuracion, no culpa al usuario', () => {
    // Significa que email+password no esta activado en el proyecto de GCP:
    // nadie podra entrar por mucho que escriba bien sus datos.
    const message = describeAuthError(firebaseError('auth/operation-not-allowed'));

    expect(message).toMatch(/configurac/i);
    expect(message).not.toMatch(/incorrect/i);
  });

  it('un codigo desconocido cae en el mensaje generico', () => {
    expect(describeAuthError(firebaseError('auth/internal-error'))).toBe(
      'No se pudo iniciar sesión.',
    );
  });

  it('un valor que no es un Error tampoco rompe', () => {
    expect(describeAuthError(undefined)).toBe('No se pudo iniciar sesión.');
    expect(describeAuthError('boom')).toBe('No se pudo iniciar sesión.');
    expect(describeAuthError({ code: 42 })).toBe('No se pudo iniciar sesión.');
    expect(describeAuthError(null)).toBe('No se pudo iniciar sesión.');
  });

  it('nunca filtra el mensaje crudo del proveedor a la pantalla', () => {
    const message = describeAuthError(
      firebaseError('auth/internal-error', 'Firebase: INTERNAL ASSERTION FAILED (auth/xyz).'),
    );

    expect(message).not.toMatch(/Firebase/);
    expect(message).not.toMatch(/auth\//);
  });
});

describe('describeAuthError: regresion de seguridad (enumeracion de cuentas)', () => {
  it('credencial invalida, contrasena erronea y usuario inexistente dan EL MISMO mensaje', () => {
    // Distinguirlos convertiria la pantalla de login en un oraculo: cualquiera
    // podria probar direcciones y saber cuales tienen cuenta en la oficina.
    const invalidCredential = describeAuthError(firebaseError('auth/invalid-credential'));
    const wrongPassword = describeAuthError(firebaseError('auth/wrong-password'));
    const userNotFound = describeAuthError(firebaseError('auth/user-not-found'));

    expect(invalidCredential).toBe('Correo o contraseña incorrectos.');
    expect(wrongPassword).toBe(invalidCredential);
    expect(userNotFound).toBe(invalidCredential);
  });

  it('el mensaje compartido no menciona si la cuenta existe', () => {
    const message = describeAuthError(firebaseError('auth/user-not-found'));

    expect(message).not.toMatch(/existe|registrad|encontrad/i);
  });
});

describe('describePasswordResetError (#94)', () => {
  it('REGRESSION: an unknown or disabled account reads as sent, never as an error', () => {
    // Anything else would turn "forgot your password" into an oracle that tells
    // anyone probing addresses who has an account in the office.
    for (const code of ['auth/user-not-found', 'auth/user-disabled']) {
      expect(describePasswordResetError(firebaseError(code))).toBeNull();
    }
  });

  it('translates the errors the person can act on', () => {
    expect(describePasswordResetError(firebaseError('auth/invalid-email'))).toBe(
      'El correo no tiene un formato válido.',
    );
    expect(describePasswordResetError(firebaseError('auth/too-many-requests'))).toBe(
      'Demasiados intentos. Vuelve a probar en unos minutos.',
    );
    expect(describePasswordResetError(firebaseError('auth/network-request-failed'))).toBe(
      'No se pudo contactar con el servidor de autenticación.',
    );
  });

  it('falls back to a reset-specific message, not the sign-in one', () => {
    for (const error of [firebaseError('auth/internal-error'), 'raro', null, undefined]) {
      expect(describePasswordResetError(error)).toBe('No se pudo enviar el correo.');
    }
  });

  it('never leaks the raw provider message', () => {
    const message = describePasswordResetError(
      firebaseError('auth/internal-error', 'Firebase: INTERNAL ASSERTION FAILED'),
    );

    expect(message).not.toMatch(/firebase|assertion/i);
  });
});
