import { describe, expect, it } from 'vitest';
import {
  ART_TILE,
  BRIDGE,
  BRIDGE_ORIENTATIONS,
  CHAIR,
  CHARACTER_SEATED,
  CHARACTER_WALK,
  DESK,
  DOOR,
  DOOR_HINGES,
  DOOR_STEPS,
  DOOR_VARIANTS,
  FLOOR,
  FLOOR_MOTIF_SIZE,
  HEDGE,
  PACK_FACINGS,
  SOFA,
  TABLE,
  TABLE_FACINGS,
  TERRAIN_DECALS,
  TERRAIN_MASKS,
  TERRAIN_MATERIALS,
  TERRAIN_ORGANIC_MATERIALS,
  TERRAIN_PHASES,
  TERRAIN_TILESET,
  TERRAIN_VARIANTS,
  TERRAIN_VOID_COLOR,
  TERRAIN_VOID_EDGE_COMBOS,
  WALK_DIRECTIONS,
  WALL,
  WALL_FRAMES,
  WALL_TOP_COLOR,
  WALL_VARIANTS,
  bridgeFrameIndex,
  doorFrameIndex,
  facingColumn,
  floorFrameAt,
  hedgeFrameIndex,
  terrainBankIndex,
  terrainDecalIndex,
  terrainTileIndex,
  terrainVoidCapIndex,
  terrainVoidEdgeIndex,
  validateArtImage,
  wallFrameIndex,
  type TerrainMaterial,
  type WallFrame,
} from '../../src/game/artContract.ts';
import { ANCHOR_X, ANCHOR_Y, FRAME_HEIGHT, FRAME_WIDTH } from '../../src/art/camera.ts';
import { chairSprite, CHAIR_MATERIALS } from './domain/chairs.ts';
import { SOFA_MATERIALS, SOFA_SEATS, sofaSprite } from './domain/sofas.ts';
import { BASE_CHARACTERS } from '../../src/art/characters.ts';
import { DIRECTIONS } from '../../src/art/directions.ts';
import { PixelBuffer } from '../../src/art/pixelBuffer.ts';
import { hexToRgba } from '../../src/game/artColor.ts';
import { FACINGS, SEAT_BLOCK, SEAT_HEIGHT } from '../../src/art/seating.ts';
import { SIT_ANCHOR_X, SIT_ANCHOR_Y, SIT_DOWN_FRAME_COUNT, SIT_FRAME_HEIGHT, SIT_FRAME_WIDTH, SIT_ROWS } from '../../src/art/sitCycle.ts';
import { buildCharacterSprites } from '../../src/art/spriteSheet.ts';
import { tableSprite, TABLE_MATERIALS } from './domain/tables.ts';
import { terrainTile, TERRAINS, TILE_SIZE } from './domain/tiles.ts';
import { WALK_FRAME_COUNT } from '../../src/art/walkCycle.ts';
import { wallColumn, wallFrame } from './domain/wallColumns.ts';
import { WALL_MATERIALS } from './domain/wallMap.ts';
import { crop } from './imageOps.ts';
import { DOOR_MATERIALS, doorSprite } from './domain/doors.ts';
import { bridgeSprite, hedgeSprite, PLANT_KINDS, plantSprite, TREE_KINDS, treeSprite } from './domain/props.ts';
import { ROOM_TABLES, roomTableSprite } from './domain/tables.ts';
import { decalTile, TERRAIN_EDGES, terrainBankTile, terrainEdgeTile, terrainVoidCapTile, terrainVoidEdgeTile } from './domain/terrainTiles.ts';
import {
  bridgeSheet,
  chairSheet,
  characterSeatedSheet,
  characterWalkSheet,
  deskSheet,
  doorSheet,
  floorSheet,
  hedgeSheet,
  plantSheet,
  sofaSheet,
  tableSheet,
  terrainLayerImage,
  terrainTilesetSheet,
  treeSheet,
  wallSheet,
} from './sheets.ts';

function pixels(image: PixelBuffer): number[] {
  return Array.from(image.data);
}

