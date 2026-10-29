import type { GeometryBox } from './avatarGeometry';

/**
 * Gap the walk leaves between the body and what it stops against, far wider
 * than float noise. Arcade then never sees an overlap to separate: its
 * Y-first separation catches the seam between two rectangles of one wall and
 * stops a diagonal slide there (#252).
 */
export const WALKING_SKIN_PX = 1e-4;

type Axis = 'x' | 'y';

function interval(start: number, size: number, obstacle: number, extent: number, delta: number): [number, number] {
  if (delta === 0) return start + size > obstacle && start < obstacle + extent
    ? [-Infinity, Infinity] : [Infinity, -Infinity];
  const a = (obstacle - start - size) / delta;
  const b = (obstacle + extent - start) / delta;
  return [Math.min(a, b), Math.max(a, b)];
}

/** Where the body stops on `axis` short of `obstacle`, never behind where it already is. */
function stopBefore(from: number, size: number, delta: number, obstacle: number, extent: number): number {
  return delta > 0
    ? Math.max(from, obstacle - size - WALKING_SKIN_PX)
    : Math.min(from, obstacle + extent + WALKING_SKIN_PX);
}

/**
 * The step the body can take toward `dx`, `dy`: each obstacle it would touch
 * cancels only the component that enters it, and the other one keeps going
 * (#252). Swept, so contacts discrete Arcade would miss between samples count
 * too (#145). Obstacles the body already overlaps stay Arcade's job.
 */
export function slideWalking(body: GeometryBox, dx: number, dy: number, obstacles: readonly GeometryBox[]): { dx: number; dy: number } {
  let stopX: number | undefined;
  let stopY: number | undefined;
  let elapsed = 0;
  // Each pass stops at most one more axis; a third has nothing left to stop.
  for (let pass = 0; pass < 2; pass++) {
    const x = stopX ?? body.x + dx * elapsed;
    const y = stopY ?? body.y + dy * elapsed;
    const ex = stopX === undefined ? dx * (1 - elapsed) : 0;
    const ey = stopY === undefined ? dy * (1 - elapsed) : 0;
    if (ex === 0 && ey === 0) break;
    let first = Infinity;
    let hits: { obstacle: GeometryBox; axis: Axis | 'corner' }[] = [];
    for (const obstacle of obstacles) {
      const [enterX, exitX] = interval(x, body.width, obstacle.x, obstacle.width, ex);
      const [enterY, exitY] = interval(y, body.height, obstacle.y, obstacle.height, ey);
      const enter = Math.max(enterX, enterY);
      // Half-open boxes: a tangent is not a contact; existing overlaps are Arcade's job.
      if (!(enter >= 0 && enter <= 1 && enter < Math.min(exitX, exitY)) || enter > first) continue;
      if (enter < first) hits = [];
      first = enter;
      hits.push({ obstacle, axis: enterX === enterY ? 'corner' : enterX > enterY ? 'x' : 'y' });
    }
    if (hits.length === 0) break;
    // A face decides over a corner hit at the same time: the body slides along
    // that face. Only a bare corner is a tie, and it lets the larger component
    // through so a corner never traps the body.
    let faces = hits.filter((hit) => hit.axis !== 'corner');
    if (faces.length === 0) {
      const axis: Axis = Math.abs(ey) > Math.abs(ex) ? 'x' : 'y';
      faces = hits.map((hit) => ({ ...hit, axis }));
    }
    for (const { obstacle, axis } of faces) {
      if (axis === 'x' && stopX === undefined) stopX = stopBefore(x, body.width, ex, obstacle.x, obstacle.width);
      if (axis === 'y' && stopY === undefined) stopY = stopBefore(y, body.height, ey, obstacle.y, obstacle.height);
    }
    elapsed += (1 - elapsed) * first;
  }
  return {
    dx: stopX === undefined ? dx : stopX - body.x,
    dy: stopY === undefined ? dy : stopY - body.y,
  };
}
