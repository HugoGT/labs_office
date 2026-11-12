import { useCallback, useEffect, useRef, useState } from 'react';

/** A narrow column: faces and the shared screen stacked, the controls under them. */
const POPUP_WIDTH = 240;
const POPUP_HEIGHT = 560;
const POPUP_NAME = 'labs-call-popup';
const POPUP_TITLE = 'Labs · llamada';
/**
 * How long a hidden tab gives the `enterpictureinpicture` handler to open the
 * popup before this hook does it itself. The handler is the only way Document
 * PiP opens without a click, so it goes first; the delay is what keeps the
 * two from opening a window each.
 */
export const AUTO_OPEN_DELAY_MS = 400;

/** `pip`: Document Picture-in-Picture, the installed app's floating window. `popup`: a plain `window.open`. */
export type CallPopupVariant = 'pip' | 'popup';

export interface UseCallPopupOptions {
  /** In a space with a live call: the popup may exist. False closes it. */
  active: boolean;
}

export interface CallPopupControl {
  /** The floating window while it is open: whoever renders into it portals into its document. */
  popupWindow: Window | null;
  variant: CallPopupVariant | null;
  /** Opens the window. A click is the user gesture that lets the browser allow it. */
  open: () => Promise<void>;
  close: () => void;
}

interface OpenedWindow {
  window: Window;
  variant: CallPopupVariant;
}

/** Document PiP, or `null` where the browser lacks it (Firefox, Safari) or refuses (no user gesture). */
async function openDocumentPip(): Promise<OpenedWindow | null> {
  const api = window.documentPictureInPicture;
  if (api === undefined) return null;
  try {
    return { window: await api.requestWindow({ width: POPUP_WIDTH, height: POPUP_HEIGHT }), variant: 'pip' };
  } catch {
    return null;
  }
}

/**
 * A plain popup. Without a user gesture the browser blocks it and, in most
 * browsers, offers the user to allow popups for the site: `null` then, and
 * the next hide or click tries again.
 */
function openPlainPopup(): OpenedWindow | null {
  try {
    const opened = window.open('', POPUP_NAME, `popup=yes,width=${POPUP_WIDTH},height=${POPUP_HEIGHT}`);
    return opened === null ? null : { window: opened, variant: 'popup' };
  } catch {
    return null;
  }
}

/**
 * Copies what styles the app into the popup, which starts empty. Inline
 * `<style>` elements are cloned; a stylesheet is linked again by its
 * ABSOLUTE `href`, because the window has no base URL to resolve a relative
 * one against. Done once: the popup is short-lived.
 */
export function copyStylesheets(source: Document, target: Document): void {
  for (const element of source.querySelectorAll('style, link[rel~="stylesheet"]')) {
    if (element instanceof HTMLLinkElement) {
      const link = target.createElement('link');
      link.rel = 'stylesheet';
      link.href = element.href;
      target.head.appendChild(link);
    } else {
      target.head.appendChild(target.importNode(element, true));
    }
  }
}

/**
 * The floating call popup of #320: a window that stays apart from the tab
 * (above the other windows when it is Document Picture-in-Picture), opened
 * when the user leaves the tab during a call in a space and closed when they
 * come back, leave the space or the call ends.
 *
 * Opening needs a user gesture and `visibilitychange` is not one, so it is a
 * chain, each step only when the one before did not open it:
 * 1. Chrome's automatic picture-in-picture: with a handler for the
 *    `enterpictureinpicture` media session action, Chrome (desktop, 120+)
 *    fires it as the tab is left and lets it open Document PiP. It is
 *    conditional (camera or microphone being captured, the user's setting for
 *    the site), and did not fire for the user in practice.
 * 2. After `AUTO_OPEN_DELAY_MS` of a hidden tab, Document PiP again, which
 *    rejects without a gesture; then
 * 3. `window.open`, which also needs a gesture: the browser blocks it and
 *    asks the user to allow popups for the site, and once allowed, later
 *    hides open it.
 * A button calls `open` too: its click is the gesture, so there all of it works.
 */
export function useCallPopup({ active }: UseCallPopupOptions): CallPopupControl {
  const [opened, setOpened] = useState<OpenedWindow | null>(null);
  const openedRef = useRef<OpenedWindow | null>(null);
  const openingRef = useRef(false);
  // Read after an await: the call may have ended while the browser was opening the window.
  const wantedRef = useRef(active);

  const forget = useCallback((closed: Window) => {
    if (openedRef.current?.window !== closed) return;
    openedRef.current = null;
    setOpened(null);
  }, []);

  const close = useCallback(() => {
    const current = openedRef.current;
    if (current === null) return;
    forget(current.window);
    current.window.close();
  }, [forget]);

  const open = useCallback(async () => {
    if (openedRef.current !== null || openingRef.current) return;
    openingRef.current = true;
    try {
      const result = (await openDocumentPip()) ?? openPlainPopup();
      if (result === null) return;
      if (!wantedRef.current) {
        result.window.close();
        return;
      }
      copyStylesheets(document, result.window.document);
      result.window.document.title = POPUP_TITLE;
      // The user can close it from the window itself; closing it here fires this too.
      result.window.addEventListener('pagehide', () => forget(result.window));
      openedRef.current = result;
      setOpened(result);
    } finally {
      openingRef.current = false;
    }
  }, [forget]);

  useEffect(() => {
    wantedRef.current = active;
    if (!active) close();
  }, [active, close]);

  useEffect(() => {
    wantedRef.current = true;
    return () => {
      wantedRef.current = false;
      close();
    };
  }, [close]);

  // Back on the tab, the popup has nothing left to do.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') close();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [close]);

  // A plain popup outlives its opener: it must not stay behind with a dead React tree.
  useEffect(() => {
    window.addEventListener('pagehide', close);
    return () => window.removeEventListener('pagehide', close);
  }, [close]);

  useEffect(() => {
    if (!active) return undefined;
    const session = navigator.mediaSession;
    if (!session) return undefined;
    try {
      session.setActionHandler('enterpictureinpicture', () => void open());
    } catch {
      // A TypeError in browsers that do not know the action: the delay below and the button remain.
      return undefined;
    }
    return () => {
      try {
        session.setActionHandler('enterpictureinpicture', null);
      } catch {
        // Nothing was registered.
      }
    };
  }, [active, open]);

  useEffect(() => {
    if (!active) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onVisibilityChange = () => {
      clearTimeout(timer);
      if (document.visibilityState !== 'hidden') return;
      timer = setTimeout(() => {
        if (document.visibilityState === 'hidden') void open();
      }, AUTO_OPEN_DELAY_MS);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [active, open]);

  return { popupWindow: opened?.window ?? null, variant: opened?.variant ?? null, open, close };
}
