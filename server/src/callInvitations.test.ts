/**
 * `createCallInvitationRegistry` es un modulo puro sin dependencias de
 * Colyseus (D5/D6): estas pruebas no necesitan servidor ni cliente real.
 */

import { describe, expect, it } from 'vitest';
import { createCallInvitationRegistry } from './callInvitations.ts';

describe('createCallInvitationRegistry', () => {
  it('add() registra una llamada pendiente y has() la ve', () => {
    const registry = createCallInvitationRegistry();

    expect(registry.has('ana', 'beto')).toBe(false);
    expect(registry.add('ana', 'beto')).toBe(true);
    expect(registry.has('ana', 'beto')).toBe(true);
  });

  it('D5: una segunda llamada del mismo emisor al mismo destinatario es un no-op', () => {
    // 20 clicks de "Llamar" no pueden convertirse en 20 tarjetas: es un vector
    // de spam trivial que el apilado del humano no pidio.
    const registry = createCallInvitationRegistry();
    registry.add('ana', 'beto');

    expect(registry.add('ana', 'beto')).toBe(false);
    expect(registry.pendingFor('beto')).toEqual(['ana']);
  });

  it('D5: distintos emisores al mismo destinatario si se apilan', () => {
    const registry = createCallInvitationRegistry();

    registry.add('ana', 'beto');
    registry.add('carla', 'beto');

    expect(registry.pendingFor('beto')).toEqual(['ana', 'carla']);
  });

  it('el mismo emisor puede llamar a destinatarios distintos', () => {
    const registry = createCallInvitationRegistry();

    expect(registry.add('ana', 'beto')).toBe(true);
    expect(registry.add('ana', 'carla')).toBe(true);
    expect(registry.pendingFor('beto')).toEqual(['ana']);
    expect(registry.pendingFor('carla')).toEqual(['ana']);
  });

  it('remove() borra una llamada pendiente y devuelve true', () => {
    const registry = createCallInvitationRegistry();
    registry.add('ana', 'beto');

    expect(registry.remove('ana', 'beto')).toBe(true);
    expect(registry.has('ana', 'beto')).toBe(false);
    expect(registry.pendingFor('beto')).toEqual([]);
  });

  it('remove() de algo que no esta pendiente devuelve false: rechaza respuestas forjadas o tardias', () => {
    const registry = createCallInvitationRegistry();

    expect(registry.remove('ana', 'beto')).toBe(false);
  });

  it('remove() no borrado devuelve false una segunda vez sobre la misma llamada', () => {
    const registry = createCallInvitationRegistry();
    registry.add('ana', 'beto');
    registry.remove('ana', 'beto');

    expect(registry.remove('ana', 'beto')).toBe(false);
  });

  it('pendingFor() respeta el orden de llegada, no el alfabetico', () => {
    const registry = createCallInvitationRegistry();

    registry.add('zeta', 'beto');
    registry.add('ana', 'beto');

    expect(registry.pendingFor('beto')).toEqual(['zeta', 'ana']);
  });

  it('pendingFor() de alguien sin llamadas pendientes devuelve una lista vacia', () => {
    const registry = createCallInvitationRegistry();

    expect(registry.pendingFor('nadie-le-llamo')).toEqual([]);
  });

  it('D7: removeAllFor() quita las llamadas donde el id es emisor, en orden de llegada', () => {
    const registry = createCallInvitationRegistry();
    registry.add('ana', 'beto');
    registry.add('ana', 'carla');

    const removed = registry.removeAllFor('ana');

    expect(removed).toEqual([
      { from: 'ana', to: 'beto' },
      { from: 'ana', to: 'carla' },
    ]);
    expect(registry.pendingFor('beto')).toEqual([]);
    expect(registry.pendingFor('carla')).toEqual([]);
  });

  it('D7: removeAllFor() tambien quita las llamadas donde el id es destinatario', () => {
    const registry = createCallInvitationRegistry();
    registry.add('ana', 'beto');
    registry.add('carla', 'beto');

    const removed = registry.removeAllFor('beto');

    expect(removed).toEqual([
      { from: 'ana', to: 'beto' },
      { from: 'carla', to: 'beto' },
    ]);
    expect(registry.pendingFor('beto')).toEqual([]);
  });

  it('D7: removeAllFor() cubre ambos roles a la vez, en orden de llegada global', () => {
    // Alguien puede ser emisor de una llamada y destinatario de otra al mismo
    // tiempo; onLeave tiene que barrer las dos sin dejar huerfanos.
    const registry = createCallInvitationRegistry();
    registry.add('ana', 'beto');
    registry.add('beto', 'carla');

    const removed = registry.removeAllFor('beto');

    expect(removed).toEqual([
      { from: 'ana', to: 'beto' },
      { from: 'beto', to: 'carla' },
    ]);
  });

  it('removeAllFor() de alguien sin llamadas no rompe nada y devuelve una lista vacia', () => {
    const registry = createCallInvitationRegistry();

    expect(registry.removeAllFor('nadie')).toEqual([]);
  });
});
