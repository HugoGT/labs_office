/**
 * What the office server knows that LiveKit does not (#275): who stands in
 * which LiveKit room, how many recordings run, and what clients report about
 * their own media connection. Rendered in the Prometheus text format for the
 * Ops Agent on the VM (`infra/gcp/ops-agent.yaml`), on a port that never
 * leaves the VM (`metricsServer.ts`).
 *
 * LiveKit's own metrics have no room label, so players per room come from
 * here. Nothing in this module knows a session id, an account or a name: the
 * counts are what the dashboard needs and all it may keep.
 */

import type { SpaceArea } from '../../../src/game/mapData.ts';
import { livekitRoomFor, type MediaEventMessage } from '../../../src/game/officeProtocol.ts';
import { detectSpace, type Point } from '../../../src/game/proximity.ts';

export interface OfficeMetricsSnapshot {
  /** Players per LiveKit room, as `playersByRoom` counts them. */
  playersByRoom: ReadonlyMap<string, number>;
  activeRecordings: number;
}

export interface OfficeMetrics {
  /** A `media` message the room already validated (`mediaEventOf`). */
  recordMediaEvent(event: MediaEventMessage): void;
  render(snapshot: OfficeMetricsSnapshot): string;
}

/**
 * The LiveKit room each tracked position belongs to, the same rule
 * `POST /livekit/token` applies (`livekitRoomFor` of the space it stands in).
 */
export function playersByRoom(positions: Iterable<Point>, spaces: readonly SpaceArea[]): Map<string, number> {
  const rooms = new Map<string, number>();
  for (const position of positions) {
    const room = livekitRoomFor(detectSpace(position, spaces)?.id ?? null);
    rooms.set(room, (rooms.get(room) ?? 0) + 1);
  }
  return rooms;
}

function labelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function sample(name: string, labels: Record<string, string>, value: number): string {
  const pairs = Object.entries(labels).map(([key, raw]) => `${key}="${labelValue(raw)}"`);
  return `${name}${pairs.length > 0 ? `{${pairs.join(',')}}` : ''} ${value}\n`;
}

function header(name: string, type: string, help: string): string {
  return `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n`;
}

export function createOfficeMetrics(): OfficeMetrics {
  const connectSeconds = new Map<string, { sum: number; count: number }>();
  const disconnections = new Map<string, number>();

  return {
    recordMediaEvent(event) {
      if (event.event === 'disconnected') {
        disconnections.set(event.reason, (disconnections.get(event.reason) ?? 0) + 1);
        return;
      }
      const entry = connectSeconds.get(event.event) ?? { sum: 0, count: 0 };
      entry.sum += event.durationMs / 1000;
      entry.count += 1;
      connectSeconds.set(event.event, entry);
    },
    render(snapshot) {
      let text = header('office_room_players', 'gauge', 'Players standing in each LiveKit room.');
      for (const [room, players] of snapshot.playersByRoom) text += sample('office_room_players', { room }, players);

      text += header('office_recordings_active', 'gauge', 'Recordings running now.');
      text += sample('office_recordings_active', {}, snapshot.activeRecordings);

      text += header(
        'office_media_connect_seconds',
        'summary',
        'Time clients took to connect or reconnect to LiveKit, as they report it.',
      );
      for (const [event, { sum, count }] of connectSeconds) {
        text += sample('office_media_connect_seconds_sum', { event }, sum);
        text += sample('office_media_connect_seconds_count', { event }, count);
      }

      text += header(
        'office_media_disconnections_total',
        'counter',
        'LiveKit connections clients lost for good, by LiveKit disconnect reason.',
      );
      for (const [reason, count] of disconnections) {
        text += sample('office_media_disconnections_total', { reason }, count);
      }
      return text;
    },
  };
}
