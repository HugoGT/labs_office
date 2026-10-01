import { describe, expect, it } from 'vitest';
import { ART_CONTRACT_VERSION, type ArtPackManifest } from './artContract';
import {
  ART_PACK_MANIFEST_URL,
  artSheetKey,
  artUploadsManifestUrl,
  bootLoadRequests,
  combineArtManifests,
  findPiece,
  parseArtSheetKey,
  parseArtAppearance,
  parseArtPackManifest,
  pieceLoadRequests,
  recolorFor,
} from './artPack';
import exportedManifest from '../../public/assets/pack/manifest.json?raw';

/** The manifest the exporter wrote, as the office serves it. */
const PACK: unknown = JSON.parse(exportedManifest);

function pack(): ArtPackManifest {
  const manifest = parseArtPackManifest(PACK);
  if (manifest === null) throw new Error('the exported manifest must parse');
  return manifest;
}

function withPieces(pieces: unknown[]): unknown {
  return { ...(PACK as Record<string, unknown>), pieces };
}

describe('parseArtPackManifest', () => {
  it('accepts the exported pack with every piece', () => {
    expect(pack().pieces).toHaveLength((PACK as { pieces: unknown[] }).pieces.length);
    expect(pack().defaults).toEqual({
      character: 'character-p01-burgundy-suit',
      desk: 'desk-wood',
      floor: 'floor-wood',
    });
  });

  it('rejects a manifest of another format or contract version instead of guessing its frames', () => {
    expect(parseArtPackManifest({ ...(PACK as object), format: 'other' })).toBeNull();
    expect(parseArtPackManifest({ ...(PACK as object), contractVersion: ART_CONTRACT_VERSION + 1 })).toBeNull();
    expect(parseArtPackManifest({ ...(PACK as object), pieces: 'none' })).toBeNull();
    expect(parseArtPackManifest(null)).toBeNull();
    expect(parseArtPackManifest('<!doctype html>')).toBeNull();
  });

  it('drops a malformed piece and keeps the rest of the pack', () => {
    const [wood] = pack().pieces.filter((piece) => piece.id === 'desk-wood');
    const broken = [
      { ...wood, id: 'desk-no-anchor', anchor: undefined },
      { ...wood, id: 'desk-escape', files: [{ ...wood.files[0], path: '../../secret.png' }] },
      { ...wood, id: 'desk-wrong-size', files: [{ ...wood.files[0], width: 128 }] },
      { ...wood, id: 'floor-says-desk' },
    ];

    const parsed = parseArtPackManifest(withPieces([wood, ...broken]));

    expect(parsed?.pieces.map((piece) => piece.id)).toEqual(['desk-wood']);
  });

  it('reads the terrain tileset and the map props, and drops one that lacks its placement', () => {
    const manifest = pack();
    const kinds = new Set(manifest.pieces.map((piece) => piece.kind));
    for (const kind of ['tileset', 'tree', 'plant', 'bridge', 'hedge', 'table'] as const) expect(kinds.has(kind), kind).toBe(true);
    const [oak] = manifest.pieces.filter((piece) => piece.id === 'tree-oak');
    const [tileset] = manifest.pieces.filter((piece) => piece.id === 'tileset-terrain');
    const [bridge] = manifest.pieces.filter((piece) => piece.id === 'bridge-wood');
    const broken = [
      { ...oak, id: 'tree-no-footprint', footprint: undefined },
      { ...oak, id: 'tree-flying', layer: 'sky' },
      { ...oak, id: 'tree-ghost', collision: 'none' },
      { ...tileset, id: 'tileset-no-materials', materials: undefined },
      { ...tileset, id: 'tileset-unknown', materials: [{ material: 'lava', floor: 'floor-lava', walkable: true, firstTile: 0 }] },
      { ...bridge, id: 'bridge-no-deck', deck: undefined },
    ];

    const parsed = parseArtPackManifest(withPieces([oak, tileset, bridge, ...broken]));

    expect(parsed?.pieces.map((piece) => piece.id)).toEqual(['tree-oak', 'tileset-terrain', 'bridge-wood']);
  });
});

