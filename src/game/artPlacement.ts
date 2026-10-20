/**
 * Where a pack piece lands in the world (art migration, step 4). Pure
 * geometry over `artContract.ts`: no Phaser, so it is tested under jsdom and
 * the scene only copies these numbers into game objects.
 *
 * Every piece is drawn at its native size (one PNG pixel, one world pixel) and
 * positioned by its anchor, never stretched to a logical area. Facings pick an exported column of
 * the sheet instead of rotating a perspective drawing.
 */

import {
  CHAIR,
  DESK,
  facingColumn,
  type ArtChairPiece,
  type ArtDeskPiece,
  type ArtFacing,
  type Point,
} from './artContract';

/** A frame of a spritesheet placed in the world: top-left corner, size, frame index and y-sort point. */
export interface SpritePlacement {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly frame: number;
  readonly depthY: number;
}

export interface DeskPlacement extends SpritePlacement {
  /** Where the ground point of a matching chair goes (step 6 seats people there). */
  readonly chairGround: Point;
}

export interface PixelRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A piece stands in the middle of its footprint. */
export function footprintAnchor(rect: PixelRect): Point {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

export function deskPlacement(piece: ArtDeskPiece, facing: ArtFacing, anchor: Point): DeskPlacement {
  const { ground, chairGround } = piece.facings[facing];
  return {
    x: anchor.x - piece.anchor.x,
    y: anchor.y - piece.anchor.y,
    width: DESK.frame.width,
    height: DESK.frame.height,
    frame: facingColumn(facing),
    depthY: anchor.y + ground.y,
    chairGround: { x: anchor.x + chairGround.x, y: anchor.y + chairGround.y },
  };
}

/** Both layers of a chair with no sitter; step 6 draws the sitter between them. */
export function chairPlacement(piece: ArtChairPiece, facing: ArtFacing, ground: Point): { back: SpritePlacement; front: SpritePlacement } {
  const column = facingColumn(facing);
  const back: SpritePlacement = {
    x: ground.x - piece.anchors.ground.x,
    y: ground.y - piece.anchors.ground.y,
    width: CHAIR.frame.width,
    height: CHAIR.frame.height,
    frame: column,
    depthY: ground.y,
  };
  return { back, front: { ...back, frame: CHAIR.columns + column } };
}
