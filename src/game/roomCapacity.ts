/**
 * The capacity the room form offers for a new room: one more than its longer
 * side. A default only, never a limit: the admin may type any larger number,
 * and the server takes any capacity. Import-free.
 */
export function defaultRoomCapacity(w: number, h: number): number {
  return Math.max(w, h) + 1;
}
