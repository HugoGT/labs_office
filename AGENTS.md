# AGENTS.md

Single source of truth for AI coding agents and contributors working in this repository. Humans should start with `README.md`; this file is the operational contract.

## Project overview

Oficina Virtual is an internal, Gather-style 2D top-down virtual office. A React + Phaser SPA renders the map and avatars, a Node (Colyseus + Express) server syncs real avatar positions and exposes an HTTP API, and a self-hosted LiveKit SFU provides proximity audio/video, with LiveKit Egress recording spaces to Google Cloud Storage. Product requirements live in `PRD-Oficina-Virtual.md` (Spanish; architecture in section 6, roadmap in section 12).

## Repo layout

```
src/                    SPA (Vite + React + Phaser)
  main.tsx, App.tsx     entrypoint; App resolves auth and route once at startup
  routing/route.ts      two routes only: office (default) and /dashboard (no router lib)
  auth/                 Firebase/Identity Platform auth port + adapter
  components/           React UI (OfficeShell, GameCanvas, BottomBar, VideoTiles, RecBadge, ...)
  dashboard/            admin panel (/dashboard): *Port.ts + *Client.ts + *Panel.tsx
  game/                 Phaser scene, map, proximity, LiveKit and Colyseus clients, protocol
  hooks/                React hooks bridging game/clients to UI (useProximityAudio, useDesks, ...)
  test/                 Vitest setup files
server/src/             Node server, run directly by Node type stripping (no build step)
  main.ts               entrypoint (PORT, default 2567)
  createOfficeServer.ts wiring: Express routes + Colyseus transport on one http.Server
  OfficeRoom.ts         Colyseus room (positions, status, calls, recording state)
  admin/ assets/ decor/ desks/ directory/ recording/ spaces/ terrain/   feature modules (ports and adapters)
  directory/schema.sql  Postgres schema, applied idempotently on every start
e2e/                    real-process E2E harness (node:test + Playwright)
tools/art/              art pack exporter: pure generators (domain/), sheets, manifest, previews
tools/map/              initial Tiled layout generator and its editor palette (`pnpm map:init`)
docs/art/               art contract (contract.md) and generated review previews (preview/)
docker-compose.yml      full local stack (include of infra/livekit + postgres + server + web images)
infra/livekit/          local LiveKit + Egress + Redis docker compose stack
infra/gcp/              deployed `test` environment: Terraform, VM compose, Caddy, office-deploy
prototype/              pre-port standalone prototype, reference only (not built, not run)
public/assets/          static art: pack/ is the generated art pack, never hand-edited
src/game/maps/          office.json, the Tiled base layout (static map), and its editor palette
.github/workflows/      ci.yml (verify) and deploy-test.yml (deploy after green CI on main)
```

Shared code: the server imports `src/game/officeProtocol.ts`, `src/game/mapData.ts`, `src/game/artContract.ts`, `src/game/seating.ts` and `src/game/officeLayout.ts` directly (import-free but for `maps/office.json`, a JSON import with `with { type: 'json' }`). Changes there affect both client and server.

## Tech stack

- Node 24 (CI and Docker images), pnpm 11 (`packageManager` in `package.json`), ESM (`"type": "module"`).
- Frontend: Vite 8, React 19, TypeScript 7, Phaser 3.90.0 (pinned to line 3 on purpose), `livekit-client` 2.22.3, `colyseus.js` 0.16.22, `firebase` (only `firebase/auth`).
- Server: `@colyseus/core` 0.16.24 + `@colyseus/ws-transport`, Express 4, `livekit-server-sdk`, `pg`, `jose` (ID token verification), `@google-cloud/storage`.
- Tests: Vitest 4 (projects `unit` jsdom, `server` node, `browser` Chromium via `@vitest/browser-playwright`), Testing Library, Playwright for E2E.
- Infra: Docker Compose, LiveKit server v1.13.x + Egress + Redis, Caddy (custom image with `layer4`), Postgres 17 (local Docker; Cloud SQL with private IP when deployed), Terraform on GCP (single Compute Engine VM + Cloud SQL), GitHub Actions with Workload Identity Federation.
- `pnpm-workspace.yaml` is not a monorepo: it exists only for `overrides` and `allowBuilds`.

## Commands

All from the repo root. Every script below exists in `package.json`.

