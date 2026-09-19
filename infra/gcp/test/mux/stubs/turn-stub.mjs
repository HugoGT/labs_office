// Stand-in for LiveKit's TURN/TLS listener (design "Local harness").
// A raw TCP server, deliberately NOT speaking TLS: post-change, Caddy's
// `@turn` route in the layer4 mux terminates TLS itself and hands this
// stub cleartext, exactly like `turn.external_tls: true` makes the real
// LiveKit expect.
//
// Its only job is to parse the PROXY protocol v2 header that should arrive
// as the first bytes of the connection (spec "Source-address preservation
// via PROXY v2") and report back which source address it read, so the test
// driver can compare it against the probe container's own address and
// prove the real client IP survived the mux hop instead of being replaced
// by Caddy's own.
import { createServer } from 'node:net';

const PORT = Number(process.env.PORT);
if (!PORT) {
  console.error('turn-stub.mjs requires PORT');
  process.exit(1);
}

// The 12-byte magic signature every PROXY v2 header starts with (spec:
// https://www.haproxy.org/download/2.8/doc/proxy-protocol.txt, section 2.2).
const PROXY_V2_SIGNATURE = Buffer.from([
  0x0d, 0x0a, 0x0d, 0x0a, 0x00, 0x0d, 0x0a, 0x51, 0x55, 0x49, 0x54, 0x0a,
]);

/**
 * Parses a PROXY protocol v2 header from the start of `buf`.
 * Returns `{ srcAddr, consumed }` on success, or `null` if `buf` does not
 * start with a v2 header (either a mismatched signature or not enough
 * bytes buffered yet).
 */
function parseProxyV2(buf) {
  if (buf.length < 16) return null;
  if (!buf.subarray(0, 12).equals(PROXY_V2_SIGNATURE)) return null;

  const verCmd = buf[12];
  const version = verCmd >> 4;
  if (version !== 2) return null;

  const family = buf[13] >> 4;
  const transport = buf[13] & 0x0f;
  const addrLen = buf.readUInt16BE(14);
  const headerLen = 16 + addrLen;
  if (buf.length < headerLen) return null;

  // family 0x1 = AF_INET, transport 0x1 = STREAM (TCP). Only the case the
  // mux actually produces (`proxy_protocol v2` over a TCP upstream) is
  // handled; anything else is reported as unsupported rather than guessed.
  if (family !== 1 || transport !== 1) {
    return { srcAddr: null, consumed: headerLen, unsupported: `family=${family} transport=${transport}` };
  }

  const srcAddr = `${buf[16]}.${buf[17]}.${buf[18]}.${buf[19]}`;
  return { srcAddr, consumed: headerLen };
}

const server = createServer((socket) => {
  let buffered = Buffer.alloc(0);
  let responded = false;

  socket.on('data', (chunk) => {
    if (responded) return;
    buffered = Buffer.concat([buffered, chunk]);

    const parsed = parseProxyV2(buffered);
    if (!parsed) {
      // Either genuinely no PROXY header, or not enough bytes yet. 16 bytes
      // is the minimum any v2 header needs, so past that with a signature
      // mismatch it is safe to conclude there is none.
      if (buffered.length >= 16) {
        responded = true;
        socket.end('NO_PROXY_HEADER\n');
      }
      return;
    }

    responded = true;
    if (parsed.srcAddr) {
      socket.end(`PROXY_SRC=${parsed.srcAddr}\n`);
    } else {
      socket.end(`PROXY_UNSUPPORTED=${parsed.unsupported}\n`);
    }
  });

  socket.on('error', () => {
    // A probe that closes early (e.g. the pre-change RED case, where the
    // connection never even reaches this stub) must not crash the server.
  });
});

server.listen(PORT, () => {
  console.log(`[turn-stub] listening on ${PORT}`);
});
