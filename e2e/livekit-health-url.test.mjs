// Pure unit test for the real-LiveKit CI readiness probe URL (D7). Same
// precedent as `preview-url.test.mjs`: a string-transform function deserves a
// string-transform test, no subprocess, no browser, no build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { livekitHealthUrl } from './harness.mjs';

test('livekitHealthUrl: ws:// becomes http:// on the same host:port, root path', () => {
  assert.equal(livekitHealthUrl('ws://localhost:7880'), 'http://localhost:7880/');
});

test('livekitHealthUrl: wss:// becomes https://, preserving TLS parity', () => {
  assert.equal(livekitHealthUrl('wss://livekit.example.com:8443'), 'https://livekit.example.com:8443/');
});

test('livekitHealthUrl: an existing path is dropped -- the probe always targets root', () => {
  assert.equal(livekitHealthUrl('ws://localhost:7880/rtc'), 'http://localhost:7880/');
});

test('livekitHealthUrl: rejects a non-ws(s) input', () => {
  assert.throws(() => livekitHealthUrl('http://localhost:7880'), /ws/i);
});

test('livekitHealthUrl: rejects an unparseable input', () => {
  assert.throws(() => livekitHealthUrl('not a url'));
});
