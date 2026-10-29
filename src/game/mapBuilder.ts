/**
 * Draws the office from the Tiled layout (art migration, step 8, #4):
 * the terrain as tilemap layers of the shared `tileset-terrain`, and walls,
 * hedges, props and the base chairs from the art pack at native size, placed
 * by their anchors. Depende de Phaser en tiempo de ejecucion: se prueba en la
 * capa navegador; the numbers come from the pure `terrainRender.ts` and
 * `artPlacement.ts`.
 *
 * When the pack is missing every piece keeps a visible fallback: the terrain
 * in one flat color per material, and a grey placeholder on each footprint.
 */

import type Phaser from 'phaser';
import {
  TERRAIN_LAYER_COUNT,
  TERRAIN_LAYER_ORIGIN,
  WALL,
  propPlacement,
  type ArtChairPiece,
  type ArtDeskPiece,
  type ArtPiece,
  type ArtPropPiece,
  type Point,
  type TerrainMaterial,
} from './artContract';
import { findPiece } from './artPack';
import type { ArtTextures } from './artPackLoader';
import { chairPlacement, deskPlacement, footprintAnchor, type SpritePlacement } from './artPlacement';
import { chairLayerDepth, worldAssetDepth } from './depthLayers';
import { TILE, ZONE_LABELS } from './mapData';
import { LAYOUT_MATERIALS, type LayoutProp, type OfficeLayout, type TerrainColors, type TerrainSnapshot, type WallGrid } from './officeLayout';
import { chairGround, type MapSeat, type PlacedChair } from './seating';
import { terrainColorTileData, terrainMaterialBand, terrainRecolor } from './terrainColorTiles';
import type { TerrainFloors } from './terrainFloors';
import { terrainFloorTileData } from './terrainFloorTiles';
import { TERRAIN_FLAT_COLORS, decalTileData, fallbackTerrainData, hedgeSprites, propFrame, wallSprites } from './terrainRender';

/**
 * Chair of the base map's rooms. The manifest names no default chair (step 3
 * persists none), so the map picks one.
 */
export const BASE_MAP_CHAIR = 'chair-wood';

/** Terrain layers at the very bottom, decals over them, then bridges lying on the ground. */
const TERRAIN_DEPTH = 0;
const DECAL_DEPTH = 0.3;
/** Uploaded floors (S13) lie over the terrain layers (up to `TERRAIN_LAYER_COUNT * 0.01`) and under the decals. */
const TERRAIN_FLOOR_DEPTH = 0.2;
const GROUND_PROP_DEPTH = 0.5;

/** Generated when the pack is missing: one flat 32px tile per terrain material, in `LAYOUT_MATERIALS` order. */
export const FALLBACK_TERRAIN_KEY = 'terrain-fallback';
const PLACEHOLDER_COLOR = 0x6b7280;
const HEDGE_PLACEHOLDER_COLOR = 0x2f5d34;
const PLACEHOLDER_ALPHA = 0.85;

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
  placement: Pick<SpritePlacement, 'x' | 'y' | 'frame'>,
  depth: number,
): Phaser.GameObjects.Image {
  return scene.add.image(placement.x, placement.y, key, placement.frame).setOrigin(0).setDepth(depth);
}

/** A loaded pack sheet for the piece `id` when it is of the expected kind, else `null` (fallback). */
function packSheet<P extends ArtPiece>(
  art: ArtTextures | undefined,
  id: string,
  isKind: (piece: ArtPiece) => piece is P,
): { piece: P; key: string } | null {
  if (art === undefined || art.manifest === null) return null;
  const piece = findPiece(art.manifest, id);
  if (piece === undefined || !isKind(piece)) return null;
  const key = art.sheet(piece.id, 'sheet');
  return key === null ? null : { piece, key };
}

