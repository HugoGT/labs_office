/**
 * La contrasena de una invitacion se genera aqui y se ensena UNA sola vez
 * (#24, punto 3). Lo que hay que demostrar no es que "funcione": es que el
 * alfabeto no tenga caracteres que un humano confunde al copiarla a mano, que
 * la longitud deje entropia de sobra, y que dos llamadas no se parezcan.
 */

import { describe, expect, it } from 'vitest';
import {
  generatePassword,
  PASSWORD_ALPHABET,
  PASSWORD_LENGTH,
} from './generatePassword.ts';

describe('generatePassword', () => {
  it('no usa ningun caracter ambiguo al transcribir', () => {
    // Estos seis son los que se confunden entre si en casi cualquier tipografia
    // (cero/O mayuscula, uno/ele minuscula/I mayuscula, o minuscula/cero). La
    // contrasena la dicta o la copia una persona, una sola vez; una `l` leida
    // como `1` es un fallo de login que nadie sabe explicar.
    for (const ambiguous of ['0', 'O', 'o', '1', 'l', 'I']) {
      expect(PASSWORD_ALPHABET).not.toContain(ambiguous);
    }
  });

  it('el alfabeto no repite caracteres', () => {
    // Un duplicado no romperia nada visible, pero sesgaria la distribucion:
    // ese caracter saldria el doble de veces que los demas.
    expect(new Set(PASSWORD_ALPHABET).size).toBe(PASSWORD_ALPHABET.length);
  });

  it('el alfabeto es lo bastante grande para que la longitud signifique algo', () => {
    // log2(56^20) ~ 116 bits. El minimo de Identity Platform son 6 caracteres;
    // esto no es "el minimo que acepta el proveedor", es una credencial que
    // vive hasta 90 dias y que nadie va a rotar.
    expect(PASSWORD_ALPHABET.length).toBeGreaterThanOrEqual(50);
    expect(PASSWORD_LENGTH).toBeGreaterThanOrEqual(20);
  });

  it('devuelve exactamente PASSWORD_LENGTH caracteres, todos del alfabeto', () => {
    const password = generatePassword();

    expect(password).toHaveLength(PASSWORD_LENGTH);
    for (const char of password) {
      expect(PASSWORD_ALPHABET).toContain(char);
    }
  });

  it('no se repite entre llamadas', () => {
    // Con 2^116 posibilidades, 200 valores iguales solo pasa si la fuente de
    // aleatoriedad no lo es. Es la prueba que cazaria un `Math.random()`
    // sembrado, o peor, una constante.
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(generatePassword());

    expect(seen.size).toBe(200);
  });

  it('usa las dos cajas y los digitos disponibles a lo largo de muchas tiradas', () => {
    // No se exige por contrasena (forzar "al menos un digito" reduce el espacio
    // de busqueda y es justo lo que desaconseja el NIST SP 800-63B); se exige
    // que el generador no se haya quedado atascado en un subconjunto.
    const todo = Array.from({ length: 50 }, () => generatePassword()).join('');

    expect(todo).toMatch(/[a-z]/);
    expect(todo).toMatch(/[A-Z]/);
    expect(todo).toMatch(/[2-9]/);
  });
});
