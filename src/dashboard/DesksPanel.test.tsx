import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminError, type AdminErrorCode } from './adminPort';
import type { AdminDesk, DeskAdminPort } from './deskAdminPort';
import { DesksPanel } from './DesksPanel';

const LIBRE: AdminDesk = {
  id: 'desk-1',
  label: 'Mesa 4',
  x: 6,
  y: 9,
  w: 3,
  h: 3,
  occupant: null,
};

const OCUPADA: AdminDesk = {
  ...LIBRE,
  id: 'desk-2',
  label: 'Mesa 5',
  x: 12,
  y: 9,
  occupant: { id: 'user-7', displayName: 'Ana' },
};

function fakeDesks(overrides: Partial<DeskAdminPort> = {}): DeskAdminPort {
  return {
    listDesks: vi.fn(async () => [LIBRE, OCUPADA]),
    createDesk: vi.fn(async () => LIBRE),
    updateDesk: vi.fn(async () => LIBRE),
    deleteDesk: vi.fn(async () => undefined),
    ...overrides,
  };
}

/** Un puerto que falla siempre con el mismo motivo, para probar la degradacion. */
function failingDesks(code: AdminErrorCode): DeskAdminPort {
  function fail(): never {
    throw new AdminError(code);
  }
  return {
    listDesks: vi.fn(fail),
    createDesk: vi.fn(fail),
    updateDesk: vi.fn(fail),
    deleteDesk: vi.fn(fail),
  };
}

/** El formulario de alta/edicion, acotado para no chocar con la tabla. */
function formulario() {
  return within(screen.getByRole('form', { name: /escritorio/i }));
}

async function crear(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  x: string,
  y: string,
) {
  const form = formulario();
  await user.type(form.getByLabelText(/etiqueta/i), label);
  await user.clear(form.getByLabelText(/^x$/i));
  await user.type(form.getByLabelText(/^x$/i), x);
  await user.clear(form.getByLabelText(/^y$/i));
  await user.type(form.getByLabelText(/^y$/i), y);
  await user.click(form.getByRole('button', { name: /crear/i }));
}

/** La fila de la tabla cuyo encabezado es `label`. */
function fila(label: string) {
  return within(screen.getByRole('row', { name: new RegExp(label) }));
}

