import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DeskBanner, type DeskBannerProps } from './DeskBanner';
import type { DeskBannerView } from './deskBannerView';

const ANCHOR = { x: 200, y: 150 };

function renderBanner(view: DeskBannerView, overrides: Partial<DeskBannerProps> = {}) {
  const props: DeskBannerProps = {
    view,
    anchor: ANCHOR,
    portrait: null,
    onClaim: vi.fn(),
    onCall: vi.fn(),
    onCharacter: vi.fn(),
    onDecorate: vi.fn(),
    onLeave: vi.fn(),
    onPointerEnter: vi.fn(),
    onPointerLeave: vi.fn(),
    ...overrides,
  };
  render(<DeskBanner {...props} />);
  return props;
}

const MINE: DeskBannerView = { kind: 'mine', deskId: 'd1', label: 'Mesa 4', name: 'Ana Torres', status: 'g', sessionId: 'yo' };
const TAKEN: DeskBannerView = {
  kind: 'taken',
  deskId: 'd1',
  label: 'Mesa 4',
  name: 'Luis Paz',
  status: 'g',
  sessionId: 's-luis',
  callable: true,
};

describe('DeskBanner', () => {
  it('sits centered on the anchor, the top edge of the desk', () => {
    renderBanner(MINE);

    const banner = screen.getByRole('dialog', { name: 'Ana Torres' });
    expect(banner).toHaveStyle({ left: '200px', top: '150px' });
  });

  it('a free desk says so and claims it', async () => {
    const props = renderBanner({ kind: 'free', deskId: 'd1', label: 'Mesa 4', canClaim: true });

    expect(screen.getByText('Escritorio Libre')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reclamar escritorio' }));

    expect(props.onClaim).toHaveBeenCalledTimes(1);
  });

  it('a free desk cannot be claimed while one holds another, and says why', () => {
    renderBanner({ kind: 'free', deskId: 'd1', label: 'Mesa 4', canClaim: false });

    const claim = screen.getByRole('button', { name: 'Reclamar escritorio' });
    expect(claim).toBeDisabled();
    expect(claim).toHaveAttribute('title', 'Ya tienes un escritorio: déjalo antes de reclamar otro');
  });

  it('the own desk shows name and status with Mi personaje, Decorar and Dejar escritorio, and no call', async () => {
    const props = renderBanner(MINE, { portrait: 'data:image/png;base64,AA' });

    expect(screen.getByText('Ana Torres')).toBeInTheDocument();
    expect(screen.getByText('En línea')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Ana Torres' })).toHaveAttribute('src', 'data:image/png;base64,AA');
    expect(screen.queryByRole('button', { name: /Llamar/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Mi personaje' }));
    await userEvent.click(screen.getByRole('button', { name: 'Decorar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Dejar escritorio' }));

    expect(props.onCharacter).toHaveBeenCalledTimes(1);
    expect(props.onDecorate).toHaveBeenCalledTimes(1);
    expect(props.onLeave).toHaveBeenCalledTimes(1);
  });

  it('the own desk leaves out Mi personaje without a character editor', () => {
    renderBanner(MINE, { onCharacter: undefined });

    expect(screen.queryByRole('button', { name: 'Mi personaje' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decorar' })).toBeInTheDocument();
  });

  it("someone else's desk offers only the call", async () => {
    const props = renderBanner(TAKEN);

    await userEvent.click(screen.getByRole('button', { name: 'Llamar a Luis Paz' }));

    expect(props.onCall).toHaveBeenCalledWith('s-luis', 'Luis Paz');
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it("someone else's desk offers no call while they cannot take one", () => {
    renderBanner({ ...TAKEN, status: 'r', callable: false });

    expect(screen.getByText('No molestar')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it("someone else's desk says they are offline", () => {
    renderBanner({ ...TAKEN, status: null, sessionId: null, callable: false });

    expect(screen.getByText('Desconectado')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('tells when the pointer enters and leaves it', async () => {
    const props = renderBanner(MINE);
    const banner = screen.getByRole('dialog', { name: 'Ana Torres' });

    await userEvent.hover(banner);
    await userEvent.unhover(banner);

    expect(props.onPointerEnter).toHaveBeenCalled();
    expect(props.onPointerLeave).toHaveBeenCalled();
  });
});
