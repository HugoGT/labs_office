/**
 * Reglas puras del nombre visible auto-elegido en login (#100, D10). Se prueban
 * sin Postgres ni Express: la regla que interesa aqui es "que cadena se guarda
 * y cual se rechaza", y eso se contesta sin infraestructura.
 *
 * La tabla cubre exactamente los casos que D10 promete que JS y SQL nunca
 * pueden discrepar sobre datos ya guardados: tabuladores, NBSP, runs internos,
 * caracteres de control (`\p{Cc}`) y el limite de 24 medido DESPUES de
 * colapsar espacios, no antes.
 */

import { describe, expect, it } from 'vitest';
import {
  canonicalizeDisplayName,
  displayNameKey,
  InvalidDisplayNameError,
} from './displayNameRules.ts';

describe('canonicalizeDisplayName', () => {
  it('recorta espacios al principio y al final', () => {
    expect(canonicalizeDisplayName('  Ana Lopez  ')).toBe('Ana Lopez');
  });

  it('colapsa espacios internos repetidos a uno solo', () => {
    expect(canonicalizeDisplayName('Ana   Lopez')).toBe('Ana Lopez');
  });

  it('un tabulador interno se colapsa a un espacio', () => {
    expect(canonicalizeDisplayName('Ana\tLopez')).toBe('Ana Lopez');
  });

  it('un salto de linea interno se colapsa a un espacio', () => {
    expect(canonicalizeDisplayName('Ana\nLopez')).toBe('Ana Lopez');
  });

  it('un NBSP (U+00A0) cuenta como espacio de \\s y se colapsa', () => {
    expect(canonicalizeDisplayName('Ana Lopez')).toBe('Ana Lopez');
  });

  it('una mezcla de tabuladores y espacios en el mismo hueco se colapsa a uno', () => {
    expect(canonicalizeDisplayName('Ana \t\t  Lopez')).toBe('Ana Lopez');
  });

  it('rechaza una cadena vacia', () => {
    expect(() => canonicalizeDisplayName('')).toThrow(InvalidDisplayNameError);
  });

  it('rechaza una cadena que es solo espacio en blanco', () => {
    expect(() => canonicalizeDisplayName('   \t  ')).toThrow(InvalidDisplayNameError);
  });

  it('rechaza un caracter de control (\\p{Cc}) que sobrevive al colapso de \\s', () => {
    // \x01 no es parte de la clase \s, asi que el colapso no lo toca: tiene que
    // rechazarlo esta guarda y no el colapso de espacios.
    expect(() => canonicalizeDisplayName('Ana\x01Lopez')).toThrow(InvalidDisplayNameError);
  });

  it('acepta exactamente 24 caracteres tras el colapso', () => {
    const name = 'A'.repeat(24);
    expect(canonicalizeDisplayName(name)).toBe(name);
  });

  it('rechaza 25 caracteres tras el colapso', () => {
    expect(() => canonicalizeDisplayName('A'.repeat(25))).toThrow(InvalidDisplayNameError);
  });

  it('el limite de 24 se mide DESPUES de colapsar, no antes', () => {
    // "Ana     Lopez" tiene 13 espacios entre las dos palabras y 22 caracteres
    // en total; tras colapsar son 9 ("Ana Lopez"). Sin colapso previo, una
    // cadena de mas de 24 caracteres crudos pero <= 24 tras colapsar no debe
    // rechazarse.
    const raw = 'A'.repeat(20) + '     ' + 'B'; // 26 caracteres crudos
    expect(canonicalizeDisplayName(raw)).toBe('A'.repeat(20) + ' B'); // 22 tras colapso
  });

  it('rechaza cuando incluso tras colapsar sigue superando el limite', () => {
    const raw = 'A'.repeat(20) + '     ' + 'B'.repeat(10); // colapsa a 31 chars
    expect(() => canonicalizeDisplayName(raw)).toThrow(InvalidDisplayNameError);
  });

  it('no trunca: el error lo dice, nunca recorta en silencio', () => {
    let caught: unknown;
    try {
      canonicalizeDisplayName('A'.repeat(30));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(InvalidDisplayNameError);
  });
});

describe('displayNameKey', () => {
  it('pasa a minusculas', () => {
    expect(displayNameKey('Ana Lopez')).toBe('ana lopez');
  });

  it('dos nombres que difieren solo en mayusculas producen la MISMA clave', () => {
    expect(displayNameKey('ANA LOPEZ')).toBe(displayNameKey('ana lopez'));
  });

  it('no vuelve a colapsar espacios: espera recibir ya el canonico', () => {
    // Contrato: `displayNameKey` se llama SIEMPRE sobre la salida de
    // `canonicalizeDisplayName`, nunca sobre texto crudo.
    expect(displayNameKey('ana  lopez')).toBe('ana  lopez');
  });
});
