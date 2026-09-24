import { describe, expect, it, vi } from 'vitest';
import { createOfficeBridge, type OfficeCommandMap } from './officeBridge';

describe('createOfficeBridge', () => {
  it('dos instancias independientes no comparten entrega de eventos (office-bridge spec)', () => {
    const bridgeA = createOfficeBridge();
    const bridgeB = createOfficeBridge();
    const handlerA = vi.fn();
    const handlerB = vi.fn();

    bridgeA.on('room', handlerA);
    bridgeB.on('room', handlerB);
    bridgeA.emit('room', { spaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'Cafetería' });

    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerA).toHaveBeenCalledWith({
      spaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      name: 'Cafetería',
    });
    expect(handlerB).not.toHaveBeenCalled();
  });

  it('nunca declara window.officeAPI (office-bridge spec: sin estado global)', () => {
    createOfficeBridge();

    expect((window as unknown as { officeAPI?: unknown }).officeAPI).toBeUndefined();
  });

  it('entrega el payload de "voice" completo (con nombres) y deja de notificar tras desuscribirse (D3, issue #17)', () => {
    const bridge = createOfficeBridge();
    const handler = vi.fn();
    const peers = [
      { sessionId: 'par-1', name: 'Ana Real' },
      { sessionId: 'par-2', name: 'Beto Real' },
    ];

    const unsubscribe = bridge.on('voice', handler);
    bridge.emit('voice', {
      selfSessionId: 'yo',
      selfName: 'HugoGT',
      peers,
      spaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      selfSessionId: 'yo',
      selfName: 'HugoGT',
      peers,
      spaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });

    unsubscribe();
    bridge.emit('voice', { selfSessionId: null, selfName: 'HugoGT', peers: [], spaceId: null });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('emitCommand entrega comandos genericos y respeta la desuscripcion (base del hook de test, D4)', () => {
    const bridge = createOfficeBridge();
    const handler = vi.fn();

    const unsubscribe = bridge.onCommand('teleportToTile', handler);
    bridge.emitCommand('teleportToTile', { tx: 56, ty: 25 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ tx: 56, ty: 25 });

    unsubscribe();
    bridge.emitCommand('teleportToTile', { tx: 1, ty: 1 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('dos comandos comparten canal pero no se confunden entre tipos', () => {
    const bridge = createOfficeBridge();
    const onTeleportToTile = vi.fn();
    const onSetStatus = vi.fn();

    bridge.onCommand('teleportToTile', onTeleportToTile);
    bridge.onCommand('setStatus', onSetStatus);

    bridge.emitCommand('teleportToTile', { tx: 10, ty: 12 });

    expect(onTeleportToTile).toHaveBeenCalledTimes(1);
    expect(onSetStatus).not.toHaveBeenCalled();
  });

  it('setStatus viaja por el canal de comandos y respeta la desuscripcion (#1)', () => {
    const bridge = createOfficeBridge();
    const handler = vi.fn();

    const unsubscribe = bridge.onCommand('setStatus', handler);
    bridge.emitCommand('setStatus', { status: 'r' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ status: 'r' });

    unsubscribe();
    bridge.emitCommand('setStatus', { status: 'g' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('ningun comando tiene metodo de conveniencia: todos se emiten como comando generico', () => {
    // `teleportTo` y `callNpc` eran los dos ultimos que quedaban, por paridad
    // con el prototipo y no porque hiciesen falta; se fueron con los NPCs
    // simulados. Reponer esa superficie por cada comando nuevo reconstruiria
    // el `window.officeAPI` que D1 vino a retirar.
    const bridge = createOfficeBridge();

    expect(bridge).not.toHaveProperty('setStatus');
    expect(bridge).not.toHaveProperty('teleportTo');
    expect(bridge).not.toHaveProperty('callNpc');
  });

  it('entrega "callinvite" y deja de notificar tras desuscribirse (issue #2, D3)', () => {
    const bridge = createOfficeBridge();
    const handler = vi.fn();

    const unsubscribe = bridge.on('callinvite', handler);
    bridge.emit('callinvite', { from: 'sess-a', name: 'Ana' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ from: 'sess-a', name: 'Ana' });

    unsubscribe();
    bridge.emit('callinvite', { from: 'sess-b', name: 'Beto' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('entrega "callerleft" y deja de notificar tras desuscribirse (issue #2, D7)', () => {
    const bridge = createOfficeBridge();
    const handler = vi.fn();

    const unsubscribe = bridge.on('callerleft', handler);
    bridge.emit('callerleft', { from: 'sess-a' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ from: 'sess-a' });

    unsubscribe();
    bridge.emit('callerleft', { from: 'sess-b' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('entrega "callaccepted" y deja de notificar tras desuscribirse (issue #2, D3)', () => {
    const bridge = createOfficeBridge();
    const handler = vi.fn();

    const unsubscribe = bridge.on('callaccepted', handler);
    bridge.emit('callaccepted', { by: 'sess-a', name: 'Ana' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ by: 'sess-a', name: 'Ana' });

    unsubscribe();
    bridge.emit('callaccepted', { by: 'sess-b', name: 'Beto' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('"callPeer" viaja por el canal de comandos y respeta la desuscripcion (issue #2, D3)', () => {
    const bridge = createOfficeBridge();
    const handler = vi.fn();

    const unsubscribe = bridge.onCommand('callPeer', handler);
    bridge.emitCommand('callPeer', { sessionId: 'sess-a' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ sessionId: 'sess-a' });

    unsubscribe();
    bridge.emitCommand('callPeer', { sessionId: 'sess-b' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('"respondCall" viaja por el canal de comandos y respeta la desuscripcion (issue #2, D3)', () => {
    const bridge = createOfficeBridge();
    const handler = vi.fn();

    const unsubscribe = bridge.onCommand('respondCall', handler);
    bridge.emitCommand('respondCall', { from: 'sess-a', accept: true });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ from: 'sess-a', accept: true });

    unsubscribe();
    bridge.emitCommand('respondCall', { from: 'sess-b', accept: false });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('"walkToPeer" viaja por el canal de comandos y respeta la desuscripcion (issue #2, D3)', () => {
    const bridge = createOfficeBridge();
    const handler = vi.fn();

    const unsubscribe = bridge.onCommand('walkToPeer', handler);
    bridge.emitCommand('walkToPeer', { sessionId: 'sess-a' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ sessionId: 'sess-a' });

    unsubscribe();
    bridge.emitCommand('walkToPeer', { sessionId: 'sess-b' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('no crece una superficie de metodos de conveniencia para las llamadas de voz (D3)', () => {
    // Paridad con la regla de `setStatus`: los 3 comandos nuevos viajan solo
    // por `emitCommand`, nunca como `bridge.callPeer()`.
    const bridge = createOfficeBridge();

    expect(bridge).not.toHaveProperty('callPeer');
    expect(bridge).not.toHaveProperty('respondCall');
    expect(bridge).not.toHaveProperty('walkToPeer');
  });

  it('entrega el payload de "roster" y deja de notificar tras desuscribirse (#74)', () => {
    const bridge = createOfficeBridge();
    const handler = vi.fn();
    const peers = [{ sessionId: 'par-1', name: 'Ana Real', status: 'g' as const }];

    const unsubscribe = bridge.on('roster', handler);
    bridge.emit('roster', { peers });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ peers });

    unsubscribe();
    bridge.emit('roster', { peers: [] });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('entrega el payload de "spacesstale" y deja de notificar tras desuscribirse (#74, PR3a)', () => {
    const bridge = createOfficeBridge();
    const handler = vi.fn();

    const unsubscribe = bridge.on('spacesstale', handler);
    bridge.emit('spacesstale', { version: 'version-de-un-par' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ version: 'version-de-un-par' });

    unsubscribe();
    bridge.emit('spacesstale', { version: 'otra-version' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('"layoutedit" viaja por el canal de comandos, null incluido (#74, PR3b)', () => {
    const bridge = createOfficeBridge();
    const handler = vi.fn();
    const command: OfficeCommandMap['layoutedit'] = {
      pickable: [{ id: 'desk-1', x0: 2, y0: 2, x1: 4, y1: 4 }],
      selectedId: null,
      placing: null,
    };

    const unsubscribe = bridge.onCommand('layoutedit', handler);
    bridge.emitCommand('layoutedit', command);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(command);

    // null es la senal de salir del modo edicion, no un payload ausente.
    bridge.emitCommand('layoutedit', null);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenLastCalledWith(null);

    unsubscribe();
    bridge.emitCommand('layoutedit', null);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('entrega el payload de "layoutpick" y deja de notificar tras desuscribirse (#74, PR3b)', () => {
    const bridge = createOfficeBridge();
    const handler = vi.fn();

    const unsubscribe = bridge.on('layoutpick', handler);
    bridge.emit('layoutpick', { id: 'desk-1' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ id: 'desk-1' });

    unsubscribe();
    bridge.emit('layoutpick', { id: 'desk-2' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('entrega el payload de "layoutplace" y deja de notificar tras desuscribirse (#74, PR3b)', () => {
    const bridge = createOfficeBridge();
    const handler = vi.fn();

    const unsubscribe = bridge.on('layoutplace', handler);
    bridge.emit('layoutplace', { tx: 5, ty: 5, valid: true });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ tx: 5, ty: 5, valid: true });

    unsubscribe();
    bridge.emit('layoutplace', { tx: 1, ty: 1, valid: false });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('entrega el payload de "portraits" y deja de notificar tras desuscribirse (issue #17, D1)', () => {
    const bridge = createOfficeBridge();
    const handler = vi.fn();
    const byKey = { av0: 'data:image/png;base64,AAAA' };

    const unsubscribe = bridge.on('portraits', handler);
    bridge.emit('portraits', { byKey });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ byKey });

    unsubscribe();
    bridge.emit('portraits', { byKey: {} });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
