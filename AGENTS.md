# AGENTS.md

Operational contract for AI coding agents and contributors. Humans start with `README.md`. Feature-level detail lives in the code, its tests and `docs/`; read those instead of expecting it here.

## Project overview

Oficina Virtual is an internal, Gather-style 2D top-down virtual office. A React + Phaser SPA renders the map and avatars, a Node (Colyseus + Express) server syncs avatar positions and exposes an HTTP API, and a self-hosted LiveKit SFU provides proximity audio/video, with LiveKit Egress recording spaces to Google Cloud Storage. Product requirements: `PRD-Oficina-Virtual.md` (Spanish; architecture in section 6, roadmap in section 12).

## Repo layout

```
src/                SPA (Vite + React + Phaser)
  auth/             Firebase/Identity Platform and local auth adapters
  components/       React UI
  dashboard/        admin panel (/dashboard): *Port.ts + *Client.ts + *Panel.tsx
  game/             Phaser scene, map, proximity, LiveKit and Colyseus clients, shared rules
  art/              pure character renderer shared by tools/art, the SPA and the server
  hooks/            React hooks bridging game/clients to UI
  pwa/              service worker registration (production builds only)
server/src/         Node server, run by Node type stripping (no build step)
  createOfficeServer.ts  Express routes + Colyseus transport on one http.Server (all HTTP routes)
  OfficeRoom.ts     Colyseus room
  <feature>/        ports and adapters per feature; directory/schema.sql applied idempotently on start
e2e/                real-process E2E harness (node:test + Playwright)
tools/              art/ (pack exporter), map/ (Tiled layout generator), pwa/, vm/ (VM schedule)
infra/livekit/      local LiveKit + Egress + Redis compose stack
infra/gcp/          deployed `test` environment: Terraform, VM compose, Caddy, scripts
public/assets/pack/ generated art pack, never hand-edited
public/icons/       generated PWA icons, never hand-edited
prototype/          reference only, not built, not run
```

Shared code: the server imports several `src/game/*.ts` modules (`officeProtocol.ts`, `mapData.ts`, `artContract.ts`, `seating.ts`, `officeLayout.ts`, `pieceCollisions.ts`, `deskTable.ts`, `officeDecor.ts`, `deskDecorRules.ts`) and `src/art/`. Keep them import-free (explicit `.ts` imports, JSON with `with { type: 'json' }`). Changes there affect both client and server.

## Tech stack

- Node 24, pnpm 11, ESM. `pnpm-workspace.yaml` is not a monorepo: only `overrides` and `allowBuilds`.
- Frontend: Vite 8, React 19, TypeScript 7, Phaser 3.90.0 (pinned to line 3), `livekit-client`, `@livekit/track-processors` (lazy chunk), `colyseus.js` 0.16.22, `firebase/auth`, `vite-plugin-pwa`.
- Server: `@colyseus/core` 0.16.24 + `@colyseus/ws-transport`, Express 4, `livekit-server-sdk`, `pg`, `jose`, `@google-cloud/storage`.
- Tests: Vitest 4 (projects `unit` jsdom, `server` node, `browser` Chromium), Testing Library, Playwright.
- Infra: Docker Compose, LiveKit v1.13.x, Caddy (custom `layer4` image), Postgres 17 (Cloud SQL when deployed), Terraform on GCP, GitHub Actions with Workload Identity Federation.

## Commands

All from the repo root.

| Command | What it does |
|---|---|
| `pnpm install` | Install dependencies (CI: `--frozen-lockfile`) |
| `pnpm dev` | Vite dev server on http://localhost:5173 |
| `pnpm server` | Server on port 2567 (`PORT` overrides). Does NOT load `.env` |
| `pnpm build` / `pnpm build:e2e` | Build to `dist/` / instrumented build to `dist-e2e/` |
| `pnpm typecheck` | Client and server typecheck (the only static gate) |
| `pnpm test` / `test:server` / `test:browser` / `test:all` | Vitest `unit` / `server` / `browser` / all three (CI) |
| `pnpm test:harness` | Unit tests of the E2E harness |
| `pnpm test:e2e` | E2E against real server + `vite preview` (needs `dist/` and `dist-e2e/`) |
| `pnpm test:e2e:audio` | Audio E2E; needs real LiveKit and `VITE_LIVEKIT_E2E=1` |
| `pnpm art:export` | Regenerate art pack + previews. Commit both; `tools/art/pack.test.ts` fails on drift |
| `pnpm pwa:icons` | Regenerate PWA icons. Commit them; drift test fails otherwise |
| `pnpm art:templates` | Regenerate artist templates. Commit them; drift test fails otherwise |
| `pnpm map:init` | Regenerate `src/game/maps/office.json` and palette (`--palette-only` keeps the map) |
| `pnpm test:mux` | Local Docker harness for the Caddy TURN/TLS mux. Never in CI |

