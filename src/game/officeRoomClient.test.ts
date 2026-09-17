import { describe, expect, it } from 'vitest';
import { buildJoinOptions } from './officeRoomClient';

/**
 * El viaje por cable ya lo cubre `officeRoomClient.node.test.ts` contra un
 * Colyseus real. Aqui se fija lo unico que el cambio de autenticacion (#8)
 * mueve: que viaja en el `joinOrCreate` y que no.
 */
describe('buildJoinOptions', () => {
  it('sin token manda name y status, y nada mas', () => {
    expect(buildJoinOptions({ name: 'Ana', status: 'g' })).toEqual({ name: 'Ana', status: 'g' });
  });

  it('un `token: undefined` no llega a viajar como clave', () => {
    // Con auth apagada el servidor lee `options.name`; mandar `token:
    // undefined` lo dejaria decidiendo sobre una clave que no significa nada.
    expect(Object.keys(buildJoinOptions({ name: 'Ana', status: 'g' }))).toEqual(['name', 'status']);
  });

  it('con token lo anade sin quitar el nombre', () => {
    // El servidor con auth encendida IGNORA `name` y deriva el nombre del
    // token verificado, pero con auth apagada `name` sigue siendo lo unico
    // que tiene. Mandar los dos es lo que hace que el mismo cliente sirva
    // para los dos modos.
    expect(buildJoinOptions({ name: 'Ana', status: 'r', token: 'jwt' })).toEqual({
      name: 'Ana',
      status: 'r',
      token: 'jwt',
    });
  });

  it('un token nulo o vacio no viaja: no hay sesion que probar', () => {
    expect(buildJoinOptions({ name: 'Ana', status: 'g', token: null })).toEqual({
      name: 'Ana',
      status: 'g',
    });
    expect(buildJoinOptions({ name: 'Ana', status: 'g', token: '' })).toEqual({
      name: 'Ana',
      status: 'g',
    });
  });
});
