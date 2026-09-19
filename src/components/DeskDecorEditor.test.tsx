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
 *   3. **Sin escritorio no hay editor.** Se ofrece coger uno, no una pantalla
 *      atada a nada.
 */

import { render, screen, within } from '@testing-library/react';
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
  const onClose = vi.fn();
  const props = {
    deskLabel: 'Mesa 4',
    catalog: [PLANTA, LAMPARA],
    items: [] as readonly PlacedDeskItem[],
    onSave,
    onClose,
    ...overrides,
  };
  render(<DeskDecorEditor {...props} />);
  return { onSave: props.onSave, onClose: props.onClose };
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

  it('sin escritorio propio ofrece coger uno y no pinta editor', () => {
    // Un editor atado a nada no tiene donde guardar: `/me/desk` escribe la
    // decoracion de la persona, pero sin sitio donde sentarse no se ve en
    // ninguna parte de la oficina.
    editor({ deskLabel: null, items: [] });

    expect(screen.queryByRole('button', { name: /^Caja \d/ })).not.toBeInTheDocument();
    expect(screen.getByText(/elige un escritorio libre/i)).toBeInTheDocument();
  });

  it('nombra el escritorio que se esta decorando', () => {
    editor();

    expect(screen.getByRole('dialog', { name: /Mesa 4/ })).toBeInTheDocument();
  });

  it('se puede cerrar sin guardar', async () => {
    const { onSave, onClose } = editor({ items: [PUESTA] });

    await userEvent.click(box(5));
    await userEvent.click(screen.getByRole('button', { name: /Quitar/ }));
    await userEvent.click(screen.getByRole('button', { name: /Cerrar/ }));

    expect(onClose).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('el selector solo ofrece lo que se puede colocar hoy', () => {
    // Llega ya filtrado (`fetchDeskCatalog`), y este componente no vuelve a
    // filtrarlo: dos filtros del mismo hecho acaban discrepando.
    editor();

    const picker = screen.getByRole('list', { name: /piezas/i });
    expect(within(picker).getAllByRole('button')).toHaveLength(2);
  });
});
