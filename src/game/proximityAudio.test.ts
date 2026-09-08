import { describe, expect, it } from 'vitest';
import { PROX_RADIUS } from './mapData';
import { audiblePeers, reconcileSubscriptions, type AudioPeer } from './proximityAudio';

/**
 * `audiblePeers` es el objetivo mas valioso de esta prueba TDD: decide quien
 * escucha a quien. Un bug aqui es un defecto de privacidad, no de UX.
 */
describe('audiblePeers: en una sala, la sala manda y el radio se ignora', () => {
  it('un par a un pixel fuera del rectangulo de la sala queda en silencio, aunque este pegado', () => {
    const self = { sessionId: 'yo', x: 0, y: 0, room: 'Sala de Juntas' };
    const peerFuera: AudioPeer = { sessionId: 'vecino', x: 0, y: 0, room: null };

    const audibles = audiblePeers({ self, peers: [peerFuera], radius: PROX_RADIUS });

    expect(audibles).toEqual([]);
  });

  it('dos personas en la misma sala se escuchan sin importar la distancia exacta', () => {
    const self = { sessionId: 'yo', x: 0, y: 0, room: 'Cafetería' };
    const peerLejos: AudioPeer = { sessionId: 'companero', x: 99999, y: 99999, room: 'Cafetería' };

    const audibles = audiblePeers({ self, peers: [peerLejos], radius: PROX_RADIUS });

    expect(audibles).toEqual(['companero']);
  });
});

describe('audiblePeers: aislamiento mutuo desde el piso abierto', () => {
  it('un par dentro de una sala NUNCA es audible desde el piso abierto, aunque este cerca', () => {
    const self = { sessionId: 'yo', x: 0, y: 0, room: null };
    const peerEnSala: AudioPeer = { sessionId: 'reunido', x: 5, y: 5, room: 'Sala de Juntas' };

    const audibles = audiblePeers({ self, peers: [peerEnSala], radius: PROX_RADIUS });

    expect(audibles).toEqual([]);
  });

  it('en el piso abierto, un par tambien en el piso abierto y dentro del radio si es audible', () => {
    const self = { sessionId: 'yo', x: 0, y: 0, room: null };
    const peerCerca: AudioPeer = { sessionId: 'colega', x: 50, y: 0, room: null };

    const audibles = audiblePeers({ self, peers: [peerCerca], radius: PROX_RADIUS });

    expect(audibles).toEqual(['colega']);
  });
});

describe('audiblePeers: limite estricto del radio en el piso abierto', () => {
  it('exactamente en el radio queda excluido (d < radius, no d <= radius)', () => {
    const self = { sessionId: 'yo', x: 0, y: 0, room: null };
    const peerEnElBorde: AudioPeer = { sessionId: 'borde', x: PROX_RADIUS, y: 0, room: null };

    const audibles = audiblePeers({ self, peers: [peerEnElBorde], radius: PROX_RADIUS });

    expect(audibles).toEqual([]);
  });

  it('un pixel dentro del radio si es audible', () => {
    const self = { sessionId: 'yo', x: 0, y: 0, room: null };
    const peerDentro: AudioPeer = { sessionId: 'dentro', x: PROX_RADIUS - 1, y: 0, room: null };

    const audibles = audiblePeers({ self, peers: [peerDentro], radius: PROX_RADIUS });

    expect(audibles).toEqual(['dentro']);
  });
});

describe('audiblePeers: casos limite defensivos', () => {
  it('el propio sessionId nunca aparece en el resultado aunque venga en peers', () => {
    const self = { sessionId: 'yo', x: 0, y: 0, room: null };
    const peerPropio: AudioPeer = { sessionId: 'yo', x: 0, y: 0, room: null };

    const audibles = audiblePeers({ self, peers: [peerPropio], radius: PROX_RADIUS });

    expect(audibles).toEqual([]);
  });

  it('sessionId propio null produce un arreglo vacio sin importar los peers', () => {
    const self = { sessionId: null, x: 0, y: 0, room: null };
    const peerCerca: AudioPeer = { sessionId: 'alguien', x: 0, y: 0, room: null };

    const audibles = audiblePeers({ self, peers: [peerCerca], radius: PROX_RADIUS });

    expect(audibles).toEqual([]);
  });

  it('la salida esta ordenada ascendente y sin duplicados: dos tics iguales dan la misma salida', () => {
    const self = { sessionId: 'yo', x: 0, y: 0, room: 'Cafetería' };
    const peers: AudioPeer[] = [
      { sessionId: 'zeta', x: 0, y: 0, room: 'Cafetería' },
      { sessionId: 'alfa', x: 0, y: 0, room: 'Cafetería' },
    ];

    const primerTic = audiblePeers({ self, peers, radius: PROX_RADIUS });
    const segundoTic = audiblePeers({ self, peers, radius: PROX_RADIUS });

    expect(primerTic).toEqual(['alfa', 'zeta']);
    expect(segundoTic).toEqual(primerTic);
  });
});

describe('reconcileSubscriptions: deltas minimos, sin fugas de privacidad', () => {
  it('un par nuevo en desired sin nada en current produce solo subscribe', () => {
    const delta = reconcileSubscriptions([], ['p1']);

    expect(delta).toEqual({ subscribe: ['p1'], unsubscribe: [] });
  });

  it('un par que ya no esta en desired produce solo unsubscribe', () => {
    const delta = reconcileSubscriptions(['p1'], []);

    expect(delta).toEqual({ subscribe: [], unsubscribe: ['p1'] });
  });

  it('conjuntos iguales no producen ningun delta (idempotente)', () => {
    const delta = reconcileSubscriptions(['p1', 'p2'], ['p1', 'p2']);

    expect(delta).toEqual({ subscribe: [], unsubscribe: [] });
  });

  it('un par desaparecido del registro remoto (ausente en desired) se desuscribe: sin esto quedaria audio filtrado', () => {
    const delta = reconcileSubscriptions(['p1', 'p2'], ['p2']);

    expect(delta.unsubscribe).toEqual(['p1']);
    expect(delta.subscribe).toEqual([]);
  });
});
