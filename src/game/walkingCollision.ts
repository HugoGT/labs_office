import type { GeometryBox } from './avatarGeometry';

function interval(start: number, size: number, obstacle: number, extent: number, delta: number): [number, number] {
  if (delta === 0) return start + size > obstacle && start < obstacle + extent
    ? [-Infinity, Infinity] : [Infinity, -Infinity];
  const a = (obstacle - start - size) / delta;
  const b = (obstacle + extent - start) / delta;
  return [Math.min(a, b), Math.max(a, b)];
}

/** Only contacts discrete Arcade would miss. Normal overlaps retain Arcade's wall sliding. */
export function walkingSweepFraction(body: GeometryBox, dx: number, dy: number, obstacle: GeometryBox): number {
  const x = body.x + dx;
  const y = body.y + dy;
  if (x + body.width > obstacle.x && x < obstacle.x + obstacle.width &&
    y + body.height > obstacle.y && y < obstacle.y + obstacle.height) return 1;
  const [enterX, exitX] = interval(body.x, body.width, obstacle.x, obstacle.width, dx);
  const [enterY, exitY] = interval(body.y, body.height, obstacle.y, obstacle.height, dy);
  const enter = Math.max(enterX, enterY);
  const exit = Math.min(exitX, exitY);
  // Half-open boxes: a tangent is not an overlap; existing overlaps are Arcade's job.
  return enter >= 0 && enter < 1 && enter < exit ? enter : 1;
}
