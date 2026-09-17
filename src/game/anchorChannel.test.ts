import { describe, expect, it } from 'vitest';
import { createAnchorChannel } from './anchorChannel';

/**
 * `anchorChannel` es el primer canal continuo (por-cuadro) del puente
 * Phaser<->React (issue #17, D4). La guarda de epoca es lo unico no obvio:
 * `open()` invalida al escritor anterior de forma INCONDICIONAL, sin
 * depender de que su `close()` se haya ejecutado antes -- React StrictMode
 * remonta dos veces y `GameCanvas` hace un `destroy(true)` duro, asi que el
 * orden de apagado nunca es una suposicion segura.
 */
describe('createAnchorChannel: guarda de epoca y poda por cuadro (issue #17, D4)', () => {
  it('arranca con generation 0 y sin anclas', () => {
    const channel = createAnchorChannel();

    const frame = channel.snapshot();

    expect(frame.generation).toBe(0);
    expect(frame.anchors.size).toBe(0);
  });

  it('commit() poda los ids no fijados en ese mismo cuadro', () => {
    const channel = createAnchorChannel();
    const writer = channel.open();

    writer.set('a', 1, 2, true);
    writer.commit();
    expect(channel.snapshot().anchors.has('a')).toBe(true);

    // El siguiente cuadro solo fija 'b': 'a' no se toca y debe podarse.
    writer.set('b', 3, 4, true);
    writer.commit();

    const frame = channel.snapshot();
    expect(frame.anchors.has('a')).toBe(false);
    expect(frame.anchors.get('b')).toEqual({ x: 3, y: 4, onScreen: true });
  });

  it('generation avanza de forma monotonica en cada commit(), nunca retrocede', () => {
    const channel = createAnchorChannel();
    const writer = channel.open();

    writer.set('a', 0, 0, true);
    writer.commit();
    const first = channel.snapshot().generation;

    writer.set('a', 1, 1, true);
    writer.commit();
    const second = channel.snapshot().generation;

    expect(second).toBeGreaterThan(first);
  });

  it('set() sin commit() todavia no adelanta generation', () => {
    const channel = createAnchorChannel();
    const writer = channel.open();
    const before = channel.snapshot().generation;

    writer.set('a', 1, 1, true);

    expect(channel.snapshot().generation).toBe(before);
  });

  it('un open() nuevo invalida al escritor anterior: sus llamadas posteriores pasan a ser no-ops silenciosos', () => {
    const channel = createAnchorChannel();
    const stale = channel.open();
    stale.set('viejo', 1, 1, true);
    stale.commit(); // valido: `stale` seguia siendo el escritor vigente aqui
    const generationAfterStaleCommit = channel.snapshot().generation;

    channel.open(); // invalida a `stale` sin que nadie llame a close()

    // No-ops silenciosos: ni agregan 'otro-viejo' ni avanzan generation.
    stale.set('otro-viejo', 2, 2, true);
    stale.commit();

    const frame = channel.snapshot();
    expect(frame.anchors.has('otro-viejo')).toBe(false);
    expect(frame.generation).toBe(generationAfterStaleCommit);
  });

  it('close() vuelve mudo al propio escritor: no borra lo ya comprometido, solo deja de aceptar escrituras nuevas', () => {
    const channel = createAnchorChannel();
    const writer = channel.open();
    writer.set('a', 1, 1, true);
    writer.commit();

    writer.close();
    writer.set('a', 99, 99, true);
    writer.commit();

    expect(channel.snapshot().anchors.get('a')).toEqual({ x: 1, y: 1, onScreen: true });
  });

  it('un close() tardio de un escritor ya reemplazado no re-invalida al escritor vigente', () => {
    const channel = createAnchorChannel();
    const first = channel.open();
    const second = channel.open(); // ya invalida a `first`

    second.set('nuevo', 5, 5, true);
    second.commit();
    first.close(); // tardio: no debe tocar la epoca vigente de `second`

    second.set('nuevo', 6, 6, true);
    second.commit();

    expect(channel.snapshot().anchors.get('nuevo')).toEqual({ x: 6, y: 6, onScreen: true });
  });
});
