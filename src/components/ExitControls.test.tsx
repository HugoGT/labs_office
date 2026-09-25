import { render, screen } from '@testing-library/react';
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
});
