import { fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Swatch } from '../art/customCharacter';
import { ColorPicker } from './ColorPicker';

const PRESETS: readonly Swatch[] = [
  { hex: '#201816', label: 'Negro' },
  { hex: '#efd395', label: 'Rubio' },
];

function renderPicker(value = '#201816') {
  const onChange = vi.fn();
  const onOuterKey = vi.fn();
  render(
    <div onKeyDown={onOuterKey}>
      <ColorPicker label="Color de pelo" caption="Color" presets={PRESETS} value={value} onChange={onChange} />
      <button type="button">fuera</button>
    </div>,
  );
  return { onChange, onOuterKey, trigger: screen.getByRole('button', { name: /^Color de pelo:/ }) };
}

describe('ColorPicker', () => {
  it('is a swatch button showing the current color, named after its preset', () => {
    const { trigger } = renderPicker();

    expect(trigger).toHaveAccessibleName('Color de pelo: Negro');
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger.querySelector('[data-swatch]')).toHaveStyle({ backgroundColor: '#201816' });
    expect(screen.getByText('Color')).toBeInTheDocument();
  });

  it('names a free color by its hex', () => {
    const { trigger } = renderPicker('#12ab34');

    expect(trigger).toHaveAccessibleName('Color de pelo: #12ab34');
  });

  it('opens the presets as quick picks, the current one pressed', async () => {
    const user = userEvent.setup();
    const { trigger, onChange } = renderPicker();

    await user.click(trigger);

    expect(screen.getByRole('dialog', { name: 'Color de pelo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Negro' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Rubio' }));

    expect(onChange).toHaveBeenCalledWith('#efd395');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('takes any color from the free picker and stays open while it is dragged', async () => {
    const user = userEvent.setup();
    const { trigger, onChange } = renderPicker();

    await user.click(trigger);
    const input = screen.getByLabelText('Otro color');
    expect(input).toHaveAttribute('type', 'color');
    expect(input).toHaveValue('#201816');
    fireEvent.input(input, { target: { value: '#12AB34' } });

    expect(onChange).toHaveBeenCalledWith('#12ab34');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('Escape closes it without reaching what contains it, and a click outside closes it too', async () => {
    const user = userEvent.setup();
    const { trigger, onOuterKey } = renderPicker();

    await user.click(trigger);
    onOuterKey.mockClear();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(onOuterKey).not.toHaveBeenCalled();

    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'fuera' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