No lint or format tooling exists. Do not add a linter unless asked.

First-time browser setup: `pnpm exec playwright install chromium`.

Pre-PR check that mirrors CI: `pnpm typecheck && pnpm test:all && pnpm test:harness && pnpm build && pnpm build:e2e && pnpm test:e2e`.

Full local stack: `cp .env.example .env` (set `LIVEKIT_API_SECRET`), then `docker compose up -d --build` (SPA :8080, server :2567, Postgres :5432). Same ports as the hybrid path (`infra/livekit/` compose + host app): run one or the other. Server with the root `.env`: `node --env-file=.env server/src/main.ts`.

## Environment variables

Names and semantics are in `.env.example`. Never commit values. Every variable is optional locally: an unset feature degrades (usually a 503 with a `*-not-configured` code) instead of failing. Key rules:

- `FIREBASE_PROJECT_ID` unset: no auth. Set: fails closed.
- Local auth (`LOCAL_AUTH_USERS` + `LOCAL_AUTH_SECRET`, client `VITE_AUTH_MODE=local`) is for local and test only, never in `infra/gcp/`. A partial or conflicting config refuses to start.
- `DATABASE_URL` unset: no directory, spaces, desks, decor, terrain edits, collisions or custom characters.
- `VITE_COLYSEUS_URL` unset derives `ws(s)://<host>:2567`; set but empty disables multiplayer on purpose.
- `.env.e2e` is committed and keeps Firebase keys empty on purpose.

## Architecture

Server modules are hexagonal, per feature folder in `server/src/`:

- `*Port.ts`: interface the routes depend on.
- `pg*.ts`: Postgres adapter (built in `directory/fromEnv.ts`). `memory*.ts`: in-memory adapter with the same contract.
- `*Rules.ts`: pure domain rules and typed errors.
- `*Routes.ts`: handlers as pure functions returning `{ status, body }`, tested without Express; `createOfficeServer.ts` adapts them.
- `fromEnv.ts`: only wiring code reads env; rooms and routes get dependencies injected.

Client mirrors it: `*Port.ts` + `*Client.ts` (injected `fetch`) + presentational component; pure helpers take inputs instead of touching `window`.

Invariants:

- The room treats every client as untrusted: moves are validated against terrain, walls and collisions; the server decides the LiveKit room from the tracked position, never from the client. Character ids are never client-sent.
- Collisions and walkability: the server checks the body center, the client the whole Arcade body. The client must always be the stricter side.
- Writes that change terrain, walls or decor go through the single `TerrainRuntime` queue and publish only after atomic persistence.
- Pending art contributions are private until approved; only `GET /me/art/files/*` serves them.

## Coding conventions

- TypeScript strict. Server and `tools/` files import with explicit `.ts` extensions; client files without extensions.
- `@colyseus/schema` classes must not use class fields: merged `interface` + factories (`server/src/schema.ts`, `server/README.md`). Class fields silently break serialization.
- Naming: components and scenes PascalCase; modules camelCase; hooks `useX.ts` in `src/hooks/`; ports `*Port.ts`; adapters `memory*`/`pg*`; routes `*Routes.ts`.
- Named exports; `App` and `DashboardRoute` are default exports because of `React.lazy`.
- UI copy is Spanish. Code comments, commits and docs are English (match old Spanish comments when editing them).
- Comments explain why (decisions, issue numbers), not what.
- Dependencies are pinned deliberately. Read `server/README.md` before bumping Colyseus.
- Border radius uses only the tokens in `src/index.css`: `--radius-panel` (panels/cards), `--radius-control` (buttons, inputs, tiles, rows), `--radius-tag` (badges). Never a literal px, except `50%` for circles.

## Testing

- Strict TDD: failing test first. Every behavior change ships with tests.
- Tests are co-located: `foo.ts` + `foo.test.ts`.
- Suffix picks the project: `*.test.ts(x)` jsdom; `*.browser.test.ts(x)` Chromium (anything importing Phaser); `server/**/*.test.ts`, `src/**/*.node.test.ts`, `tools/**/*.test.ts` Node.
- No infrastructure in unit/server tests: Postgres adapters use an injected query executor, routes are pure functions, Colyseus tests start a real server on an ephemeral port.
- LiveKit tests use `describe.skipIf(!import.meta.env.VITE_LIVEKIT_E2E)`.
- E2E uses real processes only (server on port 2599, `vite preview` of `dist-e2e/`). The test hook exists only in `--mode e2e` (`__OFFICE_E2E__`); a test asserts it is absent from `dist/`.

