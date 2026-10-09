import { fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ExitControls } from './ExitControls';

describe('ExitControls (#66)', () => {
  it('offers signing out on the left and leaving the office on the right', () => {
    render(<ExitControls onSignOut={vi.fn()} onLeaveOffice={vi.fn()} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual([
      expect.stringContaining('Cerrar sesión'),
      expect.stringContaining('Salir'),
    ]);
  });

  it('leaving is just "Salir" (#88)', () => {
    render(<ExitControls onSignOut={vi.fn()} onLeaveOffice={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Salir' })).toHaveTextContent(/^🚪\s*Salir$/);
  });

  it('the name lives in aria-label and title too, so it survives narrow screens showing only the emoji (#88)', () => {
    render(<ExitControls onSignOut={vi.fn()} onLeaveOffice={vi.fn()} />);

    for (const name of ['Cerrar sesión', 'Salir']) {
      const button = screen.getByRole('button', { name });
      expect(button).toHaveAttribute('aria-label', name);
      expect(button).toHaveAttribute('title', name);
    }
  });

  it('each button only asks through its own callback', async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn();
    const onLeaveOffice = vi.fn();
    render(<ExitControls onSignOut={onSignOut} onLeaveOffice={onLeaveOffice} />);

    await user.click(screen.getByRole('button', { name: /Cerrar sesión/ }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(onLeaveOffice).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Salir' }));
    expect(onLeaveOffice).toHaveBeenCalledTimes(1);
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('without a session there is nothing to sign out of, so that button is absent', () => {
    render(<ExitControls onSignOut={null} onLeaveOffice={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /Cerrar sesión/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salir' })).toBeInTheDocument();
  });

  it('with neither action it renders nothing', () => {
    const { container } = render(<ExitControls onSignOut={null} onLeaveOffice={null} />);

    expect(container).toBeEmptyDOMElement();
  });

  describe('install button (#13)', () => {
    it('without an install offer the row keeps its two buttons', () => {
      render(<ExitControls onSignOut={vi.fn()} onLeaveOffice={vi.fn()} install={null} />);

      expect(screen.queryByRole('button', { name: 'Instalar app' })).not.toBeInTheDocument();
      expect(screen.getAllByRole('button')).toHaveLength(2);
    });

    it('is the leftmost button of the row, named like the others', () => {
      render(<ExitControls onSignOut={vi.fn()} onLeaveOffice={vi.fn()} install={{ kind: 'prompt', onInstall: vi.fn() }} />);

      const buttons = screen.getAllByRole('button');
      expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['Instalar app', 'Cerrar sesión', 'Salir']);
      expect(buttons[0]).toHaveAttribute('title', 'Instalar app');
      expect(buttons[0]).toHaveTextContent(/^📲\s*Instalar app$/);
    });

    it('with the browser prompt available, a click asks for it', async () => {
      const user = userEvent.setup();
      const onInstall = vi.fn();
      render(<ExitControls onSignOut={null} onLeaveOffice={null} install={{ kind: 'prompt', onInstall }} />);

      await user.click(screen.getByRole('button', { name: 'Instalar app' }));

      expect(onInstall).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it.each([
      ['ios', ['Compartir', 'Añadir a pantalla de inicio']],
      ['macos', ['Archivo', 'Añadir al Dock']],
    ] as const)('on %s a click opens the manual steps', async (kind, steps) => {
      const user = userEvent.setup();
      render(<ExitControls onSignOut={vi.fn()} onLeaveOffice={vi.fn()} install={{ kind }} />);
      const button = screen.getByRole('button', { name: 'Instalar app' });
      expect(button).toHaveAttribute('aria-expanded', 'false');

      await user.click(button);

      const panel = screen.getByRole('dialog', { name: 'Instalar Labs' });
      for (const step of steps) expect(panel).toHaveTextContent(step);
      expect(button).toHaveAttribute('aria-expanded', 'true');
      expect(button).toHaveAttribute('aria-controls', panel.id);
    });

    it('the steps close on Escape and give focus back to the button', async () => {
      const user = userEvent.setup();
      render(<ExitControls onSignOut={vi.fn()} onLeaveOffice={vi.fn()} install={{ kind: 'ios' }} />);
      const button = screen.getByRole('button', { name: 'Instalar app' });
      await user.click(button);

      await user.keyboard('{Escape}');

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(button).toHaveFocus();
      expect(button).toHaveAttribute('aria-expanded', 'false');
    });

    it('the steps close on a click outside them, but not on a click inside', async () => {
      const user = userEvent.setup();
      render(
        <>
          <p>fuera</p>
          <ExitControls onSignOut={vi.fn()} onLeaveOffice={vi.fn()} install={{ kind: 'ios' }} />
        </>,
      );
      await user.click(screen.getByRole('button', { name: 'Instalar app' }));

      await user.click(screen.getByRole('dialog'));
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      fireEvent.pointerDown(screen.getByText('fuera'));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('a second click on the button closes the steps', async () => {
      const user = userEvent.setup();
      render(<ExitControls onSignOut={vi.fn()} onLeaveOffice={vi.fn()} install={{ kind: 'macos' }} />);
      const button = screen.getByRole('button', { name: 'Instalar app' });

      await user.click(button);
      await user.click(button);

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('shows on its own when there is no other way out', () => {
      render(<ExitControls onSignOut={null} onLeaveOffice={null} install={{ kind: 'ios' }} />);

      expect(screen.getByRole('button', { name: 'Instalar app' })).toBeInTheDocument();
    });

    it('tells the layout a third button needs room, and takes it back when it goes', () => {
      const root = document.documentElement;
      const { rerender, unmount } = render(
        <ExitControls onSignOut={vi.fn()} onLeaveOffice={vi.fn()} install={{ kind: 'ios' }} />,
      );
      expect(root.style.getPropertyValue('--hud-exit-buttons')).toBe('3');

      rerender(<ExitControls onSignOut={vi.fn()} onLeaveOffice={vi.fn()} install={null} />);
      expect(root.style.getPropertyValue('--hud-exit-buttons')).toBe('');

      rerender(<ExitControls onSignOut={vi.fn()} onLeaveOffice={vi.fn()} install={{ kind: 'ios' }} />);
      unmount();
      expect(root.style.getPropertyValue('--hud-exit-buttons')).toBe('');
    });
  });
});
