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

describe('createLiveSessionRegistry: dueno de la sesion (#8)', () => {
  it('recuerda el uid con el que se dio de alta la sesion', () => {
    const registry = createLiveSessionRegistry();

    registry.add('sess-a', 'uid-ana');

    expect(registry.uidOf('sess-a')).toBe('uid-ana');
    expect(registry.has('sess-a')).toBe(true);
    expect(registry.size()).toBe(1);
  });

  it('una sesion dada de alta sin uid no tiene dueno (auth desactivada)', () => {
    const registry = createLiveSessionRegistry();

    registry.add('sess-a');

    expect(registry.has('sess-a')).toBe(true);
    expect(registry.uidOf('sess-a')).toBeUndefined();
  });

  it('un id que nunca se registro no tiene dueno', () => {
    const registry = createLiveSessionRegistry();

    expect(registry.uidOf('jamas-existio')).toBeUndefined();
  });

  it('quitar la sesion borra tambien su uid, no solo su presencia', () => {
    // Si el uid sobreviviese a la baja, un `sessionId` reutilizado heredaria el
    // dueno del anterior y `POST /livekit/token` autorizaria a quien no debe.
    const registry = createLiveSessionRegistry();
    registry.add('sess-a', 'uid-ana');

    registry.remove('sess-a');

    expect(registry.has('sess-a')).toBe(false);
    expect(registry.uidOf('sess-a')).toBeUndefined();
  });

  it('re-registrar el mismo id con otro uid se queda con el ultimo', () => {
    const registry = createLiveSessionRegistry();

    registry.add('sess-a', 'uid-ana');
    registry.add('sess-a', 'uid-beto');

    expect(registry.size()).toBe(1);
    expect(registry.uidOf('sess-a')).toBe('uid-beto');
  });

  it('cada sesion guarda su propio uid, no el de la vecina', () => {
    const registry = createLiveSessionRegistry();

    registry.add('sess-a', 'uid-ana');
    registry.add('sess-b', 'uid-beto');

    expect(registry.uidOf('sess-a')).toBe('uid-ana');
    expect(registry.uidOf('sess-b')).toBe('uid-beto');
  });
});

describe('createLiveSessionRegistry: posicion de la sesion (#10, #12, D4)', () => {
  it('una sesion recien anadida no tiene posicion', () => {
    const registry = createLiveSessionRegistry();

    registry.add('sess-a');

    expect(registry.positionOf('sess-a')).toBeUndefined();
  });

  it('moveTo fija la posicion y positionOf la devuelve', () => {
    const registry = createLiveSessionRegistry();
    registry.add('sess-a');

    registry.moveTo('sess-a', 160, 320);

    expect(registry.positionOf('sess-a')).toEqual({ x: 160, y: 320 });
  });

  it('moveTo sobre un id desconocido no resucita la sesion', () => {
    const registry = createLiveSessionRegistry();

    registry.moveTo('jamas-existio', 10, 10);

    expect(registry.has('jamas-existio')).toBe(false);
    expect(registry.positionOf('jamas-existio')).toBeUndefined();
  });

  it('moveTo repetido se queda con la ultima posicion, no la primera', () => {
    const registry = createLiveSessionRegistry();
    registry.add('sess-a');

    registry.moveTo('sess-a', 32, 32);
    registry.moveTo('sess-a', 500, 700);

    expect(registry.positionOf('sess-a')).toEqual({ x: 500, y: 700 });
  });

  it('moveTo no borra el uid ya registrado', () => {
    const registry = createLiveSessionRegistry();
    registry.add('sess-a', 'uid-ana');

    registry.moveTo('sess-a', 64, 64);

    expect(registry.uidOf('sess-a')).toBe('uid-ana');
    expect(registry.positionOf('sess-a')).toEqual({ x: 64, y: 64 });
  });

  it('remove borra tambien la posicion, no solo la presencia', () => {
    const registry = createLiveSessionRegistry();
    registry.add('sess-a');
    registry.moveTo('sess-a', 64, 64);

    registry.remove('sess-a');
    registry.add('sess-a');

    expect(registry.positionOf('sess-a')).toBeUndefined();
  });
});

describe('createLiveSessionRegistry: ids (#58)', () => {
  it('lists every live session, and forgets the ones removed', () => {
    const registry = createLiveSessionRegistry();
    registry.add('sess-a');
    registry.add('sess-b');
    registry.remove('sess-a');

    expect(registry.ids()).toEqual(['sess-b']);
  });
});
