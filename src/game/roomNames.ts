/**
 * The name of the next room "Múltiple" places (#207): room names are unique
 * (`space-name-taken`), so each room created in a row gets the previous
 * one's name with its trailing number incremented ("Sala 1" -> "Sala 2",
 * zero padding kept: "Sala 09" -> "Sala 10"), or " 2" appended when it has
 * none ("Sala" -> "Sala 2"). Import-free.
 */
export function nextRoomName(name: string): string {
  const trimmed = name.trim();
  const match = /^(.*?)(\d+)$/.exec(trimmed);
  if (match === null) return `${trimmed} 2`;
  const [, prefix = '', digits = ''] = match;
  return `${prefix}${String(Number(digits) + 1).padStart(digits.length, '0')}`;
}

/** What the room form offers before anyone types a name. */
export const DEFAULT_ROOM_NAME = 'Sala 1';

/**
 * `name` when no room in `taken` holds it, else the first name after it, by
 * `nextRoomName`, that none holds. Compared trimmed and case-insensitively,
 * like the server's uniqueness, so the form never offers a name it refuses.
 */
export function freeRoomName(name: string, taken: readonly string[]): string {
  const held = new Set(taken.map((other) => other.trim().toLowerCase()));
  let free = name.trim();
  // Bounded: at most every taken name lies on the way.
  for (let tries = 0; tries <= held.size && held.has(free.toLowerCase()); tries++) free = nextRoomName(free);
  return free;
}
