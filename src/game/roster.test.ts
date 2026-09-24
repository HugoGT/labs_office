import { describe, expect, it, vi } from 'vitest';
import { createRosterTracker } from './roster';

describe('createRosterTracker (#74)', () => {
  it('un alta nueva emite la lista completa (membresia cambio)', () => {
    const onChange = vi.fn();
    const tracker = createRosterTracker(onChange);

    tracker.upsert({ sessionId: 'a', name: 'Ana', status: 'g' });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([{ sessionId: 'a', name: 'Ana', status: 'g' }]);
  });

  it('un onChange que solo mueve al par (mismo nombre y estado) NO reemite', () => {
    const onChange = vi.fn();
    const tracker = createRosterTracker(onChange);
    tracker.upsert({ sessionId: 'a', name: 'Ana', status: 'g' });
    onChange.mockClear();

    // Simula el `onChange` de posicion que Colyseus dispara en cada tick de
    // movimiento: mismo nombre, mismo estado, solo cambiaria x/y (que este
    // tracker ni siquiera guarda).
    tracker.upsert({ sessionId: 'a', name: 'Ana', status: 'g' });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('un cambio de nombre SI reemite', () => {
    const onChange = vi.fn();
    const tracker = createRosterTracker(onChange);
    tracker.upsert({ sessionId: 'a', name: 'Ana', status: 'g' });
    onChange.mockClear();

    tracker.upsert({ sessionId: 'a', name: 'Ana Torres', status: 'g' });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([{ sessionId: 'a', name: 'Ana Torres', status: 'g' }]);
  });

  it('un cambio de estado SI reemite', () => {
    const onChange = vi.fn();
    const tracker = createRosterTracker(onChange);
    tracker.upsert({ sessionId: 'a', name: 'Ana', status: 'g' });
    onChange.mockClear();

    tracker.upsert({ sessionId: 'a', name: 'Ana', status: 'r' });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([{ sessionId: 'a', name: 'Ana', status: 'r' }]);
  });

  it('la baja de un par emite la lista sin el', () => {
    const onChange = vi.fn();
    const tracker = createRosterTracker(onChange);
    tracker.upsert({ sessionId: 'a', name: 'Ana', status: 'g' });
    tracker.upsert({ sessionId: 'b', name: 'Beto', status: 'g' });
    onChange.mockClear();

    tracker.remove('a');

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([{ sessionId: 'b', name: 'Beto', status: 'g' }]);
  });

  it('dar de baja a alguien que no esta no reemite', () => {
    const onChange = vi.fn();
    const tracker = createRosterTracker(onChange);

    tracker.remove('nadie');

    expect(onChange).not.toHaveBeenCalled();
  });

  it('la lista emitida esta ordenada por nombre', () => {
    const onChange = vi.fn();
    const tracker = createRosterTracker(onChange);

    tracker.upsert({ sessionId: 'b', name: 'Beto', status: 'g' });
    tracker.upsert({ sessionId: 'a', name: 'Ana', status: 'g' });

    expect(onChange).toHaveBeenLastCalledWith([
      { sessionId: 'a', name: 'Ana', status: 'g' },
      { sessionId: 'b', name: 'Beto', status: 'g' },
    ]);
  });

  it('ignoreSessionId descarta la propia sesion (espejo de RemoteAvatarRegistryOptions)', () => {
    const onChange = vi.fn();
    const tracker = createRosterTracker(onChange, { ignoreSessionId: 'yo' });

    tracker.upsert({ sessionId: 'yo', name: 'HugoGT', status: 'g' });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('clear() vacia y reemite una lista vacia', () => {
    const onChange = vi.fn();
    const tracker = createRosterTracker(onChange);
    tracker.upsert({ sessionId: 'a', name: 'Ana', status: 'g' });
    onChange.mockClear();

    tracker.clear();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('clear() sobre un tracker ya vacio no reemite', () => {
    const onChange = vi.fn();
    const tracker = createRosterTracker(onChange);

    tracker.clear();

    expect(onChange).not.toHaveBeenCalled();
  });
});
