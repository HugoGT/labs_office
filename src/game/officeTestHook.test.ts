import { describe, expect, it, vi } from 'vitest';
import { createOfficeBridge } from './officeBridge';
import { installOfficeTestHook, OFFICE_TEST_HOOK_KEY } from './officeTestHook';

describe('installOfficeTestHook', () => {
  it('attaches a hook exposing version, teleportToTile, and lastVoice on the target', () => {
    const bridge = createOfficeBridge();
    const target: Record<string, unknown> = {};

    installOfficeTestHook(bridge, target);

    const hook = target[OFFICE_TEST_HOOK_KEY] as Record<string, unknown>;
    expect(hook.version).toBe(1);
    expect(typeof hook.teleportToTile).toBe('function');
    expect(typeof hook.lastVoice).toBe('function');
  });

  it('the returned uninstall function removes the hook from the target', () => {
    const bridge = createOfficeBridge();
    const target: Record<string, unknown> = {};

    const uninstall = installOfficeTestHook(bridge, target);
    expect(target[OFFICE_TEST_HOOK_KEY]).toBeDefined();

    uninstall();

    expect(target[OFFICE_TEST_HOOK_KEY]).toBeUndefined();
  });

  it('teleportToTile forwards a teleportToTile command through bridge.onCommand', () => {
    const bridge = createOfficeBridge();
    const target: Record<string, unknown> = {};
    const handler = vi.fn();
    bridge.onCommand('teleportToTile', handler);

    installOfficeTestHook(bridge, target);
    const hook = target[OFFICE_TEST_HOOK_KEY] as { teleportToTile(tx: number, ty: number): void };
    hook.teleportToTile(56, 25);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ tx: 56, ty: 25 });
  });

  it('teleportToTile forwards a different tile too (triangulation)', () => {
    const bridge = createOfficeBridge();
    const target: Record<string, unknown> = {};
    const handler = vi.fn();
    bridge.onCommand('teleportToTile', handler);

    installOfficeTestHook(bridge, target);
    const hook = target[OFFICE_TEST_HOOK_KEY] as { teleportToTile(tx: number, ty: number): void };
    hook.teleportToTile(22, 28);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ tx: 22, ty: 28 });
  });

  it('lastVoice returns null before any "voice" event and the latest payload after', () => {
    const bridge = createOfficeBridge();
    const target: Record<string, unknown> = {};

    installOfficeTestHook(bridge, target);
    const hook = target[OFFICE_TEST_HOOK_KEY] as { lastVoice(): unknown };
    expect(hook.lastVoice()).toBeNull();

    bridge.emit('voice', { selfSessionId: 'self-1', sessionIds: ['peer-1'], room: null });
    expect(hook.lastVoice()).toEqual({ selfSessionId: 'self-1', sessionIds: ['peer-1'], room: null });

    bridge.emit('voice', { selfSessionId: 'self-1', sessionIds: [], room: 'Cafetería' });
    expect(hook.lastVoice()).toEqual({ selfSessionId: 'self-1', sessionIds: [], room: 'Cafetería' });
  });

  it('uninstall stops updating lastVoice from further "voice" events', () => {
    const bridge = createOfficeBridge();
    const target: Record<string, unknown> = {};

    const uninstall = installOfficeTestHook(bridge, target);
    const hook = target[OFFICE_TEST_HOOK_KEY] as { lastVoice(): unknown };
    bridge.emit('voice', { selfSessionId: 'self-1', sessionIds: [], room: null });
    expect(hook.lastVoice()).not.toBeNull();

    uninstall();
    bridge.emit('voice', { selfSessionId: 'self-1', sessionIds: ['peer-2'], room: 'Cafetería' });

    expect(hook.lastVoice()).toEqual({ selfSessionId: 'self-1', sessionIds: [], room: null });
  });

  it('never reintroduces a global window.officeAPI (matches office-bridge spec)', () => {
    const bridge = createOfficeBridge();
    const target: Record<string, unknown> = {};

    installOfficeTestHook(bridge, target);

    expect(target.officeAPI).toBeUndefined();
    expect((window as unknown as { officeAPI?: unknown }).officeAPI).toBeUndefined();
  });
});
