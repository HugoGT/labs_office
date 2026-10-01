/**
 * Review queue of art contributions (#122), for admins and the superadmin in
 * `/dashboard`. Types only; the adapter is `artReviewClient.ts`.
 */

import type { Contribution, ContributionStatus } from './artContributionPort';

export interface ArtRetirementResult {
  contribution: Contribution;
  /** Accounts that wore the retired character and now wear the pack default. */
  usersReset: number;
}

export interface ArtReviewPort {
  list(status: ContributionStatus): Promise<Contribution[]>;
  approve(id: string): Promise<Contribution>;
  reject(id: string, reason: string): Promise<Contribution>;
  /** Withdraws an approved character or plant from the catalog. */
  retire(id: string): Promise<ArtRetirementResult>;
  fileDataUrl(path: string): Promise<string>;
}
