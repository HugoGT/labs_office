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
  admin/ decor/ desks/ directory/ recording/ spaces/   feature modules (ports and adapters)
  directory/schema.sql  Postgres schema, applied idempotently on every start
e2e/                    real-process E2E harness (node:test + Playwright)
docker-compose.yml      full local stack (include of infra/livekit + postgres + server + web images)
infra/livekit/          local LiveKit + Egress + Redis docker compose stack
infra/gcp/              deployed `test` environment: Terraform, VM compose, Caddy, office-deploy
prototype/              pre-port standalone prototype, reference only (not built, not run)
public/assets/          static art (Kenney tileset)
.github/workflows/      ci.yml (verify) and deploy-test.yml (deploy after green CI on main)
```

Shared code: the server imports `src/game/officeProtocol.ts` and `src/game/mapData.ts` directly. Changes there affect both client and server.

## Tech stack

- Node 24 (CI and Docker images), pnpm 11 (`packageManager` in `package.json`), ESM (`"type": "module"`).
- Frontend: Vite 8, React 19, TypeScript 7, Phaser 3.90.0 (pinned to line 3 on purpose), `livekit-client` 2.22.3, `colyseus.js` 0.16.22, `firebase` (only `firebase/auth`).
- Server: `@colyseus/core` 0.16.24 + `@colyseus/ws-transport`, Express 4, `livekit-server-sdk`, `pg`, `jose` (ID token verification), `@google-cloud/storage`.
- Tests: Vitest 4 (projects `unit` jsdom, `server` node, `browser` Chromium via `@vitest/browser-playwright`), Testing Library, Playwright for E2E.
- Infra: Docker Compose, LiveKit server v1.13.x + Egress + Redis, Caddy (custom image with `layer4`), Postgres 17, Terraform on GCP (single Compute Engine VM), GitHub Actions with Workload Identity Federation.
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
| `pnpm test:e2e:audio` | Two-client audio E2E; needs a real LiveKit and `VITE_LIVEKIT_E2E=1` |
| `pnpm e2e` | `test:harness` + `build` + `build:e2e` + `test:e2e` |
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
- CORS: `ALLOWED_ORIGIN`
- Auth: `FIREBASE_PROJECT_ID`
- Directory: `DATABASE_URL`, `DATABASE_SSL_CA_FILE` (commented out; set only when the database requires TLS), `BOOTSTRAP_SUPERADMIN_EMAIL`, `IDENTITY_ADMIN_CREDENTIALS`, `IDENTITY_ADMIN_USE_METADATA`
- Server process: `PORT`, `NODE_ENV`, `OFFICE_RECONNECTION_WINDOW_SECONDS` (commented out in `.env.example`; an empty `PORT` means port 0, a random port)

`infra/livekit/.env`: `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `GCS_CREDENTIALS_FILE`, `GCS_BUCKET`. Also read by `vite.config.ts` and `e2e/harness.mjs` to mint real LiveKit tokens from Node. The full stack (root `docker-compose.yml`) does not read it: it interpolates the included LiveKit services, `GCS_CREDENTIALS_FILE` included, from the root `.env`.

Test-only: `.env.e2e` (committed, no secrets: `VITE_E2E_HOOK`, `VITE_COLYSEUS_URL=ws://localhost:2599`, empty Firebase keys), `VITE_LIVEKIT_E2E` (enables LiveKit-gated tests), `E2E_READINESS_TIMEOUT_MS` (harness readiness deadline, default 15000).

Degradation rules worth knowing:
- No `FIREBASE_PROJECT_ID`: server runs without auth. Set: fails closed. SPA shows login only when both `VITE_FIREBASE_API_KEY` and `VITE_FIREBASE_PROJECT_ID` are set.
- No `DATABASE_URL`: no directory (no roles, no expiry), no spaces/desks/decor store, so every space shares the corridor LiveKit room and there is nothing per-space to record.
- No `RECORDING_GCS_BUCKET`: `/recordings/*` answers 503 `recording-not-configured`.
- No identity admin credentials: creating invited accounts answers 503; the rest of the dashboard works.
- `VITE_COLYSEUS_URL` unset: client derives `ws(s)://<host>:2567`; set but empty: multiplayer disabled on purpose.
- `GET /health` reports `auth` and `directory` as `enabled` / `disabled`.

## Architecture

Runtime flow:

