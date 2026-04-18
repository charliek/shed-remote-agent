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

Response:

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

## Remote Control

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/sheds/:host/:name/rc` | List RC sessions in a shed (filtered tmux sessions, probed for state) |
| POST | `/sheds/:host/:name/rc` | Bootstrap a new RC session and block until a terminal state (≤ 20 s) |
| DELETE | `/sheds/:host/:name/rc/:slug` | Kill the underlying tmux session |
| GET | `/sheds/rc/_meta` | Debug: exposed constants (`prefix`, `default_workdir`) |

### Bootstrap body (all optional)

```json
{"slug":"demo","display_name":"my-shed/demo","workdir":"/workspace"}
```

Defaults: `slug` auto-generated (6 confusable-free chars), `display_name` = `<shed>/<slug>`, `workdir` = `/workspace`.

### Bootstrap response

```json
{
  "slug": "abc123",
  "tmux_session": "rc-abc123",
  "shed_name": "my-shed",
  "host": "localhost-dev",
  "display_name": "my-shed/abc123",
  "workdir": "/workspace",
  "state": "ready",
  "url": "https://claude.ai/code?environment=env_01RP..."
}
```

See [Remote Control](remote-control.md) for the meaning of each state.

## Hosts (secondary)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/hosts/:host/images` | List image variants available on the shed host |
| GET | `/hosts/:host/workspaces` | List local directories on the shed host (requires `local_dir` config) |

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