describe('generators and contract', () => {
  it('draw at the sizes, orders and anchors the art contract fixes', () => {
    expect([FRAME_WIDTH, FRAME_HEIGHT]).toEqual([CHARACTER_WALK.frame.width, CHARACTER_WALK.frame.height]);
    expect({ x: ANCHOR_X, y: ANCHOR_Y }).toEqual(CHARACTER_WALK.anchor);
    expect([...DIRECTIONS]).toEqual([...WALK_DIRECTIONS]);
    expect(WALK_FRAME_COUNT).toBe(CHARACTER_WALK.stepColumns);
    expect([SIT_FRAME_WIDTH, SIT_FRAME_HEIGHT]).toEqual([CHARACTER_SEATED.frame.width, CHARACTER_SEATED.frame.height]);
    expect({ x: SIT_ANCHOR_X, y: SIT_ANCHOR_Y }).toEqual(CHARACTER_SEATED.anchor);
    expect(SIT_DOWN_FRAME_COUNT).toBe(CHARACTER_SEATED.transitionColumns);
    expect([...SIT_ROWS]).toEqual([...PACK_FACINGS]);
    expect([...FACINGS]).toEqual([...PACK_FACINGS]);
    // A chair fits SEAT_BLOCK; the cell is taller so every chair can share one seat pixel.
    expect(CHAIR.frame.width).toBe(SEAT_BLOCK);
    expect(CHAIR.frame.height).toBeGreaterThan(SEAT_BLOCK);
    expect(CHAIR.ground.y - CHAIR.anchor.y).toBe(SEAT_HEIGHT);
    expect(TILE_SIZE).toBe(FLOOR_MOTIF_SIZE);
  });
});

describe('character sheets', () => {
  const character = BASE_CHARACTERS[0]!;
  const sprites = buildCharacterSprites(character);

  it('put the ten steps first and the idle pose in the last column, at 1x', () => {
    const sheet = characterWalkSheet(sprites);
    expect(validateArtImage('character-walk', sheet)).toEqual([]);
    expect(pixels(crop(sheet, 0, 0, sprites.walk.width, sprites.walk.height))).toEqual(pixels(sprites.walk));
    const idleX = CHARACTER_WALK.idleColumn * CHARACTER_WALK.frame.width;
    expect(pixels(crop(sheet, idleX, 0, sprites.idle.width, sprites.idle.height))).toEqual(pixels(sprites.idle));
  });

  it('keep the seated sheet as the generator draws it', () => {
    const sheet = characterSeatedSheet(sprites);
    expect(validateArtImage('character-seated', sheet)).toEqual([]);
    expect(pixels(sheet)).toEqual(pixels(sprites.sit));
  });
});

describe('chair sheet', () => {
  it('puts each facing in its column, back layer on row 0 and front on row 1, seat on the contract anchor', () => {
    for (const material of CHAIR_MATERIALS) {
      const sheet = chairSheet(material);
      expect(validateArtImage('chair', sheet), material).toEqual([]);
      for (const facing of PACK_FACINGS) {
        const sprite = chairSprite(material, facing);
        const x = facingColumn(facing) * CHAIR.frame.width + CHAIR.anchor.x - sprite.seat.x;
        const y = CHAIR.anchor.y - sprite.seat.y;
        expect(pixels(crop(sheet, x, y, sprite.back.width, sprite.back.height)), `${material} ${facing} back`).toEqual(pixels(sprite.back));
        const frontY = CHAIR.frame.height + y;
        expect(pixels(crop(sheet, x, frontY, sprite.front.width, sprite.front.height)), `${material} ${facing} front`).toEqual(pixels(sprite.front));
        expect(sprite.ground.y - sprite.seat.y).toBe(SEAT_HEIGHT);
      }
    }
  });
});

describe('sofa sheet', () => {
  it('puts each facing in its column, back layer on row 0 and front on row 1, the floor under the middle on the contract anchor', () => {
    for (const material of SOFA_MATERIALS) {
      for (const seats of SOFA_SEATS) {
        const name = `${material}-${seats}`;
        const sheet = sofaSheet(material, seats);
        expect(validateArtImage('sofa', sheet), name).toEqual([]);
        for (const facing of PACK_FACINGS) {
          const sprite = sofaSprite(material, seats, facing);
          const x = facingColumn(facing) * SOFA.frame.width + SOFA.anchor.x - sprite.ground.x;
          const y = SOFA.anchor.y - sprite.ground.y;
          expect(pixels(crop(sheet, x, y, sprite.back.width, sprite.back.height)), `${name} ${facing} back`).toEqual(pixels(sprite.back));
          expect(pixels(crop(sheet, x, SOFA.frame.height + y, sprite.front.width, sprite.front.height)), `${name} ${facing} front`).toEqual(pixels(sprite.front));
        }
      }
    }
  });
});

