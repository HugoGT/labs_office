/**
 * Geometria pura de rectangulos (#74, PR3a). Casos portados tal cual desde
 * `server/src/spaces/spaceRules.test.ts`, donde `boundsOverlap` vivia antes
 * de esta rebanada: la garantia que importa es que el comportamiento no
 * cambio al mudarse de sitio, no que el test sea distinto.
 */

import { describe, expect, it } from 'vitest';
import { boundsOverlap } from './layoutGeometry';

describe('boundsOverlap', () => {
  it('detecta solape real (dos rectangulos que comparten area)', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    const b = { x: 5, y: 5, w: 10, h: 10 };
    expect(boundsOverlap(a, b)).toBe(true);
  });

  it('NO detecta solape en rectangulos separados por un hueco', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    const b = { x: 11, y: 0, w: 10, h: 10 };
    expect(boundsOverlap(a, b)).toBe(false);
  });

  it('trata el contacto exacto de borde como solape (verificado contra Postgres real en el spike de #7)', () => {
    // `box && box` de Postgres rechazo un rectangulo que solo tocaba el borde
    // (x=10 contra un rectangulo que termina en x=10) en el spike de la tarea
    // 2.1. El pre-chequeo debe coincidir con eso: si no coincidiera, esta
    // regla dejaria pasar algo que la base de datos rechazaria de todas
    // formas con un 500 en vez de un 400.
    const a = { x: 0, y: 0, w: 10, h: 10 };
    const b = { x: 10, y: 0, w: 10, h: 10 };
    expect(boundsOverlap(a, b)).toBe(true);
  });

  it('es simetrico: da el mismo resultado en cualquier orden de los argumentos', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    const b = { x: 5, y: 5, w: 10, h: 10 };
    expect(boundsOverlap(a, b)).toBe(boundsOverlap(b, a));
  });
});
