// Pure stdout-to-URL extraction for the `vite preview` child in `harness.mjs`.
// Lives apart from the harness so it can be tested as a string function, with
// no subprocess, no browser and no build: the CI failure this module exists to
// prevent (#22) was a parsing bug, and a parsing bug deserves a parsing test.

const ESC = '';

/** SGR/CSI sequences (`ESC[1m`, `ESC[22m`, `ESC[39m`, ...) plus OSC hyperlinks.
 * `vite preview` colors its banner whenever `CI` is set, even with no TTY, so
 * the escapes land *inside* the printed URL
 * (`http://localhost:` + `ESC[1m` + `40821` + `ESC[22m` + `/`). They contain no
 * whitespace, which is exactly why a `[^\s]+` match swallowed them whole and
 * handed `fetch()` a string it could not parse. */
const ANSI_PATTERN = new RegExp(
  `${ESC}\\[[0-9;?]*[ -/]*[@-~]|${ESC}\\][^\\u0007${ESC}]*(?:\\u0007|${ESC}\\\\)`,
  'g',
);

/** The banner line the harness trusts. `Network:` lines advertise interface
 * addresses that a runner cannot necessarily reach from inside itself, so the
 * local one is matched by name instead of by "whichever came first". */
const LOCAL_LINE_PATTERN = /\bLocal\s*:\s*(\S+)/;

export class PreviewUrlParseError extends Error {
  /** @param {string} line The de-colored banner line that could not be parsed. */
  constructor(line) {
    super(
      `vite preview printed a Local: line whose URL could not be parsed: ${JSON.stringify(line)}`,
    );
    this.name = 'PreviewUrlParseError';
    this.line = line;
  }
}

export function stripAnsi(text) {
  return text.replace(ANSI_PATTERN, '');
}

/**
 * Extracts the preview URL from everything `vite preview` has written to
 * stdout so far.
 *
 * Only *terminated* lines are considered. A chunk boundary can cut the banner
 * mid-URL (`http://localhost:388`), and a truncated port is still syntactically
 * a valid URL, so matching on the raw buffer would accept a wrong port and then
 * fail much later pointing at the wrong thing.
 *
 * @param {string} buffer Accumulated stdout, escapes included.
 * @returns {string | null} The URL without trailing slashes, or `null` while no
 *   complete `Local:` line has arrived yet.
 * @throws {PreviewUrlParseError} A complete `Local:` line arrived but its URL is
 *   not parseable -- a distinct failure from "the server never came up".
 */
export function extractPreviewUrl(buffer) {
  const lines = stripAnsi(buffer).split('\n');
  // The tail after the last newline is still being written: never match on it.
  lines.pop();

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    const match = line.match(LOCAL_LINE_PATTERN);
    if (!match) continue;

    const candidate = match[1].replace(/\/+$/, '');
    let parsed;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new PreviewUrlParseError(line.trim());
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new PreviewUrlParseError(line.trim());
    }
    return candidate;
  }

  return null;
}
