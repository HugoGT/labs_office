# Build the office one block at a time

New offices start as a black void with one central wood block, the entrance. Admins paint 9 × 9 blocks with a floor palette in the office sidebar, raise walls on single tiles with a wall palette, then add rooms on the built blocks. Painting changes **terrain and walls only**: it never deletes rooms, desks, decor, users, or saved collision settings.

## Quick path

1. Sign in as an admin or superadmin with the directory configured. Open the office sidebar's **Terreno** section.
2. Pick a floor in the palette (for example **Madera**). It stays highlighted and picked.
3. Click blocks on the map. Each click paints the 9 × 9 block under the pointer at once and for everyone. To paint an area, hold the button down and drag: every block the stroke crosses is painted, each once, until you release it. Painting over the void builds new terrain, painting over terrain replaces it.
4. To erase, pick **Vacío** and click blocks: they go back to void. Click the picked floor again, **Deseleccionar**, or press Escape to stop painting.
5. For barriers, pick a wall under **Paredes** (**Ladrillo**, **Piedra**, **Yeso** or **Vidrio**) and click or drag over tiles: each tile the pointer crosses gets that wall, joined to its neighbors. **Quitar pared** removes walls the same way. Only one entry of both palettes is picked at a time.
6. In **Salas**, name the room and click **Usar un bloque de oficina (9 × 9)**. Choose its floor, click **Colocar nueva sala**, and click a built block. This size snaps exactly to the block under the pointer; other room sizes keep tile placement. Room CRUD and overlap rules are unchanged.

## Map contract

