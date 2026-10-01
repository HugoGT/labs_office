// Minimal HTTP echo backend for the mux harness (design "Local harness").
// One script, three roles (`web`, `colyseus`, `lk`): which one a given
// container plays is set entirely by env vars, never by a code branch, so
// the same file can stand in for any of the three real backends the
// Caddyfile already reverse-proxies to.
//
// It answers every request with JSON identifying itself and echoing the
// `X-Forwarded-For` header it received. That header is the whole point:
// assertion 5 (the D2 regression guard) checks it equals the probe
// container's real address, not `127.0.0.1` or Caddy's own bridge address.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

const STUB_NAME = process.env.STUB_NAME;
const PORT = Number(process.env.PORT);

if (!STUB_NAME || !PORT) {
  console.error('http-stub.mjs requires STUB_NAME and PORT');
  process.exit(1);
}

const server = createServer((req, res) => {
  const body = JSON.stringify({
    stub: STUB_NAME,
    path: req.url,
    xff: req.headers['x-forwarded-for'] ?? null,
  });
  // Explicit Content-Length instead of letting Node fall back to chunked
  // transfer encoding: the probe's minimal HTTP/1.1 client parses a plain
  // `\r\n\r\n`-delimited body, not chunk framing.
  res.writeHead(200, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
});

// A real handshake identifies which backend the production matcher selected.
server.on('upgrade', (req, socket) => {
  const accept = createHash('sha1')
    .update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');
  socket.end(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    `Connection: Upgrade\r\nUpgrade: ${req.headers.upgrade}\r\n` +
    `Sec-WebSocket-Accept: ${accept}\r\nX-Stub-Name: ${STUB_NAME}\r\n\r\n`,
  );
});

server.listen(PORT, () => {
  console.log(`[${STUB_NAME}] listening on ${PORT}`);
});
