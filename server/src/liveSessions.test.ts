/**
 * `createLiveSessionRegistry` es un modulo sin dependencias (D4): estas
 * pruebas son puras y no necesitan Colyseus real.
 */

import { describe, expect, it } from 'vitest';
import { createLiveSessionRegistry } from './liveSessions.ts';

describe('createLiveSessionRegistry', () => {
  it('anade, consulta y quita un id', () => {
    const registry = createLiveSessionRegistry();

    expect(registry.has('a')).toBe(false);
    expect(registry.size()).toBe(0);

    registry.add('a');
    expect(registry.has('a')).toBe(true);
    expect(registry.size()).toBe(1);

    registry.remove('a');
    expect(registry.has('a')).toBe(false);
    expect(registry.size()).toBe(0);
  });

  it('quitar un id que nunca se registro no hace nada', () => {
    const registry = createLiveSessionRegistry();

    registry.remove('jamas-existio');

    expect(registry.size()).toBe(0);
  });

  it('anadir el mismo id dos veces es idempotente', () => {
    const registry = createLiveSessionRegistry();

    registry.add('a');
    registry.add('a');

    expect(registry.size()).toBe(1);
  });
});
