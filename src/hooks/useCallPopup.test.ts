import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTO_OPEN_DELAY_MS, DEFAULT_POPUP_SIZE, copyStylesheets, useCallPopup } from './useCallPopup';

/** A window double: its own document, and a `close()` that fires `pagehide` like a real one. */
function fakeWindow() {
  const target = new EventTarget();
  const win = {
    document: document.implementation.createHTMLDocument('popup'),
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    close: vi.fn(() => {
      target.dispatchEvent(new Event('pagehide'));
    }),
    innerWidth: 200,
    innerHeight: 300,
    resizeBy: vi.fn(),
    moveTo: vi.fn(),
    moveBy: vi.fn(),
  };
  return { win, asWindow: win as unknown as Window };
}

function installPip(requestWindow: (options?: DocumentPictureInPictureOptions) => Promise<Window>) {
  Object.defineProperty(window, 'documentPictureInPicture', {
    configurable: true,
    value: { requestWindow, window: null },
  });
}

/** `window.open` double; `null` is what a browser answers when it blocks the popup. */
function stubWindowOpen(result: Window | null) {
  return vi.spyOn(window, 'open').mockImplementation(() => result);
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** `navigator.mediaSession` double that keeps the handlers it was given. */
function installMediaSession() {
  const handlers = new Map<string, (() => void) | null>();
  Object.defineProperty(navigator, 'mediaSession', {
    configurable: true,
    value: { setActionHandler: vi.fn((action: string, handler: (() => void) | null) => handlers.set(action, handler)) },
  });
  return handlers;
}

beforeEach(() => {
  setVisibility('visible');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'documentPictureInPicture');
  Reflect.deleteProperty(navigator, 'mediaSession');
  Reflect.deleteProperty(document, 'visibilityState');
});

describe('useCallPopup: manual open', () => {
  it('opens a Document Picture-in-Picture window sized for the popup and exposes it as the pip variant', async () => {
    const { asWindow } = fakeWindow();
    const requestWindow = vi.fn(async () => asWindow);
    installPip(requestWindow);
    const { result } = renderHook(() => useCallPopup({ active: true }));

    await act(() => result.current.open());

    expect(requestWindow).toHaveBeenCalledOnce();
    expect(requestWindow).toHaveBeenCalledWith(expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) }));
    expect(result.current.popupWindow).toBe(asWindow);
    expect(result.current.variant).toBe('pip');
  });

  it('does not open a second window while one is open or opening', async () => {
    const { asWindow } = fakeWindow();
    const requestWindow = vi.fn(async () => asWindow);
    installPip(requestWindow);
    const { result } = renderHook(() => useCallPopup({ active: true }));

    await act(async () => {
      void result.current.open();
      void result.current.open();
    });
    await act(() => result.current.open());

    expect(requestWindow).toHaveBeenCalledOnce();
  });

  it('closes the window it just got when the call ended while it was opening', async () => {
    const { win, asWindow } = fakeWindow();
    let resolveWindow!: (window: Window) => void;
    installPip(() => new Promise<Window>((resolve) => { resolveWindow = resolve; }));
    const { result, rerender } = renderHook(({ active }) => useCallPopup({ active }), { initialProps: { active: true } });

    let opening!: Promise<void>;
    act(() => { opening = result.current.open(); });
    rerender({ active: false });
    await act(async () => {
      resolveWindow(asWindow);
      await opening;
    });

    expect(win.close).toHaveBeenCalledOnce();
    expect(result.current.popupWindow).toBeNull();
  });
});

