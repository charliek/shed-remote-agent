# HTTP API

Every path below is prefixed with `/api`. The base URL defaults to `http://localhost:8787`.

Errors use a consistent shape:

```json
{"error":{"code":"SHED_NOT_FOUND","message":"shed not found: foo","details":null}}
```

The HTTP status is always the same as the upstream when the error came from a `shed-server`.

## Hosts

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/hosts` | List configured shed hosts from `~/.shed/config.yaml` |
| GET | `/hosts/:host/images` | List image variants available on the shed host |
| GET | `/hosts/:host/workspaces` | List local directories on the shed host (requires `local_dir` config) |

Response for `/hosts`:

```json
{"hosts":[{"name":"localhost-dev","host":"localhost","httpPort":8080,"sshPort":2222}]}
```

## Sheds

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/sheds` | Flat list of sheds across all hosts; unreachable hosts surface under `errors[]` |
| GET | `/sheds/:host/:name` | Single shed (proxied from shed-server, augmented with `host`) |
| POST | `/sheds/:host` | Create shed (streams SSE from upstream) |
| POST | `/sheds/:host/:name/start` | Start |
| POST | `/sheds/:host/:name/stop` | Stop |
| DELETE | `/sheds/:host/:name` | Delete |
| GET | `/sheds/:host/:name/sessions` | tmux sessions in the shed (each annotated with `is_remote_control`) |
| DELETE | `/sheds/:host/:name/sessions/:session` | Kill a specific tmux session |

### Create body

```json
{
  "name": "my-shed",
  "repo": "charliek/shed-remote-agent",
  "image": "base",
  "backend": "firecracker",
  "cpus": 2,
  "memory_mb": 2048,
  "no_provision": false
}
```

`repo` and `local_dir` are mutually exclusive. The backend validates the request shape before proxying to shed-server.

### Create SSE wire format

`POST /sheds/:host` sends `Accept: text/event-stream`. The response is a passthrough of shed-server's SSE stream:

```
event: progress
data: {"phase":"image","message":"Pulling ghcr.io/charliek/shed-fc-base:v0.1.0..."}

event: progress
data: {"phase":"vm-start","message":"starting Firecracker VM"}

event: complete
data: {"name":"my-shed","status":"running","host":"localhost-dev", ...}
```

Errors come on `event: error`:

```
event: error
data: {"error":{"code":"BACKEND_ERROR","message":"..."}}
```

The parser in `packages/shared/src/sse.ts` handles `:` comment lines, multi-line `data:` concat, and trailing events without a blank line.

## Machines

