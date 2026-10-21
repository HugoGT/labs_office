import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MultipleToggle } from './MultipleToggle';

describe('MultipleToggle (#207)', () => {
  it('is a checkbox named «Múltiple» that reports the new value', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<MultipleToggle checked={false} onChange={onChange} />);
    const box = screen.getByRole('checkbox', { name: 'Múltiple' });
    expect(box).not.toBeChecked();

    await userEvent.click(box);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(true);

    rerender(<MultipleToggle checked onChange={onChange} />);
    expect(screen.getByRole('checkbox', { name: 'Múltiple' })).toBeChecked();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Múltiple' }));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('can be disabled', () => {
    render(<MultipleToggle checked={false} onChange={() => undefined} disabled />);
    expect(screen.getByRole('checkbox', { name: 'Múltiple' })).toBeDisabled();
  });
});
