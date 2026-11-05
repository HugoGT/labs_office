/**
 * Doors and windows (#223, #233, tile walls): a door or a window is an item
 * of the office decor layer (`officeDecor.ts`) that stands in a wall run
 * instead of on the floor. Its anchor is the wall tile (the tile a wall is
 * placed on, `wallPostTiles`) of its first column (rotations 0 and 180, a
 * horizontal run) or row (90 and 270, a vertical run), and it spans 2 wall
 * tiles from there, a double door 3 (`doorSpanOf`). Its rotation is the side
 * it opens into, the chair's facing (`decorChairFacing`: 0 down, 90 right,
 * 180 up, 270 left).
 *
 * It goes between two walls (`doorOnWall`, S7): the run holds a wall on every
 * tile of its span and on the tile past each end. In a horizontal run a door
 * takes the bottom two tiles of the wall and lets people through its whole
 * height (S10); in a vertical one it takes its own tiles, dark top included
 * (S9). A window only stands in a horizontal run (S8), never opens the wall,
 * and is drawn over its face (S11). A door or window placed over another
 * replaces it (S6, `doorsReplacedBy`), and the wall under one that goes stays.
 *
 * Shared by the room, the server's rules and the scene. Import-free like
 * `officeDecor.ts`: explicit `.ts` imports of other pure modules only.
 */

import { DOOR_FRONT, DOOR_STEPS, doorAxisOf, doorFrontInset, doorHingeOf, doorSpanAlong, doorSpanOf, doorVariantOf, VERTICAL_DOOR, verticalDoorLeaves, type DoorAxis, type DoorHinge } from './artContract.ts';
import { AVATAR_BODY_CENTER_OFFSET, type GeometryPoint } from './avatarGeometry.ts';
import { decorChairFacing, decorFootprint, isRotatable, rectTiles, type DecorEdit, type DecorItem, type DecorKind, type DecorTileRect } from './officeDecor.ts';
import { wallFootprintRects, type WallGrid, type WallOpening } from './officeLayout.ts';
import { coveredTiles, type CollisionRect } from './pieceCollisions.ts';

/** Same as `TILE` in mapData.ts (pinned by the tests through the footprint pixels). */
const DOOR_TILE = 32;

/** How far past its tiles, across the wall, an avatar's body center opens a door: it swings open just before someone reaches it. */
export const DOOR_OPEN_REACH_PX = 6;

const DOOR_PREFIX = 'door-';

type DoorPlacement = Pick<DecorItem, 'index' | 'rotation' | 'piece'>;

/** Whether a piece of the decor layer stands in a wall, a door or a window, by its id (`<kind>-<name>`). */
export function isDoorPiece(piece: string): boolean {
  return piece.startsWith(DOOR_PREFIX);
}

/** Whether a piece of the decor layer is a window (`door-<material>-window`): it stands in a wall but never opens it. */
export function isWindowPiece(piece: string): boolean {
  return isDoorPiece(piece) && doorVariantOf(piece) === 'window';
}

function anchorOf(item: Pick<DecorItem, 'index'>, width: number): { tx: number; ty: number } {
  return { tx: item.index % width, ty: Math.floor(item.index / width) };
}

/** How many wall tiles a door spans: 2 for a door or a window, 3 for a double door; a tile fewer in a vertical run (L41). */
export function doorSpan(item: Pick<DecorItem, 'piece' | 'rotation'>): number {
  return doorSpanAlong(doorAxis(item), doorSpanOf(item.piece));
}

/** The wall run a door stands in: horizontal for 0 and 180, vertical for 90 and 270. */
export function doorAxis(item: Pick<DecorItem, 'rotation'>): DoorAxis {
  return doorAxisOf(item.rotation);
}

/** The tile `step` wall tiles along a door's run from its anchor (negative: before it). */
function alongRun(item: DoorPlacement, width: number, step: number): { tx: number; ty: number } {
  const { tx, ty } = anchorOf(item, width);
  return doorAxis(item) === 'horizontal' ? { tx: tx + step, ty } : { tx, ty: ty + step };
}

