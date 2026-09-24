# Oficina Virtual

An internal, Gather-style 2D top-down virtual office. People walk an avatar around a shared map, hear and see whoever is nearby, meet in rooms, claim a desk, and record meetings. Everything real-time is self-hosted: WebRTC runs on our own LiveKit SFU, not a third-party video service.

The product reference is `PRD-Oficina-Virtual.md` (Spanish; architecture in section 6, roadmap in section 12). Conventions for contributors and AI coding agents live in [AGENTS.md](AGENTS.md).

## Features

- **2D office map** rendered with Phaser: WASD movement, collisions, simulated NPCs, auto-walk to a colleague.
- **Real-time presence**: real avatars synced over WebSocket (Colyseus), with status (`En línea`, `Ocupado`, `No molestar`) and reconnection tolerance for flaky networks.
- **Proximity audio and video** over LiveKit: you hear and see people near you; spaces (rooms and desk cubicles) get their own isolated LiveKit room.
- **Calls by clicking an avatar**: invitation cards with accept/decline and a chime.
- **Desks and decoration**: claim a desk, customize it from an asset catalog.
- **Meeting recording**: record a space with LiveKit Egress to Google Cloud Storage, REC badge for everyone in the room, view or download through a short-lived signed URL, kept 30 days.
- **Email + password sign-in** with GCP Identity Platform (Firebase Auth), verified server-side.
- **Admin dashboard** at `/dashboard` (reached by URL, no link in the UI): invitations, users and roles, spaces, desks and assets, backed by Postgres.

The UI copy is in Spanish.

## Architecture overview

```
Browser (React 19 + Phaser 3 SPA, Vite)
  |-- WebSocket ------------> Node server (server/src)
  |                             Colyseus OfficeRoom: positions, status, calls, recording state
  |-- HTTP /livekit/token --->  Express API: /health, /livekit/token, /spaces, /desks,
  |   /recordings/*, /admin/*   /me/desk, /assets, /recordings/*, /admin/*
  |                             |-- Postgres (users, invitations, spaces, desks, decor)
  |                             |-- LiveKit server API + Egress (start/stop recordings)
  |                             '-- Google Cloud Storage (signed URLs)
  '-- WebRTC ---------------> LiveKit SFU (audio, video) --Redis--> Egress --> GCS bucket
```

- The server decides which LiveKit room a token is for from the player's tracked position; the client cannot pick a room.
- Auth, directory, recording and CORS are all opt-in through environment variables. Without them the office still runs, with that feature disabled.
- Deployed, a single GCP VM runs Caddy (TLS + SNI multiplexing on 443), the SPA (nginx), the Node server, Postgres, LiveKit, Redis and Egress with Docker Compose.

