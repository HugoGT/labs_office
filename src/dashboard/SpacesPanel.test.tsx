import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminError, type AdminErrorCode } from './adminPort';
import type { AdminSpace, SpacesAdminPort } from './spacesAdminPort';
import { SpacesPanel } from './SpacesPanel';

const SALA: AdminSpace = {
  id: 'space-1',
  name: 'Sala de Juntas',
  x: 50,
  y: 2,
  w: 13,
  h: 14,
  capacity: null,
  kind: 'room',
};

const SALA_CON_AFORO: AdminSpace = {
  ...SALA,
  id: 'space-2',
  name: 'Cafetería',
  x: 20,
  y: 20,
  w: 4,
  h: 4,
  capacity: 8,
};

const CUBICULO: AdminSpace = {
  id: 'space-3',
  name: 'Mesa 4',
  x: 6,
  y: 9,
  w: 3,
  h: 3,
  capacity: null,
  kind: 'desk',
};

function fakeSpaces(overrides: Partial<SpacesAdminPort> = {}): SpacesAdminPort {
  return {
    listSpaces: vi.fn(async () => [SALA, SALA_CON_AFORO]),
    createSpace: vi.fn(async () => SALA),
    updateSpace: vi.fn(async () => SALA),
    deleteSpace: vi.fn(async () => undefined),
    ...overrides,
  };
}

/** Un puerto que falla siempre con el mismo motivo, para probar la degradacion. */
function failingSpaces(code: AdminErrorCode): SpacesAdminPort {
  function fail(): never {
    throw new AdminError(code);
  }
  return {
    listSpaces: vi.fn(fail),
    createSpace: vi.fn(fail),
    updateSpace: vi.fn(fail),
    deleteSpace: vi.fn(fail),
  };
}

/** El formulario de alta/edicion, acotado para no chocar con la tabla. */
function formulario() {
  return within(screen.getByRole('form', { name: /sala/i }));
}

async function crear(
  user: ReturnType<typeof userEvent.setup>,
  values: { name: string; x: string; y: string; w: string; h: string; capacity?: string },
) {
  const form = formulario();
  await user.type(form.getByLabelText(/nombre/i), values.name);
  await user.clear(form.getByLabelText(/^x$/i));
  await user.type(form.getByLabelText(/^x$/i), values.x);
  await user.clear(form.getByLabelText(/^y$/i));
  await user.type(form.getByLabelText(/^y$/i), values.y);
  await user.clear(form.getByLabelText(/ancho/i));
  await user.type(form.getByLabelText(/ancho/i), values.w);
  await user.clear(form.getByLabelText(/alto/i));
  await user.type(form.getByLabelText(/alto/i), values.h);
  if (values.capacity !== undefined) {
    await user.type(form.getByLabelText(/aforo/i), values.capacity);
  }
  await user.click(form.getByRole('button', { name: /crear/i }));
}

/** La fila de la tabla cuyo encabezado es `name`. */
function fila(name: string) {
  return within(screen.getByRole('row', { name: new RegExp(name) }));
}

