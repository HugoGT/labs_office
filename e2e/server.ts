/** Real-process topology fixture; never seeds or connects to a live database. */
import { createOfficeServer } from '../server/src/createOfficeServer.ts';
import { createMemoryDirectory } from '../server/src/directory/memoryDirectory.ts';
import { createMemorySpaces } from '../server/src/spaces/memorySpaces.ts';
import { createMemoryTerrain } from '../server/src/terrain/memoryTerrain.ts';
import { SPAWN_BLOCK_INDEX } from '../src/game/mapData.ts';
import { BASE_LAYOUT } from '../src/game/officeLayout.ts';
import { LEGACY_SEED_SPACES } from '../src/test/legacyOffice.ts';

const server = createOfficeServer({
  auth: null, directory: createMemoryDirectory(), spaces: createMemorySpaces({ seed: LEGACY_SEED_SPACES }),
  terrain: createMemoryTerrain(BASE_LAYOUT.blocks.map((material, index) => [index, index === SPAWN_BLOCK_INDEX ? material : 'grass'] as const)),
  desks: null, decor: null, collisions: null, identityAdmin: null, assetStorage: null,
  storage: null, egress: null,
  reconnectionWindowSeconds: 2,
});
await server.listen(Number(process.argv[2]));