/** The wall tiles (row major) a door spans, its start (west or north) first. */
export function doorTiles(item: DoorPlacement, width: number): number[] {
  return Array.from({ length: doorSpan(item) }, (_, step) => {
    const { tx, ty } = alongRun(item, width, step);
    return ty * width + tx;
  });
}

/** The two wall tiles just past the ends of a door's span, the walls it stands between: its start (west or north) first. */
export function doorEndPosts(item: DoorPlacement, width: number): [number, number] {
  const before = alongRun(item, width, -1);
  const after = alongRun(item, width, doorSpan(item));
  return [before.ty * width + before.tx, after.ty * width + after.tx];
}

/** Every wall tile a door needs, start first: the wall before it, the ones it spans and the wall after it. */
export function doorPosts(item: DoorPlacement, width: number): number[] {
  const [start, end] = doorEndPosts(item, width);
  return [start, ...doorTiles(item, width), end];
}

/**
 * Whether a door or window may stand where it is (S7, S8, S9, S10), the one
 * rule of the editor's ghost and the room: a wall, of any material, on every
 * tile it spans and on the tile past each end, all on the map. A window only
 * stands in a horizontal run. In a horizontal run, the columns it spans hold
 * that one wall and nothing stacked on it, so it stands in the wall's face; in
 * a vertical run, its tiles are above the run's face, in its dark top.
 */
export function doorOnWall(grid: Pick<WallGrid, 'width' | 'height' | 'walls'>, item: DoorPlacement): boolean {
  const { width, height, walls } = grid;
  const horizontal = doorAxis(item) === 'horizontal';
  if (!horizontal && isWindowPiece(item.piece)) return false;
  const standing = (tx: number, ty: number): boolean => tx >= 0 && ty >= 0 && tx < width && ty < height && walls[ty * width + tx] != null;
  const span = doorSpan(item);
  for (let step = -1; step <= span; step += 1) {
    const { tx, ty } = alongRun(item, width, step);
    if (!standing(tx, ty)) return false;
  }
  if (horizontal) {
    for (let step = 0; step < span; step += 1) {
      const { tx, ty } = alongRun(item, width, step);
      if ([ty - 2, ty - 1, ty + 1, ty + 2].some((row) => standing(tx, row))) return false;
    }
    return true;
  }
  // The run must still be covered two tiles under the door's last tile: its face is the run's bottom three tiles.
  const last = alongRun(item, width, span - 1);
  const below = last.ty + 3;
  return [below - 1, below, below + 1].some((row) => standing(last.tx, row));
}

/**
 * The tiles of a door's footprint (`decorFootprint`) that are its own wall:
 * the whole footprint in a horizontal run, the column in a vertical one. The
 * room's and the ghost's "off every wall tile" rule skips them; a vertical
 * door's tiles on each side, where its leaf swings, keep it.
 */
export function doorOwnWallTiles(item: DoorPlacement, width: number): Set<number> {
  const rect = decorFootprint(item, { kind: 'door', footprint: { w: doorSpanOf(item.piece), h: 1 } }, width);
  const own = doorAxis(item) === 'horizontal' ? rect : { ...rect, x: rect.x + 1, w: 1 };
  return new Set(rectTiles(own, width));
}

/**
 * How far past its end, into the doorway, a door's hinge blocks: the jamb
 * and the thickness of the open leaf (`DOOR`: 10 + 6px), so a body leaving
 * along the hinge keeps off the open leaf.
 */
export const DOOR_HINGE_STOP_PX = 16;

/**
 * The strips each door on its wall (`doorOnWall`) blocks past its hinge end:
 * `DOOR_HINGE_STOP_PX` along the doorway from that end, the whole doorway
 * across (the wall's three tiles in a horizontal run, the column in a
 * vertical one). A single door has one hinge (`doorHingeOf`), a double door
 * one at each end; a window has none. A horizontal door narrower than its
 * span (`doorFrontInset`: a single door, 1.2 tiles of doorway in 2) blocks
 * the wall left at each end and its frame's jamb instead, at both ends.
 * Arcade and the auto-walk only: the room checks the body center, and the
 * client is the stricter side.
 */