Native (non-shed) RC targets configured in `~/.config/shed-remote-agent/config.yaml`. See [Config Schema → Machines](config-schema.md#machines) for the entry shapes.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/machines` | List configured machines (both `type: ssh` and `type: local`) |
| GET | `/machines/:machine/workspaces` | List directories under the machine's `workdir` (requires `workdir` to be set) |

Response for `/machines`:

```json
{
  "machines": [
    {
      "type": "ssh",
      "name": "pop-os",
      "host": "pop-os",
      "user": "charliek",
      "sshPort": 22,
      "workdir": "/home/charliek/projects"
    },
    {
      "type": "local",
      "name": "mac-mini",
      "user": "charliek",
      "workdir": "/Users/charliek/projects"
    }
  ]
}
```

The `type` discriminator drives the workspaces and RC endpoints: `ssh` machines run a remote `ls` over SSH; `local` machines run the listing in-process on the orchestrator host with no SSH hop.

## Remote Control

RC endpoints exist in two parallel namespaces — one rooted at sheds, one rooted at machines. Wire shape is identical; only the target differs.

### Shed RC

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/sheds/:host/:name/rc` | List RC sessions in a shed (filtered tmux sessions, probed for state) |
| POST | `/sheds/:host/:name/rc` | Bootstrap a new RC session and block until a terminal state (≤ 20 s) |
| DELETE | `/sheds/:host/:name/rc/:slug` | Kill the underlying tmux session |
| GET (WS) | `/sheds/:host/:name/rc/:slug/attach` | WebSocket upgrade: bidirectional terminal stream attached to `tmux -t rc-<slug>` |
| GET | `/sheds/rc/_meta` | Debug: exposed constants (`prefix`, `default_workdir`) |

### Machine RC

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/machines/:machine/rc` | List RC sessions on the machine |
| POST | `/machines/:machine/rc` | Bootstrap a new RC session |
| DELETE | `/machines/:machine/rc/:slug` | Kill the underlying tmux session |
| GET (WS) | `/machines/:machine/rc/:slug/attach` | WebSocket terminal attach |

### Bootstrap body (all optional)

```json
{
  "slug": "demo",
  "display_name": "my-shed/demo",
  "workdir": "/home/shed",
  "kind": "claude-rc",
  "initial_prompt": "summarize this repo and suggest next steps"
}
```

| Field | Default | Notes |
|-------|---------|-------|
| `slug` | auto-generated (6 confusable-free chars) | Must match `^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$` |
| `display_name` | `<shed>/<slug>` or `<machine>/<slug>` | Stored in tmux env (`SHED_RC_DISPLAY_NAME`) and passed as `--name` to `claude`. Must be single-line (no control characters). |
| `workdir` | resolved from the shed's `SHED_WORKSPACE` for sheds; the machine's `workdir` for machines (`~` fallback) | Working dir for the tmux session (`-c`). An explicit value wins over the resolved default. |
| `kind` | `claude-rc` | One of `claude-broker`, `claude-rc`, `shell`. See [Remote Control → Session kinds](remote-control.md#session-kinds). |
| `initial_prompt` | none | Optional single line typed into the session once it is `ready`, then submitted. For `claude-rc` it's a prompt; for `shell` it's a command. Not applied to `claude-broker` (its input is the remote URL, not the pane); ignored otherwise. Best-effort. Control characters (incl. newlines) are rejected. |

### Bootstrap response

```json
{
  "slug": "abc123",
  "tmux_session": "rc-abc123",
  "display_name": "my-shed/abc123",
  "workdir": "/home/shed",
  "kind": "claude-rc",
  "state": "ready",
  "url": "https://claude.ai/code/session_01ABC...",
  "target": { "kind": "shed", "shed_name": "my-shed", "host": "localhost-dev" },
  "id": "9f1c0e7a-1111-4222-8333-444455556666",
  "created_by": "shed-remote-agent/0.1.0",
  "created_at": "2026-06-13T19:20:00Z",
  "target_label": "shed:my-shed@localhost-dev",
  "managed": true
}
```

For machine targets, `target` is `{ "kind": "machine", "machine_name": "<name>" }`. `url` is only populated for `claude-broker` and `claude-rc` kinds once the pane reaches `ready`; `shell` sessions never produce a URL.

The `id`, `created_by`, `created_at`, `target_label`, and `managed` fields come from the [RC Session Convention](rc-session-convention.md) metadata stored in the tmux session. They are absent (or `managed: false`) for legacy/unmanaged `rc-*` sessions created before the convention.

See [Remote Control](remote-control.md) for the meaning of each state.

### WebSocket attach protocol

Both attach endpoints (`/sheds/.../attach` and `/machines/.../attach`) upgrade an HTTP GET to a WebSocket. The CORS allowlist (`CORS_ORIGINS`) also gates these upgrades — browsers don't honor same-origin policy on WebSockets, so an explicit origin check provides CSWSH defense.

| Direction | Frame | Meaning |
|-----------|-------|---------|
| → server | binary | Keystrokes / raw bytes piped to the tmux PTY |
| → server | text JSON `{"type":"resize","cols":N,"rows":N}` | Resize the PTY (`1 ≤ N ≤ 1000`) |
| ← client | binary | Pane output from tmux |
| ← client | text JSON `{"type":"exit","code":N}` | Underlying ssh/tmux process exited |
| ← client | text JSON `{"type":"error","message":"..."}` | Setup error before the PTY came up |

Query params `cols` and `rows` set the initial PTY size (defaults `80` × `24`, max `1000`).

## Repos

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/repos` | List repos across `github.owners` via `gh repo list` (60 s TTL cache) |

Response includes `owners` so the UI can distinguish "no results" from "no owners configured":

```json
{
  "repos": [
    {"nameWithOwner": "charliek/foo", "description": "...", "updatedAt": "2026-04-01T00:00:00Z", "isPrivate": false}
  ],
  "owners": ["charliek"]
}
```

## Health

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Liveness check: `{status, timestamp, uptime}` (no `/api` prefix) |
