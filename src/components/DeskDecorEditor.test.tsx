/**
 * El editor de decoracion del escritorio propio (#7, slice 6). Presentacional:
 * recibe el catalogo y lo ya puesto, y avisa hacia arriba con el escritorio
 * ENTERO -- que es lo que `POST /me/desk` lee.
 *
 * Tres propiedades sostienen este fichero:
 *
 *   1. **Una pieza retirada no desaparece de tu escritorio (D1b).** El
 *      selector deja de ofrecerla, pero la que ya tienes puesta sigue ahi, se
 *      puede quitar, y guardar cualquier otro cambio la conserva.
 *   2. **Una caja, una pieza.** El servidor rechaza dos piezas en el mismo
 *      slot con un 400; colocar sobre una caja ocupada sustituye.
 *   3. **Una mesa por escritorio, en un borde.** La mesa ocupa las tres
 *      cajas de su borde y nada mas puede ir encima (Editar espacios).
 *
 * Sin escritorio no hay editor: eso lo decide `MiEspacioPanel`, que lo monta.
 */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DESK_SLOT_COLUMNS } from '../game/deskLayout';
import type { DeskDecorAsset, PlacedDeskItem } from '../game/deskDecorPort';
import { DeskDecorEditor } from './DeskDecorEditor';

const PLANTA: DeskDecorAsset = {
  id: 'id-planta',
  name: 'Planta',
  kind: 'plant',
  textureKey: 'plant-small',
};

const LAMPARA: DeskDecorAsset = {
  id: 'id-lampara',
  name: 'Lámpara',
  kind: 'decor',
  textureKey: 'lamp',
};

const PUESTA: PlacedDeskItem = {
  id: 'id-item',
  assetId: 'id-planta',
  slot: 4,
  rotation: 0,
  textureKey: 'plant-small',
  name: 'Planta',
};

/** Una pieza cuyo asset ya no esta en el catalogo: retirada, pero puesta (D1b). */
const RETIRADA: PlacedDeskItem = {
  id: 'id-item-retirada',
  assetId: 'id-alfombra',
  slot: 0,
  rotation: 90,
  textureKey: 'rug',
  name: 'Alfombra vieja',
};

function editor(overrides: Partial<Parameters<typeof DeskDecorEditor>[0]> = {}) {
  const onSave = vi.fn().mockResolvedValue('saved');
  const props = {
    catalog: [PLANTA, LAMPARA],
    items: [] as readonly PlacedDeskItem[],
    onSave,
    ...overrides,
  };
  render(<DeskDecorEditor {...props} />);
  return { onSave: props.onSave };
}

/** La caja N-esima por su etiqueta accesible, que es como la nombra quien la usa. */
function box(number: number): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(`^Caja ${number}`) });
}

