/**
 * Las reglas de una invitacion son puras y se prueban solas, sin base de datos.
 * Ambos adaptadores (`pgDirectory` y `memoryDirectory`) las comparten, asi que
 * probarlas aqui una vez evita la trampa de tener dos definiciones de "90 dias"
 * que se separen sin que nadie lo note.
 */

import { describe, expect, it } from 'vitest';
import {
  assertValidInvitationDays,
  expiresAtFrom,
  InvalidInvitationError,
  MAX_INVITATION_DAYS,
  MIN_INVITATION_DAYS,
  normalizeEmail,
} from './invitationRules.ts';

describe('assertValidInvitationDays', () => {
  it('acepta los dos extremos del rango del issue: 1 y 90 dias', () => {
    expect(() => assertValidInvitationDays(MIN_INVITATION_DAYS)).not.toThrow();
    expect(() => assertValidInvitationDays(MAX_INVITATION_DAYS)).not.toThrow();
    expect([MIN_INVITATION_DAYS, MAX_INVITATION_DAYS]).toEqual([1, 90]);
  });

  it('acepta un valor intermedio', () => {
    expect(() => assertValidInvitationDays(30)).not.toThrow();
  });

  it('rechaza justo por debajo y justo por encima del rango', () => {
    expect(() => assertValidInvitationDays(0)).toThrow(InvalidInvitationError);
    expect(() => assertValidInvitationDays(91)).toThrow(InvalidInvitationError);
  });

  it('rechaza los negativos', () => {
    // Un `days` negativo no seria un error benigno: naceria ya caducada y el
    // administrador entregaria unas credenciales que no abren nada.
    expect(() => assertValidInvitationDays(-1)).toThrow(InvalidInvitationError);
  });

  it('rechaza los decimales', () => {
    // El issue dice "entre 1 y 90 dias", no horas. Aceptar 1.5 dejaria una
    // caducidad que el panel no sabe mostrar y que nadie pidio.
    expect(() => assertValidInvitationDays(1.5)).toThrow(InvalidInvitationError);
  });

  it('rechaza NaN e Infinity, que es lo que llega de un `Number(body.days)`', () => {
    expect(() => assertValidInvitationDays(Number.NaN)).toThrow(InvalidInvitationError);
    expect(() => assertValidInvitationDays(Number.POSITIVE_INFINITY)).toThrow(
      InvalidInvitationError,
    );
  });

  it('rechaza lo que ni siquiera es un numero', () => {
    // El cuerpo de una peticion HTTP es JSON sin tipar: `days: "30"` llega como
    // texto y `30 <= 90` seria `true` por coercion. El tipo de TypeScript no
    // esta presente en tiempo de ejecucion, asi que la guarda tiene que estarlo.
    expect(() => assertValidInvitationDays('30' as unknown as number)).toThrow(
      InvalidInvitationError,
    );
    expect(() => assertValidInvitationDays(null as unknown as number)).toThrow(
      InvalidInvitationError,
    );
  });

  it('el error es de un tipo propio para que la ruta pueda responder 400 y no 500', () => {
    // Slice 2 distingue "el administrador escribio mal los dias" de "la base de
    // datos se cayo" por el TIPO, no por el texto del mensaje: un `instanceof`
    // no se rompe al traducir una frase.
    const error = (() => {
      try {
        assertValidInvitationDays(0);
        return null;
      } catch (thrown) {
        return thrown;
      }
    })();

    expect(error).toBeInstanceOf(InvalidInvitationError);
    expect(error).toBeInstanceOf(Error);
    expect((error as InvalidInvitationError).name).toBe('InvalidInvitationError');
  });
});

describe('expiresAtFrom', () => {
  it('suma los dias pedidos al instante de referencia', () => {
    const now = new Date('2026-09-17T12:00:00.000Z');
    expect(expiresAtFrom(now, 1)).toEqual(new Date('2026-09-18T12:00:00.000Z'));
    expect(expiresAtFrom(now, 90)).toEqual(new Date('2026-12-16T12:00:00.000Z'));
  });

  it('no muta la fecha que recibe', () => {
    // `Date` es mutable y `setDate` sobre el argumento corromperia el reloj del
    // llamante en silencio.
    const now = new Date('2026-09-17T12:00:00.000Z');
    expiresAtFrom(now, 30);
    expect(now.toISOString()).toBe('2026-09-17T12:00:00.000Z');
  });
});

describe('normalizeEmail', () => {
  it('pasa a minusculas y recorta', () => {
    expect(normalizeEmail('  Ana@Example.COM ')).toBe('ana@example.com');
  });

  it('es idempotente', () => {
    // La fila se guarda ya normalizada y se busca normalizando otra vez; si la
    // funcion no fuese idempotente, el segundo paso no encontraria al primero.
    expect(normalizeEmail(normalizeEmail('Ana@Example.com'))).toBe('ana@example.com');
  });
});
