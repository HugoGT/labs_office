/**
 * HTTP adapter of `ArtReviewPort` (#122): the review queue under `/admin/art`
 * and the private previews it shows, read like the contributor's own.
 */

import { artFileRequest, parseContribution } from './artContributionClient';
import type { ContributionStatus } from './artContributionPort';
import type { ArtReviewPort } from './artReviewPort';
import { createOfficeAdminRequest, jsonBody, type OfficeAdminRequestOptions } from './officeAdminRequest';

export interface ArtReviewClientOptions {
  baseUrl: string;
  getIdToken: () => Promise<string | null>;
}

export function createArtReviewClient({ baseUrl, getIdToken }: ArtReviewClientOptions, fetchImpl: typeof fetch = fetch): ArtReviewPort {
  const options: OfficeAdminRequestOptions = {
    baseUrl,
    getIdToken,
    notConfigured: 'asset-upload-not-configured',
    conflicts: ['already-reviewed', 'asset-name-taken', 'not-retirable', 'not-approved'],
  };
  const request = createOfficeAdminRequest(options, fetchImpl);
  const contributionAt = async (path: string, body: unknown) =>
    parseContribution((await request<{ contribution: unknown }>(path, jsonBody(body))).contribution);

  return {
    async list(status: ContributionStatus) {
      const body = await request<{ contributions: unknown[] }>(`/admin/art/contributions?status=${status}`);
      return (body.contributions ?? []).map(parseContribution);
    },
    approve: (id) => contributionAt(`/admin/art/contributions/${encodeURIComponent(id)}/approve`, {}),
    reject: (id, reason) => contributionAt(`/admin/art/contributions/${encodeURIComponent(id)}/reject`, { reason }),
    async retire(id) {
      const body = await request<{ contribution: unknown; usersReset: number }>(`/admin/art/pieces/${encodeURIComponent(id)}/retire`, jsonBody({}));
      return { contribution: parseContribution(body.contribution), usersReset: Number(body.usersReset ?? 0) };
    },
    fileDataUrl: artFileRequest(options, fetchImpl),
  };
}
