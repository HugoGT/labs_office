import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FACING,
  DEFAULT_STATUS,
  DO_NOT_DISTURB,
  FACINGS,
  LIVEKIT_ROOM_NAME,
  PRESENCE_STATUSES,
  RECORDING_RETENTION_DAYS,
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
