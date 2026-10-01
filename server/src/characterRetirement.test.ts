import { describe, expect, it } from 'vitest';
import { createCharacterRetirementHub } from './characterRetirement.ts';

describe('characterRetirement hub (#122)', () => {
  it('forwards a retirement to every registered room until it unregisters', () => {
    const hub = createCharacterRetirementHub();
    const seen: string[] = [];
    hub.register((piece, fallback) => seen.push(`a:${piece}>${fallback}`));
    const unregister = hub.register((piece, fallback) => seen.push(`b:${piece}>${fallback}`));

    hub.retireCharacter('character-upload-1', 'character-p01');
    unregister();
    hub.retireCharacter('character-upload-2', 'character-p01');

    expect(seen).toEqual(['a:character-upload-1>character-p01', 'b:character-upload-1>character-p01', 'a:character-upload-2>character-p01']);
  });

  it('one room failing does not spare the others', () => {
    const hub = createCharacterRetirementHub();
    const seen: string[] = [];
    hub.register(() => {
      throw new Error('boom');
    });
    hub.register((piece) => seen.push(piece));

    expect(() => hub.retireCharacter('character-upload-1', 'character-p01')).toThrow('boom');
    expect(seen).toEqual(['character-upload-1']);
  });
});
