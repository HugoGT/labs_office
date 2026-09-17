// Regression cover for #22. Runs as a pure string test: no build, no
// subprocess, no browser, and -- the point of the exercise -- no dependency on
// whether the environment running the suite happens to colorize.
import test from 'node:test';
import assert from 'node:assert/strict';

import { extractPreviewUrl, stripAnsi, PreviewUrlParseError } from './preview-url.mjs';

const ESC = '';

/** Byte-for-byte what `CI=true vite preview` printed when #22 was reproduced,
 * with the escapes written out rather than embedded, so the fixture survives
 * copy/paste and editor normalization. */
const COLORED_BANNER =
  `  ${ESC}[32m➜${ESC}[39m  ${ESC}[1mLocal${ESC}[22m:   ` +
  `${ESC}[36mhttp://localhost:${ESC}[1m41998${ESC}[22m/${ESC}[39m\n` +
  `  ${ESC}[32m➜${ESC}[39m  ${ESC}[1mNetwork${ESC}[22m: ` +
  `${ESC}[36mhttp://10.255.255.254:${ESC}[1m41998${ESC}[22m/${ESC}[39m  ${ESC}[2mlo${ESC}[22m\n`;

const PLAIN_BANNER =
  '  ➜  Local:   http://localhost:41999/\n' +
  '  ➜  Network: http://10.255.255.254:41999/  lo\n';

test('extracts the local URL from a colorized banner (the #22 failure)', () => {
  assert.equal(extractPreviewUrl(COLORED_BANNER), 'http://localhost:41998');
});

test('extracts the same URL when nothing colorizes', () => {
  assert.equal(extractPreviewUrl(PLAIN_BANNER), 'http://localhost:41999');
});

test('prefers the Local line even when a Network line is printed first', () => {
  const reordered =
    '  ➜  Network: http://10.255.255.254:41999/  lo\n' +
    '  ➜  Local:   http://localhost:41999/\n';
  assert.equal(extractPreviewUrl(reordered), 'http://localhost:41999');
});

test('waits for the end of the line instead of accepting a truncated port', () => {
  const truncated = '  ➜  Local:   http://localhost:419';
  assert.equal(extractPreviewUrl(truncated), null);
  assert.equal(extractPreviewUrl(`${truncated}99/\n`), 'http://localhost:41999');
});

test('returns null while no Local line has arrived yet', () => {
  assert.equal(extractPreviewUrl(''), null);
  assert.equal(extractPreviewUrl('  ➜  Network: http://10.0.0.1:4173/  lo\n'), null);
});

test('tolerates CRLF line endings', () => {
  assert.equal(
    extractPreviewUrl('  ➜  Local:   http://localhost:41999/\r\n'),
    'http://localhost:41999',
  );
});

test('strips trailing slashes so the polled URL stays canonical', () => {
  assert.equal(extractPreviewUrl('Local: http://localhost:4173///\n'), 'http://localhost:4173');
});

test('reports an unparseable Local line as a parse failure, not a timeout', () => {
  assert.throws(
    () => extractPreviewUrl('  ➜  Local:   nonsense\n'),
    (error) => error instanceof PreviewUrlParseError && error.line.includes('nonsense'),
  );
});

test('rejects a non-HTTP scheme rather than polling something fetch cannot use', () => {
  assert.throws(
    () => extractPreviewUrl('  ➜  Local:   file:///tmp/index.html\n'),
    PreviewUrlParseError,
  );
});

test('stripAnsi removes SGR sequences without touching the payload', () => {
  assert.equal(stripAnsi(`${ESC}[1mbold${ESC}[22m plain`), 'bold plain');
  assert.equal(stripAnsi('already plain'), 'already plain');
});
