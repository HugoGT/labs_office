import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ART_CONTRACT_VERSION,
  ART_PACK_FORMAT,
  BRIDGE,
  CHAIR,
  CHARACTER_SEATED,
  CHARACTER_WALK,
  DESK,
  HEDGE,
  PACK_FACINGS,
  PLANT,
  TABLE,
  TERRAIN_DECALS,
  TERRAIN_MATERIALS,
  TERRAIN_WALKABLE,
  TREE,
  assembleFloorMotif,
  terrainDecalIndex,
  terrainFloorPieceId,
  terrainTileIndex,
  splitFloorMotif,
  validateArtImage,
  type ArtChairPiece,
  type ArtDeskPiece,
  type ArtFloorPiece,
  type ArtPackManifest,
  type ArtPropPiece,
  type ArtTilesetPiece,
  type RgbaImage,
} from '../../src/game/artContract.ts';
import { ROOM_TABLE_FOOTPRINTS } from './domain/tables.ts';
import { BASE_CHARACTERS } from './domain/characters.ts';
import { terrainTile } from './domain/tiles.ts';
import { PACK_DIR, PREVIEW_DIR, renderPackFiles, writePackFiles } from './pack.ts';
import { decodePng } from '../../server/src/assets/pngCodec.ts';

const REPO_ROOT = new URL('../../', import.meta.url).pathname;

function listFiles(root: string, dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else out.push(relative(root, path));
    }
  };
  walk(join(root, dir));
  return out.sort();
}

let files: Map<string, Uint8Array>;
let manifest: ArtPackManifest;
let tempRoot: string;

function packFile(path: string): Uint8Array {
  const bytes = files.get(`${PACK_DIR}/${path}`);
  if (!bytes) throw new Error(`missing pack file ${path}`);
  return bytes;
}

function image(path: string): RgbaImage {
  return decodePng(packFile(path));
}

function frame(sheet: RgbaImage, frameWidth: number, frameHeight: number, column: number, row: number): number[] {
  const out: number[] = [];
  for (let y = 0; y < frameHeight; y += 1) {
    const from = ((row * frameHeight + y) * sheet.width + column * frameWidth) * 4;
    out.push(...sheet.data.subarray(from, from + frameWidth * 4));
  }
  return out;
}

beforeAll(() => {
  files = renderPackFiles();
  manifest = JSON.parse(new TextDecoder().decode(packFile('manifest.json'))) as ArtPackManifest;
  tempRoot = mkdtempSync(join(tmpdir(), 'art-pack-'));
}, 60_000);

afterAll(() => {
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
});

describe('art pack export', () => {
  it('is deterministic: a second render is byte-identical', () => {
    const again = renderPackFiles();
    expect([...again.keys()]).toEqual([...files.keys()]);
    for (const [path, bytes] of files) expect(Buffer.compare(Buffer.from(again.get(path)!), Buffer.from(bytes)), path).toBe(0);
  }, 60_000);

  it('writes exactly the committed pack and previews, byte for byte', () => {
    // Regenerating must reproduce the repository: a stale, missing or edited
    // file means someone changed a generator without running `pnpm art:export`.
    writePackFiles(tempRoot, files);
    for (const dir of [PACK_DIR, PREVIEW_DIR]) {
      const written = listFiles(tempRoot, dir);
      expect(listFiles(REPO_ROOT, dir)).toEqual(written);
      for (const path of written) {
        const committed = readFileSync(join(REPO_ROOT, path));
        expect(Buffer.compare(committed, readFileSync(join(tempRoot, path))), `${path} differs from a fresh export`).toBe(0);
      }
    }
  });

  it('keeps previews out of the production pack', () => {
    // Vite copies public/ into the build, so a preview there would ship with the office.
    expect(PREVIEW_DIR.startsWith('public/')).toBe(false);
    for (const path of files.keys()) expect(path.startsWith(`${PACK_DIR}/`) || path.startsWith(`${PREVIEW_DIR}/`), path).toBe(true);
    expect([...files.keys()].some((path) => path.startsWith(`${PACK_DIR}/`) && path.includes('preview'))).toBe(false);
  });
});

