/**
 * Las rutas de los escritorios (#7, slice 5), probadas como funciones puras y
 * sin montar Express, igual que `spacesRoutes.test.ts` y `decorRoutes.test.ts`.
 *
 * Hay tres propiedades que este fichero existe para fijar, y ninguna es una
 * comprobacion de forma:
 *
 *   1. **El ocupante es SIEMPRE el del token.** Ni un `occupantId` ni un
 *      `userId` del cuerpo pueden sentar o levantar a otra persona.
 *   2. **`GET /desks` exige credencial**, a diferencia de `GET /spaces`.
 *      Quien se sienta donde es informacion del directorio sobre gente real.
 *   3. **Quien administra NO reparte sitios.** El panel crea, mueve, renombra
 *      y borra escritorios; sentarse es cosa de cada quien.
 */

import { describe, expect, it } from 'vitest';
import { createMemoryDecor } from '../decor/memoryDecor.ts';
import type { DirectoryUser } from '../directory/directoryPort.ts';
import { createMemoryDirectory } from '../directory/memoryDirectory.ts';
import type { IdTokenVerifier } from '../verifyIdToken.ts';
import type { DeskDirectory } from './desksPort.ts';
import { createMemoryDesks } from './memoryDesks.ts';
import {
  handleClaimDesk,
  handleCreateDesk,
  handleDeleteDesk,
  handleListDesks,
  handleReleaseDesk,
  handleUpdateDesk,
  type DesksDeps,
} from './desksRoutes.ts';

const NOW = new Date('2026-02-01T10:00:00.000Z');

function user(overrides: Partial<DirectoryUser> & Pick<DirectoryUser, 'id' | 'uid'>): DirectoryUser {
  return {
    email: `${overrides.id}@example.com`,
    displayName: null,
    role: 'employee',
    status: 'active',
    expiresAt: null,
    invitedBy: null,
    createdAt: new Date('2025-12-01T00:00:00.000Z'),
    ...overrides,
  };
}

const ADMIN = user({ id: 'id-admin', uid: 'uid-admin', role: 'admin', displayName: 'Admin' });
const ANA = user({ id: 'id-ana', uid: 'uid-ana', displayName: 'Ana' });
const BRUNO = user({ id: 'id-bruno', uid: 'uid-bruno', displayName: 'Bruno' });
const CADUCADO = user({
  id: 'id-caducado',
  uid: 'uid-caducado',
  role: 'guest',
  expiresAt: new Date('2026-01-01T00:00:00.000Z'),
});

const verifier: IdTokenVerifier = {
  async verify(token: unknown) {
    const uid = typeof token === 'string' ? token.replace(/^valido-/, '') : null;
    if (uid === null || uid === token) return null;
    return { uid, email: `${uid}@example.com`, name: null };
  },
};

const BEARER_ADMIN = 'Bearer valido-uid-admin';
const BEARER_ANA = 'Bearer valido-uid-ana';
const BEARER_BRUNO = 'Bearer valido-uid-bruno';
const BEARER_CADUCADO = 'Bearer valido-uid-caducado';

interface Harness {
  deps: DesksDeps;
  desks: DeskDirectory;
}

/**
 * `seed` se puede sustituir para probar la unica propiedad que el nombre
 * visible NO puede dar: un RENOMBRADO es este mismo directorio devolviendo
 * otro `displayName` para el MISMO `id`.
 */
function harness(seed: DirectoryUser[] = [ADMIN, ANA, BRUNO, CADUCADO]): Harness {
  const directory = createMemoryDirectory({
    now: () => NOW,
    seed,
  });
  const decor = createMemoryDecor({ now: () => NOW });
  const desks = createMemoryDesks({ now: () => NOW, directory, decor });
  return {
    desks,
    deps: { directory, desks, auth: verifier, now: () => NOW, log: () => {} },
  };
}

