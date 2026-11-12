import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttachableTrack } from '../game/attachableTrack';
import { createOfficeBridge, type OfficeBridge } from '../game/officeBridge';
import { avatarKeyFor } from '../game/remoteAvatars';
import type { CallPopupControl } from '../hooks/useCallPopup';
import { CallPopup } from './CallPopup';
import {
  CHROME_GAP,
  GRID_MIN_WIDTH,
  MAX_TILE_WIDTH,
  PILL_HEIGHT,
  POPUP_PADDING,
  STAGE_SIDE_MIN_WIDTH,
  desiredPopupSize,
  tileHeightFor,
} from './callPopupLayout';

/** Mirrors LiveKit: `detach()` returns every element, `detach(element)` that one element, not a list. */
function fakeVideoTrack(): AttachableTrack {
  const elements: HTMLMediaElement[] = [];
  const detach = (element?: HTMLMediaElement) => {
    if (!element) return elements.splice(0);
    elements.splice(elements.indexOf(element), 1);
    return element;
  };
  return {
    kind: 'video',
    attach() {
      const element = document.createElement('video');
      elements.push(element);
      return element;
    },
    detach: detach as AttachableTrack['detach'],
  };
}

/** The floating window: a document of its own, with a window, apart from the app's. */
function pipDocument(size = { width: 200, height: 400 }) {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const pipWindow = frame.contentWindow!;
  // The popup window's own size, which a test moves and announces with `resizeTo`.
  Object.defineProperty(pipWindow, 'innerWidth', { configurable: true, writable: true, value: size.width });
  Object.defineProperty(pipWindow, 'innerHeight', { configurable: true, writable: true, value: size.height });
  const resizeTo = (width: number, height = size.height) => {
    Object.assign(pipWindow, { innerWidth: width, innerHeight: height });
    act(() => {
      pipWindow.dispatchEvent(new Event('resize'));
    });
  };
  return { pipWindow, popupBody: within(pipWindow.document.body), body: pipWindow.document.body, resizeTo };
}

afterEach(() => {
  // Unmount first: React takes the popup out of a window that must still be there.
  cleanup();
  document.querySelectorAll('iframe').forEach((frame) => frame.remove());
});

function control(overrides: Partial<CallPopupControl> = {}): CallPopupControl {
  return {
    popupWindow: null,
    variant: null,
    open: vi.fn(async () => undefined),
    close: vi.fn(),
    setSize: vi.fn(),
    applySize: vi.fn(),
    ...overrides,
  };
}

function renderPopup(overrides: Partial<ComponentProps<typeof CallPopup>> = {}) {
  const bridge: OfficeBridge = createOfficeBridge();
  const props: ComponentProps<typeof CallPopup> = {
    popup: control(),
    bridge,
    available: true,
    placeLabel: 'Sala de Juntas',
    speakers: new Set<string>(),
    videoTracks: new Map<string, AttachableTrack>(),
    localVideoTrack: null,
    screenShareTracks: new Map<string, AttachableTrack>(),
    localScreenShareTrack: null,
    activeScreenSharer: null,
    micOn: true,
    camOn: false,
    screenShareOn: false,
    screenShareAvailable: true,
    controlsDisabled: false,
    onToggleMic: vi.fn(),
    onToggleCam: vi.fn(),
    onToggleScreenShare: vi.fn(),
    ...overrides,
  };
  const view = render(<CallPopup {...props} />);
  return {
    ...props,
    ...view,
    rerenderWith: (next: Partial<ComponentProps<typeof CallPopup>>) => view.rerender(<CallPopup {...props} {...next} />),
  };
}

const NAMES = ['Yo', 'Ana', 'Beto', 'Carla', 'Dani', 'Eva', 'Fran', 'Gus', 'Hugo'];

/** Yo plus `others` more, named in order: `p1`..; the first is the own session. */
function enterVoice(bridge: OfficeBridge, others = 2) {
  act(() =>
    bridge.emit('voice', {
      selfSessionId: 'yo',
      selfName: 'Yo',
      peers: Array.from({ length: others }, (_, index) => ({ sessionId: ['ana', 'beto', 'carla', 'dani', 'eva', 'fran', 'gus', 'hugo'][index], name: NAMES[index + 1] })),
      spaceId: 'sala',
    }),
  );
}

