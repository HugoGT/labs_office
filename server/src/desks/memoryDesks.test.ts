/**
 * El adaptador en memoria de `DeskDirectory` (#7, slice 5).
 *
 * Estas pruebas son las MISMAS preguntas que `pgDesks.test.ts` le hace al
 * adaptador de Postgres, y estan escritas asi a proposito: si una pasase aqui
 * y fallase alli, una ruta probada contra memoria no diria nada sobre la misma
 * ruta corriendo contra la base de datos.
 *
 * Lo que este adaptador NO puede reproducir es el arbitraje real de la
 * concurrencia -- aqui no hay transaccion, solo un `Map` de un hilo. Por eso
 * la carrera se comprueba por su RESULTADO observable (el segundo en pedir un
 * escritorio ocupado recibe `DeskTakenError`) y no por su mecanismo, que es lo
 * que `pgDesks.test.ts` si afirma mirando el SQL.
 */

import { describe, expect, it } from 'vitest';
import { createMemoryDecor } from '../decor/memoryDecor.ts';
import type { Asset } from '../decor/decorPort.ts';
import { createMemoryDirectory } from '../directory/memoryDirectory.ts';
import type { DirectoryUser } from '../directory/directoryPort.ts';
import { DeskOverlapError, DeskTakenError, InvalidDeskError } from './deskRules.ts';
import { createMemoryDesks } from './memoryDesks.ts';

const NOW = new Date('2026-02-01T10:00:00.000Z');

function user(id: string, displayName: string | null): DirectoryUser {
  return {
    id,
    uid: `uid-${id}`,
    email: `${id}@example.com`,
    displayName,
    role: 'employee',
    status: 'active',
    expiresAt: null,
    invitedBy: null,
    createdAt: NOW,
  };
}

const ANA = user('id-ana', 'Ana');
const BRUNO = user('id-bruno', 'Bruno');

const PLANTA: Asset = {
  id: 'asset-planta',
  slug: 'planta',
  name: 'Planta',
  kind: 'plant',
  textureKey: 'plant-small',
  w: 1,
  h: 1,
  placeableOnDesk: true,
  archivedAt: null,
  createdAt: NOW,
};

function desks() {
  let counter = 0;
  return createMemoryDesks({
    now: () => NOW,
    newId: () => `desk-${++counter}`,
    directory: createMemoryDirectory({ now: () => NOW, seed: [ANA, BRUNO] }),
    decor: createMemoryDecor({ now: () => NOW, seed: [PLANTA] }),
  });
}

