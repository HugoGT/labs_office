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
