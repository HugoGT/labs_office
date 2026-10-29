import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ArtPieceDialog } from './ArtPieceDialog';

describe('ArtPieceDialog (#122)', () => {
  it('is a modal dialog named by its title, with a way to close it', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <ArtPieceDialog title="Lucía" onClose={onClose}>
        <p>contenido</p>
      </ArtPieceDialog>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Lucía' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveTextContent('contenido');
    await user.click(screen.getByRole('button', { name: 'Cerrar' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('takes the focus, and Escape only closes it: no key reaches the office behind', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const office = vi.fn();
    window.addEventListener('keydown', office);
    render(
      <ArtPieceDialog title="Lucía" onClose={onClose}>
        <p>contenido</p>
      </ArtPieceDialog>,
    );

    expect(screen.getByRole('dialog')).toHaveFocus();
    await user.keyboard('{Escape}');
    await user.keyboard('a');

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(office).not.toHaveBeenCalled();
    window.removeEventListener('keydown', office);
  });
});
