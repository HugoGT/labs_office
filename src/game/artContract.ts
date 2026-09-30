/**
 * Pixel and file format contract of the art pack (docs/art/contract.md). One
 * versioned source for the exporter (`tools/art`), the server catalog and the
 * client loader, so every integration reads the same sizes, orders and anchors
 * instead of carrying its own offsets.
 *
 * No imports on purpose, like `mapData.ts`: the server loads this file with
 * Node type stripping, which would need explicit `.ts` extensions that the
 * client build does not accept.
 *
 * Three concepts stay apart: the PNG frame size, the logical footprint in
 * tiles (placement and collision) and the visual anchor (feet, seat or floor
 * point). A 3x3 desk station does not imply a 96x96 PNG.
 */

/** Bump when any number below changes meaning; the manifest records it. */
export const ART_CONTRACT_VERSION = 1;

/** Every file is a non-interlaced 8-bit RGBA PNG. */
export const ART_FILE_FORMAT = 'png-rgba8';

/** Logical unit of coordinates, placement and bounds. Same as `TILE` in mapData.ts. */
export const ART_TILE = 32;

/**
 * Distinct non-transparent RGBA values allowed in one file. The pack's busiest
 * character sheet has about 75 (shaded ramps plus the partial-alpha contact
 * shadow); 128 leaves room for new characters while still rejecting what the
 * cap exists for: photos, gradients and smoothed upscales, which run into the
 * hundreds or thousands.
 */
export const MAX_COLORS_PER_IMAGE = 128;

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Logical size in tiles, independent of the PNG size. */
export interface Footprint {
  readonly w: number;
  readonly h: number;
}

/** Office facing vocabulary (`Facing` in officeProtocol.ts), restated for the same reason as ART_TILE. */
export type ArtFacing = 'up' | 'down' | 'left' | 'right';

/**
 * Order of the four facings in every pack sheet (seated rows, chair and desk
 * columns). It is not the office order `FACINGS` (`down, up, left, right`), so
 * code must go through `seatedRowForFacing` / `facingColumn`, never an index.
 * A facing is the way a seated character looks.
 */
export const PACK_FACINGS: readonly ArtFacing[] = ['up', 'down', 'left', 'right'];

/** The eight walk directions in screen space, in walk-sheet row order. */
export const WALK_DIRECTIONS = ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'] as const;
export type WalkDirection = (typeof WALK_DIRECTIONS)[number];

/** Walk direction a character uses for each facing (standing or seated). */
export const FACING_WALK_DIRECTION: Readonly<Record<ArtFacing, WalkDirection>> = {
  up: 'N',
  down: 'S',
  left: 'W',
  right: 'E',
};

export const CHAIR_LAYERS = ['back', 'front'] as const;
export type ChairLayer = (typeof CHAIR_LAYERS)[number];

export const ART_IMAGE_KINDS = ['character-walk', 'character-seated', 'chair', 'desk', 'floor', 'wall'] as const;
export type ArtImageKind = (typeof ART_IMAGE_KINDS)[number];

interface ImageSpecBase {
  readonly kind: ArtImageKind;
  readonly frame: Size;
  readonly columns: number;
  readonly rows: number;
  /** `partial`: any alpha (shadows, glass). `opaque`: every pixel has alpha 255. */
  readonly alpha: 'partial' | 'opaque';
  /**
   * Sprites float over the floor, so each frame's four corner pixels must be
   * transparent. It is what catches a backdrop baked into an export.
   */
  readonly transparentCorners: boolean;
  readonly maxColors: number;
}

export interface CharacterWalkSpec extends ImageSpecBase {
  readonly kind: 'character-walk';
  readonly rowOrder: readonly WalkDirection[];
  readonly stepColumns: number;
  readonly idleColumn: number;
  /** Ground point under the feet, inside a frame. */
  readonly anchor: Point;
  /** The feet tile; the rest of the body is drawn and depth sorted by the feet only. */
  readonly footprint: Footprint;
}

export interface CharacterSeatedSpec extends ImageSpecBase {
  readonly kind: 'character-seated';
  readonly rowOrder: readonly ArtFacing[];
  readonly transitionColumns: number;
  readonly idleColumns: readonly number[];
  /** Where the pelvis rests on the seat in every seated frame: drawn at `chair seat - anchor`. */
  readonly anchor: Point;
}

