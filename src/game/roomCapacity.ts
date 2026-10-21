/**
 * The most people the room form lets a room hold: one more than its longer
 * side. A UI default and limit only; the server still takes any capacity.
 * Import-free.
 */
export function roomCapacityMax(w: number, h: number): number {
  return Math.max(w, h) + 1;
}
