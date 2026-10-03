/**
 * `pnpm pwa:icons`: regenerates the manifest icons in public/icons/. Commit the
 * result; `icons.test.ts` fails while they drift.
 */
import { fileURLToPath } from 'node:url';
import { renderIconFiles, writeIconFiles } from './icons.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const files = renderIconFiles();
writeIconFiles(root, files);
console.log(`Wrote ${files.size} icons to public/icons`);