export interface ChairSpec extends ImageSpecBase {
  readonly kind: 'chair';
  readonly columnOrder: readonly ArtFacing[];
  readonly rowOrder: readonly ChairLayer[];
  /** Seat point (the sitter's pelvis), the same in every cell, so any character sits on any chair. */
  readonly anchor: Point;
  /** Floor pixel under the seat: the depth used to sort the chair against characters. */
  readonly ground: Point;
  readonly footprint: Footprint;
}

export interface DeskSpec extends ImageSpecBase {
  readonly kind: 'desk';
  readonly columnOrder: readonly ArtFacing[];
  /** Floor pixel under the middle of the desk, the same in every cell. */
  readonly anchor: Point;
  readonly footprintByFacing: Readonly<Record<ArtFacing, Footprint>>;
}

export interface FloorSpec extends ImageSpecBase {
  readonly kind: 'floor';
  /** Tiles per side of the motif: the sheet is the motif, cut into one frame per tile. */
  readonly motifTiles: number;
}

export interface WallSpec extends ImageSpecBase {
  readonly kind: 'wall';
  /** Distance between two grid vertices: one wall segment. */
  readonly segmentLength: number;
  readonly thickness: number;
  /** Square piece centered on each vertex that holds a wall. */
  readonly jointSize: number;
  /** What is left of a segment between two joints. */
  readonly bodyLength: number;
}

export type ArtImageSpec = CharacterWalkSpec | CharacterSeatedSpec | ChairSpec | DeskSpec | FloorSpec | WallSpec;

export const CHARACTER_WALK: CharacterWalkSpec = {
  kind: 'character-walk',
  frame: { width: 32, height: 52 },
  columns: 11,
  rows: WALK_DIRECTIONS.length,
  rowOrder: WALK_DIRECTIONS,
  stepColumns: 10,
  idleColumn: 10,
  anchor: { x: 16, y: 47 },
  footprint: { w: 1, h: 1 },
  alpha: 'partial',
  transparentCorners: true,
  maxColors: MAX_COLORS_PER_IMAGE,
};

export const CHARACTER_SEATED: CharacterSeatedSpec = {
  kind: 'character-seated',
  frame: { width: 44, height: 58 },
  columns: 8,
  rows: PACK_FACINGS.length,
  rowOrder: PACK_FACINGS,
  transitionColumns: 6,
  idleColumns: [6, 7],
  anchor: { x: 22, y: 42 },
  alpha: 'partial',
  transparentCorners: true,
  maxColors: MAX_COLORS_PER_IMAGE,
};

/**
 * The seat sits at the same pixel of every cell, and the ground point
 * SEAT_HEIGHT (9) below. Each chair fits the art's 36px SEAT_BLOCK, but once
 * they share that seat pixel they span 37 rows (up to 22 above the seat, 15
 * from it down), so the cell is 38 tall rather than 36.
 */
export const CHAIR: ChairSpec = {
  kind: 'chair',
  frame: { width: 36, height: 38 },
  columns: PACK_FACINGS.length,
  rows: CHAIR_LAYERS.length,
  columnOrder: PACK_FACINGS,
  rowOrder: CHAIR_LAYERS,
  anchor: { x: 18, y: 22 },
  ground: { x: 18, y: 31 },
  footprint: { w: 1, h: 1 },
  alpha: 'partial',
  transparentCorners: true,
  maxColors: MAX_COLORS_PER_IMAGE,
};

/** 64px cells (2x2 tiles) fit a desk in any facing; its footprint follows the long side. */
export const DESK: DeskSpec = {
  kind: 'desk',
  frame: { width: 64, height: 64 },
  columns: PACK_FACINGS.length,
  rows: 1,
  columnOrder: PACK_FACINGS,
  anchor: { x: 32, y: 40 },
  footprintByFacing: {
    up: { w: 2, h: 1 },
    down: { w: 2, h: 1 },
    left: { w: 1, h: 2 },
    right: { w: 1, h: 2 },
  },
  alpha: 'partial',
  transparentCorners: true,
  maxColors: MAX_COLORS_PER_IMAGE,
};

/** Floor patterns are drawn as 96x96 seamless motifs. */
export const FLOOR_MOTIF_SIZE = 96;
const MOTIF_TILES = FLOOR_MOTIF_SIZE / ART_TILE;

export const FLOOR: FloorSpec = {
  kind: 'floor',
  frame: { width: ART_TILE, height: ART_TILE },
  columns: MOTIF_TILES,
  rows: MOTIF_TILES,
  motifTiles: MOTIF_TILES,
  alpha: 'opaque',
  transparentCorners: false,
  maxColors: MAX_COLORS_PER_IMAGE,
};