describe('useCallPopup: a plain browser popup where Document Picture-in-Picture is missing or refused', () => {
  it('opens a small window.open popup in browsers without the API (Firefox, Safari)', async () => {
    const { asWindow } = fakeWindow();
    const open = stubWindowOpen(asWindow);
    const { result } = renderHook(() => useCallPopup({ active: true }));

    await act(() => result.current.open());

    expect(open).toHaveBeenCalledOnce();
    expect(open.mock.calls[0][2]).toMatch(/popup=yes/);
    expect(open.mock.calls[0][2]).toMatch(/width=\d+/);
    expect(open.mock.calls[0][2]).toMatch(/height=\d+/);
    expect(result.current.popupWindow).toBe(asWindow);
    expect(result.current.variant).toBe('popup');
  });

  it('falls back to it when Document Picture-in-Picture rejects (no user gesture)', async () => {
    installPip(vi.fn(async () => Promise.reject(new DOMException('needs a user gesture', 'NotAllowedError'))));
    const { asWindow } = fakeWindow();
    const open = stubWindowOpen(asWindow);
    const { result } = renderHook(() => useCallPopup({ active: true }));

    await act(() => result.current.open());

    expect(open).toHaveBeenCalledOnce();
    expect(result.current.variant).toBe('popup');
  });

  it('stays closed, without throwing, when the browser blocks the popup (null), and tries again next time', async () => {
    const open = stubWindowOpen(null);
    const { result } = renderHook(() => useCallPopup({ active: true }));

    await act(() => result.current.open());
    expect(result.current.popupWindow).toBeNull();
    expect(result.current.variant).toBeNull();

    const { asWindow } = fakeWindow();
    open.mockImplementation(() => asWindow);
    await act(() => result.current.open());

    expect(open).toHaveBeenCalledTimes(2);
    expect(result.current.popupWindow).toBe(asWindow);
  });

  it('survives window.open throwing', async () => {
    vi.spyOn(window, 'open').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const { result } = renderHook(() => useCallPopup({ active: true }));

    await act(() => result.current.open());

    expect(result.current.popupWindow).toBeNull();
  });

  it('gives the popup the app styles and a title', async () => {
    const { win, asWindow } = fakeWindow();
    stubWindowOpen(asWindow);
    document.head.insertAdjacentHTML('beforeend', '<style data-test-sheet>.a { color: red }</style>');
    const { result } = renderHook(() => useCallPopup({ active: true }));

    await act(() => result.current.open());

    expect(win.document.head.querySelector('style')?.textContent).toBe('.a { color: red }');
    expect(win.document.title).not.toBe('');
    document.head.querySelectorAll('[data-test-sheet]').forEach((node) => node.remove());
  });
});

describe('useCallPopup: the size of the window (5)', () => {
  const NotAllowed = () => new DOMException('resizeBy needs transient activation', 'NotAllowedError');

  async function openPopup() {
    const popup = fakeWindow();
    installPip(vi.fn(async () => popup.asWindow));
    const hook = renderHook(() => useCallPopup({ active: true }));
    await act(() => hook.result.current.open());
    return { ...popup, ...hook };
  }

  it('opens at the size the content asked for, Document Picture-in-Picture and plain popup alike', async () => {
    const { asWindow } = fakeWindow();
    const requestWindow = vi.fn(async () => asWindow);
    installPip(requestWindow);
    const open = stubWindowOpen(null);
    const { result } = renderHook(() => useCallPopup({ active: true }));

    act(() => result.current.setSize({ width: 333, height: 444 }));
    await act(() => result.current.open());
    expect(requestWindow).toHaveBeenCalledWith({ width: 333, height: 444 });

    Reflect.deleteProperty(window, 'documentPictureInPicture');
    act(() => result.current.close());
    await act(() => result.current.open());
    expect(open.mock.calls[0][2]).toMatch(/width=333/);
    expect(open.mock.calls[0][2]).toMatch(/height=444/);
  });

  it('opens at a default size until the content says otherwise', async () => {
    const { asWindow } = fakeWindow();
    const requestWindow = vi.fn(async () => asWindow);
    installPip(requestWindow);
    const { result } = renderHook(() => useCallPopup({ active: true }));

    await act(() => result.current.open());

    expect(requestWindow).toHaveBeenCalledWith(DEFAULT_POPUP_SIZE);
  });

  it('resizes the open window to the new content height, keeping the width the user gave it', async () => {
    const { win, result } = await openPopup();

    act(() => result.current.setSize({ width: 999, height: 420 }));

    expect(win.resizeBy).toHaveBeenCalledExactlyOnceWith(0, 120);
  });

  it('shrinks it too when people leave', async () => {
    const { win, result } = await openPopup();

    act(() => result.current.setSize({ width: 200, height: 250 }));

    expect(win.resizeBy).toHaveBeenCalledExactlyOnceWith(0, -50);
  });

  it('leaves the window alone when it already has the height', async () => {
    const { win, result } = await openPopup();

    act(() => result.current.setSize({ width: 200, height: 300 }));

    expect(win.resizeBy).not.toHaveBeenCalled();
  });

  it('never repositions the window', async () => {
    const { win, result } = await openPopup();

    act(() => result.current.setSize({ width: 200, height: 420 }));

    expect(win.moveTo).not.toHaveBeenCalled();
    expect(win.moveBy).not.toHaveBeenCalled();
  });

  it('swallows the rejection of a resize without a user gesture, and the content keeps adapting', async () => {
    const { win, result } = await openPopup();
    win.resizeBy.mockImplementation(() => {
      throw NotAllowed();
    });

    expect(() => act(() => result.current.setSize({ width: 200, height: 420 }))).not.toThrow();
    expect(result.current.popupWindow).not.toBeNull();
  });

  it('tries again on the next user gesture inside the window, once, until it works', async () => {
    const { win, result } = await openPopup();
    win.resizeBy.mockImplementationOnce(() => {
      throw NotAllowed();
    });
    act(() => result.current.setSize({ width: 200, height: 420 }));
    expect(win.resizeBy).toHaveBeenCalledTimes(1);

    act(() => result.current.applySize());
    expect(win.resizeBy).toHaveBeenCalledTimes(2);
    expect(win.resizeBy).toHaveBeenLastCalledWith(0, 120);

    // It went through: a later click does not undo the user's own resizing.
    act(() => result.current.applySize());
    expect(win.resizeBy).toHaveBeenCalledTimes(2);
  });

  it('does not fight a window the user sized: nothing is retried without a new size', async () => {
    const { win, result } = await openPopup();

    act(() => result.current.applySize());

    expect(win.resizeBy).not.toHaveBeenCalled();
  });

  it('survives a window that cannot be resized at all', async () => {
    const { win, result } = await openPopup();
    Reflect.deleteProperty(win, 'resizeBy');

    expect(() => act(() => result.current.setSize({ width: 200, height: 420 }))).not.toThrow();
  });

  it('does nothing while the window is closed', () => {
    const { result } = renderHook(() => useCallPopup({ active: true }));

    expect(() => act(() => result.current.setSize({ width: 200, height: 420 }))).not.toThrow();
    expect(() => act(() => result.current.applySize())).not.toThrow();
  });
});

