# Remote Control

A remote-control session is a detached tmux session running on an RC target. The backend identifies and probes them by tmux session-name prefix (`rc-`).

## Targets

Sessions are anchored to one of two target types. The wire shape is identical; only the dispatch differs.

| Target | Discriminator on `target` | How commands reach the tmux session |
|--------|---------------------------|-------------------------------------|
| Shed | `{ "kind": "shed", "shed_name", "host" }` | SSH as `<shed_name>@<host>:<sshPort>` from `~/.shed/config.yaml` |
| SSH machine | `{ "kind": "machine", "machine_name" }` + `type: ssh` config | SSH as `<user>@<host>:<sshPort>` from `machines[]` |
| Local machine | `{ "kind": "machine", "machine_name" }` + `type: local` config | Direct `Bun.spawn(['bash','-c', …])` on the orchestrator host (no SSH) |

Local machines exist for the case where the orchestrator runs on a node that other tailnet boxes can reach over Tailscale SSH, but the node can't loop back to itself. See [Config Schema → Machines](config-schema.md#machines).

## Session kinds

The `kind` field on bootstrap selects what runs inside tmux. Default is `repl`.

| Kind | Inner command | Notes |
|------|---------------|-------|
| `agent` | `claude remote-control --name <display> --spawn same-dir` | Cloud-driven broker. Pane goes `ready` when both `Connected` and a `claude.ai/code?environment=env_...` URL appear. |
| `repl` | `claude --name <display> /rc` | Interactive Claude REPL with `/rc` enabled. Pane goes `ready` when a `claude.ai/code/session_...` URL appears. |
| `shell` | `bash -l` | Plain login shell. No Claude. Pane goes `ready` as soon as any output appears. |

On native machines (both SSH and local), `agent`/`repl` are wrapped in `bash -ic` so PATH-mutating tools (nvm, asdf, pnpm) are loaded before `claude` is exec'd. Sheds bake `claude` into a system path, so they skip the wrapper.

## Lifecycle

1. **Bootstrap**: The backend dispatches to the target (SSH or local spawn) and runs:
   ```bash
   tmux new-session -d -s rc-<slug> -c <workdir> \
     -e SRA_DISPLAY_NAME=<display> -e SRA_KIND=<kind> -e SRA_WORKDIR=<workdir> \
     '<inner command>'
   ```
2. **Probe**: The backend runs `tmux capture-pane -t rc-<slug> -p -S -200` and inspects the output with the regex table below.
3. **Ready**: The pane has reached a `ready` (or other terminal) state for the configured kind.
4. **Attach (optional)**: A browser opens a WebSocket to `/api/.../rc/<slug>/attach`. The backend spawns `tmux attach -t rc-<slug>` (over SSH for remote targets, direct for local) attached to a PTY and bridges bytes to the WebSocket.
5. **Kill**: `tmux kill-session -t rc-<slug>`.

`listRcSessions` collapses the list + probe + env-read into a single SSH/bash invocation so a page load doesn't pay N+1 round-trips.

## States

| State | Meaning | Recovery |
|-------|---------|----------|
| `starting` | Probe ran, no URL or status line yet | Wait; the UI keeps polling |
| `ready` | Pane is in a terminal good state for its kind (URL present for `agent`/`repl`, any output for `shell`) | Join via the Claude app or attach in-browser |
| `reconnecting` | Network blip; `claude remote-control` auto-reconnects (`agent` kind only) | Wait; usually clears in a few seconds |
| `needs-trust` | `claude` refused to run because the workdir isn't trusted | `shed attach <name>` (or SSH to the machine), `cd <workdir>; claude` once, accept the prompt, recreate |
| `needs-auth` | `claude` needs a claude.ai login | `claude auth login` on the target, then recreate |
| `dead` | tmux session is gone (crashed, killed, never existed) | Kill the entry from the UI; create a new one |

## Classifier regexes

From `apps/api/src/lib/rc.ts` `classifyPane`:

| Signal | Regex | Applies to |
|--------|-------|------------|
| `agent` URL | `https?:\/\/claude\.ai\/code\?environment=env_[A-Za-z0-9_-]+` | `agent` |
| `repl` URL | `https?:\/\/claude\.ai\/code\/session_[A-Za-z0-9_-]+` | `repl` |
| `needs-trust` | `Workspace not trusted` or `Quick safety check` or `Yes,\s*I trust this folder` (case-insensitive) | `agent`, `repl` |
| `needs-auth` | `requires a claude\.ai subscription` or `not logged in` or `claude auth login` (case-insensitive alternation) | `agent`, `repl` |
| `reconnecting` | `\bReconnecting\b` | `agent` |
| `ready` (`agent`) | `\bConnected\b` + URL, or URL alone | `agent` |
| `ready` (`repl`) | `Remote Control active` + URL, or URL alone | `repl` |
| `ready` (`shell`) | Pane has any non-empty content | `shell` |

The classifier is pure and independently unit-tested in `apps/api/src/lib/__tests__/rc.test.ts` and `rcInnerCommand.test.ts`.

## In-browser terminal attach

`GET /api/sheds/:host/:name/rc/:slug/attach` (or the `machines/...` equivalent) upgrades to a WebSocket and streams bytes between an xterm.js front-end and the underlying tmux PTY.

| Wire frame | Direction | Purpose |
|------------|-----------|---------|
| Binary | both | Raw PTY bytes |
| `{"type":"resize","cols":N,"rows":N}` | → server | PTY resize (1 ≤ N ≤ 1000) |
| `{"type":"exit","code":N}` | ← client | Underlying process exited |
| `{"type":"error","message":"..."}` | ← client | Setup failure before the PTY came up |

Origin is checked against `CORS_ORIGINS` to defend against [CSWSH](https://owasp.org/www-community/attacks/Cross_Site_WebSocket_Hijacking) — browsers don't enforce same-origin on WebSockets, so the server has to.

SSH attach uses `ssh -tt -o BatchMode=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 …`. Local attach skips SSH and spawns `tmux attach` directly under Bun's `terminal` PTY option.

## Session name format

- tmux session name: `rc-<slug>`
- Default display name (shown in the Claude app session list): `<shed>/<slug>` or `<machine>/<slug>`
- Default workdir: `/workspace` for sheds, the machine's `workdir` for machines (`~` fallback)

Slug generation uses a confusable-free alphabet (`abcdefghjkmnpqrstuvwxyz23456789`) so a human reading the name back from a QR / URL doesn't confuse `0`/`O` or `1`/`l`.

The bootstrap sets three tmux environment variables (`SRA_DISPLAY_NAME`, `SRA_KIND`, `SRA_WORKDIR`) so `listRcSessions` can recover the original metadata for sessions created in earlier UI flows.

## Why tmux

- Survives SSH disconnects and browser closes
- Can be inspected with `tmux capture-pane` for cheap state probing
- One tmux process handles many sessions concurrently — no per-session daemon to manage
- Killing is atomic: `tmux kill-session -t rc-<slug>`

Alternatives considered: worktree-mode `claude remote-control` (deferred — see [Roadmap](../ROADMAP.md)) and a custom agent protocol (too much work for the payoff).
