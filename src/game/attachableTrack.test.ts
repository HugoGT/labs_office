import { describe, expect, it } from 'vitest';
import { createRemoteAudioSink } from './remoteAudioSink';
import type { AttachableTrack } from './attachableTrack';

/**
 * `AttachableTrack` se mueve de `remoteAudioSink.ts` a su propio archivo
 * (issue #17, D3): esta suite prueba que el tipo compartido sigue sirviendo
 * al sink de audio EXACTAMENTE igual (sin cambio de comportamiento) y que la
 * misma forma estructural tambien es valida para una pista de video -- la
 * mitad que `livekitRoom.ts` necesitara para reportar video hacia afuera.
 */
function fakeTrack(kind: 'audio' | 'video'): AttachableTrack {
  const elements: HTMLMediaElement[] = [];
  return {
    kind,
    attach() {
      const element = document.createElement(kind === 'audio' ? 'audio' : 'video');
      elements.push(element);
      return element;
    },
    detach: () => elements.splice(0),
  };
}

describe('AttachableTrack (contrato compartido, movido de remoteAudioSink.ts)', () => {
  it('una pista de kind "audio" sigue siendo valida para createRemoteAudioSink: sin cambio de comportamiento', () => {
    const container = document.createElement('div');
    const sink = createRemoteAudioSink(container);

    sink.add(fakeTrack('audio'));

    expect(container.querySelectorAll('audio')).toHaveLength(1);
  });

  it('la misma forma tambien es valida para una pista de kind "video": el sink de audio la ignora', () => {
    const container = document.createElement('div');
    const sink = createRemoteAudioSink(container);
    const track = fakeTrack('video');

    sink.add(track);

    // El contrato estructural no distingue kinds; la regla de "solo audio"
    // vive en el sink, no en el tipo. Por eso el elemento existe (attach() ya
    // se probo suelto) pero nunca llega al DOM via este sink.
    expect(track.attach().tagName.toLowerCase()).toBe('video');
    expect(container.querySelectorAll('video')).toHaveLength(0);
  });
});