| Command | What it does |
|---|---|
| `pnpm install` | Install dependencies (CI uses `pnpm install --frozen-lockfile`) |
| `pnpm dev` | Vite dev server on http://localhost:5173 (`host: true`) |
| `pnpm server` | Colyseus + HTTP server on port 2567 (`PORT` overrides). Does NOT load `.env` |
| `pnpm build` | `tsc -b` + server typecheck + `vite build` to `dist/` |
| `pnpm build:e2e` | Instrumented build (`--mode e2e`, reads `.env.e2e`) to `dist-e2e/` |
| `pnpm preview` | Serve `dist/` |
| `pnpm typecheck` | Client (`tsc -b --noEmit`) and server (`tsconfig.server.json`) typecheck |
| `pnpm test` | Vitest `unit` project (jsdom) |
| `pnpm test:watch` | `unit` project in watch mode |
| `pnpm test:server` | Vitest `server` project (Node, real Colyseus on an ephemeral port) |
| `pnpm test:browser` | Vitest `browser` project (headless Chromium) |
| `pnpm test:all` | All three Vitest projects (what CI runs) |
| `pnpm test:coverage` | All projects with v8 coverage |
| `pnpm test:harness` | Pure unit tests of the E2E harness helpers |
| `pnpm test:e2e` | Two-client E2E against real server + `vite preview` (needs `dist-e2e/`) |
| `pnpm test:e2e:audio` | Two-client audio and "No molestar" E2E; needs a real LiveKit and `VITE_LIVEKIT_E2E=1` (the screen share scenario also needs `DATABASE_URL`) |
| `pnpm e2e` | `test:harness` + `build` + `build:e2e` + `test:e2e` |
| `pnpm art:export` | Regenerate the art pack (`public/assets/pack/`, 1x PNGs + `manifest.json`) and its upscaled previews (`docs/art/preview/`). Commit both; `tools/art/pack.test.ts` fails while they drift |
| `pnpm map:init` | Regenerates the initial Tiled layout and its palette from `tools/map/` (overwrites `src/game/maps/office.json`; `--palette-only` keeps it) |
| `pnpm test:mux` | Local Docker harness for the Caddy TURN/TLS multiplexer. Never runs in CI |

