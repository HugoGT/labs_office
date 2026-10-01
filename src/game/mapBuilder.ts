/**
 * Colocacion de suelo, mobiliario, naturaleza y etiquetas de zona, portada de
 * `renderGround`/`placeFurniture`/`placeNature`/`placeZoneLabels`
 * (`prototype/js/app.js:255-322`). Depende de Phaser en tiempo de ejecucion
 * (`scene.add.image`/`scene.add.text`): se prueba en la capa navegador.
 *
 * Art migration, step 4: floors, desks and chairs come from the art pack
 * (`artPackLoader.ts`) at native size, placed by their anchors
 * (`artPlacement.ts`). The Kenney sheets (CC0, `assets.ts`) stay for what the
 * pack has no piece for yet -- hedge, bridge, tile walls, room tables, plants,
 * trees -- and as the whole fallback when the pack did not load. Kenney
 * furniture that spans several tiles is drawn with `tileSprite`, which REPEATS
 * the 16px tile instead of stretching one: a 7-tile table stretched is blurry.
 */

import type Phaser from 'phaser';
import {
  floorFrameAt,
  type ArtChairPiece,
  type ArtDeskPiece,
  type ArtFacing,
  type ArtPiece,
  type Point,
} from './artContract';
import { findPiece } from './artPack';
import type { ArtTextures } from './artPackLoader';
import {
  chairPlacement,
  DEFAULT_DESK_FACING,
  deskPlacement,
  footprintAnchor,
  groundFloorPiece,
  type SpritePlacement,
} from './artPlacement';
import {
  ASSET_SCALE,
  GROUND_FRAMES,
  INDOOR,
  INDOOR_SHEET,
  TERRAIN,
  TERRAIN_SHEET,
} from './assets';
import { DESK_ROWS, GROUND, MAP_H, MAP_W, TILE, TREES, ZONE_LABELS } from './mapData';
import { chairLayerDepth, worldAssetDepth } from './depthLayers';
import { BASE_MAP_SEATS } from './seating';
import { markSolid, type TerrainGrid } from './terrainGrid';

/**
 * Chair of the base map's rooms. The manifest names no default chair (step 3
 * persists none), so the map layout picks one, as the Tiled layout of step 8
 * will.
 */
export const BASE_MAP_CHAIR = 'chair-wood';

/** Kenney frame of a chair for each facing, as the map drew them before the pack. */
const KENNEY_CHAIR_FRAME: Readonly<Record<ArtFacing, number>> = {
  down: INDOOR.chairBack,
  up: INDOOR.chair,
  left: INDOOR.chairWhite,
  right: INDOOR.chairWhite,
};

/**
 * Both layers of a chair on its ground point, back then front (step 6): a
 * sitter goes between them (`seatedAvatarDepth`).
 */
export function putChair(
  scene: Phaser.Scene,
  key: string,
  placement: { back: SpritePlacement; front: SpritePlacement },
): Phaser.GameObjects.Image[] {
  return [
    putArtSprite(scene, key, placement.back, chairLayerDepth(placement.back.depthY, 'back')),
    putArtSprite(scene, key, placement.front, chairLayerDepth(placement.front.depthY, 'front')),
  ];
}

/** Draws one frame of a pack sheet at a placement, 1:1. */
export function putArtSprite(
  scene: Phaser.Scene,
  key: string,
  placement: SpritePlacement,
  depth: number,
): Phaser.GameObjects.Image {
  return scene.add.image(placement.x, placement.y, key, placement.frame).setOrigin(0).setDepth(depth);
}

/** A tile of a pack floor: frame `floorFrameAt` so the 96px motif repeats whole. */
export function putFloorTile(
  scene: Phaser.Scene,
  key: string,
  tx: number,
  ty: number,
  depth: number,
): Phaser.GameObjects.Image {
  return scene.add.image(tx * TILE, ty * TILE, key, floorFrameAt(tx, ty)).setOrigin(0).setDepth(depth);
}

