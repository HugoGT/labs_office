import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createInstallPromptStore } from '../pwa/installPromptStore';
import { useInstallPrompt, type InstallHost } from './useInstallPrompt';

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';

function fakeHost({ userAgent = CHROME, vendor = 'Google Inc.', maxTouchPoints = 0, standalone = false, navigatorStandalone = undefined as boolean | undefined } = {}) {
  const listeners = new Set<() => void>();
  const query = {
    matches: standalone,
    addEventListener: vi.fn((_type: 'change', listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: 'change', listener: () => void) => listeners.delete(listener)),
  };
  const host: InstallHost = {
    matchMedia: vi.fn(() => query),
    navigator: { userAgent, vendor, maxTouchPoints, standalone: navigatorStandalone },
  };
  const becomeStandalone = () => {
    query.matches = true;
    for (const listener of listeners) listener();
  };
  return { host, query, becomeStandalone };
}

function installPromptEvent(outcome: 'accepted' | 'dismissed') {
  return Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: vi.fn(async () => {}),
    userChoice: Promise.resolve({ outcome, platform: 'web' }),
  });
}

describe('useInstallPrompt (#13)', () => {
  it('Chromium offers nothing until beforeinstallprompt, then the prompt, then nothing once accepted', async () => {
    const target = new EventTarget();
    const store = createInstallPromptStore(target);
    const { host } = fakeHost();
    const { result } = renderHook(() => useInstallPrompt(store, host));
    expect(result.current).toBeNull();

    const event = installPromptEvent('accepted');
    act(() => {
      target.dispatchEvent(event);
    });
    expect(result.current?.kind).toBe('prompt');

    await act(async () => {
      if (result.current?.kind === 'prompt') result.current.onInstall();
    });
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(result.current).toBeNull();
  });

  it('asks the standalone display mode, the only sign of running installed', () => {
    const { host } = fakeHost();
    renderHook(() => useInstallPrompt(createInstallPromptStore(new EventTarget()), host));
    expect(host.matchMedia).toHaveBeenCalledWith('(display-mode: standalone)');
  });

  it('Safari on iPhone offers the manual steps without any event', () => {
    const { host } = fakeHost({ userAgent: SAFARI_IPHONE, vendor: 'Apple Computer, Inc.', maxTouchPoints: 5 });
    const { result } = renderHook(() => useInstallPrompt(createInstallPromptStore(new EventTarget()), host));
    expect(result.current).toEqual({ kind: 'ios' });
  });

  it('opened from the iOS home screen (navigator.standalone) it offers nothing', () => {
    const { host } = fakeHost({ userAgent: SAFARI_IPHONE, vendor: 'Apple Computer, Inc.', maxTouchPoints: 5, navigatorStandalone: true });
    const { result } = renderHook(() => useInstallPrompt(createInstallPromptStore(new EventTarget()), host));
    expect(result.current).toBeNull();
  });

  it('hides the offer when the page starts running installed, and stops listening on unmount', () => {
    const target = new EventTarget();
    const store = createInstallPromptStore(target);
    const { host, query, becomeStandalone } = fakeHost();
    const { result, unmount } = renderHook(() => useInstallPrompt(store, host));
    act(() => {
      target.dispatchEvent(installPromptEvent('accepted'));
    });

    act(becomeStandalone);
    expect(result.current).toBeNull();

    unmount();
    expect(query.removeEventListener).toHaveBeenCalled();
  });

  it('a browser without matchMedia (jsdom) still works', () => {
    const { host } = fakeHost();
    const { result } = renderHook(() =>
      useInstallPrompt(createInstallPromptStore(new EventTarget()), { navigator: host.navigator }),
    );
    expect(result.current).toBeNull();
  });
});