describe('useCallPopup: closing', () => {
  async function openPopup(active = true) {
    const popup = fakeWindow();
    installPip(vi.fn(async () => popup.asWindow));
    const hook = renderHook(({ active: on }) => useCallPopup({ active: on }), { initialProps: { active } });
    await act(() => hook.result.current.open());
    return { ...popup, ...hook };
  }

  it('closes when the user comes back to the tab', async () => {
    const { win, result } = await openPopup();

    act(() => setVisibility('hidden'));
    expect(result.current.popupWindow).not.toBeNull();
    act(() => setVisibility('visible'));

    expect(win.close).toHaveBeenCalledOnce();
    expect(result.current.popupWindow).toBeNull();
  });

  it('closes when the call ends, or the player leaves the space (active goes false)', async () => {
    const { win, result, rerender } = await openPopup();

    rerender({ active: false });

    expect(win.close).toHaveBeenCalledOnce();
    expect(result.current.popupWindow).toBeNull();
  });

  it('closes when the component unmounts', async () => {
    const { win, unmount } = await openPopup();

    unmount();

    expect(win.close).toHaveBeenCalledOnce();
  });

  it('closes when the tab itself goes away, which would leave a plain popup orphaned', async () => {
    const { win } = await openPopup();

    act(() => { window.dispatchEvent(new Event('pagehide')); });

    expect(win.close).toHaveBeenCalledOnce();
  });

  it('forgets a window the user closed itself (pagehide)', async () => {
    const { win, result } = await openPopup();

    act(() => { win.close(); });

    expect(result.current.popupWindow).toBeNull();
  });

  it('can be opened again after closing', async () => {
    const { result } = await openPopup();
    act(() => result.current.close());
    expect(result.current.popupWindow).toBeNull();

    await act(() => result.current.open());

    expect(result.current.popupWindow).not.toBeNull();
  });
});

