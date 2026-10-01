import { describe, expect, it } from 'vitest';
import {
  ACCESS_DENIED_CODE,
  ACCESS_DENIED_REASONS,
  DEFAULT_FACING,
  DEFAULT_STATUS,
  DO_NOT_DISTURB,
  FACINGS,
  LIVEKIT_ROOM_NAME,
  PRESENCE_STATUSES,
  RECORDING_RETENTION_DAYS,
  accessDeniedReasonOf,
  characterIdOf,
  facingFrom,
  isPresenceStatus,
  livekitRoomFor,
  recordingAvailableUntil,
} from './officeProtocol';

describe('facingFrom', () => {
  it('deriva la orientacion del eje dominante del movimiento', () => {
    expect(facingFrom(-1, 0, DEFAULT_FACING)).toBe('left');
    expect(facingFrom(1, 0, DEFAULT_FACING)).toBe('right');
    expect(facingFrom(0, -1, DEFAULT_FACING)).toBe('up');
    expect(facingFrom(0, 1, DEFAULT_FACING)).toBe('down');
  });

  it('en diagonal manda el eje horizontal', () => {
    // Elegir uno es arbitrario, pero tiene que ser estable: alternar entre los
    // dos ejes haria parpadear el sprite en cada diagonal.
    expect(facingFrom(1, 1, DEFAULT_FACING)).toBe('right');
    expect(facingFrom(-1, -1, DEFAULT_FACING)).toBe('left');
  });

  it('quieto conserva la orientacion previa en vez de volver al valor por defecto', () => {
    // Soltar la tecla no puede girar al personaje de golpe hacia el sur.
    expect(facingFrom(0, 0, 'left')).toBe('left');
    expect(facingFrom(0, 0, 'up')).toBe('up');
  });

  it('todo resultado posible esta dentro del enumerado que el servidor acepta', () => {
    const results = [
      facingFrom(-1, 0, DEFAULT_FACING),
      facingFrom(1, 0, DEFAULT_FACING),
      facingFrom(0, -1, DEFAULT_FACING),
      facingFrom(0, 1, DEFAULT_FACING),
      facingFrom(0, 0, DEFAULT_FACING),
    ];

    for (const result of results) expect(FACINGS).toContain(result);
  });
});

describe('vocabulario de presencia', () => {
  it('declara los tres estados del PRD, con "En linea" como valor por defecto', () => {
    expect(PRESENCE_STATUSES).toEqual(['g', 'y', 'r']);
    expect(DEFAULT_STATUS).toBe('g');
  });

  it('nombra "No molestar" en vez de repetir el literal "r" por el codigo', () => {
    // Es el unico estado con efecto sobre el audio: cada sitio que decide
    // cortar audio compara contra esta constante, no contra una letra suelta.
    expect(DO_NOT_DISTURB).toBe('r');
    expect(PRESENCE_STATUSES).toContain(DO_NOT_DISTURB);
  });

  it('isPresenceStatus acepta los tres codigos y rechaza cualquier otra cosa', () => {
    for (const status of PRESENCE_STATUSES) expect(isPresenceStatus(status)).toBe(true);

    // Lo que llega por el cable no es de fiar: el servidor lo usa para decidir
    // si escribe el estado, y el cliente para elegir un color.
    expect(isPresenceStatus('G')).toBe(false);
    expect(isPresenceStatus('ocupado')).toBe(false);
    expect(isPresenceStatus('')).toBe(false);
    expect(isPresenceStatus(null)).toBe(false);
    expect(isPresenceStatus(undefined)).toBe(false);
    expect(isPresenceStatus(0)).toBe(false);
    expect(isPresenceStatus({ status: 'g' })).toBe(false);
  });
});

describe('livekitRoomFor', () => {
  it('null (fuera de todo espacio) da la sala corredor compartida', () => {
    expect(livekitRoomFor(null)).toBe(LIVEKIT_ROOM_NAME);
    expect(livekitRoomFor(null)).toBe('office-livekit');
  });

  it('un spaceId da una sala con prefijo propio, distinta del corredor', () => {
    expect(livekitRoomFor('s1')).toBe('office-livekit-space-s1');
    expect(livekitRoomFor('s1')).not.toBe(LIVEKIT_ROOM_NAME);
  });

  it('dos spaceId distintos dan dos salas distintas (namespacing, no una constante)', () => {
    expect(livekitRoomFor('s1')).not.toBe(livekitRoomFor('s2'));
  });
});

describe('recording retention (#5, #58)', () => {
  it('keeps a recording for 30 days, the age at which the bucket lifecycle deletes it', () => {
    expect(RECORDING_RETENTION_DAYS).toBe(30);
  });

  it('a recording is available until 30 days after it stopped', () => {
    const stoppedAt = Date.UTC(2026, 8, 23, 10, 0, 0);

    expect(recordingAvailableUntil(stoppedAt)).toBe(Date.UTC(2026, 9, 23, 10, 0, 0));
  });
});

describe('characterIdOf (art migration, step 5)', () => {
  it('passes a pack character id through', () => {
    expect(characterIdOf('character-p07-green-suit')).toBe('character-p07-green-suit');
  });

  it.each([[undefined], [null], [7], [''], ['desk-wood'], ['character-'], ['character-../x'], ['character-P07'], [`character-${'a'.repeat(80)}`]])(
    'reads %j as no character, so the office draws the pack default',
    (raw) => {
      expect(characterIdOf(raw)).toBeNull();
    },
  );
});

describe('accessDeniedReasonOf (#129)', () => {
  it('rides on the HTTP status a join refusal already uses', () => {
    expect(ACCESS_DENIED_CODE).toBe(401);
  });

  it.each(ACCESS_DENIED_REASONS.map((reason) => [reason]))('reads %j back as itself', (reason) => {
    expect(accessDeniedReasonOf(reason)).toBe(reason);
  });

  it('knows why the directory closes the door', () => {
    expect(ACCESS_DENIED_REASONS).toEqual(
      expect.arrayContaining(['unauthorized', 'expired', 'revoked', 'not-provisioned']),
    );
  });

  it('knows that a session older than its maximum age is refused (#128)', () => {
    expect(ACCESS_DENIED_REASONS).toContain('session-expired');
  });

  it.each([[undefined], [null], [401], [''], ['onAuth failed'], ['EXPIRED']])(
    'reads %j as the generic refusal, never as a reason it does not know',
    (raw) => {
      expect(accessDeniedReasonOf(raw)).toBe('unauthorized');
    },
  );
});
