import { describe, expect, it } from 'vitest';
import { createRemoteAudioSink, type AttachableTrack } from './remoteAudioSink';

/**
 * Doble estructural de una pista de LiveKit. Reproduce el contrato REAL del
 * SDK, incluida la parte que causa el defecto: `detach()` desvincula la pista
 * de sus elementos pero NO los saca del DOM. Si el sink no los retira, cada
 * salida del radio deja un `<audio>` huerfano pegado a la pagina.
 */
function fakeTrack(kind: 'audio' | 'video' = 'audio'): AttachableTrack {
  const elements: HTMLMediaElement[] = [];
  return {
    kind,
    attach() {
      const element = document.createElement(kind === 'audio' ? 'audio' : 'video');
      elements.push(element);
      return element;
    },
    detach() {
      return elements.splice(0);
    },
  };
}

function attachedElements(container: HTMLElement): HTMLMediaElement[] {
  return Array.from(container.querySelectorAll('audio, video'));
}

describe('createRemoteAudioSink', () => {
  it('adjunta la pista de audio al DOM: suscribirse sin esto es silencio', () => {
    const container = document.createElement('div');
    const sink = createRemoteAudioSink(container);

    sink.add(fakeTrack());

    expect(attachedElements(container)).toHaveLength(1);
  });

  it('el elemento adjunto se reproduce solo y no ocupa layout', () => {
    const container = document.createElement('div');
    const sink = createRemoteAudioSink(container);

    sink.add(fakeTrack());
    const [element] = attachedElements(container);

    expect(element.autoplay).toBe(true);
    expect(element.hidden).toBe(true);
  });

  it('ignora las pistas de video: este sink solo existe para el audio (#17 tiene la suya)', () => {
    const container = document.createElement('div');
    const sink = createRemoteAudioSink(container);

    sink.add(fakeTrack('video'));

    expect(attachedElements(container)).toHaveLength(0);
  });

  it('adjuntar dos veces la misma pista no duplica el elemento (dos veces el mismo audio)', () => {
    const container = document.createElement('div');
    const sink = createRemoteAudioSink(container);
    const track = fakeTrack();

    sink.add(track);
    sink.add(track);

    expect(attachedElements(container)).toHaveLength(1);
  });

  it('remove retira el elemento del DOM, no solo lo desvincula (nada de huerfanos)', () => {
    const container = document.createElement('div');
    const sink = createRemoteAudioSink(container);
    const track = fakeTrack();

    sink.add(track);
    sink.remove(track);

    expect(attachedElements(container)).toHaveLength(0);
  });

  it('remove de una pista que nunca se adjunto no lanza ni toca a las demas', () => {
    const container = document.createElement('div');
    const sink = createRemoteAudioSink(container);
    const attached = fakeTrack();
    sink.add(attached);

    expect(() => sink.remove(fakeTrack())).not.toThrow();
    expect(attachedElements(container)).toHaveLength(1);
  });

  it('clear vacia todas las pistas vivas: es lo que corre en disconnect', () => {
    const container = document.createElement('div');
    const sink = createRemoteAudioSink(container);
    sink.add(fakeTrack());
    sink.add(fakeTrack());

    sink.clear();

    expect(attachedElements(container)).toHaveLength(0);
  });

  it('despues de clear, la misma pista puede volver a adjuntarse (reentrar al radio)', () => {
    const container = document.createElement('div');
    const sink = createRemoteAudioSink(container);
    const track = fakeTrack();

    sink.add(track);
    sink.clear();
    sink.add(track);

    expect(attachedElements(container)).toHaveLength(1);
  });
});