describe('load requests', () => {
  it('turns each piece file into a spritesheet with the frame size of its image kind', () => {
    const manifest = pack();
    const character = findPiece(manifest, 'character-p01-burgundy-suit');
    const desk = findPiece(manifest, 'desk-painted');
    if (character === undefined || desk === undefined) throw new Error('missing pieces');

    expect(pieceLoadRequests(character, ART_PACK_MANIFEST_URL)).toEqual([
      {
        key: artSheetKey('character-p01-burgundy-suit', 'walk'),
        url: 'assets/pack/character/p01-burgundy-suit-walk.png',
        frameWidth: 32,
        frameHeight: 52,
      },
      {
        key: artSheetKey('character-p01-burgundy-suit', 'seated'),
        url: 'assets/pack/character/p01-burgundy-suit-seated.png',
        frameWidth: 44,
        frameHeight: 58,
      },
    ]);
    expect(pieceLoadRequests(desk, 'https://cdn.example/pack/manifest.json')).toEqual([
      {
        key: artSheetKey('desk-painted', 'sheet'),
        url: 'https://cdn.example/pack/desk/painted.png',
        frameWidth: 64,
        frameHeight: 64,
      },
    ]);
  });

  it('loads before the office starts what the map draws at once: everything but the characters', () => {
    const requests = bootLoadRequests(pack(), ART_PACK_MANIFEST_URL);
    const kinds = new Set(requests.map((request) => request.key.split(':')[1]?.split('-')[0]));

    expect(kinds).toEqual(new Set(['floor', 'desk', 'chair', 'wall', 'tileset', 'tree', 'plant', 'bridge', 'hedge', 'table']));
    // Nine floors, four desks, four chairs and four walls, the terrain tileset,
    // two trees, a plant, a bridge, a hedge and two tables (art step 8).
    expect(requests).toHaveLength(29);
    expect(requests).toContainEqual({
      key: artSheetKey('tileset-terrain', 'sheet'),
      url: 'assets/pack/tileset/terrain.png',
      frameWidth: 32,
      frameHeight: 32,
    });
    expect(requests).toContainEqual({
      key: artSheetKey('floor-grass', 'sheet'),
      url: 'assets/pack/floor/grass.png',
      frameWidth: 32,
      frameHeight: 32,
    });
  });
});

describe('recolorFor', () => {
  it('asks for a recolor only for a colorable piece in a color other than its exported one', () => {
    const manifest = pack();
    const painted = findPiece(manifest, 'desk-painted');
    const plain = findPiece(manifest, 'floor-plain');
    const wood = findPiece(manifest, 'desk-wood');
    if (painted === undefined || plain === undefined || wood === undefined) throw new Error('missing pieces');

    expect(recolorFor(painted, '#c0392b')).toEqual({ from: '#4f9a8a', to: '#c0392b' });
    expect(recolorFor(painted, '#4F9A8A')).toBeNull();
    expect(recolorFor(painted, null)).toBeNull();
    expect(recolorFor(plain, '#101010')).toEqual({ from: '#b9c3cc', to: '#101010' });
    // A non-colorable material has no color to change, whatever a row says.
    expect(recolorFor(wood, '#c0392b')).toBeNull();
    // A malformed color falls back to the exported one instead of a broken texture key.
    expect(recolorFor(painted, 'red')).toBeNull();
  });
});