describe('desk sheet', () => {
  it('puts each facing in its column with the floor under the middle on the contract anchor', () => {
    for (const material of TABLE_MATERIALS) {
      const { image, facings } = deskSheet(material);
      expect(validateArtImage('desk', image), material).toEqual([]);
      for (const facing of PACK_FACINGS) {
        const sprite = tableSprite(material, facing);
        const x = facingColumn(facing) * DESK.frame.width + DESK.anchor.x - sprite.center.x;
        const y = DESK.anchor.y - sprite.center.y;
        expect(pixels(crop(image, x, y, sprite.image.width, sprite.image.height)), `${material} ${facing}`).toEqual(pixels(sprite.image));
        expect(facings[facing]).toEqual({
          footprint: DESK.footprintByFacing[facing],
          ground: { x: sprite.ground.x - sprite.center.x, y: sprite.ground.y - sprite.center.y },
          chairGround: { x: sprite.chairGround.x - sprite.center.x, y: sprite.chairGround.y - sprite.center.y },
        });
      }
    }
  });
});

describe('floor sheet', () => {
  it('is the full 96x96 motif, opaque, whose frames are its nine 32x32 tiles', () => {
    for (const terrain of TERRAINS) {
      const sheet = floorSheet(terrain);
      expect(validateArtImage('floor', sheet), terrain).toEqual([]);
      expect(pixels(sheet)).toEqual(pixels(terrainTile(terrain)));
    }
  });
});

