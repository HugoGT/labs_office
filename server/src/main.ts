/** Entrypoint del servidor. Se ejecuta con `pnpm server` (Node borra los tipos). */

import { createOfficeServer } from './createOfficeServer.ts';

const PORT = Number(process.env.PORT ?? 2567);

const server = createOfficeServer();
const port = await server.listen(PORT);
console.log(`[colyseus] oficina escuchando en ws://localhost:${port}`);
