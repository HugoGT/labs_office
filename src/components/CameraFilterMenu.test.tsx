import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CameraFilterMenu } from './CameraFilterMenu';

function renderMenu(overrides: Partial<ComponentProps<typeof CameraFilterMenu>> = {}) {
  const props = {
    filter: 'none' as const,
    blurAvailable: true,
    disabled: false,
    onChange: vi.fn(),
    ...overrides,
  };
  render(
    <>
      <CameraFilterMenu {...props} />
      <button type="button">fuera</button>
    </>,
  );
  return { ...props, caret: screen.getByRole('button', { name: 'Opciones de cámara' }) };
}

const items = () => screen.getAllByRole('menuitemradio');

describe('CameraFilterMenu', () => {
  it('is a caret that announces a closed menu', () => {
    const { caret } = renderMenu();

    expect(caret).toHaveAttribute('aria-haspopup', 'menu');
    expect(caret).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens exactly two options, no filter first, the active one checked and focused', async () => {
    const { caret } = renderMenu({ filter: 'blur' });

    await userEvent.click(caret);

    expect(caret).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: 'Filtro de cámara' })).toBeInTheDocument();
    expect(items().map((item) => item.textContent)).toEqual(['Sin filtro', 'Desenfoque']);
    expect(items().map((item) => item.getAttribute('aria-checked'))).toEqual(['false', 'true']);
    expect(screen.getByRole('menuitemradio', { name: 'Desenfoque' })).toHaveFocus();
  });

  it('picking an option reports it, closes and gives focus back to the caret', async () => {
    const { caret, onChange } = renderMenu();
    await userEvent.click(caret);

    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Desenfoque' }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith('blur');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(caret).toHaveFocus();
  });

  it('picking the active option only closes', async () => {
    const { caret, onChange } = renderMenu({ filter: 'blur' });
    await userEvent.click(caret);

    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Desenfoque' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('Escape closes without picking and gives focus back to the caret', async () => {
    const { caret, onChange } = renderMenu();
    await userEvent.click(caret);

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(caret).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a click outside closes without picking', async () => {
    const { caret, onChange } = renderMenu();
    await userEvent.click(caret);

    await userEvent.click(screen.getByRole('button', { name: 'fuera' }));

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('the caret closes what it opened', async () => {
    const { caret } = renderMenu();
    await userEvent.click(caret);

    await userEvent.click(caret);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(caret).toHaveAttribute('aria-expanded', 'false');
  });

  it('arrow keys move between the options', async () => {
    const { caret } = renderMenu();
    await userEvent.click(caret);
    const [none, blur] = items();
    expect(none).toHaveFocus();

    await userEvent.keyboard('{ArrowDown}');
    expect(blur).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(none).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(blur).toHaveFocus();
  });

  it('without blur support the option is there but disabled, and says why', async () => {
    const { caret, onChange } = renderMenu({ blurAvailable: false });
    await userEvent.click(caret);
    const blur = screen.getByRole('menuitemradio', { name: 'Desenfoque' });

    expect(blur).toBeDisabled();
    expect(blur).toHaveAttribute('title', 'Este navegador no puede desenfocar el fondo');

    await userEvent.click(blur);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('follows the camera button when it is disabled, title included', () => {
    const { caret } = renderMenu({ disabled: true, disabledTitle: 'Sin LiveKit' });

    expect(caret).toBeDisabled();
    expect(caret).toHaveAttribute('title', 'Sin LiveKit');
  });

  it('closes when the camera stops being usable while it is open', async () => {
    const props = { filter: 'none' as const, blurAvailable: true, onChange: vi.fn() };
    const { rerender } = render(<CameraFilterMenu {...props} disabled={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'Opciones de cámara' }));

    rerender(<CameraFilterMenu {...props} disabled />);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