describe('wall sheet', () => {
  const frames = Object.keys(WALL_FRAMES) as WallFrame[];
  const frameAt = (sheet: PixelBuffer, frame: WallFrame, variant: number): PixelBuffer =>
    crop(sheet, WALL_FRAMES[frame] * WALL.frame.width, variant * WALL.frame.height, WALL.frame.width, WALL.frame.height);
  const top = WALL_TOP_COLOR.match(/[0-9a-f]{2}/gi)!.map((hex) => parseInt(hex, 16));
  const isTop = (image: PixelBuffer, x: number, y: number): boolean => {
    const { r, g, b, a } = image.getPixel(x, y);
    return r === top[0] && g === top[1] && b === top[2] && a === 255;
  };

  it('holds every frame of every variant where the contract numbers it, and is deterministic', () => {
    for (const material of WALL_MATERIALS) {
      const sheet = wallSheet(material);
      expect(validateArtImage('wall', sheet), material).toEqual([]);
      expect([sheet.width, sheet.height]).toEqual([13 * ART_TILE, WALL_VARIANTS * ART_TILE]);
      for (let variant = 0; variant < WALL_VARIANTS; variant += 1) {
        for (const frame of frames) {
          const index = wallFrameIndex(frame, variant);
          const indexed = crop(sheet, (index % WALL.columns) * ART_TILE, Math.floor(index / WALL.columns) * ART_TILE, ART_TILE, ART_TILE);
          expect(pixels(indexed), `${material} ${frame} ${variant}`).toEqual(pixels(wallFrame(material, frame, variant)));
        }
      }
      expect(pixels(wallSheet(material)), material).toEqual(pixels(sheet));
    }
  });

  it('stacks crown, face and base into the wall column: a 19px top band over the material face', () => {
    for (const material of WALL_MATERIALS) {
      const sheet = wallSheet(material);
      for (let variant = 0; variant < WALL_VARIANTS; variant += 1) {
        const column = crop(wallColumn(material), variant * ART_TILE, 0, ART_TILE, WALL.heightTiles * ART_TILE);
        (['crown', 'face', 'base'] as const).forEach((frame, row) => {
          expect(pixels(frameAt(sheet, frame, variant)), `${material} ${frame}`).toEqual(pixels(crop(column, 0, row * ART_TILE, ART_TILE, ART_TILE)));
        });
        const crown = frameAt(sheet, 'crown', variant);
        for (let x = 0; x < ART_TILE; x += 1) {
          for (let y = 0; y < WALL.topHeight; y += 1) expect(isTop(crown, x, y), `${material} ${x},${y}`).toBe(true);
        }
        expect(Array.from({ length: ART_TILE }, (_, x) => isTop(crown, x, WALL.topHeight)).every(Boolean), material).toBe(false);
        // The cap, for the upper tiles of a vertical run, is all top band.
        const cap = frameAt(sheet, 'cap', variant);
        for (let y = 0; y < ART_TILE; y += 1) for (let x = 0; x < ART_TILE; x += 1) expect(isTop(cap, x, y)).toBe(true);
      }
    }
  });

  it('closes the right edge in the End frames, the left in the Start ones and both in the Both ones, with the top band color', () => {
    const top = hexToRgba(WALL_TOP_COLOR);
    const edgeColumn = (image: PixelBuffer, x: number) => pixels(crop(image, x, 0, 1, ART_TILE));
    const bandImage = new PixelBuffer(1, ART_TILE);
    for (let y = 0; y < ART_TILE; y += 1) bandImage.setPixel(0, y, top);
    const band = pixels(bandImage);
    for (const material of WALL_MATERIALS) {
      const sheet = wallSheet(material);
      for (const frame of ['crown', 'face', 'base'] as const) {
        const open = frameAt(sheet, frame, 0);
        const end = frameAt(sheet, `${frame}End`, 0);
        const start = frameAt(sheet, `${frame}Start`, 0);
        const both = frameAt(sheet, `${frame}Both`, 0);
        const label = `${material} ${frame}`;
        expect(pixels(crop(end, 0, 0, ART_TILE - 1, ART_TILE)), label).toEqual(pixels(crop(open, 0, 0, ART_TILE - 1, ART_TILE)));
        expect(edgeColumn(end, ART_TILE - 1), label).toEqual(band);
        expect(pixels(crop(start, 1, 0, ART_TILE - 1, ART_TILE)), label).toEqual(pixels(crop(open, 1, 0, ART_TILE - 1, ART_TILE)));
        expect(edgeColumn(start, 0), label).toEqual(band);
        expect(pixels(crop(both, 1, 0, ART_TILE - 2, ART_TILE)), label).toEqual(pixels(crop(open, 1, 0, ART_TILE - 2, ART_TILE)));
        expect([edgeColumn(both, 0), edgeColumn(both, ART_TILE - 1)], label).toEqual([band, band]);
      }
    }
  });

  it('draws three different materials, all opaque, each face varying across its three variants', () => {
    const faces = WALL_MATERIALS.map((material) => pixels(frameAt(wallSheet(material), 'face', 0)));
    expect(new Set(faces.map((face) => face.join())).size).toBe(WALL_MATERIALS.length);
    for (const material of WALL_MATERIALS) {
      const sheet = wallSheet(material);
      const alphas = new Set<number>();
      for (let y = 0; y < sheet.height; y += 1) for (let x = 0; x < sheet.width; x += 1) alphas.add(sheet.getPixel(x, y).a);
      expect([...alphas], material).toEqual([255]);
    }
    for (const material of ['brick', 'stone'] as const) {
      const sheet = wallSheet(material);
      const variants = [0, 1, 2].map((variant) => pixels(frameAt(sheet, 'face', variant)).join());
      expect(new Set(variants).size, material).toBe(WALL_VARIANTS);
    }
  });
});

function tileOf(sheet: PixelBuffer, index: number, columns: number, width: number, height: number): PixelBuffer {
  return crop(sheet, (index % columns) * width, Math.floor(index / columns) * height, width, height);
}

