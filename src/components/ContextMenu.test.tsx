import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { OfficeEventMap } from '../game/officeBridge';
import { ContextMenu } from './ContextMenu';

const MENU: OfficeEventMap['npcmenu'] = {
  id: 3,
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

  it('renderiza el nombre del NPC, su estado y las 3 acciones', () => {
    render(<ContextMenu menu={MENU} onAction={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText('Pablo')).toBeInTheDocument();
    expect(screen.getByText('En línea')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Llamar/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ir a su escritorio/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ver perfil/ })).toBeInTheDocument();
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

  it('clic en "Ir a su escritorio" llama a onAction con "goto" y el payload del menu', async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    render(<ContextMenu menu={MENU} onAction={onAction} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /Ir a su escritorio/ }));

    expect(onAction).toHaveBeenCalledWith('goto', MENU);
  });

  it('clic en "Llamar" llama a onAction con "call" y el payload del menu', async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    render(<ContextMenu menu={MENU} onAction={onAction} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /Llamar/ }));

    expect(onAction).toHaveBeenCalledWith('call', MENU);
  });
});
