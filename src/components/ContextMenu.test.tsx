import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { OfficeEventMap } from '../game/officeBridge';
import { ContextMenu } from './ContextMenu';

// D2: el unico personaje clicable es un peer real, y un peer real no tiene
// escritorio asignado en el mapa, asi que su menu no lleva "Ir a su
// escritorio" -- solo Llamar y Ver perfil.
const MENU: OfficeEventMap['peermenu'] = {
  sessionId: 'sess-1',
  name: 'Pablo',
  status: 'En línea',
  statusCode: 'g',
  x: 100,
  y: 100,
};

describe('ContextMenu', () => {
  it('no renderiza nada cuando menu es null', () => {
    const { container } = render(
      <ContextMenu menu={null} onAction={vi.fn()} onClose={vi.fn()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('renderiza el nombre del companero, su estado y las 2 acciones que quedan', () => {
    render(<ContextMenu menu={MENU} onAction={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText('Pablo')).toBeInTheDocument();
    expect(screen.getByText('En línea')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Llamar/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ver perfil/ })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Ir a su escritorio/ }),
    ).not.toBeInTheDocument();
  });

  it('Escape cierra el menu', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ContextMenu menu={MENU} onAction={vi.fn()} onClose={onClose} />);

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('un clic fuera del menu lo cierra', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <div>
        <button type="button">fuera</button>
        <ContextMenu menu={MENU} onAction={vi.fn()} onClose={onClose} />
      </div>,
    );

    await user.click(screen.getByRole('button', { name: 'fuera' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('un clic dentro del menu no lo cierra', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ContextMenu menu={MENU} onAction={vi.fn()} onClose={onClose} />);

    await user.click(screen.getByText('Pablo'));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('clic en "Llamar" llama a onAction con "call" y el payload del menu', async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    render(<ContextMenu menu={MENU} onAction={onAction} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /Llamar/ }));

    expect(onAction).toHaveBeenCalledWith('call', MENU);
  });

  it('clic en "Ver perfil" llama a onAction con "profile" y el payload del menu', async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    render(<ContextMenu menu={MENU} onAction={onAction} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /Ver perfil/ }));

    expect(onAction).toHaveBeenCalledWith('profile', MENU);
  });

  it('Llamar esta deshabilitado cuando el companero esta en No molestar (D8)', () => {
    const dndMenu: OfficeEventMap['peermenu'] = { ...MENU, statusCode: 'r' };
    render(<ContextMenu menu={dndMenu} onAction={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: /Llamar/ })).toBeDisabled();
  });

  it('Llamar sigue habilitado para un companero que no esta en No molestar', () => {
    render(<ContextMenu menu={MENU} onAction={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: /Llamar/ })).toBeEnabled();
  });
});
