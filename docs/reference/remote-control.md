# Remote Control

A remote-control session is a detached tmux session inside a shed, running one `claude remote-control` process. The backend identifies and probes them by tmux session-name prefix (`rc-`).

## Lifecycle

1. **Bootstrap**: The backend SSHes into the shed (user = shed name, port = host's `ssh_port`) and runs:
   ```bash
   tmux new-session -d -s rc-<slug> -c /workspace \
     'claude remote-control --name "<display>" --spawn same-dir'
   ```
2. **Probe**: The backend runs `tmux has-session && tmux capture-pane -p -S -200` and inspects the output with a small regex table (see below).
3. **Ready**: When the pane contains both `Connected` and a `https://claude.ai/code?environment=env_...` URL, the session is joinable.
4. **Kill**: `tmux kill-session -t rc-<slug>`.

A running `listRcSessions` collapses the list + probe into a single SSH invocation so we don't pay N+1 round-trips per page load.

## States

| State | Meaning | Recovery |
|-------|---------|----------|
| `starting` | Probe ran, no URL or status line yet | Wait; the UI keeps polling |
| `ready` | Pane contains the `env_...` URL and is `Connected` | Join via the Claude app or the URL |
| `reconnecting` | Network blip; `claude remote-control` auto-reconnects | Wait; usually clears in a few seconds |
| `needs-trust` | `claude` refused to run because the workdir isn't trusted | `shed attach <name>; cd /workspace; claude` once, accept the prompt, recreate |
| `needs-auth` | `claude remote-control` needs a claude.ai login | `shed attach <name>; claude auth login`; recreate |
| `dead` | tmux session is gone (crashed, killed, never existed) | Kill the entry from the UI; create a new one |

## Classifier regexes

From `apps/api/src/lib/rc.ts` `classifyPane`:

| Signal | Regex |
|--------|-------|
| URL | `https?:\/\/claude\.ai\/code\?environment=(env_[A-Za-z0-9_-]+)` |
| `needs-trust` | `Workspace not trusted` (case-insensitive) |
| `needs-auth` | `requires a claude\.ai subscription\|not logged in\|claude auth login` (case-insensitive) |
| `reconnecting` | `\bReconnecting\b` |
| `ready` | `\bConnected\b` + URL |

The classifier is pure and independently unit-tested in `apps/api/src/lib/__tests__/rc.test.ts`.

## Session name format

- tmux session name: `rc-<slug>`
- Default display name (shown in the Claude app session list): `<shed>/<slug>`
- Default workdir: `/workspace`

Slug generation uses a confusable-free alphabet (`abcdefghjkmnpqrstuvwxyz23456789`) so a human reading the name back from a QR / URL doesn't confuse `0`/`O` or `1`/`l`.

## Why tmux

- Survives SSH disconnects and browser closes
- Can be inspected with `tmux capture-pane` for cheap state probing
- One tmux process handles many sessions concurrently — no per-session daemon to manage
- Killing is atomic: `tmux kill-session -t rc-<slug>`

Alternatives considered: worktree-mode `claude remote-control` (deferred — see [Roadmap](../ROADMAP.md)) and a custom agent protocol (too much work for the payoff).