export function doorHingeStops(items: readonly DecorItem[], grid: Pick<WallGrid, 'width' | 'height' | 'walls'>): CollisionRect[] {
  return items.flatMap((item) => {
    if (!isDoorPiece(item.piece) || isWindowPiece(item.piece) || !doorOnWall(grid, item)) return [];
    const { tx, ty } = anchorOf(item, grid.width);
    const span = doorSpan(item);
    const inset = doorFrontInset(item.piece);
    if (doorAxis(item) === 'horizontal' && inset > 0) {
      // Narrower than its span: the wall left at each end and the frame's jamb block, whichever the hinge.
      const w = inset + DOOR_FRONT.frame;
      return [tx * DOOR_TILE, (tx + span) * DOOR_TILE - w].map((x): CollisionRect => ({ x, y: (ty - 1) * DOOR_TILE, w, h: 3 * DOOR_TILE }));
    }
    if (doorAxis(item) === 'vertical') {
      // Where the art hangs the leaves (`verticalDoorLeaves`): every vertical door from its upper post at
      // the span's top, half the open leaf's thickness into the doorway; a double door's lower leaf hangs
      // from under the wall below. Whatever the hinge (L41).
      const top = ty * DOOR_TILE;
      return verticalDoorLeaves(doorVariantOf(item.piece), top)
        .filter(({ hingeY }) => hingeY >= top && hingeY < top + span * DOOR_TILE)
        .map(({ hingeY }): CollisionRect => ({ x: tx * DOOR_TILE, y: hingeY, w: DOOR_TILE, h: VERTICAL_DOOR.leafThickness / 2 }));
    }
    const hinges: DoorHinge[] = doorVariantOf(item.piece) === 'double' ? ['start', 'end'] : [doorHingeOf(item.piece, item.rotation)];
    return hinges.map((hinge): CollisionRect => {
      const x = hinge === 'start' ? tx * DOOR_TILE : (tx + span) * DOOR_TILE - DOOR_HINGE_STOP_PX;
      return { x, y: (ty - 1) * DOOR_TILE, w: DOOR_HINGE_STOP_PX, h: 3 * DOOR_TILE };
    });
  });
}

/**
 * The openings the doors of a decor layer make in the walls of `grid`, in
 * layer order: every door standing on its wall (`doorOnWall`). A window
 * opens nothing, and a stored door off its wall opens nothing either.
 */
export function doorOpenings(items: readonly DecorItem[], grid: Pick<WallGrid, 'width' | 'height' | 'walls'>): WallOpening[] {
  return items.flatMap((item): WallOpening[] => {
    if (!isDoorPiece(item.piece) || isWindowPiece(item.piece) || !doorOnWall(grid, item)) return [];
    const { tx, ty } = anchorOf(item, grid.width);
    const axis = doorAxis(item);
    const inset = axis === 'horizontal' ? doorFrontInset(item.piece) : 0;
    return [{ axis, tx, ty, span: doorSpan(item), ...(inset > 0 ? { inset } : {}) }];
  });
}

/**
 * The tiles a wall touches once the decor layer is `after` (#223): a door
 * that goes away closes its wall again, so whatever takes its tiles must
 * keep off them like off any wall. The ground's own `wallTiles` when the
 * doors open the same (the usual case), or when it has no walls to rebuild
 * from. Shared by the editor's ghost and the room's decor rule.
 */
export function wallTilesAfter(
  ground: Pick<WallGrid, 'width' | 'height'> & { readonly walls?: WallGrid['walls']; readonly openings?: readonly WallOpening[]; readonly wallTiles: readonly boolean[] },
  after: readonly DecorItem[],
): readonly boolean[] {
  if (ground.walls === undefined) return ground.wallTiles;
  const { width, height, walls } = ground;
  const openings = doorOpenings(after, { width, height, walls });
  if (JSON.stringify(openings) === JSON.stringify(ground.openings ?? [])) return ground.wallTiles;
  return coveredTiles(wallFootprintRects({ width, height, walls, openings }), width, height);
}

/**
 * Whether a picked piece turns (the wheel, R): what turns of its kind
 * (`isRotatable`), but a window never does, it only stands in a horizontal
 * run (S8, L23).
 */
