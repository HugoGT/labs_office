/**
 * The art templates (#121) as PNG files under TEMPLATE_DIR, one per kind of `domain/templates.ts`.
 * Rendering is pure and deterministic, so `templates.test.ts` can check that the committed
 * templates are exactly what the generator produces today. The pack is not touched.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { encodePng } from '../../server/src/assets/pngCodec.ts';
import { TEMPLATE_IMAGE_KINDS, renderTemplate, type TemplateImageKind } from './domain/templates.ts';

/** Next to the contract they illustrate; never under public/, they do not ship with the office. */
export const TEMPLATE_DIR = 'docs/assets/templates';

export function templatePath(kind: TemplateImageKind): string {
  return `${TEMPLATE_DIR}/${kind}.png`;
}

/** Every template, keyed by its path relative to the repository root, sorted. */
export function renderTemplateFiles(): Map<string, Uint8Array> {
  const entries = TEMPLATE_IMAGE_KINDS.map((kind): [string, Uint8Array] => [templatePath(kind), new Uint8Array(encodePng(renderTemplate(kind)))]);
  return new Map(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Replaces TEMPLATE_DIR under `root` with `files`, so a dropped template also leaves the repository. */
export function writeTemplateFiles(root: string, files: ReadonlyMap<string, Uint8Array>): void {
  rmSync(join(root, TEMPLATE_DIR), { recursive: true, force: true });
  for (const [path, bytes] of files) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
}
