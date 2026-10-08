# Build the office one block at a time

New offices start as a black void with one central wood block, the entrance. Admins paint 9 × 9 blocks with a floor palette in the office sidebar, then add rooms on the built blocks. Painting changes **terrain only**: it never deletes rooms, desks, decor, users, or saved collision settings.

## Quick path

1. Sign in as an admin or superadmin with the directory configured. Open the office sidebar's **Terreno** section.
2. Pick a floor in the palette (for example **Madera**). It stays highlighted and picked.
3. Click blocks on the map. Each click paints the 9 × 9 block under the pointer at once and for everyone; keep clicking to paint many blocks in a row. Painting over the void builds new terrain, painting over terrain replaces it.
4. To erase, pick **Vacío** and click blocks: they go back to void. Click the picked floor again, **Deseleccionar**, or press Escape to stop painting.
5. In **Salas**, name the room and click **Usar un bloque de oficina (9 × 9)**. Choose its floor, click **Colocar nueva sala**, and click a built block. This size snaps exactly to the block under the pointer; other room sizes keep tile placement. Room CRUD and overlap rules are unchanged.

**Vaciar terreno** (after its confirmation checkbox) turns every block back to void except the entrance, in one atomic request.

## Map contract

| Topic | Contract |
|---|---|
| World | 189 × 135 tiles, 6048 × 4320 px; 21 × 15 blocks (`MAP_BLOCK_COLUMNS`, `MAP_BLOCK_ROWS` in `src/game/mapData.ts`) |
| Office block | 9 × 9 tiles, 288 × 288 px; all 81 tiles share the block's material |
| Spawn | Tile `(94, 67)`, the world's center, in central block index `157` (column 11, row 8 counting from 1); it stays wood: incompatible saved overrides are ignored at startup, and edits cannot change it |
| Void | Material `void`: no terrain. Nonwalkable exactly like water. Drawn as nothing over a black background (`VOID_COLOR`), on the map and the minimap, and outside the world too. Next to void a floor ends on its own edge; no water is drawn under it |
| Floors | Water, grass, dirt, sand, cobblestone, wood, tile and carpet; water is a normal floor and stays nonwalkable |
| Borders | No displaced/jittered block lookup. The art pack's dual-grid transitions and intentional half-tile rendering origin remain |
| Default | Void everywhere but the entrance; no ground overrides, decals, walls, hedges, props, chairs, labels, or fallback rooms |

## Painting, conflicts and players

Each click is one `POST /admin/terrain/blocks/:index` with `{ material }`. The editor sends them one at a time, in click order, and draws each one as pending until the room replicates it; collisions never follow a pending paint. **Vaciar terreno** uses `POST /admin/terrain/blocks` with `{ edits: [{ index, material }], expected }`, where `expected` is the replicated block-list wire string the editor last saw. Both require admin/superadmin authorization and run in the same serialization queue. A batch validates all indices and materials, rejects duplicates and oversized requests, and writes all changed rows with a single atomic PostgreSQL upsert statement (or one synchronous memory mutation).

Water and void are refused under placements (stored rooms, desks, protected static furniture, seats and the spawn area) with `terrain-under-placement`, never under players. A refused paint is dropped from the pending ones and its reason shown; the others go on. Lost authorization or configuration stops painting. A changed terrain under **Vaciar terreno** is refused with `terrain-stale`; retry. Protection failures, stale batches and failed atomic writes leave **both terrain and player positions unchanged**. Missing directory/store keeps editing unavailable (503).

After persistence and publication of an accepted snapshot, the room relocates every avatar whose full physical footprint is no longer walkable to the safe primary spawn/ring, standing. Reserved reconnecting players move too; reconnect replays that position rather than resurrecting an invalid return cell. A replicated `positionRevision` distinguishes relocation from ordinary movement echoes: the client cancels held movement, auto-walk waypoints and pending double clicks, resets its complete Arcade body coordinates, and rechecks spaces/audio. Peers snap instead of tweening across removed ground. The server refuses move/sit messages from before that revision. Saved-position restoration also checks the full footprint against terrain and piece collisions.

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
