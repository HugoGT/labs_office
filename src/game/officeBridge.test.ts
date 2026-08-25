import { describe, expect, it, vi } from 'vitest';
import { createOfficeBridge } from './officeBridge';

describe('createOfficeBridge', () => {
  it('entrega el payload emitido y deja de notificar tras desuscribirse (D1)', () => {
    const bridge = createOfficeBridge();
    const handler = vi.fn();

    const unsubscribe = bridge.on('nearby', handler);
    bridge.emit('nearby', { names: ['Ana'] });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ names: ['Ana'] });

    unsubscribe();
    bridge.emit('nearby', { names: ['Ana', 'Beto'] });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('dos instancias independientes no comparten entrega de eventos (office-bridge spec)', () => {
    const bridgeA = createOfficeBridge();
    const bridgeB = createOfficeBridge();
    const handlerA = vi.fn();
    const handlerB = vi.fn();

    bridgeA.on('room', handlerA);
    bridgeB.on('room', handlerB);
    bridgeA.emit('room', { room: 'Cafetería' });

    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerA).toHaveBeenCalledWith({ room: 'Cafetería' });
    expect(handlerB).not.toHaveBeenCalled();
  });

  it('nunca declara window.officeAPI (office-bridge spec: sin estado global)', () => {
    createOfficeBridge();

    expect((window as unknown as { officeAPI?: unknown }).officeAPI).toBeUndefined();
  });

  it('onCommand entrega comandos tipados y respeta la desuscripcion', () => {
    const bridge = createOfficeBridge();
    const handler = vi.fn();

    const unsubscribe = bridge.onCommand('teleportTo', handler);
    bridge.teleportTo(7);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ npcId: 7 });

    unsubscribe();
    bridge.teleportTo(8);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('callNpc entrega el comando de llamada y respeta la desuscripcion', () => {
    const bridge = createOfficeBridge();
    const handler = vi.fn();

    const unsubscribe = bridge.onCommand('callNpc', handler);
    bridge.callNpc(3);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ npcId: 3 });

    unsubscribe();
    bridge.callNpc(4);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('callNpc y teleportTo son canales distintos: uno no dispara el handler del otro', () => {
    const bridge = createOfficeBridge();
    const onCall = vi.fn();
    const onTeleport = vi.fn();

    bridge.onCommand('callNpc', onCall);
    bridge.onCommand('teleportTo', onTeleport);

    bridge.callNpc(1);

    expect(onCall).toHaveBeenCalledTimes(1);
    expect(onTeleport).not.toHaveBeenCalled();
  });
});