describe('handleListDesks', () => {
  it('sin cabecera responde 401: quien se sienta donde NO es publico', async () => {
    // A diferencia de `GET /spaces`, que no publica nada que no este ya en el
    // bundle del cliente. Aqui lo que viaja son personas reales y su sitio.
    const { deps } = harness();

    expect((await handleListDesks(undefined, deps)).status).toBe(401);
  });

  it('una cuenta caducada tampoco la lee', async () => {
    const { deps } = harness();

    expect((await handleListDesks(BEARER_CADUCADO, deps)).status).toBe(401);
  });

  it('NO exige rol de administracion: cualquiera de la oficina la lee', async () => {
    const { deps } = harness();

    expect((await handleListDesks(BEARER_ANA, deps)).status).toBe(200);
  });

  it('una oficina sin escritorios responde una lista vacia, no un error', async () => {
    // Estado legitimo: nadie siembra escritorios.
    const { deps } = harness();

    expect(await handleListDesks(BEARER_ANA, deps)).toEqual({ status: 200, body: { desks: [] } });
  });

  it('cada escritorio viaja con su ocupante y la decoracion de ese ocupante', async () => {
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa 1', x: 4, y: 4 });
    await desks.claimDesk(desk.id, ANA.id);

    const result = await handleListDesks(BEARER_ANA, deps);

    expect(result.body.desks).toEqual([
      expect.objectContaining({
        id: desk.id,
        label: 'Mesa 1',
        x: 4,
        y: 4,
        occupant: { id: ANA.id, displayName: 'Ana', items: [] },
      }),
    ]);
  });

  it('el lado del escritorio viaja DERIVADO y no de una columna', async () => {
    // Un escritorio es 3x3 siempre. Viaja para que el cliente no tenga que
    // guardar su propia copia del 3, que es como dos numeros que deberian ser
    // el mismo acaban discrepando.
    const { deps, desks } = harness();
    await desks.createDesk({ label: 'Mesa 1', x: 0, y: 0 });

    const result = await handleListDesks(BEARER_ANA, deps);

    expect(result.body.desks).toEqual([expect.objectContaining({ w: 3, h: 3 })]);
  });

  it('un escritorio libre viaja con occupant null', async () => {
    const { deps, desks } = harness();
    await desks.createDesk({ label: 'Mesa 1', x: 0, y: 0 });

    const result = await handleListDesks(BEARER_ANA, deps);

    expect((result.body.desks as { occupant: unknown }[])[0].occupant).toBeNull();
  });

  it('NO publica createdAt ni updatedAt: no dicen nada para pintar la oficina', async () => {
    const { deps, desks } = harness();
    await desks.createDesk({ label: 'Mesa 1', x: 0, y: 0 });

    const result = await handleListDesks(BEARER_ANA, deps);

    expect((result.body.desks as Record<string, unknown>[])[0]).not.toHaveProperty('createdAt');
    expect((result.body.desks as Record<string, unknown>[])[0]).not.toHaveProperty('updatedAt');
  });

  /**
   * Cual de estos escritorios es el de quien pregunta (#7, slice 5).
   *
   * Lo contesta el SERVIDOR y no el cliente, y esa es toda la razon de que
   * este campo exista. El cliente no tiene con que averiguarlo: `occupantId`
   * no viaja (ver la prueba de aqui abajo, y la cabecera de `desksPort.ts`) y
   * el unico cruce que le queda seria el nombre visible. Comparar nombres es
   * exactamente lo que la slice 1 de esta misma issue retiro de
   * `proximityAudio.ts` -- alli decidia quien oye a quien y un renombrado lo
   * cambiaba en silencio. Reintroducirlo aqui haria que renombrar a alguien
   * cambiase de manos un escritorio en la pantalla.
   *
   * Lo que se publica es una RESPUESTA SOBRE QUIEN PREGUNTA, no un dato de
   * nadie mas: es la misma informacion que `/me/desk` ya le da, y ningun uuid
   * del directorio sale con ella.
   */
  it('marca como propio el escritorio de quien pregunta, y solo ese', async () => {
    const { deps, desks } = harness();
    const deAna = await desks.createDesk({ label: 'Mesa Ana', x: 0, y: 0 });
    const deBruno = await desks.createDesk({ label: 'Mesa Bruno', x: 4, y: 0 });
    await desks.claimDesk(deAna.id, ANA.id);
    await desks.claimDesk(deBruno.id, BRUNO.id);

    const result = await handleListDesks(BEARER_ANA, deps);

    expect(result.body.desks).toEqual([
      expect.objectContaining({ id: deAna.id, mine: true }),
      expect.objectContaining({ id: deBruno.id, mine: false }),
    ]);
  });

  it('la misma lista vista por otra persona mueve la marca a su escritorio', async () => {
    // Es la mitad que demuestra que la respuesta es sobre QUIEN PREGUNTA y no
    // una propiedad del escritorio: los mismos dos, el flag en el otro.
    const { deps, desks } = harness();
    const deAna = await desks.createDesk({ label: 'Mesa Ana', x: 0, y: 0 });
    const deBruno = await desks.createDesk({ label: 'Mesa Bruno', x: 4, y: 0 });
    await desks.claimDesk(deAna.id, ANA.id);
    await desks.claimDesk(deBruno.id, BRUNO.id);

    const result = await handleListDesks(BEARER_BRUNO, deps);

    expect(result.body.desks).toEqual([
      expect.objectContaining({ id: deAna.id, mine: false }),
      expect.objectContaining({ id: deBruno.id, mine: true }),
    ]);
  });

  it('un escritorio libre nunca es de nadie', async () => {
    // `mine` sale de `occupant_id`, no de la ausencia de ocupante: sin esta
    // prueba, un `occupantId === viewerId` con los dos a null marcaria como
    // propio TODO escritorio libre.
    const { deps, desks } = harness();
    await desks.createDesk({ label: 'Mesa 1', x: 0, y: 0 });

    const result = await handleListDesks(BEARER_ANA, deps);

    expect(result.body.desks).toEqual([expect.objectContaining({ occupant: null, mine: false })]);
  });

  it('renombrar a una persona no cambia de manos ningun escritorio', async () => {
    // La propiedad que el nombre visible no puede dar, y la razon de que este
    // campo lo calcule el servidor. Un renombrado es este mismo directorio
    // devolviendo otro `displayName` para el MISMO `id`: aqui Ana pasa a
    // llamarse como Bruno, que es el peor caso que un cruce por nombre podria
    // encontrarse.
    const renombrada = { ...ANA, displayName: 'Bruno' };
    const { deps, desks } = harness([ADMIN, renombrada, BRUNO, CADUCADO]);
    const deAna = await desks.createDesk({ label: 'Mesa Ana', x: 0, y: 0 });
    const deBruno = await desks.createDesk({ label: 'Mesa Bruno', x: 4, y: 0 });
    await desks.claimDesk(deAna.id, ANA.id);
    await desks.claimDesk(deBruno.id, BRUNO.id);

    const result = await handleListDesks(BEARER_ANA, deps);

    // Los dos se llaman igual en la pantalla y aun asi el suyo es el suyo.
    expect(result.body.desks).toEqual([
      expect.objectContaining({ id: deAna.id, mine: true }),
      expect.objectContaining({ id: deBruno.id, mine: false }),
    ]);
  });

  it('NO publica el occupantId suelto: el ocupante entero ya lo trae', async () => {
    // Dos formas de decir lo mismo en el mismo cuerpo invitan a que el cliente
    // use una cuando la otra dice algo distinto.
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa 1', x: 0, y: 0 });
    await desks.claimDesk(desk.id, ANA.id);

    const result = await handleListDesks(BEARER_ANA, deps);

    expect((result.body.desks as Record<string, unknown>[])[0]).not.toHaveProperty('occupantId');
  });
});