const WALL_THICKNESS = 16;

/**
 * Walls live on the edges of the 32px grid (the art was drawn for a 96px one).
 * Every piece is 16x16: frame 0 the horizontal body, 1 the vertical body, then
 * `1 + mask` the joint whose walls leave toward the sides in `mask`.
 */
export const WALL: WallSpec = {
  kind: 'wall',
  frame: { width: WALL_THICKNESS, height: WALL_THICKNESS },
  columns: 2 + 15,
  rows: 1,
  segmentLength: ART_TILE,
  thickness: WALL_THICKNESS,
  jointSize: WALL_THICKNESS,
  bodyLength: ART_TILE - WALL_THICKNESS,
  // Glass is translucent; a wall piece covers its whole frame, so no corner rule.
  alpha: 'partial',
  transparentCorners: false,
  maxColors: MAX_COLORS_PER_IMAGE,
};

export const ART_IMAGE_SPECS: Readonly<{
  'character-walk': CharacterWalkSpec;
  'character-seated': CharacterSeatedSpec;
  chair: ChairSpec;
  desk: DeskSpec;
  floor: FloorSpec;
  wall: WallSpec;
}> = {
  'character-walk': CHARACTER_WALK,
  'character-seated': CHARACTER_SEATED,
  chair: CHAIR,
  desk: DESK,
  floor: FLOOR,
  wall: WALL,
};

export function sheetSize(spec: Pick<ImageSpecBase, 'frame' | 'columns' | 'rows'>): Size {
  return { width: spec.frame.width * spec.columns, height: spec.frame.height * spec.rows };
}

/** Row of the walk sheet for an office facing (the 4 cardinal of the 8 directions). */
export function walkRowForFacing(facing: ArtFacing): number {
  return WALK_DIRECTIONS.indexOf(FACING_WALK_DIRECTION[facing]);
}

/** Row of the seated sheet, or column of a chair or desk sheet, for an office facing. */
export function seatedRowForFacing(facing: ArtFacing): number {
  return PACK_FACINGS.indexOf(facing);
}

export const facingColumn = seatedRowForFacing;

// --- Images ------------------------------------------------------------------------------------

/** Decoded RGBA8 image, row by row (compatible with ImageData and the exporter's PixelBuffer). */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray;
}

function cropImage(image: RgbaImage, x: number, y: number, width: number, height: number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const from = ((y + row) * image.width + x) * 4;
    data.set(image.data.subarray(from, from + width * 4), row * width * 4);
  }
  return { width, height, data };
}

function mod(value: number, size: number): number {
  return ((value % size) + size) % size;
}

/**
 * Cuts a floor motif into its nine tiles, frame `row * 3 + col` being motif
 * sub-tile (col, row), so laying them out by `floorFrameAt` repeats the whole
 * pattern instead of one tile of it.
 */
export function splitFloorMotif(motif: RgbaImage): RgbaImage[] {
  if (motif.width !== FLOOR_MOTIF_SIZE || motif.height !== FLOOR_MOTIF_SIZE) {
    throw new Error(`A floor motif is ${FLOOR_MOTIF_SIZE}x${FLOOR_MOTIF_SIZE}, got ${motif.width}x${motif.height}`);
  }
  const tiles: RgbaImage[] = [];
  for (let row = 0; row < MOTIF_TILES; row += 1) {
    for (let col = 0; col < MOTIF_TILES; col += 1) tiles.push(cropImage(motif, col * ART_TILE, row * ART_TILE, ART_TILE, ART_TILE));
  }
  return tiles;
}

/** Inverse of `splitFloorMotif`. */
export function assembleFloorMotif(tiles: readonly RgbaImage[]): RgbaImage {
  if (tiles.length !== MOTIF_TILES * MOTIF_TILES) throw new Error(`A floor motif needs ${MOTIF_TILES * MOTIF_TILES} tiles, got ${tiles.length}`);
  const data = new Uint8ClampedArray(FLOOR_MOTIF_SIZE * FLOOR_MOTIF_SIZE * 4);
  tiles.forEach((tile, index) => {
    if (tile.width !== ART_TILE || tile.height !== ART_TILE) throw new Error(`Floor tile ${index} is not ${ART_TILE}x${ART_TILE}`);
    const x0 = (index % MOTIF_TILES) * ART_TILE;
    const y0 = Math.floor(index / MOTIF_TILES) * ART_TILE;
    for (let row = 0; row < ART_TILE; row += 1) {
      data.set(tile.data.subarray(row * ART_TILE * 4, (row + 1) * ART_TILE * 4), ((y0 + row) * FLOOR_MOTIF_SIZE + x0) * 4);
    }
  });
  return { width: FLOOR_MOTIF_SIZE, height: FLOOR_MOTIF_SIZE, data };
}