describe('art pack manifest', () => {
  it('declares its format, contract version, author and license', () => {
    expect(manifest.format).toBe(ART_PACK_FORMAT);
    expect(manifest.contractVersion).toBe(ART_CONTRACT_VERSION);
    expect(manifest.fileFormat).toBe('png-rgba8');
    expect(manifest.tile).toBe(32);
    for (const piece of manifest.pieces) {
      expect(piece.author, piece.id).toBe(manifest.author);
      expect(piece.license, piece.id).toBe(manifest.license);
    }
  });

  it('registers the characters, furniture, floors, walls, the terrain tileset and the map props', () => {
    const count = (kind: string): number => manifest.pieces.filter((piece) => piece.kind === kind).length;
    const kinds = ['character', 'chair', 'desk', 'floor', 'wall', 'tileset', 'tree', 'plant', 'bridge', 'hedge', 'table'];
    expect(kinds.map(count)).toEqual([18, 4, 4, 9, 4, 1, 2, 1, 1, 1, 2]);
  });

  it('uses stable ids derived from the generators, unique and prefixed by kind', () => {
    const ids = manifest.pieces.map((piece) => piece.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const piece of manifest.pieces) expect(piece.id).toMatch(new RegExp(`^${piece.kind}-[a-z0-9]+(-[a-z0-9]+)*$`));
    expect(ids.filter((id) => id.startsWith('character-'))).toEqual(BASE_CHARACTERS.map((c) => `character-${c.id}`));
    expect(ids).toEqual(
      expect.arrayContaining([
        'chair-wood',
        'desk-painted',
        'floor-plain',
        'wall-glass',
        'floor-dirt',
        'floor-sand',
        'floor-cobblestone',
        'floor-tile',
        'floor-carpet',
        'tileset-terrain',
        'tree-oak',
        'tree-maple',
        'plant-ficus',
        'bridge-wood',
        'hedge-boxwood',
        'table-meeting',
        'table-cafeteria',
      ]),
    );
  });

  it('names defaults that exist in the pack', () => {
    const ids = new Set(manifest.pieces.map((piece) => piece.id));
    expect(manifest.defaults).toEqual({ character: 'character-p01-burgundy-suit', desk: 'desk-wood', floor: 'floor-wood' });
    for (const id of Object.values(manifest.defaults)) expect(ids.has(id), id).toBe(true);
  });

  it('lists every file with its real size and hash, and no file is left unlisted', () => {
    const listed = manifest.pieces.flatMap((piece) => piece.files.map((file) => file.path));
    const pngs = [...files.keys()].filter((path) => path.startsWith(`${PACK_DIR}/`) && path.endsWith('.png'));
    expect(listed.map((path) => `${PACK_DIR}/${path}`).sort()).toEqual(pngs.sort());
    for (const piece of manifest.pieces) {
      for (const file of piece.files) {
        const bytes = packFile(file.path);
        expect(createHash('sha256').update(bytes).digest('hex'), file.path).toBe(file.sha256);
        const decoded = decodePng(bytes);
        expect([decoded.width, decoded.height], file.path).toEqual([file.width, file.height]);
      }
    }
  });

  it('carries anchors and footprints from the contract', () => {
    for (const piece of manifest.pieces) {
      if (piece.kind === 'character') {
        expect(piece.anchors).toEqual({ walk: CHARACTER_WALK.anchor, seated: CHARACTER_SEATED.anchor });
        expect(piece.footprint).toEqual({ w: 1, h: 1 });
      }
      if (piece.kind === 'chair') expect(piece.anchors).toEqual({ seat: CHAIR.anchor, ground: CHAIR.ground });
      if (piece.kind === 'desk') {
        expect(piece.anchor).toEqual(DESK.anchor);
        for (const facing of PACK_FACINGS) expect(piece.facings[facing].footprint).toEqual(DESK.footprintByFacing[facing]);
      }
    }
  });

  it('describes the terrain tileset: each material band, its floor and walkability, and the decals', () => {
    const tileset = manifest.pieces.find((piece): piece is ArtTilesetPiece => piece.kind === 'tileset')!;
    expect([tileset.tileSize, tileset.columns, tileset.masks, tileset.phases, tileset.variants]).toEqual([32, 48, 16, 9, 3]);
    expect(tileset.materials.map((entry) => entry.material)).toEqual([...TERRAIN_MATERIALS]);
    const ids = new Set(manifest.pieces.map((piece) => piece.id));
    for (const entry of tileset.materials) {
      expect(entry.floor).toBe(terrainFloorPieceId(entry.material));
      expect(ids.has(entry.floor), entry.floor).toBe(true);
      expect(entry.walkable).toBe(TERRAIN_WALKABLE[entry.material]);
      expect(entry.firstTile + 15).toBe(terrainTileIndex(entry.material, 15, 0));
    }
    expect(tileset.decals).toEqual(TERRAIN_DECALS.map((decal) => ({ decal, tile: terrainDecalIndex(decal) })));
    expect(tileset.files.map((file) => [file.role, file.imageKind])).toEqual([['sheet', 'terrain-tileset']]);
  });

  it('places every map prop by the contract: footprint, anchor, layer and collision', () => {
    const props = manifest.pieces.filter((piece): piece is ArtPropPiece => ['tree', 'plant', 'bridge', 'hedge', 'table'].includes(piece.kind));
    expect(props).toHaveLength(7);
    const specs = { tree: TREE, plant: PLANT, bridge: BRIDGE, hedge: HEDGE, table: TABLE } as const;
    for (const piece of props) {
      const spec = specs[piece.kind];
      expect(piece.anchor, piece.id).toEqual(spec.anchor);
      expect([piece.layer, piece.collision], piece.id).toEqual([spec.layer, spec.collision]);
      expect(piece.files.map((file) => file.imageKind), piece.id).toEqual([piece.kind]);
      const footprint = piece.kind === 'table' ? ROOM_TABLE_FOOTPRINTS[piece.material === 'walnut' ? 'meeting' : 'cafeteria'] : specs[piece.kind].footprint;
      expect(piece.footprint, piece.id).toEqual(footprint);
      if (piece.kind === 'bridge') {
        expect(piece.orientations).toEqual(['north-south', 'east-west']);
        // The whole deck is walkable, over water too.
        expect(piece.deck).toEqual({ 'north-south': { x: 0, y: 0, w: 3, h: 3 }, 'east-west': { x: 0, y: 0, w: 3, h: 3 } });
      }
      if (piece.kind === 'hedge') expect(piece.height).toBe(HEDGE.height);
    }
  });

  it('marks only the painted desk and the plain floor as colorable', () => {
    const colorable = manifest.pieces
      .filter((piece): piece is ArtDeskPiece | ArtFloorPiece => piece.kind === 'desk' || piece.kind === 'floor')
      .filter((piece) => piece.colorable)
      .map((piece) => [piece.id, piece.defaultColor]);
    expect(colorable).toEqual([
      ['desk-painted', '#4f9a8a'],
      ['floor-plain', '#b9c3cc'],
    ]);
  });
});

