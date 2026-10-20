import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Option } from '../art/customCharacter';
import type { PixelFrame } from './PixelFramesCanvas';
import { StylePicker } from './StylePicker';

type Hair = 'messy' | 'ponytail' | 'bob';

const OPTIONS: readonly Option<Hair>[] = [
  { value: 'messy', label: 'Despeinado' },
  { value: 'ponytail', label: 'Coleta' },
  { value: 'bob', label: 'Melena corta' },
];

function thumb(): PixelFrame {
  return { width: 4, height: 4, data: new Uint8ClampedArray(64) };
}

function renderPicker(value: Hair = 'ponytail') {
  const onChange = vi.fn();
  const thumbnail = vi.fn(thumb);
  const onOuterKey = vi.fn();
  render(
    <div onKeyDown={onOuterKey}>
      <StylePicker label="Estilo de pelo" caption="Estilo" options={OPTIONS} value={value} thumbnail={thumbnail} onChange={onChange} />
      <button type="button">fuera</button>
    </div>,
  );
  const trigger = screen.getByRole('button', { name: /^Estilo de pelo:/ });
  return { onChange, thumbnail, onOuterKey, trigger };
}

describe('StylePicker', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is a thumbnail button named after the current option, announcing a closed menu', () => {
    const { trigger, thumbnail } = renderPicker();

    expect(trigger).toHaveAccessibleName('Estilo de pelo: Coleta');
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).not.toHaveTextContent('Coleta');
    expect(thumbnail).toHaveBeenCalledWith('ponytail');
    expect(screen.getByText('Estilo')).toBeInTheDocument();
  });

  it('opens one thumbnail item per option, the current one checked and focused', async () => {
    const user = userEvent.setup();
    const { trigger, thumbnail } = renderPicker();

    await user.click(trigger);

    expect(screen.getByRole('menu', { name: 'Estilo de pelo' })).toBeInTheDocument();
    const items = screen.getAllByRole('menuitemradio');
    expect(items.map((item) => item.getAttribute('aria-label'))).toEqual(['Despeinado', 'Coleta', 'Melena corta']);
    expect(screen.getByRole('menuitemradio', { name: 'Coleta' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'Coleta' })).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    for (const option of OPTIONS) expect(thumbnail).toHaveBeenCalledWith(option.value);
  });

  it('a pick changes the value, closes and gives focus back to the button', async () => {
    const user = userEvent.setup();
    const { trigger, onChange } = renderPicker();

    await user.click(trigger);
    await user.click(screen.getByRole('menuitemradio', { name: 'Melena corta' }));

    expect(onChange).toHaveBeenCalledWith('bob');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('arrow keys move between items', async () => {
    const user = userEvent.setup();
    const { trigger } = renderPicker('messy');

    await user.click(trigger);
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('menuitemradio', { name: 'Coleta' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('menuitemradio', { name: 'Melena corta' })).toHaveFocus();
  });

  it('Escape closes it without reaching what contains it, and focus goes back to the button', async () => {
    const user = userEvent.setup();
    const { trigger, onOuterKey, onChange } = renderPicker();

    await user.click(trigger);
    onOuterKey.mockClear();
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(onOuterKey).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a click outside closes it', async () => {
    const user = userEvent.setup();
    const { trigger } = renderPicker();

    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'fuera' }));

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