/** Frame of a floor sheet to draw at world tile (tx, ty): the motif repeats every 3 tiles. */
export function floorFrameAt(tx: number, ty: number): number {
  return mod(ty, MOTIF_TILES) * MOTIF_TILES + mod(tx, MOTIF_TILES);
}

// --- Walls -------------------------------------------------------------------------------------

export interface GridVertex {
  readonly col: number;
  readonly row: number;
}

/** A horizontal edge runs east from its vertex, a vertical one south. */
export interface GridEdge extends GridVertex {
  readonly axis: 'horizontal' | 'vertical';
}

export interface Rect extends Point, Size {}

const HALF_THICKNESS = WALL_THICKNESS / 2;

/** World pixels of the joint centered on a vertex. */
export function wallJointRect(vertex: GridVertex): Rect {
  return {
    x: vertex.col * WALL.segmentLength - HALF_THICKNESS,
    y: vertex.row * WALL.segmentLength - HALF_THICKNESS,
    width: WALL.jointSize,
    height: WALL.jointSize,
  };
}

/** World pixels of the body between the two joints of an edge. */
export function wallBodyRect(edge: GridEdge): Rect {
  const x = edge.col * WALL.segmentLength;
  const y = edge.row * WALL.segmentLength;
  return edge.axis === 'horizontal'
    ? { x: x + HALF_THICKNESS, y: y - HALF_THICKNESS, width: WALL.bodyLength, height: WALL.thickness }
    : { x: x - HALF_THICKNESS, y: y + HALF_THICKNESS, width: WALL.thickness, height: WALL.bodyLength };
}

/** Connection mask bits: north 1, east 2, south 4, west 8. */
export type WallPiece = { readonly piece: 'body'; readonly axis: GridEdge['axis'] } | { readonly piece: 'joint'; readonly mask: number };

export function wallFrameIndex(piece: WallPiece): number {
  if (piece.piece === 'body') return piece.axis === 'horizontal' ? 0 : 1;
  if (!Number.isInteger(piece.mask) || piece.mask < 1 || piece.mask > 15) throw new Error(`Invalid wall joint mask ${piece.mask}`);
  return 1 + piece.mask;
}

// --- Pack manifest -----------------------------------------------------------------------------

/** `format` of `public/assets/pack/manifest.json`. */
export const ART_PACK_FORMAT = 'oficina-art-pack';

export const ART_PIECE_KINDS = ['character', 'chair', 'desk', 'floor', 'wall'] as const;
export type ArtPieceKind = (typeof ART_PIECE_KINDS)[number];

/** One PNG of a piece. Paths are relative to the manifest; `sha256` is of the file bytes. */
export interface ArtPieceFile {
  readonly role: string;
  readonly path: string;
  readonly imageKind: ArtImageKind;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
}

interface ArtPieceBase {
  /** Stable identity, `<kind>-<name>`. Persisted choices point here, so it never changes meaning. */
  readonly id: string;
  readonly kind: ArtPieceKind;
  /** Shown in the UI (Spanish copy). */
  readonly name: string;
  readonly author: string;
  readonly license: string;
  readonly files: readonly ArtPieceFile[];
}

export interface ArtCharacterPiece extends ArtPieceBase {
  readonly kind: 'character';
  readonly anchors: { readonly walk: Point; readonly seated: Point };
  readonly footprint: Footprint;
}

export interface ArtChairPiece extends ArtPieceBase {
  readonly kind: 'chair';
  readonly material: string;
  readonly facings: readonly ArtFacing[];
  readonly layers: readonly ChairLayer[];
  readonly anchors: { readonly seat: Point; readonly ground: Point };
  readonly footprint: Footprint;
}

/** Per facing, as offsets from the desk anchor: its depth point and where a matching chair's ground goes. */
export interface ArtDeskFacing {
  readonly footprint: Footprint;
  readonly ground: Point;
  readonly chairGround: Point;
}

