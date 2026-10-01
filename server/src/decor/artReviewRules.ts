/**
 * Pure rules of art contributions and their review (#122). No SQL and no
 * HTTP: `memoryDecor`, `pgDecor` and the routes call these, so the limits,
 * the state machine and the visibility of a file are decided in one place.
 *
 * ## States
 *
 * A contribution starts `pending` and a reviewer moves it once, to
 * `approved` or `rejected`; a decision is final. Retiring is not a state: it
 * is the catalog's `retiredAt`, the same "stops being offered, whoever has it
 * keeps it" of every other piece, and only an approved piece was ever offered.
 * Pack pieces and Admin uploads (#121) are `approved` from the start.
 *
 * ## Limits
 *
 * At most `MAX_PENDING_CONTRIBUTIONS` waiting per user (rejected ones free
 * their slot) and `MAX_CONTRIBUTIONS_PER_HOUR` accepted submissions per user
 * in the last hour, counting every one, rejected or not: the hourly cap is
 * about storage and review load, which a rejection does not give back. The
 * adapters count both under a per-user lock, so two parallel uploads cannot
 * both take the last slot.
 */

import { canAdminister } from '../directory/accessDecision.ts';
import type { Role } from '../directory/directoryPort.ts';

export const ART_PIECE_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ArtPieceStatus = (typeof ART_PIECE_STATUSES)[number];

/** What a signed-in user may contribute: desks and floors stay the Admin's. */
export const CONTRIBUTION_KINDS = ['character', 'plant'] as const;
export type ContributionKind = (typeof CONTRIBUTION_KINDS)[number];

export const MAX_PENDING_CONTRIBUTIONS = 5;
export const MAX_CONTRIBUTIONS_PER_HOUR = 10;
export const CONTRIBUTION_QUOTA_WINDOW_MS = 60 * 60 * 1000;
export const MAX_REVIEW_NOTE_LENGTH = 200;

/**
 * The `license` column of a contribution. The contributor does not pick one:
 * they accept the rights statement of the form, stamped as
 * `licenseAcceptedAt`, and this names that grant.
 */
export const CONTRIBUTION_LICENSE = 'office-contribution';

/** Audit trail actions of the art catalog, next to the directory's in `audit_log`. */
export const ART_AUDIT_ACTIONS = ['upload-art', 'submit-art', 'approve-art', 'reject-art', 'retire-art'] as const;
export type ArtAuditAction = (typeof ART_AUDIT_ACTIONS)[number];

export type ContributionLimitCode = 'too-many-pending' | 'hourly-limit';

export class ContributionLimitError extends Error {
  readonly code: ContributionLimitCode;

  constructor(code: ContributionLimitCode, message: string) {
    super(message);
    this.name = 'ContributionLimitError';
    this.code = code;
  }
}

/** A move the state machine does not have. */
export class InvalidArtTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidArtTransitionError';
  }
}

export class InvalidReviewNoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidReviewNoteError';
  }
}

export interface ContributionUsage {
  /** Pieces of this user still waiting for a review. */
  pending: number;
  /** Submissions of this user accepted within the last `CONTRIBUTION_QUOTA_WINDOW_MS`. */
  lastHour: number;
}

export function isContributionKind(kind: unknown): kind is ContributionKind {
  return (CONTRIBUTION_KINDS as readonly unknown[]).includes(kind);
}

/** Throws `ContributionLimitError` when one more submission would break a limit. */
export function assertContributionQuota(usage: ContributionUsage): void {
  if (usage.pending >= MAX_PENDING_CONTRIBUTIONS) {
    throw new ContributionLimitError('too-many-pending', `at most ${MAX_PENDING_CONTRIBUTIONS} pending pieces per user`);
  }
  if (usage.lastHour >= MAX_CONTRIBUTIONS_PER_HOUR) {
    throw new ContributionLimitError('hourly-limit', `at most ${MAX_CONTRIBUTIONS_PER_HOUR} uploads per user per hour`);
  }
}

export type ReviewDecision = 'approve' | 'reject';

/** The status a review leaves behind. Throws for anything but a pending piece. */
export function reviewTransition(from: ArtPieceStatus, decision: ReviewDecision): ArtPieceStatus {
  if (from !== 'pending') throw new InvalidArtTransitionError(`a ${from} piece was already reviewed`);
  return decision === 'approve' ? 'approved' : 'rejected';
}

/**
 * Whether retiring changes anything. Retiring twice is harmless and only the
 * first time is audited, like revoking twice (#93); it also lets a retry run
 * the character reset again after a failure halfway.
 */
export function retireTransition(piece: { status: ArtPieceStatus; retiredAt: Date | null }): 'retire' | 'already-retired' {
  if (piece.status !== 'approved') throw new InvalidArtTransitionError(`a ${piece.status} piece was never offered`);
  return piece.retiredAt === null ? 'retire' : 'already-retired';
}

/** Same rank criterion as the rest of `/admin` (`canAdminister`). */
export function canReviewArt(role: Role): boolean {
  return canAdminister(role);
}

export function normalizeReviewNote(raw: unknown): string {
  const note = typeof raw === 'string' ? raw.trim() : '';
  if (note.length === 0 || note.length > MAX_REVIEW_NOTE_LENGTH) {
    throw new InvalidReviewNoteError(`a rejection needs a reason of 1 to ${MAX_REVIEW_NOTE_LENGTH} characters`);
  }
  return note;
}

/** The part of a catalog piece the file rules read. */
export interface ArtFileOwner {
  status: ArtPieceStatus;
  uploadedBy: string | null;
}

/**
 * A stored file is public (served immutable to anyone) only once an approved
 * piece carries it. Files are content-addressed, so the same pixels can sit
 * under a pending and an approved piece: the approved one makes them public.
 */
export function isPublicArtFile(pieces: readonly ArtFileOwner[]): boolean {
  return pieces.some((piece) => piece.status === 'approved');
}

/** The authenticated preview: public files, plus the viewer's own and, for reviewers, every one. */
export function canSeeArtFile(viewer: { id: string; role: Role }, pieces: readonly ArtFileOwner[]): boolean {
  if (pieces.length === 0) return false;
  if (isPublicArtFile(pieces) || canReviewArt(viewer.role)) return true;
  return pieces.some((piece) => piece.uploadedBy === viewer.id);
}