/** The window of a given variant, with the document to look into. */
function openWindow(variant: 'pip' | 'popup' = 'pip', size?: { width: number; height: number }) {
  const { pipWindow, ...rest } = pipDocument(size);
  return { ...rest, pipWindow, popup: control({ popupWindow: pipWindow, variant }) };
}

/** What `within(element)` returns: the queries of `screen`, without its debug helpers. */
type Queries = Omit<typeof screen, 'debug' | 'logTestingPlaygroundURL'>;
const tileNames = (popupBody: Queries) => popupBody.getAllByTestId('tile-name').map((name) => name.textContent);
const toolbar = (popupBody: Queries) => within(popupBody.getByRole('toolbar', { name: 'Controles de llamada' }));

describe('CallPopup: opening it by hand', () => {
  it('offers a button that opens the popup during a call, in any browser', () => {
    const popup = control();
    renderPopup({ popup });

    fireEvent.click(screen.getByRole('button', { name: 'Abrir ventana flotante de la llamada' }));

    expect(popup.open).toHaveBeenCalledOnce();
  });

  it('turns the same button into the one that closes it while it is open', () => {
    const { popup } = openWindow();
    renderPopup({ popup });

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar ventana flotante de la llamada' }));

    expect(popup.close).toHaveBeenCalledOnce();
    expect(popup.open).not.toHaveBeenCalled();
  });

  it('offers nothing when there is no call in a space', () => {
    renderPopup({ available: false });

    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('CallPopup: the floating window', () => {
  it('renders into the popup window, not into the tab', () => {
    const { popup, popupBody } = openWindow();
    renderPopup({ popup });

    expect(popupBody.getByRole('button', { name: 'Micrófono' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Micrófono' })).toBeNull();
  });

  it('shows the people in the space as a column of faces', () => {
    const { popup, popupBody } = openWindow();
    const { bridge } = renderPopup({ popup });
    enterVoice(bridge);

    expect(popupBody.getByTestId('popup-tiles')).toHaveAttribute('data-mode', 'column');
    expect(tileNames(popupBody)).toEqual(['Yo', 'Ana', 'Beto']);
  });

  it('puts whoever speaks first', () => {
    const { popup, popupBody } = openWindow();
    const { bridge } = renderPopup({ popup, speakers: new Set(['beto']) });
    enterVoice(bridge);

    expect(tileNames(popupBody)).toEqual(['Beto', 'Yo', 'Ana']);
  });

  it('shows the camera of whoever has one, and the own one on the own face', () => {
    const { popup, body } = openWindow();
    const { bridge } = renderPopup({
      popup,
      videoTracks: new Map([['ana', fakeVideoTrack()]]),
      localVideoTrack: fakeVideoTrack(),
    });
    enterVoice(bridge);

    expect(body.querySelectorAll('video')).toHaveLength(2);
  });

  it('shows the avatar of someone without a camera, as the tiles do', () => {
    const { popup, popupBody } = openWindow();
    const { bridge } = renderPopup({ popup });
    enterVoice(bridge);
    act(() => bridge.emit('portraits', { byKey: { [avatarKeyFor('ana')]: 'data:image/png;base64,AAAA' } }));

    expect(popupBody.getByAltText('Retrato de ana')).toHaveAttribute('src', 'data:image/png;base64,AAAA');
  });
});

describe('CallPopup: the height follows the people (1)', () => {
  it('asks the window for the size of its content, with the pill in the installed app', () => {
    const { popup } = openWindow('pip');
    const { bridge } = renderPopup({ popup });
    enterVoice(bridge, 1);

    expect(popup.setSize).toHaveBeenLastCalledWith(
      desiredPopupSize({
        width: 200,
        people: [{ sessionId: 'yo', speaking: false }, { sessionId: 'ana', speaking: false }],
        hasShare: false,
        hasPill: true,
        focusedId: null,
      }),
    );
  });

  it('asks for a taller window with every extra person', () => {
    const { popup } = openWindow();
    const { bridge } = renderPopup({ popup });
    enterVoice(bridge, 1);
    const two = vi.mocked(popup.setSize).mock.lastCall![0].height;

    enterVoice(bridge, 2);
    const three = vi.mocked(popup.setSize).mock.lastCall![0].height;

    expect(three).toBeGreaterThan(two);
  });

  it('asks for less in the plain popup, which has no pill', () => {
    const pip = openWindow('pip');
    const plain = openWindow('popup');
    const first = renderPopup({ popup: pip.popup });
    enterVoice(first.bridge, 1);
    const second = renderPopup({ popup: plain.popup });
    enterVoice(second.bridge, 1);

    expect(vi.mocked(pip.popup.setSize).mock.lastCall![0].height - vi.mocked(plain.popup.setSize).mock.lastCall![0].height).toBe(
      PILL_HEIGHT + CHROME_GAP,
    );
  });

  it('asks before it is open too, so the window opens at the right size', () => {
    const popup = control();
    const { bridge } = renderPopup({ popup });
    enterVoice(bridge, 3);

    expect(popup.setSize).toHaveBeenLastCalledWith(expect.objectContaining({ height: expect.any(Number) }));
  });

  it('shows at most five cameras and counts the rest', () => {
    const { popup, popupBody } = openWindow();
    const { bridge } = renderPopup({ popup });
    enterVoice(bridge, 7);

    expect(tileNames(popupBody)).toHaveLength(5);
    expect(popupBody.getByText('+3 personas')).toBeInTheDocument();
  });

  it('says "+1 persona" for a single one', () => {
    const { popup, popupBody } = openWindow();
    const { bridge } = renderPopup({ popup });
    enterVoice(bridge, 5);

    expect(popupBody.getByText('+1 persona')).toBeInTheDocument();
  });

  it('keeps the speakers among the five', () => {
    const { popup, popupBody } = openWindow();
    const { bridge } = renderPopup({ popup, speakers: new Set(['hugo', 'gus']) });
    enterVoice(bridge, 8);

    expect(tileNames(popupBody).slice(0, 2)).toEqual(['Gus', 'Hugo']);
  });
});

describe('CallPopup: the width of the window (2, 5)', () => {
  it('sizes the tiles from the window width, and follows it when the window is resized', () => {
    const { popup, popupBody, resizeTo } = openWindow('pip', { width: 200, height: 0 });
    const { bridge } = renderPopup({ popup });
    enterVoice(bridge);
    const tile = () => popupBody.getAllByTestId('popup-tile')[0];
    expect(tile()).toHaveStyle({ width: `${200 - 2 * POPUP_PADDING}px` });

    resizeTo(300);

    expect(tile()).toHaveStyle({ width: `${300 - 2 * POPUP_PADDING}px` });
    expect(tile()).toHaveStyle({ height: `${tileHeightFor(300 - 2 * POPUP_PADDING)}px` });
  });

  it('stops growing at the maximum tile width', () => {
    const { popup, popupBody, resizeTo } = openWindow('pip', { width: 200, height: 0 });
    const { bridge } = renderPopup({ popup });
    enterVoice(bridge);

    resizeTo(3000);

    expect(popupBody.getAllByTestId('popup-tile')[0]).toHaveStyle({ width: `${MAX_TILE_WIDTH}px` });
  });

  it('lays four cameras out as a 2x2 grid from the width threshold', () => {
    const { popup, popupBody, resizeTo } = openWindow('pip', { width: 200, height: 0 });
    const { bridge } = renderPopup({ popup });
    enterVoice(bridge, 3);
    expect(popupBody.getByTestId('popup-tiles')).toHaveAttribute('data-mode', 'column');

    resizeTo(GRID_MIN_WIDTH);

    expect(popupBody.getByTestId('popup-tiles')).toHaveAttribute('data-mode', 'grid');
    expect(popupBody.getByTestId('popup-tiles')).toHaveStyle('--columns: 2');
  });

  it('shrinks the tiles when the window is too short, instead of clipping them', () => {
    const { popup, popupBody, resizeTo } = openWindow('pip', { width: 200, height: 2000 });
    const { bridge } = renderPopup({ popup });
    enterVoice(bridge, 4);
    const natural = popupBody.getAllByTestId('popup-tile')[0].style.width;

    resizeTo(200, 300);

    expect(parseInt(popupBody.getAllByTestId('popup-tile')[0].style.width, 10)).toBeLessThan(parseInt(natural, 10));
  });

  it('retries a refused resize on a pointer down inside the window', () => {
    const { popup, popupBody } = openWindow();
    renderPopup({ popup });

    fireEvent.pointerDown(popupBody.getByRole('button', { name: 'Micrófono' }));

    expect(popup.applySize).toHaveBeenCalled();
  });
});

describe('CallPopup: the shared screen takes the foreground (3)', () => {
  const shareProps = () => ({ activeScreenSharer: 'ana', screenShareTracks: new Map([['ana', fakeVideoTrack()]]) });

  it('puts the screen big, and the faces on the left', () => {
    const { popup, popupBody } = openWindow('pip', { width: STAGE_SIDE_MIN_WIDTH, height: 0 });
    const { bridge } = renderPopup({ popup, ...shareProps() });
    enterVoice(bridge);

    const tiles = popupBody.getByTestId('popup-tiles');
    expect(tiles).toHaveAttribute('data-mode', 'stage');
    expect(tiles).toHaveAttribute('data-placement', 'left');
    const foreground = popupBody.getByTestId('popup-foreground');
    expect(within(foreground).getByText('Pantalla de Ana')).toBeInTheDocument();
    expect(foreground.querySelector('video')).not.toBeNull();
    expect(within(popupBody.getByTestId('popup-strip')).getAllByTestId('tile-name').map((name) => name.textContent)).toEqual(['Yo', 'Ana', 'Beto']);
  });

  it('shows the own share as "Tu pantalla"', () => {
    const { popup, popupBody } = openWindow();
    const { bridge } = renderPopup({ popup, activeScreenSharer: 'yo', localScreenShareTrack: fakeVideoTrack() });
    enterVoice(bridge);

    expect(within(popupBody.getByTestId('popup-foreground')).getByText('Tu pantalla')).toBeInTheDocument();
  });

  it('has no stage when nobody shares, or the share has not arrived yet', () => {
    const { popup, popupBody } = openWindow();
    const view = renderPopup({ popup });
    enterVoice(view.bridge);
    expect(popupBody.queryByTestId('popup-foreground')).toBeNull();

    view.rerenderWith({ activeScreenSharer: 'ana' });

    expect(popupBody.queryByTestId('popup-foreground')).toBeNull();
  });

  it('counts the screen as one of five tiles: four cameras and the screen', () => {
    const { popup, popupBody } = openWindow();
    const { bridge } = renderPopup({ popup, ...shareProps() });
    enterVoice(bridge, 6);

    const strip = within(popupBody.getByTestId('popup-strip'));
    expect(strip.getAllByTestId('tile-name')).toHaveLength(4);
    expect(popupBody.getByText('+3 personas')).toBeInTheDocument();
  });

  it('puts the cameras under the screen when the window is too narrow for a column', () => {
    const { popup, popupBody } = openWindow('pip', { width: STAGE_SIDE_MIN_WIDTH - 1, height: 0 });
    const { bridge } = renderPopup({ popup, ...shareProps() });
    enterVoice(bridge);

    expect(popupBody.getByTestId('popup-tiles')).toHaveAttribute('data-placement', 'below');
  });

  it('asks for a wider window, since a stage needs the room', () => {
    const popup = control();
    const { bridge } = renderPopup({ popup, ...shareProps() });
    enterVoice(bridge);

    expect(vi.mocked(popup.setSize).mock.lastCall![0].width).toBeGreaterThan(300);
  });
});

describe('CallPopup: a clicked face takes the foreground (3)', () => {
  const shareProps = () => ({ activeScreenSharer: 'ana', screenShareTracks: new Map([['ana', fakeVideoTrack()]]) });
  const wide = { width: 600, height: 0 };

  it('brings the clicked person to the foreground and the rest to the left', () => {
    const { popup, popupBody } = openWindow('pip', wide);
    const { bridge } = renderPopup({ popup });
    enterVoice(bridge);

    fireEvent.click(popupBody.getByRole('button', { name: 'Poner a Ana en primer plano' }));

    expect(popupBody.getByTestId('popup-tiles')).toHaveAttribute('data-mode', 'stage');
    expect(within(popupBody.getByTestId('popup-foreground')).getByText('Ana')).toBeInTheDocument();
    expect(within(popupBody.getByTestId('popup-strip')).getAllByTestId('tile-name').map((name) => name.textContent)).toEqual(['Yo', 'Beto']);
  });

  it('goes back to the default layout when the foregrounded face is clicked again', () => {
    const { popup, popupBody } = openWindow('pip', wide);
    const { bridge } = renderPopup({ popup });
    enterVoice(bridge);
    fireEvent.click(popupBody.getByRole('button', { name: 'Poner a Ana en primer plano' }));

    fireEvent.click(popupBody.getByRole('button', { name: 'Quitar a Ana del primer plano' }));

    expect(popupBody.getByTestId('popup-tiles')).not.toHaveAttribute('data-mode', 'stage');
    expect(popupBody.queryByTestId('popup-foreground')).toBeNull();
  });

  it('foregrounds the face instead of the screen during a share, and the screen goes to the left', () => {
    const { popup, popupBody } = openWindow('pip', wide);
    const { bridge } = renderPopup({ popup, ...shareProps() });
    enterVoice(bridge);

    fireEvent.click(popupBody.getByRole('button', { name: 'Poner a Beto en primer plano' }));

    expect(within(popupBody.getByTestId('popup-foreground')).getByText('Beto')).toBeInTheDocument();
    expect(within(popupBody.getByTestId('popup-strip')).getByText('Pantalla de Ana')).toBeInTheDocument();
  });

  it('brings the screen back when its thumbnail is clicked', () => {
    const { popup, popupBody } = openWindow('pip', wide);
    const { bridge } = renderPopup({ popup, ...shareProps() });
    enterVoice(bridge);
    fireEvent.click(popupBody.getByRole('button', { name: 'Poner a Beto en primer plano' }));

    fireEvent.click(popupBody.getByRole('button', { name: 'Poner la pantalla compartida en primer plano' }));

    expect(within(popupBody.getByTestId('popup-foreground')).getByText('Pantalla de Ana')).toBeInTheDocument();
  });

  it('drops the focus when that person leaves, and does not bring it back if they return', () => {
    const { popup, popupBody } = openWindow('pip', wide);
    const { bridge } = renderPopup({ popup });
    enterVoice(bridge);
    fireEvent.click(popupBody.getByRole('button', { name: 'Poner a Ana en primer plano' }));

    enterVoice(bridge, 1);
    act(() =>
      bridge.emit('voice', { selfSessionId: 'yo', selfName: 'Yo', peers: [{ sessionId: 'beto', name: 'Beto' }], spaceId: 'sala' }),
    );
    expect(popupBody.queryByTestId('popup-foreground')).toBeNull();

    enterVoice(bridge, 2);
    expect(popupBody.queryByTestId('popup-foreground')).toBeNull();
  });

  it('is local to the popup: it asks nothing of the tab', () => {
    const { popup, popupBody } = openWindow('pip', wide);
    const { bridge } = renderPopup({ popup });
    const emitCommand = vi.spyOn(bridge, 'emitCommand');
    enterVoice(bridge);

    fireEvent.click(popupBody.getByRole('button', { name: 'Poner a Ana en primer plano' }));

    expect(emitCommand).not.toHaveBeenCalled();
  });
});

describe('CallPopup: the controls', () => {
  it('has the mic, the camera and the screen share, and nothing to hang up', () => {
    const { popup, popupBody } = openWindow();
    renderPopup({ popup });

    expect(toolbar(popupBody).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      'Micrófono',
      'Cámara',
      'Compartir pantalla',
    ]);
    expect(popupBody.queryByRole('button', { name: /Colgar/ })).toBeNull();
  });

  it('shows the mic, camera and share state it is given, the same as the bottom bar does', () => {
    const { popup, popupBody } = openWindow();
    const view = renderPopup({ popup, micOn: true, camOn: false, screenShareOn: false });

    expect(popupBody.getByRole('button', { name: 'Micrófono' })).toHaveAttribute('aria-pressed', 'true');
    expect(popupBody.getByRole('button', { name: 'Cámara' })).toHaveAttribute('aria-pressed', 'false');
    expect(popupBody.getByRole('button', { name: 'Compartir pantalla' })).toHaveAttribute('aria-pressed', 'false');

    view.rerenderWith({ micOn: false, camOn: true, screenShareOn: true });

    expect(popupBody.getByRole('button', { name: 'Micrófono' })).toHaveAttribute('aria-pressed', 'false');
    expect(popupBody.getByRole('button', { name: 'Cámara' })).toHaveAttribute('aria-pressed', 'true');
    expect(popupBody.getByRole('button', { name: 'Compartir pantalla' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('toggles each through its own callback', () => {
    const { popup, popupBody } = openWindow();
    const { onToggleMic, onToggleCam, onToggleScreenShare } = renderPopup({ popup });

    fireEvent.click(popupBody.getByRole('button', { name: 'Micrófono' }));
    expect([onToggleMic, onToggleCam, onToggleScreenShare].map((fn) => vi.mocked(fn).mock.calls.length)).toEqual([1, 0, 0]);

    fireEvent.click(popupBody.getByRole('button', { name: 'Cámara' }));
    fireEvent.click(popupBody.getByRole('button', { name: 'Compartir pantalla' }));
    expect([onToggleMic, onToggleCam, onToggleScreenShare].map((fn) => vi.mocked(fn).mock.calls.length)).toEqual([1, 1, 1]);
  });

  it('disables all three where the bottom bar disables mic and camera', () => {
    const { popup, popupBody } = openWindow();
    renderPopup({ popup, controlsDisabled: true });

    for (const button of toolbar(popupBody).getAllByRole('button')) expect(button).toBeDisabled();
  });

  it('disables only the share where it is not available (not in a space)', () => {
    const { popup, popupBody } = openWindow();
    renderPopup({ popup, screenShareAvailable: false });

    expect(popupBody.getByRole('button', { name: 'Compartir pantalla' })).toBeDisabled();
    expect(popupBody.getByRole('button', { name: 'Micrófono' })).toBeEnabled();
  });

  it('keeps the controls and the pill after the tiles, pinned at the bottom of the window', () => {
    const { popup, popupBody } = openWindow('pip');
    const { bridge } = renderPopup({ popup });
    enterVoice(bridge);

    const tiles = popupBody.getByTestId('popup-tiles');
    const pill = popupBody.getByTestId('popup-status-pill');
    expect(tiles.compareDocumentPosition(pill)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(pill.compareDocumentPosition(popupBody.getByRole('toolbar', { name: 'Controles de llamada' }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});

describe('CallPopup: the two variants', () => {
  it('pip (the installed app) shows the place in a status pill above the controls', () => {
    const { popup, popupBody } = openWindow('pip');
    renderPopup({ popup, placeLabel: 'Sala de Juntas' });

    expect(popupBody.getByTestId('popup-status-pill')).toHaveTextContent('Sala de Juntas');
  });

  it('pip without a place name shows no pill', () => {
    const { popup, popupBody } = openWindow('pip');
    renderPopup({ popup, placeLabel: null });

    expect(popupBody.queryByTestId('popup-status-pill')).toBeNull();
  });

  it('popup (plain window) has the same faces and controls but no pill', () => {
    const { popup, popupBody } = openWindow('popup');
    const { bridge } = renderPopup({ popup, placeLabel: 'Sala de Juntas' });
    enterVoice(bridge);

    expect(popupBody.queryByTestId('popup-status-pill')).toBeNull();
    expect(popupBody.getAllByTestId('tile-name')).toHaveLength(3);
    expect(toolbar(popupBody).getAllByRole('button')).toHaveLength(3);
  });
});
