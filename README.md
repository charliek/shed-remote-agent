# shed-remote-agent

Mobile-first web UI for browsing [sheds](https://github.com/charliek/shed) across
configured hosts and bootstrapping `claude remote-control` sessions inside them.
Pair it with the Claude mobile/desktop app to pick up a coding session from anywhere.

Designed to live behind Tailscale — there is no auth layer.

## What it does

- Lists sheds from every host in `~/.shed/config.yaml`
- Creates a new shed with a git repo (`gh`-backed picker) or a host-side local directory
- Treats native machines as first-class RC targets alongside sheds: SSH machines
  (e.g. Tailscale-reachable boxes) and `type: local` machines that run tmux
  directly on the orchestrator host with no SSH hop
- Bootstraps `claude remote-control` (or `claude /rc`, or a plain shell) in
  the shed workspace (`SHED_WORKSPACE`) of any running shed (or a configured `workdir` on a machine) by
  launching it inside a detached tmux session named `rc-<slug>`
- Three RC kinds — `agent`, `repl`, `shell` — pickable per session
- Attaches an in-browser xterm.js terminal to any session over a WebSocket
- Shows the generated `https://claude.ai/code?environment=env_...` /
  `claude.ai/code/session_...` URL with Copy/Open buttons
- Surfaces actionable states: `starting`, `ready`, `reconnecting`, `needs-trust`,
  `needs-auth`, `dead`
- Talks to **secure sheds** (shed `v0.7+`) transparently: pinned-TLS HTTPS with a
  self-signed cert + a bearer control token it mints/refreshes over SSH, alongside
  legacy plain-HTTP sheds — see [secure sheds](./docs/reference/secure-sheds.md)
- Light and dark themes — follows your OS by default, with a one-tap toggle

## Stack

- Bun workspaces monorepo
- `apps/api` — Hono + pino on Bun, Zod env config, native SSE pass-through
- `apps/web` — React 18 + Vite + Tailwind + TanStack Query + Radix
- `packages/shared` — Zod schemas + inferred types shared across both apps

## Configuration

### `apps/api/.env`

Per-machine API runtime config (CORS origins, log level, ports, etc.).
Bun loads it automatically — copy
[`apps/api/.env.example`](./apps/api/.env.example) to `apps/api/.env`
and edit. The `.env` is gitignored.

The `CORS_ORIGINS` value gates both the HTTP CORS middleware and the
in-browser terminal WebSocket; if you serve the page from anywhere
other than `http://localhost:5173`, add that origin here.

### `~/.shed/config.yaml`

Shed hosts are discovered from the shed CLI's own config file — no duplication.

### `~/.config/shed-remote-agent/config.yaml`

Our own config (copy [`config.example.yaml`](./config.example.yaml) and edit):

```yaml
defaults:
  local_dir: { user: charliek, path: /home/charliek/projects }
github:
  owners: [charliek]
```

`gh` must be authenticated on the machine running the backend
(`gh auth login` once).

## Documentation

Full documentation is published at
**[charliek.github.io/shed-remote-agent](https://charliek.github.io/shed-remote-agent/)**
and auto-deploys on every push to `main` that touches the docs.

## Develop

```bash
bun install
bun run dev          # api on :8787, web on :5173
bun run dev:api
bun run dev:web
bun test --cwd apps/api
```

The Vite dev server proxies `/api` to `:8787`.

## Run on another tailnet host

Bring this up on any always-on machine on the tailnet (e.g. a Mac mini)
that should host the orchestrator while shed servers stay running on their
own hosts.

Prereqs on the new machine:

- [Bun](https://bun.com), [`prox`](https://github.com/charliek/prox), and
  `gh` (optional, for the repo picker)
- `~/.shed/config.yaml` listing the shed servers (this is the shed CLI's
  own config — copy it from your other machine)
- `~/.config/shed-remote-agent/config.yaml` — copy
  [`config.example.yaml`](./config.example.yaml) and adjust
  `local_dir.path` for the platform (`/Users/...` on macOS)

Then:

```bash
git clone https://github.com/charliek/shed-remote-agent.git
cd shed-remote-agent
bun install
prox up                    # api + web (the dev servers declared in prox.yaml)
```

This orchestrator does **not** run or supervise any `shed-host-agent`.
Credential brokering (ssh-agent / docker / aws) is owned by a per-host
`shed-host-agent`, installed and run by Homebrew on each shed host and scoped
to that host's local shed-server — see
[shed-extensions](https://github.com/charliek/shed-extensions):

```bash
brew install charliek/tap/shed-host-agent
brew services start shed-host-agent
```

### Documentation development

The docs use `mkdocs-material` managed by `uv`:

```bash
make docs            # build into site-build/
make docs-serve      # serve on http://127.0.0.1:7070
```

## Phase map

Implemented phases:
1. Scaffold
2. Config loaders + `GET /api/hosts`
3. Shed client + list/detail + session endpoints
4. SSH/workspaces/repos helpers and pickers
5. Create shed with streaming SSE progress
6. Remote-control bootstrap, probe, kill; RC UI
7. Polish: error states, filter inputs, mobile layout, SSE parser tests
8. RC session kinds (`agent`/`repl`/`shell`) with per-session picker
9. In-browser xterm.js terminal attach over WebSocket
10. Native machines as RC targets (`machines:` config block, parallel `/api/machines/...` endpoints)
11. `type: local` machines (no-SSH path for the orchestrator host itself)

Post-MVP (explicitly not built):
- In-browser Claude chat (Connect-API proxy to a web UI inside the shed)
- Worktree spawn mode for `claude remote-control`
- Branch selection for repo clones
- Web-driven `claude auth login`
- Host add/edit flow (edit `~/.shed/config.yaml` directly for now)

A repl/agent session now clears Claude Code's first-run workspace-trust prompt
automatically: it pre-seeds the workdir as trusted in `~/.claude.json` before
launch and, as a fallback, accepts the prompt over tmux. So a fresh session
reaches `ready` unattended without the old "attach, run `claude`, accept" step.
