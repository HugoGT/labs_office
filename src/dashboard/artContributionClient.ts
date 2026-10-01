/**
 * HTTP adapter of `ArtContributionPort` (#122), on the shared authenticated
 * request of the office admin clients: the same token rule and the same
 * error codes, though these routes are the caller's own and not `/admin`.
 */

import type { ArtContributionPort, Contribution, ContributionInput, ContributionUsage } from './artContributionPort';
import { createOfficeAdminRequest, createOfficeFileRequest, jsonBody, type OfficeAdminRequestOptions } from './officeAdminRequest';

export interface ArtContributionClientOptions {
  /** The ROOT of the server (`resolveOfficeApiBaseUrl`). */
  baseUrl: string;
  /** Called on EVERY request and never kept: see `officeAdminRequest.ts`. */
  getIdToken: () => Promise<string | null>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The server's contribution body (`toContributionBody`), down to what the panels show. */
export function parseContribution(raw: unknown): Contribution {
  const row = isRecord(raw) ? raw : {};
  const piece = isRecord(row.piece) ? row.piece : {};
  const files = Array.isArray(piece.files) ? piece.files.filter(isRecord) : [];
  const uploader = isRecord(row.uploadedBy) ? row.uploadedBy : null;
  return {
    id: String(row.id),
    kind: String(row.kind),
    name: String(row.name),
    author: String(row.author),
    status: row.status === 'approved' || row.status === 'rejected' ? row.status : 'pending',
    reviewNote: typeof row.reviewNote === 'string' ? row.reviewNote : null,
    submittedAt: String(row.submittedAt),
    retiredAt: typeof row.retiredAt === 'string' ? row.retiredAt : null,
    files: files.map((file) => ({ role: String(file.role), path: String(file.path) })),
    uploadedBy:
      uploader === null
        ? null
        : { id: String(uploader.id), name: typeof uploader.name === 'string' ? uploader.name : null, email: String(uploader.email) },
  };
}

/** Both art clients read private files the same way, through `/me/art/files/`. */
export function artFileRequest(options: OfficeAdminRequestOptions, fetchImpl: typeof fetch): (path: string) => Promise<string> {
  const read = createOfficeFileRequest(options, fetchImpl);
  return (path) => read(`/me/art/files/${encodeURIComponent(path)}`);
}

export function createArtContributionClient(
  { baseUrl, getIdToken }: ArtContributionClientOptions,
  fetchImpl: typeof fetch = fetch,
): ArtContributionPort {
  const options: OfficeAdminRequestOptions = {
    baseUrl,
    getIdToken,
    notConfigured: 'asset-upload-not-configured',
    conflicts: ['asset-already-uploaded', 'asset-name-taken'],
  };
  const request = createOfficeAdminRequest(options, fetchImpl);

  return {
    async submit(input: ContributionInput) {
      const { contribution } = await request<{ contribution: unknown }>('/me/art/contributions', jsonBody(input));
      return parseContribution(contribution);
    },
    async listMine() {
      const body = await request<{ contributions: unknown[]; usage: ContributionUsage }>('/me/art/contributions');
      return { contributions: (body.contributions ?? []).map(parseContribution), usage: body.usage };
    },
    fileDataUrl: artFileRequest(options, fetchImpl),
  };
}