export function decorPieceTurns(piece: string, kind: DecorKind): boolean {
  return isRotatable(kind) && !isWindowPiece(piece);
}

/**
 * Whether walls `after` would leave a door or window of `items` that stands
 * on its wall now (`doorOnWall`) off it. `doorPostSet` guards the span and
 * its ends; a vertical door also needs its run to go on below it, to its
 * face, which only this catches.
 */
export function doorsLeftOffWall(items: readonly DecorItem[], grid: Pick<WallGrid, 'width' | 'height' | 'walls'>, after: WallGrid['walls']): boolean {
  return items.some((item) => isDoorPiece(item.piece) && doorOnWall(grid, item) && !doorOnWall({ ...grid, walls: after }, item));
}

/** Every wall tile a door or window needs (`doorPosts`): removing one would leave it off its wall (repainting one keeps it). */
export function doorPostSet(items: readonly DecorItem[], width: number): Set<number> {
  return new Set(items.flatMap((item) => (isDoorPiece(item.piece) ? doorPosts(item, width) : [])));
}

/**
 * The anchors of the doors and windows of `items` that the ones `placed`
 * replace (S6): every other one sharing a wall tile with one of them
 * (`doorTiles`). A door takes the place of a window and the other way round;
 * the wall under them stays. A door over a door, or a window over a window
 * (L23), replaces nothing and is refused like any two pieces on the same
 * tiles.
 */
export function doorsReplacedBy(items: readonly DecorItem[], placed: readonly DoorPlacement[], width: number): number[] {
  const placedDoors = placed.filter((item) => isDoorPiece(item.piece));
  if (placedDoors.length === 0) return [];
  const anchors = new Set(placedDoors.map((item) => item.index));
  return items
    .filter(
      (item) =>
        isDoorPiece(item.piece) &&
        !anchors.has(item.index) &&
        placedDoors.some((door) => isWindowPiece(door.piece) !== isWindowPiece(item.piece) && doorTiles(item, width).some((tile) => doorTiles(door, width).includes(tile))),
    )
    .map((item) => item.index);
}

/** The edits of a click with the removals of the doors and windows its placements replace (`doorsReplacedBy`), so the preview shows them gone too. */
export function withReplacedDoors(items: readonly DecorItem[], click: readonly DecorEdit[], width: number): DecorEdit[] {
  const placed = click.flatMap((edit): DoorPlacement[] => (edit.item === null ? [] : [{ index: edit.index, ...edit.item }]));
  const leaving = new Set(click.filter((edit) => edit.item === null).map((edit) => edit.index));
  const replaced = doorsReplacedBy(items, placed, width).filter((index) => !leaving.has(index));
  return [...click, ...replaced.map((index): DecorEdit => ({ index, item: null }))];
}

/**
 * One door as drawn: its wall run, its first wall tile, its span, its
 * footprint (`decorFootprint`: the wall's three tiles across a horizontal
 * run, the column and a tile on each side of a vertical one) and the side it
 * opens to (its rotation). A single door hinges at the end its rotation puts
 * it at (`doorHingeOf`); a double door is drawn whole. A window is no leaf.
 */
export interface DoorLeaf {
  readonly index: number;
  readonly piece: string;
  readonly rotation: DecorItem['rotation'];
  readonly axis: DoorAxis;
  readonly tx: number;
  readonly ty: number;
  readonly span: number;
  readonly footprint: DecorTileRect;
  readonly hinge: DoorHinge;
}

/** The doors of the layer, in layer order; windows never open, so they are none. */
export function doorLeaves(items: readonly DecorItem[], width: number): DoorLeaf[] {
  return items
    .filter((item) => isDoorPiece(item.piece) && !isWindowPiece(item.piece))
    .map((item) => {
      const { tx, ty } = anchorOf(item, width);
      const span = doorSpan(item);
      const footprint = decorFootprint(item, { kind: 'door', footprint: { w: doorSpanOf(item.piece), h: 1 } }, width);
      return { index: item.index, piece: item.piece, rotation: item.rotation, axis: doorAxis(item), tx, ty, span, footprint, hinge: doorHingeOf(item.piece, item.rotation) };
    });
}

