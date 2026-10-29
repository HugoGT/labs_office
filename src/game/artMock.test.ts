import { describe, expect, it } from 'vitest';
import exportedManifest from '../../public/assets/pack/manifest.json?raw';
import {
  CHAIR,
  CHARACTER_SEATED,
  CHARACTER_WALK,
  DESK,
  DOOR,
  PLANT,
  TABLE,
  WALK_DIRECTIONS,
  doorFrameIndex,
  doorHingeOf,
  sheetSize,
} from './artContract';
import {
  COMPASS,
  COMPASS_PITCH,
  COMPASS_SIZE,
  MOCK_COLUMNS,
  MOCK_DEFAULTS,
  MOCK_ROWS,
  chairSprites,
  deskSprite,
  doorSprite,
  plantSprite,
  seatedAt,
  seatedSprite,
  tableSprite,
  walkingSprite,
} from './artMock';

interface PackFile {
  path: string;
  width: number;
  height: number;
}

const pack = JSON.parse(exportedManifest) as { defaults: { character: string }; pieces: { id: string; kind: string; files: PackFile[] }[] };
const packFiles = new Map(pack.pieces.flatMap((piece) => piece.files.map((file) => [file.path, file] as const)));

describe('artMock: the office mock is 5 blocks wide and 3 tall', () => {
  it('has the size the review asks for', () => {
    expect([MOCK_COLUMNS, MOCK_ROWS]).toEqual([5, 3]);
  });
});

describe('artMock: the compass of walking characters', () => {
  it('puts the 8 directions on the 8 cells around the middle one, the way the compass reads', () => {
    expect(COMPASS).toEqual({
      NW: { col: 0, row: 0 },
      N: { col: 1, row: 0 },
      NE: { col: 2, row: 0 },
      W: { col: 0, row: 1 },
      E: { col: 2, row: 1 },
      SW: { col: 0, row: 2 },
      S: { col: 1, row: 2 },
      SE: { col: 2, row: 2 },
    });
    expect(Object.keys(COMPASS).sort()).toEqual([...WALK_DIRECTIONS].sort());
  });

  it('spaces the 8 walkers and the sitter so no frame covers its neighbor, in a box that holds all 9', () => {
    expect(COMPASS_PITCH.x).toBeGreaterThanOrEqual(CHARACTER_WALK.frame.width);
    expect(COMPASS_PITCH.y).toBeGreaterThanOrEqual(CHARACTER_WALK.frame.height);
    expect(COMPASS_SIZE).toEqual({ width: 3 * COMPASS_PITCH.x, height: 3 * COMPASS_PITCH.y });
  });

  it('cuts each direction from its own row of the walk sheet, the walk cycle starting at the first column', () => {
    for (const [row, direction] of WALK_DIRECTIONS.entries()) {
      expect(walkingSprite('walk.png', direction)).toEqual({
        url: 'walk.png',
        sheet: sheetSize(CHARACTER_WALK),
        frame: { x: 0, y: row * CHARACTER_WALK.frame.height, width: CHARACTER_WALK.frame.width, height: CHARACTER_WALK.frame.height },
        steps: CHARACTER_WALK.stepColumns,
      });
    }
  });

  it('sits facing the viewer, on the first idle frame of its row', () => {
    expect(seatedSprite('seated.png')).toEqual({
      url: 'seated.png',
      sheet: sheetSize(CHARACTER_SEATED),
      frame: {
        x: CHARACTER_SEATED.idleColumns[0]! * CHARACTER_SEATED.frame.width,
        y: CHARACTER_SEATED.rowOrder.indexOf('down') * CHARACTER_SEATED.frame.height,
        width: CHARACTER_SEATED.frame.width,
        height: CHARACTER_SEATED.frame.height,
      },
      steps: 0,
    });
  });

  it('seats the sitter on the chair: the pelvis lands on the seat point, whatever the ground point', () => {
    const ground = { x: 48, y: 50 };

    const { chair, sitter } = seatedAt(ground);

    expect({ x: chair.x + CHAIR.anchor.x, y: chair.y + CHAIR.anchor.y }).toEqual({ x: sitter.x + CHARACTER_SEATED.anchor.x, y: sitter.y + CHARACTER_SEATED.anchor.y });
    expect({ x: chair.x + CHAIR.ground.x, y: chair.y + CHAIR.ground.y }).toEqual(ground);
  });
});

