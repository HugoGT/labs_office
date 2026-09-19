import { describe, expect, it, vi } from 'vitest';
import {
  avatarKeyFor,
  createRemoteAvatarRegistry,
  type RemotePlayerSnapshot,
} from './remoteAvatars';

interface FakeAvatar {
  id: string;
  x: number;
  y: number;
}

function snapshot(overrides: Partial<RemotePlayerSnapshot> = {}): RemotePlayerSnapshot {
  return {
    sessionId: 'abc',
    name: 'Ana',
    x: 10,
    y: 20,
    status: 'g',
    facing: 'down',
    spacesVersion: 'v1',
    ...overrides,
  };
}

function fakeSink() {
  const created: RemotePlayerSnapshot[] = [];
  const destroyed: FakeAvatar[] = [];
  return {
    created,
    destroyed,
    sink: {
      create: vi.fn((s: RemotePlayerSnapshot): FakeAvatar => {
        created.push(s);
        return { id: s.sessionId, x: s.x, y: s.y };
      }),
      update: vi.fn((avatar: FakeAvatar, s: RemotePlayerSnapshot) => {
        avatar.x = s.x;
        avatar.y = s.y;
      }),
      destroy: vi.fn((avatar: FakeAvatar) => {
        destroyed.push(avatar);
      }),
    },
  };
}

describe('createRemoteAvatarRegistry', () => {
  it('crea un avatar la primera vez y lo actualiza despues, sin recrearlo', () => {
    const { sink } = fakeSink();
    const registry = createRemoteAvatarRegistry(sink);

    registry.upsert(snapshot({ sessionId: 'a', x: 10 }));
    registry.upsert(snapshot({ sessionId: 'a', x: 99 }));

    // Recrear en cada tick tiraria el sprite y su interpolacion 20 veces por
    // segundo: el avatar parpadearia en vez de moverse.
    expect(sink.create).toHaveBeenCalledTimes(1);
    expect(sink.update).toHaveBeenCalledTimes(1);
    expect(registry.get('a')?.x).toBe(99);
  });

  it('destruye el avatar al quitarlo y lo saca del registro', () => {
    const { sink } = fakeSink();
    const registry = createRemoteAvatarRegistry(sink);
    registry.upsert(snapshot({ sessionId: 'a' }));

    registry.remove('a');

    expect(sink.destroy).toHaveBeenCalledTimes(1);
    expect(registry.get('a')).toBeUndefined();
    expect(registry.sessionIds()).toEqual([]);
  });

  it('quitar un id desconocido no destruye nada ni lanza', () => {
    const { sink } = fakeSink();
    const registry = createRemoteAvatarRegistry(sink);

    expect(() => registry.remove('fantasma')).not.toThrow();
    expect(sink.destroy).not.toHaveBeenCalled();
  });

  it('ignora por completo la propia sesion: el jugador local ya se dibuja aparte', () => {
    const { sink } = fakeSink();
    const registry = createRemoteAvatarRegistry(sink, { ignoreSessionId: 'yo' });

    registry.upsert(snapshot({ sessionId: 'yo' }));
    registry.upsert(snapshot({ sessionId: 'otro' }));

    // Sin esta regla el jugador veria un clon suyo pisandole, moviendose con el
    // retardo de la red mientras el suyo local va instantaneo.
    expect(sink.create).toHaveBeenCalledTimes(1);
    expect(registry.sessionIds()).toEqual(['otro']);
    expect(registry.get('yo')).toBeUndefined();
  });

  it('clear destruye todos los avatares vivos y vacia el registro', () => {
    const { sink } = fakeSink();
    const registry = createRemoteAvatarRegistry(sink);
    registry.upsert(snapshot({ sessionId: 'a' }));
    registry.upsert(snapshot({ sessionId: 'b' }));

    registry.clear();

    expect(sink.destroy).toHaveBeenCalledTimes(2);
    expect(registry.sessionIds()).toEqual([]);
  });

  it('tras clear, el mismo id vuelve a crearse en vez de quedar como zombi', () => {
    const { sink } = fakeSink();
    const registry = createRemoteAvatarRegistry(sink);
    registry.upsert(snapshot({ sessionId: 'a' }));
    registry.clear();

    registry.upsert(snapshot({ sessionId: 'a' }));

    expect(sink.create).toHaveBeenCalledTimes(2);
  });
});

describe('avatarKeyFor', () => {
  it('devuelve siempre la misma clave para la misma sesion', () => {
    // Si variase, el avatar de un compañero cambiaria de aspecto en cada
    // mensaje recibido.
    expect(avatarKeyFor('abc123')).toBe(avatarKeyFor('abc123'));
  });

  it('siempre cae dentro del rango de avatares existentes av0..av9', () => {
    const ids = ['a', 'zzz', '', 'sesion-muy-larga-de-colyseus', '99', '\u00f1'];

    for (const id of ids) {
      expect(avatarKeyFor(id)).toMatch(/^av[0-9]$/);
    }
  });

  it('reparte sesiones distintas entre varias claves, no colapsa en una sola', () => {
    const keys = new Set(
      Array.from({ length: 60 }, (_, i) => avatarKeyFor(`session-${i}`)),
    );

    expect(keys.size).toBeGreaterThan(3);
  });
});
