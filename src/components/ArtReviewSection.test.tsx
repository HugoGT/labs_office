import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminError } from '../dashboard/adminPort';
import type { Contribution, ContributionStatus } from '../dashboard/artContributionPort';
import type { ArtReviewPort } from '../dashboard/artReviewPort';
import { ArtReviewSection } from './ArtReviewSection';

function contribution(overrides: Partial<Contribution> = {}): Contribution {
  return {
    id: 'character-upload-0123456789abcdef',
    kind: 'character',
    name: 'Lucía',
    author: 'Ana',
    status: 'pending',
    reviewNote: null,
    submittedAt: '2026-10-01T10:00:00.000Z',
    retiredAt: null,
    files: [
      { role: 'walk', path: 'a.png' },
      { role: 'seated', path: 'b.png' },
    ],
    uploadedBy: { id: 'id-ana', name: 'Ana López', email: 'ana@example.com' },
    ...overrides,
  };
}

function fakePort(byStatus: Partial<Record<ContributionStatus, Contribution[]>> = {}, overrides: Partial<ArtReviewPort> = {}): ArtReviewPort {
  return {
    list: vi.fn(async (status: ContributionStatus) => byStatus[status] ?? []),
    approve: vi.fn(async (id: string) => contribution({ id, status: 'approved' })),
    reject: vi.fn(async (id: string, reason: string) => contribution({ id, status: 'rejected', reviewNote: reason })),
    retire: vi.fn(async (id: string) => ({ contribution: contribution({ id, status: 'approved', retiredAt: '2026-10-02T00:00:00.000Z' }), usersReset: 2 })),
    fileDataUrl: vi.fn(async (path: string) => `data:image/png;base64,${path}`),
    ...overrides,
  };
}

describe('ArtReviewSection (#122)', () => {
  it('lists the pending pieces with who sent them, and reads no file until one is opened', async () => {
    const port = fakePort({ pending: [contribution()] });
    render(<ArtReviewSection reviews={port} />);

    expect(screen.getByRole('heading', { name: 'Revisión de arte' })).toBeInTheDocument();
    const row = await screen.findByRole('listitem');
    expect(row).toHaveTextContent('Lucía');
    expect(row).toHaveTextContent('Autoría: Ana');
    expect(row).toHaveTextContent('Enviado por Ana López (ana@example.com)');
    expect(port.list).toHaveBeenCalledWith('pending');
    expect(port.fileDataUrl).not.toHaveBeenCalled();
  });

  it('opens the office mock of a piece: the character walks all 8 directions around one sitting', async () => {
    const user = userEvent.setup();
    const port = fakePort({ pending: [contribution()] });
    render(<ArtReviewSection reviews={port} />);

    await user.click(await screen.findByRole('button', { name: 'Ver Lucía' }));

    const dialog = await screen.findByRole('dialog', { name: 'Lucía' });
    expect(await within(dialog).findByRole('group', { name: 'Lucía en la oficina' })).toBeInTheDocument();
    expect(within(dialog).getAllByRole('img', { name: /Lucía caminando/ })).toHaveLength(8);
    expect(within(dialog).getByRole('img', { name: 'Lucía sentado' })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('approving takes the piece out of the queue', async () => {
    const user = userEvent.setup();
    const port = fakePort({ pending: [contribution()] });
    render(<ArtReviewSection reviews={port} />);

    await user.click(await screen.findByRole('button', { name: 'Aprobar Lucía' }));

    expect(port.approve).toHaveBeenCalledWith('character-upload-0123456789abcdef');
    await waitFor(() => expect(screen.queryByRole('listitem')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('«Lucía» ya está en el catálogo de toda la oficina.');
  });

  it('rejecting asks for the reason the uploader will read', async () => {
    const user = userEvent.setup();
    const port = fakePort({ pending: [contribution()] });
    render(<ArtReviewSection reviews={port} />);

    await user.click(await screen.findByRole('button', { name: 'Rechazar Lucía' }));
    const confirm = screen.getByRole('button', { name: 'Confirmar rechazo' });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText('Motivo del rechazo'), 'Tiene fondo blanco');
    await user.click(confirm);

    expect(port.reject).toHaveBeenCalledWith('character-upload-0123456789abcdef', 'Tiene fondo blanco');
    await waitFor(() => expect(screen.queryByRole('listitem')).not.toBeInTheDocument());
  });

  it('a decision another reviewer already took is readable', async () => {
    const user = userEvent.setup();
    const port = fakePort({ pending: [contribution()] }, { approve: vi.fn(async () => Promise.reject(new AdminError('already-reviewed'))) });
    render(<ArtReviewSection reviews={port} />);

    await user.click(await screen.findByRole('button', { name: 'Aprobar Lucía' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Otra persona ya revisó esta pieza.');
  });

  it('approved pieces can be withdrawn, and says how many people went back to the default character', async () => {
    const user = userEvent.setup();
    const port = fakePort({ approved: [contribution({ status: 'approved' })] });
    render(<ArtReviewSection reviews={port} />);

    await user.click(screen.getByRole('tab', { name: 'Aprobadas' }));
    await user.click(await screen.findByRole('button', { name: 'Retirar Lucía' }));

    expect(port.retire).toHaveBeenCalledWith('character-upload-0123456789abcdef');
    expect(await screen.findByRole('status')).toHaveTextContent('«Lucía» ya no se ofrece. 2 personas vuelven al personaje por defecto.');
    expect(await screen.findByText('Retirada')).toBeInTheDocument();
  });

  it.each(['plant', 'desk', 'floor', 'chair', 'table', 'door'])('an approved %s can be withdrawn like a character', async (kind) => {
    const user = userEvent.setup();
    const port = fakePort({ approved: [contribution({ kind, name: 'Pieza', status: 'approved', files: [{ role: 'sheet', path: 'a.png' }] })] });
    render(<ArtReviewSection reviews={port} />);

    await user.click(screen.getByRole('tab', { name: 'Aprobadas' }));

    expect(await screen.findByRole('button', { name: 'Retirar Pieza' })).toBeInTheDocument();
  });

  it('rejected pieces show their reason and no actions', async () => {
    const user = userEvent.setup();
    render(<ArtReviewSection reviews={fakePort({ rejected: [contribution({ status: 'rejected', reviewNote: 'Tiene fondo' })] })} />);

    await user.click(screen.getByRole('tab', { name: 'Rechazadas' }));

    const row = await screen.findByRole('listitem');
    expect(row).toHaveTextContent('Motivo: Tiene fondo');
    expect(within(row).queryByRole('button', { name: /Aprobar|Rechazar|Retirar/ })).not.toBeInTheDocument();
  });

  it('an empty queue says so', async () => {
    render(<ArtReviewSection reviews={fakePort()} />);
    expect(await screen.findByText('No hay piezas pendientes de revisión.')).toBeInTheDocument();
  });
});
