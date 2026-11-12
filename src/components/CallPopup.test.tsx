import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttachableTrack } from '../game/attachableTrack';
import { createOfficeBridge, type OfficeBridge } from '../game/officeBridge';
import { avatarKeyFor } from '../game/remoteAvatars';
import type { CallPopupControl } from '../hooks/useCallPopup';
import { CallPopup } from './CallPopup';

function fakeVideoTrack(): AttachableTrack {
  const elements: HTMLMediaElement[] = [];
  return {
    kind: 'video',
    attach() {
      const element = document.createElement('video');
      elements.push(element);
      return element;
    },
    detach() {
      return elements.splice(0);
    },
  };
}

/** The floating window: a document of its own, with a window, apart from the app's. */
function pipDocument() {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const pipWindow = frame.contentWindow!;
  return { pipWindow, popupBody: within(pipWindow.document.body), body: pipWindow.document.body };
}

afterEach(() => {
  // Unmount first: React takes the popup out of a window that must still be there.
  cleanup();
  document.querySelectorAll('iframe').forEach((frame) => frame.remove());
});

function control(overrides: Partial<CallPopupControl> = {}): CallPopupControl {
  return { popupWindow: null, variant: null, open: vi.fn(async () => undefined), close: vi.fn(), ...overrides };
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

function enterVoice(bridge: OfficeBridge) {
  act(() =>
    bridge.emit('voice', {
      selfSessionId: 'yo',
      selfName: 'Yo',
      peers: [
        { sessionId: 'ana', name: 'Ana' },
        { sessionId: 'beto', name: 'Beto' },
      ],
      spaceId: 'sala',
    }),
  );
}

/** The window of a given variant, with the document to look into. */
function openWindow(variant: 'pip' | 'popup' = 'pip') {
  const { pipWindow, ...rest } = pipDocument();
  return { ...rest, popup: control({ popupWindow: pipWindow, variant }) };
}

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

    expect(popupBody.getAllByTestId('tile-name').map((name) => name.textContent)).toEqual(['Yo', 'Ana', 'Beto']);
  });

  it('puts whoever speaks first', () => {
    const { popup, popupBody } = openWindow();
    const { bridge } = renderPopup({ popup, speakers: new Set(['beto']) });
    enterVoice(bridge);

    expect(popupBody.getAllByTestId('tile-name').map((name) => name.textContent)).toEqual(['Beto', 'Yo', 'Ana']);
  });

  it('shows the camera of whoever has one', () => {
    const { popup, body } = openWindow();
    const { bridge } = renderPopup({ popup, videoTracks: new Map([['ana', fakeVideoTrack()]]) });
    enterVoice(bridge);

    expect(body.querySelectorAll('video')).toHaveLength(1);
  });

  it('shows the own camera on the own face', () => {
    const { popup, body } = openWindow();
    const { bridge } = renderPopup({ popup, localVideoTrack: fakeVideoTrack() });
    enterVoice(bridge);

    expect(body.querySelectorAll('video')).toHaveLength(1);
  });

  it('shows the avatar of someone without a camera, as the tiles do', () => {
    const { popup, popupBody } = openWindow();
    const { bridge } = renderPopup({ popup });
    enterVoice(bridge);
    act(() => bridge.emit('portraits', { byKey: { [avatarKeyFor('ana')]: 'data:image/png;base64,AAAA' } }));

    expect(popupBody.getByAltText('Retrato de ana')).toHaveAttribute('src', 'data:image/png;base64,AAAA');
  });

  it('keeps the speakers and counts the rest when they do not fit', () => {
    const { popup, popupBody } = openWindow();
    const { bridge } = renderPopup({ popup, speakers: new Set(['f', 'e']) });
    act(() =>
      bridge.emit('voice', {
        selfSessionId: 'yo',
        selfName: 'Yo',
        peers: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ sessionId: id, name: id.toUpperCase() })),
        spaceId: 'sala',
      }),
    );

    const names = popupBody.getAllByTestId('tile-name').map((name) => name.textContent);
    expect(names).toHaveLength(3);
    expect(names).toEqual(expect.arrayContaining(['E', 'F']));
    expect(popupBody.getByText('+4 personas')).toBeInTheDocument();
  });
});

describe('CallPopup: the shared screen', () => {
  it('shows a thumbnail of what someone shares, above the faces', () => {
    const { popup, popupBody, body } = openWindow();
    const { bridge } = renderPopup({
      popup,
      activeScreenSharer: 'ana',
      screenShareTracks: new Map([['ana', fakeVideoTrack()]]),
    });
    enterVoice(bridge);

    const thumbnail = popupBody.getByTestId('popup-screen-share');
    expect(within(thumbnail).getByText('Pantalla de Ana')).toBeInTheDocument();
    expect(thumbnail.querySelector('video')).not.toBeNull();
    expect(thumbnail.compareDocumentPosition(popupBody.getByRole('group', { name: 'Personas en la sala' }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(body.querySelectorAll('video')).toHaveLength(1);
  });

  it('shows the own share as "Tu pantalla"', () => {
    const { popup, popupBody } = openWindow();
    const { bridge } = renderPopup({ popup, activeScreenSharer: 'yo', localScreenShareTrack: fakeVideoTrack() });
    enterVoice(bridge);

    expect(within(popupBody.getByTestId('popup-screen-share')).getByText('Tu pantalla')).toBeInTheDocument();
  });

  it('has no thumbnail when nobody shares, or the share has not arrived yet', () => {
    const { popup, popupBody } = openWindow();
    const view = renderPopup({ popup });
    enterVoice(view.bridge);
    expect(popupBody.queryByTestId('popup-screen-share')).toBeNull();

    view.rerenderWith({ activeScreenSharer: 'ana' });

    expect(popupBody.queryByTestId('popup-screen-share')).toBeNull();
  });
});

describe('CallPopup: the controls', () => {
  it('has the mic, the camera and the screen share, and nothing to hang up', () => {
    const { popup, popupBody } = openWindow();
    renderPopup({ popup });

    expect(popupBody.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      'Micrófono',
      'Cámara',
      'Compartir pantalla',
    ]);
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

    for (const button of popupBody.getAllByRole('button')) expect(button).toBeDisabled();
  });

  it('disables only the share where it is not available (not in a space)', () => {
    const { popup, popupBody } = openWindow();
    renderPopup({ popup, screenShareAvailable: false });

    expect(popupBody.getByRole('button', { name: 'Compartir pantalla' })).toBeDisabled();
    expect(popupBody.getByRole('button', { name: 'Micrófono' })).toBeEnabled();
  });
});

describe('CallPopup: the two variants', () => {
  it('pip (the installed app) shows the place in a status pill above the controls', () => {
    const { popup, popupBody } = openWindow('pip');
    renderPopup({ popup, placeLabel: 'Sala de Juntas' });

    const pill = popupBody.getByTestId('popup-status-pill');
    expect(pill).toHaveTextContent('Sala de Juntas');
    expect(pill.compareDocumentPosition(popupBody.getByRole('toolbar', { name: 'Controles de llamada' }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
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
    expect(popupBody.getAllByRole('button')).toHaveLength(3);
  });
});
