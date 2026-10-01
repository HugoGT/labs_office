import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminError } from './adminPort';
import type { Contribution, ContributionStatus } from './artContributionPort';
import type { ArtReviewPort } from './artReviewPort';
import { ArtReviewPanel } from './ArtReviewPanel';

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

describe('ArtReviewPanel (#122)', () => {
  it('lists the pending pieces with who sent them and an animated preview of a character', async () => {
    const port = fakePort({ pending: [contribution()] });
    render(<ArtReviewPanel reviews={port} />);

    expect(screen.getByRole('heading', { name: 'Revisión de arte' })).toBeInTheDocument();
    const row = await screen.findByRole('listitem');
    expect(row).toHaveTextContent('Lucía');
    expect(row).toHaveTextContent('Autoría: Ana');
    expect(row).toHaveTextContent('Enviado por Ana López (ana@example.com)');
    for (const label of ['caminando hacia abajo', 'caminando hacia la izquierda', 'caminando hacia la derecha', 'caminando hacia arriba', 'sentado']) {
      expect(await within(row).findByRole('img', { name: `Lucía ${label}` })).toBeInTheDocument();
    }
    expect(port.list).toHaveBeenCalledWith('pending');
  });

  it('approving takes the piece out of the queue', async () => {
    const user = userEvent.setup();
    const port = fakePort({ pending: [contribution()] });
    render(<ArtReviewPanel reviews={port} />);

    await user.click(await screen.findByRole('button', { name: 'Aprobar Lucía' }));

    expect(port.approve).toHaveBeenCalledWith('character-upload-0123456789abcdef');
    await waitFor(() => expect(screen.queryByRole('listitem')).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('«Lucía» ya está en el catálogo de toda la oficina.');
  });

  it('rejecting asks for the reason the uploader will read', async () => {
    const user = userEvent.setup();
    const port = fakePort({ pending: [contribution()] });
    render(<ArtReviewPanel reviews={port} />);

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
    render(<ArtReviewPanel reviews={port} />);

    await user.click(await screen.findByRole('button', { name: 'Aprobar Lucía' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Otra persona ya revisó esta pieza.');
  });

  it('approved pieces can be withdrawn, and says how many people went back to the default character', async () => {
    const user = userEvent.setup();
    const port = fakePort({ approved: [contribution({ status: 'approved' })] });
    render(<ArtReviewPanel reviews={port} />);

    await user.click(screen.getByRole('tab', { name: 'Aprobadas' }));
    await user.click(await screen.findByRole('button', { name: 'Retirar Lucía' }));

    expect(port.retire).toHaveBeenCalledWith('character-upload-0123456789abcdef');
    expect(await screen.findByRole('status')).toHaveTextContent('«Lucía» ya no se ofrece. 2 personas vuelven al personaje por defecto.');
    expect(await screen.findByText('Retirada')).toBeInTheDocument();
  });

  it('rejected pieces show their reason and no actions', async () => {
    const user = userEvent.setup();
    render(<ArtReviewPanel reviews={fakePort({ rejected: [contribution({ status: 'rejected', reviewNote: 'Tiene fondo' })] })} />);

    await user.click(screen.getByRole('tab', { name: 'Rechazadas' }));

    const row = await screen.findByRole('listitem');
    expect(row).toHaveTextContent('Motivo: Tiene fondo');
    expect(within(row).queryByRole('button', { name: /Aprobar|Rechazar|Retirar/ })).not.toBeInTheDocument();
  });

  it('an empty queue says so', async () => {
    render(<ArtReviewPanel reviews={fakePort()} />);
    expect(await screen.findByText('No hay piezas pendientes de revisión.')).toBeInTheDocument();
  });
});
