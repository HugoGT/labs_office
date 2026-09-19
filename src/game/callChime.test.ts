import { describe, expect, it, vi } from 'vitest';
import { createCallChime } from './callChime';

function makeRunningContextFake() {
  const oscillator = {
    frequency: { value: 0 },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
  const gain = {
    gain: { value: 0 },
    connect: vi.fn(),
  };
  const ctx = {
    state: 'running',
    currentTime: 0,
    destination: {},
    createOscillator: vi.fn(() => oscillator),
    createGain: vi.fn(() => gain),
  };
  return { ctx, oscillator, gain };
}

describe('createCallChime', () => {
  it('programa un oscilador cuando el AudioContext esta running (D11)', () => {
    const { ctx, oscillator, gain } = makeRunningContextFake();

    const chime = createCallChime(() => ctx as unknown as AudioContext);
    chime.play();

    expect(ctx.createOscillator).toHaveBeenCalledTimes(1);
    expect(oscillator.connect).toHaveBeenCalledWith(gain);
    expect(gain.connect).toHaveBeenCalledWith(ctx.destination);
    expect(oscillator.start).toHaveBeenCalledTimes(1);
    expect(oscillator.stop).toHaveBeenCalledTimes(1);
  });

  it('no hace nada ni lanza cuando el factory devuelve undefined (D11: AudioContext ausente)', () => {
    const makeContext = vi.fn(() => undefined);
    const chime = createCallChime(makeContext);

    expect(() => chime.play()).not.toThrow();
    expect(makeContext).toHaveBeenCalledTimes(1);
  });

  it('no hace nada ni lanza cuando el contexto esta suspended (D11: autoplay bloqueado)', () => {
    const { ctx } = makeRunningContextFake();
    ctx.state = 'suspended';

    const chime = createCallChime(() => ctx as unknown as AudioContext);

    expect(() => chime.play()).not.toThrow();
    expect(ctx.createOscillator).not.toHaveBeenCalled();
  });

  it('sin argumentos, en jsdom (sin AudioContext global) no lanza (degradacion por defecto)', () => {
    const chime = createCallChime();

    expect(() => chime.play()).not.toThrow();
  });

  it('un factory que lanza al construir el contexto tampoco se propaga (best-effort real)', () => {
    const chime = createCallChime(() => {
      throw new Error('AudioContext no disponible en este navegador');
    });

    expect(() => chime.play()).not.toThrow();
  });
});
