import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminError } from './adminPort';
import { ArtUploadPanel } from './ArtUploadPanel';
import type { ArtUploadPort } from './artUploadPort';

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
  await user.type(screen.getByLabelText('Autoría'), 'Equipo de arte');
  await user.type(screen.getByLabelText('Material'), 'helecho');
  await user.upload(screen.getByLabelText(/Hoja/), png('helecho.png'));
}

describe('ArtUploadPanel (#121)', () => {
  it('asks a character for its two sheets, each with the exact size the contract wants', () => {
    render(<ArtUploadPanel uploads={fakePort()} />);

    expect(screen.getByRole('heading', { name: 'Subir arte' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Caminar/)).toHaveAccessibleDescription(/352 × 416 px/);
    expect(screen.getByLabelText(/Sentado/)).toHaveAccessibleDescription(/352 × 232 px/);
    // A character has no material.
    expect(screen.queryByLabelText('Material')).toBeNull();
    expect(screen.getByRole('button', { name: 'Subir' })).toBeDisabled();
  });

  it('a plant asks for one sheet and a material, and previews the chosen file', async () => {
    const user = userEvent.setup();
    render(<ArtUploadPanel uploads={fakePort()} />);

    await fillPlant(user);

    expect(screen.queryByLabelText(/Caminar/)).toBeNull();
    expect(screen.getByLabelText(/Hoja/)).toHaveAccessibleDescription(/32 × 48 px/);
    const preview = await screen.findByRole('img', { name: 'Vista previa de Hoja' });
    expect(preview.getAttribute('src')).toBe(`data:image/png;base64,${PNG_BASE64}`);
  });

  it('uploads the files in base64 with the metadata and says the piece is in the catalog', async () => {
    const user = userEvent.setup();
    const uploads = fakePort();
    render(<ArtUploadPanel uploads={uploads} />);

    await fillPlant(user);
    await user.click(screen.getByRole('button', { name: 'Subir' }));

    await waitFor(() =>
      expect(uploads.upload).toHaveBeenCalledWith({
        kind: 'plant',
        name: 'Helecho',
        author: 'Equipo de arte',
        license: 'proprietary-internal',
        material: 'helecho',
        files: { sheet: PNG_BASE64 },
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('«Helecho» ya está en el catálogo');
    expect(screen.getByRole('status')).toHaveTextContent('decoración');
  });

  it('a colorable floor sends its default color', async () => {
    const user = userEvent.setup();
    const uploads = fakePort();
    render(<ArtUploadPanel uploads={uploads} />);

    await user.selectOptions(screen.getByLabelText('Tipo'), 'floor');
    await user.type(screen.getByLabelText('Nombre'), 'Baldosa');
    await user.type(screen.getByLabelText('Autoría'), 'Equipo');
    await user.type(screen.getByLabelText('Material'), 'baldosa');
    await user.click(screen.getByLabelText('Admite color'));
    await user.upload(screen.getByLabelText(/Hoja/), png('baldosa.png'));
    await user.click(screen.getByRole('button', { name: 'Subir' }));

    await waitFor(() => expect(uploads.upload).toHaveBeenCalledWith(expect.objectContaining({ kind: 'floor', colorable: true, defaultColor: '#808080' })));
  });

  it('shows a refusal in Spanish, naming the file and the size it should have', async () => {
    const user = userEvent.setup();
    const uploads = fakePort({ upload: vi.fn(async () => Promise.reject(new AdminError('invalid-dimensions', 'sheet'))) });
    render(<ArtUploadPanel uploads={uploads} />);

    await fillPlant(user);
    await user.click(screen.getByRole('button', { name: 'Subir' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Hoja');
    expect(alert).toHaveTextContent('32 × 48 px');
    expect(alert).toHaveTextContent('no mide exactamente');
  });
});