const isDesk = (piece: ArtPiece): piece is ArtDeskPiece => piece.kind === 'desk';
const isChair = (piece: ArtPiece): piece is ArtChairPiece => piece.kind === 'chair';
const isProp = (piece: ArtPiece): piece is ArtPropPiece =>
  piece.kind === 'tree' || piece.kind === 'plant' || piece.kind === 'bridge' || piece.kind === 'hedge' || piece.kind === 'table';
const isAny = (_piece: ArtPiece): _piece is ArtPiece => true;

function placeholder(scene: Phaser.Scene, x: number, y: number, w: number, h: number, color: number, depth: number): Phaser.GameObjects.Rectangle {
  return scene.add.rectangle(x + w / 2, y + h / 2, w, h, color, PLACEHOLDER_ALPHA).setDepth(depth);
}

// --- Terrain -----------------------------------------------------------------------------------

/** The terrain tilemap of the scene, kept so a block edit can redraw it in place. */
export interface TerrainTilemap {
  readonly layers: readonly Phaser.Tilemaps.TilemapLayer[];
  /** The decal layer, `null` in the flat fallback. */
  readonly decals: Phaser.Tilemaps.TilemapLayer | null;
  /** Rewrites every tile from `terrain` and its block colors (#222), reusing the same layers (#123 phase 2). */
  refresh(terrain: TerrainSnapshot, colors?: TerrainColors): void;
}

const NO_COLORS: TerrainColors = new Map();

/** What `TilemapLayer.setTilesets` does for one more tileset (Phaser keeps it private): its gids now draw from it. */
function attachTileset(layer: Phaser.Tilemaps.TilemapLayer, tileset: Phaser.Tilemaps.Tileset): void {
  layer.tileset.push(tileset);
  for (let tile = 0; tile < tileset.total; tile += 1) layer.gidMap[tileset.firstgid + tile] = tileset;
}

function putRows(layer: Phaser.Tilemaps.TilemapLayer, rows: readonly (readonly number[])[]): void {
  layer.putTilesAt(rows as number[][], 0, 0, false);
}

