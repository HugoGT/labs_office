import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ArtPieceDialog, DialogButton } from './ArtPieceDialog';

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

  it('has no bar above the content: the name sits in the bottom left, after it', () => {
    render(
      <ArtPieceDialog title="Lucía" onClose={() => undefined}>
        <p>contenido</p>
      </ArtPieceDialog>,
    );

    const title = screen.getByRole('heading', { name: 'Lucía' });
    expect(screen.getByText('contenido').compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('can carry actions below its content, and then they are the way out: no "Cerrar" beside them', async () => {
    render(
      <ArtPieceDialog title="Lucía" onClose={() => undefined} actions={<DialogButton tone="accept">Aceptar y subir</DialogButton>}>
        <p>contenido</p>
      </ArtPieceDialog>,
    );

    expect(screen.getByRole('dialog')).toContainElement(screen.getByRole('button', { name: 'Aceptar y subir' }));
    expect(screen.queryByRole('button', { name: 'Cerrar' })).not.toBeInTheDocument();
  });

  it('marks its buttons by what they do: accept (blue) and cancel (red)', () => {
    render(
      <>
        <DialogButton tone="cancel">Cancelar</DialogButton>
        <DialogButton tone="accept">Aceptar y subir</DialogButton>
      </>,
    );

    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveAttribute('data-tone', 'cancel');
    expect(screen.getByRole('button', { name: 'Aceptar y subir' })).toHaveAttribute('data-tone', 'accept');
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveAttribute('type', 'button');
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
