/**
 * HTTP side of art contributions and their review (#122): pure handlers
 * returning `{ status, body }`, like `assetUploadRoutes.ts`, which they reuse
 * (same body format, checks, re-encoding and hash storage).
 *
 *   - `POST /me/art/contributions` (`authenticate`): anyone signed in
 *     contributes a character or a decor plant, with the rights statement
 *     accepted. It waits as `pending`.
 *   - `GET /me/art/contributions` (`authenticate`): the caller's own
 *     contributions with their state and, if rejected, the reason.
 *   - `GET /me/art/files/<sha256>.png` (`authenticate`): the preview of a
 *     file the caller may see (`canSeeArtFile`): their own, any for a
 *     reviewer, and anything public. Never cached by a shared cache.
 *   - `GET /admin/art/contributions?status=` (`authorize`): the review queue.
 *   - `POST /admin/art/contributions/:id/approve|reject` (`authorize`).
 *   - `POST /admin/art/pieces/:id/retire` (`authorize`): withdraws an
 *     approved character or plant.
 *
 * ## Pending is private, files included
 *
 * A pending or rejected piece is in no public read: `listArtPieces` returns
 * approved pieces only, so the uploads manifest, the character selector and
 * the decor catalog never see it, and the public immutable
 * `GET /assets/files/<sha256>.png` refuses a file no approved piece carries.
 * Its uploader and the reviewers see it through the authenticated route
 * above, the only one that serves it.
 *
 * ## Limits before storage
 *
 * The quota is checked twice: here, before any file is stored, so a user at
 * the limit costs no storage; and again in the adapter under a per-user lock,
 * which is the binding one under parallel uploads.
 */

import {
  ContributionLimitError,
  InvalidArtTransitionError,
  InvalidReviewNoteError,
  MAX_CONTRIBUTIONS_PER_HOUR,
  MAX_PENDING_CONTRIBUTIONS,
  ART_PIECE_STATUSES,
  assertContributionQuota,
  canSeeArtFile,
  isContributionKind,
  normalizeReviewNote,
  type ArtPieceStatus,
} from '../decor/artReviewRules.ts';
import { authenticate, authorize, NOT_FOUND, type AdminDeps, type AdminResult } from '../admin/adminRoutes.ts';
import { ART_PACK_DEFAULTS, ArtPieceExistsError } from '../decor/artCatalogRules.ts';
import type { ArtCatalogPiece, DecorCatalog } from '../decor/decorPort.ts';
import { AssetNameTakenError, InvalidAssetError } from '../decor/decorRules.ts';
import type { CharacterRetirement } from '../characterRetirement.ts';
import { AssetUploadError } from './assetImageRules.ts';
import { isAssetHash, type AssetStoragePort } from './assetStoragePort.ts';
import { ASSET_FILE_HEADERS, type AssetFileResult } from './assetUploadRoutes.ts';
import { decorAssetForPiece, prepareContribution } from './assetUploadRules.ts';

export interface ArtContributionDeps extends AdminDeps {
  decor: DecorCatalog;
  storage: AssetStoragePort;
  /**
   * Puts every live player wearing a retired character on the pack default
   * (#122). Absent, the persisted choice still changes and takes effect on
   * the next join.
   */
  characters?: CharacterRetirement;
}

/** A preview is the viewer's business only: no shared cache keeps it, no browser stores it. */
export const PRIVATE_ART_FILE_HEADERS: Readonly<Record<string, string>> = {
  ...ASSET_FILE_HEADERS,
  'Cache-Control': 'private, no-store',
};

function iso(date: Date | null): string | null {
  return date === null ? null : date.toISOString();
}

/** What the uploader and the reviewers see of a contribution. `piece` carries the files to preview. */
export function toContributionBody(piece: ArtCatalogPiece): Record<string, unknown> {
  return {
    id: piece.id,
    kind: piece.kind,
    name: piece.name,
    author: piece.author,
    status: piece.status,
    reviewNote: piece.reviewNote,
    submittedAt: piece.registeredAt.toISOString(),
    reviewedAt: iso(piece.reviewedAt),
    retiredAt: iso(piece.retiredAt),
    licenseAcceptedAt: iso(piece.licenseAcceptedAt),
    piece: piece.spec,
  };
}