/** A loaded pack sheet for the piece `id` when it is of the expected kind, else `null` (Kenney fallback). */
function packSheet<P extends ArtPiece>(
  art: ArtTextures | undefined,
  id: string | undefined,
  isKind: (piece: ArtPiece) => piece is P,
): { piece: P; key: string } | null {
  if (art === undefined || art.manifest === null || id === undefined) return null;
  const piece = findPiece(art.manifest, id);
  if (piece === undefined || !isKind(piece)) return null;
  const key = art.sheet(piece.id, 'sheet');
  return key === null ? null : { piece, key };
}

const isDesk = (piece: ArtPiece): piece is ArtDeskPiece => piece.kind === 'desk';
const isChair = (piece: ArtPiece): piece is ArtChairPiece => piece.kind === 'chair';

/** Coloca un tile suelto de una hoja, alineado a la rejilla del mundo. */
function putTile(
  scene: Phaser.Scene,
  sheet: string,
  frame: number,
  tx: number,
  ty: number,
  depth: number,
): Phaser.GameObjects.Image {
  return scene.add
    .image(tx * TILE, ty * TILE, sheet, frame)
    .setOrigin(0)
    .setScale(ASSET_SCALE)
    .setDepth(depth);
}

/**
 * Cubre un rectangulo de tiles repitiendo un frame. `tileScale` va a
 * `ASSET_SCALE` para que el patron se repita cada 32px del mundo y no cada 16.
 */
function putTiledArea(
  scene: Phaser.Scene,
  sheet: string,
  frame: number,
  tx: number,
  ty: number,
  tilesWide: number,
  tilesHigh: number,
  depth: number,
): Phaser.GameObjects.TileSprite {
  const sprite = scene.add
    .tileSprite(tx * TILE, ty * TILE, tilesWide * TILE, tilesHigh * TILE, sheet, frame)
    .setOrigin(0)
    .setDepth(depth);
  sprite.tileScaleX = ASSET_SCALE;
  sprite.tileScaleY = ASSET_SCALE;
  return sprite;
}

/**
 * Pinta el suelo tile por tile. Con el pack, cada codigo que tiene suelo en el
 * (`groundFloorPiece`) usa ese motivo; el resto, y todo sin pack, el frame
 * Kenney de siempre, donde el cesped llano alterna por fila (app.js:255-262).
 */
export function renderGround(scene: Phaser.Scene, grid: TerrainGrid, art?: ArtTextures): void {
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const code = grid.ground[y][x];
      const floorId = groundFloorPiece(code);
      const floorKey = floorId === null ? null : (art?.sheet(floorId, 'sheet') ?? null);
      if (floorKey !== null) {
        putFloorTile(scene, floorKey, x, y, 0);
        continue;
      }
      const frame =
        code === GROUND.G
          ? y % 2 === 0
            ? TERRAIN.grass
            : TERRAIN.grassAlt
          : GROUND_FRAMES[code];
      putTile(scene, TERRAIN_SHEET, frame, x, y, 0);
    }
  }
}

/**
 * Coloca escritorios, mesas, sillas y plantas (app.js:264-297). Marca solidas
 * las tiles de escritorios y mesas vía `markSolid` *antes* de que
 * `OfficeScene` fusione colisiones (D6) — las sillas y plantas son
 * decorativas y nunca se marcan solidas, igual que en el prototipo.
 */
