/**
 * `pnpm map:init`: writes the initial Tiled layout (src/game/maps/office.json)
 * and the palette image Tiled shows for it. It OVERWRITES the layout: run it
 * only to start over from `initialLayout.ts`, never after editing in Tiled.
 * The palette alone is safe to regenerate after the pack changes.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encodePng } from '../art/png.ts';
import { LAYOUT_PATH, PALETTE_PATH, buildInitialLayout, renderLayoutPalette, serializeLayout } from './initialLayout.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const paletteOnly = process.argv.includes('--palette-only');
const readPack = (path: string): Uint8Array => readFileSync(`${root}public/assets/pack/${path}`);

writeFileSync(`${root}${PALETTE_PATH}`, encodePng(renderLayoutPalette(readPack)));
if (!paletteOnly) writeFileSync(`${root}${LAYOUT_PATH}`, serializeLayout(buildInitialLayout()));
console.log(paletteOnly ? `Wrote ${PALETTE_PATH}` : `Wrote ${LAYOUT_PATH} and ${PALETTE_PATH}`);