function limitRefusal(error: ContributionLimitError): AdminResult {
  return { status: 429, body: { error: error.code } };
}

export async function handleSubmitContribution(authorization: unknown, body: unknown, deps: ArtContributionDeps): Promise<AdminResult> {
  const authenticated = await authenticate(authorization, deps);
  if (!authenticated.ok) return authenticated.result;
  // From the token, never the body: nobody contributes in another's name.
  const userId = authenticated.user.id;

  try {
    assertContributionQuota(await deps.decor.artContributionUsage(userId));
    const { piece, files } = prepareContribution(body);
    for (const file of files) await deps.storage.put(file.sha256, file.png);
    const submitted = await deps.decor.submitArtContribution({ piece, submittedBy: userId, decorAsset: decorAssetForPiece(piece) });
    return { status: 201, body: { contribution: toContributionBody(submitted) } };
  } catch (error) {
    if (error instanceof ContributionLimitError) return limitRefusal(error);
    if (error instanceof AssetUploadError) return { status: 400, body: { error: error.code, field: error.field } };
    if (error instanceof InvalidAssetError) return { status: 400, body: { error: 'invalid-metadata', field: 'name' } };
    if (error instanceof ArtPieceExistsError) return { status: 409, body: { error: 'asset-already-uploaded' } };
    if (error instanceof AssetNameTakenError) return { status: 409, body: { error: 'asset-name-taken' } };
    throw error;
  }
}

export async function handleListMyContributions(authorization: unknown, deps: ArtContributionDeps): Promise<AdminResult> {
  const authenticated = await authenticate(authorization, deps);
  if (!authenticated.ok) return authenticated.result;

  const userId = authenticated.user.id;
  const [pieces, usage] = await Promise.all([
    deps.decor.listUploadedArtPieces({ uploadedBy: userId }),
    deps.decor.artContributionUsage(userId),
  ]);
  return {
    status: 200,
    body: {
      contributions: pieces.map(toContributionBody),
      usage: { ...usage, maxPending: MAX_PENDING_CONTRIBUTIONS, maxPerHour: MAX_CONTRIBUTIONS_PER_HOUR },
    },
  };
}

/** `file` is the last path segment, like the public route: `<sha256>.png` and nothing else. */
export async function handleGetPrivateArtFile(authorization: unknown, file: unknown, deps: ArtContributionDeps): Promise<AssetFileResult | AdminResult> {
  const authenticated = await authenticate(authorization, deps);
  if (!authenticated.ok) return authenticated.result;

  if (typeof file !== 'string' || !file.endsWith('.png')) return NOT_FOUND;
  const sha256 = file.slice(0, -'.png'.length);
  if (!isAssetHash(sha256)) return NOT_FOUND;
  // A file the caller may not see is the same 404 as one that does not
  // exist: a 403 would confirm that somebody uploaded those pixels.
  const pieces = await deps.decor.findArtPiecesWithFile(sha256);
  if (!canSeeArtFile(authenticated.user, pieces)) return NOT_FOUND;
  const png = await deps.storage.get(sha256);
  if (png === null) return NOT_FOUND;
  return { status: 200, headers: PRIVATE_ART_FILE_HEADERS, png };
}

/** Who uploaded each piece, for the reviewer; one directory read per uploader. */
async function withUploaders(pieces: readonly ArtCatalogPiece[], deps: ArtContributionDeps): Promise<Record<string, unknown>[]> {
  const ids = [...new Set(pieces.map((piece) => piece.uploadedBy).filter((id): id is string => id !== null))];
  const users = new Map(await Promise.all(ids.map(async (id) => [id, await deps.directory.findById(id)] as const)));
  return pieces.map((piece) => {
    const uploader = piece.uploadedBy === null ? null : users.get(piece.uploadedBy);
    return {
      ...toContributionBody(piece),
      uploadedBy: uploader ? { id: uploader.id, name: uploader.displayName, email: uploader.email } : null,
    };
  });
}

