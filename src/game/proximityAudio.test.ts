import { describe, expect, it } from 'vitest';
import { PROX_RADIUS } from './mapData';
import {
  audiblePeers,
  reconcileSubscriptions,
  type AudibleInput,
  type AudioPeer,
} from './proximityAudio';

/** Version compartida por defecto: la mayoria de los casos no prueban D4, asi que comparten una sola version para no repetirla en cada objeto. */
const V1 = 'v1';

/**
 * `audiblePeers` es el objetivo mas valioso de esta prueba TDD: decide quien
 * escucha a quien. Un bug aqui es un defecto de privacidad, no de UX.
 */
describe('audiblePeers: en una sala, la sala manda y el radio se ignora', () => {
  it('un par a un pixel fuera del rectangulo de la sala queda en silencio, aunque este pegado', () => {
    const self: AudibleInput['self'] = {
      sessionId: 'yo',
      x: 0,
      y: 0,
      spaceId: 'sala-de-juntas',
      spacesVersion: V1,
      status: 'g',
    };
    const peerFuera: AudioPeer = {
      sessionId: 'vecino',
      x: 0,
      y: 0,
      spaceId: null,
      spacesVersion: V1,
      status: 'g',
    };

    const audibles = audiblePeers({ self, peers: [peerFuera], radius: PROX_RADIUS });

    expect(audibles).toEqual([]);
  });

  it('dos personas en la misma sala se escuchan sin importar la distancia exacta', () => {
    const self: AudibleInput['self'] = {
      sessionId: 'yo',
      x: 0,
      y: 0,
      spaceId: 'cafeteria',
      spacesVersion: V1,
      status: 'g',
    };
    const peerLejos: AudioPeer = {
      sessionId: 'companero',
      x: 99999,
      y: 99999,
      spaceId: 'cafeteria',
      spacesVersion: V1,
      status: 'g',
    };

    const audibles = audiblePeers({ self, peers: [peerLejos], radius: PROX_RADIUS });

    expect(audibles).toEqual(['companero']);
  });
});

describe('audiblePeers: aislamiento mutuo desde el piso abierto', () => {
  it('un par dentro de una sala NUNCA es audible desde el piso abierto, aunque este cerca', () => {
    const self: AudibleInput['self'] = {
      sessionId: 'yo',
      x: 0,
      y: 0,
      spaceId: null,
      spacesVersion: V1,
      status: 'g',
    };
    const peerEnSala: AudioPeer = {
      sessionId: 'reunido',
      x: 5,
      y: 5,
      spaceId: 'sala-de-juntas',
      spacesVersion: V1,
      status: 'g',
    };

    const audibles = audiblePeers({ self, peers: [peerEnSala], radius: PROX_RADIUS });

    expect(audibles).toEqual([]);
  });

  it('en el piso abierto, un par tambien en el piso abierto y dentro del radio si es audible', () => {
    const self: AudibleInput['self'] = {
      sessionId: 'yo',
      x: 0,
      y: 0,
      spaceId: null,
      spacesVersion: V1,
      status: 'g',
    };
    const peerCerca: AudioPeer = {
      sessionId: 'colega',
      x: 50,
      y: 0,
      spaceId: null,
      spacesVersion: V1,
      status: 'g',
    };

    const audibles = audiblePeers({ self, peers: [peerCerca], radius: PROX_RADIUS });

    expect(audibles).toEqual(['colega']);
  });
});

describe('audiblePeers: limite estricto del radio en el piso abierto', () => {
  it('exactamente en el radio queda excluido (d < radius, no d <= radius)', () => {
    const self: AudibleInput['self'] = {
      sessionId: 'yo',
      x: 0,
      y: 0,
      spaceId: null,
      spacesVersion: V1,
      status: 'g',
    };
    const peerEnElBorde: AudioPeer = {
      sessionId: 'borde',
      x: PROX_RADIUS,
      y: 0,
      spaceId: null,
      spacesVersion: V1,
      status: 'g',
    };

    const audibles = audiblePeers({ self, peers: [peerEnElBorde], radius: PROX_RADIUS });

    expect(audibles).toEqual([]);
  });

  it('un pixel dentro del radio si es audible', () => {
    const self: AudibleInput['self'] = {
      sessionId: 'yo',
      x: 0,
      y: 0,
      spaceId: null,
      spacesVersion: V1,
      status: 'g',
    };
    const peerDentro: AudioPeer = {
      sessionId: 'dentro',
      x: PROX_RADIUS - 1,
      y: 0,
      spaceId: null,
      spacesVersion: V1,
      status: 'g',
    };

    const audibles = audiblePeers({ self, peers: [peerDentro], radius: PROX_RADIUS });

    expect(audibles).toEqual(['dentro']);
  });
});

