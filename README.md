# shed-remote-agent

Mobile-first web UI for browsing [sheds](https://github.com/charliek/shed) across
configured hosts and bootstrapping `claude remote-control` sessions inside them.
Pair it with the Claude mobile/desktop app to pick up a coding session from anywhere.

Designed to live behind Tailscale — there is no auth layer.

## What it does

- Lists sheds from every host in `~/.shed/config.yaml`
- Creates a new shed with a git repo (`gh`-backed picker) or a host-side local directory
- Bootstraps `claude remote-control` in `/workspace` of any running shed by SSH-ing
  in and launching it inside a detached tmux session named `rc-<slug>`
- Shows the generated `https://claude.ai/code?environment=env_...` URL with
  Copy/Open buttons
- Surfaces actionable states: `starting`, `ready`, `reconnecting`, `needs-trust`,
  `needs-auth`, `dead`

## Stack

- Bun workspaces monorepo
- `apps/api` — Hono + pino on Bun, Zod env config, native SSE pass-through
- `apps/web` — React 18 + Vite + Tailwind + TanStack Query + Radix
- `packages/shared` — Zod schemas + inferred types shared across both apps

## Configuration

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

Post-MVP (explicitly not built):
- In-browser Claude chat (Connect-API proxy to a web UI inside the shed)
- Worktree spawn mode for `claude remote-control`
- Branch selection for repo clones
- Pre-seeding workspace trust on create
- Web-driven `claude auth login`
- Host add/edit flow (edit `~/.shed/config.yaml` directly for now)
