/**
 * HTTP adapter of the character chosen at the office entrance (art migration,
 * step 5). Pure handlers returning `{ status, body }`, the same contract as
 * `displayNameRoutes.ts`, so the rules are tested without Express.
 *
 * `authenticate` and not `authorize`: choosing one's own character belongs to
 * whoever sits in the office, not to whoever administers it.
 *
 * ## The row written always comes from the token
 *
 * Same reason as `/me/display-name`: anyone with a valid ID token can call
 * this by hand, so only `avatarId` is read from the body and the row is
 * `authenticated.user.id`.
 *
 * ## The catalog check lives here, before the port
 *
 * The adapters only check the shape of a character id (they have no catalog
 * at hand). Whether it exists, is a character and is not retired is
 * `resolveCharacterChoice`, run against the registered `art_pieces` rows
 * before anything is written. Retired pieces are listed too, so a retired id
 * is told apart from an unknown one.
 */

import { authenticate, type AdminDeps, type AdminResult } from '../admin/adminRoutes.ts';
import { ART_PACK_DEFAULTS, InvalidArtChoiceError, resolveCharacterChoice } from '../decor/artCatalogRules.ts';
import type { DecorCatalog } from '../decor/decorPort.ts';

export interface AvatarDeps extends AdminDeps {
  /** Only the catalog read: these routes never register or retire pieces. */
  decor: Pick<DecorCatalog, 'listArtPieces'>;
}

function invalidCharacter(reason: InvalidArtChoiceError['code']): AdminResult {
  return { status: 400, body: { error: 'invalid-character', reason } };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The caller's character and whether they ever chose it. `chosen: false` is
 * what makes the entrance show the selector even on a restored session: the
 * row still holds the pack default the migration backfilled.
 */
export async function handleGetAvatar(authorization: unknown, deps: AvatarDeps): Promise<AdminResult> {
  const authenticated = await authenticate(authorization, deps);
  if (!authenticated.ok) return authenticated.result;

  const { avatarId, avatarChosenAt } = authenticated.user;
  return { status: 200, body: { avatarId, chosen: avatarChosenAt !== null } };
}

export async function handleSetAvatar(
  authorization: unknown,
  body: unknown,
  deps: AvatarDeps,
): Promise<AdminResult> {
  const authenticated = await authenticate(authorization, deps);
  if (!authenticated.ok) return authenticated.result;

  // A missing id is rejected rather than handed to `resolveCharacterChoice`,
  // which would read it as "use the default": saving is an explicit choice.
  if (!isPlainObject(body) || typeof body.avatarId !== 'string' || body.avatarId.length === 0) {
    return invalidCharacter('unknown-piece');
  }

  let avatarId: string;
  try {
    const catalog = await deps.decor.listArtPieces({ includeRetired: true });
    avatarId = resolveCharacterChoice(catalog, ART_PACK_DEFAULTS, body.avatarId);
  } catch (error) {
    if (error instanceof InvalidArtChoiceError) return invalidCharacter(error.code);
    throw error;
  }

  try {
    const updated = await deps.directory.setAvatar(authenticated.user.id, avatarId);
    // Same impossible race as in `handleSetDisplayName`: the row was resolved
    // a moment ago from the token.
    if (updated === null) return invalidCharacter('unknown-piece');
    return { status: 200, body: { avatarId: updated.avatarId, chosen: true } };
  } catch (error) {
    if (error instanceof InvalidArtChoiceError) return invalidCharacter(error.code);
    throw error;
  }
}