describe('handleCreateDesk', () => {
  it('sin cabecera responde 401', async () => {
    const { deps } = harness();

    expect((await handleCreateDesk(undefined, { label: 'Mesa', x: 0, y: 0 }, deps)).status).toBe(
      401,
    );
  });

  it('un empleado con token valido responde 403: el mobiliario lo pone quien administra', async () => {
    const { deps } = harness();

    expect((await handleCreateDesk(BEARER_ANA, { label: 'Mesa', x: 0, y: 0 }, deps)).status).toBe(
      403,
    );
  });

  it('la credencial se comprueba ANTES que el cuerpo', async () => {
    // Un 400 aqui le confirmaria a quien sondea que su peticion llego hasta la
    // logica. Mismo argumento que en `adminRoutes.ts`.
    const { deps } = harness();

    expect((await handleCreateDesk(undefined, 'nada de esto es un cuerpo', deps)).status).toBe(401);
    expect((await handleCreateDesk(BEARER_ANA, 'nada de esto es un cuerpo', deps)).status).toBe(403);
  });

  it('un admin crea el escritorio y recibe 201', async () => {
    const { deps } = harness();

    const result = await handleCreateDesk(BEARER_ADMIN, { label: 'Mesa 1', x: 4, y: 4 }, deps);

    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ label: 'Mesa 1', x: 4, y: 4, occupant: null });
  });

  it('coordenadas invalidas responden 400', async () => {
    const { deps } = harness();

    expect((await handleCreateDesk(BEARER_ADMIN, { label: 'Mesa', x: -1, y: 0 }, deps)).status).toBe(
      400,
    );
  });

  it('un cuerpo que no es un objeto responde 400', async () => {
    const { deps } = harness();

    expect((await handleCreateDesk(BEARER_ADMIN, [], deps)).status).toBe(400);
  });

  it('un escritorio encima de otro responde 409', async () => {
    const { deps, desks } = harness();
    await desks.createDesk({ label: 'Mesa 1', x: 0, y: 0 });

    const result = await handleCreateDesk(BEARER_ADMIN, { label: 'Mesa 2', x: 1, y: 1 }, deps);

    expect(result).toEqual({ status: 409, body: { error: 'desk-overlap' } });
  });

  it('un occupantId en el cuerpo NO sienta a nadie: crear no reparte sitios', async () => {
    const { deps } = harness();

    const result = await handleCreateDesk(
      BEARER_ADMIN,
      { label: 'Mesa 1', x: 0, y: 0, occupantId: ANA.id },
      deps,
    );

    expect(result.body).toMatchObject({ occupant: null });
  });
});

