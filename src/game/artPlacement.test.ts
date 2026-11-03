import { describe, expect, it } from 'vitest';
import { CHAIR, DESK, SOFA, type ArtChairPiece, type ArtDeskPiece, type ArtSofaPiece } from './artContract';
import {
  chairPlacement,
  deskPlacement,
  footprintAnchor,
  sofaPlacement,
} from './artPlacement';
import { TILE } from './mapData';

const DESK_PIECE: ArtDeskPiece = {
  id: 'desk-wood',
  kind: 'desk',
  name: 'Escritorio de madera',
  author: 'HugoGT',
  license: 'proprietary-internal',
  material: 'wood',
  colorable: false,
  defaultColor: null,
  anchor: { x: 32, y: 40 },
  facings: {
    up: { footprint: { w: 2, h: 1 }, ground: { x: 0, y: 6 }, chairGround: { x: 0, y: 10 } },
    down: { footprint: { w: 2, h: 1 }, ground: { x: 0, y: 6 }, chairGround: { x: 0, y: -10 } },
    left: { footprint: { w: 1, h: 2 }, ground: { x: 0, y: 15 }, chairGround: { x: 21, y: 0 } },
    right: { footprint: { w: 1, h: 2 }, ground: { x: 0, y: 15 }, chairGround: { x: -21, y: 0 } },
  },
  files: [],
};

const CHAIR_PIECE: ArtChairPiece = {
  id: 'chair-wood',
  kind: 'chair',
  name: 'Silla de madera',
  author: 'HugoGT',
  license: 'proprietary-internal',
  material: 'wood',
  facings: ['up', 'down', 'left', 'right'],
  layers: ['back', 'front'],
  anchors: { seat: { x: 18, y: 22 }, ground: { x: 18, y: 31 } },
  footprint: { w: 1, h: 1 },
  files: [],
};

describe('deskPlacement', () => {
  it('lands the desk anchor on the world point at native size, in the column of its facing', () => {
    const placement = deskPlacement(DESK_PIECE, 'down', { x: 200, y: 300 });

    expect(placement).toEqual({
      x: 200 - 32,
      y: 300 - 40,
      width: DESK.frame.width,
      height: DESK.frame.height,
      // Pack order is up, down, left, right: `down` is column 1, not the office's 0.
      frame: 1,
      depthY: 306,
      chairGround: { x: 200, y: 290 },
    });
  });

  it('picks the exported column of each facing instead of rotating one image', () => {
    expect(deskPlacement(DESK_PIECE, 'up', { x: 0, y: 0 }).frame).toBe(0);
    expect(deskPlacement(DESK_PIECE, 'left', { x: 0, y: 0 }).frame).toBe(2);
    expect(deskPlacement(DESK_PIECE, 'right', { x: 0, y: 0 })).toMatchObject({ frame: 3, depthY: 15, chairGround: { x: -21, y: 0 } });
  });
});

describe('anchors', () => {
  it('puts a piece in the middle of its footprint', () => {
    expect(footprintAnchor({ x: 3 * TILE, y: 5 * TILE, w: 2 * TILE, h: TILE })).toEqual({ x: 4 * TILE, y: 5.5 * TILE });
  });
});

describe('chairPlacement', () => {
  it('draws the back and front layers of one facing so that the chair ground lands on the point', () => {
    const { back, front } = chairPlacement(CHAIR_PIECE, 'left', { x: 100, y: 200 });

    expect(back).toEqual({ x: 82, y: 169, width: CHAIR.frame.width, height: CHAIR.frame.height, frame: 2, depthY: 200 });
    // Row 1 of the sheet holds the front layer: same column, one row down.
    expect(front).toEqual({ ...back, frame: CHAIR.columns + 2 });
  });
});

const SOFA_PIECE: ArtSofaPiece = {
  id: 'sofa-leather-3',
  kind: 'sofa',
  name: 'Sofá de cuero (3 plazas)',
  author: 'HugoGT',
  license: 'proprietary-internal',
  material: 'leather',
  seats: 3,
  facings: ['up', 'down', 'left', 'right'],
  layers: ['back', 'front'],
  anchor: { x: 48, y: 66 },
  footprint: { w: 3, h: 1 },
  files: [],
};

describe('sofaPlacement', () => {
  it('lands the sofa anchor on the middle of its footprint, both layers sorting with its seats when they share one row', () => {
    const { back, front } = sofaPlacement(SOFA_PIECE, 'down', { x: 9 * TILE, y: 5 * TILE, w: 3 * TILE, h: TILE });

    expect(back).toEqual({ x: 10.5 * TILE - 48, y: 5.5 * TILE - 66, width: SOFA.frame.width, height: SOFA.frame.height, frame: 1, depthY: 5.5 * TILE });
    expect(front).toEqual({ ...back, frame: SOFA.columns + 1 });
  });

  it('turned sideways, sorts the back layer under its top seat and the front layer over its bottom one', () => {
    const { back, front } = sofaPlacement(SOFA_PIECE, 'left', { x: 10 * TILE, y: 4 * TILE, w: TILE, h: 3 * TILE });

    expect(back).toMatchObject({ x: 10.5 * TILE - 48, y: 5.5 * TILE - 66, frame: 2, depthY: 4.5 * TILE });
    expect(front).toMatchObject({ x: back.x, y: back.y, frame: SOFA.columns + 2, depthY: 6.5 * TILE });
  });
});
