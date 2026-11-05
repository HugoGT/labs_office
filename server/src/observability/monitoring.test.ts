/**
 * The dashboard and alerts of #275 live in Terraform, which no test here can
 * apply. This checks what source text can: the dashboard template is valid
 * JSON with a panel for each thing the issue asks for, and each alert reads
 * the metrics the stack actually exports (`officeMetrics.ts`, LiveKit's
 * `livekit_*`, the Ops Agent's `agent.googleapis.com/*`).
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const terraform = (file: string) =>
  readFileSync(new URL(`../../../infra/gcp/terraform/${file}`, import.meta.url), 'utf8');

interface Tile {
  widget: { title: string; xyChart?: { dataSets: { timeSeriesQuery: { prometheusQuery: string } }[] } };
}

function dashboard(): { displayName: string; mosaicLayout: { tiles: Tile[] } } {
  // templatefile() placeholders, filled the way Terraform would.
  const json = terraform('dashboard.json.tftpl')
    .replaceAll('${instance_id}', '1234567890')
    .replaceAll('${name}', 'labs-office-test');
  return JSON.parse(json);
}

function queriesOf(title: RegExp): string[] {
  const tile = dashboard().mosaicLayout.tiles.find((candidate) => title.test(candidate.widget.title));
  expect(tile, `a panel titled ${title}`).toBeDefined();
  return tile!.widget.xyChart!.dataSets.map((set) => set.timeSeriesQuery.prometheusQuery);
}

describe('monitoring dashboard (#275)', () => {
  it('is valid JSON once Terraform fills it', () => {
    expect(dashboard().displayName).toContain('labs-office-test');
  });

  it('shows players per room, from the office server', () => {
    expect(queriesOf(/sala/i).join()).toMatch(/sum by \(room\) \(office_room_players\)/);
  });

  it('shows published and subscribed tracks', () => {
    const queries = queriesOf(/pistas/i).join();
    expect(queries).toContain('livekit_track_published_total');
    expect(queries).toContain('livekit_track_subscribed_total');
  });

  it('shows the SFU bandwidth in Mbps', () => {
    expect(queriesOf(/Mbps/).join()).toMatch(/rate\(livekit_packet_bytes\[5m\]\)\) \* 8 \/ 1e6/);
  });

  it('shows the VM CPU of this instance only', () => {
    expect(queriesOf(/CPU de la VM/).join()).toMatch(/instance_cpu_utilization\{[^}]*instance_id="1234567890"/);
  });

  it('shows the CPU per container, by its main process', () => {
    expect(queriesOf(/CPU por contenedor/).join()).toMatch(/sum by \(command\)[\s\S]*processes_cpu_time\{[^}]*instance_id="1234567890"/);
  });

  it('shows the audio cut of crossing a door, p50 and p95 (#286)', () => {
    const queries = queriesOf(/puerta/i).join();
    expect(queries).toMatch(/histogram_quantile\(0\.5, sum by \(le\) \(rate\(office_media_switch_seconds_bucket\[\w+\]\)\)\)/);
    expect(queries).toMatch(/histogram_quantile\(0\.95, sum by \(le\) \(rate\(office_media_switch_seconds_bucket\[\w+\]\)\)\)/);
  });

  it('shows the disconnections clients reported, by reason', () => {
    expect(queriesOf(/desconexiones/i).join()).toContain('office_media_disconnections_total');
  });
});

describe('alerts (#275)', () => {
  const monitoring = terraform('monitoring.tf');

  function policy(name: string): string {
    const block = new RegExp(`resource "google_monitoring_alert_policy" "${name}" \\{([\\s\\S]*?)\\n\\}`).exec(monitoring)?.[1];
    expect(block, `alert policy ${name}`).toBeDefined();
    return block!;
  }

  it('fires on sustained high VM CPU', () => {
    const cpu = policy('cpu_high');
    expect(cpu).toContain('compute.googleapis.com/instance/cpu/utilization');
    expect(cpu).toMatch(/duration\s*=\s*"600s"/);
  });

  it('fires when LiveKit stops answering, only while the VM runs', () => {
    const down = policy('livekit_down');
    expect(down).toContain('google_monitoring_uptime_check_config.livekit.uptime_check_id');
    expect(down).toContain('compute.googleapis.com/instance/uptime');
    expect(down).toMatch(/combiner\s*=\s*"AND"/);
    expect(monitoring).toMatch(/host\s*=\s*local\.lk_host/);
  });

  it('fires when the disk is almost full during a recording', () => {
    const disk = policy('disk_full_while_recording');
    expect(disk).toContain('agent_googleapis_com:disk_percent_used');
    expect(disk).toMatch(/and on\(\)\s*max\(office_recordings_active\) > 0/);
  });

  it('fires when the VM fails to start, as on a Friday with no capacity in the zone (#278)', () => {
    const start = policy('vm_start_failed');
    expect(start).toContain('condition_matched_log');
    expect(start).toContain('${local.office_instance_filter}');
    expect(start).toContain('log_id(\\"cloudaudit.googleapis.com/activity\\")');
    expect(start).toContain('severity >= ERROR');
    expect(start).toContain('protoPayload.methodName : \\"instances.start\\"');
    // A log-based policy is refused without a notification rate limit.
    expect(start).toMatch(/notification_rate_limit \{\s*period\s*=\s*"\d+s"/);
  });

  it('notifies the configured email from every policy', () => {
    for (const name of ['cpu_high', 'livekit_down', 'disk_full_while_recording', 'vm_start_failed']) {
      expect(policy(name)).toContain('notification_channels = local.alert_channels');
    }
  });
});
