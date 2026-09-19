import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { OfficeEventMap } from '../game/officeBridge';
import { ContextMenu } from './ContextMenu';

const MENU: OfficeEventMap['npcmenu'] = {
  target: { kind: 'npc', npcId: 3 },
  name: 'Pablo',
  status: 'En línea',
  statusCode: 'g',
  x: 100,
  y: 100,
};

// D2: un peer real no tiene escritorio, asi que su menu no lleva "Ir a su
// escritorio" -- solo Llamar y Ver perfil.
const PEER_MENU: OfficeEventMap['npcmenu'] = {
  target: { kind: 'peer', sessionId: 'sess-1' },
  name: 'Ana',
  status: 'En línea',
  statusCode: 'g',
  x: 50,
  y: 60,
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

describe('ContextMenu: menu de un peer real (issue #2, D2)', () => {
  it('solo muestra Llamar y Ver perfil, sin "Ir a su escritorio"', () => {
    render(<ContextMenu menu={PEER_MENU} onAction={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Llamar/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ver perfil/ })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Ir a su escritorio/ }),
    ).not.toBeInTheDocument();
  });

  it('Llamar esta deshabilitado cuando el peer esta en No molestar (D8)', () => {
    const dndMenu: OfficeEventMap['npcmenu'] = { ...PEER_MENU, statusCode: 'r' };
    render(<ContextMenu menu={dndMenu} onAction={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: /Llamar/ })).toBeDisabled();
  });

  it('Llamar sigue habilitado para un peer que no esta en No molestar', () => {
    render(<ContextMenu menu={PEER_MENU} onAction={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: /Llamar/ })).toBeEnabled();
  });

  it('clic en "Llamar" sobre un peer llama a onAction con "call" y el payload del menu', async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    render(<ContextMenu menu={PEER_MENU} onAction={onAction} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /Llamar/ }));

    expect(onAction).toHaveBeenCalledWith('call', PEER_MENU);
  });

  it('clic en "Ver perfil" sobre un peer llama a onAction con "profile"', async () => {
    const onAction = vi.fn();
    const user = userEvent.setup();
    render(<ContextMenu menu={PEER_MENU} onAction={onAction} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /Ver perfil/ }));

    expect(onAction).toHaveBeenCalledWith('profile', PEER_MENU);
  });
});
