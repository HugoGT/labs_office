# Art pixel and format contract (version 2)

The executable source of truth is `src/game/artContract.ts` (`ART_CONTRACT_VERSION = 2`). It has no imports, so the client, the server and `tools/art` load the same file. This page explains it. If the two disagree, the code wins and this page is out of date.

## Principles

- `TILE = 32` stays the logical unit for coordinates, placement and bounds. Art is drawn 1:1: one PNG pixel is one world pixel, with no scaling in production files.
- The contract keeps three things separate:
  - **Frame size**: the PNG cell.
  - **Footprint**: the tiles a piece occupies for placement and collision.
  - **Anchor**: the pixel that lands on the world point, such as the feet, the seat or the floor under a desk.
- Files are 8-bit RGBA PNGs (`png-rgba8`), non-interlaced. Each file holds a fixed grid of frames, and the grid depends on the kind. The grid is the contract.
- Partial alpha is allowed. The pack uses it on purpose for contact shadows (alpha 78) and glass (110 to 220).
- Each file can use at most 128 distinct non-transparent RGBA values (`MAX_COLORS_PER_IMAGE`). The busiest character sheet has about 75, so 128 leaves room for new art. Photos, gradients and smoothed upscales still fail, because they reach hundreds of values. The terrain tileset gathers eight materials, so its cap applies to each material band (`colorBandRows`), not to the whole file.
- Sprite frames must not carry a background: the four corner pixels of every frame are transparent. Floors must be fully opaque.

## Kinds

| Kind | Frame | Grid (cols x rows) | Sheet | Order | Anchor | Footprint |
|---|---|---|---|---|---|---|
| `character-walk` | 32x52 | 11 x 8 | 352x416 | columns 0-9 steps, 10 idle; rows `S, SE, E, NE, N, NW, W, SW` | feet (16, 47) | 1x1 (feet tile) |
| `character-seated` | 44x58 | 8 x 4 | 352x232 | columns 0-5 sit-down, 6-7 seated idle; rows `up, down, left, right` | pelvis on seat (22, 42) | the chair's |
| `chair` | 36x38 | 4 x 2 | 144x76 | columns `up, down, left, right`; row 0 `back`, row 1 `front` | seat (18, 22), ground (18, 31) | 1x1 |
| `desk` | 64x64 | 4 x 1 | 256x64 | columns `up, down, left, right` | floor under the middle (32, 40) | 2x1 up/down, 1x2 left/right |
| `floor` | 32x32 | 3 x 3 | 96x96 | frame `row * 3 + col` is motif sub-tile (col, row) | top-left | 1x1 per frame |
| `wall` | 16x16 | 17 x 1 | 272x16 | 0 horizontal body, 1 vertical body, `1 + mask` joint | top-left | segment on a grid edge |
| `terrain-tileset` | 32x32 | 16 x 73 | 512x2336 | `terrainTileIndex(material, mask, phase)`, then the decal row | top-left | 1x1 per tile, on the dual grid |
| `tree` | 64x96 | 1 x 1 | 64x96 | one tree | bottom middle of the footprint (32, 90) | 1x1 |
| `plant` | 32x48 | 1 x 1 | 32x48 | one potted plant | (16, 46) | 1x1 |
| `bridge` | 128x128 | 2 x 1 | 256x128 | columns `north-south, east-west` | (64, 112) | 3x3 |
| `hedge` | 32x48 | 16 x 1 | 512x48 | frame = connection mask 0-15 | (16, 48) | 1x1 |
| `table` | 256x192 | 1 x 1 | 256x192 | one room table | (128, 180) | per piece, up to 7x5 |

The office's facing order (`FACINGS` in `officeProtocol.ts`: `down, up, left, right`) differs from the pack order (`up, down, left, right`). To pick a row or column, use `walkRowForFacing` and `seatedRowForFacing`/`facingColumn`, never a raw index. A facing is the direction a seated character looks.

- **Seating**: draw a sitter at `chair seat - (22, 42)`. Draw in this order: chair `back`, then the character, then chair `front`. The ground point y-sorts the chair and its sitter against the furniture around them, so a desk in front covers the sitter's legs; walking characters stay above both (`depthLayers.ts`).
- **Desks**: the manifest gives, per facing, the depth point and where the ground point of a matching chair goes. Both are offsets from the desk anchor.
- **Floors**: each floor is a 96x96 seamless motif split into nine 32x32 tiles (`splitFloorMotif`). World tile (tx, ty) draws frame `floorFrameAt(tx, ty)`, so the full motif repeats every 3 tiles instead of one tile of it.
- **Walls**: walls sit on the edges of the 32px grid. Each is 16px thick and centered on its line. Every vertex that has a wall gets a 16x16 joint, shaped by its connection mask (north 1, east 2, south 4, west 8). Between two joints sits a 16px body (`wallJointRect`, `wallBodyRect`). The art was drawn for a 96px grid. The exporter regenerates it at 32px.

