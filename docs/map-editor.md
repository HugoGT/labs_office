# Build the office one block at a time

New offices start with one central wood block surrounded by nonwalkable water. Admins can preview a seeded map, apply it atomically, then add office blocks and rooms from the existing office sidebar. The reset changes **terrain only**: it never deletes rooms, desks, decor, users, or saved collision settings.

## Quick path

1. Sign in as an admin or superadmin with the directory configured. Open the office sidebar's **Terreno** section.
2. Use **Vista previa procedural** with seed `123`, `30` land blocks, and **Césped**. The same parameters always produce the same connected block footprint. Nothing is persisted yet, and only your terrain drawing changes; collisions remain authoritative.
3. Inspect the map, check **Confirmo reemplazar el terreno por esta vista previa**, and click **Aplicar mapa**. All clients receive one new terrain snapshot through Colyseus. A conflict saves nothing.
4. For incremental growth, click a neighboring water block (or enter its 1-based column and row), choose **Madera** or another walkable material, preview, then **Aplicar**. Add connected neighbors if people need to walk there.
5. In **Salas**, name the room and click **Usar un bloque de oficina (9 × 9)**. Choose its floor, click **Colocar nueva sala**, and click a built land block. This size snaps exactly to the block under the pointer; other room sizes keep tile placement. Room CRUD and overlap rules are unchanged.

## Map contract

| Topic | Contract |
|---|---|
| World | 126 × 90 tiles, 4032 × 2880 px; 14 × 10 blocks |
| Office block | 9 × 9 tiles, 288 × 288 px; all 81 tiles share the block's material |
| Spawn | Tile `(67, 49)`, central block index `77` (column 8, row 6); incompatible saved overrides are ignored at startup, and edits cannot change it away from wood |
| Unbuilt substrate | Existing `water` material, visibly water and nonwalkable; no new art assets |
| Borders | No displaced/jittered block lookup. The art pack's dual-grid visual transitions and intentional half-tile rendering origin remain |
| Default | No legacy ground overrides, decals, walls, hedges, props, chairs, labels, or fallback rooms |
| Generation | Unsigned integer seed `0..4294967295`; `1..140` land blocks including spawn; one chosen non-water material for generated land; connected deterministic frontier growth |
| Reset | **Vista previa: solo entrada central**, then the same checkbox and explicit apply; never automatic |

## Existing deployments and conflicts

Deploying the new default does **not** erase or update existing `terrain_blocks`, `spaces`, or `desks` rows. Saved overrides still win at startup everywhere except an incompatible non-wood override for the protected spawn block. The runtime ignores only that override, leaving the default central wood block and safe spawn intact; the original saved row remains unchanged. Loading performs no migration, deletion, or automatic persistence. The protected block index is derived from the shared spawn tile and the layout width, using the same calculation as edit-time protection. Existing overrides elsewhere can still make an upgraded office look different from a new office. New databases no longer seed the two legacy rooms.

Generation and reset use `POST /admin/terrain/blocks` with `{ edits: [{ index, material }], expected }`, where `expected` is the replicated block-list wire string captured at preview time. The existing `POST /admin/terrain/blocks/:index` remains for incremental painting. Both require admin/superadmin authorization. A batch validates all indices and materials, rejects duplicates and oversized requests, runs in the same serialization queue as single-block edits, and writes all changed rows with a single atomic PostgreSQL upsert statement (or one synchronous memory mutation).

Water is refused under placements, not under players. After persistence and publication of an accepted snapshot, the room relocates every avatar whose full physical footprint is no longer walkable to the safe primary spawn/ring, standing. Reserved reconnecting players move too; reconnect replays that position rather than resurrecting an invalid return cell. Single-block painting, generation and reset share this policy. The central spawn block remains wood.

A replicated `positionRevision` distinguishes relocation from ordinary movement echoes. The client cancels held movement, auto-walk waypoints and pending double clicks, resets its complete Arcade body coordinates, and rechecks spaces/audio. Peers snap instead of tweening across removed ground. The movement throttle drops queued predictions; the server refuses move/sit messages from before that revision. Saved-position restoration also checks the full footprint against terrain and piece collisions, falling back when the return square is unavailable.

A stale terrain preview is rejected with `terrain-stale`; regenerate before retrying. Protection failures, stale batches and failed atomic writes leave **both terrain and player positions unchanged**. A rejected draft stays visible for correction or discard. Missing directory/store keeps editing unavailable (503); lost authorization disables writes.

Existing placements are never removed to make generation succeed. Move or remove them separately through their normal authorized tools, or choose a different preview. Terrain edits also do not carve paths automatically through stored rooms or collisions.

## Reproduction and rollback

### Explicit deployment data reset (pending, not executed)

The requested clear of saved terrain and spaces is an operational action, **not** a recurring schema change or startup migration. No live database reset or verified backup has been performed. Live access is currently blocked by non-interactive GCP reauthentication; resolve that separately, without changing application auth.

1. Merge, verify and deploy this code first. Confirm the deployed build and that primary spawn is safe.
2. Before any deletion, verify the target database and a restorable backup, inventory the selected terrain overrides/spaces and their dependencies, and agree on an explicit scoped reset transaction with the operator. Do not use cascading truncation.
3. Preserve users, roles, invitations, the art/decor catalog, collision settings and personal decor. **Desk deletion is not authorized.** Retained desks recreate their cubicle spaces at startup, so clearing spaces alone cannot produce a permanently empty office. Resolve that scope explicitly before clearing related rows; do not delete desks or dependent data automatically.
4. During an agreed maintenance window, apply only the reviewed terrain/space scope. Restart the server (or explicitly reload every affected runtime) and reload clients: changing database rows alone does not update in-memory terrain, room state or space caches. Verify safe joins, reconnects and the remaining placements.

Code rollback does not restore cleared data. The verified backup and explicitly scoped restoration are the rollback boundary for any later operational clear.

`pnpm map:init` reproduces the checked-in empty `src/game/maps/office.json` and the unchanged Tiled palette. It writes repository artifacts only, not database rows. `--palette-only` preserves manual Tiled edits. Keep the default's per-tile overlay layers empty if runtime block edits must control every tile.

The map-editor work unit can be reverted independently of the earlier avatar collision-alignment commit. Reverting code/defaults does not undo terrain batches an admin has already applied: those are persisted overrides and require a separate, explicitly reviewed data restoration. No automatic data migration or reset is part of this work.

Tests use explicit legacy fixtures for chairs, furniture, rooms, collision and proximity behavior. Real-process E2E starts `e2e/server.ts` with an isolated in-memory topology; it does not seed a live database or reinstate legacy objects in the shipped default.