export async function handleListReviewQueue(authorization: unknown, status: unknown, deps: ArtContributionDeps): Promise<AdminResult> {
  const authorized = await authorize(authorization, deps);
  if (!authorized.ok) return authorized.result;

  const wanted = status === undefined ? 'pending' : status;
  if (!(ART_PIECE_STATUSES as readonly unknown[]).includes(wanted)) return { status: 400, body: { error: 'invalid-request' } };
  const pieces = await deps.decor.listUploadedArtPieces({ status: wanted as ArtPieceStatus });
  return { status: 200, body: { contributions: await withUploaders(pieces, deps) } };
}

async function review(authorization: unknown, id: unknown, deps: ArtContributionDeps, decide: (reviewerId: string, piece: ArtCatalogPiece) => Promise<AdminResult>): Promise<AdminResult> {
  const authorized = await authorize(authorization, deps);
  if (!authorized.ok) return authorized.result;
  if (typeof id !== 'string') return NOT_FOUND;

  const piece = await deps.decor.findUploadedArtPiece(id);
  if (piece === null) return NOT_FOUND;
  try {
    return await decide(authorized.user.id, piece);
  } catch (error) {
    if (error instanceof InvalidArtTransitionError) return { status: 409, body: { error: 'already-reviewed' } };
    if (error instanceof AssetNameTakenError) return { status: 409, body: { error: 'asset-name-taken' } };
    throw error;
  }
}

export async function handleApproveContribution(authorization: unknown, id: unknown, deps: ArtContributionDeps): Promise<AdminResult> {
  return review(authorization, id, deps, async (reviewerId, piece) => {
    const reviewed = await deps.decor.reviewArtContribution({
      id: piece.id,
      reviewerId,
      decision: 'approve',
      note: null,
      decorAsset: decorAssetForPiece(piece.spec),
    });
    return reviewed === null ? NOT_FOUND : { status: 200, body: { contribution: toContributionBody(reviewed.piece) } };
  });
}

export async function handleRejectContribution(authorization: unknown, id: unknown, body: unknown, deps: ArtContributionDeps): Promise<AdminResult> {
  return review(authorization, id, deps, async (reviewerId, piece) => {
    let note: string;
    try {
      note = normalizeReviewNote((body as { reason?: unknown } | null)?.reason);
    } catch (error) {
      if (error instanceof InvalidReviewNoteError) return { status: 400, body: { error: 'invalid-review-note', field: 'reason' } };
      throw error;
    }
    const reviewed = await deps.decor.reviewArtContribution({ id: piece.id, reviewerId, decision: 'reject', note });
    return reviewed === null ? NOT_FOUND : { status: 200, body: { contribution: toContributionBody(reviewed.piece) } };
  });
}

/**
 * Withdraws an approved character or plant: the same "stops being offered,
 * whoever has it keeps it" as retiring a decor asset, except a character in
 * use, whose wearers go back to the pack default, persisted and live, so a
 * session never shows a piece that is gone. Desks and floors are not
 * withdrawn this way: a desk keeps its material for good (step 7).
 *
 * Retrying converges: an already retired piece is not audited again, but its
 * wearers are moved again, in case a first attempt stopped halfway.
 */
export async function handleRetireArtPiece(authorization: unknown, id: unknown, deps: ArtContributionDeps): Promise<AdminResult> {
  const authorized = await authorize(authorization, deps);
  if (!authorized.ok) return authorized.result;
  if (typeof id !== 'string') return NOT_FOUND;

  const piece = await deps.decor.findUploadedArtPiece(id);
  if (piece === null) return NOT_FOUND;
  if (!isContributionKind(piece.kind)) return { status: 409, body: { error: 'not-retirable' } };

  let retirement;
  try {
    retirement = await deps.decor.retireUploadedArtPiece({ id, actorId: authorized.user.id });
  } catch (error) {
    if (error instanceof InvalidArtTransitionError) return { status: 409, body: { error: 'not-approved' } };
    throw error;
  }
  if (retirement === null) return NOT_FOUND;

  let usersReset = 0;
  if (piece.kind === 'character') {
    usersReset = await deps.directory.reassignAvatar(id, ART_PACK_DEFAULTS.character);
    deps.characters?.retireCharacter(id, ART_PACK_DEFAULTS.character);
  }
  return { status: 200, body: { contribution: toContributionBody(retirement.piece), changed: retirement.changed, usersReset } };
}