More detail: [AGENTS.md](AGENTS.md#architecture), `server/README.md`, `infra/livekit/README.md`, `infra/gcp/README.md`.

## Prerequisites

- Node.js 24 (CI and the server image use Node 24; the server runs `.ts` files directly through Node type stripping).
- pnpm 11 (pinned in `package.json` `packageManager`; `corepack enable` picks it up). The lockfile is `pnpm-lock.yaml`.
- Chromium for Playwright, for browser and E2E tests: `pnpm exec playwright install chromium`.
- Optional: Docker with Compose, for the local LiveKit stack and `pnpm test:mux`.
- Optional: `gcloud`, for local recording against a GCS dev bucket and for deployment.

## Quick start

```sh
pnpm install
pnpm server     # terminal 1: Colyseus + HTTP API on ws://localhost:2567
pnpm dev        # terminal 2: SPA on http://localhost:5173
```

With no `.env` at all this runs without login, without the directory, and without audio/video: the client finds the server on `ws://<host>:2567` and falls back to single-player with NPCs if the server is down.

## Running locally with Docker

Docker runs the backing services (LiveKit, Egress, Redis and optionally Postgres). The app itself (Node server and Vite SPA) runs on the host with pnpm. There is no single compose file for the whole app: `infra/gcp/docker-compose.yml` is the deployed VM topology (registry images, Caddy with public sslip.io hostnames) and is not meant for local use.

Requirements: Docker with Compose v2, Node 24 and pnpm 11. Ports used: `2567` (server), `5173` (SPA), `7880`, `7881/tcp` and `50000-50019/udp` (LiveKit), `5432` (Postgres).

1. Start LiveKit + Egress + Redis:

   ```sh
   cp infra/livekit/.env.example infra/livekit/.env
   # set LIVEKIT_API_SECRET to the output of: openssl rand -hex 32
   docker compose -f infra/livekit/docker-compose.yml up -d
   docker compose -f infra/livekit/docker-compose.yml ps   # livekit, egress, redis: running
   curl -I http://localhost:7880                           # HTTP 200
   ```

2. Optional: start Postgres to enable the directory, the admin dashboard, spaces and desks. The server applies its schema on every start.

   ```sh
   docker run -d --name office-pg -p 5432:5432 \
     -e POSTGRES_USER=office -e POSTGRES_PASSWORD=office -e POSTGRES_DB=office \
     postgres:17-alpine
   ```

3. Create the root `.env`:

   ```sh
   cp .env.example .env
   ```

   Then edit it:
   - Set `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` to the same values as `infra/livekit/.env`.
   - Delete the `VITE_COLYSEUS_URL=` line (or set it to `ws://localhost:2567`). Vite exposes the empty value, and an empty `VITE_COLYSEUS_URL` explicitly disables multiplayer.
   - If you ran step 2: `DATABASE_URL=postgres://office:office@localhost:5432/office`.

4. Install dependencies and run the app (two terminals):

   ```sh
   pnpm install
   node --env-file=.env server/src/main.ts   # pnpm server does not load .env
   pnpm dev                                  # http://localhost:5173
   ```

   `curl http://localhost:2567/health` should return `"ok":true`, with `"directory":"enabled"` if Postgres is configured.

5. Stop everything:

   ```sh
   docker compose -f infra/livekit/docker-compose.yml down
   docker rm -f office-pg
   ```

Without `FIREBASE_PROJECT_ID` and the `VITE_FIREBASE_*` variables there is no login screen, which is the normal local setup. Open two browser windows to test proximity audio/video between avatars. Local recording additionally needs a real GCS dev bucket and impersonated Application Default Credentials (`GCS_CREDENTIALS_FILE`, `RECORDING_GCS_BUCKET`); see "Local recording" in `infra/livekit/README.md`.

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev` | Vite dev server on port 5173 |
| `pnpm server` | Node server on port 2567 (`PORT` overrides) |
| `pnpm build` | Typecheck client and server, production build to `dist/` |
| `pnpm build:e2e` | Instrumented build for the E2E harness, to `dist-e2e/` |
| `pnpm preview` | Serve `dist/` |
| `pnpm typecheck` | Typecheck only |
| `pnpm test` | Unit tests (jsdom) |
| `pnpm test:watch` | Unit tests in watch mode |
| `pnpm test:server` | Server tests (Node, real Colyseus) |
| `pnpm test:browser` | Browser tests (headless Chromium) |
| `pnpm test:all` | All three Vitest layers |
| `pnpm test:coverage` | All layers with coverage |
| `pnpm test:harness` | Unit tests of the E2E harness helpers |
| `pnpm test:e2e` | Two-client E2E (needs `pnpm build:e2e` first) |
| `pnpm test:e2e:audio` | Two-client audio E2E against a real LiveKit |
| `pnpm e2e` | Harness tests, both builds and the E2E suite in one go |
| `pnpm test:mux` | Local Docker harness for the TURN/TLS multiplexer |

There is no lint script; `pnpm typecheck` is the static check.

## Environment configuration

Copy `.env.example` to `.env` and fill in only what you need. Every variable is documented there. Groups:

| Group | Variables | Unset means |
|---|---|---|
| Client | `VITE_COLYSEUS_URL`, `VITE_LIVEKIT_URL` | derived automatically |
| LiveKit | `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL`, `LIVEKIT_API_URL` | no audio/video tokens |
| Recording | `RECORDING_GCS_BUCKET` | `/recordings/*` answers 503 |
| CORS | `ALLOWED_ORIGIN` | `*` |
| Auth | `FIREBASE_PROJECT_ID` (server), `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_AUTH_DOMAIN` (client) | no login |
| Directory | `DATABASE_URL`, `BOOTSTRAP_SUPERADMIN_EMAIL`, `IDENTITY_ADMIN_CREDENTIALS`, `IDENTITY_ADMIN_USE_METADATA` | no roles, invitations, spaces or desks |

The local LiveKit stack has its own `infra/livekit/.env` (from `infra/livekit/.env.example`). `GET /health` reports whether auth and the directory are enabled. Never commit a real `.env`.

## Testing

Tests are written first (strict TDD) and live next to the code they cover. Three Vitest layers, because Phaser cannot even be imported under jsdom:

- `*.test.ts(x)` in `src/`: jsdom, fast, everything that does not render Phaser (`pnpm test`).
- `*.browser.test.ts(x)`: real headless Chromium through Playwright (`pnpm test:browser`).
- `server/**/*.test.ts` and `src/**/*.node.test.ts`: Node, with a real Colyseus server on an ephemeral port (`pnpm test:server`).

End-to-end tests in `e2e/` start the real server and a real `vite preview` of the instrumented build and drive two Chromium clients. LiveKit-dependent tests are skipped unless `VITE_LIVEKIT_E2E` is set and a LiveKit server is reachable.

CI (`.github/workflows/ci.yml`) runs on every PR to `main` and every push to `main`: typecheck, all Vitest layers, harness tests, both builds, the two-client E2E and the audio E2E against a real LiveKit container.

## Deployment

There is a single `test` environment on GCP; `infra/gcp/README.md` is the full runbook.

- Infrastructure (VM, static IP, firewall, IAM, Artifact Registry, Secret Manager containers, recordings bucket, GitHub OIDC federation) is Terraform in `infra/gcp/terraform/`, applied by hand, never from CI.
- Every push to `main` that passes CI triggers `.github/workflows/deploy-test.yml`: it builds the `caddy`, `web` and `colyseus` images tagged with the commit SHA, then runs `office-deploy <sha>` on the VM over an IAP tunnel and smoke checks `/health`.
- `office-deploy` (`infra/gcp/scripts/office-deploy.sh`) rebuilds the VM's `.env` from instance metadata and Secret Manager, pulls and starts the compose stack, reloads Caddy, and restarts LiveKit only when its config changed.
- Hostnames use sslip.io on the static IP (`app.`, `lk.`, `turn.`) until there is a real domain.
- Redeploy without a code change: `gh workflow run deploy-test.yml`.

## Contributing

- `main` is protected: every change goes through a pull request. Direct pushes and force pushes to `main` are blocked.
- Branch from `main` as `feat/<issue>-slug`, `fix/<issue>-slug`, `docs/<slug>` and similar.
- Use conventional commits with a scope, e.g. `feat(recording): ...`, `fix(infra): ...`, `test(desks): ...`.
- Write the failing test first, and run the CI checks locally before opening a PR.
- Coding conventions, module patterns, test placement and known gotchas are in [AGENTS.md](AGENTS.md).
- Work is tracked in the [repository issues](https://github.com/HugoGT/labs_office/issues).

## Project status and known limitations

The office is usable end to end in the `test` environment: map, presence, proximity audio/video, calls, spaces, desks, decoration, recording, auth and the admin dashboard are on `main`. Production does not exist yet.

Known limitations:

- **Recording capacity depends on VM size.** On the default `e2-medium` VM, Egress refuses every recording (502 `egress-failed`); `e2-standard-4` allows one at a time. Resizing is a deliberate cost decision.
- **No automatic database backups.** Postgres runs on the VM; backups are manual `pg_dump` runs (see `infra/gcp/README.md`).
- **No custom domain.** sslip.io shares Let's Encrypt rate limits with everyone; Caddy falls back to ZeroSSL.
- **Accounts are created by an admin**, not by self sign-up. Creating invited accounts from the dashboard needs identity admin credentials, otherwise it answers 503.
- **Not yet built** (open issues): screen sharing (#20), PWA install and push (#13), Google Calendar room booking (#14), camera pan by dragging (#53), own Tiled map and final art (#4), phase 2 catalog and analytics (#15).
- **Open bugs**: avatars can walk through each other during auto-walk (#59); a colleague can disappear until both clients reload (#52).

`prototype/` holds the original standalone prototype the app was ported from. It is reference only and is not built or served; open `prototype/index.html` directly in a browser to see it.