describe('terrain tileset sheet', () => {
  const sheet = terrainTilesetSheet();

  it('validates against the contract, color cap counted per material band', () => {
    expect(validateArtImage('terrain-tileset', sheet)).toEqual([]);
  });

  it('holds each edge tile at its contract index, mask 0 empty, then the decals, the banks and the void caps', () => {
    const tile = (index: number): PixelBuffer => tileOf(sheet, index, TERRAIN_TILESET.columns, ART_TILE, ART_TILE);
    for (const material of TERRAIN_MATERIALS) {
      const organic = TERRAIN_EDGES[material].style === 'organic';
      for (let phase = 0; phase < TERRAIN_PHASES; phase += 1) {
        for (let variant = 0; variant < TERRAIN_VARIANTS; variant += 1) {
          const label = `${material} ${phase} variant ${variant}`;
          expect(tile(terrainTileIndex(material, 15, phase, variant) - 15).countOpaque(), `${label} mask 0`).toBe(0);
          for (const mask of [1, 6, 9, 15]) {
            const drawn = tile(terrainTileIndex(material, mask, phase, variant));
            // Built floors only fill variant 0: their square edges have no other shape.
            if (organic || variant === 0) expect(pixels(drawn), `${label} mask ${mask}`).toEqual(pixels(terrainEdgeTile(material, mask, phase, variant)));
            else expect(drawn.countOpaque(), `${label} mask ${mask}`).toBe(0);
          }
        }
      }
    }
    for (const decal of TERRAIN_DECALS) expect(pixels(tile(terrainDecalIndex(decal))), decal).toEqual(pixels(decalTile(decal)));
    for (let column = TERRAIN_DECALS.length; column < TERRAIN_TILESET.columns; column += 1) {
      expect(tile(terrainDecalIndex(TERRAIN_DECALS[0]!) + column).countOpaque()).toBe(0);
    }
    expect(tile(terrainBankIndex(1) - 1).countOpaque(), 'bank mask 0').toBe(0);
    for (let mask = 1; mask < TERRAIN_MASKS; mask += 1) expect(pixels(tile(terrainBankIndex(mask))), `bank ${mask}`).toEqual(pixels(terrainBankTile(mask)));
    expect(tile(terrainVoidCapIndex(1) - 1).countOpaque(), 'void cap mask 0').toBe(0);
    for (let mask = 1; mask < TERRAIN_MASKS; mask += 1) expect(pixels(tile(terrainVoidCapIndex(mask))), `void cap ${mask}`).toEqual(pixels(terrainVoidCapTile(mask)));
    for (const material of TERRAIN_ORGANIC_MATERIALS) {
      for (const phase of [0, 4, 8]) {
        for (const { mask, voidMask } of TERRAIN_VOID_EDGE_COMBOS) {
          expect(pixels(tile(terrainVoidEdgeIndex(material, mask, voidMask, phase))), `${material} ${mask}/${voidMask} ${phase}`).toEqual(
            pixels(terrainVoidEdgeTile(material, mask, voidMask, phase)),
          );
        }
      }
    }
    // The last row past the void edge tiles stays empty.
    const used = TERRAIN_ORGANIC_MATERIALS.length * TERRAIN_PHASES * TERRAIN_VOID_EDGE_COMBOS.length;
    const firstFree = terrainVoidEdgeIndex('water', TERRAIN_VOID_EDGE_COMBOS[0]!.mask, TERRAIN_VOID_EDGE_COMBOS[0]!.voidMask, 0) + used;
    for (let index = firstFree; index < TERRAIN_TILESET.rows * TERRAIN_TILESET.columns; index += 1) expect(tile(index).countOpaque(), `${index}`).toBe(0);
  });

  it('meets the void line square where a shore runs into the void: no trace of the higher material beside the cap', () => {
    // A 2x2 map whose cell (1, 1) holds the four tiles; `lower` repaints the higher material as
    // the lower one, so any pixel that differs in the checked strip comes from the higher one.
    const key: Record<string, TerrainMaterial | null> = { W: 'water', G: 'grass', O: 'wood', V: null };
    const render = (rows: readonly string[]): PixelBuffer => terrainLayerImage(sheet, 2, 2, (tx, ty) => key[rows[ty]![tx]!]!);
    const strip = (image: PixelBuffer, x: number, top: number, bottom: number): string[] =>
      Array.from({ length: bottom - top }, (_, i) => pixels(crop(image, x, top + i, 1, 1)).join());
    // nw void, ne water, sw grass, se wood: the void line is x = 32 above y = 32, water on its right.
    let [image, lower] = [render(['VW', 'GO']), render(['VW', 'WO'])];
    for (const x of [32, 33]) expect(strip(image, x, 0, 32), `example 1, column ${x}`).toEqual(strip(lower, x, 0, 32));
    // nw grass, ne wood, sw void, se water: the void line is x = 32 below y = 32, water on its right.
    [image, lower] = [render(['GO', 'VW']), render(['WO', 'VW'])];
    for (const x of [32, 33]) expect(strip(image, x, 32, 64), `example 2, column ${x}`).toEqual(strip(lower, x, 32, 64));
  });

  it('edges every material straight on the tile line against the void', () => {
    // V is void: a water pond with a grass shore and a sand beach, cut by the void on the east.
    const rows = ['WWGV', 'WSGV', 'GGGV', 'VVVV'];
    const key: Record<string, TerrainMaterial | null> = { W: 'water', G: 'grass', S: 'sand', V: null };
    const image = terrainLayerImage(sheet, 4, 4, (tx, ty) => key[rows[ty]![tx]!]!);
    const black = [(TERRAIN_VOID_COLOR >> 16) & 0xff, (TERRAIN_VOID_COLOR >> 8) & 0xff, TERRAIN_VOID_COLOR & 0xff, 255].join();
    const at = (x: number, y: number): string => pixels(crop(image, x, y, 1, 1)).join();
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const voided = rows[Math.floor(y / ART_TILE)]![Math.floor(x / ART_TILE)] === 'V';
        // Void tiles show the void color, painted by a cap or the background where no layer draws;
        // terrain tiles are opaque and never void color.
        if (voided) expect([black, '0,0,0,0'], `${x},${y}`).toContain(at(x, y));
        else {
          expect(image.alphaAt(x, y), `${x},${y}`).toBe(255);
          expect(at(x, y), `${x},${y}`).not.toBe(black);
        }
      }
    }
  });

  it('gives a long shore a different curve on every block: the edge no longer repeats with the motif', () => {
    // Grass over water along a straight row: with one edge shape per mask and phase, the shore
    // repeated every 3 cells (96px), so every 9x9 block side drew the same curve.
    const width = 36;
    const image = terrainLayerImage(sheet, width, 2, (_tx, ty) => (ty === 0 ? 'grass' : 'water'));
    const lawn = terrainLayerImage(sheet, width, 2, () => 'grass');
    // The first row, per column, where the shore's rim departs from plain grass.
    const shore = (x: number): number => {
      let y = 0;
      while (y < image.height && pixels(crop(image, x, y, 1, 1)).join() === pixels(crop(lawn, x, y, 1, 1)).join()) y += 1;
      return y;
    };
    const curve = (fromTile: number): number[] => Array.from({ length: 3 * ART_TILE }, (_, i) => shore(fromTile * ART_TILE + i));
    const blocks = [0, 9, 18, 27].map(curve);
    for (let a = 0; a < blocks.length; a += 1) for (let b = a + 1; b < blocks.length; b += 1) expect(blocks[a], `blocks ${a} and ${b}`).not.toEqual(blocks[b]);
  });

  it('shades water at the foot of a built floor, and never a floor at the foot of another', () => {
    const shaded = (rows: readonly string[], x: number, y: number): boolean => {
      const key: Record<string, TerrainMaterial> = { W: 'water', O: 'wood', G: 'grass' };
      const at = (tx: number, ty: number): TerrainMaterial => key[rows[ty]![tx]!]!;
      const [width, height] = [rows[0]!.length, rows.length];
      const image = terrainLayerImage(sheet, width, height, at);
      // The same map all of the pixel's material: the same motif phase, no edge anywhere.
      const uniform = terrainLayerImage(sheet, width, height, () => at(Math.floor(x / ART_TILE), Math.floor(y / ART_TILE)));
      return pixels(crop(image, x, y, 1, 1)).join() !== pixels(crop(uniform, x, y, 1, 1)).join();
    };
    // The first water column right of a wood tile line (x = 32) is darker than open water.
    expect(shaded(['OWW', 'OWW', 'OWW'], 32, 40)).toBe(true);
    // Grass over water keeps its own shadow; wood over grass draws none.
    expect(shaded(['OGG', 'OGG', 'OGG'], 32, 40)).toBe(false);
  });

  it('lays a uniform map out exactly like the floor of the same material, aligned to the world', () => {
    for (const material of ['grass', 'cobblestone', 'carpet'] as const) {
      const image = terrainLayerImage(sheet, 5, 4, () => material);
      const floor = floorSheet(material);
      for (let ty = 0; ty < 4; ty += 1) {
        for (let tx = 0; tx < 5; tx += 1) {
          const frame = floorFrameAt(tx, ty);
          const expected = tileOf(floor, frame, FLOOR.columns, ART_TILE, ART_TILE);
          expect(pixels(crop(image, tx * ART_TILE, ty * ART_TILE, ART_TILE, ART_TILE)), `${material} (${tx}, ${ty})`).toEqual(pixels(expected));
        }
      }
    }
  });

  it('keeps the map opaque where materials meet: no gaps between layers', () => {
    const rows = ['WWGGD', 'WSGDD', 'GGCOO', 'KTCOO'];
    const key: Record<string, TerrainMaterial> = { W: 'water', G: 'grass', D: 'dirt', S: 'sand', C: 'cobblestone', O: 'wood', T: 'tile', K: 'carpet' };
    const image = terrainLayerImage(sheet, 5, 4, (tx, ty) => key[rows[ty]![tx]!]!);
    expect(image.countOpaque()).toBe(image.width * image.height);
  });
});

