import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MULTIPLE_LABEL, MultipleToggle } from './MultipleToggle';

describe('MultipleToggle (#207)', () => {
  it('says what it does in its label and nothing else: «Múltiple» places several at once', () => {
    expect(MULTIPLE_LABEL).toBe('Múltiple: colocar varios items');
  });

  it('is a checkbox named after what it does, with no description, that reports the new value', async () => {
    const onChange = vi.fn();
    const { rerender, container } = render(<MultipleToggle checked={false} onChange={onChange} />);
    const box = screen.getByRole('checkbox', { name: MULTIPLE_LABEL });
    expect(box).not.toBeChecked();
    expect(box).not.toHaveAttribute('aria-describedby');
    expect(container).toHaveTextContent(/^Múltiple: colocar varios items$/);

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
