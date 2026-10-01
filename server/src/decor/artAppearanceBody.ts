/**
 * The appearance part of a desk or space creation body (art migration, step
 * 7), shared by `desksRoutes.ts` and `spacesRoutes.ts` so both read, check and
 * refuse it the same way.
 *
 * Material and color are chosen when the entity is created and never again:
 * an update body that mentions them is refused with its own code instead of
 * being ignored, so a client that tries learns it cannot rather than seeing
 * its change silently dropped.
 */

import type { AdminResult } from '../admin/adminRoutes.ts';
import {
  ART_PACK_DEFAULTS,
  InvalidArtChoiceError,
  resolveDeskAppearance,
  resolveFloorAppearance,
  type ArtAppearance,
  type ArtChoiceErrorCode,
} from './artCatalogRules.ts';
import type { DecorCatalog } from './decorPort.ts';

/** Only the catalog read: the entity routes never register or retire pieces. */
export type ArtCatalogReader = Pick<DecorCatalog, 'listArtPieces'>;

/** Body keys of each entity, the same names its read routes serve. */
export interface AppearanceFields {
  readonly material: string;
  readonly color: string;
}

export const DESK_APPEARANCE_FIELDS: AppearanceFields = { material: 'materialId', color: 'color' };
export const FLOOR_APPEARANCE_FIELDS: AppearanceFields = { material: 'floorMaterialId', color: 'floorColor' };

export const APPEARANCE_IMMUTABLE: AdminResult = { status: 400, body: { error: 'appearance-immutable' } };

/** Same shape as `invalid-character` in `avatarRoutes.ts`: the code is what the UI tells apart. */
export function invalidAppearance(reason: ArtChoiceErrorCode): AdminResult {
  return { status: 400, body: { error: 'invalid-appearance', reason } };
}

/** Whether an update body tries to touch the appearance; presence alone counts, even `null`. */
export function mentionsAppearance(body: Record<string, unknown>, fields: AppearanceFields): boolean {
  return fields.material in body || fields.color in body;
}

/**
 * The appearance a creation body asks for, checked against the catalog, or
 * `undefined` when it asks for none (the adapter then stores the pack default
 * without needing a catalog). Throws `InvalidArtChoiceError`.
 *
 * Retired pieces are listed too, so a retired id is told apart from an
 * unknown one. Without a catalog an explicit choice cannot be checked, and an
 * empty catalog refuses it as `unknown-piece`.
 */
export async function resolveBodyAppearance(
  body: Record<string, unknown>,
  fields: AppearanceFields,
  kind: 'desk' | 'floor',
  catalog: ArtCatalogReader | undefined,
): Promise<ArtAppearance | undefined> {
  const material = body[fields.material];
  const color = body[fields.color];
  if (material == null && color == null) return undefined;

  const pieces = catalog === undefined ? [] : await catalog.listArtPieces({ includeRetired: true });
  // Anything that is not a string reaches the rules as is and fails there:
  // a number is no piece id, and `normalizeArtColor` refuses a non-string.
  const input = { material: material as string | null | undefined, color: color as string | null | undefined };
  return kind === 'desk'
    ? resolveDeskAppearance(pieces, ART_PACK_DEFAULTS, input)
    : resolveFloorAppearance(pieces, ART_PACK_DEFAULTS, input);
}

/** Runs a route body, answering 400 `invalid-appearance` for a refused choice. */
export async function refusingInvalidAppearance(run: () => Promise<AdminResult>): Promise<AdminResult> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof InvalidArtChoiceError) return invalidAppearance(error.code);
    throw error;
  }
}