/** The line across the middle of a door's footprint, in world pixels: y for a horizontal run, x for a vertical one. */
export function doorLine(leaf: DoorLeaf): number {
  const { x, y, w, h } = leaf.footprint;
  return leaf.axis === 'horizontal' ? (y + h / 2) * DOOR_TILE : (x + w / 2) * DOOR_TILE;
}

/** Which side of its wall an open leaf swings to: the side it faces (`inside`), or the other one. */
export type DoorSwing = 'inside' | 'outside';

/**
 * The rotation to draw a leaf with when it swings to `swing`: its own
 * rotation for `inside`, turned half way round for `outside`. The open frame
 * of the opposite rotation keeps the hinge at the same world end
 * (`doorFrameIndex`), so no extra art is needed (S14).
 */
export function doorSwingRotation(rotation: DecorItem['rotation'], swing: DoorSwing): DecorItem['rotation'] {
  return swing === 'inside' ? rotation : (((rotation + 180) % 360) as DecorItem['rotation']);
}

/**
 * The doors drawn open, each with the side it swings to (#223, S14): every
 * one a body (the center of each network position) is about to cross, lined
 * up with its span along the wall and on the footprint's tiles across it or
 * within `DOOR_OPEN_REACH_PX` of them; walking past alongside the wall opens
 * nothing. A door swings away from the side its walker comes from. `previous` is the result of the last call: a door
 * already open keeps its swing until it closes, so it does not flip when the
 * body center passes the door's line mid crossing. Two bodies from opposite
 * sides get that kept swing, else the one of the first body (in `positions`
 * order) that opens it. Drawing only: a door never blocks anyone, open or
 * closed. `keptShut` names the avatars a door does not open for (a locked
 * space behind it, `spaceLocks.ts`); one lined up with it opens it for no one.
 */
export function openDoorLeaves(
  leaves: readonly DoorLeaf[],
  positions: readonly GeometryPoint[],
  previous: ReadonlyMap<number, DoorSwing> = new Map(),
  keptShut: (leaf: DoorLeaf, position: GeometryPoint) => boolean = () => false,
): Map<number, DoorSwing> {
  const open = new Map<number, DoorSwing>();
  for (const leaf of leaves) {
    const openers = positions.filter((position) => !keptShut(leaf, position)).map(bodyCenter).filter((center) => liningUp(leaf, center));
    if (openers.length === 0) continue;
    open.set(leaf.index, previous.get(leaf.index) ?? (sideOf(leaf, openers[0]!) > 0 ? 'outside' : 'inside'));
  }
  return open;
}

/** How long a door takes to swing from shut to fully open, or back (#233). */
export const DOOR_SWING_MS = 180;

/** How long a door stays fully open after nobody is lined up with it any more, before it starts to close (#233). */
export const DOOR_HOLD_MS = 360;

/**
 * One door's swing: the side it turns to, how far open it is (0 shut to 1
 * fully open) and the hold it still owes at fully open: set while someone is
 * lined up with it, used up once it is wide open and nobody is. A door with
 * hold left and not yet fully open is opening; with none, closing.
 */
export interface DoorMotion {
  readonly swing: DoorSwing;
  readonly progress: number;
  readonly hold: number;
}

/**
 * The sides doors are still committed to: those showing a swung frame. One
 * drawn shut is free to take the side of whoever opens it next, since the
 * closed frames of both sides are the same. What `openDoorLeaves` gets as
 * `previous`, and what `moveDoors` keeps.
 */
export function keptSwings(motion: ReadonlyMap<number, DoorMotion>): Map<number, DoorSwing> {
  return new Map([...motion].filter(([, { progress }]) => doorStepOf(progress) > 0).map(([index, { swing }]) => [index, swing]));
}

/**
 * The swing of every door after `dtMs` more. A door someone is lined up with
 * (`targets`, from `openDoorLeaves`) opens. Once nobody is, it still opens
 * the rest of the way, waits `DOOR_HOLD_MS` wide open and only then closes, so
 * it never swings back on whoever just went through. A door keeps the side it
 * swings to for as long as it shows a swung frame, so it never flips mid
 * swing; one drawn shut takes the side of whoever opens it. A door that
 * finishes shutting is dropped.
 */
