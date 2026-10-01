import { describe, expect, it } from 'vitest';
import {
  ART_IMAGE_SPECS,
  CHARACTER_SEATED,
  CHARACTER_WALK,
  DESK,
  PLANT,
  sheetSize,
  type ArtDeskPiece,
  type ArtImageKind,
  type RgbaImage,
} from '../../../src/game/artContract.ts';
import { parseArtPackManifest } from '../../../src/game/artPack.ts';
import { ART_PACK_DEFAULTS } from '../decor/artCatalogRules.ts';
import { AssetUploadError, MAX_UPLOAD_FILE_BYTES } from './assetImageRules.ts';
import { UPLOAD_FILE_ROLES, isUploadedPieceId, prepareAssetUpload } from './assetUploadRules.ts';
import { encodePng } from './pngCodec.ts';

function sheet(kind: ArtImageKind, rgb: readonly [number, number, number] = [200, 40, 40]): string {
  const spec = ART_IMAGE_SPECS[kind];
  const { width, height } = sheetSize(spec);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const opaque = spec.alpha === 'opaque';
      const center = x % spec.frame.width === spec.frame.width >> 1 && y % spec.frame.height === spec.frame.height >> 1;
      if (opaque || center) data.set([...rgb, 255], (y * width + x) * 4);
    }
  }
  const image: RgbaImage = { width, height, data };
  return encodePng(image).toString('base64');
}

const FACINGS: ArtDeskPiece['facings'] = {
  up: { footprint: { w: 2, h: 1 }, ground: { x: 0, y: 6 }, chairGround: { x: 0, y: 10 } },
  down: { footprint: { w: 2, h: 1 }, ground: { x: 0, y: 6 }, chairGround: { x: 0, y: -10 } },
  left: { footprint: { w: 1, h: 2 }, ground: { x: 0, y: 15 }, chairGround: { x: 21, y: 0 } },
  right: { footprint: { w: 1, h: 2 }, ground: { x: 0, y: 15 }, chairGround: { x: -21, y: 0 } },
};

const CREDITS = { name: 'Lucía', author: 'Equipo de arte', license: 'proprietary-internal' };

function character(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { kind: 'character', ...CREDITS, files: { walk: sheet('character-walk'), seated: sheet('character-seated') }, ...overrides };
}

function codeAndField(run: () => unknown): [string, string | null] | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof AssetUploadError) return [error.code, error.field];
    throw error;
  }
  return undefined;
}

/** A manifest of uploaded pieces the office parses with the pack's own parser. */
function asManifest(pieces: unknown[]): unknown {
  return { format: 'oficina-art-pack', contractVersion: 2, fileFormat: 'png-rgba8', tile: 32, author: 'x', license: 'y', defaults: ART_PACK_DEFAULTS, pieces };
}

