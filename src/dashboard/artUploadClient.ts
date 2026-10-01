/**
 * HTTP adapter of `ArtUploadPort` (#121), on the shared authenticated request
 * of the other office admin clients. A refused file comes back as an
 * `AdminError` with its code and the file or field it is about.
 */

import type { ArtUploadInput, ArtUploadPort, UploadedArt } from './artUploadPort';
import { createOfficeAdminRequest, jsonBody } from './officeAdminRequest';

export interface ArtUploadClientOptions {
  /** The ROOT of the server (`resolveOfficeApiBaseUrl`), without `/admin`. */
  baseUrl: string;
  /** Called on EVERY request and never kept: see `officeAdminRequest.ts`. */
  getIdToken: () => Promise<string | null>;
}

interface UploadBody {
  piece: { id: string; kind: UploadedArt['kind']; name: string };
  asset: unknown;
}

export function createArtUploadClient(
  { baseUrl, getIdToken }: ArtUploadClientOptions,
  fetchImpl: typeof fetch = fetch,
): ArtUploadPort {
  const request = createOfficeAdminRequest(
    {
      baseUrl,
      getIdToken,
      notConfigured: 'asset-upload-not-configured',
      conflicts: ['asset-already-uploaded', 'asset-name-taken'],
    },
    fetchImpl,
  );

  return {
    async upload(input: ArtUploadInput): Promise<UploadedArt> {
      const { piece, asset } = await request<UploadBody>('/admin/assets/upload', jsonBody(input));
      return { id: piece.id, kind: piece.kind, name: piece.name, decor: asset !== null && asset !== undefined };
    },
  };
}
