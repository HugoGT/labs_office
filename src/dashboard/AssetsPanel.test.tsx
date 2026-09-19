import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminError, type AdminErrorCode } from './adminPort';
import type { AssetAdminPort, CatalogAsset } from './assetAdminPort';
import { AssetsPanel } from './AssetsPanel';

const PLANTA: CatalogAsset = {
  id: 'asset-1',
  slug: 'planta-de-interior',
  name: 'Planta de interior',
  kind: 'plant',
  textureKey: 'plant-small',
  w: 1,
  h: 1,
  placeableOnDesk: true,
  archivedAt: null,
};

const LAMPARA: CatalogAsset = {
  ...PLANTA,
  id: 'asset-2',
  slug: 'lampara',
  name: 'Lámpara',
  kind: 'decor',
  textureKey: 'lamp',
  placeableOnDesk: false,
};

function fakeAssets(overrides: Partial<AssetAdminPort> = {}): AssetAdminPort {
  return {
    listAssets: vi.fn(async () => [PLANTA, LAMPARA]),
    createAsset: vi.fn(async () => PLANTA),
    archiveAsset: vi.fn(async () => ({ ...PLANTA, archivedAt: '2026-09-19T10:00:00.000Z' })),
    ...overrides,
  };
}

function failingAssets(code: AdminErrorCode): AssetAdminPort {
  function fail(): never {
    throw new AdminError(code);
  }
  return {
    listAssets: vi.fn(fail),
    createAsset: vi.fn(fail),
    archiveAsset: vi.fn(fail),
  };
}

/** El formulario de alta, acotado para no chocar con la tabla. */
function formulario() {
  return within(screen.getByRole('form', { name: /pieza|catálogo/i }));
}

/** La fila de la tabla cuyo encabezado es `name`. */
function fila(name: string) {
  return within(screen.getByRole('row', { name: new RegExp(name) }));
}

async function anadir(user: ReturnType<typeof userEvent.setup>) {
  const form = formulario();
  await user.type(form.getByLabelText(/nombre/i), 'Taza');
  await user.selectOptions(form.getByLabelText(/tipo/i), 'decor');
  await user.type(form.getByLabelText(/textura/i), 'mug');
  await user.clear(form.getByLabelText(/ancho/i));
  await user.type(form.getByLabelText(/ancho/i), '1');
  await user.clear(form.getByLabelText(/alto/i));
  await user.type(form.getByLabelText(/alto/i), '1');
  await user.click(form.getByRole('button', { name: /añadir/i }));
}

