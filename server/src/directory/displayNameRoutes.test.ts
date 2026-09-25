/**
 * Rutas del nombre visible auto-elegido en login (#100), probadas como
 * funciones puras y sin montar Express, igual que `decorRoutes.test.ts`.
 *
 * `authenticate` y no `authorize`: elegir el propio nombre es de quien se
 * sienta, no de quien administra (D1). El `id` que se escribe sale SIEMPRE de
 * `authenticated.user.id`, nunca del cuerpo -- mismo argumento que
 * `decorRoutes.test.ts` hace para `/me/desk`.
 */

import { describe, expect, it } from 'vitest';
import type { DirectoryUser } from './directoryPort.ts';
import { createMemoryDirectory } from './memoryDirectory.ts';
import type { IdTokenVerifier } from '../verifyIdToken.ts';
import { handleGetDisplayName, handleSetDisplayName } from './displayNameRoutes.ts';
import type { AdminDeps } from '../admin/adminRoutes.ts';

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

const ANA = user({ id: 'id-ana', uid: 'uid-ana' });
const BEA = user({ id: 'id-bea', uid: 'uid-bea', displayName: 'Bea' });

const verifier: IdTokenVerifier = {
  async verify(token: unknown) {
    const uid = typeof token === 'string' ? token.replace(/^valido-/, '') : null;
    if (uid === null || uid === token) return null;
    return { uid, email: `${uid}@example.com`, name: null };
  },
};

const BEARER_ANA = 'Bearer valido-uid-ana';
const BEARER_BEA = 'Bearer valido-uid-bea';

function harness(): AdminDeps {
  return {
    directory: createMemoryDirectory({ seed: [ANA, BEA] }),
    auth: verifier,
  };
}

describe('handleGetDisplayName', () => {
  it('sin cabecera responde 401', async () => {
    const deps = harness();

    expect((await handleGetDisplayName(undefined, deps)).status).toBe(401);
  });

  it('devuelve el nombre guardado de quien pregunta', async () => {
    const deps = harness();

    const result = await handleGetDisplayName(BEARER_BEA, deps);

    expect(result).toEqual({ status: 200, body: { displayName: 'Bea' } });
  });

  it('sin nombre guardado devuelve null, no un error', async () => {
    const deps = harness();

    const result = await handleGetDisplayName(BEARER_ANA, deps);

    expect(result).toEqual({ status: 200, body: { displayName: null } });
  });
});

describe('handleSetDisplayName', () => {
  it('sin cabecera responde 401 y no llega a mirar el cuerpo', async () => {
    const deps = harness();

    expect((await handleSetDisplayName(undefined, { name: 'Ana Lopez' }, deps)).status).toBe(401);
  });

  it('un cuerpo sin name responde 400 invalid-display-name', async () => {
    const deps = harness();

    const result = await handleSetDisplayName(BEARER_ANA, {}, deps);

    expect(result).toEqual({ status: 400, body: { error: 'invalid-display-name' } });
  });

  it('un nombre vacio o solo espacio responde 400', async () => {
    const deps = harness();

    expect((await handleSetDisplayName(BEARER_ANA, { name: '   ' }, deps)).status).toBe(400);
  });

  it('un nombre de mas de 24 caracteres tras colapsar responde 400', async () => {
    const deps = harness();

    expect((await handleSetDisplayName(BEARER_ANA, { name: 'A'.repeat(25) }, deps)).status).toBe(400);
  });

  it('un nombre valido se guarda canonicalizado y se devuelve', async () => {
    const deps = harness();

    const result = await handleSetDisplayName(BEARER_ANA, { name: 'Ana   Lopez' }, deps);

    expect(result).toEqual({ status: 200, body: { displayName: 'Ana Lopez' } });
    expect((await deps.directory.findByUid('uid-ana'))?.displayName).toBe('Ana Lopez');
  });

  it('un nombre ya tomado por otra cuenta responde 409 display-name-taken', async () => {
    const deps = harness();

    const result = await handleSetDisplayName(BEARER_ANA, { name: 'bea' }, deps);

    expect(result).toEqual({ status: 409, body: { error: 'display-name-taken' } });
  });

  it('re-someter el propio nombre actual no es un conflicto', async () => {
    const deps = harness();

    const result = await handleSetDisplayName(BEARER_BEA, { name: 'Bea' }, deps);

    expect(result).toEqual({ status: 200, body: { displayName: 'Bea' } });
  });

  it('el id que se escribe sale del token, nunca de un id en el cuerpo', async () => {
    // Si el cuerpo pudiese decir a quien pertenece la escritura, bastaria un
    // id ajeno para renombrarle la cuenta a otra persona.
    const deps = harness();

    await handleSetDisplayName(BEARER_ANA, { name: 'Nombre Nuevo', id: 'id-bea' }, deps);

    expect((await deps.directory.findByUid('uid-ana'))?.displayName).toBe('Nombre Nuevo');
    expect((await deps.directory.findByUid('uid-bea'))?.displayName).toBe('Bea');
  });
});
