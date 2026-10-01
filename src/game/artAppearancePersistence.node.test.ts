/**
 * Key test of art migration step 7: a desk and a room created with a chosen
 * material and color keep that exact look after the server restarts, as seen
 * by another person.
 *
 * Real processes in all but the store: the creation goes through the admin
 * adapters the office sidebar uses, the read through the clients the office
 * draws from, over HTTP against `createOfficeServer`. The two servers share
 * one set of memory adapters, which is what a restart over the same database
 * looks like from the routes; `pgDesks`/`pgSpaces` store the same fields, as
 * their own tests check.
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
import { createSpacesAdminClient } from '../dashboard/spacesAdminClient';
import { fetchOfficeDesks } from './desksClient';
import { fetchSpacesConfig } from './spacesConfig';

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
  it('another person sees the same desk and floor colors after the server restarts', async () => {
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
    const room = await createSpacesAdminClient(asAdmin).createSpace({
      name: 'Sala azul',
      x: 20,
      y: 20,
      w: 4,
      h: 4,
      capacity: null,
      floor: { materialId: 'floor-plain', color: '#2c3e50' },
    });
    await Promise.all(servers.splice(0).map((server) => server.shutdown()));

    const second = await start();
    const officeDesks = await fetchOfficeDesks({ baseUrl: second, getIdToken: async () => 'valido-uid-bruno' });
    const config = await fetchSpacesConfig({ url: `${second}/spaces` });

    expect(officeDesks.find((row) => row.id === desk.id)?.appearance).toEqual({
      materialId: 'desk-painted',
      color: '#c0392b',
    });
    expect(config.spaces.find((row) => row.id === room.id)?.floor).toEqual({
      materialId: 'floor-plain',
      color: '#2c3e50',
    });
  });
});
