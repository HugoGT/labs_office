/** Entrypoint del servidor. Se ejecuta con `pnpm server` (Node borra los tipos). */

import { createOfficeServer } from './createOfficeServer.ts';
import { listenMetrics, metricsConfigFromEnv } from './observability/metricsServer.ts';

const PORT = Number(process.env.PORT ?? 2567);

const server = createOfficeServer();
const port = await server.listen(PORT);
console.log(`[colyseus] oficina escuchando en ws://localhost:${port}`);

// Optional (#275): only the deployed compose sets METRICS_PORT, published on
// the VM loopback for the Ops Agent.
const metricsConfig = metricsConfigFromEnv(process.env);
if (metricsConfig) {
  const metrics = await listenMetrics(metricsConfig, () => server.metricsText());
  console.log(`[metrics] listening on ${metricsConfig.host}:${metrics.port}`);
}
