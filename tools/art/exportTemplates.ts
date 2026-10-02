/**
 * `pnpm art:templates`: regenerates the guide templates (docs/assets/templates/). Commit the result;
 * `templates.test.ts` fails while they drift.
 */
import { fileURLToPath } from 'node:url';
import { TEMPLATE_DIR, renderTemplateFiles, writeTemplateFiles } from './templates.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const files = renderTemplateFiles();
writeTemplateFiles(root, files);
console.log(`Wrote ${files.size} templates to ${TEMPLATE_DIR}`);