describe('artMock: a piece in every orientation it has', () => {
  it('cuts a chair per facing, the back layer on the first row and the front on the second', () => {
    expect(CHAIR.columnOrder).toEqual(['up', 'down', 'left', 'right']);
    for (const [column, facing] of CHAIR.columnOrder.entries()) {
      const { back, front } = chairSprites('chair.png', facing);
      expect(back.frame).toEqual({ x: column * CHAIR.frame.width, y: 0, width: CHAIR.frame.width, height: CHAIR.frame.height });
      expect(front.frame).toEqual({ x: column * CHAIR.frame.width, y: CHAIR.frame.height, width: CHAIR.frame.width, height: CHAIR.frame.height });
      expect(back.sheet).toEqual(sheetSize(CHAIR));
    }
  });

  it('cuts a desk per facing', () => {
    for (const [column, facing] of DESK.columnOrder.entries()) {
      expect(deskSprite('desk.png', facing).frame).toEqual({ x: column * DESK.frame.width, y: 0, width: DESK.frame.width, height: DESK.frame.height });
    }
  });

  it('cuts a room table horizontal and standing vertical', () => {
    for (const [column, orientation] of TABLE.columnOrder.entries()) {
      expect(tableSprite('table.png', orientation).frame).toEqual({ x: column * TABLE.frame.width, y: 0, width: TABLE.frame.width, height: TABLE.frame.height });
    }
  });

  it('cuts a closed door per rotation, on the hinge a single door uses there', () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      const index = doorFrameIndex(rotation, doorHingeOf('door-upload-0123456789abcdef', rotation), 0);
      expect(doorSprite('door.png', rotation).frame).toEqual({
        x: (index % DOOR.columns) * DOOR.frame.width,
        y: Math.floor(index / DOOR.columns) * DOOR.frame.height,
        width: DOOR.frame.width,
        height: DOOR.frame.height,
      });
    }
  });

  it('cuts a plant, which has the one frame', () => {
    expect(plantSprite('plant.png')).toEqual({ url: 'plant.png', sheet: sheetSize(PLANT), frame: { x: 0, y: 0, width: PLANT.frame.width, height: PLANT.frame.height }, steps: 0 });
  });
});

describe('artMock: the pieces of the pack it draws when the submission is not that kind', () => {
  it('are files of the committed pack, of the size of their sheets (pinned against the manifest)', () => {
    const urlToPath = (url: string): string => url.slice(url.lastIndexOf('/', url.lastIndexOf('/') - 1) + 1);
    const expected: [string, number, number][] = [
      [MOCK_DEFAULTS.characterWalk, sheetSize(CHARACTER_WALK).width, sheetSize(CHARACTER_WALK).height],
      [MOCK_DEFAULTS.characterSeated, sheetSize(CHARACTER_SEATED).width, sheetSize(CHARACTER_SEATED).height],
      [MOCK_DEFAULTS.chair, sheetSize(CHAIR).width, sheetSize(CHAIR).height],
      [MOCK_DEFAULTS.office, 96, 96],
      [MOCK_DEFAULTS.grass, 96, 96],
      [MOCK_DEFAULTS.water, 96, 96],
    ];
    for (const [url, width, height] of expected) {
      const file = packFiles.get(urlToPath(url));
      expect(file, url).toBeDefined();
      expect({ width: file!.width, height: file!.height }, url).toEqual({ width, height });
    }
  });

  it('use the character the pack hands to a new user', () => {
    const files = pack.pieces.find((piece) => piece.id === pack.defaults.character)!.files;
    expect(files.map((file) => file.path).sort()).toEqual(
      [MOCK_DEFAULTS.characterWalk, MOCK_DEFAULTS.characterSeated].map((url) => url.slice(url.lastIndexOf('/', url.lastIndexOf('/') - 1) + 1)).sort(),
    );
  });
});
