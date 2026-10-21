import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM_NAME, freeRoomName, nextRoomName } from './roomNames';

/** The name "Múltiple" gives the next room created in a row (#207). */
describe('nextRoomName', () => {
  it.each([
    ['Sala 1', 'Sala 2'],
    ['Sala 9', 'Sala 10'],
    ['Reunión 41', 'Reunión 42'],
    ['Sala 09', 'Sala 10'],
    ['Sala 007', 'Sala 008'],
    ['Piso2', 'Piso3'],
    ['  Sala 3  ', 'Sala 4'],
  ])('increments the trailing number: %j -> %j', (name, next) => {
    expect(nextRoomName(name)).toBe(next);
  });

  it.each([
    ['Sala', 'Sala 2'],
    ['Cafetería', 'Cafetería 2'],
    ['Sala 1 norte', 'Sala 1 norte 2'],
  ])('appends " 2" to a name with no trailing number: %j -> %j', (name, next) => {
    expect(nextRoomName(name)).toBe(next);
  });
});

/** The name the room form starts with and the next one "Múltiple" places: never one another room holds. */
describe('freeRoomName', () => {
  it('keeps a name no room holds', () => {
    expect(freeRoomName(DEFAULT_ROOM_NAME, [])).toBe('Sala 1');
    expect(freeRoomName('Sala 1', ['Sala grande'])).toBe('Sala 1');
  });

  it('skips the names other rooms hold, ignoring case and surrounding spaces', () => {
    expect(freeRoomName('Sala 1', ['Sala 1', 'Sala 2'])).toBe('Sala 3');
    expect(freeRoomName('Sala 1', [' sala 1 ', 'SALA 2'])).toBe('Sala 3');
  });

  it('takes the first gap', () => {
    expect(freeRoomName('Sala 1', ['Sala 1', 'Sala 3'])).toBe('Sala 2');
  });

  it('skips from a name with no number too', () => {
    expect(freeRoomName('Sala', ['Sala', 'Sala 2'])).toBe('Sala 3');
  });
});