describe('useCallPopup: opening when the tab is left', () => {
  it('registers the enterpictureinpicture handler during a call, and opens from it', async () => {
    const { asWindow } = fakeWindow();
    installPip(vi.fn(async () => asWindow));
    const handlers = installMediaSession();
    const { result } = renderHook(() => useCallPopup({ active: true }));

    const handler = handlers.get('enterpictureinpicture');
    expect(handler).toBeTypeOf('function');
    await act(async () => handler?.());

    expect(result.current.popupWindow).toBe(asWindow);
  });

  it('does not register it without a call, and drops it when the call ends', () => {
    installPip(vi.fn());
    const handlers = installMediaSession();
    const { rerender } = renderHook(({ active }) => useCallPopup({ active }), { initialProps: { active: false } });
    expect(handlers.get('enterpictureinpicture')).toBeUndefined();

    rerender({ active: true });
    expect(handlers.get('enterpictureinpicture')).toBeTypeOf('function');
    rerender({ active: false });
    expect(handlers.get('enterpictureinpicture')).toBeNull();
  });

  it('survives a browser that does not know the action', () => {
    Object.defineProperty(navigator, 'mediaSession', {
      configurable: true,
      value: { setActionHandler: vi.fn(() => { throw new TypeError('unsupported action'); }) },
    });

    expect(() => renderHook(() => useCallPopup({ active: true }))).not.toThrow();
  });

  it('does not wait for mediaSession: hiding the tab opens it after a short delay', async () => {
    vi.useFakeTimers();
    const { asWindow } = fakeWindow();
    const requestWindow = vi.fn(async () => asWindow);
    installPip(requestWindow);
    const { result } = renderHook(() => useCallPopup({ active: true }));

    act(() => setVisibility('hidden'));
    expect(requestWindow).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(AUTO_OPEN_DELAY_MS); });

    expect(requestWindow).toHaveBeenCalledOnce();
    expect(result.current.popupWindow).toBe(asWindow);
  });

  it('falls through to a plain popup when hiding the tab finds Document Picture-in-Picture refusing', async () => {
    vi.useFakeTimers();
    installPip(vi.fn(async () => Promise.reject(new DOMException('needs a user gesture', 'NotAllowedError'))));
    const { asWindow } = fakeWindow();
    const open = stubWindowOpen(asWindow);
    const { result } = renderHook(() => useCallPopup({ active: true }));

    act(() => setVisibility('hidden'));
    await act(async () => { vi.advanceTimersByTime(AUTO_OPEN_DELAY_MS); });

    expect(open).toHaveBeenCalledOnce();
    expect(result.current.variant).toBe('popup');
  });

  it('never opens twice when the mediaSession handler already did', async () => {
    vi.useFakeTimers();
    const { asWindow } = fakeWindow();
    const requestWindow = vi.fn(async () => asWindow);
    installPip(requestWindow);
    const handlers = installMediaSession();
    renderHook(() => useCallPopup({ active: true }));

    act(() => setVisibility('hidden'));
    await act(async () => handlers.get('enterpictureinpicture')?.());
    await act(async () => { vi.advanceTimersByTime(AUTO_OPEN_DELAY_MS * 2); });

    expect(requestWindow).toHaveBeenCalledOnce();
  });

  it('does nothing if the user is back before the delay ends', async () => {
    vi.useFakeTimers();
    const requestWindow = vi.fn();
    installPip(requestWindow);
    renderHook(() => useCallPopup({ active: true }));

    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));
    await act(async () => { vi.advanceTimersByTime(AUTO_OPEN_DELAY_MS * 2); });

    expect(requestWindow).not.toHaveBeenCalled();
  });

  it('does not open when it is not active (no call, or not in a space)', async () => {
    vi.useFakeTimers();
    const requestWindow = vi.fn();
    installPip(requestWindow);
    const open = stubWindowOpen(null);
    renderHook(() => useCallPopup({ active: false }));

    act(() => setVisibility('hidden'));
    await act(async () => { vi.advanceTimersByTime(AUTO_OPEN_DELAY_MS * 2); });

    expect(requestWindow).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('tries again on the next hide after a blocked popup', async () => {
    vi.useFakeTimers();
    const open = stubWindowOpen(null);
    renderHook(() => useCallPopup({ active: true }));

    act(() => setVisibility('hidden'));
    await act(async () => { vi.advanceTimersByTime(AUTO_OPEN_DELAY_MS); });
    act(() => setVisibility('visible'));
    act(() => setVisibility('hidden'));
    await act(async () => { vi.advanceTimersByTime(AUTO_OPEN_DELAY_MS); });

    expect(open).toHaveBeenCalledTimes(2);
  });
});

describe('copyStylesheets', () => {
  afterEach(() => {
    document.head.querySelectorAll('[data-test-sheet]').forEach((node) => node.remove());
  });

  it('copies inline styles and re-links stylesheets with an absolute href', () => {
    document.head.insertAdjacentHTML(
      'beforeend',
      '<style data-test-sheet>.a { color: red }</style>' +
        '<link data-test-sheet rel="stylesheet" href="/assets/app.css">' +
        '<link data-test-sheet rel="icon" href="/icon.png">',
    );
    const target = document.implementation.createHTMLDocument('pip');

    copyStylesheets(document, target);

    expect(target.head.querySelector('style')?.textContent).toBe('.a { color: red }');
    const links = target.head.querySelectorAll('link');
    expect(links).toHaveLength(1);
    expect(links[0].rel).toBe('stylesheet');
    // The window has no base URL of its own, so a relative href would not resolve.
    expect(links[0].getAttribute('href')).toBe(new URL('/assets/app.css', document.baseURI).href);
  });
});
