import { describe, expect, it } from 'vitest';
import { nextRoomName } from './roomNames';

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
