import { createOfficeServer, type OfficeServer } from './createOfficeServer.ts';
import { createMemoryDirectory } from './directory/memoryDirectory.ts';

let server: OfficeServer | undefined;

/** Node-only browser-test command: a real office server, no external infrastructure. */
export async function authoritativePositionServer(action: 'start' | 'state' | 'stop', sessionId = '') {
  if (action !== 'state') {
    await server?.shutdown();
    server = undefined;
  }
  if (action === 'start') {
    const directory = createMemoryDirectory({ bootstrapSuperadminEmail: 'ana@example.com' });
    await directory.resolveOnLogin({ uid: 'ana', email: 'ana@example.com', name: null });
    await directory.saveLastPosition('ana', { x: 300.5, y: 400.25 });
    server = createOfficeServer({
      directory, auth: { async verify() { return { uid: 'ana', email: 'ana@example.com', name: null }; } },
      spaces: null, desks: null, decor: null, terrain: null, collisions: null,
      egress: null, storage: null, assetStorage: null,
    });
    await server.listen(0);
  }
  return {
    endpoint: server ? `ws://localhost:${server.port()}` : '',
    position: server?.sessions.positionOf(sessionId) ?? null,
  };
}