describe('handleUpdateDesk', () => {
  it('un empleado responde 403', async () => {
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa', x: 0, y: 0 });

    expect((await handleUpdateDesk(BEARER_ANA, desk.id, { label: 'Otra' }, deps)).status).toBe(403);
  });

  it('un admin renombra sin mover', async () => {
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Antes', x: 0, y: 0 });

    const result = await handleUpdateDesk(BEARER_ADMIN, desk.id, { label: 'Despues' }, deps);

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ id: desk.id, label: 'Despues', x: 0, y: 0 });
  });

  it('un admin lo mueve', async () => {
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa', x: 0, y: 0 });

    const result = await handleUpdateDesk(BEARER_ADMIN, desk.id, { x: 8, y: 9 }, deps);

    expect(result.body).toMatchObject({ x: 8, y: 9 });
  });

  it('coordenadas invalidas responden 400', async () => {
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa', x: 0, y: 0 });

    expect((await handleUpdateDesk(BEARER_ADMIN, desk.id, { x: 2.5, y: 0 }, deps)).status).toBe(400);
  });

  it('media coordenada responde 400', async () => {
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa', x: 0, y: 0 });

    expect((await handleUpdateDesk(BEARER_ADMIN, desk.id, { x: 4 }, deps)).status).toBe(400);
  });

  it('moverlo encima de otro responde 409', async () => {
    const { deps, desks } = harness();
    await desks.createDesk({ label: 'Mesa 1', x: 0, y: 0 });
    const segundo = await desks.createDesk({ label: 'Mesa 2', x: 8, y: 0 });

    const result = await handleUpdateDesk(BEARER_ADMIN, segundo.id, { x: 1, y: 0 }, deps);

    expect(result).toEqual({ status: 409, body: { error: 'desk-overlap' } });
  });

  it('un id que no existe responde 404', async () => {
    const { deps } = harness();

    expect((await handleUpdateDesk(BEARER_ADMIN, 'no-existe', { label: 'Mesa' }, deps)).status).toBe(
      404,
    );
  });

  it('un occupantId en el cuerpo NO levanta ni sienta a nadie', async () => {
    // La otra mitad de "quien administra no reparte sitios": ni al crear ni al
    // mover. Lo que no se lee no se puede olvidar de comprobar.
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa', x: 0, y: 0 });
    await desks.claimDesk(desk.id, ANA.id);

    const result = await handleUpdateDesk(
      BEARER_ADMIN,
      desk.id,
      { label: 'Mesa 2', occupantId: BRUNO.id },
      deps,
    );

    expect(result.status).toBe(200);
    expect((await desks.getDesk(desk.id))?.occupantId).toBe(ANA.id);
  });
});

