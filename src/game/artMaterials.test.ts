import { describe, expect, it, vi } from 'vitest';
import exportedManifest from '../../public/assets/pack/manifest.json?raw';
import { facingColumn } from './artContract';
import {
  chairPreviewFrames,
  defaultAppearance,
  defaultChoice,
  loadMaterialCatalog,
  materialCatalogFrom,
  previewFrame,
  type MaterialCatalog,
} from './artMaterials';

const PACK: unknown = JSON.parse(exportedManifest);
const MANIFEST_URL = 'assets/pack/manifest.json';

function catalog(): MaterialCatalog {
  const result = materialCatalogFrom(PACK, MANIFEST_URL);
  if (result === null) throw new Error('the exported manifest must give a catalog');
  return result;
}

describe('materialCatalogFrom', () => {
  it('offers every desk and floor material of the pack, in pack order, with its Spanish name', () => {
    expect(catalog().desk.map((option) => option.id)).toEqual(['desk-glass', 'desk-metal', 'desk-wood', 'desk-painted']);
    expect(catalog().floor.map((option) => option.id)).toEqual([
      'floor-wood',
      'floor-grass',
      'floor-water',
      'floor-plain',
      'floor-dirt',
      'floor-sand',
      'floor-cobblestone',
      'floor-tile',
      'floor-carpet',
    ]);
    expect(catalog().desk.find((option) => option.id === 'desk-painted')?.name).toBe('Escritorio pintado');
  });

  it('marks only the painted desk and the plain floor as colorable, with their default colors', () => {
    const colorable = [...catalog().desk, ...catalog().floor].filter((option) => option.colorable);

    expect(colorable.map((option) => [option.id, option.defaultColor])).toEqual([
      ['desk-painted', '#4f9a8a'],
      ['floor-plain', '#b9c3cc'],
    ]);
  });

  it('points each option at the sheet the office draws, next to the manifest', () => {
    expect(catalog().desk.find((option) => option.id === 'desk-wood')?.sheetUrl).toBe('assets/pack/desk/wood.png');
    expect(catalog().floor.find((option) => option.id === 'floor-plain')?.sheetUrl).toBe('assets/pack/floor/plain.png');
  });

  it('keeps the pack defaults when they are offered', () => {
    expect(catalog().defaults).toEqual({ desk: 'desk-wood', floor: 'floor-wood' });
  });

  it('offers only what the manifest ships: a piece left out of the pack is retired and not offered', () => {
    const pack = PACK as { pieces: { id: string }[] };
    const trimmed = { ...pack, pieces: pack.pieces.filter((piece) => piece.id !== 'desk-metal') };

    expect(materialCatalogFrom(trimmed, MANIFEST_URL)?.desk.map((option) => option.id)).not.toContain('desk-metal');
  });

  it('answers null for a manifest the office cannot read', () => {
    expect(materialCatalogFrom({ format: 'other' }, MANIFEST_URL)).toBeNull();
  });
});

describe('materialCatalogFrom: chairs', () => {
  it('offers every chair piece of the pack, never colorable, next to the manifest', () => {
    expect(catalog().chair.map((option) => [option.id, option.kind])).toEqual([
      ['chair-wood', 'chair'],
      ['chair-metal', 'chair'],
      ['chair-leather', 'chair'],
      ['chair-gamer', 'chair'],
    ]);
    expect(catalog().chair.every((option) => !option.colorable && option.defaultColor === null)).toBe(true);
    expect(catalog().chair[0]!.sheetUrl).toBe('assets/pack/chair/wood.png');
  });

  it('a chair previews both layers of its down-facing cell, back first', () => {
    const chair = catalog().chair[0]!;
    const column = 36 * facingColumn('down');
    expect(chairPreviewFrames()).toEqual([
      { x: column, y: 0, width: 36, height: 38 },
      { x: column, y: 38, width: 36, height: 38 },
    ]);
    expect(previewFrame(chair)).toEqual(chairPreviewFrames()[0]);
  });
});

describe('materialCatalogFrom: walls', () => {
  it('offers every wall piece of the pack, never colorable, next to the manifest', () => {
    expect(catalog().wall.map((option) => [option.id, option.kind, option.name])).toEqual([
      ['wall-brick', 'wall', 'Ladrillo'],
      ['wall-stone', 'wall', 'Piedra'],
      ['wall-plaster', 'wall', 'Yeso'],
      ['wall-glass', 'wall', 'Vidrio'],
    ]);
    expect(catalog().wall.every((option) => !option.colorable && option.defaultColor === null)).toBe(true);
    expect(catalog().wall[0]!.sheetUrl).toBe('assets/pack/wall/brick.png');
  });
});

