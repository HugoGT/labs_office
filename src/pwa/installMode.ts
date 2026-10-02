/**
 * Which install offer the office shows (#13). Pure, in the spirit of
 * `routing/route.ts`: the caller reads the browser and passes it in, so every
 * browser rule is tested without one.
 *
 * - `prompt`: the browser handed us `beforeinstallprompt` (Chrome and Edge on
 *   desktop and Android). It is the only reliable signal that installing is
 *   possible right now, and Chromium stops firing it once the app is
 *   installed, so a tab of an installed app offers nothing on its own.
 * - `ios`: Safari on iPhone or iPad has no event and no API, only the share
 *   sheet. A Safari tab cannot know whether the app is already on the home
 *   screen, so the steps may show there to someone who already installed it.
 * - `macos`: Safari on macOS installs through File > Add to Dock (Sonoma and
 *   later). The UA freezes the macOS version, so it is inferred from Safari's:
 *   Safari 26 only ships for macOS 14 and later, while Safari 17 and 18 also
 *   run on Ventura, where that menu item does not exist. Older Safari gets
 *   nothing rather than steps that lead nowhere. Same caveat as iOS about an
 *   app that is already installed.
 * - `none`: everything else (Firefox cannot install a PWA, Chromium before or
 *   without the event, the E2E build with no manifest, in-app browsers).
 */

export type InstallMode = 'none' | 'prompt' | 'ios' | 'macos';

export interface InstallEnvironment {
  /** `matchMedia('(display-mode: standalone)').matches`: running as an installed app. */
  readonly displayModeStandalone: boolean;
  /** `navigator.standalone`, Apple only: `true` when opened from the home screen. */
  readonly navigatorStandalone: boolean | undefined;
  readonly userAgent: string;
  /** `navigator.vendor`: `Apple Computer, Inc.` only in WebKit browsers. */
  readonly vendor: string;
  /** `navigator.maxTouchPoints`: the only thing telling iPadOS from a Mac. */
  readonly maxTouchPoints: number;
  /** A `beforeinstallprompt` event is captured and unused. */
  readonly promptAvailable: boolean;
  /** `appinstalled` fired, or the prompt was accepted, during this page's life. */
  readonly installed: boolean;
}

const SAFARI_MAC_MIN_VERSION = 26;

/** Other browsers on Apple devices reuse WebKit and Safari's tokens but add their own. */
const NOT_SAFARI = /CriOS|FxiOS|EdgiOS|OPiOS|Chrome|Chromium|Edg\/|Firefox|OPR\//;

function safariVersion(env: InstallEnvironment): number | null {
  if (!env.vendor.startsWith('Apple') || NOT_SAFARI.test(env.userAgent)) return null;
  const match = /Version\/(\d+)[\d.]*.*Safari\//.exec(env.userAgent);
  return match ? Number(match[1]) : null;
}

export function installMode(env: InstallEnvironment): InstallMode {
  if (env.installed || env.displayModeStandalone || env.navigatorStandalone === true) return 'none';
  if (env.promptAvailable) return 'prompt';

  const version = safariVersion(env);
  if (version === null) return 'none';
  const iphone = /iPhone|iPad|iPod/.test(env.userAgent);
  // iPadOS requests the desktop site with a Mac UA; no Mac has a touch screen.
  const ipadDesktop = /Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1;
  if (iphone || ipadDesktop) return 'ios';
  if (/Macintosh/.test(env.userAgent) && version >= SAFARI_MAC_MIN_VERSION) return 'macos';
  return 'none';
}
