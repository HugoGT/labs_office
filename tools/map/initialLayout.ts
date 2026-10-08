/** Reproducible empty office bootstrap. Never touches database overrides or placements. */
import { ART_TILE } from '../../src/game/artContract.ts';
import { MAP_BLOCK_COLUMNS, MAP_BLOCK_ROWS, SPAWN_BLOCK_INDEX } from '../../src/game/mapData.ts';
import { LAYOUT_PALETTE } from './layoutPalette.ts';
export { LAYOUT_PALETTE, LAYOUT_PATH, PALETTE_PATH, renderLayoutPalette } from './layoutPalette.ts';

export function buildInitialLayout() {
  const width = 126;
  const height = 90;
  // Unbuilt everywhere but the protected central spawn block.
  const blocks = Array.from({ length: MAP_BLOCK_COLUMNS * MAP_BLOCK_ROWS }, (_, index) => (index === SPAWN_BLOCK_INDEX ? 'wood' : 'water'));
  const tileLayer = (id: number, name: string, cell: (x: number, y: number) => number) => ({
    data: Array.from({ length: width * height }, (_, index) => cell(index % width, Math.floor(index / width))),
    height, id, name, opacity: 1, type: 'tilelayer', visible: true, width, x: 0, y: 0,
  });
  const objectLayer = (id: number, name: string) => ({
    draworder: 'topdown', id, name, objects: [], opacity: 1, type: 'objectgroup', visible: true, x: 0, y: 0,
  });
  return {
    compressionlevel: -1, height, infinite: false,
    layers: [
      tileLayer(1, 'blocks', (x, y) => LAYOUT_PALETTE.indexOf(blocks[Math.floor(y / 9) * MAP_BLOCK_COLUMNS + Math.floor(x / 9)]!) + 1),
      ...['ground', 'decals', 'walls', 'hedges'].map((name, index) => tileLayer(index + 2, name, () => 0)),
      objectLayer(6, 'props'), objectLayer(7, 'seats'),
    ],
    nextlayerid: 8, nextobjectid: 1, orientation: 'orthogonal', renderorder: 'right-down', tiledversion: '1.11.2', tileheight: ART_TILE,
    tilesets: [{
      columns: LAYOUT_PALETTE.length, firstgid: 1, image: 'layout-palette.png', imageheight: ART_TILE,
      imagewidth: ART_TILE * LAYOUT_PALETTE.length, margin: 0, name: 'layout-palette', spacing: 0,
      tilecount: LAYOUT_PALETTE.length, tileheight: ART_TILE,
      tiles: LAYOUT_PALETTE.map((type, id) => ({ id, type })), tilewidth: ART_TILE,
    }],
    tilewidth: ART_TILE, type: 'map', version: '1.10', width,
  };
}

/** One map row per line in each layer, so generated diffs remain readable. */
export function serializeLayout(map: ReturnType<typeof buildInitialLayout>): string {
  const rows = new Map<string, string>();
  const layers = map.layers.map((layer) => {
    if (!('data' in layer)) return layer;
    const marker = `__rows_${layer.id}__`;
    const lines: string[] = [];
    for (let y = 0; y < map.height; y += 1) lines.push(`    ${layer.data.slice(y * map.width, (y + 1) * map.width).join(',')}`);
    rows.set(`"${marker}"`, `[\n${lines.join(',\n')}\n   ]`);
    return { ...layer, data: marker };
  });
  let text = JSON.stringify({ ...map, layers }, null, 1);
  for (const [marker, value] of rows) text = text.replace(marker, value);
  return `${text}\n`;
}
