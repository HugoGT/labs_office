/**
 * Pure rules of the art catalog (art migration, step 3). No SQL, no disk:
 * the pack arrives already parsed (wiring reads `manifest.json`, see
 * `directory/fromEnv.ts`) and the catalog arrives as rows, so `memoryDecor`,
 * `pgDecor` and the routes that will accept choices (steps 5 and 7) validate
 * exactly the same way.
 *
 * ## Who owns what
 *
 * The catalog owns each piece's metadata and files, keyed by the manifest id
 * (`<kind>-<name>`). A user owns its character, a desk its material and
 * color, a space (a desk's cubicle included) its floor material and color.
 * Those choices store the piece id and nothing else, so a new pack version
 * can change a piece's files without touching any row that points at it.
 *
 * ## Color of a non-colorable material is NULL
 *
 * A colorable material always stores a color (its `defaultColor` when none
 * was chosen), and any other material stores NULL. NULL is not "use the
 * default": it means the material has no color to choose, so the renderer
 * uses the exported art as is. Both adapters and `schema.sql` follow this.
 *
 * ## Retired is not deleted
 *
 * A piece missing from a newer pack is marked retired, never deleted: rows
 * that already chose it keep resolving it. Retired only means it cannot be
 * chosen again, same rule as `archived_at` on decor assets (D1b).
 */

import {
  ART_CONTRACT_VERSION,
  ART_PACK_FORMAT,
  ART_PIECE_KINDS,
  type ArtPackManifest,
  type ArtPiece,
  type ArtPieceFile,
  type ArtPieceKind,
} from '../../../src/game/artContract.ts';

/**
 * Pack defaults as literals, because `schema.sql` needs them as column
 * DEFAULTs to backfill existing rows and SQL cannot read the manifest.
 * `artCatalogRules.test.ts` fails if they drift from either one.
 */
export const ART_PACK_DEFAULTS = {
  character: 'character-p01-burgundy-suit',
  desk: 'desk-wood',
  floor: 'floor-wood',
} as const satisfies ArtPackManifest['defaults'];

export type ArtPackDefaults = ArtPackManifest['defaults'];

/** A pack that cannot be registered. Registration runs at start, so this stops the server. */
export class InvalidArtPackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidArtPackError';
  }
}

export type ArtChoiceErrorCode = 'unknown-piece' | 'retired-piece' | 'color-not-allowed' | 'invalid-color';

/**
 * A choice that cannot be stored. One class with a code and not four: every
 * case is the same 400 for a route, and the code is what the UI tells apart.
 */
export class InvalidArtChoiceError extends Error {
  readonly code: ArtChoiceErrorCode;

  constructor(code: ArtChoiceErrorCode, message: string) {
    super(message);
    this.name = 'InvalidArtChoiceError';
    this.code = code;
  }
}

/** The part of a catalog row the choice rules read. */
export interface ArtPieceRef {
  id: string;
  kind: ArtPieceKind;
  colorable: boolean;
  defaultColor: string | null;
  retiredAt: Date | null;
}

/** What a desk or a space stores: a material piece id and, only if it is colorable, a color. */
export interface ArtAppearance {
  materialId: string;
  color: string | null;
}

/** What a creation form sends; both fields optional (step 7). */
export interface ArtAppearanceInput {
  material?: string | null;
  color?: string | null;
}

const COLOR = /^#[0-9a-f]{6}$/i;