## Terrain (#123)

The terrain is a map of materials, one per tile. Eight materials exist, listed in `TERRAIN_MATERIALS` in drawing priority: `water, sand, dirt, cobblestone, grass, wood, tile, carpet`. Where two meet, the later one is drawn over the earlier one's edge, so every shore is the land's edge over the water. `TERRAIN_WALKABLE` makes water the only impassable material. Each material is the floor piece of the same name (`terrainFloorPieceId`, for example `floor-cobblestone`), cut into transition tiles.

### Dual grid

Transitions are corner autotiles on a dual grid, so they work between any two neighbors with 15 tiles per material instead of one set per pair:

- The display grid sits half a tile up and left of the map (`TERRAIN_LAYER_ORIGIN = -16`). Display cell (cx, cy) covers world pixels (32 cx - 16, 32 cy - 16) to 32px further, and its four corners are the centers of map tiles (cx - 1, cy - 1), (cx, cy - 1), (cx - 1, cy) and (cx, cy). A w x h map needs (w + 1) x (h + 1) cells. Corners outside the map take the nearest map tile (`terrainCellCorners`).
- A corner mask has one bit per corner in reading order: NW 1, NE 2, SW 4, SE 8 (`terrainCornerMask`).
- A cell draws one tile per distinct material among its corners, lowest first (`terrainCellLayers`): the lowest material with mask 15, then each higher material with the mask of the corners at or above it. Nesting the masks makes every edge blend over the material just below it. A cell has four corners, so `TERRAIN_LAYER_COUNT = 4` layers always suffice.
- Each tile is also picked by its motif phase, so the terrain repeats the floor's 96px motif and lines up with `floorFrameAt`: `terrainPhaseAt(cx, cy)` gives the phase, and `terrainPhaseOrigin(phase)` the motif pixel at the tile's top-left.
- `terrainTileIndex(material, mask, phase)` = `(materialIndex * 9 + phase) * 16 + mask`. Mask 0 is an empty tile that is never drawn. The last row holds the decals (`TERRAIN_DECALS`, `terrainDecalIndex`): flowers, clover, pebbles, mushrooms, leaves and lily pads, for a detail layer.
- `terrainLayerData(width, height, terrainAt)` returns the tile data of the four layers, `[layer][cy][cx]`, with `-1` where a layer draws nothing (Phaser's empty tile). Load `tileset/terrain.png` as one tileset (32x32, no margin, no spacing) and create the four layers at `TERRAIN_LAYER_ORIGIN`.

### Edges

- Natural materials (water, grass, dirt, sand, cobblestone) have organic edges: coverage is the bilinear blend of the corners plus smooth noise that repeats with the 96px motif. Both depend only on the shared corners and the world position, so an edge runs on from one cell into the next, and no edge crosses a cell side whose two corners agree.
- Built floors (wood, tile, carpet) have square edges on the map tile lines, like the walls standing on them.
- Every edge has a darker rim inside (2px on natural materials, 1px on wood, tile and carpet, whose straight edge read as a wall with two) and a 2px translucent indigo contact shadow outside, drawn over whatever is below, so one tile works over any lower neighbor.
- A full tile (mask 15) is exactly the floor motif, so a uniform area looks like the floor piece.

Breaking the straight lines between 9x9 blocks is the map's job (8b), for example by deforming block borders with deterministic noise in the material map; the tiles follow any material map.

## Map props

Trees, plants, bridges, hedges and room tables share one placement model (`propPlacement`):

- `anchor` is the floor pixel at the bottom middle of the footprint. A prop whose footprint's top-left tile is (tx, ty) is drawn at `(tx * 32 + w * 16, (ty + h) * 32) - anchor`.
- `layer`: `sorted` props are depth sorted by their anchor's y, like the feet of a character. `ground` props (bridges) are drawn over the terrain and under everything else.
- `collision`: `solid` footprints block movement. A bridge is `deck`: the tiles of its `deck` rect (the whole 3x3 footprint in both orientations) are walkable over water, and the rest of the footprint would be solid.
- Bridges have a frame per orientation (`bridgeFrameIndex`): `north-south` crosses a river flowing east-west. Each one reaches 16px onto both banks with stone abutments.
- Hedges have a frame per connection mask to neighboring hedge tiles (`hedgeFrameIndex`, north 1, east 2, south 4, west 8, like wall joints; 0 is a lone bush). Their top rises `height` (16) pixels over the footprint, and a darker front face shows only where no hedge continues south.
- Tables are seated on every side. Each piece states its footprint: `table-meeting` is 7x5 and `table-cafeteria` 5x3, the room tables of the current map.

Pieces: `tree-oak`, `tree-maple`, `plant-ficus`, `bridge-wood`, `hedge-boxwood`, `table-meeting`, `table-cafeteria`, and the tileset `tileset-terrain`, whose manifest entry lists each material with its floor piece, walkability and first tile, and each decal with its tile.

## Validation

`validateArtImage(kind, image)` checks a decoded image. It returns every violation it finds:

| Code | Violation |
|---|---|
| `invalid-dimensions` | Wrong sheet size. |
| `too-many-colors` | More than 128 distinct values (per material band in the terrain tileset). |
| `not-opaque` | A floor with a pixel whose alpha is not 255. |
| `background-present` | A sprite frame with an opaque corner. |

## Where this supersedes #121

Issue #121 set a first contract before the pack existed. The pack does not fit it, so this contract replaces these points:

| Rule | #121 | Now | Why |
|---|---|---|---|
| Character frame | 32x64, 4 directions, 4 steps, one seated row (128x320) | 32x52 walk with 8 directions, 10 steps and idle; separate 44x58 seated sheet with 6+2 frames | The pack's characters are drawn at this size and cadence. The seated pose needs a wider cell. |
| Facing order | down, left, right, up | Pack order up, down, left, right, mapped explicitly | This matches the generated sheets. The mapping helpers remove the ambiguity. |
| Chair | 32x32 cells, row 0 base, row 1 backrest | 36x38 cells, row 0 back, row 1 front, fixed seat anchor | Chairs are up to 22x36, and aligned on one seat pixel they span 37 rows. Layers are split by draw order, not by part. |
| Desk | `w*32 x h*32` plus 32px overhang, anchored bottom-left | Fixed 64x64 cell per facing, anchored under the middle, with a footprint separate from the PNG | Desks come in 4 orientations of different shapes (54x31, 27x48). |
| Alpha | Binary (0 or 255) | Partial allowed; floors opaque | Shadows and glass are intentionally translucent. |
| Colors | 64 per piece | 128 per file | Measured characters reach about 75. |

These points of #121 still hold: 1:1 pixel density on the 32px tile, PNG only (no SVG, GIF, WebP or JPG), and a manifest with `id`, `kind`, `footprint`, `author` and `license` for each piece. Upload limits, such as the 128 KB size, belong to the upload work and are not changed here.

## Uploads (#121)

An Admin can upload pieces from `/dashboard` (`POST /admin/assets/upload`). The server holds each file to this same contract with `validateArtImage`, plus the upload limits:

- At most 128 KB per file (`MAX_UPLOAD_FILE_BYTES`, `server/src/assets/assetImageRules.ts`).
- Any 8-bit, non-interlaced PNG (gray, RGB, indexed or RGBA, `tRNS` honored). The server re-encodes the decoded pixels and stores only that, as `png-rgba8`: no chunk, metadata or trailing data of the original survives.
- Kinds: `character` (walk and seated sheets), `desk` (facing geometry from the body or, by default, the pack default desk's), `floor` and `plant`. Anchors and footprints are the contract's. Map pieces (walls, tileset, bridges, hedges, tables) still come only from the pack.
- Ids are `<kind>-upload-<16 hex>`, derived from the file hashes. A pack may not use that prefix, so uploads and pack pieces never collide.

Refusals use the codes of the table above plus `too-large`, `not-png`, `invalid-png`, `unsupported-png`, `invalid-metadata` and `missing-file`, each with the file role or field it is about.

## Version history

- **2**: added the terrain tileset, the five missing terrain floors (dirt, sand, cobblestone, tile, carpet) and the map props. Readers of version 1 reject the new piece kinds, so the server catalog and the office only accept version 2 packs; the `art_pieces` kind CHECK is replaced on existing databases.
- **1**: characters, chairs, desks, floors and walls.
