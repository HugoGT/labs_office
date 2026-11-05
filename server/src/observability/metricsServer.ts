/**
 * The metrics endpoint (#275): its own `http.Server` on its own port, never a
 * route of the office app. The app port is what Caddy proxies to the
 * internet; this one is published on the VM loopback only
 * (`infra/gcp/docker-compose.yml`), where the Ops Agent scrapes it. Being a
 * separate listener means no Caddyfile change can ever expose it.
 */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface MetricsConfig {
  port: number;
  host: string;
}

export interface MetricsListener {
  port: number;
  close(): Promise<void>;
}

/**
 * `METRICS_PORT` unset or empty: no endpoint, like every other optional
 * feature. Loopback unless `METRICS_HOST` says otherwise: inside the
 * container it has to be `0.0.0.0` for the published port to reach it, and
 * the publish itself is bound to the host loopback.
 */
export function metricsConfigFromEnv(env: { METRICS_PORT?: string; METRICS_HOST?: string }): MetricsConfig | null {
  const raw = env.METRICS_PORT?.trim();
  if (!raw) return null;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`METRICS_PORT must be a port number, got "${raw}"`);
  }
  return { port, host: env.METRICS_HOST?.trim() || '127.0.0.1' };
}

const CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

export function listenMetrics(config: MetricsConfig, render: () => string): Promise<MetricsListener> {
  const server = createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/metrics') {
      res.writeHead(404).end();
      return;
    }
    let body: string;
    try {
      body = render();
    } catch {
      // Never the raw error: this port has no business leaking details.
      console.error('[metrics] could not render the metrics');
      res.writeHead(500).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': CONTENT_TYPE }).end(body);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.off('error', reject);
      resolve({
        port: (server.address() as AddressInfo).port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}