describe('AssetsPanel: lo que se ve', () => {
  it('mientras no sabe que hay no pinta nada', () => {
    const assets = fakeAssets({ listAssets: vi.fn(() => new Promise<CatalogAsset[]>(() => {})) });

    const { container } = render(<AssetsPanel assets={assets} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('pinta cada pieza con su tipo, su textura y su tamano', async () => {
    render(<AssetsPanel assets={fakeAssets()} />);

    expect(await screen.findByText('Planta de interior')).toBeInTheDocument();
    expect(fila('Planta de interior').getByText('Planta')).toBeInTheDocument();
    // La clave del sprite se ensena tal cual: es lo unico que ata la fila con
    // algo que el bundle del cliente puede dibujar.
    expect(fila('Planta de interior').getByText('plant-small')).toBeInTheDocument();
    expect(fila('Planta de interior').getByText('1×1')).toBeInTheDocument();
    expect(fila('Lámpara').getByText('Decoración')).toBeInTheDocument();
  });

  it('dice cual se puede colocar en un escritorio y cual no', async () => {
    render(<AssetsPanel assets={fakeAssets()} />);

    await screen.findByText('Planta de interior');
    expect(fila('Planta de interior').getByText(/^sí$/i)).toBeInTheDocument();
    expect(fila('Lámpara').getByText(/^no$/i)).toBeInTheDocument();
  });

  it('sin piezas lo dice, en vez de una tabla con encabezados y nada mas', async () => {
    render(<AssetsPanel assets={fakeAssets({ listAssets: vi.fn(async () => []) })} />);

    expect(await screen.findByText(/todavía no hay piezas/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('no ofrece subir ninguna imagen: el catalogo es curado', async () => {
    const { container } = render(<AssetsPanel assets={fakeAssets()} />);
    await screen.findByText('Planta de interior');

    // Dar de alta una pieza es registrar un `textureKey` que el bundle YA
    // trae. No hay ruta que reciba un fichero, asi que un campo de subida
    // seria una promesa que nadie puede cumplir.
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByLabelText(/imagen|fichero|archivo|subir/i)).not.toBeInTheDocument();
  });

  it('no ofrece ver las retiradas, porque la ruta no sabe servirlas', async () => {
    render(<AssetsPanel assets={fakeAssets()} />);
    await screen.findByText('Planta de interior');

    // `handleListAssets` no lee `includeArchived` de ningun sitio: por HTTP
    // solo existe el catalogo vivo. Un control que prometiese el historico no
    // tendria de donde sacarlo.
    expect(screen.queryByRole('button', { name: /retiradas|archivadas|histórico/i })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /retiradas|archivadas/i })).toBeNull();
  });
});

describe('AssetsPanel: dar de alta', () => {
  it('manda los seis campos que el servidor lee, y relee la lista', async () => {
    const user = userEvent.setup();
    const assets = fakeAssets();
    render(<AssetsPanel assets={assets} />);
    await screen.findByText('Planta de interior');

    await anadir(user);

    // Ni `slug` ni `archivedAt`: el slug lo DERIVA el servidor del nombre y el
    // archivado es una decision suya.
    expect(assets.createAsset).toHaveBeenCalledWith({
      name: 'Taza',
      kind: 'decor',
      textureKey: 'mug',
      w: 1,
      h: 1,
      placeableOnDesk: true,
    });
    await waitFor(() => expect(assets.listAssets).toHaveBeenCalledTimes(2));
  });

  it('un nombre que no deja slug lo cuenta el servidor, y se explica', async () => {
    const user = userEvent.setup();
    const assets = fakeAssets({
      createAsset: vi.fn(async () => {
        throw new AdminError('invalid-request');
      }),
    });
    render(<AssetsPanel assets={assets} />);
    await screen.findByText('Planta de interior');

    await anadir(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(/no aceptó/i);
    // Tras un fallo no se borra lo escrito: se corrige un caracter.
    expect(formulario().getByLabelText(/nombre/i)).toHaveValue('Taza');
  });
});

describe('AssetsPanel: retirar del catalogo', () => {
  it('nunca llama borrar a lo que no borra', async () => {
    const user = userEvent.setup();
    const { container } = render(<AssetsPanel assets={fakeAssets()} />);
    await screen.findByText('Planta de interior');

    await user.click(fila('Planta de interior').getByRole('button', { name: /retirar/i }));

    // Retirar conserva la fila: quien ya la tenia puesta la sigue viendo. Un
    // "borrar" o un "eliminar" en cualquier parte de este panel contaria algo
    // que el servidor no hace.
    expect(container.textContent).not.toMatch(/borrar|eliminar|suprimir/i);
  });

  it('la confirmacion cuenta las tres mitades de lo que hace retirar', async () => {
    const user = userEvent.setup();
    const assets = fakeAssets();
    render(<AssetsPanel assets={assets} />);
    await screen.findByText('Planta de interior');

    await user.click(fila('Planta de interior').getByRole('button', { name: /retirar/i }));

    const aviso = fila('Planta de interior').getByText(/añadirse/i);
    // Las tres son ciertas a la vez y callar una convierte a las otras dos en
    // otra cosa. Deja de poder anadirse...
    expect(aviso).toHaveTextContent(/deja de poder añadirse|no.*(añadir|poner)/i);
    // ...quien ya la tenia puesta la sigue viendo...
    expect(aviso).toHaveTextContent(/sigue viendo|seguirá viendo/i);
    // ...y su dueno puede quitarla cuando quiera.
    expect(aviso).toHaveTextContent(/quitarla/i);
    expect(assets.archiveAsset).not.toHaveBeenCalled();
  });

  it('confirmado la retira y relee la lista', async () => {
    const user = userEvent.setup();
    const assets = fakeAssets();
    render(<AssetsPanel assets={assets} />);
    await screen.findByText('Planta de interior');

    await user.click(fila('Planta de interior').getByRole('button', { name: /retirar/i }));
    await user.click(fila('Planta de interior').getByRole('button', { name: /sí, retirar/i }));

    expect(assets.archiveAsset).toHaveBeenCalledWith('asset-1');
    // El servidor filtra las retiradas de la lista, asi que releer es lo que
    // hace que desaparezca del catalogo vivo.
    await waitFor(() => expect(assets.listAssets).toHaveBeenCalledTimes(2));
  });

  it('cancelar no retira nada', async () => {
    const user = userEvent.setup();
    const assets = fakeAssets();
    render(<AssetsPanel assets={assets} />);
    await screen.findByText('Planta de interior');

    await user.click(fila('Planta de interior').getByRole('button', { name: /retirar/i }));
    await user.click(fila('Planta de interior').getByRole('button', { name: /cancelar/i }));

    expect(assets.archiveAsset).not.toHaveBeenCalled();
  });

  it('retirar algo que ya no esta no acusa a quien administra', async () => {
    const user = userEvent.setup();
    const assets = fakeAssets({
      archiveAsset: vi.fn(async () => {
        throw new AdminError('not-found');
      }),
    });
    render(<AssetsPanel assets={assets} />);
    await screen.findByText('Planta de interior');

    await user.click(fila('Planta de interior').getByRole('button', { name: /retirar/i }));
    await user.click(fila('Planta de interior').getByRole('button', { name: /sí, retirar/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/ya no está/i);
  });
});

describe('AssetsPanel: despliegues sin catalogo configurado', () => {
  it('un 503 explica el despliegue y no ofrece un formulario roto', async () => {
    render(<AssetsPanel assets={failingAssets('decor-not-configured')} />);

    expect(await screen.findByText(/no está configurado/i)).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: /pieza|catálogo/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('un 503 no se grita: no hay nada roto que arreglar ahora', async () => {
    render(<AssetsPanel assets={failingAssets('decor-not-configured')} />);

    await screen.findByText(/no está configurado/i);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('cualquier otro fallo de carga si se cuenta como fallo', async () => {
    render(<AssetsPanel assets={failingAssets('network')} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudo contactar/i);
  });
});
