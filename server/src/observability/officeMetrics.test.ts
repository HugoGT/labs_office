import { describe, expect, it } from 'vitest';
import { LIVEKIT_ROOM_NAME, livekitRoomFor } from '../../../src/game/officeProtocol.ts';
import { createOfficeMetrics, playersByRoom } from './officeMetrics.ts';

const SALA = { id: 'sala-1', name: 'Sala', x: 100, y: 100, w: 100, h: 100 };

describe('playersByRoom', () => {
  it('counts each player in the LiveKit room of the space they stand in, the corridor outside', () => {
    const rooms = playersByRoom([{ x: 150, y: 150 }, { x: 160, y: 120 }, { x: 10, y: 10 }], [SALA]);
    expect(rooms).toEqual(new Map([[livekitRoomFor('sala-1'), 2], [LIVEKIT_ROOM_NAME, 1]]));
  });

  it('is empty with nobody in the office', () => {
    expect(playersByRoom([], [SALA]).size).toBe(0);
  });
});

describe('createOfficeMetrics', () => {
  const empty = { playersByRoom: new Map<string, number>(), activeRecordings: 0 };

  it('renders players per room and active recordings in the Prometheus text format', () => {
    const text = createOfficeMetrics().render({
      playersByRoom: new Map([[LIVEKIT_ROOM_NAME, 3], [livekitRoomFor('sala-1'), 2]]),
      activeRecordings: 1,
    });
    expect(text).toContain('# TYPE office_room_players gauge\n');
    expect(text).toContain('office_room_players{room="office-livekit"} 3\n');
    expect(text).toContain('office_room_players{room="office-livekit-space-sala-1"} 2\n');
    expect(text).toContain('# TYPE office_recordings_active gauge\noffice_recordings_active 1\n');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('always renders the recordings gauge, which the disk alert reads even at zero', () => {
    expect(createOfficeMetrics().render(empty)).toContain('office_recordings_active 0\n');
  });

  it('counts connections and reconnections with their total seconds, per event', () => {
    const metrics = createOfficeMetrics();
    metrics.recordMediaEvent({ event: 'connected', durationMs: 500 });
    metrics.recordMediaEvent({ event: 'connected', durationMs: 1500 });
    metrics.recordMediaEvent({ event: 'reconnected', durationMs: 3000 });
    const text = metrics.render(empty);
    expect(text).toContain('# TYPE office_media_connect_seconds summary\n');
    expect(text).toContain('office_media_connect_seconds_sum{event="connected"} 2\n');
    expect(text).toContain('office_media_connect_seconds_count{event="connected"} 2\n');
    expect(text).toContain('office_media_connect_seconds_sum{event="reconnected"} 3\n');
    expect(text).toContain('office_media_connect_seconds_count{event="reconnected"} 1\n');
  });

  it('counts disconnections by their reason', () => {
    const metrics = createOfficeMetrics();
    metrics.recordMediaEvent({ event: 'disconnected', reason: 'SIGNAL_CLOSE' });
    metrics.recordMediaEvent({ event: 'disconnected', reason: 'SIGNAL_CLOSE' });
    metrics.recordMediaEvent({ event: 'disconnected', reason: 'JOIN_FAILURE' });
    const text = metrics.render(empty);
    expect(text).toContain('# TYPE office_media_disconnections_total counter\n');
    expect(text).toContain('office_media_disconnections_total{reason="SIGNAL_CLOSE"} 2\n');
    expect(text).toContain('office_media_disconnections_total{reason="JOIN_FAILURE"} 1\n');
  });

  it('escapes a label value that would break the format', () => {
    const text = createOfficeMetrics().render({ playersByRoom: new Map([['a"b\\c\nd', 1]]), activeRecordings: 0 });
    expect(text).toContain('office_room_players{room="a\\"b\\\\c\\nd"} 1\n');
  });
});