function fallbackTileset(scene: Phaser.Scene): void {
  if (scene.textures.exists(FALLBACK_TERRAIN_KEY)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  LAYOUT_MATERIALS.forEach((material, index) => {
    g.fillStyle(TERRAIN_FLAT_COLORS[material]).fillRect(index * TILE, 0, TILE, TILE);
  });
  g.generateTexture(FALLBACK_TERRAIN_KEY, TILE * LAYOUT_MATERIALS.length, TILE);
  g.destroy();
}

/**
 * The terrain of the whole map in `TERRAIN_LAYER_COUNT` dual-grid layers plus
 * one of decals, all from the one shared tileset: the number of game objects
 * stays the same whatever the size of the map (#123).
 *
 * A colored block (#222) draws from a recolored copy of its material's band,
 * added to the same tilemap as one more tileset the first time that color is
 * drawn and kept for the life of the map; the flat fallback has no art to
 * recolor and draws every block in its material's flat color.
 */
export function renderTerrain(
  scene: Phaser.Scene,
  terrain: TerrainSnapshot,
  layout: OfficeLayout,
  art?: ArtTextures,
  colors: TerrainColors = NO_COLORS,
): TerrainTilemap {
  const { width, height } = terrain;
  const key = art?.sheet('tileset-terrain', 'sheet') ?? null;

  if (key === null) {
    fallbackTileset(scene);
    const map = scene.make.tilemap({ tileWidth: TILE, tileHeight: TILE, width, height });
    const tileset = map.addTilesetImage('terrain-fallback', FALLBACK_TERRAIN_KEY, TILE, TILE, 0, 0);
    const layer = tileset === null ? null : map.createBlankLayer('terrain', tileset, 0, 0, width, height);
    if (layer === null) return { layers: [], decals: null, refresh: () => {} };
    layer.setDepth(TERRAIN_DEPTH);
    putRows(layer, fallbackTerrainData(terrain));
    return { layers: [layer], decals: null, refresh: (next) => putRows(layer, fallbackTerrainData(next)) };
  }

  const map = scene.make.tilemap({ tileWidth: TILE, tileHeight: TILE, width: width + 1, height: height + 1 });
  const tileset = map.addTilesetImage('terrain', key, TILE, TILE, 0, 0);
  if (tileset === null) return { layers: [], decals: null, refresh: () => {} };
  const layers: Phaser.Tilemaps.TilemapLayer[] = [];
  for (let index = 0; index < TERRAIN_LAYER_COUNT; index += 1) {
    const layer = map.createBlankLayer(`terrain-${index}`, tileset, TERRAIN_LAYER_ORIGIN, TERRAIN_LAYER_ORIGIN, width + 1, height + 1);
    if (layer !== null) layers.push(layer.setDepth(TERRAIN_DEPTH + index * 0.01));
  }
  const decals = map.createBlankLayer('decals', tileset, 0, 0, width, height)?.setDepth(DECAL_DEPTH) ?? null;
  // First gid of each recolored band by `material:color`; `null` when it cannot be painted, so it is not retried every redraw.
  const bands = new Map<string, number | null>();
  let nextGid = tileset.firstgid + tileset.total;
  const bandGid = (material: TerrainMaterial, color: string): number | null => {
    const id = `${material}:${color}`;
    const known = bands.get(id);
    if (known !== undefined) return known;
    const recolor = terrainRecolor(art?.manifest ?? null, material, color);
    const band = terrainMaterialBand(material);
    const copy = recolor === null ? null : (art?.recoloredRegion('tileset-terrain', 'sheet', band.rect, recolor) ?? null);
    const added = copy === null ? null : map.addTilesetImage(`terrain-${id}`, copy, TILE, TILE, 0, 0, nextGid);
    if (added !== null) {
      nextGid += added.total;
      for (const layer of layers) attachTileset(layer, added);
    }
    bands.set(id, added?.firstgid ?? null);
    return added?.firstgid ?? null;
  };
  const draw = (next: TerrainSnapshot, nextColors: TerrainColors = NO_COLORS): void => {
    terrainColorTileData(next, nextColors, bandGid).forEach((rows, index) => {
      const layer = layers[index];
      if (layer !== undefined) putRows(layer, rows);
    });
    if (decals !== null) putRows(decals, decalTileData(layout, next));
  };
  draw(terrain, colors);
  return { layers, decals, refresh: draw };
}

// --- Uploaded floors ----------------------------------------------------------------------------

/** The layers of the uploaded floors (S13), one per piece, kept so a block edit or a late sheet can redraw them in place. */
export interface TerrainFloorLayers {
  /** The layer of each piece drawn so far, by piece id. */
  readonly layers: ReadonlyMap<string, Phaser.Tilemaps.TilemapLayer>;
  /**
   * Lays each piece of `floors` over its `wood` blocks. `sheetKey` is the
   * texture of a piece's 96x96 sheet, or `null` while it is not loaded (or
   * never will be): that piece then draws nothing and the wood below shows.
   */
  refresh(terrain: TerrainSnapshot, floors: TerrainFloors, sheetKey: (pieceId: string) => string | null): void;
  destroy(): void;
}

/**
 * The uploaded floors as tilemap layers over the terrain's, square-edged on
 * the tile lines and never touching walkability: a layer per piece, created
 * the first time its sheet is there, so the number of game objects follows
 * the number of distinct pieces and not the size of the map.
 */
export function renderTerrainFloors(scene: Phaser.Scene): TerrainFloorLayers {
  const entries = new Map<string, { layer: Phaser.Tilemaps.TilemapLayer; firstGid: number; key: string }>();
  const layerOf = (pieceId: string, key: string, terrain: TerrainSnapshot): { layer: Phaser.Tilemaps.TilemapLayer; firstGid: number } | null => {
    const known = entries.get(pieceId);
    if (known !== undefined && known.key === key) return known;
    known?.layer.destroy();
    entries.delete(pieceId);
    const map = scene.make.tilemap({ tileWidth: TILE, tileHeight: TILE, width: terrain.width, height: terrain.height });
    const tileset = map.addTilesetImage(pieceId, key, TILE, TILE, 0, 0);
    const layer = tileset === null ? null : map.createBlankLayer(pieceId, tileset, 0, 0, terrain.width, terrain.height);
    if (tileset === null || layer === null) return null;
    layer.setDepth(TERRAIN_FLOOR_DEPTH);
    const entry = { layer, firstGid: tileset.firstgid, key };
    entries.set(pieceId, entry);
    return entry;
  };
  return {
    get layers() {
      return new Map([...entries].map(([id, entry]) => [id, entry.layer]));
    },
    refresh(terrain, floors, sheetKey) {
      const data = terrainFloorTileData(terrain, floors);
      for (const [pieceId, entry] of entries) if (!data.has(pieceId)) entry.layer.setVisible(false);
      for (const [pieceId, rows] of data) {
        const key = sheetKey(pieceId);
        const target = key === null ? null : layerOf(pieceId, key, terrain);
        if (target === null) {
          entries.get(pieceId)?.layer.setVisible(false);
          continue;
        }
        putRows(
          target.layer,
          rows.map((row) => row.map((frame) => (frame < 0 ? -1 : target.firstGid + frame))),
        );
        target.layer.setVisible(true);
      }
    },
    destroy() {
      for (const entry of entries.values()) entry.layer.destroy();
      entries.clear();
    },
  };
}

// --- Layout pieces -----------------------------------------------------------------------------

/** Name of every object `placeWalls` draws, so tests and tools can find the walls on the map. */
export const WALL_OBJECT_NAME = 'map:wall';

/**
 * The walls of a wall grid (the layout's, or the live painted ones), from the
 * pack or as grey placeholders over the same joints and bodies: a wall's
 * footprint on its grid lines, never a whole tile. Returns what it drew, so
 * the scene can destroy it and draw the walls again after an edit.
 */
export function placeWalls(
  scene: Phaser.Scene,
  grid: WallGrid,
  art?: ArtTextures,
): Phaser.GameObjects.GameObject[] {
  const drawn: Phaser.GameObjects.GameObject[] = [];
  for (const sprite of wallSprites(grid)) {
    const sheet = packSheet(art, sprite.piece, isAny);
    const depth = worldAssetDepth(sprite.depthY);
    drawn.push(
      (sheet !== null
        ? putArtSprite(scene, sheet.key, sprite, depth)
        : placeholder(scene, sprite.x, sprite.y, WALL.frame.width, WALL.frame.height, PLACEHOLDER_COLOR, depth)
      ).setName(WALL_OBJECT_NAME),
    );
  }
  return drawn;
}

function placeHedges(scene: Phaser.Scene, layout: OfficeLayout, art?: ArtTextures): void {
  for (const hedge of hedgeSprites(layout)) {
    const sheet = packSheet(art, hedge.piece, isProp);
    if (sheet === null) {
      placeholder(scene, hedge.tx * TILE, hedge.ty * TILE, TILE, TILE, HEDGE_PLACEHOLDER_COLOR, worldAssetDepth((hedge.ty + 1) * TILE));
      continue;
    }
    const placement = propPlacement(sheet.piece, hedge.tx, hedge.ty);
    putArtSprite(scene, sheet.key, { ...placement, frame: hedge.frame }, worldAssetDepth(placement.depthY));
  }
}

function placeProp(scene: Phaser.Scene, prop: LayoutProp, art?: ArtTextures): void {
  const rect = { x: prop.tx * TILE, y: prop.ty * TILE, w: prop.w * TILE, h: prop.h * TILE };
  if (prop.kind === 'desk') {
    const desk = packSheet(art, prop.piece, isDesk);
    if (desk !== null) {
      // Drawn whole at its own size in the middle of the footprint, never stretched to it.
      const placement = deskPlacement(desk.piece, prop.facing ?? 'down', footprintAnchor(rect));
      putArtSprite(scene, desk.key, placement, worldAssetDepth(placement.depthY));
      return;
    }
  } else {
    const sheet = packSheet(art, prop.piece, isProp);
    if (sheet !== null) {
      const placement = propPlacement(sheet.piece, prop.tx, prop.ty);
      const depth = sheet.piece.layer === 'ground' ? GROUND_PROP_DEPTH : worldAssetDepth(placement.depthY);
      putArtSprite(scene, sheet.key, { ...placement, frame: propFrame(prop) }, depth);
      return;
    }
  }
  const depth = prop.collision === 'deck' ? GROUND_PROP_DEPTH : worldAssetDepth(rect.y + rect.h);
  placeholder(scene, rect.x, rect.y, rect.w, rect.h, PLACEHOLDER_COLOR, depth);
}

/**
 * Hedges and props of the layout; walls are drawn apart (`placeWalls`)
 * because painted walls change while the office is open. Collision is not
 * decided here: the scene builds its colliders from the shared rules the
 * server enforces too, the terrain tiles (`terrainSnapshot`) and the pieces'
 * rectangles (`pieceCollisions.ts`).
 */
export function placeLayout(scene: Phaser.Scene, layout: OfficeLayout, art?: ArtTextures): void {
  placeHedges(scene, layout, art);
  for (const prop of layout.props) placeProp(scene, prop, art);
}

/**
 * The base chairs (`BASE_MAP_SEATS`, shared with the room, which seats people
 * on them). No collision by default: people walk between chairs and sit on
 * them, unless an admin gives the chair piece rectangles.
 */
export function placeSeats(scene: Phaser.Scene, seats: readonly MapSeat[], art?: ArtTextures): void {
  const chair = packSheet(art, BASE_MAP_CHAIR, isChair);
  for (const { tx, ty, facing } of seats) {
    if (chair === null) {
      placeholder(scene, tx * TILE + 8, ty * TILE + 8, TILE - 16, TILE - 16, PLACEHOLDER_COLOR, worldAssetDepth((ty + 1) * TILE));
      continue;
    }
    const ground: Point = { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
    putChair(scene, chair.key, chairPlacement(chair.piece, facing, ground));
  }
}

/** Name of every object `placeChairs` draws, so tests and tools can find the placed chairs on the map. */
export const CHAIR_OBJECT_NAME = 'map:chair';

/**
 * The chairs placed from the terrain editor, each its own pack piece in both
 * layers on the middle of its tile, like `placeSeats`; a grey placeholder
 * while its sheet is missing. Returns what it drew, so the scene can destroy
 * it and draw the chairs again after an edit.
 */
export function placeChairs(scene: Phaser.Scene, chairs: readonly PlacedChair[], width: number, art?: ArtTextures): Phaser.GameObjects.GameObject[] {
  const drawn: Phaser.GameObjects.GameObject[] = [];
  for (const { index, piece, facing } of chairs) {
    const sheet = packSheet(art, piece, isChair);
    const ground = chairGround(width, index);
    if (sheet === null) {
      const tx = Math.floor(ground.x / TILE);
      const ty = Math.floor(ground.y / TILE);
      drawn.push(placeholder(scene, tx * TILE + 8, ty * TILE + 8, TILE - 16, TILE - 16, PLACEHOLDER_COLOR, worldAssetDepth((ty + 1) * TILE)));
      continue;
    }
    drawn.push(...putChair(scene, sheet.key, chairPlacement(sheet.piece, facing, ground)));
  }
  for (const object of drawn) object.setName(CHAIR_OBJECT_NAME);
  return drawn;
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
