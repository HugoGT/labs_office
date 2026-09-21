import { describe, expect, it, vi } from 'vitest';
import { createOfficeBridge } from './officeBridge';

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

  it('expone un canal de anclas independiente por instancia, ajeno al EventTarget de eventos (issue #17, D4)', () => {
    const bridgeA = createOfficeBridge();
    const bridgeB = createOfficeBridge();

    const writer = bridgeA.anchors.open();
    writer.set('par-1', 10, 20, true);
    writer.commit();

    expect(bridgeA.anchors.snapshot().anchors.get('par-1')).toEqual({
      x: 10,
      y: 20,
      onScreen: true,
    });
    // Dos instancias no comparten canal de anclas, igual que no comparten eventos.
    expect(bridgeB.anchors.snapshot().anchors.size).toBe(0);
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