describe('parseArtAppearance', () => {
  it('reads a material and an optional #rrggbb color, lowercased', () => {
    expect(parseArtAppearance('desk-painted', '#C0392B')).toEqual({ materialId: 'desk-painted', color: '#c0392b' });
    expect(parseArtAppearance('floor-wood', null)).toEqual({ materialId: 'floor-wood', color: null });
  });

  it('answers null when there is no usable material, so the caller draws the pack default', () => {
    expect(parseArtAppearance(undefined, undefined)).toBeNull();
    expect(parseArtAppearance('', null)).toBeNull();
    expect(parseArtAppearance(42, null)).toBeNull();
    // A color that is not #rrggbb is dropped, not the material.
    expect(parseArtAppearance('desk-painted', 'teal')).toEqual({ materialId: 'desk-painted', color: null });
  });
});

describe('uploaded art (#121)', () => {
  const UPLOADS_URL = 'http://localhost:2567/assets/files/manifest.json';
  const ficus = () => pack().pieces.find((piece) => piece.id === 'plant-ficus')!;
  const uploaded = () => ({ ...ficus(), id: 'plant-upload-0123456789abcdef', files: ficus().files.map((file) => ({ ...file, path: `${'a'.repeat(64)}.png` })) });
  const uploads = (): ArtPackManifest => ({ ...pack(), pieces: [uploaded()] });

  it('reads the uploads manifest from the office server, next to its files', () => {
    expect(artUploadsManifestUrl('ws://localhost:2567')).toBe(UPLOADS_URL);
    expect(artUploadsManifestUrl('wss://app.example.com')).toBe('https://app.example.com/assets/files/manifest.json');
    // Without a server there is nothing uploaded to read.
    expect(artUploadsManifestUrl(null)).toBeNull();
    expect(artUploadsManifestUrl(undefined)).toBeNull();
  });

  it('joins the pack and the uploads into one catalog, each piece loading from its own folder', () => {
    const catalog = combineArtManifests([
      { manifest: pack(), url: ART_PACK_MANIFEST_URL },
      { manifest: uploads(), url: UPLOADS_URL },
    ]);

    expect(catalog?.manifest.pieces).toHaveLength(pack().pieces.length + 1);
    expect(catalog?.manifest.defaults).toEqual(pack().defaults);
    expect(catalog?.sourceOf('plant-ficus')).toBe(ART_PACK_MANIFEST_URL);
    expect(catalog?.sourceOf('plant-upload-0123456789abcdef')).toBe(UPLOADS_URL);
    expect(pieceLoadRequests(uploaded(), UPLOADS_URL)[0]?.url).toBe(`http://localhost:2567/assets/files/${'a'.repeat(64)}.png`);
  });

  it('keeps the pack piece when an upload repeats its id, and works with either source missing', () => {
    const clash = { ...uploads(), pieces: [{ ...ficus(), name: 'Impostor' }] };
    const catalog = combineArtManifests([
      { manifest: pack(), url: ART_PACK_MANIFEST_URL },
      { manifest: clash, url: UPLOADS_URL },
    ]);
    expect(findPiece(catalog!.manifest, 'plant-ficus')?.name).toBe(ficus().name);
    expect(catalog?.sourceOf('plant-ficus')).toBe(ART_PACK_MANIFEST_URL);

    expect(combineArtManifests([{ manifest: null, url: ART_PACK_MANIFEST_URL }, { manifest: uploads(), url: UPLOADS_URL }])?.manifest.pieces).toHaveLength(1);
    expect(combineArtManifests([{ manifest: pack(), url: ART_PACK_MANIFEST_URL }, { manifest: null, url: UPLOADS_URL }])?.manifest.pieces).toHaveLength(
      pack().pieces.length,
    );
    expect(combineArtManifests([{ manifest: null, url: ART_PACK_MANIFEST_URL }])).toBeNull();
  });

  it('reads an art texture key back into its piece and role, for decor that points at one', () => {
    expect(parseArtSheetKey(artSheetKey('plant-upload-0123456789abcdef', 'sheet'))).toEqual({ pieceId: 'plant-upload-0123456789abcdef', role: 'sheet' });
    expect(parseArtSheetKey('plant-large')).toBeNull();
    expect(parseArtSheetKey('art:only-one-part')).toBeNull();
  });
});
