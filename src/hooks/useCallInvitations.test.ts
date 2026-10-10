import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as callChimeModule from '../game/callChime';
import { createOfficeBridge } from '../game/officeBridge';
import { CALL_ALERT_MS, useCallInvitations } from './useCallInvitations';

// The real ring plays an audio file (callChime.test.ts covers it); the whole
// module is mocked to assert when the hook rings and silences it.
vi.mock('../game/callChime', () => ({
  createCallChime: vi.fn(),
}));

describe('useCallInvitations', () => {
  let play: ReturnType<typeof vi.fn<() => void>>;
  let stop: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    play = vi.fn<() => void>();
    stop = vi.fn<() => void>();
    vi.mocked(callChimeModule.createCallChime).mockClear();
    vi.mocked(callChimeModule.createCallChime).mockReturnValue({ play, stop });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('empieza sin invitaciones', () => {
    const bridge = createOfficeBridge();
    const { result } = renderHook(() => useCallInvitations(bridge));

    expect(result.current.invitations).toEqual([]);
  });

  it('apila las invitaciones en orden de llegada, la mas nueva al final (decision humana #305.2: sin "ocupado")', () => {
    const bridge = createOfficeBridge();
    const { result } = renderHook(() => useCallInvitations(bridge));

    act(() => {
      bridge.emit('callinvite', { from: 'A', name: 'Ana' });
      bridge.emit('callinvite', { from: 'C', name: 'Carlos' });
    });

    expect(result.current.invitations.map((invite) => invite.from)).toEqual(['A', 'C']);
    expect(result.current.invitations.every((invite) => invite.alerting)).toBe(true);
    expect(result.current.invitations.every((invite) => invite.callerPresent)).toBe(true);
  });

  it('el aviso de 4s se apaga solo, pero la tarjeta sigue flotando (D11, sin caducidad #305.3)', () => {
    vi.useFakeTimers();
    const bridge = createOfficeBridge();
    const { result } = renderHook(() => useCallInvitations(bridge));

    act(() => bridge.emit('callinvite', { from: 'A', name: 'Ana' }));
    expect(result.current.invitations[0].alerting).toBe(true);

    act(() => vi.advanceTimersByTime(CALL_ALERT_MS));

    expect(result.current.invitations).toEqual([
      { from: 'A', name: 'Ana', alerting: false, callerPresent: true },
    ]);
  });

  it('el aviso de una tarjeta no afecta al de otra (temporizadores independientes)', () => {
    vi.useFakeTimers();
    const bridge = createOfficeBridge();
    const { result } = renderHook(() => useCallInvitations(bridge));

    act(() => bridge.emit('callinvite', { from: 'A', name: 'Ana' }));
    act(() => vi.advanceTimersByTime(CALL_ALERT_MS - 1));
    act(() => bridge.emit('callinvite', { from: 'C', name: 'Carlos' }));
    act(() => vi.advanceTimersByTime(1));

    expect(result.current.invitations).toEqual([
      { from: 'A', name: 'Ana', alerting: false, callerPresent: true },
      { from: 'C', name: 'Carlos', alerting: true, callerPresent: true },
    ]);
  });

  it('callerleft convierte la tarjeta en un tombstone sin quitarla (D7, decision humana #305.5)', () => {
    const bridge = createOfficeBridge();
    const { result } = renderHook(() => useCallInvitations(bridge));

    act(() => bridge.emit('callinvite', { from: 'A', name: 'Ana' }));
    act(() => bridge.emit('callerleft', { from: 'A' }));

    expect(result.current.invitations).toEqual([
      { from: 'A', name: 'Ana', alerting: true, callerPresent: false },
    ]);
  });

  it('callerleft de un llamador desconocido no crea ni rompe nada', () => {
    const bridge = createOfficeBridge();
    const { result } = renderHook(() => useCallInvitations(bridge));

    act(() => bridge.emit('callerleft', { from: 'fantasma' }));

    expect(result.current.invitations).toEqual([]);
  });

  it('la campanilla suena al LLEGAR la invitacion, no al responderla (decision humana #305.3)', () => {
    const bridge = createOfficeBridge();
    const { result } = renderHook(() => useCallInvitations(bridge));

    act(() => bridge.emit('callinvite', { from: 'A', name: 'Ana' }));

    // El aviso de 4 s ANUNCIA la llegada: si sonase al responder, avisaria de
    // algo que la persona acaba de hacer ella misma, y la llegada -- lo unico
    // que no puede ver si esta en otra ventana -- pasaria en silencio.
    expect(play).toHaveBeenCalledTimes(1);
    expect(result.current.invitations[0]?.alerting).toBe(true);
  });

  it('cada invitacion que llega trae su propia campanilla', () => {
    const bridge = createOfficeBridge();
    renderHook(() => useCallInvitations(bridge));

    act(() => bridge.emit('callinvite', { from: 'A', name: 'Ana' }));
    act(() => bridge.emit('callinvite', { from: 'B', name: 'Berto' }));

    expect(play).toHaveBeenCalledTimes(2);
  });

  it('builds one chime for the life of the hook, not one per render (#187)', () => {
    const bridge = createOfficeBridge();
    const { rerender } = renderHook(() => useCallInvitations(bridge));

    rerender();
    rerender();

    expect(callChimeModule.createCallChime).toHaveBeenCalledTimes(1);
  });

  it('answering the only ringing invitation silences the ring (#187)', () => {
    const bridge = createOfficeBridge();
    const { result } = renderHook(() => useCallInvitations(bridge));

    act(() => bridge.emit('callinvite', { from: 'A', name: 'Ana' }));
    expect(stop).not.toHaveBeenCalled();
    act(() => result.current.accept('A'));

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('passing on the only ringing invitation silences the ring (#187)', () => {
    const bridge = createOfficeBridge();
    const { result } = renderHook(() => useCallInvitations(bridge));

    act(() => bridge.emit('callinvite', { from: 'A', name: 'Ana' }));
    act(() => result.current.dismiss('A'));

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('answering one invitation keeps ringing for another that is still alerting (#187)', () => {
    const bridge = createOfficeBridge();
    const { result } = renderHook(() => useCallInvitations(bridge));

    act(() => {
      bridge.emit('callinvite', { from: 'A', name: 'Ana' });
      bridge.emit('callinvite', { from: 'C', name: 'Carlos' });
    });
    act(() => result.current.dismiss('A'));
    expect(stop).not.toHaveBeenCalled();

    act(() => result.current.accept('C'));
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('the ring ends with the alert window, while the card keeps floating (#187)', () => {
    vi.useFakeTimers();
    const bridge = createOfficeBridge();
    const { result } = renderHook(() => useCallInvitations(bridge));

    act(() => bridge.emit('callinvite', { from: 'A', name: 'Ana' }));
    act(() => vi.advanceTimersByTime(CALL_ALERT_MS - 1));
    expect(stop).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));

    expect(stop).toHaveBeenCalledTimes(1);
    expect(result.current.invitations).toHaveLength(1);
  });

  it('a caller who leaves stops ringing: there is nobody to go to anymore (#187)', () => {
    const bridge = createOfficeBridge();
    renderHook(() => useCallInvitations(bridge));

    act(() => bridge.emit('callinvite', { from: 'A', name: 'Ana' }));
    act(() => bridge.emit('callerleft', { from: 'A' }));

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('answering a tombstone or a card whose alert already ended does not touch a ring for someone else (#187)', () => {
    vi.useFakeTimers();
    const bridge = createOfficeBridge();
    const { result } = renderHook(() => useCallInvitations(bridge));

    act(() => bridge.emit('callinvite', { from: 'A', name: 'Ana' }));
    act(() => vi.advanceTimersByTime(CALL_ALERT_MS));
    act(() => bridge.emit('callinvite', { from: 'C', name: 'Carlos' }));
    stop.mockClear();

    act(() => result.current.dismiss('A'));

    expect(stop).not.toHaveBeenCalled();
  });

  it('unmounting silences any ring in progress (#187)', () => {
    const bridge = createOfficeBridge();
    const { unmount } = renderHook(() => useCallInvitations(bridge));

    act(() => bridge.emit('callinvite', { from: 'A', name: 'Ana' }));
    unmount();

    expect(stop).toHaveBeenCalled();
  });

  it('accept emite respondCall{accept:true} y quita la tarjeta, sin sonar de nuevo (D3)', () => {
    const bridge = createOfficeBridge();
    const received: unknown[] = [];
    bridge.onCommand('respondCall', (payload) => received.push(payload));
    const { result } = renderHook(() => useCallInvitations(bridge));

    act(() => bridge.emit('callinvite', { from: 'A', name: 'Ana' }));
    act(() => result.current.accept('A'));

    expect(received).toEqual([{ from: 'A', accept: true }]);
    // Una sola vez, la de la llegada: responder no vuelve a sonar.
    expect(play).toHaveBeenCalledTimes(1);
    expect(result.current.invitations).toEqual([]);
  });

  it('dismiss emite respondCall{accept:false} y quita la tarjeta (Pasar no avisa al llamador)', () => {
    const bridge = createOfficeBridge();
    const received: unknown[] = [];
    bridge.onCommand('respondCall', (payload) => received.push(payload));
    const { result } = renderHook(() => useCallInvitations(bridge));

    act(() => bridge.emit('callinvite', { from: 'A', name: 'Ana' }));
    act(() => result.current.dismiss('A'));

    expect(received).toEqual([{ from: 'A', accept: false }]);
    // La unica campanilla es la de la llegada; pasar no anade ninguna.
    expect(play).toHaveBeenCalledTimes(1);
    expect(result.current.invitations).toEqual([]);
  });

  it('dismiss sobre un tombstone tambien emite respondCall (D7: una sola regla, el servidor la vuelve no-op)', () => {
    const bridge = createOfficeBridge();
    const received: unknown[] = [];
    bridge.onCommand('respondCall', (payload) => received.push(payload));
    const { result } = renderHook(() => useCallInvitations(bridge));

    act(() => bridge.emit('callinvite', { from: 'A', name: 'Ana' }));
    act(() => bridge.emit('callerleft', { from: 'A' }));
    act(() => result.current.dismiss('A'));

    expect(received).toEqual([{ from: 'A', accept: false }]);
    expect(result.current.invitations).toEqual([]);
  });

  it('accept/dismiss solo afecta a la tarjeta indicada, el resto de la pila sigue en pie', () => {
    const bridge = createOfficeBridge();
    const { result } = renderHook(() => useCallInvitations(bridge));

    act(() => {
      bridge.emit('callinvite', { from: 'A', name: 'Ana' });
      bridge.emit('callinvite', { from: 'C', name: 'Carlos' });
    });
    act(() => result.current.accept('A'));

    expect(result.current.invitations.map((invite) => invite.from)).toEqual(['C']);
  });

  it('limpia los temporizadores de aviso pendientes al desmontar (sin fugas)', () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const bridge = createOfficeBridge();
    const { unmount } = renderHook(() => useCallInvitations(bridge));

    act(() => bridge.emit('callinvite', { from: 'A', name: 'Ana' }));
    unmount();

    expect(clearSpy).toHaveBeenCalled();
  });

  it('deja de reaccionar a eventos del bridge tras desmontar', () => {
    const bridge = createOfficeBridge();
    const { result, unmount } = renderHook(() => useCallInvitations(bridge));

    unmount();

    act(() => bridge.emit('callinvite', { from: 'A', name: 'Ana' }));

    expect(result.current.invitations).toEqual([]);
  });
});