export function placeFurniture(scene: Phaser.Scene, grid: TerrainGrid, art?: ArtTextures): void {
  const desk = packSheet(art, art?.manifest?.defaults.desk, isDesk);
  for (const [x, y, n] of DESK_ROWS) {
    for (let i = 0; i < n; i++) {
      const tx = x + i * 2;
      markSolid(grid.solid, tx, y, 2, 1);
      if (desk !== null) {
        // A 2x1 footprint is the pack desk facing up or down: drawn whole at
        // its own size in the middle of the footprint, never stretched to it.
        const anchor = footprintAnchor({ x: tx * TILE, y: y * TILE, w: 2 * TILE, h: TILE });
        const placement = deskPlacement(desk.piece, DEFAULT_DESK_FACING, anchor);
        putArtSprite(scene, desk.key, placement, worldAssetDepth(placement.depthY));
        continue;
      }
      // Alterna los dos frentes de escritorio del pack para que una fila de
      // seis no se vea como el mismo mueble clonado.
      const frame = i % 2 === 0 ? INDOOR.desk : INDOOR.deskAlt;
      putTiledArea(scene, INDOOR_SHEET, frame, tx, y, 2, 1, worldAssetDepth((y + 1) * TILE));
    }
  }

  const chair = packSheet(art, BASE_MAP_CHAIR, isChair);
  // The chairs are `BASE_MAP_SEATS` (shared with the room, which seats people
  // on them); the Kenney fallback frame is the one the map always used for
  // each facing.
  for (const { tx, ty, facing } of BASE_MAP_SEATS) {
    if (chair === null) {
      putTile(scene, INDOOR_SHEET, KENNEY_CHAIR_FRAME[facing], tx, ty, worldAssetDepth((ty + 1) * TILE));
      continue;
    }
    const ground: Point = { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
    putChair(scene, chair.key, chairPlacement(chair.piece, facing, ground));
  }

  // Sala de Juntas: mesa larga, con sus sillas ya puestas arriba.
  putTiledArea(scene, INDOOR_SHEET, INDOOR.tableTop, 53, 6, 7, 5, worldAssetDepth(11 * TILE));
  markSolid(grid.solid, 53, 6, 7, 5);

  // Cafeteria: mesa de madera + asientos + plantas en las esquinas.
  putTiledArea(scene, INDOOR_SHEET, INDOOR.tableTop, 53, 23, 5, 3, worldAssetDepth(26 * TILE));
  markSolid(grid.solid, 53, 23, 5, 3);
  const plants: readonly (readonly [number, number])[] = [
    [51, 19],
    [61, 19],
    [51, 30],
    [61, 30],
  ];
  for (const [px, py] of plants) {
    putTile(scene, INDOOR_SHEET, INDOOR.plant, px, py, worldAssetDepth((py + 1) * TILE));
    markSolid(grid.solid, px, py, 1, 1);
  }
}

/**
 * Coloca arboles (app.js:299-305, marcan su tile solida) y esparce parcelas de
 * flores de forma deterministica evitando tiles solidas o que no sean cesped
 * llano (app.js:306-312).
 *
 * Las flores del pack son tiles de suelo completos, no calcomanias con
 * transparencia: se pintan encima del cesped, no junto a el. Por eso solo van
 * sobre el cesped Kenney: sobre el del art pack serian cuadros de otro cesped,
 * y el motivo de ese ya trae sus propias flores.
 */
export function placeNature(scene: Phaser.Scene, grid: TerrainGrid, art?: ArtTextures): void {
  TREES.forEach(([x, y], i) => {
    const frame = i % 4 === 3 ? TERRAIN.treeOrange : TERRAIN.treeGreen;
    scene.add
      .image((x + 0.5) * TILE, (y + 1) * TILE, TERRAIN_SHEET, frame)
      .setOrigin(0.5, 1)
      // Los arboles van a 1.5x el tile: a escala 1:1 con el suelo se perderian
      // entre el cesped en vez de leerse como volumen.
      .setScale(ASSET_SCALE * 1.5)
      .setDepth(worldAssetDepth((y + 1) * TILE));
    markSolid(grid.solid, x, y, 1, 1);
  });

  const grass = groundFloorPiece(GROUND.G);
  if (grass !== null && art?.sheet(grass, 'sheet')) return;
  const flowerFrames = [TERRAIN.flowersOrange, TERRAIN.flowersWhite, TERRAIN.flowersBlue];
  for (let i = 0; i < 90; i++) {
    const x = 1 + ((i * 13 + 5) % 46);
    const y = 1 + ((i * 29 + 11) % 41);
    if (grid.solid[y][x] || grid.ground[y][x] !== GROUND.G) continue;
    putTile(scene, TERRAIN_SHEET, flowerFrames[i % flowerFrames.length], x, y, 1);
  }
}

/** Etiquetas translucidas de zona superpuestas al mapa (app.js:315-322). */
export function placeZoneLabels(scene: Phaser.Scene): void {
  for (const zone of ZONE_LABELS) {
    scene.add
      .text(zone.x * TILE, zone.y * TILE, zone.t, {
        fontFamily: 'Cantarell, Noto Sans, DejaVu Sans, Segoe UI, sans-serif',
        fontSize: '18px',
        fontStyle: 'bold',
        color: '#ffffff',
      })
      .setAlpha(0.4)
      .setDepth(2);
  }
}
