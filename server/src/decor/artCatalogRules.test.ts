/**
 * Pure rules of the art catalog (art migration, step 3): what a pack must be
 * to be registered, and what a persisted choice (character, desk material,
 * floor material) must be to be stored. Tested against the real exported
 * manifest where it matters, because the defaults in `schema.sql` are copies
 * of its `defaults` and nothing else would notice them drifting apart.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ART_CONTRACT_VERSION, ART_PIECE_KINDS, type ArtPackManifest } from '../../../src/game/artContract.ts';
import { readSchemaSql } from '../directory/migrate.ts';
import {
  ART_PACK_DEFAULTS,
  artPieceFields,
  InvalidArtChoiceError,
  InvalidArtPackError,
  normalizeArtColor,
  normalizeArtPack,
  normalizeStoredAppearance,
  resolveCharacterChoice,
  resolveDeskAppearance,
  resolveFloorAppearance,
  uploadedPieceIdPrefix,
  type ArtPieceRef,
} from './artCatalogRules.ts';

const MANIFEST: ArtPackManifest = JSON.parse(
  readFileSync(new URL('../../../public/assets/pack/manifest.json', import.meta.url), 'utf8'),
);

function clone(): Record<string, unknown> & { pieces: Record<string, unknown>[]; defaults: Record<string, unknown> } {
  return JSON.parse(JSON.stringify(MANIFEST));
}

const RETIRED_AT = new Date('2026-09-01T00:00:00.000Z');

const CATALOG: readonly ArtPieceRef[] = [
  { id: 'character-p01-burgundy-suit', kind: 'character', colorable: false, defaultColor: null, retiredAt: null },
  { id: 'character-p99-old', kind: 'character', colorable: false, defaultColor: null, retiredAt: RETIRED_AT },
  { id: 'desk-wood', kind: 'desk', colorable: false, defaultColor: null, retiredAt: null },
  { id: 'desk-painted', kind: 'desk', colorable: true, defaultColor: '#4f9a8a', retiredAt: null },
  { id: 'desk-old', kind: 'desk', colorable: false, defaultColor: null, retiredAt: RETIRED_AT },
  { id: 'floor-wood', kind: 'floor', colorable: false, defaultColor: null, retiredAt: null },
  { id: 'floor-plain', kind: 'floor', colorable: true, defaultColor: '#b9c3cc', retiredAt: null },
];

function choiceError(run: () => unknown): InvalidArtChoiceError {
  try {
    run();
  } catch (error) {
    if (error instanceof InvalidArtChoiceError) return error;
    throw error;
  }
  throw new Error('expected InvalidArtChoiceError');
}

describe('ART_PACK_DEFAULTS', () => {
  it('matches the defaults of the exported manifest', () => {
    expect(ART_PACK_DEFAULTS).toEqual(MANIFEST.defaults);
  });

  it('matches the column defaults that backfill existing rows in schema.sql', () => {
    const schema = readSchemaSql().replace(/\s+/g, ' ');
    expect(schema).toContain(`avatar_id text NOT NULL DEFAULT '${ART_PACK_DEFAULTS.character}'`);
    expect(schema).toContain(`material_id text NOT NULL DEFAULT '${ART_PACK_DEFAULTS.desk}'`);
    expect(schema).toContain(`floor_material_id text NOT NULL DEFAULT '${ART_PACK_DEFAULTS.floor}'`);
  });

  it('points at non-colorable materials, so backfilled rows are right to carry a NULL color', () => {
    // The color columns have no default: if a default material became
    // colorable, every backfilled row would need its defaultColor instead.
    for (const id of [ART_PACK_DEFAULTS.desk, ART_PACK_DEFAULTS.floor]) {
      const piece = MANIFEST.pieces.find((candidate) => candidate.id === id);
      expect(piece).toMatchObject({ colorable: false, defaultColor: null });
    }
  });
});

describe('art_pieces kinds in schema.sql', () => {
  it('allows exactly the contract piece kinds, on new tables and on ones created before', () => {
    // CREATE TABLE IF NOT EXISTS keeps an old CHECK, so the constraint is also
    // dropped and added again: version 2 added the tileset and the map props.
    const schema = readSchemaSql().replace(/\s+/g, ' ');
    const kinds = ART_PIECE_KINDS.map((kind) => `'${kind}'`).join(', ');
    expect(schema).toContain(`kind text NOT NULL CHECK (kind IN (${kinds}))`);
    expect(schema).toContain('ALTER TABLE art_pieces DROP CONSTRAINT IF EXISTS art_pieces_kind_check;');
    expect(schema).toContain(`ALTER TABLE art_pieces ADD CONSTRAINT art_pieces_kind_check CHECK (kind IN (${kinds}));`);
  });
});

describe('artPieceFields', () => {
  it('keeps the material of every piece that has one: props yes, characters and the tileset no', () => {
    const fields = (id: string) => artPieceFields(MANIFEST.pieces.find((piece) => piece.id === id)!);
    expect(fields('tree-oak')).toMatchObject({ kind: 'tree', material: 'oak', colorable: false, defaultColor: null });
    expect(fields('table-meeting')).toMatchObject({ kind: 'table', material: 'walnut' });
    expect(fields('tileset-terrain')).toMatchObject({ kind: 'tileset', material: null, colorable: false });
    expect(fields('character-p01-burgundy-suit').material).toBeNull();
  });
});

describe('normalizeArtPack', () => {
  it('accepts the exported manifest as is', () => {
    expect(normalizeArtPack(MANIFEST)).toEqual(MANIFEST);
  });

  it('rejects something that is not a pack of this format and contract', () => {
    expect(() => normalizeArtPack(null)).toThrow(InvalidArtPackError);
    expect(() => normalizeArtPack({ ...clone(), format: 'other' })).toThrow(InvalidArtPackError);
    expect(() => normalizeArtPack({ ...clone(), contractVersion: ART_CONTRACT_VERSION + 1 })).toThrow(InvalidArtPackError);
    expect(() => normalizeArtPack({ ...clone(), pieces: 'none' })).toThrow(InvalidArtPackError);
  });

  it('rejects two pieces with the same id: an identity has to name one piece', () => {
    const pack = clone();
    pack.pieces.push({ ...pack.pieces[0] });
    expect(() => normalizeArtPack(pack)).toThrow(/duplicate/);
  });

  it('rejects an id that does not start with its kind, or an unknown kind', () => {
    const wrongPrefix = clone();
    wrongPrefix.pieces[0].id = 'desk-mateo';
    expect(() => normalizeArtPack(wrongPrefix)).toThrow(InvalidArtPackError);

    const unknownKind = clone();
    unknownKind.pieces[0].kind = 'lamp';
    expect(() => normalizeArtPack(unknownKind)).toThrow(InvalidArtPackError);
  });

  it('rejects a pack id in the space reserved for uploads (#121), so the two can never collide', () => {
    const pack = clone();
    pack.pieces[0].id = `${uploadedPieceIdPrefix(String(pack.pieces[0].kind))}0123456789abcdef`;
    expect(() => normalizeArtPack(pack)).toThrow(/reserved/);
  });

  it('rejects a piece without files', () => {
    const pack = clone();
    pack.pieces[0].files = [];
    expect(() => normalizeArtPack(pack)).toThrow(InvalidArtPackError);
  });

  it('requires a valid default color on colorable materials and none on the rest', () => {
    const painted = clone();
    painted.pieces.find((piece) => piece.id === 'desk-painted')!.defaultColor = 'teal';
    expect(() => normalizeArtPack(painted)).toThrow(InvalidArtPackError);

    const wood = clone();
    wood.pieces.find((piece) => piece.id === 'desk-wood')!.defaultColor = '#123456';
    expect(() => normalizeArtPack(wood)).toThrow(InvalidArtPackError);
  });

  it('requires each default to be a piece of its kind in the same pack', () => {
    const missing = clone();
    missing.defaults.character = 'character-nobody';
    expect(() => normalizeArtPack(missing)).toThrow(InvalidArtPackError);

    const wrongKind = clone();
    wrongKind.defaults.floor = 'desk-wood';
    expect(() => normalizeArtPack(wrongKind)).toThrow(InvalidArtPackError);
  });
});

describe('normalizeArtColor', () => {
  it('accepts #rrggbb in any case and stores it lowercase', () => {
    expect(normalizeArtColor('#4F9A8A')).toBe('#4f9a8a');
  });

  it.each(['4f9a8a', '#4f9a8', '#4f9a8a0', '#ggg000', 'red', '', 12])('rejects %j', (raw) => {
    expect(choiceError(() => normalizeArtColor(raw)).code).toBe('invalid-color');
  });
});

describe('resolveCharacterChoice', () => {
  it('uses the pack default when nothing was chosen', () => {
    expect(resolveCharacterChoice(CATALOG, ART_PACK_DEFAULTS, undefined)).toBe(ART_PACK_DEFAULTS.character);
    expect(resolveCharacterChoice(CATALOG, ART_PACK_DEFAULTS, null)).toBe(ART_PACK_DEFAULTS.character);
  });

  it('accepts an active character', () => {
    expect(resolveCharacterChoice(CATALOG, ART_PACK_DEFAULTS, 'character-p01-burgundy-suit')).toBe(
      'character-p01-burgundy-suit',
    );
  });

  it('rejects an id that is not a character of the catalog', () => {
    expect(choiceError(() => resolveCharacterChoice(CATALOG, ART_PACK_DEFAULTS, 'character-nobody')).code).toBe(
      'unknown-piece',
    );
    expect(choiceError(() => resolveCharacterChoice(CATALOG, ART_PACK_DEFAULTS, 'desk-wood')).code).toBe(
      'unknown-piece',
    );
  });

  it('rejects a retired character as a NEW choice', () => {
    expect(choiceError(() => resolveCharacterChoice(CATALOG, ART_PACK_DEFAULTS, 'character-p99-old')).code).toBe(
      'retired-piece',
    );
  });
});

describe('resolveDeskAppearance', () => {
  it('uses the default material without a color when nothing was chosen', () => {
    expect(resolveDeskAppearance(CATALOG, ART_PACK_DEFAULTS, {})).toEqual({ materialId: 'desk-wood', color: null });
  });

  it('keeps a non-colorable material without a color', () => {
    expect(resolveDeskAppearance(CATALOG, ART_PACK_DEFAULTS, { material: 'desk-wood' })).toEqual({
      materialId: 'desk-wood',
      color: null,
    });
  });

  it('gives a colorable material its default color when none was chosen', () => {
    expect(resolveDeskAppearance(CATALOG, ART_PACK_DEFAULTS, { material: 'desk-painted' })).toEqual({
      materialId: 'desk-painted',
      color: '#4f9a8a',
    });
  });

  it('stores the chosen color of a colorable material, normalized', () => {
    expect(resolveDeskAppearance(CATALOG, ART_PACK_DEFAULTS, { material: 'desk-painted', color: '#FF0000' })).toEqual({
      materialId: 'desk-painted',
      color: '#ff0000',
    });
  });

  it('rejects a color on a material that is not colorable, the default one included', () => {
    expect(
      choiceError(() => resolveDeskAppearance(CATALOG, ART_PACK_DEFAULTS, { material: 'desk-wood', color: '#ff0000' }))
        .code,
    ).toBe('color-not-allowed');
    expect(choiceError(() => resolveDeskAppearance(CATALOG, ART_PACK_DEFAULTS, { color: '#ff0000' })).code).toBe(
      'color-not-allowed',
    );
  });

  it('rejects an invalid color on a colorable material', () => {
    expect(
      choiceError(() => resolveDeskAppearance(CATALOG, ART_PACK_DEFAULTS, { material: 'desk-painted', color: 'red' }))
        .code,
    ).toBe('invalid-color');
  });

  it('rejects a material that is not a desk, and a retired one', () => {
    expect(choiceError(() => resolveDeskAppearance(CATALOG, ART_PACK_DEFAULTS, { material: 'floor-wood' })).code).toBe(
      'unknown-piece',
    );
    expect(choiceError(() => resolveDeskAppearance(CATALOG, ART_PACK_DEFAULTS, { material: 'desk-old' })).code).toBe(
      'retired-piece',
    );
  });
});

describe('resolveFloorAppearance', () => {
  it('uses the default floor when nothing was chosen', () => {
    expect(resolveFloorAppearance(CATALOG, ART_PACK_DEFAULTS, {})).toEqual({ materialId: 'floor-wood', color: null });
  });

  it('applies the same color rules as a desk', () => {
    expect(resolveFloorAppearance(CATALOG, ART_PACK_DEFAULTS, { material: 'floor-plain' })).toEqual({
      materialId: 'floor-plain',
      color: '#b9c3cc',
    });
    expect(
      choiceError(() => resolveFloorAppearance(CATALOG, ART_PACK_DEFAULTS, { material: 'floor-wood', color: '#000000' }))
        .code,
    ).toBe('color-not-allowed');
  });

  it('rejects a desk material as a floor', () => {
    expect(choiceError(() => resolveFloorAppearance(CATALOG, ART_PACK_DEFAULTS, { material: 'desk-wood' })).code).toBe(
      'unknown-piece',
    );
  });
});

describe('normalizeStoredAppearance', () => {
  it('falls back to the default material without a color', () => {
    expect(normalizeStoredAppearance(undefined, 'desk-wood')).toEqual({ materialId: 'desk-wood', color: null });
  });

  it('normalizes the color of an already resolved appearance', () => {
    expect(normalizeStoredAppearance({ materialId: 'desk-painted', color: '#ABCDEF' }, 'desk-wood')).toEqual({
      materialId: 'desk-painted',
      color: '#abcdef',
    });
  });

  it('rejects a malformed appearance even when the caller skipped the catalog rules', () => {
    expect(choiceError(() => normalizeStoredAppearance({ materialId: '', color: null }, 'desk-wood')).code).toBe(
      'unknown-piece',
    );
    expect(choiceError(() => normalizeStoredAppearance({ materialId: 'desk-painted', color: 'red' }, 'desk-wood')).code).toBe(
      'invalid-color',
    );
  });
});