| Topic | Contract |
|---|---|
| World | 189 × 135 tiles, 6048 × 4320 px; 21 × 15 blocks (`MAP_BLOCK_COLUMNS`, `MAP_BLOCK_ROWS` in `src/game/mapData.ts`) |
| Office block | 9 × 9 tiles, 288 × 288 px; all 81 tiles share the block's material |
| Spawn | Tile `(94, 67)`, the world's center, in central block index `157` (column 11, row 8 counting from 1); it stays wood: incompatible saved overrides are ignored at startup, and edits cannot change it |
| Void | Material `void`: no terrain. Nonwalkable exactly like water. Drawn as nothing over a black background (`VOID_COLOR`), on the map and the minimap, and outside the world too. Next to void a floor ends on its own edge; no water is drawn under it |
| Floors | Carpet, tile, wood, grass, cobblestone, dirt, sand and water, from the highest drawing priority down (where two meet, the higher one is drawn over the lower one's edge; the palette lists them in this order, then the void eraser); water is a normal floor and stays nonwalkable |
| Borders | No displaced/jittered block lookup. The art pack's dual-grid transitions and intentional half-tile rendering origin remain |
| Walls | One wall piece of the art pack per tile (`WALL_PIECES`: `wall-brick`, `wall-stone`, `wall-plaster`, `wall-glass`). A wall blocks its tile over any terrain or bridge; joints and bodies come from the neighboring walls (`wallSprites`) |
| Default | Void everywhere but the entrance; no ground overrides, decals, walls, hedges, props, chairs, labels, or fallback rooms |

## Painting, conflicts and players

Each painted block (a click, or each block a drag crosses) is one `POST /admin/terrain/blocks/:index` with `{ material }`. The editor sends them one at a time, in stroke order, and draws each one as pending until the room replicates it; collisions never follow a pending paint. The atomic batch `POST /admin/terrain/blocks` (no sidebar control uses it) takes `{ edits: [{ index, material }], expected }`, where `expected` is the replicated block-list wire string the editor last saw. Both require admin/superadmin authorization and run in the same serialization queue. A batch validates all indices and materials, rejects duplicates and oversized requests, and writes all changed rows with a single atomic PostgreSQL upsert statement (or one synchronous memory mutation).

Water and void are refused under placements (stored rooms, desks, protected static furniture, seats and the spawn area) with `terrain-under-placement`, never under players. A refused paint is dropped from the pending ones and its reason shown; the others go on. Lost authorization or configuration stops painting. A batch sent against a changed terrain is refused with `terrain-stale`; retry. Protection failures, stale batches and failed atomic writes leave **both terrain and player positions unchanged**. Missing directory/store keeps editing unavailable (503).

After persistence and publication of an accepted snapshot, the room relocates every avatar whose full physical footprint is no longer walkable to the safe primary spawn/ring, standing. Reserved reconnecting players move too; reconnect replays that position rather than resurrecting an invalid return cell. A replicated `positionRevision` distinguishes relocation from ordinary movement echoes: the client cancels held movement, auto-walk waypoints and pending double clicks, resets its complete Arcade body coordinates, and rechecks spaces/audio. Peers snap instead of tweening across removed ground. The server refuses move/sit messages from before that revision. Saved-position restoration also checks the full footprint against terrain and piece collisions.

## Walls

Walls are stored per tile in `terrain_walls` (`tile_index`, `piece_id`, `updated_by`, `updated_at`), only where one stands: removing a wall deletes its row, and a stored wall wins over the layout's wall on that tile (the shipped layout has none). `POST /admin/terrain/walls` takes `{ edits: [{ index, piece }] }`, `piece` a wall piece or `null` to remove it, at most `MAX_WALL_EDITS` (2000) distinct tiles; invalid input answers 400 `invalid-request`, a missing directory or store 503 `terrain-not-configured`. It runs in the same queue as block edits and writes the whole batch in one atomic statement (or one synchronous memory mutation).

A wall is refused with `terrain-under-placement` on a desk (its 3 × 3 footprint), a base chair, protected static furniture or the spawn area. Rooms do not refuse walls: walls inside and around rooms are the point. Players never refuse a wall; the room relocates whoever a wall lands on exactly like after a block edit. Stored walls on a protected static tile are ignored at startup without rewriting the row.

The live walls are part of the terrain snapshot (`terrainSnapshot(layout, blocks, walls)`), so the server refuses moves into them and the client's Arcade colliders, `grid.solid` and pathfinding see them. The room replicates them as `OfficeState.terrainWalls`, a sparse `<tile>:<material>` list (`encodeTerrainWalls`). The sidebar sends consecutive pending wall paints as one request, draws them as pending until the room replicates them, and never collides with a pending wall.

Existing placements are never removed to make an edit succeed. Move or remove them separately through their normal authorized tools. Terrain edits do not carve paths automatically through stored rooms or collisions.

## Upgrading from the 14 × 10 grid

The first block editor stored rows against a 14 × 10 block grid (126 × 90 tiles). That grid now sits at block offset (+3 columns, +2 rows) of the new one, so the old spawn block 77 is the new central block 157 and everything keeps its place around it.

`server/src/directory/schema.sql` moves stored rows **exactly once**, on the first start of the new code:

| Rows | Move |
|---|---|
| `terrain_blocks` | index `r * 14 + c` becomes `(r + 2) * 21 + (c + 3)`; rows past the old grid (index ≥ 140, never read) are deleted |
| `spaces`, `desks` | `x + 27`, `y + 18` (they store tiles); decor in `space_layouts` is relative to its space |
| `users.last_x`, `last_y` | `+ 864`, `+ 576` px when saved; `NULL` stays `NULL` |

The move runs only while the one-row `map_layout_version` table is empty, and writes version `2` (`MAP_LAYOUT_VERSION`) in the same implicit transaction as the whole schema script: a crash moves nothing, and a restart never moves anything twice. Rows go through a free index/coordinate range first, so no primary key or exclusion constraint sees a moved row on top of one still waiting. A new database runs it over empty tables and just gets the marker. Blocks explicitly saved as water stay water; blocks nobody saved had no row and are now void.

Rollback: reverting the code does not move rows back. Older code would read the moved rows against the 14 × 10 grid, so restore from a backup taken before the upgrade (daily backups and point-in-time recovery, see `infra/gcp/README.md`) if a rollback must also restore data.

## Reproduction

`pnpm map:init` reproduces the checked-in void `src/game/maps/office.json` and the Tiled palette (`void` is its last tile, solid black). It writes repository artifacts only, not database rows. `--palette-only` preserves manual Tiled edits. Keep the default's per-tile overlay layers empty if runtime block edits must control every tile.

Tests use explicit legacy fixtures (`src/test/legacyLayout.ts`, its own 126 × 90 world) for chairs, furniture, rooms, collision and proximity behavior. Real-process E2E starts `e2e/server.ts` with an isolated in-memory topology; it does not seed a live database or reinstate legacy objects in the shipped default.
