import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ART_IMAGE_SPECS, sheetSize } from '../../src/game/artContract.ts';
import { decodePng } from '../../server/src/assets/pngCodec.ts';
import { TEMPLATE_IMAGE_KINDS, renderTemplate } from './domain/templates.ts';
import { PACK_DIR, PREVIEW_DIR } from './pack.ts';
import { TEMPLATE_DIR, renderTemplateFiles, templatePath, writeTemplateFiles } from './templates.ts';

const REPO_ROOT = new URL('../../', import.meta.url).pathname;

let files: Map<string, Uint8Array>;
let tempRoot: string;

beforeAll(() => {
  files = renderTemplateFiles();
  tempRoot = mkdtempSync(join(tmpdir(), 'art-templates-'));
});

afterAll(() => {
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
});

describe('art template export', () => {
  it('writes one PNG per template kind under the templates folder, outside the pack', () => {
    expect([...files.keys()]).toEqual(TEMPLATE_IMAGE_KINDS.map(templatePath).sort());
    for (const path of files.keys()) {
      expect(path.startsWith(`${TEMPLATE_DIR}/`), path).toBe(true);
      expect(path.endsWith('.png'), path).toBe(true);
    }
    for (const dir of [PACK_DIR, PREVIEW_DIR]) expect(TEMPLATE_DIR.startsWith(dir) || dir.startsWith(TEMPLATE_DIR)).toBe(false);
  });

  it('is deterministic: a second render is byte-identical', () => {
    const again = renderTemplateFiles();
    expect([...again.keys()]).toEqual([...files.keys()]);
    for (const [path, bytes] of files) expect(Buffer.compare(Buffer.from(again.get(path)!), Buffer.from(bytes)), path).toBe(0);
  });

  it.each(TEMPLATE_IMAGE_KINDS)('encodes the %s template losslessly at its contract size', (kind) => {
    const decoded = decodePng(files.get(templatePath(kind))!);
    expect({ width: decoded.width, height: decoded.height }).toEqual(sheetSize(ART_IMAGE_SPECS[kind]));
    expect(Buffer.from(decoded.data).equals(Buffer.from(renderTemplate(kind).data))).toBe(true);
  });

  it('writes exactly the committed templates, byte for byte', () => {
    // A stale, missing or edited template means a generator or the contract changed without
    // running `pnpm art:templates`.
    writeTemplateFiles(tempRoot, files);
    const list = (root: string): string[] => readdirSync(join(root, TEMPLATE_DIR)).sort();
    expect(list(REPO_ROOT)).toEqual(list(tempRoot));
    for (const path of files.keys()) {
      const committed = readFileSync(join(REPO_ROOT, path));
      expect(Buffer.compare(committed, readFileSync(join(tempRoot, path))), `${path} differs from a fresh export`).toBe(0);
    }
  });
});
