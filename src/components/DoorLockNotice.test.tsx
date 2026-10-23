import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DoorLockNotice } from './DoorLockNotice';

describe('DoorLockNotice (#223, S15)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const HINT = 'Pulsa X para bloquear la sala';
  const UNLOCK = 'Pulsa X para desbloquear la sala';
  const LOCKED = 'Sala bloqueada';

  it('hints the lock key for ten seconds from coming into range, then hides even while staying', () => {
    const { rerender } = render(<DoorLockNotice lockable={null} insideLocked={false} />);
    expect(screen.queryByText(HINT)).toBeNull();

    rerender(<DoorLockNotice lockable="lock" insideLocked={false} />);
    expect(screen.getByText(HINT)).toBeTruthy();

    act(() => void vi.advanceTimersByTime(9_999));
    expect(screen.getByText(HINT)).toBeTruthy();
    act(() => void vi.advanceTimersByTime(1));
    expect(screen.queryByText(HINT)).toBeNull();

    // Staying put keeps it hidden.
    rerender(<DoorLockNotice lockable="lock" insideLocked={false} />);
    act(() => void vi.advanceTimersByTime(60_000));
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it('shows the hint again, for another ten seconds, after leaving the range and coming back', () => {
    const { rerender } = render(<DoorLockNotice lockable="lock" insideLocked={false} />);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(screen.queryByText(HINT)).toBeNull();

    rerender(<DoorLockNotice lockable={null} insideLocked={false} />);
    rerender(<DoorLockNotice lockable="lock" insideLocked={false} />);
    expect(screen.getByText(HINT)).toBeTruthy();
    act(() => void vi.advanceTimersByTime(9_999));
    expect(screen.getByText(HINT)).toBeTruthy();
    act(() => void vi.advanceTimersByTime(1));
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it('offers to unlock when the room is already locked, and the text flips without restarting the ten seconds', () => {
    const { rerender } = render(<DoorLockNotice lockable="lock" insideLocked={false} />);
    act(() => void vi.advanceTimersByTime(4_000));
    rerender(<DoorLockNotice lockable="unlock" insideLocked />);
    expect(screen.getByText(UNLOCK)).toBeTruthy();
    expect(screen.queryByText(HINT)).toBeNull();
    act(() => void vi.advanceTimersByTime(6_000));
    expect(screen.queryByText(UNLOCK)).toBeNull();
  });

  it('shows «Sala bloqueada» for as long as the player is inside a locked room, with no timer', () => {
    const { rerender } = render(<DoorLockNotice lockable={null} insideLocked />);
    expect(screen.getByText(LOCKED)).toBeTruthy();
    act(() => void vi.advanceTimersByTime(120_000));
    expect(screen.getByText(LOCKED)).toBeTruthy();

    rerender(<DoorLockNotice lockable={null} insideLocked={false} />);
    expect(screen.queryByText(LOCKED)).toBeNull();
  });

  it('stacks both, as non-interactive polite status pills', () => {
    render(<DoorLockNotice lockable="unlock" insideLocked />);
    const pills = screen.getAllByRole('status');
    expect(pills.map((pill) => pill.textContent)).toEqual([UNLOCK, LOCKED]);
    for (const pill of pills) {
      expect(pill.getAttribute('aria-live')).toBe('polite');
      expect(pill.tagName).not.toBe('BUTTON');
    }
  });

  it('renders nothing with nothing to say', () => {
    const { container } = render(<DoorLockNotice lockable={null} insideLocked={false} />);
    expect(container.firstChild).toBeNull();
  });
});
