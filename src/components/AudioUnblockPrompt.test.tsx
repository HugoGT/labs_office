import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AudioUnblockPrompt } from './AudioUnblockPrompt';

describe('AudioUnblockPrompt', () => {
  it('esta ausente del arbol cuando el audio no esta bloqueado', () => {
    render(<AudioUnblockPrompt blocked={false} onUnblock={vi.fn()} />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('ofrece un boton real cuando el navegador bloquea el audio', () => {
    render(<AudioUnblockPrompt blocked={true} onUnblock={vi.fn()} />);

    // Tiene que ser un boton de verdad: la politica del navegador solo cede
    // ante un gesto del usuario sobre un elemento interactivo.
    expect(screen.getByRole('button', { name: /activar el audio/i })).toBeInTheDocument();
  });

  it('el clic dispara el desbloqueo', async () => {
    const onUnblock = vi.fn();
    render(<AudioUnblockPrompt blocked={true} onUnblock={onUnblock} />);

    await userEvent.click(screen.getByRole('button'));

    expect(onUnblock).toHaveBeenCalledTimes(1);
  });
});
