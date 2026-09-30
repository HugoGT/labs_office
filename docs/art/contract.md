# Art pixel and format contract (version 1)

The executable source of truth is `src/game/artContract.ts` (`ART_CONTRACT_VERSION = 1`). It has no imports, so the client, the server and `tools/art` load the same file. This page explains it. If the two disagree, the code wins and this page is out of date.

## Principles

- `TILE = 32` stays the logical unit for coordinates, placement and bounds. Art is drawn 1:1: one PNG pixel is one world pixel, with no scaling in production files.
- The contract keeps three things separate:
  - **Frame size**: the PNG cell.
  - **Footprint**: the tiles a piece occupies for placement and collision.
  - **Anchor**: the pixel that lands on the world point, such as the feet, the seat or the floor under a desk.
- Files are 8-bit RGBA PNGs (`png-rgba8`), non-interlaced. Each file holds a fixed grid of frames, and the grid depends on the kind. The grid is the contract.
- Partial alpha is allowed. The pack uses it on purpose for contact shadows (alpha 78) and glass (110 to 220).
- Each file can use at most 128 distinct non-transparent RGBA values (`MAX_COLORS_PER_IMAGE`). The busiest character sheet has about 75, so 128 leaves room for new art. Photos, gradients and smoothed upscales still fail, because they reach hundreds of values.
- Sprite frames must not carry a background: the four corner pixels of every frame are transparent. Floors must be fully opaque.

## Kinds

| Kind | Frame | Grid (cols x rows) | Sheet | Order | Anchor | Footprint |
|---|---|---|---|---|---|---|
| `character-walk` | 32x52 | 11 x 8 | 352x416 | columns 0-9 steps, 10 idle; rows `S, SE, E, NE, N, NW, W, SW` | feet (16, 47) | 1x1 (feet tile) |
| `character-seated` | 44x58 | 8 x 4 | 352x232 | columns 0-5 sit-down, 6-7 seated idle; rows `up, down, left, right` | pelvis on seat (22, 42) | the chair's |
| `chair` | 36x36 | 4 x 2 | 144x72 | columns `up, down, left, right`; row 0 `back`, row 1 `front` | seat (18, 22), ground (18, 31) | 1x1 |
| `desk` | 64x64 | 4 x 1 | 256x64 | columns `up, down, left, right` | floor under the middle (32, 40) | 2x1 up/down, 1x2 left/right |
| `floor` | 32x32 | 3 x 3 | 96x96 | frame `row * 3 + col` is motif sub-tile (col, row) | top-left | 1x1 per frame |
| `wall` | 16x16 | 17 x 1 | 272x16 | 0 horizontal body, 1 vertical body, `1 + mask` joint | top-left | segment on a grid edge |

The office's facing order (`FACINGS` in `officeProtocol.ts`: `down, up, left, right`) differs from the pack order (`up, down, left, right`). To pick a row or column, use `walkRowForFacing` and `seatedRowForFacing`/`facingColumn`, never a raw index. A facing is the direction a seated character looks.

- **Seating**: draw a sitter at `chair seat - (22, 42)`. Draw in this order: chair `back`, then the character, then chair `front`. The ground point sorts the chair and its sitter against other characters by depth.
- **Desks**: the manifest gives, per facing, the depth point and where the ground point of a matching chair goes. Both are offsets from the desk anchor.
- **Floors**: each floor is a 96x96 seamless motif split into nine 32x32 tiles (`splitFloorMotif`). World tile (tx, ty) draws frame `floorFrameAt(tx, ty)`, so the full motif repeats every 3 tiles instead of one tile of it.
- **Walls**: walls sit on the edges of the 32px grid. Each is 16px thick and centered on its line. Every vertex that has a wall gets a 16x16 joint, shaped by its connection mask (north 1, east 2, south 4, west 8). Between two joints sits a 16px body (`wallJointRect`, `wallBodyRect`). The art was drawn for a 96px grid. The exporter regenerates it at 32px.

## Validation

`validateArtImage(kind, image)` checks a decoded image. It returns every violation it finds:

| Code | Violation |
|---|---|
| `invalid-dimensions` | Wrong sheet size. |
| `too-many-colors` | More than 128 distinct values. |
| `not-opaque` | A floor with a pixel whose alpha is not 255. |
| `background-present` | A sprite frame with an opaque corner. |

## Where this supersedes #121

Issue #121 set a first contract before the pack existed. The pack does not fit it, so this contract replaces these points:

| Rule | #121 | Now | Why |
|---|---|---|---|
| Character frame | 32x64, 4 directions, 4 steps, one seated row (128x320) | 32x52 walk with 8 directions, 10 steps and idle; separate 44x58 seated sheet with 6+2 frames | The pack's characters are drawn at this size and cadence. The seated pose needs a wider cell. |
| Facing order | down, left, right, up | Pack order up, down, left, right, mapped explicitly | This matches the generated sheets. The mapping helpers remove the ambiguity. |
| Chair | 32x32 cells, row 0 base, row 1 backrest | 36x36 cells (the art's seat block), row 0 back, row 1 front, fixed seat anchor | Chairs are up to 22x36. Layers are split by draw order, not by part. |
| Desk | `w*32 x h*32` plus 32px overhang, anchored bottom-left | Fixed 64x64 cell per facing, anchored under the middle, with a footprint separate from the PNG | Desks come in 4 orientations of different shapes (54x31, 27x48). |
| Alpha | Binary (0 or 255) | Partial allowed; floors opaque | Shadows and glass are intentionally translucent. |
| Colors | 64 per piece | 128 per file | Measured characters reach about 75. |

These points of #121 still hold: 1:1 pixel density on the 32px tile, PNG only (no SVG, GIF, WebP or JPG), and a manifest with `id`, `kind`, `footprint`, `author` and `license` for each piece. Upload limits, such as the 128 KB size, belong to the upload work and are not changed here.