1. The SPA (`src/App.tsx`) resolves auth config and route once. `AuthGate` gates both the office (`OfficeShell`) and the dashboard (`DashboardRoute`), each loaded with `React.lazy` so the dashboard never downloads Phaser.
2. `OfficeShell` owns the `OfficeBridge` between React and Phaser (`src/game/officeBridge.ts`, `OfficeScene.ts`). The client joins the Colyseus room `OfficeRoom` over WebSocket, sending the Firebase ID token when auth is on.
3. `OfficeRoom` treats the client as untrusted: every `move` is validated and clamped; partially valid messages are dropped. Messages: `move`, `status`, `spacesversion`, `call`, `callrespond`. The room also carries recording state visible to all occupants.
4. Proximity audio/video: the client asks `POST /livekit/token`; the server decides the LiveKit room from the session's tracked position (`liveSessions.ts`, `sessionGuard.ts`), ignoring any room the client sends. Room naming is `livekitRoomFor(spaceId)` in `src/game/officeProtocol.ts`: `null` is the shared corridor room, a space gets `office-livekit-space-<id>`.
5. Recording: `POST /recordings/start|stop` starts a LiveKit Egress room composite (MP4) uploaded to GCS through `server/src/recording/egressPort.ts`; `POST /recordings/url` returns a 10-minute V4 signed URL (view or download) for participants only. Retention is `RECORDING_RETENTION_DAYS = 30` (`src/game/officeProtocol.ts`), enforced by the bucket lifecycle rule; `server/src/recording/retention.test.ts` fails if Terraform or `infra/gcp/recordings-lifecycle.json` drift from it.
6. Admin API under `/admin/*` (session, invitations, users, spaces, desks, assets) backs the `/dashboard` SPA route. There is no UI link to `/dashboard`; it is reached by URL.

HTTP routes (all in `server/src/createOfficeServer.ts`): `GET /health`, `POST /livekit/token`, `GET /spaces`, `GET /desks`, `POST /desks/:id/claim`, `GET|POST /me/desk`, `POST /me/desk/release`, `GET /assets`, `POST /recordings/{start,stop,url}`, and `/admin/*`.

Server module pattern (hexagonal), per feature folder in `server/src/`:
- `*Port.ts`: interface the routes depend on.
- `pg*.ts`: Postgres adapter used at runtime (built in `directory/fromEnv.ts` when `DATABASE_URL` is set; unset means the feature is absent). `memory*.ts`: in-memory adapter for tests and injection, with the same behavior contract.
- `*Rules.ts`: pure domain rules and typed errors.
- `*Routes.ts`: HTTP handlers as pure functions returning `{ status, body }`, tested without Express; `createOfficeServer.ts` adapts them.
- `fromEnv.ts` / `*FromEnv`: build adapters from `process.env`. Only wiring code reads env; rooms and routes get dependencies injected.

Client follows the same idea: `*Port.ts` + `*Client.ts` (with injected `fetch`) + UI component; pure helpers (`proximity.ts`, `reconnectPolicy.ts`, `route.ts`) take inputs instead of touching `window`.

Infra: locally `infra/livekit/` runs LiveKit + Egress + Redis, and the root `docker-compose.yml` adds Postgres, the server and the SPA on top of it. Deployed, one GCE VM runs caddy, web (nginx SPA), colyseus, postgres, livekit, redis, egress via `infra/gcp/docker-compose.yml`. Caddy terminates TLS and multiplexes `app.*`, `lk.*`, `turn.*` sslip.io hostnames on 443 by SNI.

## Coding conventions

- TypeScript strict everywhere. Server files import with explicit `.ts` extensions (Node type stripping + ESM); client files import without extensions.
- `@colyseus/schema` classes must not use class fields: declare fields via a merged `interface` and create instances through factories (see `server/src/schema.ts`, `server/README.md`). Class fields silently break serialization.
- Naming: React components and Phaser scenes in PascalCase files (`OfficeShell.tsx`, `OfficeScene.ts`); modules in camelCase (`livekitRoom.ts`); hooks `useX.ts` in `src/hooks/`; ports `*Port.ts`; adapters `memory*` / `pg*`; route modules `*Routes.ts`.
- Named exports are the norm; `App` and `DashboardRoute` are default exports because of `React.lazy`.
- UI copy is Spanish. Recent code comments, commit messages and docs are English; match the surrounding file when editing old Spanish comments.
- Comments explain why (decisions, issue numbers like `#24`), not what.
- Dependencies are pinned deliberately (Phaser 3, Colyseus 0.16 line, `@colyseus/core` 0.16.24 override, digest-pinned Docker images). Read `server/README.md` before bumping Colyseus.

Testing:
- Strict TDD is expected: write the failing test first, then the code. Every behavior change ships with tests.
- Tests are co-located next to the source: `foo.ts` + `foo.test.ts`.
- Suffix picks the Vitest project: `*.test.ts(x)` runs under jsdom (`unit`); `*.browser.test.ts(x)` runs in real Chromium (anything that imports Phaser, which cannot load under jsdom); `server/**/*.test.ts` and `src/**/*.node.test.ts` run under Node (`server`).
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
- Postgres reads its password only when the volume is first initialized; rotating the secret alone breaks the connection. There are no automatic DB backups.
- Secret values in Secret Manager must have no trailing newline (use `printf` / `tr -d '\n'`), or LiveKit token signatures fail silently.
- Local `infra/livekit/livekit.yaml` publishes only UDP 50000-50019 and has TURN disabled; the deployed config is `infra/gcp/livekit.yaml.tpl`.
