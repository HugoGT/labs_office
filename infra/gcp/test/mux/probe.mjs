#!/usr/bin/env node
// SNI-controlled probe client for the mux harness (design D7). Runs inside
// the same Docker network as the caddy container, never on the host, so its
// own address is a real, distinguishable container IP -- that is what makes
// assertion 4/5 ("the real client address survives the mux hop") a genuine
// proof and not something a loopback address could fake.
//
// `tls.connect({ servername, rejectUnauthorized: false })` gives explicit
// control over SNI without needing openssl in the image. The self-signed
// internal CA is irrelevant here: every assertion is about which backend
// received the bytes, never about trust.
//
// Always prints exactly one JSON object to stdout, so the test driver
// (mux.test.mjs) never has to scrape text output.
import tls from 'node:tls';
import net from 'node:net';
import http from 'node:http';
import os from 'node:os';

const CONNECT_TIMEOUT_MS = 5000;
const RESPONSE_TIMEOUT_MS = 5000;

function parseArgs(argv) {
  const args = { mode: null };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    args[key] = value;
    i++;
  }
  return args;
}

/** The probe's own address on the mux network -- the value every assertion
 * about "the real client address" is checked against. Skips loopback and
 * link-local/internal interfaces; the mux network is the only non-internal
 * one a container this minimal ever has. */
function selfAddress() {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return null;
}

function tlsHandshake({ host, port, servername }) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host, port: Number(port), servername, rejectUnauthorized: false, timeout: CONNECT_TIMEOUT_MS },
      () => resolve(socket),
    );
    socket.once('error', reject);
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error(`TLS handshake to ${host}:${port} (SNI ${servername}) timed out`));
    });
  });
}

/** Assertions 1-3: an HTTP request sent over an already-established TLS
 * connection, expecting the JSON body an http-stub.mjs backend answers with. */
async function probeTlsHttp({ host, port, servername, path }) {
  const socket = await tlsHandshake({ host, port, servername });
  return new Promise((resolve, reject) => {
    let raw = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`No response within ${RESPONSE_TIMEOUT_MS}ms`));
    }, RESPONSE_TIMEOUT_MS);

    socket.on('data', (chunk) => {
      raw += chunk.toString('utf8');
    });
    socket.on('end', () => {
      clearTimeout(timer);
      const [head, ...bodyParts] = raw.split('\r\n\r\n');
      const statusLine = head.split('\r\n')[0] ?? '';
      const status = Number(statusLine.split(' ')[1]) || null;
      const body = bodyParts.join('\r\n\r\n').trim();
      let parsedBody = null;
      try {
        parsedBody = JSON.parse(body);
      } catch {
        // Non-JSON body (e.g. a 404 from the turn.* site block) is reported raw.
      }
      resolve({ status, body: parsedBody ?? body });
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    socket.write(
      `GET ${path} HTTP/1.1\r\nHost: ${servername}\r\nConnection: close\r\n\r\n`,
    );
  });
}

/** Assertion 4: TLS terminates at the mux for `turn.*`, then a cleartext
 * payload goes to the TURN stub, which replies with the source address it
 * parsed from the PROXY v2 header. */
async function probeTlsRaw({ host, port, servername, write }) {
  const socket = await tlsHandshake({ host, port, servername });
  return new Promise((resolve, reject) => {
    let raw = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`No response within ${RESPONSE_TIMEOUT_MS}ms`));
    }, RESPONSE_TIMEOUT_MS);

    socket.on('data', (chunk) => {
      raw += chunk.toString('utf8');
    });
    socket.on('end', () => {
      clearTimeout(timer);
      resolve({ response: raw.trim() });
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    socket.write(write ?? 'PING\n');
  });
}

/** Assertion 6: the plain `http://` redirect. Never touches TLS or the
 * layer4 mux -- port 80 is untouched by this change on purpose (D1). */
function probeHttp({ host, port, servername, path }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host,
        port: Number(port),
        path,
        method: 'GET',
        headers: { Host: servername },
        timeout: CONNECT_TIMEOUT_MS,
      },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode, location: res.headers.location ?? null });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`HTTP request to ${host}:${port} timed out`));
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const self = selfAddress();

  try {
    let result;
    switch (args.mode) {
      case 'tls-http':
        result = await probeTlsHttp(args);
        break;
      case 'tls-raw':
        result = await probeTlsRaw(args);
        break;
      case 'http':
        result = await probeHttp(args);
        break;
      case 'tcp-connect': {
        // Used only to prove a bare pre-change negative (no site block at
        // all yet): a plain TCP connect with no TLS ClientHello.
        await new Promise((resolve, reject) => {
          const socket = net.connect({ host: args.host, port: Number(args.port), timeout: CONNECT_TIMEOUT_MS });
          socket.once('connect', () => {
            socket.destroy();
            resolve();
          });
          socket.once('error', reject);
          socket.once('timeout', () => {
            socket.destroy();
            reject(new Error('tcp-connect timed out'));
          });
        });
        result = { connected: true };
        break;
      }
      default:
        throw new Error(`Unknown --mode ${args.mode}`);
    }
    console.log(JSON.stringify({ ok: true, selfAddress: self, ...result }));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, selfAddress: self, error: error.message }));
  }
}

main();