describe('defaultAppearance', () => {
  it('a colorable default starts in its default color, any other one without color', () => {
    const painted = catalog().desk.find((option) => option.id === 'desk-painted');
    const wood = catalog().desk.find((option) => option.id === 'desk-wood');

    expect(defaultAppearance(painted!)).toEqual({ materialId: 'desk-painted', color: '#4f9a8a' });
    expect(defaultAppearance(wood!)).toEqual({ materialId: 'desk-wood', color: null });
  });
});

describe('defaultChoice', () => {
  it('a form starts on the pack default of its kind', () => {
    expect(defaultChoice(catalog(), 'desk')).toEqual({ materialId: 'desk-wood', color: null });
    expect(defaultChoice(catalog(), 'floor')).toEqual({ materialId: 'floor-wood', color: null });
  });
});

describe('previewFrame', () => {
  it('a desk previews its front-facing cell, a floor its whole motif', () => {
    const desk = catalog().desk[0]!;
    const floor = catalog().floor[0]!;

    expect(previewFrame(desk)).toEqual({ x: 64, y: 0, width: 64, height: 64 });
    expect(previewFrame(floor)).toEqual({ x: 0, y: 0, width: 96, height: 96 });
  });

  it('a wall previews the joint of a straight east-west run, how a painted line of wall reads', () => {
    // Frame 1 + mask: east (2) and west (8).
    expect(previewFrame(catalog().wall[0]!)).toEqual({ x: 11 * 16, y: 0, width: 16, height: 16 });
  });
});

describe('loadMaterialCatalog', () => {
  it('reads the manifest once and builds the catalog', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => PACK }) as Response);

    const result = await loadMaterialCatalog({ manifestUrl: MANIFEST_URL, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(MANIFEST_URL);
    expect(result?.desk).toHaveLength(4);
  });

  it('answers null instead of throwing when the manifest is missing or unreadable', async () => {
    const missing = vi.fn(async () => ({ ok: false, json: async () => ({}) }) as Response);
    const broken = vi.fn(async () => ({ ok: true, json: async () => { throw new SyntaxError('html'); } }) as unknown as Response);
    const offline = vi.fn(async () => { throw new TypeError('offline'); });

    expect(await loadMaterialCatalog({ manifestUrl: MANIFEST_URL, fetchImpl: missing })).toBeNull();
    expect(await loadMaterialCatalog({ manifestUrl: MANIFEST_URL, fetchImpl: broken })).toBeNull();
    expect(await loadMaterialCatalog({ manifestUrl: MANIFEST_URL, fetchImpl: offline as unknown as typeof fetch })).toBeNull();
  });
});

describe('uploaded materials (#121)', () => {
  const UPLOADS_URL = 'http://server/assets/files/manifest.json';
  const pack = PACK as { pieces: { id: string; files: { path: string }[] }[] };
  const wood = pack.pieces.find((piece) => piece.id === 'desk-wood')!;
  const UPLOADED = { ...wood, id: 'desk-upload-0123456789abcdef', name: 'Roble', files: wood.files.map((file) => ({ ...file, path: 'c.png' })) };
  const UPLOADS = { ...(PACK as object), pieces: [UPLOADED] };

  it('offers uploaded desks after the pack ones, their sheet next to the uploads manifest', () => {
    const result = materialCatalogFrom(PACK, MANIFEST_URL, { raw: UPLOADS, url: UPLOADS_URL });

    expect(result?.desk.map((option) => option.id).at(-1)).toBe(UPLOADED.id);
    expect(result?.desk.at(-1)?.sheetUrl).toBe('http://server/assets/files/c.png');
    expect(result?.defaults.desk).toBe('desk-wood');
  });

  it('reads both manifests, and a missing uploads manifest leaves the pack', async () => {
    const both = vi.fn(async (url: string) => ({ ok: true, json: async () => (url === UPLOADS_URL ? UPLOADS : PACK) }) as Response);
    expect((await loadMaterialCatalog({ manifestUrl: MANIFEST_URL, uploadsUrl: UPLOADS_URL, fetchImpl: both as unknown as typeof fetch }))?.desk).toHaveLength(5);

    const noUploads = vi.fn(async (url: string) =>
      url === UPLOADS_URL ? ({ ok: false, json: async () => ({}) } as Response) : ({ ok: true, json: async () => PACK } as Response),
    );
    expect((await loadMaterialCatalog({ manifestUrl: MANIFEST_URL, uploadsUrl: UPLOADS_URL, fetchImpl: noUploads as unknown as typeof fetch }))?.desk).toHaveLength(4);
  });
});
