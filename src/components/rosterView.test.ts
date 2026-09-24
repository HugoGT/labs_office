import { describe, expect, it } from 'vitest';
import { visibleRoster } from './rosterView';

const SELF = { sessionId: 'yo', name: 'Hugo', status: 'g' as const };

describe('visibleRoster (#74)', () => {
  it('pone a uno mismo primero, antes que cualquier par', () => {
    const result = visibleRoster(SELF, [{ sessionId: 'a', name: 'Ana', status: 'g' }], '');

    expect(result[0]).toEqual({ sessionId: 'yo', name: 'Hugo', status: 'g', isSelf: true });
    expect(result[1]).toEqual({ sessionId: 'a', name: 'Ana', status: 'g', isSelf: false });
  });

  it('ordena a los demas por nombre en español (localeCompare "es")', () => {
    const peers = [
      { sessionId: 'z', name: 'Zoe', status: 'g' as const },
      { sessionId: 'a', name: 'Álvaro', status: 'g' as const },
      { sessionId: 'b', name: 'Beto', status: 'g' as const },
    ];

    const result = visibleRoster(SELF, peers, '');

    expect(result.slice(1).map((p) => p.name)).toEqual(['Álvaro', 'Beto', 'Zoe']);
  });

  it('filtra por nombre sin distinguir mayusculas/minusculas', () => {
    const peers = [
      { sessionId: 'a', name: 'Ana', status: 'g' as const },
      { sessionId: 'b', name: 'Beto', status: 'g' as const },
    ];

    const result = visibleRoster(SELF, peers, 'ANA');

    expect(result.map((p) => p.name)).toEqual(['Ana']);
  });

  it('filtra por nombre sin distinguir acentos', () => {
    const peers = [
      { sessionId: 'a', name: 'Álvaro', status: 'g' as const },
      { sessionId: 'b', name: 'Beto', status: 'g' as const },
    ];

    const result = visibleRoster(SELF, peers, 'alvaro');

    expect(result.map((p) => p.name)).toEqual(['Álvaro']);
  });

  it('una consulta vacia muestra a todos', () => {
    const peers = [{ sessionId: 'a', name: 'Ana', status: 'g' as const }];

    const result = visibleRoster(SELF, peers, '');

    expect(result).toHaveLength(2);
  });

  it('uno mismo tambien se filtra por la consulta: si no matchea, no aparece', () => {
    const result = visibleRoster(SELF, [{ sessionId: 'a', name: 'Ana', status: 'g' }], 'ana');

    expect(result.map((p) => p.name)).toEqual(['Ana']);
  });

  it('sin pares y sin consulta, solo aparece uno mismo', () => {
    const result = visibleRoster(SELF, [], '');

    expect(result).toEqual([{ sessionId: 'yo', name: 'Hugo', status: 'g', isSelf: true }]);
  });
});