export function moveDoors(targets: ReadonlyMap<number, DoorSwing>, motion: ReadonlyMap<number, DoorMotion>, dtMs: number): Map<number, DoorMotion> {
  const next = new Map<number, DoorMotion>();
  const kept = keptSwings(motion);
  for (const index of new Set([...targets.keys(), ...motion.keys()])) {
    const before = motion.get(index);
    const target = targets.get(index);
    if (target !== undefined) {
      next.set(index, { swing: kept.get(index) ?? target, progress: Math.min(1, (before?.progress ?? 0) + dtMs / DOOR_SWING_MS), hold: DOOR_HOLD_MS });
    } else if (before !== undefined) {
      // What is left of the time goes to each stage in turn: finish opening, wait, close.
      let left = dtMs;
      let { progress, hold } = before;
      if (hold > 0) {
        const toOpen = (1 - progress) * DOOR_SWING_MS;
        // Exactly 1 once there, so the hold starts on the same frame whatever the float arithmetic says.
        if (left >= toOpen) {
          progress = 1;
          left -= toOpen;
        } else {
          progress += left / DOOR_SWING_MS;
          left = 0;
        }
        const waited = progress === 1 ? Math.min(left, hold) : 0;
        hold -= waited;
        left -= waited;
      }
      if (hold === 0) progress -= left / DOOR_SWING_MS;
      if (progress > 0) next.set(index, { swing: before.swing, progress: Math.min(1, progress), hold });
    }
  }
  return next;
}

/** The frame of a swing (`doorFrameIndex`'s step): the nearest of closed, the two between and open. */
export function doorStepOf(progress: number): number {
  return Math.round(progress * (DOOR_STEPS - 1));
}

/**
 * Where a door leads a body at network position `position` lined up with it
 * (`openDoorLeaves`): the middle of the tile just past the wall on the other
 * side from the body center, along that center. `null` for a body not lined
 * up with it.
 */
export function doorFarSide(leaf: DoorLeaf, position: GeometryPoint): GeometryPoint | null {
  const center = bodyCenter(position);
  if (!liningUp(leaf, center)) return null;
  const line = doorLine(leaf);
  // Past the wall: the row past a horizontal run's three tiles, the column beside a vertical one.
  const reach = leaf.axis === 'horizontal' ? 2 * DOOR_TILE : DOOR_TILE;
  if (leaf.axis === 'horizontal') return { x: center.x, y: center.y < line ? line + reach : line - reach };
  return { x: center.x < line ? line + reach : line - reach, y: center.y };
}

/** Whether a body center is lined up with a door's span and on its footprint across it, or a few pixels past it. */
function liningUp(leaf: DoorLeaf, center: GeometryPoint): boolean {
  const horizontal = leaf.axis === 'horizontal';
  const [along, across] = horizontal ? [center.x, center.y] : [center.y, center.x];
  const { x, y, w, h } = leaf.footprint;
  const [start, end, near, far] = horizontal ? [x, x + w, y, y + h] : [y, y + h, x, x + w];
  return along >= start * DOOR_TILE && along < end * DOOR_TILE && across > near * DOOR_TILE - DOOR_OPEN_REACH_PX && across < far * DOOR_TILE + DOOR_OPEN_REACH_PX;
}

/** The body center of an avatar at a network position: what the room checks a move by. */
function bodyCenter(position: GeometryPoint): GeometryPoint {
  return { x: position.x + AVATAR_BODY_CENTER_OFFSET.x, y: position.y + AVATAR_BODY_CENTER_OFFSET.y };
}

/** How far `point` is on the side a leaf opens to: positive there, zero on the door's line (`doorLine`), negative on the other side. */
function sideOf(leaf: DoorLeaf, point: GeometryPoint): number {
  const facing = decorChairFacing(leaf.rotation);
  const sign = facing === 'down' || facing === 'right' ? 1 : -1;
  return ((leaf.axis === 'horizontal' ? point.y : point.x) - doorLine(leaf)) * sign;
}
