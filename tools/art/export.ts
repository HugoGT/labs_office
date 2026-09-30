/**
 * `pnpm art:export`: regenerates the production pack (public/assets/pack/) and its review
 * previews (docs/art/preview/). Commit the result; `pack.test.ts` fails while they drift.
 */
import { fileURLToPath } from 'node:url';
import { PACK_DIR, PREVIEW_DIR, renderPackFiles, writePackFiles } from './pack.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const started = performance.now();
const files = renderPackFiles();
writePackFiles(root, files);
console.log(`Wrote ${files.size} files to ${PACK_DIR} and ${PREVIEW_DIR} in ${Math.round(performance.now() - started)} ms`);