describe('memoryDesks: createDesk', () => {
  it('crea el escritorio con la etiqueta recortada y sin ocupante', async () => {
    const desk = await desks().createDesk({ label: '  Mesa 1 ', x: 4, y: 4 });

    expect(desk).toEqual({
      id: 'desk-1',
      label: 'Mesa 1',
      x: 4,
      y: 4,
      occupantId: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it('un escritorio nace LIBRE: crearlo no sienta a nadie', async () => {
    // El administrador decide donde hay mobiliario, no quien se sienta en el.
    const desk = await desks().createDesk({ label: 'Mesa 1', x: 0, y: 0 });

    expect(desk.occupantId).toBeNull();
  });

  it('rechaza una posicion invalida antes de tocar nada', async () => {
    await expect(desks().createDesk({ label: 'Mesa', x: -1, y: 0 })).rejects.toThrow(
      InvalidDeskError,
    );
  });

  it('rechaza un escritorio que se solapa con otro', async () => {
    const directory = desks();
    await directory.createDesk({ label: 'Mesa 1', x: 0, y: 0 });

    await expect(directory.createDesk({ label: 'Mesa 2', x: 1, y: 1 })).rejects.toThrow(
      DeskOverlapError,
    );
  });

  it('dos escritorios pegados borde con borde tambien chocan, igual que en Postgres', async () => {
    const directory = desks();
    await directory.createDesk({ label: 'Mesa 1', x: 0, y: 0 });

    await expect(directory.createDesk({ label: 'Mesa 2', x: 3, y: 0 })).rejects.toThrow(
      DeskOverlapError,
    );
    await expect(directory.createDesk({ label: 'Mesa 3', x: 4, y: 0 })).resolves.toBeDefined();
  });
});

describe('memoryDesks: listDesks', () => {
  it('lista vacia cuando la oficina no tiene escritorios todavia', async () => {
    // Estado legitimo, no una averia: nadie siembra escritorios.
    expect(await desks().listDesks()).toEqual([]);
  });

  it('ordena por (x, y, id), igual que pgDesks', async () => {
    const directory = desks();
    await directory.createDesk({ label: 'Lejos', x: 10, y: 0 });
    await directory.createDesk({ label: 'Cerca', x: 0, y: 0 });

    expect((await directory.listDesks()).map((desk) => desk.label)).toEqual(['Cerca', 'Lejos']);
  });
});

describe('memoryDesks: updateDesk', () => {
  it('renombra sin mover', async () => {
    const directory = desks();
    const desk = await directory.createDesk({ label: 'Antes', x: 0, y: 0 });

    const updated = await directory.updateDesk(desk.id, { label: 'Despues' });

    expect(updated).toMatchObject({ id: desk.id, label: 'Despues', x: 0, y: 0 });
  });

  it('mover un escritorio a donde el mismo estaba NO es un solape contra si mismo', async () => {
    const directory = desks();
    const desk = await directory.createDesk({ label: 'Mesa', x: 0, y: 0 });

    await expect(directory.updateDesk(desk.id, { x: 1, y: 0 })).resolves.toMatchObject({ x: 1 });
  });

  it('rechaza moverlo encima de otro', async () => {
    const directory = desks();
    await directory.createDesk({ label: 'Mesa 1', x: 0, y: 0 });
    const segundo = await directory.createDesk({ label: 'Mesa 2', x: 8, y: 0 });

    await expect(directory.updateDesk(segundo.id, { x: 1, y: 0 })).rejects.toThrow(
      DeskOverlapError,
    );
  });

  it('devuelve null si ese id no existe', async () => {
    expect(await desks().updateDesk('no-existe', { label: 'Mesa' })).toBeNull();
  });

  it('mover un escritorio NO levanta a quien lo ocupa', async () => {
    // El sitio es el mismo sitio aunque cambie de coordenadas: quien lo tenia
    // se mueve con el. Levantarle seria repartir sitios desde el panel.
    const directory = desks();
    const desk = await directory.createDesk({ label: 'Mesa', x: 0, y: 0 });
    await directory.claimDesk(desk.id, ANA.id);

    const updated = await directory.updateDesk(desk.id, { x: 5, y: 5 });

    expect(updated?.occupantId).toBe(ANA.id);
  });
});

describe('memoryDesks: deleteDesk', () => {
  it('borra de verdad y devuelve false la segunda vez', async () => {
    const directory = desks();
    const desk = await directory.createDesk({ label: 'Mesa', x: 0, y: 0 });

    expect(await directory.deleteDesk(desk.id)).toBe(true);
    expect(await directory.deleteDesk(desk.id)).toBe(false);
    expect(await directory.listDesks()).toEqual([]);
  });

  it('borrarlo deja SIN sitio a quien lo ocupaba, y esa persona puede coger otro', async () => {
    const directory = desks();
    const desk = await directory.createDesk({ label: 'Mesa 1', x: 0, y: 0 });
    const otro = await directory.createDesk({ label: 'Mesa 2', x: 8, y: 0 });
    await directory.claimDesk(desk.id, ANA.id);

    await directory.deleteDesk(desk.id);

    // Si la ocupacion sobreviviese al borrado, `desks_single_occupant` la
    // dejaria atrapada en un escritorio que ya no existe.
    await expect(directory.claimDesk(otro.id, ANA.id)).resolves.toMatchObject({
      occupantId: ANA.id,
    });
  });
});

describe('memoryDesks: claimDesk', () => {
  it('sienta a quien lo pide en un escritorio libre', async () => {
    const directory = desks();
    const desk = await directory.createDesk({ label: 'Mesa', x: 0, y: 0 });

    expect(await directory.claimDesk(desk.id, ANA.id)).toMatchObject({ occupantId: ANA.id });
  });

  it('el SEGUNDO que pide el mismo escritorio recibe DeskTakenError', async () => {
    // La propiedad de la slice. Por orden de llegada: quien llega tarde se
    // entera de que llego tarde, no se sienta encima del otro ni recibe un
    // exito silencioso que el cliente pintaria como suyo.
    const directory = desks();
    const desk = await directory.createDesk({ label: 'Mesa', x: 0, y: 0 });
    await directory.claimDesk(desk.id, ANA.id);

    await expect(directory.claimDesk(desk.id, BRUNO.id)).rejects.toThrow(DeskTakenError);
    expect((await directory.getDesk(desk.id))?.occupantId).toBe(ANA.id);
  });

  it('pedir el escritorio que uno YA ocupa es un exito sin efecto', async () => {
    // No es un conflicto contra uno mismo: un 409 aqui haria que reabrir la
    // pestana pareciese un error.
    const directory = desks();
    const desk = await directory.createDesk({ label: 'Mesa', x: 0, y: 0 });
    await directory.claimDesk(desk.id, ANA.id);

    await expect(directory.claimDesk(desk.id, ANA.id)).resolves.toMatchObject({
      occupantId: ANA.id,
    });
  });

  it('coger otro escritorio SUELTA el anterior', async () => {
    // Sin esto, `desks_single_occupant` rechazaria la peticion y esa persona
    // se quedaria atrapada justo en el sitio que queria dejar.
    const directory = desks();
    const viejo = await directory.createDesk({ label: 'Mesa 1', x: 0, y: 0 });
    const nuevo = await directory.createDesk({ label: 'Mesa 2', x: 8, y: 0 });
    await directory.claimDesk(viejo.id, ANA.id);

    await directory.claimDesk(nuevo.id, ANA.id);

    expect((await directory.getDesk(viejo.id))?.occupantId).toBeNull();
    expect((await directory.getDesk(nuevo.id))?.occupantId).toBe(ANA.id);
  });

  it('un intento fallido NO suelta el escritorio que ya se tenia', async () => {
    // El equivalente del ROLLBACK de `pgDesks`: quedarse sin el viejo y sin el
    // nuevo seria peor que no haber pedido nada.
    const directory = desks();
    const mio = await directory.createDesk({ label: 'Mesa 1', x: 0, y: 0 });
    const ajeno = await directory.createDesk({ label: 'Mesa 2', x: 8, y: 0 });
    await directory.claimDesk(mio.id, ANA.id);
    await directory.claimDesk(ajeno.id, BRUNO.id);

    await expect(directory.claimDesk(ajeno.id, ANA.id)).rejects.toThrow(DeskTakenError);

    expect((await directory.getDesk(mio.id))?.occupantId).toBe(ANA.id);
  });

  it('devuelve null si ese id no existe, y no suelta nada por el camino', async () => {
    const directory = desks();
    const mio = await directory.createDesk({ label: 'Mesa', x: 0, y: 0 });
    await directory.claimDesk(mio.id, ANA.id);

    expect(await directory.claimDesk('no-existe', ANA.id)).toBeNull();
    expect((await directory.getDesk(mio.id))?.occupantId).toBe(ANA.id);
  });
});

describe('memoryDesks: releaseDesk', () => {
  it('suelta lo que tenga esa persona', async () => {
    const directory = desks();
    const desk = await directory.createDesk({ label: 'Mesa', x: 0, y: 0 });
    await directory.claimDesk(desk.id, ANA.id);

    await directory.releaseDesk(ANA.id);

    expect((await directory.getDesk(desk.id))?.occupantId).toBeNull();
  });

  it('soltar sin tener nada NO es un error', async () => {
    await expect(desks().releaseDesk(ANA.id)).resolves.toBeUndefined();
  });

  it('soltar dos veces tampoco', async () => {
    const directory = desks();
    const desk = await directory.createDesk({ label: 'Mesa', x: 0, y: 0 });
    await directory.claimDesk(desk.id, ANA.id);

    await directory.releaseDesk(ANA.id);

    await expect(directory.releaseDesk(ANA.id)).resolves.toBeUndefined();
  });

  it('soltar el propio no toca el de nadie mas', async () => {
    const directory = desks();
    const deAna = await directory.createDesk({ label: 'Mesa 1', x: 0, y: 0 });
    const deBruno = await directory.createDesk({ label: 'Mesa 2', x: 8, y: 0 });
    await directory.claimDesk(deAna.id, ANA.id);
    await directory.claimDesk(deBruno.id, BRUNO.id);

    await directory.releaseDesk(ANA.id);

    expect((await directory.getDesk(deBruno.id))?.occupantId).toBe(BRUNO.id);
  });
});

describe('memoryDesks: listOfficeDesks', () => {
  it('un escritorio libre no tiene ocupante', async () => {
    const directory = desks();
    await directory.createDesk({ label: 'Mesa', x: 0, y: 0 });

    expect(await directory.listOfficeDesks()).toEqual([
      expect.objectContaining({ label: 'Mesa', occupant: null }),
    ]);
  });

  it('resuelve el nombre del ocupante: el cliente no tiene otra forma de casarlo con su avatar', async () => {
    const directory = desks();
    const desk = await directory.createDesk({ label: 'Mesa', x: 0, y: 0 });
    await directory.claimDesk(desk.id, ANA.id);

    const [office] = await directory.listOfficeDesks();

    expect(office.occupant).toMatchObject({ id: ANA.id, displayName: 'Ana' });
  });

  it('trae la decoracion del ocupante en la MISMA lectura', async () => {
    // Todo lo que hace falta para pintar la oficina en una llamada. Partirla
    // obligaria al cliente a cruzar dos listas y a decidir el que hacer cuando
    // lleguen desfasadas.
    const decor = createMemoryDecor({ now: () => NOW, seed: [PLANTA] });
    const directory = createMemoryDesks({
      now: () => NOW,
      directory: createMemoryDirectory({ now: () => NOW, seed: [ANA] }),
      decor,
    });
    const desk = await directory.createDesk({ label: 'Mesa', x: 0, y: 0 });
    await directory.claimDesk(desk.id, ANA.id);
    await decor.replaceDeskConfig(ANA.id, [{ assetId: PLANTA.id, slot: 8, rotation: 90 }]);

    const [office] = await directory.listOfficeDesks();

    expect(office.occupant?.items).toEqual([
      expect.objectContaining({ assetId: PLANTA.id, slot: 8, textureKey: 'plant-small' }),
    ]);
  });

  it('la decoracion SIGUE a la persona cuando se cambia de escritorio', async () => {
    // La propiedad del producto que sostiene el esquema: `user_desk_configs`
    // esta indexada por `user_id`, no por escritorio.
    const decor = createMemoryDecor({ now: () => NOW, seed: [PLANTA] });
    const directory = createMemoryDesks({
      now: () => NOW,
      directory: createMemoryDirectory({ now: () => NOW, seed: [ANA] }),
      decor,
    });
    const viejo = await directory.createDesk({ label: 'Mesa 1', x: 0, y: 0 });
    const nuevo = await directory.createDesk({ label: 'Mesa 2', x: 8, y: 0 });
    await directory.claimDesk(viejo.id, ANA.id);
    await decor.replaceDeskConfig(ANA.id, [{ assetId: PLANTA.id, slot: 0, rotation: 0 }]);

    await directory.claimDesk(nuevo.id, ANA.id);

    const office = await directory.listOfficeDesks();
    expect(office.find((desk) => desk.id === viejo.id)?.occupant).toBeNull();
    expect(office.find((desk) => desk.id === nuevo.id)?.occupant?.items).toHaveLength(1);
  });

  it('mantiene el mismo orden que listDesks', async () => {
    const directory = desks();
    await directory.createDesk({ label: 'Lejos', x: 10, y: 0 });
    await directory.createDesk({ label: 'Cerca', x: 0, y: 0 });

    expect((await directory.listOfficeDesks()).map((desk) => desk.label)).toEqual([
      'Cerca',
      'Lejos',
    ]);
  });
});