describe('handleDeleteDesk', () => {
  it('un empleado responde 403', async () => {
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa', x: 0, y: 0 });

    expect((await handleDeleteDesk(BEARER_ANA, desk.id, deps)).status).toBe(403);
  });

  it('un admin lo borra', async () => {
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa', x: 0, y: 0 });

    expect(await handleDeleteDesk(BEARER_ADMIN, desk.id, deps)).toEqual({
      status: 200,
      body: { deleted: true },
    });
    expect(await desks.listDesks()).toEqual([]);
  });

  it('un id que no existe responde 404', async () => {
    const { deps } = harness();

    expect((await handleDeleteDesk(BEARER_ADMIN, 'no-existe', deps)).status).toBe(404);
  });

  it('borrarlo deja sin sitio a quien lo ocupaba, y esa persona puede coger otro', async () => {
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa 1', x: 0, y: 0 });
    const otro = await desks.createDesk({ label: 'Mesa 2', x: 8, y: 0 });
    await desks.claimDesk(desk.id, ANA.id);

    await handleDeleteDesk(BEARER_ADMIN, desk.id, deps);

    expect((await handleClaimDesk(BEARER_ANA, otro.id, deps)).status).toBe(200);
  });
});

describe('handleClaimDesk', () => {
  it('sin cabecera responde 401', async () => {
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa', x: 0, y: 0 });

    expect((await handleClaimDesk(undefined, desk.id, deps)).status).toBe(401);
  });

  it('una cuenta caducada no se sienta en ningun sitio', async () => {
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa', x: 0, y: 0 });

    expect((await handleClaimDesk(BEARER_CADUCADO, desk.id, deps)).status).toBe(401);
  });

  it('NO exige rol de administracion: el escritorio es de quien lo usa', async () => {
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa', x: 0, y: 0 });

    const result = await handleClaimDesk(BEARER_ANA, desk.id, deps);

    expect(result.status).toBe(200);
    expect((await desks.getDesk(desk.id))?.occupantId).toBe(ANA.id);
  });

  it('un escritorio que ya tiene otra persona responde 409', async () => {
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa', x: 0, y: 0 });
    await desks.claimDesk(desk.id, ANA.id);

    const result = await handleClaimDesk(BEARER_BRUNO, desk.id, deps);

    expect(result).toEqual({ status: 409, body: { error: 'desk-taken' } });
    expect((await desks.getDesk(desk.id))?.occupantId).toBe(ANA.id);
  });

  it('el 409 de ocupado NO se confunde con el de solape', async () => {
    // Se arreglan de formas distintas: uno eligiendo otro sitio y el otro
    // corrigiendo unas coordenadas. Un cuerpo comun obligaria al cliente a
    // adivinar cual de las dos cosas decirle a quien esta mirando.
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa', x: 0, y: 0 });
    await desks.claimDesk(desk.id, ANA.id);

    const ocupado = await handleClaimDesk(BEARER_BRUNO, desk.id, deps);
    const solapado = await handleCreateDesk(BEARER_ADMIN, { label: 'Otra', x: 1, y: 1 }, deps);

    expect(ocupado.body).not.toEqual(solapado.body);
  });

  it('pedir el que uno YA ocupa responde 200 y no 409', async () => {
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa', x: 0, y: 0 });
    await desks.claimDesk(desk.id, ANA.id);

    expect((await handleClaimDesk(BEARER_ANA, desk.id, deps)).status).toBe(200);
  });

  it('coger otro SUELTA el anterior', async () => {
    const { deps, desks } = harness();
    const viejo = await desks.createDesk({ label: 'Mesa 1', x: 0, y: 0 });
    const nuevo = await desks.createDesk({ label: 'Mesa 2', x: 8, y: 0 });
    await desks.claimDesk(viejo.id, ANA.id);

    await handleClaimDesk(BEARER_ANA, nuevo.id, deps);

    expect((await desks.getDesk(viejo.id))?.occupantId).toBeNull();
    expect((await desks.getDesk(nuevo.id))?.occupantId).toBe(ANA.id);
  });

  it('un id que no existe responde 404', async () => {
    const { deps } = harness();

    expect((await handleClaimDesk(BEARER_ANA, 'no-existe', deps)).status).toBe(404);
  });

  it('un id que no es una cadena responde 400', async () => {
    const { deps } = harness();

    expect((await handleClaimDesk(BEARER_ANA, 42, deps)).status).toBe(400);
  });

  it('el ocupante sale del TOKEN, y el cuerpo NI SIQUIERA llega hasta aqui', async () => {
    // La propiedad de seguridad de la slice. Estas rutas viven en una url
    // publica y cualquiera con un ID token valido puede llamarlas con curl. Si
    // el cuerpo pudiese decir a quien se sienta, "cada quien elige su sitio"
    // seria una costumbre del cliente y bastaria un id ajeno para sentar a
    // otra persona donde uno quisiera.
    //
    // No se valida un `occupantId` del cuerpo ni se compara con el del token:
    // el handler no RECIBE cuerpo, asi que no hay nada que olvidarse de
    // comprobar. Lo que fija esta asercion es justo eso -- el dia que alguien
    // le anada un parametro para leer algo del cuerpo, este test se cae.
    // `createOfficeServer.test.ts` lo comprueba ademas mandando uno de verdad.
    expect(handleClaimDesk).toHaveLength(3);

    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa', x: 0, y: 0 });
    await handleClaimDesk(BEARER_ANA, desk.id, deps);

    expect((await desks.getDesk(desk.id))?.occupantId).toBe(ANA.id);
  });
});

