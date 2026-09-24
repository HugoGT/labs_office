import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it } from 'vitest';
import { SIDEBAR_TOP } from '../game/hudLayout';
import type { RosterPeer } from '../game/roster';
import { OfficeSidebar } from './OfficeSidebar';

const SELF: RosterPeer = { sessionId: 'yo', name: 'Hugo', status: 'g' };
const ANA: RosterPeer = { sessionId: 'a', name: 'Ana', status: 'g' };
const BETO: RosterPeer = { sessionId: 'b', name: 'Beto', status: 'y' };

function renderSidebar(overrides: Partial<ComponentProps<typeof OfficeSidebar>> = {}) {
  const props = { self: SELF, peers: [ANA, BETO], ...overrides };
  render(<OfficeSidebar {...props} />);
  return props;
}

describe('OfficeSidebar (#74)', () => {
  it('esta colapsada por defecto: el boton dice que no esta expandida', () => {
    renderSidebar();

    expect(screen.getByRole('button', { name: /Personas/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('activar el boton la expande y volver a activarlo la colapsa', async () => {
    const user = userEvent.setup();
    renderSidebar();
    const toggle = screen.getByRole('button', { name: /Personas/ });

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('searchbox')).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });

  it('lista a uno mismo primero y a los pares despues, expandida', async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole('button', { name: /Personas/ }));

    const items = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(items[0]).toMatch(/Hugo/);
    expect(items[1]).toMatch(/Ana/);
    expect(items[2]).toMatch(/Beto/);
  });

  it('el buscador filtra las entradas visibles', async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole('button', { name: /Personas/ }));

    await user.type(screen.getByRole('searchbox'), 'ana');

    const items = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatch(/Ana/);
  });

  it('el panel fijo lee su borde superior de SIDEBAR_TOP y el resto de la geometria de la spec', () => {
    renderSidebar();

    const panel = screen.getByRole('complementary', { name: 'Personas' });
    expect(panel).toHaveStyle({
      position: 'fixed',
      top: `${SIDEBAR_TOP}px`,
      bottom: '72px',
      width: '280px',
      zIndex: '15',
    });
  });

  it('forceCollapsed en true colapsa aunque estuviese expandida', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<OfficeSidebar self={SELF} peers={[ANA]} />);
    await user.click(screen.getByRole('button', { name: /Personas/ }));
    expect(screen.getByRole('button', { name: /Personas/ })).toHaveAttribute('aria-expanded', 'true');

    rerender(<OfficeSidebar self={SELF} peers={[ANA]} forceCollapsed />);

    expect(screen.getByRole('button', { name: /Personas/ })).toHaveAttribute('aria-expanded', 'false');
  });
});
