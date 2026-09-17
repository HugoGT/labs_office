import { describe, expect, it } from 'vitest';
import { describeAdminError } from './adminErrors';
import { AdminError, type AdminErrorCode } from './adminPort';

const CODES: AdminErrorCode[] = [
  'unauthorized',
  'forbidden',
  'invalid-request',
  'conflict',
  'identity-admin-not-configured',
  'network',
  'unknown',
];

describe('describeAdminError', () => {
  it('cada codigo tiene su propia frase, no un "algo salio mal" unico', () => {
    const messages = CODES.map((code) => describeAdminError(new AdminError(code)));

    // Ninguna frase se repite: cada fallo se arregla en un sitio distinto.
    expect(new Set(messages).size).toBe(CODES.length);
  });

  it('todas las frases estan en castellano y para la persona, no para la consola', () => {
    for (const code of CODES) {
      const message = describeAdminError(new AdminError(code));
      expect(message).toMatch(/^[A-ZÁÉÍÓÚÑ]/);
      expect(message).toMatch(/\.$/);
      // El codigo interno nunca llega a la pantalla.
      expect(message).not.toContain(code);
    }
  });

  it('un 503 no le echa la culpa a quien invita', () => {
    // Es el servidor el que no tiene credenciales de administracion de
    // Identity Platform (#24, seccion 3): "inténtalo de nuevo" haria repetir
    // el intento para siempre.
    expect(describeAdminError(new AdminError('identity-admin-not-configured'))).toMatch(
      /servidor/i,
    );
  });

  it('las frases compartidas por los dos flujos no nombran solo uno', () => {
    // `invalid-request` y `conflict` los devuelven tanto el alta de invitacion
    // como la de alguien de casa. Una frase que diga "invitación" convertiria
    // un 409 al dar de alta a un empleado en una explicacion falsa: ese correo
    // no tiene ninguna invitacion, tiene una cuenta.
    for (const code of ['invalid-request', 'conflict'] as const) {
      expect(describeAdminError(new AdminError(code))).not.toMatch(/invitaci/i);
    }
  });

  it('lo que no es un AdminError cae al mensaje generico', () => {
    // Un `throw` raro o un rechazo con string no puede dejar la pantalla muda.
    expect(describeAdminError(new Error('boom'))).toBe(describeAdminError(null));
    expect(describeAdminError('boom')).toBe(describeAdminError(undefined));
    expect(describeAdminError(null)).toMatch(/\S/);
  });
});
