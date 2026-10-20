import { describe, expect, it } from 'vitest';
import { createCharacterUpdatesHub, type CharacterRoom } from './characterUpdates.ts';

function recordingRoom(name: string, seen: string[]): CharacterRoom {
  return {
    retireCharacter: (piece, fallback) => void seen.push(`${name}:retire ${piece}>${fallback}`),
    changeCharacterOf: (uid, avatarId) => void seen.push(`${name}:change ${uid}>${avatarId}`),
  };
}

describe('character updates hub (#122, creator)', () => {
  it('forwards a retirement to every registered room until it unregisters', () => {
    const hub = createCharacterUpdatesHub();
    const seen: string[] = [];
    hub.register(recordingRoom('a', seen));
    const unregister = hub.register(recordingRoom('b', seen));

    hub.retireCharacter('character-upload-1', 'character-p01');
    unregister();
    hub.retireCharacter('character-upload-2', 'character-p01');

    expect(seen).toEqual([
      'a:retire character-upload-1>character-p01',
      'b:retire character-upload-1>character-p01',
      'a:retire character-upload-2>character-p01',
    ]);
  });

  it('forwards a new character of one account to every registered room', () => {
    const hub = createCharacterUpdatesHub();
    const seen: string[] = [];
    hub.register(recordingRoom('a', seen));
    hub.register(recordingRoom('b', seen));

    hub.changeCharacterOf('uid-ana', 'character-custom-0123');

    expect(seen).toEqual(['a:change uid-ana>character-custom-0123', 'b:change uid-ana>character-custom-0123']);
  });

  it('one room failing does not spare the others', () => {
    const hub = createCharacterUpdatesHub();
    const seen: string[] = [];
    const failing: CharacterRoom = {
      retireCharacter: () => {
        throw new Error('boom');
      },
      changeCharacterOf: () => {
        throw new Error('bang');
      },
    };
    hub.register(failing);
    hub.register(recordingRoom('ok', seen));

    expect(() => hub.retireCharacter('character-upload-1', 'character-p01')).toThrow('boom');
    expect(() => hub.changeCharacterOf('uid-ana', 'character-p02')).toThrow('bang');
    expect(seen).toEqual(['ok:retire character-upload-1>character-p01', 'ok:change uid-ana>character-p02']);
  });
});