/**
 * Cobertura de regresion (issue #10, S2 3.3, spec proximity-audio): un
 * cubiculo de escritorio es un `Space` como cualquier otro para esta
 * funcion -- el `spaceId` es una cadena opaca, `audiblePeers` no sabe ni
 * necesita saber si viene de una sala incorporada o de un escritorio (#7,
 * D2). Estos dos escenarios ya estaban cubiertos GENERICAMENTE por las
 * suites de arriba con nombres de sala; se nombran aqui explicitamente en
 * terminos de escritorio porque son los escenarios que pide la spec de esta
 * slice, y una regresion que solo rompiese el caso "escritorio" (por
 * ejemplo, un futuro guard `kind === 'room'`) no tendria ninguna prueba que
 * la detecte sin este bloque.
 */
describe('audiblePeers: aislamiento de cubiculo de escritorio identico al de sala (#10, S2 3.3)', () => {
  it('un cubiculo aisla a un par de piso abierto dentro del radio, igual que una sala', () => {
    const enCubiculo: AudibleInput['self'] = {
      sessionId: 'yo',
      x: 0,
      y: 0,
      spaceId: 'cubiculo-d1',
      spacesVersion: V1,
      status: 'g',
    };
    // Dentro del radio (PROX_RADIUS), pero en piso abierto: sin la regla de
    // sala/cubiculo, el radio lo haria audible.
    const vecinoDePasillo: AudioPeer = {
      sessionId: 'vecino',
      x: PROX_RADIUS - 1,
      y: 0,
      spaceId: null,
      spacesVersion: V1,
      status: 'g',
    };

    const audibles = audiblePeers({ self: enCubiculo, peers: [vecinoDePasillo], radius: PROX_RADIUS });

    expect(audibles).toEqual([]);
  });

  it('dos personas en el mismo cubiculo se escuchan, y el piso abierto sigue funcionando sin verse afectado por el cubiculo', () => {
    const self: AudibleInput['self'] = {
      sessionId: 'yo',
      x: 0,
      y: 0,
      spaceId: 'cubiculo-d1',
      spacesVersion: V1,
      status: 'g',
    };
    const companeroDeCubiculo: AudioPeer = {
      sessionId: 'companero',
      x: 99999,
      y: 99999,
      spaceId: 'cubiculo-d1',
      spacesVersion: V1,
      status: 'g',
    };

    expect(audiblePeers({ self, peers: [companeroDeCubiculo], radius: PROX_RADIUS })).toEqual([
      'companero',
    ]);

    // El piso abierto (solo radio, sin cubiculos de por medio) no cambia:
    // misma prueba que la suite generica de arriba, repetida aqui para dejar
    // el contraste explicito en el mismo bloque.
    const enPisoAbierto: AudibleInput['self'] = { ...self, spaceId: null };
    const peerCerca: AudioPeer = {
      sessionId: 'colega',
      x: 50,
      y: 0,
      spaceId: null,
      spacesVersion: V1,
      status: 'g',
    };
    expect(audiblePeers({ self: enPisoAbierto, peers: [peerCerca], radius: PROX_RADIUS })).toEqual(
      ['colega'],
    );
  });
});

describe('audiblePeers: casos limite defensivos', () => {
  it('el propio sessionId nunca aparece en el resultado aunque venga en peers', () => {
    const self: AudibleInput['self'] = {
      sessionId: 'yo',
      x: 0,
      y: 0,
      spaceId: null,
      spacesVersion: V1,
      status: 'g',
    };
    const peerPropio: AudioPeer = {
      sessionId: 'yo',
      x: 0,
      y: 0,
      spaceId: null,
      spacesVersion: V1,
      status: 'g',
    };

    const audibles = audiblePeers({ self, peers: [peerPropio], radius: PROX_RADIUS });

    expect(audibles).toEqual([]);
  });

  it('sessionId propio null produce un arreglo vacio sin importar los peers', () => {
    const self: AudibleInput['self'] = {
      sessionId: null,
      x: 0,
      y: 0,
      spaceId: null,
      spacesVersion: V1,
      status: 'g',
    };
    const peerCerca: AudioPeer = {
      sessionId: 'alguien',
      x: 0,
      y: 0,
      spaceId: null,
      spacesVersion: V1,
      status: 'g',
    };

    const audibles = audiblePeers({ self, peers: [peerCerca], radius: PROX_RADIUS });

    expect(audibles).toEqual([]);
  });

  it('la salida esta ordenada ascendente y sin duplicados: dos tics iguales dan la misma salida', () => {
    const self: AudibleInput['self'] = {
      sessionId: 'yo',
      x: 0,
      y: 0,
      spaceId: 'cafeteria',
      spacesVersion: V1,
      status: 'g',
    };
    const peers: AudioPeer[] = [
      { sessionId: 'zeta', x: 0, y: 0, spaceId: 'cafeteria', spacesVersion: V1, status: 'g' },
      { sessionId: 'alfa', x: 0, y: 0, spaceId: 'cafeteria', spacesVersion: V1, status: 'g' },
    ];

    const primerTic = audiblePeers({ self, peers, radius: PROX_RADIUS });
    const segundoTic = audiblePeers({ self, peers, radius: PROX_RADIUS });

    expect(primerTic).toEqual(['alfa', 'zeta']);
    expect(segundoTic).toEqual(primerTic);
  });
});