## Git workflow

- `main` is protected: changes land only through PRs (no direct or force pushes).
- Branches: `feat/<issue>-slug`, `fix/<issue>-slug`, `docs/`, `ci/`, `test/`, `refactor/`.
- Conventional commits with a scope (`feat(decor): ...`), imperative lowercase subject. Small focused commits, tests green at each.
- CI (`ci.yml`) runs typecheck, `test:all`, `test:harness`, build, `build:e2e`, `test:e2e` and the blocking `test:e2e:audio` with a real LiveKit.
- Never commit `.env` files (only `.env.example` and `.env.e2e`), credentials, `dist*/` or `.codegraph/`.

## Deployment

Only a `test` environment exists; `infra/gcp/README.md` is the runbook.

- `deploy-test.yml` runs after green CI on a push to `main` and deploys `workflow_run.head_sha`: images tagged with the SHA (never `latest`), then `office-deploy <sha>` over IAP and a `/health` smoke check.
- Terraform is applied by a human, never by CI. Config reaches the VM as metadata from `terraform apply`; an image rollback does not revert config.
- Secrets live only in Secret Manager, never in the repo, GitHub secrets or Terraform state. Values must have no trailing newline.
- The VM runs on an office-hours schedule (`tools/vm/vmSchedule.ts`, `vm-nightly.yml`, manual control `infra/gcp/scripts/office-vm.sh`).

## Gotchas

- A new server route needs its own `handle` in `infra/gcp/Caddyfile`, before the catch-all, or it returns `index.html` with 200. Exception: `POST /auth/local/sign-in` must never get one.
- Caddyfile and `livekit.yaml` are bind mounts read only at startup: `office-deploy` reloads Caddy and restarts LiveKit on checksum change. Preserve both if you touch deploy config. `office-deploy` on disk is refreshed from metadata by the workflow; keep that step.
- Service worker: keep `runtimeCaching` empty and never precache `index.html` or `assets/pack/**`. Caching any server route stores private responses. `sw.js`, the manifest and `/icons/*` are served `no-cache` (guarded by `tools/pwa/pwaCaching.test.ts`). To remove the worker from clients, ship `selfDestroying: true` AND drop the registration in `src/main.tsx`.
- Uploaded art is under `/assets/files/*` and custom characters under `/assets/characters/*`, never plain `/assets/*` (that belongs to the Vite bundles). Stable-name folders under `/assets/` need a `no-cache` nginx location.
- Upload routes skip the global 100 KB `express.json()` for their own 1 MB parser; `POST /admin/assets/upload` is registered before `POST /admin/assets/:id`.
- Phaser cannot load under jsdom: anything touching it must be a `*.browser.test.ts(x)`.
- `vite.config.ts` repeats `define` per Vitest project on purpose; `__OFFICE_E2E__` must be defined in each.
- `VITE_COLYSEUS_URL` stays commented out in `.env.example`: an empty value disables multiplayer.
- Stay on `@colyseus/core` 0.16.24 (0.16.25 is broken, no JS client for 0.17). Never use the `colyseus` meta-package.
- `google_compute_instance.office` ignores `machine_type`, `metadata_startup_script` and the runtime metadata keys `office-heavy-days`/`office-hold-until`. Never declare those keys or `desired_status`. A plan touching the instance must say `update in-place`; replacing the VM is an explicit `-replace`.
- The 20:00 scheduled stop ignores holds; outside office hours the app does not answer at all.
- Recording on `e2-medium` is refused by Egress (502 `egress-failed`); `e2-standard-4` allows one recording. Egress needs the upload destination in each request.
- Signed URLs need the VM service account to hold `roles/iam.serviceAccountTokenCreator` on itself; service account keys are forbidden. Locally use impersonated ADC.
- Cloud SQL password goes through write-only `password_wo` (Terraform >= 1.11). Rotate: new secret version, bump `db_password_version`, apply, redeploy.
- Login fails closed: only the bootstrap superadmin is auto-created; every other account must be added from `/dashboard` (else 401 `not-provisioned`).
- Password-reset emails depend on Identity Platform console settings no code manages (`infra/gcp/README.md`, "Password-reset email").
- Local `infra/livekit/livekit.yaml` has TURN disabled and UDP 50000-50019 only; the deployed config is `infra/gcp/livekit.yaml.tpl`.
- PRs only add rules or gotchas to AGENTS.md. Never feature descriptions.
