import { describe, expect, it, vi } from 'vitest';
import exportedManifest from '../../public/assets/pack/manifest.json?raw';
import { SOFA, WALL_FRAMES, facingColumn } from './artContract';
import {
  chairPreviewFrames,
  sofaPreviewFrames,
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
    expect(catalog().desk.map((option) => option.id)).toEqual(['desk-glass', 'desk-metal', 'desk-wood', 'desk-painted', 'desk-gamer', 'desk-curved']);
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

  it('marks only the painted desk, the gamer desk (its lights), the plain floor and the carpet as colorable, with their default colors', () => {
    const colorable = [...catalog().desk, ...catalog().floor].filter((option) => option.colorable);

    expect(colorable.map((option) => [option.id, option.defaultColor])).toEqual([
      ['desk-painted', '#4f9a8a'],
      ['desk-gamer', '#a066e8'],
      ['floor-plain', '#b9c3cc'],
      ['floor-carpet', '#5a6f86'],
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
  it('offers every chair piece of the pack, next to the manifest', () => {
    expect(catalog().chair.map((option) => [option.id, option.kind])).toEqual([
      ['chair-wood', 'chair'],
      ['chair-metal', 'chair'],
      ['chair-leather', 'chair'],
      ['chair-gamer', 'chair'],
      ['chair-office', 'chair'],
      ['chair-task', 'chair'],
      ['chair-fabric', 'chair'],
      ['chair-dining', 'chair'],
      ['chair-pouf', 'chair'],
    ]);
    expect(catalog().chair[0]!.sheetUrl).toBe('assets/pack/chair/wood.png');
  });

  it('marks only the gamer chair (its red accent), the fabric armchair and the pouf as colorable', () => {
    expect(catalog().chair.map((option) => [option.id, option.colorable, option.defaultColor])).toEqual([
      ['chair-wood', false, null],
      ['chair-metal', false, null],
      ['chair-leather', false, null],
      ['chair-gamer', true, '#d8433b'],
      ['chair-office', false, null],
      ['chair-task', false, null],
      ['chair-fabric', true, '#c4ab8c'],
      ['chair-dining', false, null],
      ['chair-pouf', true, '#6b8fb3'],
    ]);
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

describe('materialCatalogFrom: sofas', () => {
  it('offers every sofa piece of the pack, the fabric ones colorable in their beige', () => {
    expect(catalog().sofa.map((option) => [option.id, option.kind, option.name, option.colorable, option.defaultColor])).toEqual([
      ['sofa-leather-2', 'sofa', 'Sofá de cuero (2 plazas)', false, null],
      ['sofa-leather-3', 'sofa', 'Sofá de cuero (3 plazas)', false, null],
      ['sofa-fabric-2', 'sofa', 'Sofá tapizado (2 plazas)', true, '#c4ab8c'],
      ['sofa-fabric-3', 'sofa', 'Sofá tapizado (3 plazas)', true, '#c4ab8c'],
    ]);
    expect(catalog().sofa[0]!.sheetUrl).toBe('assets/pack/sofa/leather-2.png');
  });

  it('a sofa previews both layers of the part of its down-facing cell it covers, back first', () => {
    const sofa = catalog().sofa[1]!;
    const [back, front] = sofaPreviewFrames();
    expect(back).toMatchObject({ x: SOFA.frame.width * facingColumn('down'), width: SOFA.frame.width });
    expect(back.y).toBeLessThan(SOFA.anchor.y - 27);
    expect(back.y + back.height).toBeGreaterThan(SOFA.anchor.y + 5);
    expect(back.y + back.height).toBeLessThanOrEqual(SOFA.frame.height);
    expect(front).toEqual({ ...back, y: back.y + SOFA.frame.height });
    expect(previewFrame(sofa)).toEqual(back);
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

describe('materialCatalogFrom: plants and room tables (#208)', () => {
  it('offers every plant and room table of the pack, never colorable, for the decor palette', () => {
    expect(catalog().plant.map((option) => [option.id, option.kind, option.name])).toEqual([
      ['plant-bonsai', 'plant', 'Bonsái'],
    ]);
    expect(catalog().table.map((option) => [option.id, option.kind])).toEqual([
      ['table-meeting', 'table'],
      ['table-cafeteria', 'table'],
      ['table-oval', 'table'],
      ['table-round', 'table'],
    ]);
    expect([...catalog().plant, ...catalog().table].every((option) => !option.colorable && option.defaultColor === null)).toBe(true);
    expect(catalog().plant[0]!.sheetUrl).toBe('assets/pack/plant/bonsai.png');
  });

  it('a plant previews its one frame, a room table the part of its horizontal frame its footprint and lifted top cover', () => {
    expect(previewFrame(catalog().plant[0]!)).toEqual({ x: 0, y: 0, width: 32, height: 48 });
    // The 7x5 meeting table: 224 wide around the anchor (128, 244), 160 rows of floor plus its top, plus a margin.
    expect(previewFrame(catalog().table[0]!)).toEqual({ x: 128 - 112 - 2, y: 244 - 160 - 18, width: 224 + 4, height: 160 + 18 + 4 });
    // The 2x1 oval one is small: its preview is too, so the thumbnail can draw it bigger.
    const oval = catalog().table.find((option) => option.id === 'table-oval')!;
    expect(previewFrame(oval)).toEqual({ x: 128 - 32 - 2, y: 244 - 32 - 18, width: 64 + 4, height: 32 + 18 + 4 });
  });
});

describe('materialCatalogFrom: doors (#223, #233)', () => {
  it('offers every door of the pack, the single and the double one apart, and the window, never colorable, for the decor palette', () => {
    expect(catalog().door.map((option) => [option.id, option.kind, option.name, option.colorable, option.sheetUrl])).toEqual([
      ['door-wood', 'door', 'Puerta simple', false, 'assets/pack/door/wood.png'],
      ['door-wood-double', 'door', 'Puerta doble', false, 'assets/pack/door/wood-double.png'],
      ['door-glass-window', 'door', 'Ventana', false, 'assets/pack/door/glass-window.png'],
    ]);
    expect(catalog().door.every((option) => option.defaultColor === null)).toBe(true);
  });

  it('a door previews its closed leaf over the whole span: two tiles wide for a single door, three for a double one, around the anchor', () => {
    // The 128 x 128 frame has its anchor in the middle of the span (64, 64); the crop is 24 rows across the edge.
    expect(previewFrame(catalog().door[0]!)).toEqual({ x: 64 - 32, y: 64 - 12, width: 64, height: 24 });
    expect(previewFrame(catalog().door[1]!)).toEqual({ x: 64 - 48, y: 64 - 12, width: 96, height: 24 });
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
  it('a desk previews its sitter-side cell (drawer and knee space), a floor its whole motif', () => {
    const desk = catalog().desk[0]!;
    const floor = catalog().floor[0]!;

    expect(previewFrame(desk)).toEqual({ x: 96 * facingColumn('up'), y: 0, width: 96, height: 104 });
    expect(previewFrame(floor)).toEqual({ x: 0, y: 0, width: 96, height: 96 });
  });

  it('a wall previews the face tile of its first variant, the material as a painted wall shows it', () => {
    expect(previewFrame(catalog().wall[0]!)).toEqual({ x: WALL_FRAMES.face * 32, y: 0, width: 32, height: 32 });
  });
});

describe('loadMaterialCatalog', () => {
  it('reads the manifest once and builds the catalog', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => PACK }) as Response);

    const result = await loadMaterialCatalog({ manifestUrl: MANIFEST_URL, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(MANIFEST_URL);
    expect(result?.desk).toHaveLength(6);
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

  it('marks a retired upload, which the manifest still ships for whoever placed it (#264)', () => {
    const retired = { ...UPLOADED, id: 'desk-upload-fedcba9876543210', retired: true };
    const result = materialCatalogFrom(PACK, MANIFEST_URL, { raw: { ...UPLOADS, pieces: [UPLOADED, retired] }, url: UPLOADS_URL });

    expect(result?.desk.slice(-2).map((option) => [option.id, option.retired])).toEqual([
      [UPLOADED.id, false],
      [retired.id, true],
    ]);
    expect(result?.desk.filter((option) => option.retired)).toHaveLength(1);
  });

  it('reads both manifests, and a missing uploads manifest leaves the pack', async () => {
    const both = vi.fn(async (url: string) => ({ ok: true, json: async () => (url === UPLOADS_URL ? UPLOADS : PACK) }) as Response);
    expect((await loadMaterialCatalog({ manifestUrl: MANIFEST_URL, uploadsUrl: UPLOADS_URL, fetchImpl: both as unknown as typeof fetch }))?.desk).toHaveLength(7);

    const noUploads = vi.fn(async (url: string) =>
      url === UPLOADS_URL ? ({ ok: false, json: async () => ({}) } as Response) : ({ ok: true, json: async () => PACK } as Response),
    );
    expect((await loadMaterialCatalog({ manifestUrl: MANIFEST_URL, uploadsUrl: UPLOADS_URL, fetchImpl: noUploads as unknown as typeof fetch }))?.desk).toHaveLength(6);
  });
});