describe('SpacesPanel: lo que se ve', () => {
  it('mientras no sabe que hay no pinta nada', () => {
    const spaces = fakeSpaces({ listSpaces: vi.fn(() => new Promise<AdminSpace[]>(() => {})) });

    const { container } = render(<SpacesPanel spaces={spaces} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('pinta posicion, tamaño y aforo de cada sala', async () => {
    render(<SpacesPanel spaces={fakeSpaces()} />);

    expect(await screen.findByText('Sala de Juntas')).toBeInTheDocument();
    expect(fila('Sala de Juntas').getByText(/50.*2/)).toBeInTheDocument();
    expect(fila('Sala de Juntas').getByText(/13.*14/)).toBeInTheDocument();
    expect(fila('Sala de Juntas').getByText(/sin límite/i)).toBeInTheDocument();
    expect(fila('Cafetería').getByText('8')).toBeInTheDocument();
  });

  it('sin salas lo dice, en vez de una tabla con encabezados y nada mas', async () => {
    render(<SpacesPanel spaces={fakeSpaces({ listSpaces: vi.fn(async () => []) })} />);

    expect(await screen.findByText(/todavía no hay salas/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('form', { name: /sala/i })).toBeInTheDocument();
  });

  it('un cubiculo se etiqueta y no ofrece editar ni eliminar', async () => {
    render(
      <SpacesPanel spaces={fakeSpaces({ listSpaces: vi.fn(async () => [SALA, CUBICULO]) })} />,
    );

    expect(await screen.findByText('Mesa 4')).toBeInTheDocument();
    // Etiqueta exacta que pide la spec, y no un generico "Escritorio".
    expect(fila('Mesa 4').getByText('Cubículo de escritorio')).toBeInTheDocument();
    expect(fila('Mesa 4').queryByRole('button', { name: /editar/i })).not.toBeInTheDocument();
    expect(fila('Mesa 4').queryByRole('button', { name: /eliminar/i })).not.toBeInTheDocument();
    // La sala de al lado SI los tiene: prueba no vacia de que el filtro es por fila, no global.
    expect(fila('Sala de Juntas').getByRole('button', { name: /editar/i })).toBeInTheDocument();
  });
});

describe('SpacesPanel: crear y editar salas', () => {
  it('crea con los campos escritos, y relee la lista', async () => {
    const user = userEvent.setup();
    const spaces = fakeSpaces();
    render(<SpacesPanel spaces={spaces} />);
    await screen.findByText('Sala de Juntas');

    await crear(user, { name: 'Sala Nueva', x: '30', y: '1', w: '4', h: '4', capacity: '6' });

    expect(spaces.createSpace).toHaveBeenCalledWith({
      name: 'Sala Nueva',
      x: 30,
      y: 1,
      w: 4,
      h: 4,
      capacity: 6,
    });
    await waitFor(() => expect(spaces.listSpaces).toHaveBeenCalledTimes(2));
  });

  it('sin aforo escrito manda capacity null, no lo omite', async () => {
    const user = userEvent.setup();
    const spaces = fakeSpaces();
    render(<SpacesPanel spaces={spaces} />);
    await screen.findByText('Sala de Juntas');

    await crear(user, { name: 'Sala Nueva', x: '30', y: '1', w: '4', h: '4' });

    expect(spaces.createSpace).toHaveBeenCalledWith({
      name: 'Sala Nueva',
      x: 30,
      y: 1,
      w: 4,
      h: 4,
      capacity: null,
    });
  });

  it('un solape dice que chocan las coordenadas, no "algo salió mal"', async () => {
    const user = userEvent.setup();
    const spaces = fakeSpaces({
      createSpace: vi.fn(async () => {
        throw new AdminError('space-overlap');
      }),
    });
    render(<SpacesPanel spaces={spaces} />);
    await screen.findByText('Sala de Juntas');

    await crear(user, { name: 'Sala Nueva', x: '1', y: '1', w: '4', h: '4' });

    expect(await screen.findByRole('alert')).toHaveTextContent(/chocan/i);
  });

  it('un nombre repetido dice que ya existe, no que choca', async () => {
    const user = userEvent.setup();
    const spaces = fakeSpaces({
      createSpace: vi.fn(async () => {
        throw new AdminError('space-name-taken');
      }),
    });
    render(<SpacesPanel spaces={spaces} />);
    await screen.findByText('Sala de Juntas');

    await crear(user, { name: 'Sala de Juntas', x: '1', y: '1', w: '4', h: '4' });

    expect(await screen.findByRole('alert')).toHaveTextContent(/ya existe una sala/i);
  });

  it('renombrar manda solo el nombre, sin el rectangulo ni el aforo', async () => {
    const user = userEvent.setup();
    const spaces = fakeSpaces();
    render(<SpacesPanel spaces={spaces} />);
    await screen.findByText('Sala de Juntas');

    await user.click(fila('Sala de Juntas').getByRole('button', { name: /editar/i }));
    const form = formulario();
    await user.clear(form.getByLabelText(/nombre/i));
    await user.type(form.getByLabelText(/nombre/i), 'Sala Grande');
    await user.click(form.getByRole('button', { name: /guardar/i }));

    expect(spaces.updateSpace).toHaveBeenCalledWith('space-1', { name: 'Sala Grande' });
  });

  it('mover o redimensionar manda x, y, w y h juntos', async () => {
    const user = userEvent.setup();
    const spaces = fakeSpaces();
    render(<SpacesPanel spaces={spaces} />);
    await screen.findByText('Sala de Juntas');

    await user.click(fila('Sala de Juntas').getByRole('button', { name: /editar/i }));
    const form = formulario();
    await user.clear(form.getByLabelText(/^x$/i));
    await user.type(form.getByLabelText(/^x$/i), '55');
    await user.click(form.getByRole('button', { name: /guardar/i }));

    expect(spaces.updateSpace).toHaveBeenCalledWith('space-1', { x: 55, y: 2, w: 13, h: 14 });
  });

  it('quitar el aforo manda capacity null en el patch', async () => {
    const user = userEvent.setup();
    const spaces = fakeSpaces();
    render(<SpacesPanel spaces={spaces} />);
    await screen.findByText('Cafetería');

    await user.click(fila('Cafetería').getByRole('button', { name: /editar/i }));
    const form = formulario();
    await user.clear(form.getByLabelText(/aforo/i));
    await user.click(form.getByRole('button', { name: /guardar/i }));

    expect(spaces.updateSpace).toHaveBeenCalledWith('space-2', { capacity: null });
  });
});

describe('SpacesPanel: borrar una sala', () => {
  it('pide confirmacion antes de borrar', async () => {
    const user = userEvent.setup();
    const spaces = fakeSpaces();
    render(<SpacesPanel spaces={spaces} />);
    await screen.findByText('Sala de Juntas');

    await user.click(fila('Sala de Juntas').getByRole('button', { name: /eliminar/i }));

    expect(spaces.deleteSpace).not.toHaveBeenCalled();
    expect(fila('Sala de Juntas').getByRole('button', { name: /sí, eliminar/i })).toBeInTheDocument();
  });

  it('confirmado lo borra y relee la lista', async () => {
    const user = userEvent.setup();
    const spaces = fakeSpaces();
    render(<SpacesPanel spaces={spaces} />);
    await screen.findByText('Sala de Juntas');

    await user.click(fila('Sala de Juntas').getByRole('button', { name: /eliminar/i }));
    await user.click(fila('Sala de Juntas').getByRole('button', { name: /sí, eliminar/i }));

    expect(spaces.deleteSpace).toHaveBeenCalledWith('space-1');
    await waitFor(() => expect(spaces.listSpaces).toHaveBeenCalledTimes(2));
  });
});

describe('SpacesPanel: despliegues sin salas configuradas', () => {
  it('un 503 explica el despliegue y no ofrece un formulario roto', async () => {
    render(<SpacesPanel spaces={failingSpaces('spaces-not-configured')} />);

    expect(await screen.findByText(/no están configuradas/i)).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: /sala/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('cualquier otro fallo de carga si se cuenta como fallo', async () => {
    render(<SpacesPanel spaces={failingSpaces('network')} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo contactar/i);
  });
});
