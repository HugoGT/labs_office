import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MULTIPLE_HINT, MULTIPLE_LABEL, MultipleToggle } from './MultipleToggle';

describe('MultipleToggle (#207)', () => {
  it('says what it does: «Múltiple» keeps placing after each click', () => {
    expect(MULTIPLE_LABEL).toBe('Múltiple: seguir colocando después de cada clic');
    expect(MULTIPLE_HINT).toBe('Termina con Escape.');
  });

  it('is a checkbox named after what it does, described by how to end it, that reports the new value', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<MultipleToggle checked={false} onChange={onChange} />);
    const box = screen.getByRole('checkbox', { name: MULTIPLE_LABEL });
    expect(box).not.toBeChecked();
    expect(box).toHaveAccessibleDescription(MULTIPLE_HINT);
    expect(screen.getByText(MULTIPLE_HINT)).toBeVisible();

    await userEvent.click(box);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(true);

    rerender(<MultipleToggle checked onChange={onChange} />);
    expect(screen.getByRole('checkbox', { name: MULTIPLE_LABEL })).toBeChecked();
    await userEvent.click(screen.getByRole('checkbox', { name: MULTIPLE_LABEL }));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('can be disabled', () => {
    render(<MultipleToggle checked={false} onChange={() => undefined} disabled />);
    expect(screen.getByRole('checkbox', { name: MULTIPLE_LABEL })).toBeDisabled();
  });
});
