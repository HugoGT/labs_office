import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DoorLockNotice } from './DoorLockNotice';

describe('DoorLockNotice (#223, S15, #233)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const LOCK = 'Pulsa X para bloquear la puerta';
  const UNLOCK = 'Pulsa X para desbloquear la puerta';

  it('shows nothing away from the doors', () => {
    const { container } = render(<DoorLockNotice lockable={null} />);
    expect(container.textContent).toBe('');
  });

  it('hints to lock the door next to the player, and keeps hinting for as long as they stay', () => {
    render(<DoorLockNotice lockable="lock" />);
    expect(screen.getByText(LOCK)).toBeTruthy();
    act(() => void vi.advanceTimersByTime(10 * 60_000));
    expect(screen.getByText(LOCK)).toBeTruthy();
  });

  it('offers to unlock a locked door and flips back with the key', () => {
    const { rerender } = render(<DoorLockNotice lockable="unlock" />);
    expect(screen.getByText(UNLOCK)).toBeTruthy();
    expect(screen.queryByText(LOCK)).toBeNull();
    rerender(<DoorLockNotice lockable="lock" />);
    expect(screen.getByText(LOCK)).toBeTruthy();
    expect(screen.queryByText(UNLOCK)).toBeNull();
  });
});
