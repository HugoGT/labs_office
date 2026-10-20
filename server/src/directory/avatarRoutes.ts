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
 *
 * ## Characters built with the creator
 *
 * The body may carry `{ spec }` instead of an id: a `CustomCharacterSpec`
 * checked by the shared `parseCustomCharacterSpec` (400 `invalid-spec` naming
 * the `field`), stored by its content hash and chosen as
 * `character-custom-<hash>`, the one id `users.avatar_id` and
 * `PlayerState.avatarId` carry. Such an id is accepted again only while its
 * hash is stored. `GET` returns the stored spec so the creator reopens it.
 *
 * Every saved choice also reaches the rooms (`CharacterUpdates`), so a
 * character changed from "Personalizar" shows at once for everyone without
 * reconnecting; at the entrance the caller is in no room yet and nothing
 * happens.
 */

import {
  customCharacterHash,
  customCharacterHashOf,
  customCharacterId,
  parseCustomCharacterSpec,
  type CustomCharacterSpec,
} from '../../../src/art/customCharacter.ts';
import { authenticate, type AdminDeps, type AdminResult } from '../admin/adminRoutes.ts';
import type { CharacterUpdates } from '../characterUpdates.ts';
import type { CustomCharacterStore } from '../characters/customCharacterPort.ts';
import { ART_PACK_DEFAULTS, InvalidArtChoiceError, resolveCharacterChoice } from '../decor/artCatalogRules.ts';
import type { DecorCatalog } from '../decor/decorPort.ts';

export interface AvatarDeps extends AdminDeps {
  /** Only the catalog read: these routes never register or retire pieces. */
  decor: Pick<DecorCatalog, 'listArtPieces'>;
  /** Characters built with the creator. Absent, a `spec` answers 503 and custom ids are unknown. */
  customCharacters?: CustomCharacterStore;
  /** Puts a saved character on the caller's live sessions. Absent, it shows on the next join. */
  characters?: Pick<CharacterUpdates, 'changeCharacterOf'>;
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
  return { status: 200, body: await avatarBody(avatarId, avatarChosenAt !== null, deps) };
}

/** The response of both routes: a custom character also carries its spec. */
async function avatarBody(avatarId: string, chosen: boolean, deps: AvatarDeps, known?: CustomCharacterSpec): Promise<Record<string, unknown>> {
  const hash = customCharacterHashOf(avatarId);
  const spec = known ?? (hash !== null ? await deps.customCharacters?.findCustomCharacter(hash) : null);
  return spec ? { avatarId, chosen, spec } : { avatarId, chosen };
}

/** The id to store for an `avatarId` choice: a pack or uploaded piece, or a stored custom character. */
async function resolveChosenId(id: string, deps: AvatarDeps): Promise<{ avatarId: string; spec?: CustomCharacterSpec }> {
  if (id.startsWith('character-custom-')) {
    const hash = customCharacterHashOf(id);
    const spec = hash !== null ? await deps.customCharacters?.findCustomCharacter(hash) : null;
    if (!spec) throw new InvalidArtChoiceError('unknown-piece', 'personaje desconocido');
    return { avatarId: id, spec };
  }
  const catalog = await deps.decor.listArtPieces({ includeRetired: true });
  return { avatarId: resolveCharacterChoice(catalog, ART_PACK_DEFAULTS, id) };
}

export async function handleSetAvatar(
  authorization: unknown,
  body: unknown,
  deps: AvatarDeps,
): Promise<AdminResult> {
  const authenticated = await authenticate(authorization, deps);
  if (!authenticated.ok) return authenticated.result;

  let choice: { avatarId: string; spec?: CustomCharacterSpec };
  if (isPlainObject(body) && 'spec' in body) {
    const parsed = parseCustomCharacterSpec(body.spec);
    if (!parsed.ok) return { status: 400, body: { error: 'invalid-character', reason: 'invalid-spec', field: parsed.field } };
    if (!deps.customCharacters) return { status: 503, body: { error: 'custom-characters-not-configured' } };
    const hash = customCharacterHash(parsed.spec);
    await deps.customCharacters.saveCustomCharacter(hash, parsed.spec);
    choice = { avatarId: customCharacterId(hash), spec: parsed.spec };
  } else {
    // A missing id is rejected rather than handed to `resolveCharacterChoice`,
    // which would read it as "use the default": saving is an explicit choice.
    if (!isPlainObject(body) || typeof body.avatarId !== 'string' || body.avatarId.length === 0) {
      return invalidCharacter('unknown-piece');
    }
    try {
      choice = await resolveChosenId(body.avatarId, deps);
    } catch (error) {
      if (error instanceof InvalidArtChoiceError) return invalidCharacter(error.code);
      throw error;
    }
  }

  let updated;
  try {
    updated = await deps.directory.setAvatar(authenticated.user.id, choice.avatarId);
  } catch (error) {
    if (error instanceof InvalidArtChoiceError) return invalidCharacter(error.code);
    throw error;
  }
  // Same impossible race as in `handleSetDisplayName`: the row was resolved
  // a moment ago from the token.
  if (updated === null) return invalidCharacter('unknown-piece');

  const uid = authenticated.user.uid;
  if (uid !== null) {
    try {
      deps.characters?.changeCharacterOf(uid, updated.avatarId);
    } catch {
      // The choice is saved; a room that could not redraw shows it on the next join.
      (deps.log ?? console.error)('[avatar] a room could not show a saved character');
    }
  }
  return { status: 200, body: await avatarBody(updated.avatarId, true, deps, choice.spec) };
}