describe('audiblePeers: "No molestar" aisla en los dos sentidos (#1)', () => {
  it('en "No molestar" no se escucha a nadie, ni en el piso abierto ni compartiendo sala', () => {
    const enPisoAbierto: AudibleInput['self'] = {
      sessionId: 'yo',
      x: 0,
      y: 0,
      spaceId: null,
      spacesVersion: V1,
      status: 'r',
    };
    const enSala: AudibleInput['self'] = { ...enPisoAbierto, spaceId: 'cafeteria' };
    const peers: AudioPeer[] = [
      { sessionId: 'pegado', x: 0, y: 0, spaceId: null, spacesVersion: V1, status: 'g' },
      { sessionId: 'companero', x: 0, y: 0, spaceId: 'cafeteria', spacesVersion: V1, status: 'g' },
    ];

    expect(audiblePeers({ self: enPisoAbierto, peers, radius: PROX_RADIUS })).toEqual([]);
    expect(audiblePeers({ self: enSala, peers, radius: PROX_RADIUS })).toEqual([]);
  });

  it('un par en "No molestar" no se escucha desde el piso abierto, aunque este encima', () => {
    const self: AudibleInput['self'] = {
      sessionId: 'yo',
      x: 0,
      y: 0,
      spaceId: null,
      spacesVersion: V1,
      status: 'g',
    };
    const peerAislado: AudioPeer = {
      sessionId: 'aislada',
      x: 0,
      y: 0,
      spaceId: null,
      spacesVersion: V1,
      status: 'r',
    };

    const audibles = audiblePeers({ self, peers: [peerAislado], radius: PROX_RADIUS });

    // El aislamiento es mutuo, igual que el de sala: si solo valiese en un
    // sentido, quien pidio no ser molestado seguiria siendo escuchado.
    expect(audibles).toEqual([]);
  });

  it('un par en "No molestar" tampoco se escucha compartiendo sala, donde el radio no aplica', () => {
    const self: AudibleInput['self'] = {
      sessionId: 'yo',
      x: 0,
      y: 0,
      spaceId: 'sala-de-juntas',
      spacesVersion: V1,
      status: 'g',
    };
    const peers: AudioPeer[] = [
      {
        sessionId: 'aislada',
        x: 0,
        y: 0,
        spaceId: 'sala-de-juntas',
        spacesVersion: V1,
        status: 'r',
      },
      {
        sessionId: 'companero',
        x: 0,
        y: 0,
        spaceId: 'sala-de-juntas',
        spacesVersion: V1,
        status: 'g',
      },
    ];

    // Entrar a una sala es justo donde seria facil saltarse la regla: alli la
    // pertenencia manda sobre la distancia, pero no sobre el aislamiento.
    expect(audiblePeers({ self, peers, radius: PROX_RADIUS })).toEqual(['companero']);
  });

  it('"Ocupado" se comporta exactamente igual que "En línea": es senal social, no audio', () => {
    // Es el punto del issue: solo "No molestar" toca el audio. Si alguien
    // decide que "Ocupado" tambien deberia silenciar, cae aqui.
    const yoOcupado: AudibleInput['self'] = {
      sessionId: 'yo',
      x: 0,
      y: 0,
      spaceId: null,
      spacesVersion: V1,
      status: 'y',
    };
    const peers: AudioPeer[] = [
      { sessionId: 'ocupada', x: 10, y: 0, spaceId: null, spacesVersion: V1, status: 'y' },
      { sessionId: 'disponible', x: 20, y: 0, spaceId: null, spacesVersion: V1, status: 'g' },
    ];

    const comoOcupado = audiblePeers({ self: yoOcupado, peers, radius: PROX_RADIUS });
    const comoEnLinea = audiblePeers({
      self: { ...yoOcupado, status: 'g' },
      peers,
      radius: PROX_RADIUS,
    });

    expect(comoOcupado).toEqual(['disponible', 'ocupada']);
    expect(comoEnLinea).toEqual(comoOcupado);
  });
});

