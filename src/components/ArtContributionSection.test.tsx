import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminError } from '../dashboard/adminPort';
import { RIGHTS_STATEMENT, type ArtContributionPort, type Contribution } from '../dashboard/artContributionPort';
import { ArtContributionSection } from './ArtContributionSection';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PNG_BASE64 = 'iVBORw0KGgoBAgM=';

function png(name: string): File {
  return new File([PNG_BYTES], name, { type: 'image/png' });
}

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
    uploadedBy: null,
    ...overrides,
  };
}

const USAGE = { pending: 0, lastHour: 0, maxPending: 5, maxPerHour: 10 };

function fakePort(mine: Contribution[] = [], overrides: Partial<ArtContributionPort> = {}): ArtContributionPort {
  return {
    submit: vi.fn(async (input) => contribution({ name: input.name, kind: input.kind })),
    listMine: vi.fn(async () => ({ contributions: mine, usage: { ...USAGE, pending: mine.filter((entry) => entry.status === 'pending').length } })),
    fileDataUrl: vi.fn(async (path: string) => `data:image/png;base64,${path}`),
    ...overrides,
  };
}

async function fillCharacter(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText('Nombre'), 'Lucía');
  await user.type(screen.getByLabelText('Autoría'), 'Ana');
  await user.upload(screen.getByLabelText(/Caminar/), png('walk.png'));
  await user.upload(screen.getByLabelText(/Sentado/), png('seated.png'));
}

describe('ArtContributionSection (#122)', () => {
  it('offers characters and decor plants only, with the rights statement word for word', async () => {
    render(<ArtContributionSection contributions={fakePort()} />);

    const kinds = within(screen.getByLabelText('Tipo')).getAllByRole('option').map((option) => option.getAttribute('value'));
    expect(kinds).toEqual(['character', 'plant']);
    expect(screen.getByRole('checkbox', { name: RIGHTS_STATEMENT })).not.toBeChecked();
    expect(RIGHTS_STATEMENT).toBe('Confirmo que este arte no infringe derechos de autor y que la oficina puede usarlo libremente.');
    await waitFor(() => expect(screen.getByText('Pendientes de revisión: 0 de 5')).toBeInTheDocument());
  });

  it('cannot be sent until the rights statement is accepted', async () => {
    const user = userEvent.setup();
    const port = fakePort();
    render(<ArtContributionSection contributions={port} />);

    await fillCharacter(user);
    const send = screen.getByRole('button', { name: 'Enviar a revisión' });
    expect(send).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: RIGHTS_STATEMENT }));
    expect(send).toBeEnabled();
    await user.click(send);

    await waitFor(() => expect(port.submit).toHaveBeenCalledTimes(1));
    expect(port.submit).toHaveBeenCalledWith({
      kind: 'character',
      name: 'Lucía',
      author: 'Ana',
      rightsAccepted: true,
      files: { walk: PNG_BASE64, seated: PNG_BASE64 },
    });
    expect(await screen.findByRole('status')).toHaveTextContent('«Lucía» quedó pendiente de revisión');
    // The list is read again, so the new piece and the usage show up.
    expect(port.listMine).toHaveBeenCalledTimes(2);
  });

  it('a plant asks for its sheet and a material', async () => {
    const user = userEvent.setup();
    const port = fakePort();
    render(<ArtContributionSection contributions={port} />);

    await user.selectOptions(screen.getByLabelText('Tipo'), 'plant');
    await user.type(screen.getByLabelText('Nombre'), 'Helecho');
    await user.type(screen.getByLabelText('Autoría'), 'Ana');
    await user.type(screen.getByLabelText('Material'), 'helecho');
    await user.upload(screen.getByLabelText(/Hoja/), png('sheet.png'));
    await user.click(screen.getByRole('checkbox', { name: RIGHTS_STATEMENT }));
    await user.click(screen.getByRole('button', { name: 'Enviar a revisión' }));

    await waitFor(() => expect(port.submit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'plant', material: 'helecho', files: { sheet: PNG_BASE64 } })));
  });

  it.each([
    ['too-many-pending', 'Ya tienes 5 piezas pendientes de revisión. Espera a que se revisen antes de subir otra.'],
    ['hourly-limit', 'Ya subiste 10 piezas en la última hora. Vuelve a intentarlo más tarde.'],
  ] as const)('a refusal for %s is readable Spanish', async (code, message) => {
    const user = userEvent.setup();
    render(<ArtContributionSection contributions={fakePort([], { submit: vi.fn(async () => Promise.reject(new AdminError(code))) })} />);

    await fillCharacter(user);
    await user.click(screen.getByRole('checkbox', { name: RIGHTS_STATEMENT }));
    await user.click(screen.getByRole('button', { name: 'Enviar a revisión' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('lists the own contributions with their state, and a rejection with its reason', async () => {
    render(
      <ArtContributionSection
        contributions={fakePort([
          contribution({ id: 'a', name: 'Lucía' }),
          contribution({ id: 'b', name: 'Mario', status: 'rejected', reviewNote: 'Tiene fondo blanco' }),
          contribution({ id: 'c', name: 'Rosa', status: 'approved' }),
          contribution({ id: 'd', name: 'Pepe', status: 'approved', retiredAt: '2026-10-02T00:00:00.000Z' }),
        ])}
      />,
    );

    const list = await screen.findByRole('list', { name: 'Mis aportaciones' });
    // Newest first: the server lists them oldest first.
    const rows = within(list).getAllByRole('listitem').map((row) => row.textContent);
    expect(rows).toEqual([
      expect.stringMatching(/^Pepe.*Retirada$/),
      expect.stringMatching(/^Rosa.*Aprobada$/),
      expect.stringMatching(/^Mario.*Rechazada: Tiene fondo blanco$/),
      expect.stringMatching(/^Lucía.*Pendiente de revisión$/),
    ]);
  });

  it('previews a pending piece from its private files', async () => {
    const user = userEvent.setup();
    const port = fakePort([contribution()]);
    render(<ArtContributionSection contributions={port} />);

    await user.click(await screen.findByRole('button', { name: 'Ver Lucía' }));

    expect(await screen.findByRole('img', { name: 'Lucía sentado' })).toBeInTheDocument();
    expect(port.fileDataUrl).toHaveBeenCalledWith('a.png');
    expect(port.fileDataUrl).toHaveBeenCalledWith('b.png');
  });
});