describe('DesksPanel: lo que se ve', () => {
  it('mientras no sabe que hay no pinta nada', () => {
    // Mismo criterio que `AuthGate` y que `DashboardScreen`: un cargador que
    // parpadea unos milisegundos molesta mas de lo que informa.
    const desks = fakeDesks({ listDesks: vi.fn(() => new Promise<AdminDesk[]>(() => {})) });

    const { container } = render(<DesksPanel desks={desks} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('dice cuales estan libres y quien esta en los demas', async () => {
    render(<DesksPanel desks={fakeDesks()} />);

    expect(await screen.findByText('Mesa 4')).toBeInTheDocument();
    expect(fila('Mesa 4').getByText(/libre/i)).toBeInTheDocument();
    // El nombre del ocupante es para ETIQUETAR: es lo unico que quien
    // administra puede cruzar con la persona que tiene delante.
    expect(fila('Mesa 5').getByText(/ana/i)).toBeInTheDocument();
  });

  it('pinta la posicion en casillas, que es lo que se escribe para moverlo', async () => {
    render(<DesksPanel desks={fakeDesks()} />);

    expect(await screen.findByText('Mesa 4')).toBeInTheDocument();
    expect(fila('Mesa 4').getByText(/6.*9/)).toBeInTheDocument();
  });

  it('un ocupante sin nombre visible no se inventa uno', async () => {
    const sinNombre = { ...OCUPADA, occupant: { id: 'user-7', displayName: null } };
    render(<DesksPanel desks={fakeDesks({ listDesks: vi.fn(async () => [sinNombre]) })} />);

    expect(await screen.findByText('Mesa 5')).toBeInTheDocument();
    // Ocupado sigue siendo ocupado: decir "Libre" ofreceria un sitio que no lo
    // esta, y poner el uuid no le dice nada a quien administra.
    expect(fila('Mesa 5').queryByText(/^libre$/i)).not.toBeInTheDocument();
    expect(fila('Mesa 5').queryByText('user-7')).not.toBeInTheDocument();
  });

  it('sin escritorios lo dice, en vez de una tabla con encabezados y nada mas', async () => {
    render(<DesksPanel desks={fakeDesks({ listDesks: vi.fn(async () => []) })} />);

    expect(await screen.findByText(/todavía no hay escritorios/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    // El formulario sigue: una oficina sin escritorios es justo donde hace
    // falta poder colocar el primero.
    expect(screen.getByRole('form', { name: /escritorio/i })).toBeInTheDocument();
  });

  it('no ofrece sentar a nadie, porque el servidor no tiene esa ruta', async () => {
    render(<DesksPanel desks={fakeDesks()} />);
    await screen.findByText('Mesa 4');

    // Quien administra decide CUANTOS escritorios hay y DONDE estan, no quien
    // se sienta en cual. Ofrecerlo seria ofrecer algo que acabaria en 400.
    expect(screen.queryByLabelText(/ocupante|asignar|sentar/i)).not.toBeInTheDocument();
    expect(fila('Mesa 5').queryByRole('button', { name: /levantar|liberar|echar/i })).toBeNull();
  });
});

describe('DesksPanel: colocar y mover', () => {
  it('crea con la etiqueta y las coordenadas escritas, y relee la lista', async () => {
    const user = userEvent.setup();
    const desks = fakeDesks();
    render(<DesksPanel desks={desks} />);
    await screen.findByText('Mesa 4');

    await crear(user, 'Mesa 6', '18', '3');

    expect(desks.createDesk).toHaveBeenCalledWith({ label: 'Mesa 6', x: 18, y: 3 });
    // Se relee entera en vez de parchear en local: el servidor es el dueno del
    // estado y otra persona puede estar administrando el mismo panel.
    await waitFor(() => expect(desks.listDesks).toHaveBeenCalledTimes(2));
  });

  it('tras crear, el formulario se vacia para colocar el siguiente', async () => {
    const user = userEvent.setup();
    render(<DesksPanel desks={fakeDesks()} />);
    await screen.findByText('Mesa 4');

    await crear(user, 'Mesa 6', '18', '3');

    await waitFor(() => expect(formulario().getByLabelText(/etiqueta/i)).toHaveValue(''));
  });

  it('un solape dice que chocan las coordenadas, no "algo salió mal"', async () => {
    const user = userEvent.setup();
    const desks = fakeDesks({
      createDesk: vi.fn(async () => {
        throw new AdminError('desk-overlap');
      }),
    });
    render(<DesksPanel desks={desks} />);
    await screen.findByText('Mesa 4');

    await crear(user, 'Mesa 6', '7', '9');

    const aviso = await screen.findByRole('alert');
    expect(aviso).toHaveTextContent(/chocan/i);
    expect(aviso).toHaveTextContent(/3×3/);
  });

  it('tras un fallo no se borra lo escrito', async () => {
    const user = userEvent.setup();
    const desks = fakeDesks({
      createDesk: vi.fn(async () => {
        throw new AdminError('desk-overlap');
      }),
    });
    render(<DesksPanel desks={desks} />);
    await screen.findByText('Mesa 4');

    await crear(user, 'Mesa 6', '7', '9');

    // Quien administra quiere corregir una coordenada, no volver a escribirlo
    // todo.
    await screen.findByRole('alert');
    expect(formulario().getByLabelText(/etiqueta/i)).toHaveValue('Mesa 6');
  });

  it('los campos de posicion declaran al navegador que son casillas enteras', async () => {
    render(<DesksPanel desks={fakeDesks()} />);

    for (const nombre of [/^x$/i, /^y$/i]) {
      const campo = await screen.findByLabelText(nombre);
      expect(campo).toHaveAttribute('type', 'number');
      expect(campo).toHaveAttribute('min', '0');
      expect(campo).toHaveAttribute('step', '1');
    }
  });

  it('una coordenada negativa no llega al servidor: el navegador corta antes', async () => {
    const user = userEvent.setup();
    const desks = fakeDesks();
    render(<DesksPanel desks={desks} />);
    await screen.findByText('Mesa 4');

    await crear(user, 'Mesa 6', '-3', '9');

    // `min=0` es validacion nativa: el formulario ni siquiera se envia.
    expect(desks.createDesk).not.toHaveBeenCalled();
  });

  it('saltandose la validacion nativa tampoco llega, y se explica', async () => {
    const user = userEvent.setup();
    const desks = fakeDesks();
    render(<DesksPanel desks={desks} />);
    await screen.findByText('Mesa 4');
    const form = formulario();
    await user.type(form.getByLabelText(/etiqueta/i), 'Mesa 6');
    await user.type(form.getByLabelText(/^x$/i), '-3');
    await user.type(form.getByLabelText(/^y$/i), '9');

    // Enviar el <form> directamente es exactamente lo que consigue cualquiera
    // quitando el atributo desde las herramientas del navegador: la guarda de
    // JavaScript existe para ese caso, y el servidor para cuando tambien se
    // salta esta.
    fireEvent.submit(screen.getByRole('form', { name: /escritorio/i }));

    expect(desks.createDesk).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(/casillas enteras/i);
  });

  it('renombrar manda solo la etiqueta, sin la posicion', async () => {
    const user = userEvent.setup();
    const desks = fakeDesks();
    render(<DesksPanel desks={desks} />);
    await screen.findByText('Mesa 4');

    await user.click(fila('Mesa 4').getByRole('button', { name: /editar/i }));
    const form = formulario();
    await user.clear(form.getByLabelText(/etiqueta/i));
    await user.type(form.getByLabelText(/etiqueta/i), 'Mesa 4 bis');
    await user.click(form.getByRole('button', { name: /guardar/i }));

    // Mandar tambien `x`/`y` devolveria el escritorio a la posicion que se
    // leyo si alguien lo movio mientras tanto.
    expect(desks.updateDesk).toHaveBeenCalledWith('desk-1', { label: 'Mesa 4 bis' });
  });

  it('mover manda las dos coordenadas juntas', async () => {
    const user = userEvent.setup();
    const desks = fakeDesks();
    render(<DesksPanel desks={desks} />);
    await screen.findByText('Mesa 4');

    await user.click(fila('Mesa 4').getByRole('button', { name: /editar/i }));
    const form = formulario();
    await user.clear(form.getByLabelText(/^x$/i));
    await user.type(form.getByLabelText(/^x$/i), '21');
    await user.click(form.getByRole('button', { name: /guardar/i }));

    // Media coordenada no es una posicion: el servidor rechaza `x` sin `y`.
    expect(desks.updateDesk).toHaveBeenCalledWith('desk-1', { x: 21, y: 9 });
  });

  it('editar carga el escritorio elegido y se puede dejar a medias', async () => {
    const user = userEvent.setup();
    render(<DesksPanel desks={fakeDesks()} />);
    await screen.findByText('Mesa 4');

    await user.click(fila('Mesa 5').getByRole('button', { name: /editar/i }));
    expect(formulario().getByLabelText(/etiqueta/i)).toHaveValue('Mesa 5');

    await user.click(formulario().getByRole('button', { name: /cancelar/i }));
    // Vuelve a ser el formulario de alta: quedarse en modo edicion sin decirlo
    // haria que el siguiente alta moviese un escritorio existente.
    expect(formulario().getByRole('button', { name: /crear/i })).toBeInTheDocument();
  });
});

describe('DesksPanel: quitar un escritorio', () => {
  it('pide confirmacion y dice lo que pasa de verdad con quien lo ocupa', async () => {
    const user = userEvent.setup();
    const desks = fakeDesks();
    render(<DesksPanel desks={desks} />);
    await screen.findByText('Mesa 5');

    await user.click(fila('Mesa 5').getByRole('button', { name: /eliminar/i }));

    // El servidor lo PERMITE: la ocupacion se va con la fila y esa persona se
    // queda sin sitio. Insinuar que esta bloqueado seria mentir sobre lo que
    // hace el boton.
    const aviso = fila('Mesa 5').getByText(/sin escritorio|sin sitio/i);
    expect(aviso).toBeInTheDocument();
    expect(aviso.textContent).not.toMatch(/no se puede|no está permitido|bloquead/i);
    expect(desks.deleteDesk).not.toHaveBeenCalled();
  });

  it('confirmado lo borra y relee la lista', async () => {
    const user = userEvent.setup();
    const desks = fakeDesks();
    render(<DesksPanel desks={desks} />);
    await screen.findByText('Mesa 4');

    await user.click(fila('Mesa 4').getByRole('button', { name: /eliminar/i }));
    await user.click(fila('Mesa 4').getByRole('button', { name: /sí, eliminar/i }));

    expect(desks.deleteDesk).toHaveBeenCalledWith('desk-1');
    await waitFor(() => expect(desks.listDesks).toHaveBeenCalledTimes(2));
  });

  it('cancelar no borra nada', async () => {
    const user = userEvent.setup();
    const desks = fakeDesks();
    render(<DesksPanel desks={desks} />);
    await screen.findByText('Mesa 4');

    await user.click(fila('Mesa 4').getByRole('button', { name: /eliminar/i }));
    await user.click(fila('Mesa 4').getByRole('button', { name: /cancelar/i }));

    expect(desks.deleteDesk).not.toHaveBeenCalled();
    expect(fila('Mesa 4').getByRole('button', { name: /eliminar/i })).toBeInTheDocument();
  });

  it('borrar algo que ya no esta no acusa a quien administra', async () => {
    const user = userEvent.setup();
    const desks = fakeDesks({
      deleteDesk: vi.fn(async () => {
        throw new AdminError('not-found');
      }),
    });
    render(<DesksPanel desks={desks} />);
    await screen.findByText('Mesa 4');

    await user.click(fila('Mesa 4').getByRole('button', { name: /eliminar/i }));
    await user.click(fila('Mesa 4').getByRole('button', { name: /sí, eliminar/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/ya no está/i);
  });
});

describe('DesksPanel: despliegues sin escritorios configurados', () => {
  it('un 503 explica el despliegue y no ofrece un formulario roto', async () => {
    // Sin `DATABASE_URL` no hay directorio: la oficina funciona igual, solo
    // que no hay donde sentarse. Es un estado legitimo, no una averia.
    render(<DesksPanel desks={failingDesks('desks-not-configured')} />);

    expect(await screen.findByText(/no están configurados/i)).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: /escritorio/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('un 503 no se grita: no hay nada roto que arreglar ahora', async () => {
    render(<DesksPanel desks={failingDesks('desks-not-configured')} />);

    await screen.findByText(/no están configurados/i);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('cualquier otro fallo de carga si se cuenta como fallo', async () => {
    render(<DesksPanel desks={failingDesks('network')} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo contactar/i);
  });
});
