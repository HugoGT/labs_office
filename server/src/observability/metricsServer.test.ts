import { afterEach, describe, expect, it } from 'vitest';
import { listenMetrics, metricsConfigFromEnv, type MetricsListener } from './metricsServer.ts';

describe('metricsConfigFromEnv', () => {
  it('is off without METRICS_PORT', () => {
    expect(metricsConfigFromEnv({})).toBeNull();
    expect(metricsConfigFromEnv({ METRICS_PORT: '' })).toBeNull();
  });

  it('listens on loopback by default', () => {
    expect(metricsConfigFromEnv({ METRICS_PORT: '9464' })).toEqual({ port: 9464, host: '127.0.0.1' });
  });

  it('takes the host from METRICS_HOST, which the container needs to be reachable from its published port', () => {
    expect(metricsConfigFromEnv({ METRICS_PORT: '9464', METRICS_HOST: '0.0.0.0' })).toEqual({
      port: 9464,
      host: '0.0.0.0',
    });
  });

  it('refuses a port it cannot listen on instead of picking one', () => {
    expect(() => metricsConfigFromEnv({ METRICS_PORT: 'abc' })).toThrow(/METRICS_PORT/);
    expect(() => metricsConfigFromEnv({ METRICS_PORT: '0' })).toThrow(/METRICS_PORT/);
    expect(() => metricsConfigFromEnv({ METRICS_PORT: '70000' })).toThrow(/METRICS_PORT/);
  });
});

describe('listenMetrics', () => {
  let listener: MetricsListener | undefined;

  afterEach(async () => {
    await listener?.close();
    listener = undefined;
  });

  it('serves the rendered text on GET /metrics', async () => {
    listener = await listenMetrics({ port: 0, host: '127.0.0.1' }, () => 'office_recordings_active 0\n');
    const response = await fetch(`http://127.0.0.1:${listener.port}/metrics`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/plain; version=0.0.4; charset=utf-8');
    expect(await response.text()).toBe('office_recordings_active 0\n');
  });

  it('answers 404 to anything else', async () => {
    listener = await listenMetrics({ port: 0, host: '127.0.0.1' }, () => '');
    expect((await fetch(`http://127.0.0.1:${listener.port}/health`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${listener.port}/metrics`, { method: 'POST' })).status).toBe(404);
  });

  it('answers 500 without the error when rendering fails', async () => {
    listener = await listenMetrics({ port: 0, host: '127.0.0.1' }, () => {
      throw new Error('secret detail');
    });
    const response = await fetch(`http://127.0.0.1:${listener.port}/metrics`);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('secret');
  });
});
