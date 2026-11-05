/**
 * The metrics ports (#275) must never reach the internet, and the Ops Agent
 * must scrape exactly the ports the stack exposes. They live in files that
 * cannot import each other (LiveKit and Egress config, the VM compose, the
 * Ops Agent config, Terraform's firewall), so this pins them together, by
 * source text like `recording/retention.test.ts`.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const gcp = (path: string) => readFileSync(new URL(`../../../infra/gcp/${path}`, import.meta.url), 'utf8');

const LIVEKIT_METRICS_PORT = 6789;
const EGRESS_METRICS_PORT = 9090;
const OFFICE_METRICS_PORT = 9464;
const METRICS_PORTS = [LIVEKIT_METRICS_PORT, EGRESS_METRICS_PORT, OFFICE_METRICS_PORT];

/** `google_compute_firewall` blocks open to the internet, with every port or range they allow. */
function internetFirewallPorts(main: string): { name: string; ports: string[] }[] {
  const blocks = [...main.matchAll(/resource "google_compute_firewall" "(\w+)" \{([\s\S]*?)\n\}/g)];
  return blocks
    .filter(([, , body]) => /source_ranges\s*=\s*\[[^\]]*"0\.0\.0\.0\/0"/.test(body as string))
    .map(([, name, body]) => ({
      name: name as string,
      ports: [...(body as string).matchAll(/ports\s*=\s*\[([^\]]*)\]/g)].flatMap(([, list]) =>
        [...(list as string).matchAll(/"([^"]+)"/g)].map(([, port]) => port as string),
      ),
    }));
}

function covers(portOrRange: string, port: number): boolean {
  const [low, high = low] = portOrRange.split('-').map(Number) as [number, number?];
  return port >= low && port <= (high as number);
}

describe('metrics ports never reach the internet (#275)', () => {
  it('no firewall rule open to 0.0.0.0/0 allows a metrics port', () => {
    const rules = internetFirewallPorts(gcp('terraform/main.tf'));
    // The parser found the rules it has to judge: web, rtc.
    expect(rules.map((rule) => rule.name)).toEqual(expect.arrayContaining(['web', 'rtc']));
    for (const rule of rules) {
      for (const port of METRICS_PORTS) {
        expect(rule.ports.some((allowed) => covers(allowed, port)), `${rule.name} allows ${port}`).toBe(false);
      }
    }
  });

  it('the compose publishes nothing but Caddy outside the VM loopback', () => {
    const published = [...gcp('docker-compose.yml').matchAll(/^\s+- "([^"]*:\d+(?:\/\w+)?)"\s*$/gm)].map(
      ([, mapping]) => mapping as string,
    );
    const outside = published.filter((mapping) => !mapping.startsWith('127.0.0.1:'));
    expect(outside.sort()).toEqual(['443:443', '80:80']);
  });

  it('publishes the server and Egress metrics ports on the VM loopback', () => {
    const compose = gcp('docker-compose.yml');
    expect(compose).toContain(`- "127.0.0.1:${OFFICE_METRICS_PORT}:${OFFICE_METRICS_PORT}"`);
    expect(compose).toContain(`- "127.0.0.1:${EGRESS_METRICS_PORT}:${EGRESS_METRICS_PORT}"`);
  });

  it('turns the server endpoint on, reachable from its published port', () => {
    const compose = gcp('docker-compose.yml');
    expect(compose).toContain(`METRICS_PORT: "${OFFICE_METRICS_PORT}"`);
    expect(compose).toContain('METRICS_HOST: "0.0.0.0"');
  });

  it('turns Egress metrics on', () => {
    expect(gcp('docker-compose.yml')).toMatch(new RegExp(`\\n\\s+prometheus_port: ${EGRESS_METRICS_PORT}\\n`));
  });

  it('turns LiveKit metrics on with the current key, not the deprecated prometheus_port', () => {
    const livekit = gcp('livekit.yaml.tpl');
    expect(livekit).toMatch(new RegExp(`\\nprometheus:\\n\\s+port: ${LIVEKIT_METRICS_PORT}\\n`));
    expect(livekit).not.toMatch(/^prometheus_port:/m);
  });
});

// Redis has no password: it is the bus between LiveKit and Egress, and #279
// keeps Egress on the SFU VM precisely so it never has to leave the loopback.
// Moving Egress to its own VM would break these on purpose.
describe('Redis never reaches the internet (#279)', () => {
  const REDIS_PORT = 6379;

  it('no firewall rule open to 0.0.0.0/0 allows it', () => {
    for (const rule of internetFirewallPorts(gcp('terraform/main.tf'))) {
      expect(rule.ports.some((allowed) => covers(allowed, REDIS_PORT)), `${rule.name} allows ${REDIS_PORT}`).toBe(false);
    }
  });

  it('is published on the VM loopback only, and LiveKit and Egress reach it there or by service name', () => {
    const compose = gcp('docker-compose.yml');
    const mappings = [...compose.matchAll(new RegExp(`- "([^"]*:${REDIS_PORT})"`, 'g'))].map(([, mapping]) => mapping);
    expect(mappings).toEqual([`127.0.0.1:${REDIS_PORT}:${REDIS_PORT}`]);
    expect(gcp('livekit.yaml.tpl')).toMatch(new RegExp(`\\nredis:\\n\\s+address: 127\\.0\\.0\\.1:${REDIS_PORT}\\n`));
    expect(compose).toMatch(new RegExp(`\\n\\s+redis:\\n\\s+address: redis:${REDIS_PORT}\\n`));
  });
});

describe('the Ops Agent scrapes what the stack exposes (#275)', () => {
  const agent = gcp('ops-agent.yaml');

  it.each([
    ['livekit', LIVEKIT_METRICS_PORT],
    ['egress', EGRESS_METRICS_PORT],
    ['office', OFFICE_METRICS_PORT],
  ])('scrapes %s on the loopback port %i', (job, port) => {
    expect(agent).toMatch(
      new RegExp(`job_name: ${job}\\n[\\s\\S]*?targets: \\['127\\.0\\.0\\.1:${port}'\\]`),
    );
  });

  it('reaches the VM through Terraform metadata, and office-deploy installs it', () => {
    expect(gcp('terraform/main.tf')).toContain('office-ops-agent-config = file("${path.module}/../ops-agent.yaml")');
    expect(gcp('scripts/office-deploy.sh')).toContain('metadata office-ops-agent-config');
  });
});
