import { describe, expect, it, vi } from 'vitest';
import { createInstallPromptStore } from './installPromptStore';

type Outcome = 'accepted' | 'dismissed';

/** What Chromium dispatches: an Event with `prompt()` and a `userChoice` promise. */
function installPromptEvent(outcome: Outcome) {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  return Object.assign(event, {
    prompt: vi.fn(async () => {}),
    userChoice: Promise.resolve({ outcome, platform: 'web' }),
  });
}

describe('createInstallPromptStore (#13)', () => {
  it('starts with nothing to offer', () => {
    const store = createInstallPromptStore(new EventTarget());
    expect(store.getSnapshot()).toEqual({ promptAvailable: false, installed: false });
  });

  it('captures beforeinstallprompt and stops the browser from showing its own banner', () => {
    const target = new EventTarget();
    const store = createInstallPromptStore(target);
    const listener = vi.fn();
    store.subscribe(listener);
    const event = installPromptEvent('accepted');

    target.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(store.getSnapshot()).toEqual({ promptAvailable: true, installed: false });
    expect(listener).toHaveBeenCalled();
  });

  it('keeps the same snapshot object while nothing changes (useSyncExternalStore)', () => {
    const store = createInstallPromptStore(new EventTarget());
    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });

  it('an accepted prompt marks the app installed', async () => {
    const target = new EventTarget();
    const store = createInstallPromptStore(target);
    const event = installPromptEvent('accepted');
    target.dispatchEvent(event);

    await expect(store.prompt()).resolves.toBe('accepted');

    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toEqual({ promptAvailable: false, installed: true });
  });

  it('a dismissed prompt is spent: the event cannot prompt twice, so the offer goes until the browser fires again', async () => {
    const target = new EventTarget();
    const store = createInstallPromptStore(target);
    target.dispatchEvent(installPromptEvent('dismissed'));

    await expect(store.prompt()).resolves.toBe('dismissed');
    expect(store.getSnapshot()).toEqual({ promptAvailable: false, installed: false });

    target.dispatchEvent(installPromptEvent('accepted'));
    expect(store.getSnapshot().promptAvailable).toBe(true);
  });

  it('a prompt the browser refuses drops the offer instead of throwing', async () => {
    const target = new EventTarget();
    const store = createInstallPromptStore(target);
    const event = installPromptEvent('accepted');
    event.prompt.mockRejectedValueOnce(new DOMException('not allowed', 'NotAllowedError'));
    target.dispatchEvent(event);

    await expect(store.prompt()).resolves.toBe('unavailable');
    expect(store.getSnapshot()).toEqual({ promptAvailable: false, installed: false });
  });

  it('prompting without a captured event does nothing', async () => {
    const store = createInstallPromptStore(new EventTarget());
    await expect(store.prompt()).resolves.toBe('unavailable');
  });

  it('appinstalled (from the prompt or the browser menu) hides the offer for good', () => {
    const target = new EventTarget();
    const store = createInstallPromptStore(target);
    target.dispatchEvent(installPromptEvent('accepted'));

    target.dispatchEvent(new Event('appinstalled'));

    expect(store.getSnapshot()).toEqual({ promptAvailable: false, installed: true });
  });

  it('unsubscribed listeners are not called', () => {
    const target = new EventTarget();
    const store = createInstallPromptStore(target);
    const listener = vi.fn();
    store.subscribe(listener)();

    target.dispatchEvent(installPromptEvent('accepted'));

    expect(listener).not.toHaveBeenCalled();
  });
});