export function normalizeArtColor(raw: unknown): string {
  if (typeof raw !== 'string' || !COLOR.test(raw)) {
    throw new InvalidArtChoiceError('invalid-color', 'el color debe tener la forma #rrggbb');
  }
  return raw.toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Checks what the catalog depends on, not the pixels: those are the
 * exporter's job (`validateArtImage`), and a registered pack was exported and
 * checked before it was committed. Returns the same object, typed.
 */
export function normalizeArtPack(raw: unknown): ArtPackManifest {
  if (!isRecord(raw)) throw new InvalidArtPackError('the art pack manifest is not an object');
  if (raw.format !== ART_PACK_FORMAT) throw new InvalidArtPackError(`unknown art pack format ${String(raw.format)}`);
  if (raw.contractVersion !== ART_CONTRACT_VERSION) {
    throw new InvalidArtPackError(
      `art pack contract ${String(raw.contractVersion)} does not match this server (${ART_CONTRACT_VERSION})`,
    );
  }
  if (!Array.isArray(raw.pieces)) throw new InvalidArtPackError('the art pack has no pieces list');

  const kinds = new Map<string, ArtPieceKind>();
  for (const piece of raw.pieces as unknown[]) {
    if (!isRecord(piece) || !nonEmptyString(piece.id)) throw new InvalidArtPackError('an art piece has no id');
    const { id, kind } = piece;
    if (!(ART_PIECE_KINDS as readonly unknown[]).includes(kind)) {
      throw new InvalidArtPackError(`art piece ${id} has an unknown kind ${String(kind)}`);
    }
    // The prefix is what keeps an identity from changing kind between packs:
    // a stored `desk-wood` can never come back as a floor.
    if (!id.startsWith(`${kind as string}-`)) throw new InvalidArtPackError(`art piece ${id} does not start with its kind`);
    if (kinds.has(id)) throw new InvalidArtPackError(`duplicate art piece id ${id}`);
    if (!nonEmptyString(piece.name) || !nonEmptyString(piece.author) || !nonEmptyString(piece.license)) {
      throw new InvalidArtPackError(`art piece ${id} needs a name, an author and a license`);
    }
    const files = piece.files;
    if (!Array.isArray(files) || files.length === 0) throw new InvalidArtPackError(`art piece ${id} has no files`);
    for (const file of files as unknown[]) {
      if (!isRecord(file) || !nonEmptyString(file.role) || !nonEmptyString(file.path) || !nonEmptyString(file.sha256)) {
        throw new InvalidArtPackError(`art piece ${id} has a file without role, path or sha256`);
      }
    }
    if (kind === 'desk' || kind === 'floor') {
      if (!nonEmptyString(piece.material)) throw new InvalidArtPackError(`art piece ${id} has no material`);
      const valid = piece.colorable === true
        ? typeof piece.defaultColor === 'string' && COLOR.test(piece.defaultColor)
        : piece.colorable === false && piece.defaultColor === null;
      if (!valid) throw new InvalidArtPackError(`art piece ${id} has an invalid colorable/defaultColor pair`);
    }
    kinds.set(id, kind as ArtPieceKind);
  }

  if (!isRecord(raw.defaults)) throw new InvalidArtPackError('the art pack has no defaults');
  for (const kind of ['character', 'desk', 'floor'] as const) {
    const id = raw.defaults[kind];
    if (typeof id !== 'string' || kinds.get(id) !== kind) {
      throw new InvalidArtPackError(`the default ${kind} ${String(id)} is not a ${kind} of this pack`);
    }
  }

  return raw as unknown as ArtPackManifest;
}

/** The catalog columns of one manifest piece, shared by both adapters so they store the same thing. */
export interface ArtPieceFields {
  id: string;
  kind: ArtPieceKind;
  name: string;
  material: string | null;
  colorable: boolean;
  defaultColor: string | null;
  author: string;
  license: string;
  files: readonly ArtPieceFile[];
  spec: ArtPiece;
}

export function artPieceFields(piece: ArtPiece): ArtPieceFields {
  const tinted = piece.kind === 'desk' || piece.kind === 'floor' ? piece : null;
  return {
    id: piece.id,
    kind: piece.kind,
    name: piece.name,
    material: 'material' in piece ? piece.material : null,
    colorable: tinted?.colorable ?? false,
    defaultColor: tinted?.defaultColor ?? null,
    author: piece.author,
    license: piece.license,
    files: piece.files,
    spec: piece,
  };
}

function activePiece(catalog: readonly ArtPieceRef[], kind: ArtPieceKind, id: string): ArtPieceRef {
  const piece = catalog.find((candidate) => candidate.id === id && candidate.kind === kind);
  if (!piece) throw new InvalidArtChoiceError('unknown-piece', `no existe la pieza ${id}`);
  if (piece.retiredAt !== null) throw new InvalidArtChoiceError('retired-piece', `la pieza ${id} ya no se puede elegir`);
  return piece;
}

/** A new character choice, or the pack default when there is none. */
export function resolveCharacterChoice(
  catalog: readonly ArtPieceRef[],
  defaults: ArtPackDefaults,
  id: string | null | undefined,
): string {
  return activePiece(catalog, 'character', id ?? defaults.character).id;
}

function resolveAppearance(
  catalog: readonly ArtPieceRef[],
  kind: 'desk' | 'floor',
  defaultId: string,
  input: ArtAppearanceInput,
): ArtAppearance {
  const piece = activePiece(catalog, kind, input.material ?? defaultId);
  if (!piece.colorable) {
    if (input.color != null) {
      throw new InvalidArtChoiceError('color-not-allowed', `el material ${piece.id} no admite color`);
    }
    return { materialId: piece.id, color: null };
  }
  return { materialId: piece.id, color: input.color == null ? piece.defaultColor : normalizeArtColor(input.color) };
}

export function resolveDeskAppearance(
  catalog: readonly ArtPieceRef[],
  defaults: ArtPackDefaults,
  input: ArtAppearanceInput,
): ArtAppearance {
  return resolveAppearance(catalog, 'desk', defaults.desk, input);
}

export function resolveFloorAppearance(
  catalog: readonly ArtPieceRef[],
  defaults: ArtPackDefaults,
  input: ArtAppearanceInput,
): ArtAppearance {
  return resolveAppearance(catalog, 'floor', defaults.floor, input);
}

/**
 * The adapters' own guard on an appearance a caller already resolved: the
 * shape only, since an adapter has no catalog at hand. The catalog rules above
 * run where the choice is made, same split as `setDisplayName` (D10).
 */
export function normalizeStoredAppearance(appearance: ArtAppearance | undefined, defaultMaterialId: string): ArtAppearance {
  if (appearance === undefined) return { materialId: defaultMaterialId, color: null };
  if (!nonEmptyString(appearance.materialId)) {
    throw new InvalidArtChoiceError('unknown-piece', 'falta el material');
  }
  return {
    materialId: appearance.materialId,
    color: appearance.color === null ? null : normalizeArtColor(appearance.color),
  };
}

/** Same guard for a character id about to be stored. */
export function normalizeStoredCharacterId(id: unknown): string {
  if (!nonEmptyString(id) || !id.startsWith('character-')) {
    throw new InvalidArtChoiceError('unknown-piece', 'falta el personaje');
  }
  return id;
}
