/**
 * HTTP adapter of `OfficeDecorPort` (#208), on the shared authenticated
 * request of the office admin clients. One adapter, two surfaces with one
 * body: "Decoración" writes anywhere through `POST /admin/decor` (admins),
 * and inside one's own desk through `POST /me/decor` (anyone). The
 * server decides which desk is one's own; the client never names it.
 */

import { createOfficeAdminRequest, jsonBody } from '../dashboard/officeAdminRequest';
import type { OfficeDecorPort } from './officeDecorPort';

export interface OfficeDecorClientOptions {
  /** The ROOT of the server (`resolveOfficeApiBaseUrl`), without `/admin`. */
  baseUrl: string;
  /** Called on EVERY request and never kept: see `officeAdminRequest.ts`. */
  getIdToken: () => Promise<string | null>;
  /** `office`: the whole map, admins only. `desk`: the caller's own desk. */
  scope: 'office' | 'desk';
}

export function createOfficeDecorClient(
  { baseUrl, getIdToken, scope }: OfficeDecorClientOptions,
  fetchImpl: typeof fetch = fetch,
): OfficeDecorPort {
  const request = createOfficeAdminRequest(
    {
      baseUrl,
      getIdToken,
      // The decor layer is stored with the terrain: without a directory there is neither.
      notConfigured: 'terrain-not-configured',
      // `desk-chair-limit`: a desk takes three chairs at most (`deskDecorRules.ts`).
      conflicts: ['terrain-under-placement', 'desk-chair-limit'],
      forbidden: ['no-desk', 'outside-desk'],
    },
    fetchImpl,
  );
  const path = scope === 'office' ? '/admin/decor' : '/me/decor';

  return {
    async setDecor(edits) {
      await request(path, jsonBody({ edits }));
    },
  };
}
