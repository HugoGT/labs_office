import { describe, expect, it } from 'vitest';
import {
  ART_TILE,
  BRIDGE,
  BRIDGE_ORIENTATIONS,
  CHAIR,
  CHARACTER_SEATED,
  CHARACTER_WALK,
  DESK,
  FLOOR,
  FLOOR_MOTIF_SIZE,
  HEDGE,
  PACK_FACINGS,
  TERRAIN_DECALS,
  TERRAIN_MATERIALS,
  TERRAIN_PHASES,
  TERRAIN_TILESET,
  WALK_DIRECTIONS,
  WALL,
  bridgeFrameIndex,
  facingColumn,
  floorFrameAt,
  hedgeFrameIndex,
  terrainDecalIndex,
  terrainTileIndex,
  validateArtImage,
  wallFrameIndex,
  type TerrainMaterial,
} from '../../src/game/artContract.ts';
import { ANCHOR_X, ANCHOR_Y, FRAME_HEIGHT, FRAME_WIDTH } from './domain/camera.ts';
import { chairSprite, CHAIR_MATERIALS } from './domain/chairs.ts';
import { BASE_CHARACTERS } from './domain/characters.ts';
import { DIRECTIONS } from './domain/directions.ts';
import { PixelBuffer } from './domain/pixelBuffer.ts';
import { FACINGS, SEAT_BLOCK, SEAT_HEIGHT } from './domain/seating.ts';
import { SIT_ANCHOR_X, SIT_ANCHOR_Y, SIT_DOWN_FRAME_COUNT, SIT_FRAME_HEIGHT, SIT_FRAME_WIDTH, SIT_ROWS } from './domain/sitCycle.ts';
import { buildCharacterSprites } from './domain/spriteSheet.ts';
import { tableSprite, TABLE_MATERIALS } from './domain/tables.ts';
import { terrainTile, TERRAINS, TILE_SIZE } from './domain/tiles.ts';
import { WALK_FRAME_COUNT } from './domain/walkCycle.ts';
import { groupWallGeometry, resolveWallGeometry } from './domain/wallGeometry.ts';
import { WALL_MATERIALS, WallMap } from './domain/wallMap.ts';
import { composeWalls } from './domain/wallRenderer.ts';
import { crop } from './imageOps.ts';
import { bridgeSprite, hedgeSprite, PLANT_KINDS, plantSprite, TREE_KINDS, treeSprite } from './domain/props.ts';
import { ROOM_TABLES, roomTableSprite } from './domain/tables.ts';
import { decalTile, terrainEdgeTile } from './domain/terrainTiles.ts';
import {
  bridgeSheet,
  chairSheet,
  characterSeatedSheet,
  characterWalkSheet,
  deskSheet,
  floorSheet,
  hedgeSheet,
  plantSheet,
  tableSheet,
  terrainLayerImage,
  terrainTilesetSheet,
  treeSheet,
  wallLayer,
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
  it('holds both 16x16 bodies and the 15 joints in contract frame order, and rebuilds any wall', () => {
    const map = new WallMap(6, 5);
    map.run({ col: 1, row: 1 }, 'east', 4, 'brick');
    map.run({ col: 1, row: 1 }, 'south', 3, 'brick');
    map.run({ col: 5, row: 1 }, 'south', 3, 'brick');
    map.run({ col: 1, row: 4 }, 'east', 1, 'brick');
    map.run({ col: 3, row: 4 }, 'east', 2, 'brick');
    map.run({ col: 3, row: 1 }, 'south', 2, 'brick');
    const geometry = resolveWallGeometry(map);
    for (const material of WALL_MATERIALS) {
      const sheet = wallSheet(material);
      expect(validateArtImage('wall', sheet), material).toEqual([]);
      expect(sheet.width).toBe(WALL.frame.width * (1 + wallFrameIndex({ piece: 'joint', mask: 15 })));
      const [group] = groupWallGeometry({
        joints: geometry.joints.map((joint) => ({ ...joint, material })),
        bodies: geometry.bodies.map((body) => ({ ...body, material })),
      });
      const expected = composeWalls(group!);
      const drawn = wallLayer(sheet, group!);
      expect([drawn.left, drawn.top], material).toEqual([expected.left, expected.top]);
      expect(pixels(drawn.image), material).toEqual(pixels(expected.image));
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

  it('holds each edge tile at its contract index, mask 0 empty, then the decals', () => {
    const tile = (index: number): PixelBuffer => tileOf(sheet, index, TERRAIN_TILESET.columns, ART_TILE, ART_TILE);
    for (const material of TERRAIN_MATERIALS) {
      for (let phase = 0; phase < TERRAIN_PHASES; phase += 1) {
        expect(tile(terrainTileIndex(material, 15, phase) - 15).countOpaque(), `${material} ${phase} mask 0`).toBe(0);
        for (const mask of [1, 6, 9, 15]) {
          expect(pixels(tile(terrainTileIndex(material, mask, phase))), `${material} ${mask} ${phase}`).toEqual(pixels(terrainEdgeTile(material, mask, phase)));
        }
      }
    }
    for (const decal of TERRAIN_DECALS) expect(pixels(tile(terrainDecalIndex(decal))), decal).toEqual(pixels(decalTile(decal)));
    for (let column = TERRAIN_DECALS.length; column < TERRAIN_TILESET.columns; column += 1) {
      expect(tile(terrainDecalIndex(TERRAIN_DECALS[0]!) + column).countOpaque()).toBe(0);
    }
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
      expect(pixels(tableSheet(kind))).toEqual(pixels(roomTableSprite(kind)));
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
