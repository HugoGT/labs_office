import { describe, expect, it } from 'vitest';
import { DEFAULT_NAME } from '../game/officeProtocol';
import { deriveDisplayName } from './authPort';

describe('deriveDisplayName', () => {
  it('prefiere el displayName del perfil', () => {
    expect(deriveDisplayName({ displayName: 'Ana Torres', email: 'ana@example.com' })).toBe(
      'Ana Torres',
    );
  });

  it('cae a la parte local del correo cuando no hay displayName', () => {
    expect(deriveDisplayName({ displayName: null, email: 'ana.torres@example.com' })).toBe(
      'ana.torres',
    );
  });

  it('un displayName en blanco no gana al correo: recortar deja vacio', () => {
    expect(deriveDisplayName({ displayName: '   ', email: 'ana@example.com' })).toBe('ana');
  });

  it('recorta los espacios del displayName', () => {
    expect(deriveDisplayName({ displayName: '  Ana Torres  ' })).toBe('Ana Torres');
  });

  it('sin displayName ni correo usa el nombre por defecto del protocolo', () => {
    expect(deriveDisplayName({})).toBe(DEFAULT_NAME);
    expect(deriveDisplayName({ displayName: null, email: null })).toBe(DEFAULT_NAME);
  });

  it('nunca devuelve una cadena vacia, ni con un correo degenerado', () => {
    // Un nombre vacio dejaria un avatar sin etiqueta en la oficina; el
    // defecto es preferible a mostrar nada.
    expect(deriveDisplayName({ email: '@example.com' })).toBe(DEFAULT_NAME);
    expect(deriveDisplayName({ email: '   ' })).toBe(DEFAULT_NAME);
  });

  it('coincide en espiritu con la derivacion del servidor: perfil, correo, defecto', () => {
    // `server/src/OfficeRoom.ts` (`deriveIdentityName`) vuelve a derivar el
    // nombre desde el token y ES el que ven los demas. Si los dos criterios
    // divergieran, cada uno se veria con un nombre distinto al que muestra a
    // los otros.
    expect(deriveDisplayName({ displayName: 'Ana', email: 'otra@example.com' })).toBe('Ana');
    expect(deriveDisplayName({ email: 'otra@example.com' })).toBe('otra');
  });
});
