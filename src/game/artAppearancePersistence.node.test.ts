/**
 * Key test of art migration step 7: a desk created with a chosen material
 * and color keeps that exact look after the server restarts, as seen by
 * another person. Rooms have no floor of their own since #182: they show the
 * painted terrain.
 *
 * Real processes in all but the store: the creation goes through the admin
 * adapters the office sidebar uses, the read through the clients the office
 * draws from, over HTTP against `createOfficeServer`. The two servers share
 * one set of memory adapters, which is what a restart over the same database
 * looks like from the routes; `pgDesks` stores the same fields, as its own
 * tests check.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createOfficeServer, type OfficeServer } from '../../server/src/createOfficeServer.ts';
import { readArtPackManifest } from '../../server/src/decor/artPackFile.ts';
import { createMemoryDecor } from '../../server/src/decor/memoryDecor.ts';
import { createMemoryDesks } from '../../server/src/desks/memoryDesks.ts';
import type { DirectoryUser } from '../../server/src/directory/directoryPort.ts';
import { createMemoryDirectory } from '../../server/src/directory/memoryDirectory.ts';
import { createMemorySpaces } from '../../server/src/spaces/memorySpaces.ts';
import type { IdTokenVerifier } from '../../server/src/verifyIdToken.ts';
import { createDeskAdminClient } from '../dashboard/deskAdminClient';
import { fetchOfficeDesks } from './desksClient';

function person(id: string, role: DirectoryUser['role']): DirectoryUser {
  return {
    id: `id-${id}`,
    uid: `uid-${id}`,
    email: `${id}@example.com`,
    displayName: id,
    role,
    status: 'active',
    expiresAt: null,
    invitedBy: null,
    avatarId: 'character-p01-burgundy-suit',
    avatarChosenAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

const verifier: IdTokenVerifier = {
  async verify(token: unknown) {
    if (typeof token !== 'string' || !token.startsWith('valido-')) return null;
    const uid = token.slice('valido-'.length);
    return { uid, email: `${uid.replace(/^uid-/, '')}@example.com`, name: null };
  },
};

const servers: OfficeServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.shutdown()));
});

describe('appearance chosen at creation survives a restart (art step 7)', () => {
  it('another person sees the same desk color after the server restarts', async () => {
    // The store outlives both servers, like the database does.
    const directory = createMemoryDirectory({ seed: [person('admin', 'admin'), person('bruno', 'employee')] });
    const decor = createMemoryDecor();
    await decor.registerArtPack(
      readArtPackManifest(new URL('../../public/assets/pack/manifest.json', import.meta.url)),
    );
    const spaces = createMemorySpaces();
    const desks = createMemoryDesks({ directory, decor, spaces: spaces.deskSpaces });

    async function start(): Promise<string> {
      const server = createOfficeServer({ auth: verifier, directory, decor, spaces, desks, identityAdmin: null });
      servers.push(server);
      return `http://localhost:${await server.listen(0)}`;
    }

    const first = await start();
    const asAdmin = { baseUrl: first, getIdToken: async () => 'valido-uid-admin' };
    const desk = await createDeskAdminClient(asAdmin).createDesk({
      label: 'Mesa roja',
      x: 2,
      y: 2,
      appearance: { materialId: 'desk-painted', color: '#C0392B' },
    });
    await Promise.all(servers.splice(0).map((server) => server.shutdown()));

    const second = await start();
    const officeDesks = await fetchOfficeDesks({ baseUrl: second, getIdToken: async () => 'valido-uid-bruno' });

    expect(officeDesks.find((row) => row.id === desk.id)?.appearance).toEqual({
      materialId: 'desk-painted',
      color: '#c0392b',
    });
  });
});