describe('prop sheets', () => {
  it('are the generator drawings in contract frames', () => {
    for (const kind of TREE_KINDS) {
      expect(validateArtImage('tree', treeSheet(kind)), kind).toEqual([]);
      expect(pixels(treeSheet(kind))).toEqual(pixels(treeSprite(kind)));
    }
    for (const kind of PLANT_KINDS) {
      expect(validateArtImage('plant', plantSheet(kind)), kind).toEqual([]);
      expect(pixels(plantSheet(kind))).toEqual(pixels(plantSprite(kind)));
    }
    for (const kind of ROOM_TABLES) {
      expect(validateArtImage('table', tableSheet(kind)), kind).toEqual([]);
      for (const facing of TABLE_FACINGS) {
        const frame = crop(tableSheet(kind), TABLE_FACINGS.indexOf(facing) * TABLE.frame.width, 0, TABLE.frame.width, TABLE.frame.height);
        expect(pixels(frame), `${kind} ${facing}`).toEqual(pixels(roomTableSprite(kind, facing)));
      }
    }
  });

  it('put each bridge orientation and each hedge mask in its frame', () => {
    const bridges = bridgeSheet();
    expect(validateArtImage('bridge', bridges)).toEqual([]);
    for (const orientation of BRIDGE_ORIENTATIONS) {
      const frame = tileOf(bridges, bridgeFrameIndex(orientation), BRIDGE.columns, BRIDGE.frame.width, BRIDGE.frame.height);
      expect(pixels(frame), orientation).toEqual(pixels(bridgeSprite(orientation)));
    }
    const hedges = hedgeSheet();
    expect(validateArtImage('hedge', hedges)).toEqual([]);
    for (let mask = 0; mask < 16; mask += 1) {
      const frame = tileOf(hedges, hedgeFrameIndex(mask), HEDGE.columns, HEDGE.frame.width, HEDGE.frame.height);
      expect(pixels(frame), `mask ${mask}`).toEqual(pixels(hedgeSprite(mask)));
    }
  });
});

describe('door sheets (#223, #233)', () => {
  it('validates against the contract and holds each rotation, hinge and swing step at its frame index, for both variants', () => {
    for (const material of DOOR_MATERIALS) {
      for (const variant of DOOR_VARIANTS) {
        const sheet = doorSheet(material, variant);
        expect([sheet.width, sheet.height], `${material} ${variant}`).toEqual([640, 2048]);
        expect(validateArtImage('door', sheet), `${material} ${variant}`).toEqual([]);
        for (const rotation of [0, 90, 180, 270] as const) {
          for (const hinge of DOOR_HINGES) {
            for (let open = 0; open < DOOR_STEPS; open += 1) {
              const frame = tileOf(sheet, doorFrameIndex(rotation, hinge, open), DOOR.columns, DOOR.frame.width, DOOR.frame.height);
              // Byte equality: a deep compare of 160x256 frames, 96 of them, outruns the test's timeout.
              expect(Buffer.from(frame.data).equals(Buffer.from(doorSprite(material, variant, rotation, hinge, open).data)), `${variant} ${rotation} ${hinge} ${open}`).toBe(true);
            }
          }
        }
      }
    }
  });
});