export interface ArtDeskPiece extends ArtPieceBase {
  readonly kind: 'desk';
  readonly material: string;
  /** A colorable piece is exported in `defaultColor`; other colors are generated from the same model. */
  readonly colorable: boolean;
  readonly defaultColor: string | null;
  readonly anchor: Point;
  readonly facings: Readonly<Record<ArtFacing, ArtDeskFacing>>;
}

export interface ArtFloorPiece extends ArtPieceBase {
  readonly kind: 'floor';
  readonly material: string;
  readonly colorable: boolean;
  readonly defaultColor: string | null;
  readonly motifTiles: number;
}

export interface ArtWallPiece extends ArtPieceBase {
  readonly kind: 'wall';
  readonly material: string;
  readonly segmentLength: number;
  readonly thickness: number;
  readonly translucent: boolean;
}

export type ArtPiece = ArtCharacterPiece | ArtChairPiece | ArtDeskPiece | ArtFloorPiece | ArtWallPiece;

export interface ArtPackManifest {
  readonly format: typeof ART_PACK_FORMAT;
  readonly contractVersion: number;
  readonly fileFormat: typeof ART_FILE_FORMAT;
  readonly tile: number;
  readonly author: string;
  readonly license: string;
  /** Initial choices for rows that have none yet: a new user, a desk or a space. */
  readonly defaults: { readonly character: string; readonly desk: string; readonly floor: string };
  readonly pieces: readonly ArtPiece[];
}

// --- Validation --------------------------------------------------------------------------------

export type ArtViolationCode = 'invalid-dimensions' | 'too-many-colors' | 'not-opaque' | 'background-present';

export interface ArtViolation {
  readonly code: ArtViolationCode;
  readonly message: string;
}

/** Distinct RGBA values among pixels with alpha > 0. */
export function countColors(image: RgbaImage): number {
  const colors = new Set<number>();
  const { data } = image;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] ?? 0;
    if (a === 0) continue;
    colors.add((((data[i] ?? 0) << 24) | ((data[i + 1] ?? 0) << 16) | ((data[i + 2] ?? 0) << 8) | a) >>> 0);
  }
  return colors.size;
}

function alphaAt(image: RgbaImage, x: number, y: number): number {
  return image.data[(y * image.width + x) * 4 + 3] ?? 0;
}

/**
 * Checks a decoded image against its kind. Returns every violation instead of
 * the first one, so a report names all that is wrong with a file at once. A
 * wrong size stops there: the other rules read frames that would not line up.
 */
export function validateArtImage(kind: ArtImageKind, image: RgbaImage): ArtViolation[] {
  const spec: ImageSpecBase = ART_IMAGE_SPECS[kind];
  const expected = sheetSize(spec);
  if (image.width !== expected.width || image.height !== expected.height || image.data.length !== image.width * image.height * 4) {
    return [
      {
        code: 'invalid-dimensions',
        message: `${kind} must be ${expected.width}x${expected.height} RGBA, got ${image.width}x${image.height} with ${image.data.length} bytes`,
      },
    ];
  }
  const violations: ArtViolation[] = [];
  const colors = countColors(image);
  if (colors > spec.maxColors) {
    violations.push({ code: 'too-many-colors', message: `${kind} allows ${spec.maxColors} colors, got ${colors}` });
  }
  if (spec.alpha === 'opaque') {
    for (let i = 3; i < image.data.length; i += 4) {
      if (image.data[i] !== 255) {
        const pixel = (i - 3) / 4;
        violations.push({ code: 'not-opaque', message: `${kind} must be fully opaque; pixel (${pixel % image.width}, ${Math.floor(pixel / image.width)}) is not` });
        break;
      }
    }
  }
  if (spec.transparentCorners) {
    const { width, height } = spec.frame;
    for (let frame = 0; frame < spec.columns * spec.rows; frame += 1) {
      const x0 = (frame % spec.columns) * width;
      const y0 = Math.floor(frame / spec.columns) * height;
      const corners = [
        [x0, y0],
        [x0 + width - 1, y0],
        [x0, y0 + height - 1],
        [x0 + width - 1, y0 + height - 1],
      ] as const;
      if (corners.some(([x, y]) => alphaAt(image, x, y) !== 0)) {
        violations.push({ code: 'background-present', message: `${kind} frame ${frame} has an opaque corner: frames must not carry a background` });
        break;
      }
    }
  }
  return violations;
}