describe('handleReleaseDesk', () => {
  it('sin cabecera responde 401', async () => {
    const { deps } = harness();

    expect((await handleReleaseDesk(undefined, deps)).status).toBe(401);
  });

  it('NO exige rol de administracion', async () => {
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa', x: 0, y: 0 });
    await desks.claimDesk(desk.id, ANA.id);

    const result = await handleReleaseDesk(BEARER_ANA, deps);

    expect(result).toEqual({ status: 200, body: { released: true } });
    expect((await desks.getDesk(desk.id))?.occupantId).toBeNull();
  });

  it('soltar sin tener nada responde 200: es idempotente', async () => {
    const { deps } = harness();

    expect((await handleReleaseDesk(BEARER_ANA, deps)).status).toBe(200);
  });

  it('soltar dos veces tampoco es un error', async () => {
    const { deps, desks } = harness();
    const desk = await desks.createDesk({ label: 'Mesa', x: 0, y: 0 });
    await desks.claimDesk(desk.id, ANA.id);

    await handleReleaseDesk(BEARER_ANA, deps);

    expect((await handleReleaseDesk(BEARER_ANA, deps)).status).toBe(200);
  });

  it('quien suelta solo suelta LO SUYO, y el cuerpo no llega hasta aqui', async () => {
    // Misma razon que en el claim, y la mitad que mas duele si falta: un id
    // ajeno bastaria para echar a alguien de su sitio.
    expect(handleReleaseDesk).toHaveLength(2);

    const { deps, desks } = harness();
    const deAna = await desks.createDesk({ label: 'Mesa 1', x: 0, y: 0 });
    const deBruno = await desks.createDesk({ label: 'Mesa 2', x: 8, y: 0 });
    await desks.claimDesk(deAna.id, ANA.id);
    await desks.claimDesk(deBruno.id, BRUNO.id);

    await handleReleaseDesk(BEARER_ANA, deps);

    expect((await desks.getDesk(deBruno.id))?.occupantId).toBe(BRUNO.id);
    expect((await desks.getDesk(deAna.id))?.occupantId).toBeNull();
  });
});