There is no lint or format script and no ESLint/Prettier/Biome config. `pnpm typecheck` (strict, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`) is the static gate. Do not add a linter unless asked.

First-time browser setup: `pnpm exec playwright install chromium` (CI uses `--with-deps`).

Pre-PR check that mirrors CI: `pnpm typecheck && pnpm test:all && pnpm test:harness && pnpm build && pnpm build:e2e && pnpm test:e2e`.

Full local stack (whole app in Docker, no hot reload; reads only the root `.env`):

```sh
cp .env.example .env   # set LIVEKIT_API_SECRET (openssl rand -hex 32)
docker compose up -d --build   # SPA http://localhost:8080, server :2567, Postgres :5432 (loopback)
docker compose down -v         # -v also wipes the Postgres volume
```

It builds `infra/gcp/docker/{colyseus,web}.Dockerfile`, pulls LiveKit + Egress + Redis in with Compose `include` of `infra/livekit/docker-compose.yml` (interpolated from the root `.env`), and hardcodes `DATABASE_URL`, `LIVEKIT_URL` (browser, `ws://localhost:7880`), `LIVEKIT_API_URL` (`http://livekit:7880`) and `VITE_COLYSEUS_URL` (`ws://localhost:2567`). Same ports as the hybrid path below: run one or the other.

Local LiveKit stack only (optional, for real audio/video and recording with the app on the host):

```sh
cp infra/livekit/.env.example infra/livekit/.env   # regenerate LIVEKIT_API_SECRET
docker compose -f infra/livekit/docker-compose.yml up -d
```

To run the server with the root `.env`: `node --env-file=.env server/src/main.ts` (Node flag; `pnpm server` does not read `.env`). Vite reads `.env` on its own for `VITE_*`.

## Environment variables

Names only; see `.env.example` for semantics. Never commit values. Everything is optional in local dev: an unset feature degrades instead of failing.

Root `.env` (server and SPA):

- Client (baked at build time): `VITE_COLYSEUS_URL`, `VITE_LIVEKIT_URL`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_AUTH_DOMAIN`
- LiveKit: `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL`, `LIVEKIT_API_URL`
- Recording: `RECORDING_GCS_BUCKET`, `GOOGLE_APPLICATION_CREDENTIALS` (commented out; ADC is found automatically)
- Uploaded art: `ASSET_GCS_BUCKET` (same ADC, read + create on the bucket)
- CORS: `ALLOWED_ORIGIN`
- Auth: `FIREBASE_PROJECT_ID`
- Directory: `DATABASE_URL`, `DATABASE_SSL_CA_FILE` (commented out; set only when the database requires TLS), `BOOTSTRAP_SUPERADMIN_EMAIL`, `IDENTITY_ADMIN_CREDENTIALS`, `IDENTITY_ADMIN_USE_METADATA`
- Server process: `PORT`, `NODE_ENV`, `OFFICE_RECONNECTION_WINDOW_SECONDS` (commented out in `.env.example`; an empty `PORT` means port 0, a random port)

`infra/livekit/.env`: `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `GCS_CREDENTIALS_FILE`, `GCS_BUCKET`. Also read by `vite.config.ts` and `e2e/harness.mjs` to mint real LiveKit tokens from Node. The full stack (root `docker-compose.yml`) does not read it: it interpolates the included LiveKit services, `GCS_CREDENTIALS_FILE` included, from the root `.env`.

Test-only: `.env.e2e` (committed, no secrets: `VITE_E2E_HOOK`, `VITE_COLYSEUS_URL=ws://localhost:2599`, empty Firebase keys), `VITE_LIVEKIT_E2E` (enables LiveKit-gated tests), `E2E_READINESS_TIMEOUT_MS` (harness readiness deadline, default 15000).

Degradation rules worth knowing:
- No `FIREBASE_PROJECT_ID`: server runs without auth. Set: fails closed. SPA shows login only when both `VITE_FIREBASE_API_KEY` and `VITE_FIREBASE_PROJECT_ID` are set.
- No `DATABASE_URL`: no directory (no roles, no expiry), no spaces/desks/decor store, so every space shares the corridor LiveKit room and there is nothing per-space to record. No character selector either: `/me/avatar` answers 503 and everyone is the pack default character. The terrain is the committed layout's and `POST /admin/terrain/blocks/:index` answers 503 `terrain-not-configured`.
- No `RECORDING_GCS_BUCKET`: `/recordings/*` answers 503 `recording-not-configured`.
- No `ASSET_GCS_BUCKET`: `POST /admin/assets/upload`, `GET /assets/files/<hash>.png` and every contribution route (`/me/art/*`, `/admin/art/*`) answer 503 `asset-upload-not-configured`; the office keeps the default pack and "Personalizar" offers nothing to contribute to.
- No identity admin credentials: creating invited accounts answers 503; the rest of the dashboard works.
- `VITE_COLYSEUS_URL` unset: client derives `ws(s)://<host>:2567`; set but empty: multiplayer disabled on purpose.
- `GET /health` reports `auth` and `directory` as `enabled` / `disabled`.

## Architecture

Runtime flow:

1. The SPA (`src/App.tsx`) resolves auth config and route once. `AuthGate` gates both the office (`OfficeShell`) and the dashboard (`DashboardRoute`), each loaded with `React.lazy` so the dashboard never downloads Phaser.
2. `OfficeShell` owns the `OfficeBridge` between React and Phaser (`src/game/officeBridge.ts`, `OfficeScene.ts`). The client joins the Colyseus room `OfficeRoom` over WebSocket, sending the Firebase ID token when auth is on.
3. `OfficeRoom` treats the client as untrusted: every `move` is validated, clamped and checked against the walkable terrain of the layout (item 15); partially valid messages are dropped. Messages: `move`, `status`, `spacesversion`, `call`, `callrespond`, `sit`, `stand`. `PlayerState` replicates `avatarId` (persisted character, never client-sent) and `seat` (a `seating.ts` reference, `''` standing). The room also carries recording state visible to all occupants, and `OfficeState.terrainBlocks`, the live terrain blocks (item 16).
4. Proximity audio/video: the client asks `POST /livekit/token`; the server decides the LiveKit room from the session's tracked position (`liveSessions.ts`, `sessionGuard.ts`), ignoring any room the client sends. Room naming is `livekitRoomFor(spaceId)` in `src/game/officeProtocol.ts`: `null` is the shared corridor room, a space gets `office-livekit-space-<id>`.
5. Recording: `POST /recordings/start|stop` starts a LiveKit Egress room composite (MP4) uploaded to GCS through `server/src/recording/egressPort.ts`; `POST /recordings/url` returns a 10-minute V4 signed URL (view or download) for participants only. Retention is `RECORDING_RETENTION_DAYS = 30` (`src/game/officeProtocol.ts`), enforced by the bucket lifecycle rule; `server/src/recording/retention.test.ts` fails if Terraform or `infra/gcp/recordings-lifecycle.json` drift from it.
6. Admin API under `/admin/*` (session, invitations, users, spaces, desks, assets) backs the `/dashboard` SPA route. There is no UI link to `/dashboard`; it is reached by URL.
7. Access removal (#93): `GET /admin/users` lists every directory user (with a server-computed `removable` flag) and `POST /admin/users/:id/revoke` revokes anyone the caller outranks per `canRemove` (`server/src/directory/accessDecision.ts`: superadmin removes admin/employee/guest, admin removes employee/guest, nobody removes the superadmin or themself). It sets `status = 'revoked'` with a `revoke-user` audit entry, evicts the account's live sessions through the `SessionEvictor` port (`server/src/sessionEviction.ts`, implemented by `OfficeRoom` with close code `SESSION_REVOKED_CLOSE_CODE` 4101), then disables the Identity Platform account. `POST /admin/invitations/:id/revoke` is unchanged and still only touches invitations.
8. Account passwords (#94): invitation and user creation create the Identity Platform account with a random password that is never returned, then send a password-reset email through `IdentityAdmin.sendPasswordReset` (`accounts:sendOobCode`). Responses carry `emailSent` instead of a password; a failed send keeps the account and can be retried with `POST /admin/users/:id/password-reset`. The login's "forgot password" link uses `AuthPort.sendPasswordReset` and shows the same confirmation whether or not the account exists.
9. Self-chosen display name (#100): the Login screen claims a unique display name through `POST /me/display-name` (canonicalized and compared case/whitespace-insensitively; `server/src/directory/schema.sql` enforces the actual uniqueness with a partial unique index, `pgDirectory`/`memoryDirectory` translate a collision to `DisplayNameTakenError`). Sign-in itself never writes `users.display_name` anymore (`resolveOnLogin` only reads); `OfficeRoom.onAuth` resolves the directory row once and carries its `displayName` alongside the verified identity, and `onJoin` labels from it, falling back to the token-derived name only when nobody has chosen one yet. Without a directory the typed name is discarded and the office behaves exactly as before this feature.
10. Art pack catalog and appearance (art migration step 3, `docs/ArtImplementation.md`): with the directory on, `DirectoryRuntime.migrate()` also registers `public/assets/pack/manifest.json` in `art_pieces` through `DecorCatalog.registerArtPack` (upsert by manifest id; a piece a newer pack drops gets `retired_at`, never deleted). The path is resolved only in `directory/fromEnv.ts`, and the server image copies that one file. Choices store piece ids: `users.avatar_id`, `desks.material_id`/`color`, `spaces.floor_material_id`/`floor_color` (a desk cubicle is a space). Color is NULL unless the material is colorable. Column DEFAULTs mirror `ART_PACK_DEFAULTS` (`server/src/decor/artCatalogRules.ts`, drift-tested against the manifest) and backfill existing rows. Catalog validation (`resolveCharacterChoice`, `resolveDeskAppearance`, `resolveFloorAppearance`) is for the caller that makes the choice; adapters only check the shape.
11. Art pack rendering (art migration step 4): `ArtPackLoader` (`src/game/artPackLoader.ts`) reads `assets/pack/manifest.json` in the scene's `preload()` and loads floors, desks and chairs before `create()`; other pieces (characters, walls) load on demand with `request()`, and an id the manifest lacks re-reads it once (cache-busted). Pure rules live in `artPack.ts` (manifest parsing, load list, recolor decision), `artPlacement.ts` (anchors, facings, floor tiles) and `artColor.ts` (the ramp color model shared with `tools/art`; colorable pieces are recolored once per material/color into a cached texture). Pieces are drawn 1:1 by their anchor, never stretched; desks use `DEFAULT_DESK_FACING`. `GET /desks` rows carry `materialId`/`color` and `GET /spaces` rows `floorMaterialId`/`floorColor` (read only, outside the spaces version hash). Since step 8 every piece the layout draws (tileset, walls, trees, plants, bridges, hedges, tables) loads at boot too; without the pack the terrain is one flat color per material and each piece a grey placeholder. Kenney is gone.
12. Character choice at the entrance (art migration step 5): office access is authenticate, resolve name, choose character, save, enter. `AuthGate` runs `useCharacterChoice` after `useDisplayName` and shows `CharacterSelect` (CSS sprite previews of idle, walk and seated cut from the pack PNGs via `src/game/characterPreview.ts`, no Phaser) when `GET /me/avatar` says `chosen: false` (`users.avatar_chosen_at IS NULL`, true for every pre-existing account) or on a fresh sign-in (saved character preselected); a restored session that already chose enters directly. `POST /me/avatar` checks the id with `resolveCharacterChoice` against `art_pieces` (400 `invalid-character` with `reason` `unknown-piece`/`retired-piece`) and stamps `avatar_chosen_at`. `App` passes no character port on `/dashboard`, so admin access is never gated. `OfficeRoom.onAuth` carries the row's `avatarId` and `PlayerState.avatarId` replicates it (never a client-sent value); the client reads it as `RemotePlayerSnapshot.avatarId` (`characterIdOf`) and the own one through `onLocalAvatar`. Without a directory or catalog `/me/avatar` answers 503, the SPA skips the selector, and every player is the pack default; without auth there is no selector either.
13. Characters and seats (art migration step 6): avatars draw the chosen pack character (8-direction walk sheet, 4-facing seated sheet; procedural texture while loading or on failure). The walk is derived per client from movement (`characterAnimation.ts`), never sent. `src/game/avatarGeometry.ts` (import-free, shared) defines network position vs feet (`AVATAR_FEET_OFFSET_Y`) vs Arcade body; the network position is what proximity, spaces and `liveSessions.ts` read, and the sprite is drawn around it. Sitting is separate from having a desk: the client sends `sit { seat }` (E key or the `toggleSeat` bridge command) and only sits when the replicated `seat` confirms it. `OfficeRoom` drops the request unless the seat exists (`BASE_MAP_SEATS` or a desk in the injected `desks` store), the player's tile is within one tile of it (`inSeatReach`), nobody else is on it, and, for a claimed desk, the player is its occupant (free desks seat anyone; sitting never claims). A `move` out of reach, `stand`, leaving, or the desk changing hands stands the player up. Seated avatars leave the avatar band and y-sort in the world band between their chair's back and front layers (`depthLayers.ts`), so the desk covers their legs; desk zones are floor markers (`DESK_ZONE_DEPTH`).
14. Material and color at creation only (art migration step 7): desks and rooms are created from the office sidebar (`DeskEditorSection`/`SpaceEditorSection`; `/dashboard` has no desk or space panel since #107). Their forms render `ArtMaterialPicker` with the active desk/floor materials of `assets/pack/manifest.json` (`src/game/artMaterials.ts`, loaded once per page by `useMaterialCatalog`); only colorable pieces get a color input. The preview cuts the same pack sheet and paints it with the same `recolorFor` + `paintRecoloredCanvas` (`src/game/artRecolorCanvas.ts`) the office textures use, cached once per material/color (`src/game/artPreview.ts`). `POST /admin/desks` reads `materialId`/`color` and `POST /admin/spaces` `floorMaterialId`/`floorColor`, checked against `art_pieces` (`server/src/decor/artAppearanceBody.ts`; 400 `invalid-appearance` with `reason` `unknown-piece`/`retired-piece`/`color-not-allowed`/`invalid-color`); absent means the pack default. `POST /admin/desks/:id` and `POST /admin/spaces/:id` answer 400 `appearance-immutable` when the body mentions any of those keys. Moving, renaming, claiming and releasing keep a desk's appearance; personal decor still follows the person.

15. Tiled base layout and walkability (art migration step 8, #4 and #123 phase 1): `src/game/maps/office.json` is a Tiled JSON map of the STATIC office only, 126x90 tiles (4032x2880 px) in 14x10 blocks of 9x9; spaces, desks and decor stay in the database. The old 64x44 map keeps its coordinates and the world grows right and down. Layers: `blocks` (one terrain material per 9x9 block, every tile set), `ground` (tile-precise terrain over the blocks: corridor, river, room floors), `decals`, `walls` (`wall-*` pieces on solid tiles), `hedges`, `props` (objects whose type is a pack piece id: `tree-*`, `plant-*`, `bridge-*` with an `orientation`, `table-*`, `desk-*` with an optional `facing`) and `seats` (objects with `seat` index and `facing`; the index is the `map-<index>` wire id, so new chairs take the next index). One shared pure parser (`src/game/officeLayout.ts`, seats in `seating.ts`) reads it on both sides; a broken file fails at load. Effective terrain per tile is the `ground` tile, else its block's material looked up through deterministic noise so block borders wobble (`jitteredBlockMaterial`, at most `BORDER_JITTER_TILES`). Walkability (`terrainSnapshot`), in precedence order: terrain walkable unless water; a bridge deck walkable over anything; walls, hedges and solid props block, a deck under them too; outside the map blocks. The client builds its Arcade colliders from it (`terrainGrid.ts`) and `OfficeRoom` drops any `move` whose body center `(x - 16, y - 9)` lands on a blocked tile (`isPositionWalkable`), except a sitter's move within its seat's reach. The terrain renders as 4 dual-grid tilemap layers plus a decal layer of the shared `tileset-terrain` (`mapBuilder.renderTerrain`, data from `terrainRender.ts`); walls run through the centers of their tiles.
16. Editable terrain blocks (#123 phase 2): `terrain_blocks` (`schema.sql`) stores only edited blocks (`block_index`, `material` CHECKed against `LAYOUT_MATERIALS`, `updated_by`, `updated_at`); an untouched block keeps the Tiled `blocks` material. `server/src/terrain/` follows the module pattern (`terrainPort.ts`, `pgTerrain.ts`/`memoryTerrain.ts`, `terrainRules.ts`, `terrainRoutes.ts`) plus `terrainRuntime.ts`, which holds the blocks and their `TerrainSnapshot` in memory: built at `listen()` after the schema, rebuilt per accepted edit (edits run one at a time), and read by `OfficeRoom` on every `move`, so moves never query Postgres. `POST /admin/terrain/blocks/:index` `{ material }` is admin/superadmin (`authorize`). Water is refused when a newly watered tile (`newlyWateredTiles`, wobbling borders included) lies under a space or desk rect (their decor sits inside), a map chair, static furniture (tables, desk props, plants; trees, hedges and walls are not protected) or the spawn 3x3 (409 `terrain-under-placement`), or under the Arcade body of any session the room holds, reconnection window included (409 `terrain-under-player`). There is no read route: the room replicates the whole list as `OfficeState.terrainBlocks` (`encodeTerrainBlocks`), so joins and reconnects get it on the first sync and edits on the next patch; `officeRoomClient` reports it as `onTerrain` and `OfficeScene.applyTerrain` rebuilds `grid`, the Arcade terrain colliders and the tilemap live. The admin editor is `TerrainEditorSection` in the office sidebar (third section of `OfficeLayoutEditor`, exclusive with desks and rooms): the `terrainedit` bridge command drives `TerrainEditLayer` (outline, `terrainpick` on click) and a local preview the scene paints without touching collisions.
   Editing: open `src/game/maps/office.json` in Tiled (1.9 or later), keep the embedded `layout-palette` tileset and CSV layer format, paint whole 9x9 blocks in `blocks`, keep props and seats on the 32px grid, and run `pnpm test` (the parser and the layout tests catch a mixed block, an unknown piece, a prop on water or a seat gap). `pnpm map:init` regenerates the file from `tools/map/initialLayout.ts` and OVERWRITES Tiled edits; `pnpm map:init --palette-only` only redraws the palette after a pack change.

17. Admin art upload (#121, art migration step 9a): `POST /admin/assets/upload` (Admin) takes JSON `{ kind, name, author, license, material?, colorable?, defaultColor?, facings?, files: { <role>: <base64 PNG> } }` for `character` (walk + seated), `desk`, `floor` and `plant` (`server/src/assets/assetUploadRules.ts`). Each file is checked against the art contract (`assetImageRules.ts`: 128 KB, PNG, exact size, colors, alpha, background; 400 `{ error, field }`), re-encoded by the shared pure codec `server/src/assets/pngCodec.ts` (also used by `tools/art`) and stored only re-encoded through `AssetStoragePort` (`assetStoragePort.ts`, GCS and memory adapters) as `assets/<sha256>.png`. The piece joins `art_pieces` with `source = 'upload'`, `uploaded_by` and the reserved id `<kind>-upload-<16 hex>` (a pack refuses that prefix, and registering a pack retires only `source = 'pack'`); an uploaded plant also gets a desk decor `assets` row whose `textureKey` is `art:<id>:sheet`, which the scene loads on demand. The server lists active uploads at `GET /assets/files/manifest.json` (pack manifest format) and serves files at `GET /assets/files/<sha256>.png` (immutable; since #122 only a file an approved piece carries). The client reads that manifest after the pack's (`artUploadsManifestUrl`, `combineArtManifests`), so `ArtPackLoader`, the character selector and the material forms see uploads without a deploy.
18. User art contributions with moderation (#122, art migration step 9b): any signed-in user contributes a `character` or a decor `plant` (desks and floors stay the Admin's) from "Aportar arte" in "Personalizar" (`ArtContributionSection`, port `src/dashboard/artContributionPort.ts`). `POST /me/art/contributions` takes the 9a body (same checks, re-encoding and hash storage) plus `rightsAccepted: true`, the checkbox with the exact statement `RIGHTS_STATEMENT`; without it 400 `rights-not-accepted`. The license is `CONTRIBUTION_LICENSE` and `license_accepted_at` is stamped. Pure rules are `server/src/decor/artReviewRules.ts`: states `pending -> approved | rejected` (final), `MAX_PENDING_CONTRIBUTIONS = 5` per user (rejected ones free the slot) and `MAX_CONTRIBUTIONS_PER_HOUR = 10` per user counting every accepted submission, rejected included (429 `too-many-pending` / `hourly-limit`). The quota is checked before storing any file and again, binding, in `submitArtContribution` under `SELECT ... FROM users ... FOR UPDATE` (the hourly count reads `submit-art` audit entries), so parallel uploads cannot exceed it; `memoryDecor` keeps the same contract with no `await` between count and write. `art_pieces` gained `status` (DEFAULT `approved`: pack pieces and Admin uploads), `reviewed_by`, `reviewed_at`, `review_note` (only on a rejection) and `license_accepted_at`; `uploaded_by` is the submitter. `listArtPieces` returns approved pieces only, so a pending piece is in no public read (uploads manifest, `GET /assets`, the selector, `/me/avatar`), and the public `GET /assets/files/<sha256>.png` answers 404 for a file no approved piece carries (`isPublicArtFile`). Its uploader and reviewers read it through `GET /me/art/files/<sha256>.png` (authenticated, `canSeeArtFile`, `Cache-Control: private, no-store`); the client fetches it with the token as a data URL (`createOfficeFileRequest`). `GET /me/art/contributions` lists the caller's own with status, reason and usage. Review (admin/superadmin via `authorize`): `GET /admin/art/contributions?status=pending|approved|rejected`, `POST /admin/art/contributions/:id/approve` (an approved plant gets its decor `assets` row in the same transaction), `POST /admin/art/contributions/:id/reject` `{ reason }` (400 `invalid-review-note`), 409 `already-reviewed`; the queue is `ArtReviewPanel` in `/dashboard`, with an animated preview (`ArtPiecePreview`: walk in 4 facings and seated). Withdrawal `POST /admin/art/pieces/:id/retire` (only approved characters and plants, 409 `not-retirable` / `not-approved`): sets `retired_at`, archives a plant's decor asset (placed ones keep drawing, and retired plants stay in the uploads manifest for that), and for a character `UserDirectory.reassignAvatar` moves every wearer to `ART_PACK_DEFAULTS.character` while the `CharacterRetirement` hub (`server/src/characterRetirement.ts`, like `sessionEviction.ts`) sets the live `PlayerState.avatarId` of every room without closing any session; retrying converges. Every upload (`upload-art`, 9a included), submission (`submit-art`), approval, rejection and withdrawal (`approve-art`, `reject-art`, `retire-art`) writes `audit_log` with the new `piece_id` column, inside the transaction of the change. Credits: `GET /assets` and `/admin/assets` carry `author` for decor assets drawing an uploaded piece, shown by `DeskDecorEditor` and `AssetsPanel`; the character selector shows `Autoría` for uploaded characters.

HTTP routes (all in `server/src/createOfficeServer.ts`): `GET /health`, `POST /livekit/token`, `GET /spaces`, `GET /desks`, `POST /desks/:id/claim`, `GET|POST /me/desk`, `POST /me/desk/release`, `GET|POST /me/display-name`, `GET|POST /me/avatar`, `GET /assets`, `GET /assets/files/manifest.json`, `GET /assets/files/:file`, `GET|POST /me/art/contributions`, `GET /me/art/files/:file`, `POST /recordings/{start,stop,url}`, and `/admin/*` (including `GET /admin/users`, `POST /admin/users/:id/revoke`, `POST /admin/users/:id/password-reset`, `POST /admin/terrain/blocks/:index`, `POST /admin/assets/upload`, `GET /admin/art/contributions`, `POST /admin/art/contributions/:id/{approve,reject}` and `POST /admin/art/pieces/:id/retire`).

Server module pattern (hexagonal), per feature folder in `server/src/`:
- `*Port.ts`: interface the routes depend on.
- `pg*.ts`: Postgres adapter used at runtime (built in `directory/fromEnv.ts` when `DATABASE_URL` is set; unset means the feature is absent). `memory*.ts`: in-memory adapter for tests and injection, with the same behavior contract.
- `*Rules.ts`: pure domain rules and typed errors.
- `*Routes.ts`: HTTP handlers as pure functions returning `{ status, body }`, tested without Express; `createOfficeServer.ts` adapts them.
- `fromEnv.ts` / `*FromEnv`: build adapters from `process.env`. Only wiring code reads env; rooms and routes get dependencies injected.

Client follows the same idea: `*Port.ts` + `*Client.ts` (with injected `fetch`) + UI component; pure helpers (`proximity.ts`, `reconnectPolicy.ts`, `route.ts`) take inputs instead of touching `window`.

Infra: locally `infra/livekit/` runs LiveKit + Egress + Redis, and the root `docker-compose.yml` adds Postgres, the server and the SPA on top of it. Deployed, one GCE VM runs caddy, web (nginx SPA), colyseus, livekit, redis, egress via `infra/gcp/docker-compose.yml`; the directory database is a Cloud SQL PostgreSQL 17 instance (`infra/gcp/terraform/database.tf`) reached over its private IP with TLS (`DATABASE_SSL_CA_FILE`), with automated backups and point-in-time recovery. Caddy terminates TLS and multiplexes `app.*`, `lk.*`, `turn.*` sslip.io hostnames on 443 by SNI.

## Coding conventions

- TypeScript strict everywhere. Server and `tools/` files import with explicit `.ts` extensions (Node type stripping + ESM); client files import without extensions.
- `@colyseus/schema` classes must not use class fields: declare fields via a merged `interface` and create instances through factories (see `server/src/schema.ts`, `server/README.md`). Class fields silently break serialization.
- Naming: React components and Phaser scenes in PascalCase files (`OfficeShell.tsx`, `OfficeScene.ts`); modules in camelCase (`livekitRoom.ts`); hooks `useX.ts` in `src/hooks/`; ports `*Port.ts`; adapters `memory*` / `pg*`; route modules `*Routes.ts`.
- Named exports are the norm; `App` and `DashboardRoute` are default exports because of `React.lazy`.
- UI copy is Spanish. Recent code comments, commit messages and docs are English; match the surrounding file when editing old Spanish comments.
- Comments explain why (decisions, issue numbers like `#24`), not what.
- Dependencies are pinned deliberately (Phaser 3, Colyseus 0.16 line, `@colyseus/core` 0.16.24 override, digest-pinned Docker images). Read `server/README.md` before bumping Colyseus.
- Border-radius follows a 3-tier scale defined as CSS custom properties in `src/index.css`: `--radius-panel` (12px, floating panel/card containers), `--radius-control` (8px, buttons/inputs/selects/tiles/list rows), `--radius-tag` (6px, small badges/labels overlaid on content). Use the token matching the element's role, never a literal px value, except `border-radius: 50%` on circles (dots, avatars), which is not part of this scale. The Phaser minimap stays square on purpose: it's a canvas camera viewport, not a DOM box, so no CSS radius applies to it.

Testing:
- Strict TDD is expected: write the failing test first, then the code. Every behavior change ships with tests.
- Tests are co-located next to the source: `foo.ts` + `foo.test.ts`.
- Suffix picks the Vitest project: `*.test.ts(x)` runs under jsdom (`unit`); `*.browser.test.ts(x)` runs in real Chromium (anything that imports Phaser, which cannot load under jsdom); `server/**/*.test.ts`, `src/**/*.node.test.ts` and `tools/**/*.test.ts` run under Node (`server`).
- No infrastructure in unit/server tests: Postgres adapters are tested against an injected query executor; routes are tested as pure functions; Colyseus tests start a real server on an ephemeral port.
- LiveKit-dependent tests use `describe.skipIf(!import.meta.env.VITE_LIVEKIT_E2E)`.
- E2E (`e2e/*.e2e.test.mjs`) uses real processes only: server on fixed port 2599, `vite preview` of `dist-e2e/`, and Playwright contexts. The test hook is compiled in only for `--mode e2e` via the `__OFFICE_E2E__` define; `e2e/bundle-hook-absent.e2e.test.mjs` asserts it is absent from `dist/`.

## Git workflow

- `main` is protected by the `protect-main` ruleset: changes land only through pull requests; direct pushes, force pushes and branch deletion are blocked, with no bypass actors. Approvals are not required, but the PR is.
- Branch from `main`: `feat/<issue>-slug`, `fix/<issue>-slug`, `docs/<slug>`, `ci/<slug>`, `test/<slug>`, `refactor/<slug>`. Include the issue number when there is one (e.g. `feat/20-screen-share`).
- Conventional commits with a scope: `feat(recording): ...`, `fix(infra): ...`, `test(desks): ...`. Common scopes: `game`, `infra`, `office`, `spaces`, `desks`, `server`, `video`, `decor`, `dashboard`, `e2e`, `directory`, `hooks`, `auth`. Imperative, lowercase subject.
- Small, focused commits; keep tests green at each commit.
- CI (`.github/workflows/ci.yml`) runs on PRs to `main` and pushes to `main`: typecheck, `test:all`, `test:harness`, build, `build:e2e`, `test:e2e`, then a real LiveKit container for `test:e2e:audio` (blocking).
- Never commit `.env` files (only `.env.example` and `.env.e2e` are tracked), credentials, `dist*/`, or `.codegraph/`.

## Deployment

Only a `test` environment exists (`infra/gcp/README.md` is the full runbook).

- `deploy-test.yml` triggers on `workflow_run` of CI completing successfully for a push to `main` (or manually via `gh workflow run deploy-test.yml`, which skips CI). It deploys `workflow_run.head_sha`, not the tip of `main`.
- It builds and pushes `caddy`, `colyseus` and `web` images tagged with the commit SHA (never `latest`) to Artifact Registry, then SSHes over IAP and runs `office-deploy <sha>`, then smoke checks `https://<APP_HOST>/health`.
- `infra/gcp/scripts/office-deploy.sh` (installed on the VM as `/usr/local/bin/office-deploy`, refreshed from instance metadata on every deploy) is idempotent: reads config (compose, Caddyfile, `livekit.yaml.tpl`) from instance metadata, reads secrets from Secret Manager, atomically rewrites `/opt/office/.env` (0600), `docker compose pull` + `up -d`, reloads Caddy, restarts LiveKit only if `livekit.yaml` changed, prunes old images.
- Terraform (`infra/gcp/terraform/`) is applied by a human, never by CI. Config files reach the VM as metadata written by `terraform apply`; image rollback alone (`office-deploy <old-sha>`) does not revert config.
- Secrets (LiveKit key/secret, DB password, optional identity admin key) live only in Secret Manager, never in the repo, GitHub secrets or Terraform state.
- GitHub repository variables (not secrets): `GCP_PROJECT_ID`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOYER_SA`, `APP_HOST`, optional `FIREBASE_API_KEY`, `FIREBASE_PROJECT_ID`, `FIREBASE_AUTH_DOMAIN`, `GCP_ZONE`, `GCP_REGION`, `GCP_INSTANCE`, `GCP_AR_REPOSITORY`.

## Gotchas

- LiveKit reads `livekit.yaml` only at startup and Caddy does not watch its Caddyfile. Both are bind mounts, so `docker compose up -d` keeps old config. `office-deploy` reloads Caddy and restarts LiveKit when the rendered `livekit.yaml` checksum changes (a restart drops live calls). If you change deploy config handling, preserve both.
- A new server route needs its own `handle` in `infra/gcp/Caddyfile`, before the final catch-all `handle`. Otherwise it returns `index.html` with 200 (browser shows `Unexpected token '<'`, server logs nothing).
- Uploaded art is served under `handle /assets/files/*`, never `/assets/*`: the Vite bundles live under `/assets/` and belong to the `web` container.
- `POST /admin/assets/upload` and `POST /me/art/contributions` skip the global `express.json()` (100 KB limit) for their own 1 MB parser; the upload is registered before `POST /admin/assets/:id`, which would otherwise take `upload` as an asset id.
- `web-nginx.conf` caches `/assets/` as `immutable` because Vite hashes those names; the art pack (`/assets/pack/`) keeps stable names, so its own `location` revalidates with `no-cache`. A new static folder with stable names under `/assets/` needs the same (`src/game/artPackCaching.node.test.ts`).
- Contribution files are private until approved: never serve one through a public or cacheable route. `GET /me/art/files/*` (its own Caddy `handle /me/art/*`) is the only way to a pending file.
- `office-deploy` on disk is only rewritten at VM boot; the workflow refreshes it from metadata before running. Keep that step if you touch the workflow.
- `pnpm server` does not load `.env`; export variables or use `node --env-file=.env server/src/main.ts`.
- `VITE_COLYSEUS_URL` is commented out in `.env.example` on purpose: Vite exposes an empty `VITE_COLYSEUS_URL=` as `""`, which `resolveOfficeEndpoint` treats as "multiplayer off" (unset derives `ws(s)://<host>:2567`). Never ship it uncommented and empty. Local Docker setup: README "Running locally with Docker".
- Phaser cannot be imported under jsdom; anything touching it must be a `*.browser.test.ts(x)`.
- `vite.config.ts` repeats `define` per Vitest project on purpose (`test.projects` does not inherit it); `__OFFICE_E2E__` must be defined in each.
- `.env.e2e` keeps Firebase keys empty on purpose so a developer's real `.env` does not leak into the e2e bundle.
- `@colyseus/core` 0.16.25 is published broken and there is no JS client for Colyseus 0.17: stay on 0.16.24 (override in `pnpm-workspace.yaml`). Do not use the `colyseus` meta-package.
- Recording on the default `e2-medium` VM is refused by Egress admission (every start returns 502 `egress-failed`); `e2-standard-4` allows one concurrent recording.
- Signed URLs need the VM service account to have `roles/iam.serviceAccountTokenCreator` on itself; service account keys are forbidden in the GCP project. Locally, use impersonated ADC (`infra/livekit/README.md`, "Local recording"); plain user ADC cannot sign.
- Egress needs the upload destination in each request; the storage block in its config is not a default destination.
- The deployed directory DB is Cloud SQL (#72). Its user password comes from the `db-password` secret through an ephemeral resource into write-only `password_wo` (never in state; needs Terraform >= 1.11). Rotating: new secret version, bump `db_password_version`, `terraform apply`, redeploy. Backups: daily + 7 days of PITR (`infra/gcp/README.md`, "Backups and restore").
- `google_compute_instance.office` ignores `metadata_startup_script` (ForceNew: an edit used to replace the VM, which wiped the directory in #72). Roll startup script changes out with `gcloud compute instances add-metadata ... startup-script=`; replacing the VM is an explicit `terraform apply -replace=...`.
- Login fails closed (#72): `resolveOnLogin` never creates rows except the bootstrap superadmin; every other account must be added from `/dashboard` or it gets 401 `not-provisioned`.
- Secret values in Secret Manager must have no trailing newline (use `printf` / `tr -d '\n'`), or LiveKit token signatures fail silently.
- Local `infra/livekit/livekit.yaml` publishes only UDP 50000-50019 and has TURN disabled; the deployed config is `infra/gcp/livekit.yaml.tpl`.
- Password-reset emails (#94) depend on Identity Platform console settings that no code manages: the *Password reset* email template, the IAM permission `firebaseauth.users.sendEmail` on the server identity, and authorized domains if a continue URL is ever added (none is sent today). See `infra/gcp/README.md`, "Password-reset email".
