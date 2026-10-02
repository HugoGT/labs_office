import { describe, expect, it } from 'vitest';
import { installMode, type InstallEnvironment } from './installMode';

const UA = {
  chromeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  edgeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  chromeMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0',
  safariMac26:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  safariMac18:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  // iPadOS asks for the desktop site by default: a Mac UA, told apart only by touch.
  safariIpadDesktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  chromeIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1',
  firefoxIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/143.0 Mobile/15E148 Safari/605.1.15',
  // In-app browsers (WKWebView) carry no `Version/... Safari/` and cannot add to the home screen.
  instagramIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 390.0.0',
} as const;

const APPLE = 'Apple Computer, Inc.';
const GOOGLE = 'Google Inc.';

function env(overrides: Partial<InstallEnvironment>): InstallEnvironment {
  return {
    displayModeStandalone: false,
    navigatorStandalone: undefined,
    userAgent: UA.chromeWindows,
    vendor: GOOGLE,
    maxTouchPoints: 0,
    promptAvailable: false,
    installed: false,
    ...overrides,
  };
}

describe('installMode (#13)', () => {
  it.each([
    ['Chrome on Windows', UA.chromeWindows, GOOGLE],
    ['Edge on Windows', UA.edgeWindows, GOOGLE],
    ['Chrome on Android', UA.chromeAndroid, GOOGLE],
    ['Chrome on macOS', UA.chromeMac, GOOGLE],
  ])('%s offers the native prompt once beforeinstallprompt fired', (_name, userAgent, vendor) => {
    expect(installMode(env({ userAgent, vendor, promptAvailable: true }))).toBe('prompt');
  });

  it.each([
    ['Chrome on Windows', UA.chromeWindows, GOOGLE],
    ['Chrome on macOS', UA.chromeMac, GOOGLE],
    ['Firefox on macOS', UA.firefoxMac, ''],
    ['Firefox on Linux', UA.firefoxLinux, ''],
    ['Chrome on iOS', UA.chromeIphone, APPLE],
    ['Firefox on iOS', UA.firefoxIphone, APPLE],
    ['an in-app browser on iOS', UA.instagramIphone, APPLE],
    ['Safari 18 on macOS (may run on Ventura, which has no Add to Dock)', UA.safariMac18, APPLE],
  ])('%s without the event offers nothing', (_name, userAgent, vendor) => {
    expect(installMode(env({ userAgent, vendor }))).toBe('none');
  });

  it('Safari on iPhone explains Add to Home Screen', () => {
    expect(installMode(env({ userAgent: UA.safariIphone, vendor: APPLE, maxTouchPoints: 5 }))).toBe('ios');
  });

  it('Safari on iPad with its desktop UA is told apart from a Mac by touch', () => {
    expect(installMode(env({ userAgent: UA.safariIpadDesktop, vendor: APPLE, maxTouchPoints: 5 }))).toBe('ios');
  });

  it('Safari 26 or later on macOS explains Add to Dock', () => {
    expect(installMode(env({ userAgent: UA.safariMac26, vendor: APPLE, maxTouchPoints: 0 }))).toBe('macos');
  });

  it('a non-Apple vendor claiming a Safari UA is not treated as Safari', () => {
    expect(installMode(env({ userAgent: UA.safariMac26, vendor: GOOGLE }))).toBe('none');
    expect(installMode(env({ userAgent: UA.safariIphone, vendor: '', maxTouchPoints: 5 }))).toBe('none');
  });

  it.each([
    ['display-mode standalone', { displayModeStandalone: true }],
    ['navigator.standalone (iOS home screen)', { navigatorStandalone: true }],
    ['an install this session (appinstalled or an accepted prompt)', { installed: true }],
  ])('running installed (%s) hides it everywhere', (_name, installedEnv) => {
    for (const base of [
      env({ promptAvailable: true }),
      env({ userAgent: UA.safariIphone, vendor: APPLE, maxTouchPoints: 5 }),
      env({ userAgent: UA.safariMac26, vendor: APPLE }),
    ]) {
      expect(installMode({ ...base, ...installedEnv })).toBe('none');
    }
  });

  it('navigator.standalone false (a Safari tab) does not count as installed', () => {
    expect(
      installMode(env({ userAgent: UA.safariIphone, vendor: APPLE, maxTouchPoints: 5, navigatorStandalone: false })),
    ).toBe('ios');
  });
});
