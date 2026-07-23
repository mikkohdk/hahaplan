# hahaplan

Web toolkit for running live comedy lineup shows and open mics: the host runs
the evening from a phone, a stage display keeps every performer on time, and
comedians in the back room follow along on their own phones. No apps, no
accounts — everyone joins via a link or QR code.

Full requirements: [docs/spec.md](docs/spec.md). Design system: **Margin**
(`web/src/margin/`, currently the CSS lifted from world-river; the full kit
gets swapped in when exported).

## Status

- ✅ **P0.1** — server: show model, master clock, WebSocket full-state
  broadcast, join URLs + QR, SQLite persistence (`node:sqlite`, survives restarts)
- ✅ Host / stage / follow pages: create show, build lineup, start/next/pause/resume,
  live countdown everywhere
- ✅ **P0.3** — stage display: full four-state overtime ladder — white-on-black →
  red final minute → red/black blink → escalating multicolor blink that speeds
  up the longer an act runs over
- ✅ Host Plan tab: add / reorder (↑ ↓) / delete acts and breaks, edit an act's
  length inline, live editing during a show
- ⏭ **P0.2** — remaining: drag-and-drop reorder, three-tab host layout

## Run it

```
npm install
npm run dev
```

- Web app: http://localhost:5173 (Vite dev server, proxies to the API)
- API/WS server: http://localhost:8787

Create a show on the landing page — you land on the host view; the Share card
has the QR codes for the stage display and the follow view.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Server (tsx watch) + web (Vite) together |
| `npm run smoke` | End-to-end WebSocket lifecycle test (needs a running server) |
| `npm run typecheck` | Type-checks server and web |
| `npm run build` | Production build of the web app into `web/dist` |
| `npm start` | Serves API + built frontend as one process (production mode) |

## Deploy

The whole thing is one Node process (API + WebSocket + static SPA), so any host
that runs a container works. A `Dockerfile` is included:

```
docker build -t hahaplan .
docker run -p 8787:8787 hahaplan
```

Runs on **Render's free tier** as a git-connected Docker web service that
auto-deploys on every push to `main` (Render supplies `$PORT`, which the server
reads — no config needed). The SQLite file lives under `DATA_DIR` (`/app/data`,
ephemeral on the free tier, so shows reset when the instance restarts); to keep
shows across restarts, use a paid instance with a persistent disk mounted at
`/app/data`. CI (`.github/workflows/ci.yml`) type-checks, builds, and runs the
end-to-end smoke test on every push and PR.

## Layout

```
shared/protocol.ts   message schemas + clock math — the single source of truth,
                     imported by both server and web
server/              Fastify + WebSocket server, SQLite persistence
web/                 React SPA: / (create), /show/{id}/host|stage|follow
web/src/margin/      Margin design system CSS (tokens + components)
scripts/smoke.ts     e2e lifecycle test
docs/spec.md         requirements specification
```

## Architecture notes

- **The clock never ticks over the network.** The server broadcasts clock
  *changes* (`startedAtMs`, `accumulatedMs`, status); every client renders the
  countdown locally, corrected by a per-message server-time offset.
- **Full-state broadcast.** Every mutation broadcasts the entire show state
  (it's tiny). Reconnect is therefore identical to connect — no sync logic.
- **Running act is snapshotted** into the clock segment when it starts, so
  live lineup edits can never disturb the timer on stage.
- **Auth**: the host URL carries a secret token (then stored in
  localStorage); stage/follow URLs are harmless and shareable.
