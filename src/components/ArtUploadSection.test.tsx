import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminError } from '../dashboard/adminPort';
import { ArtUploadSection } from './ArtUploadSection';
import type { ArtUploadPort } from '../dashboard/artUploadPort';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PNG_BASE64 = 'iVBORw0KGgoBAgM=';

function png(name: string): File {
  return new File([PNG_BYTES], name, { type: 'image/png' });
}

function fakePort(overrides: Partial<ArtUploadPort> = {}): ArtUploadPort {
  return {
    upload: vi.fn(async (input) => ({ id: `${input.kind}-upload-0123456789abcdef`, kind: input.kind, name: input.name, decor: input.kind === 'plant' })),
    ...overrides,
  };
}

async function fillPlant(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.selectOptions(screen.getByLabelText('Tipo'), 'plant');
  await user.type(screen.getByLabelText('Nombre'), 'Helecho');
  await user.upload(screen.getByLabelText(/Hoja/), png('helecho.png'));
}

/** "Subir" shows the office mock first; the piece is published when the admin accepts it there. */
async function submitAndAccept(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Subir' }));
  await user.click(await screen.findByRole('button', { name: 'Aceptar y subir' }));
}

describe('ArtUploadSection (#121)', () => {
  it('asks a character for its two sheets, each with the exact size the contract wants', () => {
    render(<ArtUploadSection uploads={fakePort()} />);

    expect(screen.getByRole('heading', { name: 'Aportar arte' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Caminar/)).toHaveAccessibleDescription(/352 × 416 px/);
    expect(screen.getByLabelText(/Sentado/)).toHaveAccessibleDescription(/352 × 232 px/);
    expect(screen.getByRole('button', { name: 'Subir' })).toBeDisabled();
  });

  it('asks only for the kind and the name: the credit is the uploader\'s and the license and material come from the server', () => {
    render(<ArtUploadSection uploads={fakePort()} />);

    expect(screen.getAllByRole('textbox').map((field) => field.getAttribute('id'))).toHaveLength(1);
    for (const gone of ['Autoría', 'Licencia', 'Material']) expect(screen.queryByLabelText(gone)).not.toBeInTheDocument();
  });

  it('a plant asks for one sheet, and previews the chosen file', async () => {
    const user = userEvent.setup();
    render(<ArtUploadSection uploads={fakePort()} />);

    await fillPlant(user);

    expect(screen.queryByLabelText(/Caminar/)).toBeNull();
    expect(screen.getByLabelText(/Hoja/)).toHaveAccessibleDescription(/32 × 48 px/);
    const preview = await screen.findByRole('img', { name: 'Vista previa de Hoja' });
    expect(preview.getAttribute('src')).toBe(`data:image/png;base64,${PNG_BASE64}`);
  });

  it('"Subir" opens the office mock of what was chosen, from the local files, and publishes nothing yet', async () => {
    const user = userEvent.setup();
    const uploads = fakePort();
    render(<ArtUploadSection uploads={uploads} />);

    await fillPlant(user);
    await user.click(screen.getByRole('button', { name: 'Subir' }));

    const dialog = await screen.findByRole('dialog', { name: 'Helecho' });
    expect(within(dialog).getByRole('group', { name: 'Helecho en la oficina' })).toBeInTheDocument();
    expect(within(dialog).getByRole('img', { name: 'Helecho' }).style.backgroundImage).toContain(`data:image/png;base64,${PNG_BASE64}`);
    expect(uploads.upload).not.toHaveBeenCalled();
  });

  it('"Cancelar" goes back to the form with everything as it was, and publishes nothing', async () => {
    const user = userEvent.setup();
    const uploads = fakePort();
    render(<ArtUploadSection uploads={uploads} />);

    await fillPlant(user);
    await user.click(screen.getByRole('button', { name: 'Subir' }));
    await user.click(await screen.findByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toHaveValue('Helecho');
    expect(screen.getByRole('button', { name: 'Subir' })).toBeEnabled();
    expect(uploads.upload).not.toHaveBeenCalled();
  });

  it('accepting closes the mock, empties the form and says the piece is in the catalog', async () => {
    const user = userEvent.setup();
    render(<ArtUploadSection uploads={fakePort()} />);

    await fillPlant(user);
    await submitAndAccept(user);

    expect(await screen.findByRole('status')).toHaveTextContent('«Helecho» ya está en el catálogo');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toHaveValue('');
  });

  it('uploads the files in base64 with the metadata and says the piece is in the catalog', async () => {
    const user = userEvent.setup();
    const uploads = fakePort();
    render(<ArtUploadSection uploads={uploads} />);

    await fillPlant(user);
    await submitAndAccept(user);

    await waitFor(() =>
      expect(uploads.upload).toHaveBeenCalledWith({
        kind: 'plant',
        name: 'Helecho',
        files: { sheet: PNG_BASE64 },
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('«Helecho» ya está en el catálogo');
    expect(screen.getByRole('status')).toHaveTextContent('decoración');
  });

  it('a colorable floor sends its default color', async () => {
    const user = userEvent.setup();
    const uploads = fakePort();
    render(<ArtUploadSection uploads={uploads} />);

    await user.selectOptions(screen.getByLabelText('Tipo'), 'floor');
    await user.type(screen.getByLabelText('Nombre'), 'Baldosa');
    await user.click(screen.getByLabelText('Admite color'));
    await user.upload(screen.getByLabelText(/Hoja/), png('baldosa.png'));
    await submitAndAccept(user);

    await waitFor(() => expect(uploads.upload).toHaveBeenCalledWith(expect.objectContaining({ kind: 'floor', colorable: true, defaultColor: '#808080' })));
  });

  it('shows a refusal in Spanish, naming the file and the size it should have', async () => {
    const user = userEvent.setup();
    const uploads = fakePort({ upload: vi.fn(async () => Promise.reject(new AdminError('invalid-dimensions', 'sheet'))) });
    render(<ArtUploadSection uploads={uploads} />);

    await fillPlant(user);
    await submitAndAccept(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Hoja');
    expect(alert).toHaveTextContent('32 × 48 px');
    expect(alert).toHaveTextContent('no mide exactamente');
  });
});