describe('art pack files', () => {
  it('every exported PNG validates against its kind in the art contract', () => {
    for (const piece of manifest.pieces) {
      for (const file of piece.files) expect(validateArtImage(file.imageKind, image(file.path)), file.path).toEqual([]);
    }
  });

  it('keeps chair back and front layers apart instead of flattening them', () => {
    for (const piece of manifest.pieces.filter((p): p is ArtChairPiece => p.kind === 'chair')) {
      const sheet = image(piece.files[0]!.path);
      const up = PACK_FACINGS.indexOf('up');
      const back = frame(sheet, CHAIR.frame.width, CHAIR.frame.height, up, 0);
      const front = frame(sheet, CHAIR.frame.width, CHAIR.frame.height, up, 1);
      // Facing up the backrest is in front of the sitter: both layers carry pixels.
      expect(back.some((value, i) => i % 4 === 3 && value > 0), piece.id).toBe(true);
      expect(front.some((value, i) => i % 4 === 3 && value > 0), piece.id).toBe(true);
    }
  });

  it('exports each floor as its full 96x96 motif, whose nine tiles reassemble the generator output', () => {
    for (const piece of manifest.pieces.filter((p): p is ArtFloorPiece => p.kind === 'floor')) {
      const sheet = image(piece.files[0]!.path);
      const motif = terrainTile(piece.material as Parameters<typeof terrainTile>[0], piece.defaultColor ?? undefined);
      expect(Array.from(assembleFloorMotif(splitFloorMotif(sheet)).data), piece.id).toEqual(Array.from(motif.data));
    }
  });
});
