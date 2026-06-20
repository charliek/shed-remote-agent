# Remote Control

A remote-control session is a detached tmux session running on an RC target. The backend identifies and probes them by tmux session-name prefix (`rc-`).

The on-session metadata format (`SHED_RC_*` env vars) is a tool-neutral standard so that shed-remote-agent, shed-desktop, the `shed` CLI, and future clients can all discover and pick up each other's sessions. The wire details below are the reference implementation of that standard — see [RC Session Convention](rc-session-convention.md) for the normative spec.

## Targets

Sessions are anchored to one of two target types. The wire shape is identical; only the dispatch differs.

| Target | Discriminator on `target` | How commands reach the tmux session |
|--------|---------------------------|-------------------------------------|
| Shed | `{ "kind": "shed", "shed_name", "host" }` | SSH as `<shed_name>@<host>:<sshPort>` from `~/.shed/config.yaml` |
| SSH machine | `{ "kind": "machine", "machine_name" }` + `type: ssh` config | SSH as `<user>@<host>:<sshPort>` from `machines[]` |
| Local machine | `{ "kind": "machine", "machine_name" }` + `type: local` config | Direct `Bun.spawn(['bash','-c', …])` on the orchestrator host (no SSH) |

Local machines exist for the case where the orchestrator runs on a node that other tailnet boxes can reach over Tailscale SSH, but the node can't loop back to itself. See [Config Schema → Machines](config-schema.md#machines).

## Session kinds

The `kind` field on bootstrap selects what runs inside tmux. Default is `claude-rc`.
(v2 renamed the kinds; see [RC Session Convention → Versioning](rc-session-convention.md#versioning-v1--v2).)

| Kind | Inner command | Notes |
|------|---------------|-------|
| `claude-broker` | `claude remote-control --name <display> --spawn same-dir` | Cloud-driven broker. Pane goes `ready` when both `Connected` and a `claude.ai/code?environment=env_...` URL appear. |
| `claude-rc` | `claude --name <display> /rc` | Interactive Claude REPL with `/rc` enabled. Pane goes `ready` when a `claude.ai/code/session_...` URL appears. |
| `shell` | `bash -l` | Plain login shell. No Claude. Pane goes `ready` as soon as any output appears. |

On native machines (both SSH and local), the claude kinds are wrapped in `bash -ic` so PATH-mutating tools (nvm, asdf, pnpm) are loaded before `claude` is exec'd. Sheds bake `claude` into a system path, so they skip the wrapper.

## Lifecycle

1. **Bootstrap**: The backend dispatches to the target (SSH or local spawn) and runs:
   ```bash
   tmux new-session -d -s rc-<slug> -c <workdir> \
     -e SHED_RC_V=2 -e SHED_RC_ID=<uuid> \
     -e SHED_RC_DISPLAY_NAME=<display> -e SHED_RC_KIND=<kind> -e SHED_RC_WORKDIR=<workdir> \
     -e SHED_RC_CREATED_BY=shed-remote-agent/<version> -e SHED_RC_CREATED_AT=<rfc3339> \
     '<inner command>'
   ```
   See [RC Session Convention](rc-session-convention.md) for the full key set and rules.
2. **Probe**: The backend runs `tmux capture-pane -t rc-<slug> -p -S -200` and inspects the output with the regex table below.
3. **Ready**: The pane has reached a `ready` (or other terminal) state for the configured kind.
4. **Attach (optional)**: A browser opens a WebSocket to `/api/.../rc/<slug>/attach`. The backend spawns `tmux attach -t rc-<slug>` (over SSH for remote targets, direct for local) attached to a PTY and bridges bytes to the WebSocket.
5. **Kill**: `tmux kill-session -t rc-<slug>`.

`listRcSessions` collapses the list + probe + env-read into a single SSH/bash invocation so a page load doesn't pay N+1 round-trips.

## States

| State | Meaning | Recovery |
|-------|---------|----------|
| `starting` | Probe ran, no URL or status line yet | Wait; the UI keeps polling |
| `ready` | Pane is in a terminal good state for its kind (URL present for `claude-broker`/`claude-rc`, any output for `shell`) | Join via the Claude app or attach in-browser |
| `reconnecting` | Network blip; `claude remote-control` auto-reconnects (`claude-broker` kind only) | Wait; usually clears in a few seconds |
| `needs-trust` | `claude` refused to run because the workdir isn't trusted | Rare — bootstrap auto-clears trust (see below). If it persists: `shed attach <name>` (or SSH to the machine), `cd "$SHED_WORKSPACE"; claude` once, accept the prompt, recreate |
| `needs-auth` | `claude` needs a claude.ai login | `claude auth login` on the target, then recreate |
| `dead` | tmux session is gone (crashed, killed, never existed) | Kill the entry from the UI; create a new one |

For the claude kinds, the bootstrap clears Claude's first-run workspace-trust prompt
automatically — pre-seeding trust for the workdir before launch and accepting the
prompt over tmux as a fallback — so a fresh session usually reaches `ready`
without hitting `needs-trust`. See
[RC Session Convention → Workspace-trust auto-accept](rc-session-convention.md#workspace-trust-auto-accept-claude-rcclaude-broker).

## Classifier regexes

From `apps/api/src/lib/rc.ts` `classifyPane`:

| Signal | Regex | Applies to |
|--------|-------|------------|
| `claude-broker` URL | `https?:\/\/claude\.ai\/code\?environment=env_[A-Za-z0-9_-]+` | `claude-broker` |
| `claude-rc` URL | `https?:\/\/claude\.ai\/code\/session_[A-Za-z0-9_-]+` | `claude-rc` |
| `needs-trust` | `Workspace not trusted` or `Quick safety check` or `Yes,\s*I trust this folder` (case-insensitive) | `claude-broker`, `claude-rc` |
| `needs-auth` | `requires a claude\.ai subscription` or `not logged in` or `claude auth login` (case-insensitive alternation) | `claude-broker`, `claude-rc` |
| `reconnecting` | `\bReconnecting\b` | `claude-broker` |
| `ready` (`claude-broker`) | `\bConnected\b` + URL, or URL alone | `claude-broker` |
| `ready` (`claude-rc`) | `Remote Control active` + URL, or URL alone | `claude-rc` |
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
- Default workdir: the shed `SHED_WORKSPACE` (landing dir) for sheds — `/workspace` on older sheds, the machine's `workdir` for machines (`~` fallback)

Slug generation uses a confusable-free alphabet (`abcdefghjkmnpqrstuvwxyz23456789`) so a human reading the name back from a QR / URL doesn't confuse `0`/`O` or `1`/`l`.

The bootstrap stamps the session's metadata into tmux session environment variables (`SHED_RC_V`, `SHED_RC_ID`, `SHED_RC_DISPLAY_NAME`, `SHED_RC_KIND`, `SHED_RC_WORKDIR`, `SHED_RC_CREATED_BY`, `SHED_RC_CREATED_AT`) so any tool — including `listRcSessions` here — can recover it. `rc-*` sessions without `SHED_RC_V` are treated as legacy/unmanaged: still listed and killable, but rendered with defaults (`kind=claude-broker`, fallback display name, target-default workdir). See [RC Session Convention](rc-session-convention.md).

## Why tmux

- Survives SSH disconnects and browser closes
- Can be inspected with `tmux capture-pane` for cheap state probing
- One tmux process handles many sessions concurrently — no per-session daemon to manage
- Killing is atomic: `tmux kill-session -t rc-<slug>`

Alternatives considered: worktree-mode `claude remote-control` (deferred — see [Roadmap](../ROADMAP.md)) and a custom agent protocol (too much work for the payoff).