describe('DeskDecorEditor', () => {
  it('ofrece las nueve cajas del escritorio', () => {
    // Nueve y no otro numero: el area es de 3x3 tiles y el servidor valida
    // `slot` entre 0 y 8. Una caja de mas seria un 400 garantizado.
    editor();

    expect(screen.getAllByRole('button', { name: /^Caja \d/ })).toHaveLength(9);
  });

  it('reparte las cajas en las columnas que dice `deskLayout`, sin repetir el numero', () => {
    // El reparto por filas (0,1,2 arriba) es un CONTRATO con la escena, que
    // coloca cada pieza con `deskSlotRect`. Una segunda copia del 3 dejaria
    // esta rejilla transpuesta respecto al escritorio el dia que cambie el
    // lado del area, y el sintoma seria decoracion que se mueve sola.
    editor();

    expect(box(1).parentElement).toHaveStyle({
      gridTemplateColumns: `repeat(${DESK_SLOT_COLUMNS}, 1fr)`,
    });
  });

  it('pinta en su caja lo que ya estaba puesto', () => {
    editor({ items: [PUESTA] });

    // `slot` 4 es la caja del medio, la quinta contando desde 1.
    expect(box(5)).toHaveAccessibleName(/Planta/);
  });

  it('coloca la pieza elegida en la caja elegida', async () => {
    const { onSave } = editor();

    await userEvent.click(box(1));
    await userEvent.click(screen.getByRole('button', { name: /Planta/ }));
    await userEvent.click(screen.getByRole('button', { name: /Guardar/ }));

    expect(onSave).toHaveBeenCalledWith([{ assetId: 'id-planta', slot: 0, rotation: 0 }]);
  });

  it('sin caja elegida el selector no coloca nada a ciegas', async () => {
    // Colocar en "la primera libre" adivinaria donde quiere ponerla quien
    // mira, y el escritorio tiene nueve cajas justamente para que lo diga.
    editor();

    expect(screen.getByRole('button', { name: /Planta/ })).toBeDisabled();
  });

  it('colocar en una caja ocupada sustituye, no apila', async () => {
    // El servidor rechaza dos piezas en el mismo slot con un 400: apilar seria
    // ofrecer un error.
    const { onSave } = editor({ items: [PUESTA] });

    await userEvent.click(box(5));
    await userEvent.click(screen.getByRole('button', { name: /Lámpara/ }));
    await userEvent.click(screen.getByRole('button', { name: /Guardar/ }));

    expect(onSave).toHaveBeenCalledWith([{ assetId: 'id-lampara', slot: 4, rotation: 0 }]);
  });

  it('gira la pieza de la caja elegida en pasos de 90 grados', async () => {
    // Las cuatro que acepta el servidor y ninguna mas: 45 grados seria un 400.
    const { onSave } = editor({ items: [PUESTA] });

    await userEvent.click(box(5));
    await userEvent.click(screen.getByRole('button', { name: /Girar/ }));
    await userEvent.click(screen.getByRole('button', { name: /Guardar/ }));

    expect(onSave).toHaveBeenCalledWith([{ assetId: 'id-planta', slot: 4, rotation: 90 }]);
  });

  it('girar cuatro veces vuelve al principio', async () => {
    const { onSave } = editor({ items: [PUESTA] });
    await userEvent.click(box(5));

    const girar = screen.getByRole('button', { name: /Girar/ });
    for (let turn = 0; turn < 4; turn += 1) await userEvent.click(girar);
    await userEvent.click(screen.getByRole('button', { name: /Guardar/ }));

    expect(onSave).toHaveBeenCalledWith([{ assetId: 'id-planta', slot: 4, rotation: 0 }]);
  });

  it('quitar deja la caja vacia', async () => {
    const { onSave } = editor({ items: [PUESTA] });

    await userEvent.click(box(5));
    await userEvent.click(screen.getByRole('button', { name: /Quitar/ }));
    await userEvent.click(screen.getByRole('button', { name: /Guardar/ }));

    expect(onSave).toHaveBeenCalledWith([]);
  });

  it('una pieza retirada sigue en su caja aunque el selector ya no la ofrezca (D1b)', async () => {
    // ESTA es la propiedad. El selector se llena de `/assets`, que filtra lo
    // retirado, y el escritorio de `/me/desk`, que no. Cruzar las dos listas
    // para pintar borraria la pieza de la pantalla de su dueno, y el primer
    // guardado se la quitaria de verdad sin que hubiese pedido nada.
    const { onSave } = editor({ items: [RETIRADA, PUESTA] });

    expect(box(1)).toHaveAccessibleName(/Alfombra vieja/);
    expect(screen.queryByRole('button', { name: /^Alfombra vieja/ })).not.toBeInTheDocument();

    // Mover otra pieza conserva la retirada, con su hueco y su giro intactos.
    await userEvent.click(box(9));
    await userEvent.click(screen.getByRole('button', { name: /Lámpara/ }));
    await userEvent.click(screen.getByRole('button', { name: /Guardar/ }));

    expect(onSave).toHaveBeenCalledWith(
      expect.arrayContaining([{ assetId: 'id-alfombra', slot: 0, rotation: 90 }]),
    );
  });

  it('una pieza retirada se puede quitar (D1b)', async () => {
    // La otra mitad de la regla: se conserva y se puede quitar. Sin esto,
    // quien la tenga puesta se queda con ella para siempre.
    const { onSave } = editor({ items: [RETIRADA] });

    await userEvent.click(box(1));
    await userEvent.click(screen.getByRole('button', { name: /Quitar/ }));
    await userEvent.click(screen.getByRole('button', { name: /Guardar/ }));

    expect(onSave).toHaveBeenCalledWith([]);
  });

  it('cuenta que se guardo', async () => {
    editor({ items: [PUESTA] });

    await userEvent.click(screen.getByRole('button', { name: /Guardar/ }));

    expect(await screen.findByRole('status')).toHaveTextContent(/[Gg]uardad/);
  });

  it('un rechazo del servidor se cuenta como algo que corregir', async () => {
    // Un 400 lo provoca lo que se mando -- tipicamente una pieza que el
    // catalogo retiro mientras esta pantalla estaba abierta. Contarlo como
    // averia diria "vuelve a intentarlo" cuando hay que cambiar algo.
    const onSave = vi.fn().mockResolvedValue('rejected');
    editor({ onSave });

    await userEvent.click(screen.getByRole('button', { name: /Guardar/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/no.*acept|rechaz/i);
  });

  it('una averia al guardar no se cuenta como guardada', async () => {
    const onSave = vi.fn().mockResolvedValue('failed');
    editor({ onSave });

    await userEvent.click(screen.getByRole('button', { name: /Guardar/ }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('is a region of the panel that hosts it, not a dialog of its own', () => {
    editor();

    expect(screen.getByRole('region', { name: 'Decorar mi escritorio' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cerrar/ })).not.toBeInTheDocument();
  });

  it('el selector solo ofrece lo que se puede colocar hoy', () => {
    // Llega ya filtrado (`fetchDeskCatalog`), y este componente no vuelve a
    // filtrarlo: dos filtros del mismo hecho acaban discrepando.
    editor();

    const picker = screen.getByRole('list', { name: /piezas/i });
    expect(within(picker).getAllByRole('button')).toHaveLength(2);
  });
});

/**
 * El elemento arrastrable de una pieza del catalogo es su `<li>`, no el boton:
 * el boton esta deshabilitado mientras no haya caja elegida y un control
 * deshabilitado no dispara eventos de arrastre. Arrastrar dice el destino por
 * si mismo, asi que no depende de que se haya elegido caja antes.
 */
function piece(name: RegExp): HTMLElement {
  const picker = screen.getByRole('list', { name: /piezas/i });
  const found = within(picker)
    .getAllByRole('listitem')
    .find((item) => within(item).queryByRole('button', { name }) !== null);
  if (found === undefined) throw new Error(`No hay ninguna pieza ${String(name)} en el selector`);
  return found;
}

/**
 * `userEvent` no cubre el arrastre HTML5, asi que el gesto se compone a mano.
 * `dataTransfer` es un doble minimo: jsdom implementa `DataTransfer` a medias y
 * el componente solo escribe en el, nunca lo lee de vuelta.
 */
function drag(source: HTMLElement, target: HTMLElement): void {
  fireEvent.dragStart(source, { dataTransfer: { setData: vi.fn() } });
  fireEvent.dragOver(target);
  fireEvent.drop(target);
  fireEvent.dragEnd(source);
}

describe('DeskDecorEditor: credits (#122)', () => {
  it('names the author of a contributed piece next to it', () => {
    editor({ catalog: [{ ...PLANTA, author: 'Ana' }, LAMPARA] });

    expect(screen.getByText('de Ana')).toBeInTheDocument();
    expect(screen.queryAllByText(/^de /)).toHaveLength(1);
  });
});

describe('DeskDecorEditor: arrastrar y soltar', () => {
  it('arrastrar una pieza del catálogo hasta una caja la coloca ahí', async () => {
    const { onSave } = editor();

    drag(piece(/Planta/), box(1));

    expect(box(1)).toHaveAccessibleName(/Planta/);

    await userEvent.click(screen.getByRole('button', { name: /Guardar/ }));

    expect(onSave).toHaveBeenCalledWith([{ assetId: 'id-planta', slot: 0, rotation: 0 }]);
  });

  it('una pieza del catálogo se arrastra aunque no haya ninguna caja elegida', () => {
    // El boton sigue deshabilitado -- colocar a ciegas seguiria adivinando la
    // caja -- pero el gesto de arrastrar ya nombra el destino, asi que no tiene
    // que pedir que se elija una antes.
    editor();

    expect(screen.getByRole('button', { name: 'Planta' })).toBeDisabled();

    drag(piece(/Planta/), box(3));

    expect(box(3)).toHaveAccessibleName(/Planta/);
  });

  it('arrastrar de una caja ocupada a una vacía mueve la pieza', async () => {
    const { onSave } = editor({ items: [PUESTA] });

    drag(box(5), box(1));

    expect(box(1)).toHaveAccessibleName(/Planta/);
    expect(box(5)).toHaveAccessibleName(/vacía/);

    await userEvent.click(screen.getByRole('button', { name: /Guardar/ }));

    expect(onSave).toHaveBeenCalledWith([{ assetId: 'id-planta', slot: 0, rotation: 0 }]);
  });

  it('arrastrar sobre una caja ocupada intercambia las dos piezas con su giro', async () => {
    // ESTA es la propiedad del movimiento interno: sustituir destruiria en
    // silencio una pieza que su dueno ya habia colocado. El intercambio no
    // pierde nada y se deshace repitiendo el gesto.
    const { onSave } = editor({ items: [RETIRADA, PUESTA] });

    drag(box(1), box(5));

    expect(box(1)).toHaveAccessibleName(/Planta/);
    expect(box(5)).toHaveAccessibleName(/Alfombra vieja/);

    await userEvent.click(screen.getByRole('button', { name: /Guardar/ }));

    expect(onSave).toHaveBeenCalledWith([
      { assetId: 'id-planta', slot: 0, rotation: 0 },
      { assetId: 'id-alfombra', slot: 4, rotation: 90 },
    ]);
  });

  it('arrastrar una caja vacía no cambia nada', async () => {
    const { onSave } = editor({ items: [PUESTA] });

    drag(box(1), box(5));

    expect(box(1)).toHaveAccessibleName(/vacía/);
    expect(box(5)).toHaveAccessibleName(/Planta/);

    await userEvent.click(screen.getByRole('button', { name: /Guardar/ }));

    expect(onSave).toHaveBeenCalledWith([{ assetId: 'id-planta', slot: 4, rotation: 0 }]);
  });

  it('soltar una pieza sobre su propia caja no cambia nada', async () => {
    const { onSave } = editor({ items: [PUESTA] });

    drag(box(5), box(5));

    expect(box(5)).toHaveAccessibleName(/Planta/);

    await userEvent.click(screen.getByRole('button', { name: /Guardar/ }));

    expect(onSave).toHaveBeenCalledWith([{ assetId: 'id-planta', slot: 4, rotation: 0 }]);
  });

  it('arrastrar construye el borrador pero no guarda por sí solo', async () => {
    // El arrastre es una forma de colocar, no de confirmar: `POST /me/desk`
    // borra e inserta, y dispararlo con cada gesto escribiria el escritorio a
    // medio componer.
    const { onSave } = editor();

    drag(piece(/Planta/), box(2));

    expect(onSave).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /Guardar/ }));

    expect(onSave).toHaveBeenCalledWith([{ assetId: 'id-planta', slot: 1, rotation: 0 }]);
  });

  it('tras soltar, girar y quitar actúan sobre la caja de destino', async () => {
    // Quien acaba de mover una pieza la esta mirando: dejar elegida la caja de
    // origen haria que el siguiente "Girar" tocase otra cosa.
    const { onSave } = editor({ items: [PUESTA] });

    drag(box(5), box(2));
    await userEvent.click(screen.getByRole('button', { name: /Girar/ }));
    await userEvent.click(screen.getByRole('button', { name: /Guardar/ }));

    expect(onSave).toHaveBeenCalledWith([{ assetId: 'id-planta', slot: 1, rotation: 90 }]);
  });
});

const MESA_MADERA: DeskDecorAsset = { id: 'id-mesa-madera', name: 'Escritorio de madera', kind: 'furniture', textureKey: 'art:desk-wood:sheet' };
const MESA_VIDRIO: DeskDecorAsset = { id: 'id-mesa-vidrio', name: 'Escritorio de vidrio', kind: 'furniture', textureKey: 'art:desk-glass:sheet' };

describe('DeskDecorEditor: a table on one edge (Editar espacios)', () => {
  const catalog = [PLANTA, MESA_MADERA, MESA_VIDRIO];

  it('offers the tables apart from the pieces of the boxes', () => {
    editor({ catalog });

    const pieces = screen.getByRole('list', { name: /piezas/i });
    expect(within(pieces).getAllByRole('button').map((button) => button.textContent)).toEqual(['Planta']);
    const tables = screen.getByRole('list', { name: /mesas/i });
    expect(within(tables).getAllByRole('button').map((button) => button.textContent)).toEqual(['Escritorio de madera', 'Escritorio de vidrio']);
  });

  it('places the chosen table on an edge, covering its three boxes, and saves it on the middle one', async () => {
    const { onSave } = editor({ catalog });

    await userEvent.click(screen.getByRole('button', { name: 'Escritorio de vidrio' }));
    await userEvent.click(screen.getByRole('button', { name: 'Arriba' }));

    for (const number of [1, 2, 3]) {
      expect(box(number)).toHaveAccessibleName(`Caja ${number}: mesa (Escritorio de vidrio)`);
      expect(box(number)).toBeDisabled();
    }
    expect(box(5)).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Arriba' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(onSave).toHaveBeenCalledWith([{ assetId: 'id-mesa-vidrio', slot: 1, rotation: 180 }]);
  });

  it('moves the table to another edge and swaps its material in place', async () => {
    const { onSave } = editor({ catalog });

    await userEvent.click(screen.getByRole('button', { name: 'Abajo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Derecha' }));
    await userEvent.click(screen.getByRole('button', { name: 'Escritorio de vidrio' }));

    expect(box(7)).toBeEnabled();
    expect(box(9)).toHaveAccessibleName('Caja 9: mesa (Escritorio de vidrio)');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(onSave).toHaveBeenCalledWith([{ assetId: 'id-mesa-vidrio', slot: 5, rotation: 90 }]);
  });

  it('an edge with something on it cannot take the table', async () => {
    editor({ catalog, items: [PUESTA, { ...PUESTA, id: 'id-otra', slot: 6 }] });

    expect(screen.getByRole('button', { name: 'Izquierda' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Abajo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Arriba' })).toBeEnabled();
  });

  it('reads the placed table back, keeps it on save and lets it go', async () => {
    const placed: PlacedDeskItem = { id: 'id-item-mesa', assetId: 'id-mesa-madera', slot: 3, rotation: 270, textureKey: 'art:desk-wood:sheet', name: 'Escritorio de madera' };
    const { onSave } = editor({ catalog, items: [placed, PUESTA] });

    expect(box(1)).toHaveAccessibleName('Caja 1: mesa (Escritorio de madera)');
    expect(screen.getByRole('button', { name: 'Izquierda' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(onSave).toHaveBeenLastCalledWith([
      { assetId: 'id-planta', slot: 4, rotation: 0 },
      { assetId: 'id-mesa-madera', slot: 3, rotation: 270 },
    ]);

    await userEvent.click(screen.getByRole('button', { name: 'Quitar mesa' }));
    expect(box(1)).toHaveAccessibleName('Caja 1: vacía');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(onSave).toHaveBeenLastCalledWith([{ assetId: 'id-planta', slot: 4, rotation: 0 }]);
  });

  it('nothing is dropped on a table box', async () => {
    editor({ catalog });
    await userEvent.click(screen.getByRole('button', { name: 'Abajo' }));

    drag(piece(/Planta/), box(8));

    expect(box(8)).toHaveAccessibleName('Caja 8: mesa (Escritorio de madera)');
  });
});