/**
 * Predicado mutuo de `spacesVersion` (#7, D4): precondicion evaluada ANTES de
 * la regla de sala y ANTES de la rama de piso abierto, en el filtro `others`.
 * Reemplaza por completo la guarda `spacesStale` propuesta en r2 -- no
 * sobrevive ninguna version de ella (ver diseno). El caso mas valioso es el
 * primero: la asimetria es exactamente lo que una prueba de un solo sentido
 * dejaria pasar.
 */
describe('audiblePeers: predicado mutuo de spacesVersion (#7, D4)', () => {
  it('versiones distintas en la MISMA sala: silencio calculado desde el lado de A Y desde el lado de B', () => {
    const a: AudibleInput['self'] = {
      sessionId: 'a',
      x: 0,
      y: 0,
      spaceId: 'sala-de-juntas',
      spacesVersion: 'v2',
      status: 'g',
    };
    const b: AudibleInput['self'] = {
      sessionId: 'b',
      x: 0,
      y: 0,
      spaceId: 'sala-de-juntas',
      spacesVersion: 'v1',
      status: 'g',
    };
    const peerB: AudioPeer = {
      sessionId: 'b',
      x: 0,
      y: 0,
      spaceId: 'sala-de-juntas',
      spacesVersion: 'v1',
      status: 'g',
    };
    const peerA: AudioPeer = {
      sessionId: 'a',
      x: 0,
      y: 0,
      spaceId: 'sala-de-juntas',
      spacesVersion: 'v2',
      status: 'g',
    };

    // Dos comprobaciones independientes, una por cada lado del par: una
    // asercion de un solo sentido pasaria aunque el otro lado si escuchase.
    expect(audiblePeers({ self: a, peers: [peerB], radius: PROX_RADIUS })).toEqual([]);
    expect(audiblePeers({ self: b, peers: [peerA], radius: PROX_RADIUS })).toEqual([]);
  });

  it('misma version, aunque sea vieja, compartiendo sala: mutuamente audibles (ninguna guarda global lo enmascara)', () => {
    const self: AudibleInput['self'] = {
      sessionId: 'yo',
      x: 0,
      y: 0,
      spaceId: 'sala-de-juntas',
      spacesVersion: 'viejaPeroIgual',
      status: 'g',
    };
    const peer: AudioPeer = {
      sessionId: 'companero',
      x: 99999,
      y: 99999,
      spaceId: 'sala-de-juntas',
      spacesVersion: 'viejaPeroIgual',
      status: 'g',
    };

    expect(audiblePeers({ self, peers: [peer], radius: PROX_RADIUS })).toEqual(['companero']);
  });

  it('misma version vieja, ambos en piso abierto y dentro del radio: mutuamente audibles (la rama de piso abierto tambien esta protegida)', () => {
    const self: AudibleInput['self'] = {
      sessionId: 'yo',
      x: 0,
      y: 0,
      spaceId: null,
      spacesVersion: 'viejaPeroIgual',
      status: 'g',
    };
    const peer: AudioPeer = {
      sessionId: 'colega',
      x: 50,
      y: 0,
      spaceId: null,
      spacesVersion: 'viejaPeroIgual',
      status: 'g',
    };

    expect(audiblePeers({ self, peers: [peer], radius: PROX_RADIUS })).toEqual(['colega']);
  });

  it('misma sala, versiones distintas: silencio -- la version se evalua ANTES de la regla de sala', () => {
    const self: AudibleInput['self'] = {
      sessionId: 'yo',
      x: 0,
      y: 0,
      spaceId: 'cafeteria',
      spacesVersion: 'v1',
      status: 'g',
    };
    const peer: AudioPeer = {
      sessionId: 'companero',
      x: 0,
      y: 0,
      spaceId: 'cafeteria',
      spacesVersion: 'v2',
      status: 'g',
    };

    expect(audiblePeers({ self, peers: [peer], radius: PROX_RADIUS })).toEqual([]);
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
