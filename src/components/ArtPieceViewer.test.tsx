import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Contribution } from '../dashboard/artContributionPort';
import { ArtPieceViewer } from './ArtPieceViewer';

function contribution(overrides: Partial<Contribution> = {}): Contribution {
  return {
    id: 'plant-upload-0123456789abcdef',
    kind: 'plant',
    name: 'Helecho',
    author: 'Ana',
    status: 'pending',
    reviewNote: null,
    submittedAt: '2026-10-01T10:00:00.000Z',
    retiredAt: null,
    files: [{ role: 'sheet', path: 'a.png' }],
    uploadedBy: null,
    ...overrides,
  };
}

describe('ArtPieceViewer (#122)', () => {
  it('reads nothing until it is opened', () => {
    const read = vi.fn(async (path: string) => `data:${path}`);
    render(<ArtPieceViewer contribution={contribution()} read={read} className="x" />);

    expect(screen.getByRole('button', { name: 'Ver Helecho' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(read).not.toHaveBeenCalled();
  });

  it('opens a dialog with the office mock of the piece, read through the private route', async () => {
    const user = userEvent.setup();
    const read = vi.fn(async (path: string) => `data:${path}`);
    render(<ArtPieceViewer contribution={contribution()} read={read} className="x" />);

    await user.click(screen.getByRole('button', { name: 'Ver Helecho' }));

    expect(screen.getByRole('dialog', { name: 'Helecho' })).toBeInTheDocument();
    expect(await screen.findByRole('group', { name: 'Helecho en la oficina' })).toBeInTheDocument();
    expect(read).toHaveBeenCalledWith('a.png');
  });

  it('says it is loading until every file has arrived', async () => {
    const user = userEvent.setup();
    let arrive: (url: string) => void = () => undefined;
    const read = vi.fn(() => new Promise<string>((resolve) => (arrive = resolve)));
    render(<ArtPieceViewer contribution={contribution()} read={read} className="x" />);

    await user.click(screen.getByRole('button', { name: 'Ver Helecho' }));
    expect(screen.getByText('Cargando la vista previa…')).toBeInTheDocument();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();

    arrive('data:sheet');
    expect(await screen.findByRole('group', { name: 'Helecho en la oficina' })).toBeInTheDocument();
    expect(screen.queryByText('Cargando la vista previa…')).not.toBeInTheDocument();
  });

  it('closing it gives the focus back to the button that opened it', async () => {
    const user = userEvent.setup();
    render(<ArtPieceViewer contribution={contribution()} read={async () => 'data:sheet'} className="x" />);

    await user.click(screen.getByRole('button', { name: 'Ver Helecho' }));
    await user.click(screen.getByRole('button', { name: 'Cerrar' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ver Helecho' })).toHaveFocus());
  });
});
