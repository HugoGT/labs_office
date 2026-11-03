import { fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Swatch } from '../art/customCharacter';
import { ColorPicker } from './ColorPicker';

const PRESETS: readonly Swatch[] = [
  { hex: '#201816', label: 'Negro' },
  { hex: '#efd395', label: 'Rubio' },
];

function renderPicker(value = '#201816', disabled = false) {
  const onChange = vi.fn();
  render(<ColorPicker label="Color de pelo" caption="Color" presets={PRESETS} value={value} onChange={onChange} disabled={disabled} />);
  return {
    onChange,
    trigger: screen.getByRole('button', { name: /^Color de pelo:/ }),
    input: screen.getByLabelText<HTMLInputElement>('Color de pelo', { selector: 'input' }),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ColorPicker', () => {
  it('is a swatch button showing the current color, named after its preset', () => {
    const { trigger } = renderPicker();

    expect(trigger).toHaveAccessibleName('Color de pelo: Negro');
    expect(trigger).not.toHaveAttribute('aria-haspopup');
    expect(trigger.querySelector('[data-swatch]')).toHaveStyle({ backgroundColor: '#201816' });
    expect(screen.getByText('Color')).toBeInTheDocument();
  });

  it('names a free color by its hex', () => {
    const { trigger } = renderPicker('#12ab34');

    expect(trigger).toHaveAccessibleName('Color de pelo: #12ab34');
  });

  it('opens the full color spectrum straight away, with no preset popover', async () => {
    const user = userEvent.setup();
    const showPicker = vi.fn();
    Object.defineProperty(HTMLInputElement.prototype, 'showPicker', { configurable: true, value: showPicker });
    const { trigger, input } = renderPicker();

    expect(input).toHaveAttribute('type', 'color');
    expect(input).toHaveValue('#201816');
    await user.click(trigger);

    expect(showPicker).toHaveBeenCalledTimes(1);
    expect(showPicker.mock.contexts[0]).toBe(input);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    delete (HTMLInputElement.prototype as Partial<HTMLInputElement>).showPicker;
  });

  it('reports every color the picker is dragged through, in lowercase', () => {
    const { input, onChange } = renderPicker();

    fireEvent.input(input, { target: { value: '#12AB34' } });

    expect(onChange).toHaveBeenCalledWith('#12ab34');
  });

  it('opens nothing while disabled', async () => {
    const user = userEvent.setup();
    const showPicker = vi.fn();
    Object.defineProperty(HTMLInputElement.prototype, 'showPicker', { configurable: true, value: showPicker });
    const { trigger, input } = renderPicker('#201816', true);

    expect(trigger).toBeDisabled();
    expect(input).toBeDisabled();
    await user.click(trigger);

    expect(showPicker).not.toHaveBeenCalled();
    delete (HTMLInputElement.prototype as Partial<HTMLInputElement>).showPicker;
  });
});