describe('prepareAssetUpload', () => {
  it('builds a character piece the office can draw, with contract anchors and hash-named files', () => {
    const { piece, files } = prepareAssetUpload(character());

    expect(piece.kind).toBe('character');
    expect(isUploadedPieceId(piece.id)).toBe(true);
    expect(piece.id).toMatch(/^character-upload-[0-9a-f]{16}$/);
    expect(piece).toMatchObject({
      ...CREDITS,
      anchors: { walk: CHARACTER_WALK.anchor, seated: CHARACTER_SEATED.anchor },
      footprint: CHARACTER_WALK.footprint,
    });
    expect(files.map((file) => file.imageKind)).toEqual(['character-walk', 'character-seated']);
    expect(piece.files).toEqual([
      { role: 'walk', path: `${files[0]!.sha256}.png`, imageKind: 'character-walk', width: 352, height: 416, sha256: files[0]!.sha256 },
      { role: 'seated', path: `${files[1]!.sha256}.png`, imageKind: 'character-seated', width: 352, height: 232, sha256: files[1]!.sha256 },
    ]);
    expect(parseArtPackManifest(asManifest([piece]))?.pieces).toHaveLength(1);
  });

  it('derives the id from the pixels, so the same files are the same piece', () => {
    const first = prepareAssetUpload(character()).piece.id;
    expect(prepareAssetUpload(character({ name: 'Otro nombre' })).piece.id).toBe(first);
    const other = character({ files: { walk: sheet('character-walk', [10, 120, 200]), seated: sheet('character-seated') } });
    expect(prepareAssetUpload(other).piece.id).not.toBe(first);
  });

  it('builds a desk with the contract footprints and the given or default facing geometry', () => {
    const body = { kind: 'desk', ...CREDITS, material: 'roble', files: { sheet: sheet('desk') } };

    const withDefault = prepareAssetUpload(body, { defaultDeskFacings: FACINGS }).piece;
    expect(withDefault).toMatchObject({ kind: 'desk', material: 'roble', colorable: false, defaultColor: null, anchor: DESK.anchor, facings: FACINGS });

    const custom = { ...FACINGS, up: { ground: { x: 1, y: 7 }, chairGround: { x: 0, y: 12 } } };
    const explicit = prepareAssetUpload({ ...body, facings: custom }, { defaultDeskFacings: FACINGS }).piece as ArtDeskPiece;
    // The footprint is the contract's whatever the body says.
    expect(explicit.facings.up).toEqual({ footprint: DESK.footprintByFacing.up, ground: { x: 1, y: 7 }, chairGround: { x: 0, y: 12 } });
    expect(parseArtPackManifest(asManifest([withDefault, explicit]))?.pieces).toHaveLength(2);

    expect(codeAndField(() => prepareAssetUpload(body))).toEqual(['invalid-metadata', 'facings']);
    const broken = { ...body, facings: { ...FACINGS, left: { ground: { x: 'a', y: 0 }, chairGround: { x: 0, y: 0 } } } };
    expect(codeAndField(() => prepareAssetUpload(broken, { defaultDeskFacings: FACINGS }))).toEqual(['invalid-metadata', 'facings']);
  });

  it('builds a colorable floor and refuses a color model that does not add up', () => {
    const floor = { kind: 'floor', ...CREDITS, material: 'baldosa', colorable: true, defaultColor: '#AABBCC', files: { sheet: sheet('floor') } };
    expect(prepareAssetUpload(floor).piece).toMatchObject({ kind: 'floor', colorable: true, defaultColor: '#aabbcc', motifTiles: 3 });
    expect(codeAndField(() => prepareAssetUpload({ ...floor, defaultColor: 'blue' }))).toEqual(['invalid-metadata', 'defaultColor']);
    expect(codeAndField(() => prepareAssetUpload({ ...floor, colorable: false }))).toEqual(['invalid-metadata', 'defaultColor']);
  });

  it('builds a plant with the contract placement', () => {
    const plant = prepareAssetUpload({ kind: 'plant', ...CREDITS, material: 'helecho', files: { sheet: sheet('plant') } }).piece;
    expect(plant).toMatchObject({ kind: 'plant', footprint: PLANT.footprint, anchor: PLANT.anchor, layer: 'sorted', collision: 'solid' });
  });

  it('refuses kinds the office cannot place from an upload', () => {
    for (const kind of ['wall', 'tileset', 'bridge', 'table', 'nope', undefined]) {
      expect(codeAndField(() => prepareAssetUpload({ ...character(), kind }))).toEqual(['invalid-metadata', 'kind']);
    }
    expect(Object.keys(UPLOAD_FILE_ROLES).sort()).toEqual(['character', 'desk', 'floor', 'plant']);
  });

  it('refuses missing or malformed credits and material', () => {
    expect(codeAndField(() => prepareAssetUpload(null))).toEqual(['invalid-metadata', null]);
    expect(codeAndField(() => prepareAssetUpload(character({ name: '   ' })))).toEqual(['invalid-metadata', 'name']);
    expect(codeAndField(() => prepareAssetUpload(character({ name: 'x'.repeat(61) })))).toEqual(['invalid-metadata', 'name']);
    expect(codeAndField(() => prepareAssetUpload(character({ author: undefined })))).toEqual(['invalid-metadata', 'author']);
    expect(codeAndField(() => prepareAssetUpload(character({ license: 3 })))).toEqual(['invalid-metadata', 'license']);
    const plant = { kind: 'plant', ...CREDITS, files: { sheet: sheet('plant') } };
    expect(codeAndField(() => prepareAssetUpload(plant))).toEqual(['invalid-metadata', 'material']);
    expect(codeAndField(() => prepareAssetUpload({ ...plant, material: 'Con Espacios' }))).toEqual(['invalid-metadata', 'material']);
  });

  it('names the missing, extra or unreadable file', () => {
    expect(codeAndField(() => prepareAssetUpload(character({ files: { walk: sheet('character-walk') } })))).toEqual(['missing-file', 'seated']);
    expect(codeAndField(() => prepareAssetUpload(character({ files: 'nope' })))).toEqual(['invalid-metadata', 'files']);
    const extra = character({ files: { walk: sheet('character-walk'), seated: sheet('character-seated'), cape: sheet('plant') } });
    expect(codeAndField(() => prepareAssetUpload(extra))).toEqual(['invalid-metadata', 'files']);
    const notBase64 = character({ files: { walk: '***', seated: sheet('character-seated') } });
    expect(codeAndField(() => prepareAssetUpload(notBase64))).toEqual(['not-png', 'walk']);
    const swapped = character({ files: { walk: sheet('character-seated'), seated: sheet('character-seated') } });
    expect(codeAndField(() => prepareAssetUpload(swapped))).toEqual(['invalid-dimensions', 'walk']);
  });

  it('refuses an oversized file from its encoded length, before decoding it', () => {
    const huge = 'A'.repeat(Math.ceil((MAX_UPLOAD_FILE_BYTES * 4) / 3) + 8);
    expect(codeAndField(() => prepareAssetUpload(character({ files: { walk: huge, seated: sheet('character-seated') } })))).toEqual(['too-large', 'walk']);
  });
});
